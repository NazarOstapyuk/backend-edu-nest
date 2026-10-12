import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BellSchedulesService } from './bell-schedules.service';

const mockPrisma = {
  bellSchedule: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  bellPeriod: { deleteMany: jest.fn(), createMany: jest.fn() },
  timetableEntry: { findMany: jest.fn() },
  $transaction: jest.fn(),
};
const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
];
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('BellSchedulesService', () => {
  let service: BellSchedulesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BellSchedulesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(BellSchedulesService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.timetableEntry.findMany.mockResolvedValue([]);
  });

  it('creates a schedule with its periods', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    mockPrisma.bellSchedule.create.mockResolvedValue({ id: 'b1' });
    await service.create({ name: ' 1–4 класи ', periods });
    expect(
      firstArg<{ data: object }>(mockPrisma.bellSchedule.create).data,
    ).toEqual({
      name: '1–4 класи',
      periods: { create: periods },
    });
  });

  it('rejects bad times, overlaps and duplicates', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(
      service.create({
        name: 'x',
        periods: [{ number: 1, startTime: '09:00', endTime: '08:00' }],
      }),
    ).rejects.toThrow(new BadRequestException('Invalid bell time'));
    await expect(
      service.create({
        name: 'x',
        periods: [
          ...periods,
          { number: 3, startTime: '10:00', endTime: '10:40' },
        ],
      }),
    ).rejects.toThrow(new BadRequestException('Bell periods overlap'));
    mockPrisma.bellSchedule.findUnique.mockResolvedValue({
      id: 'b0',
      name: 'x',
    });
    await expect(service.create({ name: 'x', periods })).rejects.toThrow(
      new ConflictException('Bell schedule already exists'),
    );
  });

  it('refuses to drop a period used by a timetable', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue({
      id: 'b1',
      name: 'x',
    });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 2 }]);
    await expect(
      service.update('b1', { periods: [periods[0]] }),
    ).rejects.toThrow(new BadRequestException('Bell period is in use'));
    expect(
      firstArg<{ where: object }>(mockPrisma.timetableEntry.findMany).where,
    ).toEqual({
      timetable: { group: { bellScheduleId: 'b1' } },
    });
  });

  it('replaces periods as a unit', async () => {
    mockPrisma.bellSchedule.findUnique
      .mockResolvedValueOnce({ id: 'b1', name: 'x' })
      .mockResolvedValueOnce({ id: 'b1', periods });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 1 }]);
    await service.update('b1', { periods });
    expect(mockPrisma.bellPeriod.deleteMany).toHaveBeenCalledWith({
      where: { scheduleId: 'b1' },
    });
    expect(mockPrisma.bellPeriod.createMany).toHaveBeenCalledWith({
      data: periods.map((p) => ({ ...p, scheduleId: 'b1' })),
    });
  });

  it('404 for a missing schedule', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { active: false })).rejects.toThrow(
      new NotFoundException('Bell schedule not found'),
    );
  });
});
