import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CalendarDayType,
  CalendarScope,
  GroupKind,
  LessonChangeType,
  WeekParity,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { ScheduleService } from './schedule.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const periods = [{ number: 1, startTime: '08:30', endTime: '09:15' }];
const entry = {
  id: 'e1',
  weekday: 1,
  period: 1,
  parity: WeekParity.every,
  subjectId: 's1',
  teacherId: 't1',
  roomId: null,
  subgroupId: null,
};

const mockPrisma = {
  group: { findMany: jest.fn(), findUnique: jest.fn() },
  subject: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  room: { findMany: jest.fn() },
  subgroup: { findMany: jest.fn() },
};
const mockCalendar = { entriesBetween: jest.fn() };

describe('ScheduleService', () => {
  let service: ScheduleService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScheduleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
      ],
    }).compile();
    service = moduleRef.get(ScheduleService);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockPrisma.group.findMany.mockResolvedValue([
      {
        id: 'g1',
        name: '1-А',
        kind: GroupKind.school_class,
        bellSchedule: { periods },
        timetables: [
          { validFrom: day('2026-09-01'), validTo: null, entries: [entry] },
        ],
        lessonChanges: [],
      },
    ]);
  });

  it('builds slots per day from the version, skipping weekends and holidays', async () => {
    mockCalendar.entriesBetween.mockResolvedValue([
      {
        startDate: day('2026-10-13'),
        endDate: day('2026-10-13'),
        type: CalendarDayType.non_working,
        scope: CalendarScope.school_class,
        groupId: null,
        title: 'Свято',
        voidedAt: null,
      },
    ]);
    const [schedule] = await service.build(
      day('2026-10-12'),
      day('2026-10-19'),
    );
    expect(
      schedule.days.map((d) => [
        d.date.toISOString().slice(0, 10),
        d.slots.length,
        d.title,
      ]),
    ).toEqual([
      ['2026-10-12', 1, null],
      ['2026-10-13', 0, 'Свято'],
      ['2026-10-14', 0, null],
      ['2026-10-15', 0, null],
      ['2026-10-16', 0, null],
      ['2026-10-17', 0, null],
      ['2026-10-18', 0, null],
      ['2026-10-19', 1, null],
    ]);
  });

  it('applies a pending change to its class only', async () => {
    const [schedule] = await service.build(
      day('2026-10-12'),
      day('2026-10-12'),
      ['g1'],
      {
        groupId: 'g1',
        change: {
          id: 'pending',
          date: day('2026-10-12'),
          period: 1,
          subgroupId: null,
          type: LessonChangeType.replace,
          subjectId: null,
          teacherId: 't2',
          roomId: null,
          voidedAt: null,
        },
      },
    );
    expect(schedule.days[0].slots[0]).toMatchObject({
      teacherId: 't2',
      changeId: 'pending',
      source: 'replace',
    });
  });

  it('requires a school class with a bell schedule', async () => {
    mockPrisma.group.findUnique.mockResolvedValueOnce(null);
    await expect(service.requireClass('g9')).rejects.toThrow(
      new NotFoundException('Group not found'),
    );
    mockPrisma.group.findUnique.mockResolvedValueOnce({
      id: 'g1',
      name: 'x',
      kind: GroupKind.kindergarten,
      bellSchedule: null,
    });
    await expect(service.requireClass('g1')).rejects.toThrow(
      new BadRequestException('Not a school class'),
    );
    mockPrisma.group.findUnique.mockResolvedValueOnce({
      id: 'g1',
      name: 'x',
      kind: GroupKind.school_class,
      bellSchedule: null,
    });
    await expect(service.requireClass('g1')).rejects.toThrow(
      new BadRequestException('Class has no bell schedule'),
    );
  });

  it('reports conflicts with the new item first and subject names', async () => {
    mockPrisma.subject.findMany.mockResolvedValue([
      { id: 's1', name: 'Математика' },
      { id: 's2', name: 'Читання' },
    ]);
    const refs = new Map([
      [
        'a',
        {
          groupName: '1-Б',
          weekday: 1,
          date: null,
          period: 2,
          subjectId: 's2',
          isNew: false,
        },
      ],
      [
        'b',
        {
          groupName: '1-А',
          weekday: 1,
          date: null,
          period: 1,
          subjectId: 's1',
          isNew: true,
        },
      ],
    ]);
    await expect(
      service.throwConflicts([{ kind: 'teacher', a: 'a', b: 'b' }], refs),
    ).rejects.toThrow(ConflictException);
    try {
      await service.throwConflicts([{ kind: 'teacher', a: 'a', b: 'b' }], refs);
    } catch (error) {
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        message: 'Schedule conflict',
        error: 'Conflict',
        conflicts: [
          {
            kind: 'teacher',
            weekday: 1,
            date: null,
            period: 1,
            groupName: '1-А',
            subjectName: 'Математика',
            other: { groupName: '1-Б', period: 2, subjectName: 'Читання' },
          },
        ],
      });
    }
  });
});
