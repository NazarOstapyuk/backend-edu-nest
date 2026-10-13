import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LessonChangeType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from './schedule.service';
import { LessonChangesService } from './lesson-changes.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
};
const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
];
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
const schedule = (groupId: string, slots: object[], working = true) => ({
  group: { id: groupId, name: groupId, periods },
  days: [{ date: day('2026-10-12'), working, title: null, slots }],
});
const base = { date: '2026-10-12', period: 1, reason: 'хворіє' };

const mockPrisma = {
  subject: { count: jest.fn() },
  room: { count: jest.fn() },
  user: { count: jest.fn() },
  subgroup: { count: jest.fn() },
  subgroupMember: { findMany: jest.fn() },
  schoolLesson: { findUnique: jest.fn() },
  lessonChange: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
};
const mockSchedule = {
  requireClass: jest.fn(),
  build: jest.fn(),
  throwConflicts: jest.fn(),
};
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('LessonChangesService', () => {
  let service: LessonChangesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonChangesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
      ],
    }).compile();
    service = moduleRef.get(LessonChangesService);
    mockSchedule.requireClass.mockResolvedValue({
      id: 'g1',
      name: '1-А',
      periods,
    });
    mockSchedule.build.mockResolvedValue([schedule('g1', [slot()])]);
    mockSchedule.throwConflicts.mockRejectedValue(
      new ConflictException('Schedule conflict'),
    );
    mockPrisma.subject.count.mockResolvedValue(1);
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.room.count.mockResolvedValue(1);
    mockPrisma.subgroupMember.findMany.mockResolvedValue([]);
    mockPrisma.schoolLesson.findUnique.mockResolvedValue(null);
    mockPrisma.lessonChange.create.mockResolvedValue({
      id: 'ch1',
      date: day('2026-10-12'),
    });
  });

  it('cancels an existing lesson that is not recorded', async () => {
    await service.create(
      'g1',
      { ...base, type: LessonChangeType.cancel },
      admin,
    );
    expect(
      firstArg<{ data: object }>(mockPrisma.lessonChange.create).data,
    ).toMatchObject({
      groupId: 'g1',
      date: day('2026-10-12'),
      period: 1,
      type: LessonChangeType.cancel,
      createdById: 'a1',
      reason: 'хворіє',
    });
  });

  it('rejects cancelling a recorded lesson and missing lessons', async () => {
    mockPrisma.schoolLesson.findUnique.mockResolvedValueOnce({ id: 'l1' });
    await expect(
      service.create('g1', { ...base, type: LessonChangeType.cancel }, admin),
    ).rejects.toThrow(new BadRequestException('Lesson already recorded'));
    await expect(
      service.create(
        'g1',
        { ...base, period: 2, type: LessonChangeType.cancel },
        admin,
      ),
    ).rejects.toThrow(new NotFoundException('Lesson not found'));
  });

  it('validates replace and extra payloads and non-working days', async () => {
    await expect(
      service.create('g1', { ...base, type: LessonChangeType.replace }, admin),
    ).rejects.toThrow(new BadRequestException('Nothing to replace'));
    await expect(
      service.create(
        'g1',
        {
          ...base,
          period: 2,
          type: LessonChangeType.extra,
          subjectId: 's1',
        },
        admin,
      ),
    ).rejects.toThrow(
      new BadRequestException('Subject and teacher are required'),
    );
    mockSchedule.build.mockResolvedValue([schedule('g1', [], false)]);
    await expect(
      service.create('g1', { ...base, type: LessonChangeType.cancel }, admin),
    ).rejects.toThrow(new BadRequestException('Not a working day'));
  });

  it('rejects a replacement teacher busy in another class at that time', async () => {
    mockSchedule.build.mockResolvedValue([
      schedule('g1', [
        slot({ teacherId: 't2', source: 'replace', changeId: 'pending' }),
      ]),
      schedule('g2', [
        slot({
          startTime: '09:00',
          endTime: '09:45',
          teacherId: 't2',
          period: 2,
        }),
      ]),
    ]);
    await expect(
      service.create(
        'g1',
        { ...base, type: LessonChangeType.replace, teacherId: 't2' },
        admin,
      ),
    ).rejects.toThrow(ConflictException);
    const pending = (mockSchedule.build.mock.calls[1] as unknown[])[3] as {
      groupId: string;
      change: { id: string };
    };
    expect(pending).toMatchObject({
      groupId: 'g1',
      change: {
        id: 'pending',
        type: LessonChangeType.replace,
        teacherId: 't2',
      },
    });
    expect(mockPrisma.lessonChange.create).not.toHaveBeenCalled();
  });

  it('voids a change once', async () => {
    mockPrisma.lessonChange.findUnique.mockResolvedValueOnce(null);
    await expect(service.void('c9', 'x', admin)).rejects.toThrow(
      new NotFoundException('Lesson change not found'),
    );
    mockPrisma.lessonChange.findUnique.mockResolvedValueOnce({
      id: 'c1',
      voidedAt: new Date(),
    });
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(
      new BadRequestException('Lesson change is voided'),
    );
  });

  const stored = (type: LessonChangeType) => ({
    id: 'c1',
    groupId: 'g1',
    date: day('2026-10-12'),
    period: 1,
    subgroupId: null,
    type,
    voidedAt: null,
  });

  it('rejects voiding a replace or extra change with a recorded lesson', async () => {
    mockPrisma.lessonChange.findUnique.mockResolvedValue(
      stored(LessonChangeType.replace),
    );
    mockPrisma.schoolLesson.findUnique.mockResolvedValueOnce({ id: 'l1' });
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(
      new BadRequestException('Lesson already recorded'),
    );
    mockPrisma.lessonChange.findUnique.mockResolvedValue(
      stored(LessonChangeType.extra),
    );
    mockPrisma.schoolLesson.findUnique.mockResolvedValueOnce({ id: 'l1' });
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(
      new BadRequestException('Lesson already recorded'),
    );
    expect(mockPrisma.lessonChange.update).not.toHaveBeenCalled();
  });

  it('rejects voiding a cancel that would double-book a teacher', async () => {
    mockPrisma.lessonChange.findUnique.mockResolvedValue(
      stored(LessonChangeType.cancel),
    );
    mockSchedule.build.mockResolvedValue([
      schedule('g1', [slot({ teacherId: 't2' })]),
      schedule('g2', [slot({ teacherId: 't2' })]),
    ]);
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(
      ConflictException,
    );
    expect(mockSchedule.build).toHaveBeenCalledWith(
      day('2026-10-12'),
      day('2026-10-12'),
      undefined,
      undefined,
      'c1',
    );
    expect(mockPrisma.lessonChange.update).not.toHaveBeenCalled();
  });

  it('voids a harmless cancel and an extra without checks', async () => {
    mockPrisma.lessonChange.update.mockResolvedValue({
      id: 'c1',
      date: day('2026-10-12'),
    });
    mockPrisma.lessonChange.findUnique.mockResolvedValue(
      stored(LessonChangeType.cancel),
    );
    mockSchedule.build.mockResolvedValue([
      schedule('g1', [slot()]),
      schedule('g2', [slot({ teacherId: 't2' })]),
    ]);
    await expect(service.void('c1', 'x', admin)).resolves.toMatchObject({
      id: 'c1',
    });
    mockSchedule.build.mockClear();
    mockPrisma.lessonChange.findUnique.mockResolvedValue(
      stored(LessonChangeType.extra),
    );
    await service.void('c1', 'x', admin);
    expect(mockSchedule.build).not.toHaveBeenCalled();
    expect(mockPrisma.lessonChange.update).toHaveBeenCalledTimes(2);
  });
});
