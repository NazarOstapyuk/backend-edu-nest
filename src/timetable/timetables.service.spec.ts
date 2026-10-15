import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, PermissionLevel, Role, WeekParity } from '@prisma/client';
import { allPermissions } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from './schedule.service';
import { TimetablesService } from './timetables.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');
const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: allPermissions(PermissionLevel.edit),
};
const teacher = {
  id: 't1',
  role: Role.teacher,
  login: 't',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
};
const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
];
const cls = { id: 'g1', name: '1-А', periods };
const entryDto = { weekday: 1, period: 1, subjectId: 's1', teacherId: 't1' };

const mockPrisma = {
  timetable: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  timetableEntry: { deleteMany: jest.fn(), createMany: jest.fn() },
  subgroup: { count: jest.fn() },
  subgroupMember: { findMany: jest.fn() },
  subject: { count: jest.fn() },
  room: { count: jest.fn() },
  user: { count: jest.fn() },
  group: { findUnique: jest.fn() },
  schoolLesson: { findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
};
const mockSchedule = {
  requireClass: jest.fn(),
  build: jest.fn(),
  describe: jest.fn(),
  throwConflicts: jest.fn(),
};
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('TimetablesService', () => {
  let service: TimetablesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TimetablesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
      ],
    }).compile();
    service = moduleRef.get(TimetablesService);
    mockSchedule.requireClass.mockResolvedValue(cls);
    mockSchedule.throwConflicts.mockRejectedValue(
      new ConflictException('Schedule conflict'),
    );
    mockPrisma.subject.count.mockResolvedValue(1);
    mockPrisma.room.count.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.subgroup.count.mockResolvedValue(0);
    mockPrisma.subgroupMember.findMany.mockResolvedValue([]);
    mockPrisma.timetable.findMany.mockResolvedValue([]);
    mockPrisma.schoolLesson.count.mockResolvedValue(0);
    mockPrisma.timetable.create.mockResolvedValue({ id: 'v2', entries: [] });
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
  });

  it('closes the current version the day before the new one', async () => {
    mockPrisma.timetable.findMany
      .mockResolvedValueOnce([
        { id: 'v1', validFrom: day('2026-09-01'), validTo: null },
      ])
      .mockResolvedValueOnce([]);
    await service.create(
      'g1',
      { validFrom: '2026-11-02', entries: [entryDto] },
      admin,
    );
    expect(mockPrisma.timetable.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { validTo: day('2026-11-01') },
    });
    expect(
      firstArg<{ data: { validFrom: Date; entries: { create: object[] } } }>(
        mockPrisma.timetable.create,
      ).data,
    ).toMatchObject({
      groupId: 'g1',
      validFrom: day('2026-11-02'),
      createdById: 'a1',
      entries: {
        create: [
          {
            weekday: 1,
            period: 1,
            parity: WeekParity.every,
            subjectId: 's1',
            teacherId: 't1',
            roomId: null,
            subgroupId: null,
          },
        ],
      },
    });
  });

  it('rejects a version starting on or before an existing one', async () => {
    mockPrisma.timetable.findMany.mockResolvedValueOnce([
      { id: 'v1', validFrom: day('2026-11-02'), validTo: null },
    ]);
    await expect(
      service.create('g1', { validFrom: '2026-11-02', entries: [] }, admin),
    ).rejects.toThrow(new BadRequestException('Timetable periods overlap'));
  });

  it('rejects a new version when lessons are recorded on or after its start', async () => {
    mockPrisma.schoolLesson.count.mockResolvedValueOnce(1);
    await expect(
      service.create(
        'g1',
        { validFrom: '2026-11-02', entries: [entryDto] },
        admin,
      ),
    ).rejects.toThrow(new BadRequestException('Lesson already recorded'));
    expect(mockPrisma.schoolLesson.count).toHaveBeenCalledWith({
      where: { groupId: 'g1', date: { gte: day('2026-11-02') } },
    });
    expect(mockPrisma.timetable.create).not.toHaveBeenCalled();
  });

  it('validates periods, subgroups, subjects, rooms and teachers', async () => {
    await expect(
      service.create(
        'g1',
        { validFrom: '2026-11-02', entries: [{ ...entryDto, period: 7 }] },
        admin,
      ),
    ).rejects.toThrow(new BadRequestException('Bell period not found'));
    await expect(
      service.create(
        'g1',
        {
          validFrom: '2026-11-02',
          entries: [{ ...entryDto, subgroupId: 'sg9' }],
        },
        admin,
      ),
    ).rejects.toThrow(
      new BadRequestException('Subgroup does not belong to this class'),
    );
    mockPrisma.user.count.mockResolvedValue(0);
    await expect(
      service.create(
        'g1',
        { validFrom: '2026-11-02', entries: [entryDto] },
        admin,
      ),
    ).rejects.toThrow(new BadRequestException('User is not a teacher'));
  });

  it('checks conflicts against other classes in overlapping versions by real time', async () => {
    mockPrisma.timetable.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'o1',
          groupId: 'g2',
          validFrom: day('2026-09-01'),
          validTo: null,
          group: {
            name: '1-Б',
            bellSchedule: {
              periods: [{ number: 2, startTime: '08:50', endTime: '09:35' }],
            },
          },
          entries: [
            {
              id: 'oe1',
              weekday: 1,
              period: 2,
              parity: WeekParity.every,
              subjectId: 's2',
              teacherId: 't1',
              roomId: null,
              subgroupId: null,
            },
          ],
        },
      ]);
    await expect(
      service.create(
        'g1',
        { validFrom: '2026-11-02', entries: [entryDto] },
        admin,
      ),
    ).rejects.toThrow(ConflictException);
    const [conflicts, refs] = mockSchedule.throwConflicts.mock.calls[0] as [
      object[],
      Map<string, object>,
    ];
    expect(conflicts).toEqual([{ kind: 'teacher', a: 'new-0', b: 'oe1' }]);
    expect(refs.get('oe1')).toEqual({
      groupName: '1-Б',
      weekday: 1,
      date: null,
      period: 2,
      subjectId: 's2',
      isNew: false,
    });
    expect(mockPrisma.timetable.create).not.toHaveBeenCalled();
  });

  it('edits entries only before the version starts', async () => {
    mockPrisma.timetable.findUnique.mockResolvedValue({
      id: 'v2',
      groupId: 'g1',
      validFrom: day('2026-10-14'),
      validTo: null,
    });
    await expect(
      service.replaceEntries('v2', { entries: [] }, TODAY),
    ).rejects.toThrow(new BadRequestException('Timetable already started'));
    mockPrisma.timetable.findUnique
      .mockResolvedValueOnce({
        id: 'v2',
        groupId: 'g1',
        validFrom: day('2026-10-15'),
        validTo: null,
      })
      .mockResolvedValueOnce({ id: 'v2', entries: [] });
    await service.replaceEntries('v2', { entries: [entryDto] }, TODAY);
    expect(mockPrisma.timetableEntry.deleteMany).toHaveBeenCalledWith({
      where: { timetableId: 'v2' },
    });
  });

  it('lets a teacher view a class schedule only when involved', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      name: '1-А',
      kind: 'school_class',
      teachers: [],
    });
    mockSchedule.build.mockResolvedValue([
      {
        group: cls,
        days: [
          {
            date: day('2026-10-12'),
            working: true,
            title: null,
            slots: [
              {
                period: 1,
                startTime: '08:30',
                endTime: '09:15',
                subgroupId: null,
                subjectId: 's1',
                teacherId: 't9',
                roomId: null,
                source: 'timetable',
                cancelled: false,
                changeId: null,
              },
            ],
          },
        ],
      },
    ]);
    mockSchedule.describe.mockResolvedValue(() => ({
      subjectName: 'Математика',
      teacherName: 'X Y',
      roomName: null,
      subgroupName: null,
    }));
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
    await expect(
      service.view('g1', '2026-10-12', '2026-10-12', teacher),
    ).rejects.toThrow(new ForbiddenException('Not your group'));
    await expect(
      service.view('g1', '2026-10-12', '2026-11-30', admin),
    ).rejects.toThrow(new BadRequestException('Invalid period'));
    const view = await service.view('g1', '2026-10-12', '2026-10-12', admin);
    expect(view.days[0].slots[0]).toMatchObject({
      subjectName: 'Математика',
      lessonId: null,
    });
  });
});
