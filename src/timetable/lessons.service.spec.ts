import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  LessonStatus,
  NushLevel,
  PermissionLevel,
  Role,
} from '@prisma/client';
import { allPermissions } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterService } from '../attendance/register.service';
import { ScheduleService } from './schedule.service';
import { LessonsService } from './lessons.service';

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
  login: 't1',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
};
const substitute = {
  id: 't2',
  role: Role.teacher,
  login: 't2',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
};
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
const schedule = (slots: object[], date = day('2026-10-14')) => [
  {
    group: { id: 'g1', name: '1-А', periods: [] },
    days: [{ date, working: true, title: null, slots }],
  },
];
const kid = (id: string) => ({
  id,
  firstName: id,
  lastName: id,
  middleName: null,
});
const dayRow = (
  childId: string,
  state: string,
  reasonId: string | null = null,
) => ({ childId, days: [{ date: TODAY, state, reasonId }] });

const mockPrisma = {
  child: { findMany: jest.fn() },
  subgroupMember: { findMany: jest.fn() },
  schoolLesson: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  lessonMark: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  absenceReason: { count: jest.fn() },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockSchedule = { build: jest.fn(), describe: jest.fn() };
const mockRegister = { childDays: jest.fn(), getEditDays: jest.fn() };
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('LessonsService', () => {
  let service: LessonsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
        { provide: RegisterService, useValue: mockRegister },
      ],
    }).compile();
    service = moduleRef.get(LessonsService);
    mockSchedule.build.mockResolvedValue(schedule([slot()]));
    mockSchedule.describe.mockResolvedValue(() => ({
      subjectName: 'Математика',
      teacherName: 'Коваль Олена',
      roomName: null,
      subgroupName: null,
    }));
    mockPrisma.child.findMany.mockImplementation(
      (args: { where: { id?: object } }) =>
        Promise.resolve(
          args.where.id ? [kid('c1'), kid('c2')] : [{ id: 'c1' }, { id: 'c2' }],
        ),
    );
    mockPrisma.subgroupMember.findMany.mockResolvedValue([]);
    mockPrisma.schoolLesson.findUnique.mockResolvedValue(null);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
    mockPrisma.lessonMark.findMany.mockResolvedValue([]);
    mockPrisma.absenceReason.count.mockResolvedValue(1);
    mockRegister.childDays.mockResolvedValue([
      dayRow('c1', 'absent', 'sick'),
      dayRow('c2', 'present'),
    ]);
    mockRegister.getEditDays.mockResolvedValue(3);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'L1' }]);
  });

  it('lists my lessons including replacements and skipping cancelled ones', async () => {
    mockSchedule.build.mockResolvedValue([
      {
        group: { id: 'g1', name: '1-А', periods: [] },
        days: [
          {
            date: TODAY,
            working: true,
            title: null,
            slots: [slot(), slot({ period: 2, cancelled: true })],
          },
        ],
      },
      {
        group: { id: 'g2', name: '1-Б', periods: [] },
        days: [
          {
            date: TODAY,
            working: true,
            title: null,
            slots: [
              slot({ period: 3, teacherId: 't1', source: 'replace' }),
              slot({ period: 4, teacherId: 't9' }),
            ],
          },
        ],
      },
    ]);
    const view = await service.myLessons(teacher, '2026-10-14');
    expect(view.lessons.map((l) => [l.group.name, l.period, l.source])).toEqual(
      [
        ['1-А', 1, 'timetable'],
        ['1-Б', 3, 'replace'],
      ],
    );
  });

  it('lets only the effective teacher open a lesson', async () => {
    mockSchedule.build.mockResolvedValue(
      schedule([slot({ teacherId: 't2', source: 'replace' })]),
    );
    await expect(
      service.view('g1', '2026-10-14', 1, null, teacher, TODAY),
    ).rejects.toThrow(new ForbiddenException('Not your lesson'));
    await expect(
      service.view('g1', '2026-10-14', 1, null, substitute, TODAY),
    ).resolves.toBeDefined();
    await expect(
      service.view('g1', '2026-10-14', 2, null, admin, TODAY),
    ).rejects.toThrow(new NotFoundException('Lesson not found'));
  });

  it('lets a teacher with timetable edit open another teacher lesson', async () => {
    mockSchedule.build.mockResolvedValue(
      schedule([slot({ teacherId: 't2', source: 'replace' })]),
    );
    const manager = {
      ...teacher,
      id: 't3',
      permissions: { timetable: PermissionLevel.edit },
    };
    await expect(
      service.view('g1', '2026-10-14', 1, null, manager, TODAY),
    ).resolves.toBeDefined();
  });

  it('lets timetable view open but not save another teacher lesson', async () => {
    mockSchedule.build.mockResolvedValue(
      schedule([slot({ teacherId: 't2', source: 'replace' })]),
    );
    const viewer = {
      ...teacher,
      id: 't3',
      permissions: { timetable: PermissionLevel.view },
    };
    await expect(
      service.view('g1', '2026-10-14', 1, null, viewer, TODAY),
    ).resolves.toBeDefined();
    await expect(
      service.save('g1', '2026-10-14', 1, null, { marks: [] }, viewer, TODAY),
    ).rejects.toThrow(new ForbiddenException('Not your lesson'));
  });

  it('shows register absences on the lesson and lets a lesson mark win', async () => {
    mockPrisma.schoolLesson.findUnique.mockResolvedValue({
      id: 'L1',
      topic: 'Додавання',
      homework: null,
      marks: [
        {
          id: 'm1',
          childId: 'c2',
          status: LessonStatus.late,
          reasonId: null,
          level: NushLevel.with_help,
          comment: 'молодець',
          voidedAt: null,
        },
      ],
    });
    const view = await service.view(
      'g1',
      '2026-10-14',
      1,
      null,
      teacher,
      TODAY,
    );
    expect(view.lesson).toEqual({
      id: 'L1',
      topic: 'Додавання',
      homework: null,
    });
    expect(view.pupils[0]).toMatchObject({
      child: { id: 'c1' },
      state: {
        status: LessonStatus.absent,
        reasonId: 'sick',
        source: 'register',
      },
      mark: null,
    });
    expect(view.pupils[1]).toMatchObject({
      state: { status: LessonStatus.late, source: 'mark' },
      mark: { level: NushLevel.with_help, comment: 'молодець' },
    });
    expect(view).toMatchObject({ canEdit: true, needsReason: false });
  });

  it('uses subgroup members still in the class for a subgroup lesson', async () => {
    mockSchedule.build.mockResolvedValue(
      schedule([slot({ subgroupId: 'sg1' })]),
    );
    mockPrisma.subgroupMember.findMany.mockResolvedValue([{ childId: 'c2' }]);
    await service.view('g1', '2026-10-14', 1, 'sg1', teacher, TODAY);
    expect(
      firstArg<{ where: object }>(mockPrisma.subgroupMember.findMany).where,
    ).toEqual({ subgroupId: 'sg1', child: { groupId: 'g1' } });
    expect(mockRegister.childDays).toHaveBeenCalledWith(
      ['c2'],
      day('2026-10-14'),
      day('2026-10-14'),
    );
  });

  describe('save', () => {
    beforeEach(() => {
      jest
        .spyOn(service, 'view')
        .mockResolvedValue({} as Awaited<ReturnType<LessonsService['view']>>);
    });

    it('rejects future lessons, closed windows and missing reasons', async () => {
      mockSchedule.build.mockResolvedValue(
        schedule([slot()], day('2026-10-15')),
      );
      await expect(
        service.save(
          'g1',
          '2026-10-15',
          1,
          null,
          { marks: [] },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Cannot mark future days'));
      mockSchedule.build.mockResolvedValue(
        schedule([slot()], day('2026-10-09')),
      );
      await expect(
        service.save(
          'g1',
          '2026-10-09',
          1,
          null,
          { marks: [] },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(new ForbiddenException('Edit window has passed'));
      await expect(
        service.save('g1', '2026-10-09', 1, null, { marks: [] }, admin, TODAY),
      ).rejects.toThrow(new BadRequestException('Reason is required'));
    });

    it('validates marks', async () => {
      await expect(
        service.save(
          'g1',
          '2026-10-14',
          1,
          null,
          {
            marks: [
              { childId: 'c1', status: LessonStatus.present, reasonId: 'sick' },
            ],
          },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(
        new BadRequestException('Reason is only allowed for absences'),
      );
      await expect(
        service.save(
          'g1',
          '2026-10-14',
          1,
          null,
          {
            marks: [
              {
                childId: 'c1',
                status: LessonStatus.absent,
                level: NushLevel.independent,
              },
            ],
          },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(
        new BadRequestException('Level is only allowed for present students'),
      );
      await expect(
        service.save(
          'g1',
          '2026-10-14',
          1,
          null,
          { marks: [{ childId: 'c9', status: LessonStatus.present }] },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(
        new BadRequestException('Child is not in this subgroup'),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the lesson, locks pupils, skips unchanged marks and voids changed ones', async () => {
      mockPrisma.lessonMark.findMany.mockResolvedValue([
        {
          id: 'm1',
          childId: 'c1',
          status: LessonStatus.present,
          reasonId: null,
          level: null,
          comment: null,
          voidedAt: null,
        },
        {
          id: 'm2',
          childId: 'c2',
          status: LessonStatus.present,
          reasonId: null,
          level: null,
          comment: null,
          voidedAt: null,
        },
      ]);
      await service.save(
        'g1',
        '2026-10-14',
        1,
        null,
        {
          topic: ' Додавання ',
          marks: [
            { childId: 'c1', status: LessonStatus.present },
            {
              childId: 'c2',
              status: LessonStatus.present,
              level: NushLevel.independent,
              comment: ' добре ',
            },
          ],
        },
        teacher,
        TODAY,
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.schoolLesson.update).toHaveBeenCalledWith({
        where: { id: 'L1' },
        data: { topic: 'Додавання', homework: undefined },
      });
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        mockPrisma.lessonMark.findMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.lessonMark.update).toHaveBeenCalledTimes(1);
      expect(
        firstArg<{ where: { id: string }; data: { voidReason: string } }>(
          mockPrisma.lessonMark.update,
        ),
      ).toMatchObject({
        where: { id: 'm2' },
        data: { voidReason: 'Corrected' },
      });
      expect(
        firstArg<{ data: object }>(mockPrisma.lessonMark.create).data,
      ).toEqual({
        lessonId: 'L1',
        childId: 'c2',
        status: LessonStatus.present,
        reasonId: null,
        level: NushLevel.independent,
        comment: 'добре',
        markedById: 't1',
      });
    });
  });
});
