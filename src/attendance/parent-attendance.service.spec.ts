import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DailyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ParentAttendanceService } from './parent-attendance.service';
import { RegisterService } from './register.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const mockPrisma = {
  child: { findFirst: jest.fn() },
  absenceReason: { findMany: jest.fn() },
};
const mockRegister = { childDays: jest.fn() };

describe('ParentAttendanceService', () => {
  let service: ParentAttendanceService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ParentAttendanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RegisterService, useValue: mockRegister },
      ],
    }).compile();
    service = moduleRef.get(ParentAttendanceService);
  });

  it('hides a foreign child', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(service.month('p1', 'c9', '2026-10')).rejects.toThrow(
      new NotFoundException('Child not found'),
    );
    expect(mockRegister.childDays).not.toHaveBeenCalled();
  });

  it('returns days with reason names and a summary, without staff data', async () => {
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.absenceReason.findMany.mockResolvedValue([
      { id: 'sick', name: 'Хвороба', excused: true },
    ]);
    mockRegister.childDays.mockResolvedValue([
      {
        childId: 'c1',
        days: [
          {
            date: day('2026-10-01'),
            title: null,
            hasGroup: true,
            working: true,
            state: 'absent',
            status: DailyStatus.absent,
            reasonId: 'sick',
            source: 'mark',
          },
          {
            date: day('2026-10-04'),
            title: null,
            hasGroup: true,
            working: false,
            state: 'non_working',
            status: null,
            reasonId: null,
            source: 'none',
          },
        ],
      },
    ]);
    const view = await service.month('p1', 'c1', '2026-10');
    expect(mockRegister.childDays).toHaveBeenCalledWith(
      ['c1'],
      day('2026-10-01'),
      day('2026-10-31'),
    );
    expect(view).toEqual({
      month: '2026-10',
      days: [
        {
          date: '2026-10-01',
          state: 'absent',
          status: DailyStatus.absent,
          reasonName: 'Хвороба',
          title: null,
        },
        {
          date: '2026-10-04',
          state: 'non_working',
          status: null,
          reasonName: null,
          title: null,
        },
      ],
      summary: {
        workingDays: 1,
        present: 0,
        absentExcused: 1,
        absentUnexcused: 0,
        expectedAbsent: 0,
        unmarked: 0,
      },
    });
  });
});
