import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from './groups.service';

const mockPrisma = {
  group: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: { findMany: jest.fn() },
  dailyAttendance: { count: jest.fn() },
  calendarDay: { count: jest.fn() },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('GroupsService', () => {
  let service: GroupsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GroupsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = moduleRef.get(GroupsService);
  });

  it('stores the group kind', async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null);
    mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
    await service.create({ name: '1-А', kind: GroupKind.school_class });
    expect(
      firstArg<{ data: { kind: GroupKind } }>(mockPrisma.group.create).data
        .kind,
    ).toBe(GroupKind.school_class);
  });

  it('refuses to delete a group with attendance records', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(1);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    await expect(service.delete('g1')).rejects.toThrow(
      new BadRequestException('Cannot delete: group has attendance records'),
    );
    expect(mockPrisma.group.delete).not.toHaveBeenCalled();
  });

  it('deletes a group without attendance records', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(0);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    await expect(service.delete('g1')).resolves.toEqual({
      message: 'Group deleted',
    });
  });
});
