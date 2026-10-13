import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind, LessonStatus, NushLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterService } from '../attendance/register.service';
import { ScheduleService } from './schedule.service';
import { ParentTimetableService } from './parent-timetable.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const slot = (over: Record<string, unknown> = {}) => ({
  period: 1,
  startTime: '08:30',
  endTime: '09:15',
  subgroupId: null,
  subjectId: 's1',
  teacherId: 't1',
  roomId: null,
  source: 'timetable',
  cancelled: false,
  changeId: null,
  ...over,
});

const mockPrisma = {
  child: { findFirst: jest.fn(), findUnique: jest.fn() },
  schoolLesson: { findMany: jest.fn() },
  absenceReason: { findMany: jest.fn() },
  subject: { findMany: jest.fn() },
};
const mockSchedule = { build: jest.fn(), describe: jest.fn() };
const mockRegister = { childDays: jest.fn() };

describe('ParentTimetableService', () => {
  let service: ParentTimetableService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ParentTimetableService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
        { provide: RegisterService, useValue: mockRegister },
      ],
    }).compile();
    service = moduleRef.get(ParentTimetableService);
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.child.findUnique.mockResolvedValue({
      groupId: 'g1',
      group: { kind: GroupKind.school_class },
      subgroupMemberships: [{ subgroupId: 'sg1' }],
    });
    mockSchedule.describe.mockResolvedValue((s: { subjectId: string }) => ({
      subjectName: s.subjectId,
      teacherName: 'Коваль Олена',
      roomName: null,
      subgroupName: null,
    }));
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
  });

  it('hides a foreign child', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(
      service.schedule('p1', 'c9', '2026-10-12', '2026-10-18'),
    ).rejects.toThrow(new NotFoundException('Child not found'));
    await expect(service.lessons('p1', 'c9', '2026-10')).rejects.toThrow(
      new NotFoundException('Child not found'),
    );
  });

  it('shows only the whole class and own subgroups with homework', async () => {
    mockSchedule.build.mockResolvedValue([
      {
        group: { id: 'g1', name: '1-А', periods: [] },
        days: [
          {
            date: day('2026-10-12'),
            working: true,
            title: null,
            slots: [
              slot(),
              slot({ period: 2, subgroupId: 'sg1', subjectId: 'eng' }),
              slot({ period: 2, subgroupId: 'sg2', subjectId: 'eng2' }),
              slot({ period: 3, cancelled: true }),
            ],
          },
        ],
      },
    ]);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([
      {
        date: day('2026-10-12'),
        period: 1,
        subgroupKey: 'class',
        topic: 'Додавання',
        homework: 'с. 12',
      },
    ]);
    const view = await service.schedule('p1', 'c1', '2026-10-12', '2026-10-12');
    expect(
      view.days[0].slots.map((s) => [
        s.period,
        s.subjectName,
        s.cancelled,
        s.homework,
      ]),
    ).toEqual([
      [1, 's1', false, 'с. 12'],
      [2, 'eng', false, null],
      [3, 's1', true, null],
    ]);
  });

  it('returns an empty schedule for a kindergarten child', async () => {
    mockPrisma.child.findUnique.mockResolvedValue({
      groupId: 'g5',
      group: { kind: GroupKind.kindergarten },
      subgroupMemberships: [],
    });
    await expect(
      service.schedule('p1', 'c1', '2026-10-12', '2026-10-18'),
    ).resolves.toEqual({ days: [] });
  });

  it('lists lesson attendance up to today with register absences and levels by subject', async () => {
    mockSchedule.build.mockResolvedValue([
      {
        group: { id: 'g1', name: '1-А', periods: [] },
        days: [
          {
            date: day('2026-10-12'),
            working: true,
            title: null,
            slots: [slot(), slot({ period: 2, subjectId: 's2' })],
          },
          {
            date: day('2026-10-13'),
            working: true,
            title: null,
            slots: [slot()],
          },
        ],
      },
    ]);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([
      {
        date: day('2026-10-12'),
        period: 1,
        subgroupKey: 'class',
        subjectId: 's1',
        marks: [
          {
            status: LessonStatus.present,
            reasonId: null,
            level: NushLevel.independent,
            comment: 'молодець',
            voidedAt: null,
          },
        ],
      },
    ]);
    mockRegister.childDays.mockResolvedValue([
      {
        childId: 'c1',
        days: [
          { date: day('2026-10-12'), state: 'present', reasonId: null },
          { date: day('2026-10-13'), state: 'absent', reasonId: 'sick' },
        ],
      },
    ]);
    mockPrisma.absenceReason.findMany.mockResolvedValue([
      { id: 'sick', name: 'Хвороба', excused: true },
    ]);
    mockPrisma.subject.findMany.mockResolvedValue([
      { id: 's1', name: 'Математика' },
      { id: 's2', name: 'Читання' },
    ]);
    const view = await service.lessons(
      'p1',
      'c1',
      '2026-10',
      day('2026-10-13'),
    );
    expect(mockSchedule.build).toHaveBeenCalledWith(
      day('2026-10-01'),
      day('2026-10-13'),
      ['g1'],
    );
    expect(view.lessons).toEqual([
      {
        date: '2026-10-12',
        period: 1,
        subjectName: 'Математика',
        status: LessonStatus.present,
        reasonName: null,
        level: NushLevel.independent,
        comment: 'молодець',
        source: 'mark',
      },
      {
        date: '2026-10-13',
        period: 1,
        subjectName: 'Математика',
        status: LessonStatus.absent,
        reasonName: 'Хвороба',
        level: null,
        comment: null,
        source: 'register',
      },
    ]);
    expect(view.summary).toEqual({
      missed: 1,
      missedExcused: 1,
      bySubject: [
        {
          subjectName: 'Математика',
          levels: {
            needs_support: 0,
            progressing: 0,
            with_help: 0,
            independent: 1,
          },
        },
      ],
    });
  });
});
