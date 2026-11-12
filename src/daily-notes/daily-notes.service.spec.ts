import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  CalendarDayType,
  CalendarScope,
  DailyStatus,
  GroupKind,
  NoteQuestionType,
  NoticeStatus,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import { CalendarService } from '../attendance/calendar.service';
import { RegisterService } from '../attendance/register.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { DailyNotesService } from './daily-notes.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const NOW = new Date('2026-11-03T10:00:00.000Z');
const LATE = new Date('2026-11-03T16:00:00.000Z');

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  positionId: 'p1',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [],
  scopeInstitutionIds: null,
  permissions: { register: PermissionLevel.edit },
  ...over,
});

const manager = user();
const teacher = user({
  id: 't1',
  role: Role.teacher,
  login: 'teacher',
  permissions: {},
});
const viewer = user({
  id: 'v1',
  permissions: { register: PermissionLevel.view },
});

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'Сонечко',
  kind: GroupKind.kindergarten,
  institutionId: 'i1',
  teachers: [{ id: 't1' }],
  ...over,
});

const question = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  text: 'Обід',
  type: NoteQuestionType.choice,
  required: true,
  options: ['0%', '50%', '100%'],
  min: null,
  max: null,
  unit: null,
  sortOrder: 0,
  ...over,
});

const sleep = question({
  id: 'q2',
  text: 'Сон',
  type: NoteQuestionType.number,
  required: false,
  options: [],
  min: new Prisma.Decimal(0),
  max: new Prisma.Decimal(5),
  unit: 'год',
  sortOrder: 1,
});

const noteSet = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Щоденні нотатки',
  deadline: '17:00',
  questions: [question(), sleep],
  ...over,
});

const child = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  firstName: `Ім'я ${id}`,
  lastName: `Прізвище ${id}`,
  middleName: null,
  groupId: 'g1',
  dailyAttendances: [],
  absenceNotices: [],
  ...over,
});

const answer = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  childId: 'c1',
  groupId: 'g1',
  questionId: 'q1',
  date: d('2026-11-03'),
  questionText: 'Обід',
  questionType: NoteQuestionType.choice,
  unit: null,
  valueText: '50%',
  valueBool: null,
  valueNumber: null,
  createdAt: new Date('2026-11-03T09:00:00.000Z'),
  answeredBy: { id: 't1', firstName: 'Олена', lastName: 'Коваль' },
  ...over,
});

const mockPrisma = {
  group: { findUnique: jest.fn(), findMany: jest.fn() },
  noteSet: { findMany: jest.fn() },
  noteQuestion: { findMany: jest.fn() },
  child: { findMany: jest.fn(), findFirst: jest.fn() },
  noteAnswer: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockCalendar = { entriesBetween: jest.fn() };
const mockRegister = { getEditDays: jest.fn() };

const sqlOf = (call: number) =>
  (mockPrisma.$queryRaw.mock.calls[call] as [TemplateStringsArray])[0].join(
    '?',
  );

describe('DailyNotesService', () => {
  let service: DailyNotesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    mockPrisma.group.findUnique.mockResolvedValue(group());
    mockPrisma.group.findMany.mockResolvedValue([]);
    mockPrisma.noteSet.findMany.mockResolvedValue([noteSet()]);
    mockPrisma.noteQuestion.findMany.mockResolvedValue([
      { ...question(), setId: 's1' },
      { ...sleep, setId: 's1' },
    ]);
    mockPrisma.child.findMany.mockResolvedValue([child('c1'), child('c2')]);
    mockPrisma.noteAnswer.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('?').includes('"NoteSet"') ? [{ id: 's1' }] : [],
      ),
    );
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockRegister.getEditDays.mockResolvedValue(3);

    const moduleRef = await Test.createTestingModule({
      providers: [
        DailyNotesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
        { provide: RegisterService, useValue: mockRegister },
      ],
    }).compile();
    service = moduleRef.get(DailyNotesService);
  });

  describe('groups', () => {
    it('lists own groups with active sets for a teacher', async () => {
      mockPrisma.group.findMany.mockResolvedValue([
        {
          id: 'g1',
          name: 'Сонечко',
          kind: GroupKind.kindergarten,
          institution: { id: 'i1', name: 'Садок' },
        },
      ]);
      const result = await service.groups(teacher);
      expect(result).toEqual([
        {
          id: 'g1',
          name: 'Сонечко',
          kind: GroupKind.kindergarten,
          institution: { id: 'i1', name: 'Садок' },
        },
      ]);
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teachers: { some: { id: 't1' } },
            noteSets: { some: { active: true } },
          },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('lists groups in scope for register viewers', async () => {
      await service.groups(
        user({
          permissions: { register: PermissionLevel.view },
          scopeInstitutionIds: ['i1'],
        }),
      );
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            institutionId: { in: ['i1'] },
            noteSets: { some: { active: true } },
          },
        }),
      );
    });
  });

  describe('day', () => {
    it('marks an absent child as not expected', async () => {
      mockPrisma.child.findMany.mockResolvedValue([
        child('c1', {
          dailyAttendances: [
            {
              date: d('2026-11-03'),
              status: DailyStatus.absent,
              reasonId: null,
              voidedAt: null,
            },
          ],
        }),
        child('c2', {
          absenceNotices: [
            {
              startDate: d('2026-11-02'),
              endDate: d('2026-11-04'),
              reasonId: 'r1',
              status: NoticeStatus.approved,
            },
          ],
        }),
        child('c3'),
      ]);
      const view = await service.day('g1', '2026-11-03', teacher, NOW);
      expect(view.working).toBe(true);
      expect(view.canEdit).toBe(true);
      expect(view.needsReason).toBe(false);
      expect(
        view.children.map((c) => [c.child.id, c.absent, c.expected]),
      ).toEqual([
        ['c1', true, false],
        ['c2', true, false],
        ['c3', false, true],
      ]);
      expect(view.children[0].child).toEqual({
        id: 'c1',
        firstName: "Ім'я c1",
        lastName: 'Прізвище c1',
        middleName: null,
      });
    });

    it('builds sets, answers, completeness and overdue', async () => {
      mockPrisma.noteAnswer.findMany.mockResolvedValue([
        answer(),
        answer({
          id: 'a2',
          questionId: 'q2',
          questionText: 'Сон',
          questionType: NoteQuestionType.number,
          unit: 'год',
          valueText: null,
          valueNumber: new Prisma.Decimal('1.5'),
        }),
        answer({
          id: 'a3',
          childId: 'c2',
          questionId: 'old',
          questionText: 'Настрій',
          questionType: NoteQuestionType.yes_no,
          valueText: null,
          valueBool: true,
        }),
      ]);
      const view = await service.day('g1', '2026-11-03', manager, LATE);
      expect(view.sets).toEqual([
        {
          id: 's1',
          name: 'Щоденні нотатки',
          deadline: '17:00',
          overdue: true,
          questions: [
            {
              id: 'q1',
              text: 'Обід',
              type: NoteQuestionType.choice,
              required: true,
              options: ['0%', '50%', '100%'],
              min: null,
              max: null,
              unit: null,
            },
            {
              id: 'q2',
              text: 'Сон',
              type: NoteQuestionType.number,
              required: false,
              options: [],
              min: 0,
              max: 5,
              unit: 'год',
            },
          ],
        },
      ]);
      expect(view.children[0].complete).toBe(true);
      expect(view.children[0].answers).toEqual([
        {
          questionId: 'q1',
          questionText: 'Обід',
          questionType: NoteQuestionType.choice,
          unit: null,
          value: '50%',
          answeredBy: { id: 't1', firstName: 'Олена', lastName: 'Коваль' },
          createdAt: new Date('2026-11-03T09:00:00.000Z'),
        },
        expect.objectContaining({ questionId: 'q2', value: 1.5, unit: 'год' }),
      ]);
      expect(view.children[1].complete).toBe(false);
      expect(view.children[1].answers).toEqual([
        expect.objectContaining({ questionId: 'old', value: true }),
      ]);
    });

    it('returns a percent answer as a number', async () => {
      mockPrisma.noteAnswer.findMany.mockResolvedValue([
        answer({
          questionType: NoteQuestionType.percent,
          valueText: null,
          valueNumber: new Prisma.Decimal('50'),
        }),
      ]);
      const view = await service.day('g1', '2026-11-03', manager, LATE);
      expect(view.children[0].answers[0].value).toBe(50);
    });

    it('is not overdue before the Kyiv deadline', async () => {
      const view = await service.day(
        'g1',
        '2026-11-03',
        manager,
        new Date('2026-11-03T14:59:00.000Z'),
      );
      expect(view.sets[0].overdue).toBe(false);
    });

    it('drops sets without active questions', async () => {
      mockPrisma.noteSet.findMany.mockResolvedValue([
        noteSet({ questions: [] }),
      ]);
      const view = await service.day('g1', '2026-11-03', manager, NOW);
      expect(view.sets).toEqual([]);
      expect(view.children[0].complete).toBe(true);
    });

    it('expects nobody on a non-working day', async () => {
      mockCalendar.entriesBetween.mockResolvedValue([
        {
          startDate: d('2026-11-03'),
          endDate: d('2026-11-03'),
          type: CalendarDayType.non_working,
          scope: CalendarScope.all,
          groupId: null,
          institutionId: null,
          title: 'Свято',
          voidedAt: null,
        },
      ]);
      const view = await service.day('g1', '2026-11-03', manager, LATE);
      expect(view.working).toBe(false);
      expect(view.calendarTitle).toBe('Свято');
      expect(view.children.every((c) => !c.expected)).toBe(true);
      expect(view.sets[0].overdue).toBe(false);
      expect(view.canEdit).toBe(true);
    });

    it('lets a teacher edit only inside the window', async () => {
      const view = await service.day('g1', '2026-10-29', teacher, NOW);
      expect(view.canEdit).toBe(false);
      const managerView = await service.day('g1', '2026-10-29', manager, NOW);
      expect(managerView.canEdit).toBe(true);
      expect(managerView.needsReason).toBe(true);
    });

    it('does not let a viewer edit and forbids future days', async () => {
      const view = await service.day('g1', '2026-11-03', viewer, NOW);
      expect(view.canEdit).toBe(false);
      const future = await service.day('g1', '2026-11-04', manager, NOW);
      expect(future.canEdit).toBe(false);
    });

    it('lists only current members', async () => {
      await service.day('g1', '2026-11-03', manager, NOW);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { groupId: 'g1' } }),
      );
    });

    it('rejects foreign and unknown groups', async () => {
      await expect(
        service.day(
          'g1',
          '2026-11-03',
          user({ id: 'x', role: Role.teacher, permissions: {} }),
          NOW,
        ),
      ).rejects.toThrow(new ForbiddenException('Not your group'));
      await expect(
        service.day(
          'g1',
          '2026-11-03',
          user({ scopeInstitutionIds: ['i2'] }),
          NOW,
        ),
      ).rejects.toThrow(new NotFoundException('Group not found'));
      mockPrisma.group.findUnique.mockResolvedValue(null);
      await expect(
        service.day('g1', '2026-11-03', manager, NOW),
      ).rejects.toThrow(new NotFoundException('Group not found'));
    });
  });

  describe('save', () => {
    const dto = (
      answers: { childId: string; questionId: string; value: unknown }[],
      reason?: string,
    ) => ({ answers, reason });
    const save = (
      body: ReturnType<typeof dto>,
      actor: AuthenticatedUser,
      now: Date,
      date = '2026-11-03',
    ) => service.save('g1', date, body, actor, now);

    it('creates answers with snapshots after locking children and sets', async () => {
      await save(
        dto([
          { childId: 'c2', questionId: 'q1', value: '100%' },
          { childId: 'c1', questionId: 'q2', value: 2.5 },
        ]),
        teacher,
        NOW,
      );
      expect(sqlOf(0)).toContain('"Child"');
      expect(sqlOf(0)).toContain('ORDER BY id FOR UPDATE');
      expect(
        (mockPrisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
      ).toEqual([Prisma.join(['c1', 'c2'])]);
      expect(sqlOf(1)).toContain('"NoteSet"');
      expect(sqlOf(1)).toContain('FOR SHARE');
      expect(mockPrisma.noteQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { setId: { in: ['s1'] }, active: true },
        }),
      );
      expect(mockPrisma.noteAnswer.update).not.toHaveBeenCalled();
      expect(mockPrisma.noteAnswer.create).toHaveBeenCalledWith({
        data: {
          childId: 'c2',
          groupId: 'g1',
          questionId: 'q1',
          date: d('2026-11-03'),
          questionText: 'Обід',
          questionType: NoteQuestionType.choice,
          unit: null,
          valueText: '100%',
          valueBool: null,
          valueNumber: null,
          answeredById: 't1',
        },
      });
      expect(mockPrisma.noteAnswer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          childId: 'c1',
          questionId: 'q2',
          unit: 'год',
          valueNumber: '2.50',
        }) as object,
      });
    });

    it('rejects future days', async () => {
      await expect(
        save(
          dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
          manager,
          NOW,
          '2026-11-04',
        ),
      ).rejects.toThrow(new BadRequestException('Cannot fill future days'));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('forbids a teacher outside the window', async () => {
      await expect(
        save(
          dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
          teacher,
          NOW,
          '2026-10-29',
        ),
      ).rejects.toThrow(new ForbiddenException('Edit window has passed'));
    });

    it('requires a reason from a manager outside the window', async () => {
      await expect(
        save(
          dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
          manager,
          NOW,
          '2026-10-29',
        ),
      ).rejects.toThrow(new BadRequestException('Reason is required'));
      await save(
        dto([{ childId: 'c1', questionId: 'q1', value: '0%' }], ' Помилка '),
        manager,
        NOW,
        '2026-10-29',
      );
      expect(mockPrisma.noteAnswer.create).toHaveBeenCalled();
    });

    it('forbids a viewer who is not a teacher of the group', async () => {
      await expect(save(dto([]), viewer, NOW)).rejects.toThrow(
        new ForbiddenException('Not your group'),
      );
    });

    it('rejects a duplicate child and question', async () => {
      await expect(
        save(
          dto([
            { childId: 'c1', questionId: 'q1', value: '0%' },
            { childId: 'c1', questionId: 'q1', value: '50%' },
          ]),
          manager,
          NOW,
        ),
      ).rejects.toThrow(new BadRequestException('Duplicate answer'));
    });

    it('rejects a child of another group', async () => {
      mockPrisma.child.findMany.mockResolvedValue([
        child('c1'),
        child('c9', { groupId: 'g2' }),
      ]);
      await expect(
        save(
          dto([
            { childId: 'c1', questionId: 'q1', value: '0%' },
            { childId: 'c9', questionId: 'q1', value: '0%' },
          ]),
          manager,
          NOW,
        ),
      ).rejects.toThrow(new BadRequestException('Child is not in this group'));
      expect(mockPrisma.noteAnswer.create).not.toHaveBeenCalled();
    });

    it('rejects a question that is not active in the group', async () => {
      mockPrisma.noteQuestion.findMany.mockResolvedValue([
        { ...sleep, setId: 's1' },
      ]);
      await expect(
        save(
          dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
          manager,
          NOW,
        ),
      ).rejects.toThrow(
        new BadRequestException('Question is not in this group'),
      );
    });

    it('asks no questions when the group has no active sets', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await expect(
        save(
          dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
          manager,
          NOW,
        ),
      ).rejects.toThrow(
        new BadRequestException('Question is not in this group'),
      );
      expect(mockPrisma.noteQuestion.findMany).not.toHaveBeenCalled();
    });

    it('rejects an invalid value', async () => {
      for (const value of ['2,5', 'abc', 7]) {
        await expect(
          save(dto([{ childId: 'c1', questionId: 'q2', value }]), manager, NOW),
        ).rejects.toThrow(new BadRequestException('Invalid answer'));
      }
      await expect(
        save(
          dto([{ childId: 'c1', questionId: 'q1', value: 'Old label' }]),
          manager,
          NOW,
        ),
      ).rejects.toThrow(new BadRequestException('Invalid answer'));
    });

    it('voids a cleared answer without a new row', async () => {
      mockPrisma.noteAnswer.findMany.mockResolvedValueOnce([answer()]);
      await save(
        dto([{ childId: 'c1', questionId: 'q1', value: null }]),
        teacher,
        NOW,
      );
      expect(mockPrisma.noteAnswer.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 't1',
          voidReason: 'Cleared',
        },
      });
      expect(mockPrisma.noteAnswer.create).not.toHaveBeenCalled();
    });

    it('ignores a clear of a missing answer', async () => {
      await save(
        dto([{ childId: 'c1', questionId: 'q1', value: '  ' }]),
        teacher,
        NOW,
      );
      expect(mockPrisma.noteAnswer.update).not.toHaveBeenCalled();
      expect(mockPrisma.noteAnswer.create).not.toHaveBeenCalled();
    });

    it('creates nothing for an unchanged value', async () => {
      mockPrisma.noteAnswer.findMany.mockResolvedValueOnce([
        answer(),
        answer({
          id: 'a2',
          questionId: 'q2',
          questionType: NoteQuestionType.number,
          valueText: null,
          valueNumber: new Prisma.Decimal('2.5'),
        }),
      ]);
      await save(
        dto([
          { childId: 'c1', questionId: 'q1', value: '50%' },
          { childId: 'c1', questionId: 'q2', value: '2.50' },
        ]),
        teacher,
        NOW,
      );
      expect(mockPrisma.noteAnswer.update).not.toHaveBeenCalled();
      expect(mockPrisma.noteAnswer.create).not.toHaveBeenCalled();
    });

    it('does not void a percent answer saved with the same value', async () => {
      const percent = question({
        id: 'q3',
        type: NoteQuestionType.percent,
        options: ['0', '50', '100'],
      });
      mockPrisma.noteQuestion.findMany.mockResolvedValue([
        { ...percent, setId: 's1' },
      ]);
      mockPrisma.noteAnswer.findMany.mockResolvedValueOnce([
        answer({
          questionId: 'q3',
          questionType: NoteQuestionType.percent,
          valueText: null,
          valueNumber: new Prisma.Decimal('50'),
        }),
      ]);
      await save(
        dto([{ childId: 'c1', questionId: 'q3', value: 50 }]),
        teacher,
        NOW,
      );
      expect(mockPrisma.noteAnswer.update).not.toHaveBeenCalled();
      expect(mockPrisma.noteAnswer.create).not.toHaveBeenCalled();
    });

    it('voids a changed answer with the reason and creates the new one', async () => {
      mockPrisma.noteAnswer.findMany.mockResolvedValueOnce([answer()]);
      await save(
        dto([{ childId: 'c1', questionId: 'q1', value: '100%' }], 'Уточнення'),
        manager,
        NOW,
      );
      expect(mockPrisma.noteAnswer.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: expect.objectContaining({
          voidedById: 'u1',
          voidReason: 'Уточнення',
        }) as object,
      });
      expect(mockPrisma.noteAnswer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ valueText: '100%' }) as object,
      });
    });

    it('uses Corrected as the default void reason', async () => {
      mockPrisma.noteAnswer.findMany.mockResolvedValueOnce([answer()]);
      await save(
        dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
        teacher,
        NOW,
      );
      expect(mockPrisma.noteAnswer.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: expect.objectContaining({ voidReason: 'Corrected' }) as object,
      });
    });

    it('allows non-working days and skips the transaction without answers', async () => {
      mockCalendar.entriesBetween.mockResolvedValue([
        {
          startDate: d('2026-11-03'),
          endDate: d('2026-11-03'),
          type: CalendarDayType.non_working,
          scope: CalendarScope.all,
          groupId: null,
          institutionId: null,
          title: 'Свято',
          voidedAt: null,
        },
      ]);
      await save(
        dto([{ childId: 'c1', questionId: 'q1', value: '0%' }]),
        teacher,
        NOW,
      );
      expect(mockPrisma.noteAnswer.create).toHaveBeenCalled();
      jest.clearAllMocks();
      const view = await save(dto([]), teacher, NOW);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(view.date).toBe('2026-11-03');
    });
  });

  describe('pending', () => {
    const pendingGroup = (over: Record<string, unknown> = {}) => ({
      ...group(),
      teachers: [{ id: 't1' }],
      noteSets: [
        {
          deadline: '17:00',
          questions: [
            { id: 'q1', required: true },
            { id: 'q2', required: false },
          ],
        },
      ],
      children: [child('c1'), child('c2')],
      ...over,
    });

    it('counts expected children without a complete note', async () => {
      mockPrisma.group.findMany.mockResolvedValue([
        pendingGroup({
          children: [
            child('c1'),
            child('c2', {
              dailyAttendances: [
                {
                  date: d('2026-11-03'),
                  status: DailyStatus.absent,
                  reasonId: null,
                  voidedAt: null,
                },
              ],
            }),
            child('c3', {
              absenceNotices: [
                {
                  startDate: d('2026-11-03'),
                  endDate: d('2026-11-03'),
                  reasonId: 'r1',
                  status: NoticeStatus.approved,
                },
              ],
            }),
            child('c4'),
          ],
        }),
      ]);
      mockPrisma.noteAnswer.findMany.mockResolvedValue([
        { childId: 'c4', questionId: 'q1' },
      ]);
      const rows = await service.pending(teacher, NOW);
      expect(rows).toEqual([
        {
          group: { id: 'g1', name: 'Сонечко' },
          own: true,
          pending: 1,
          overdue: false,
        },
      ]);
      expect(mockPrisma.noteAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            childId: { in: ['c1', 'c4'] },
            date: d('2026-11-03'),
            voidedAt: null,
          },
        }),
      );
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teachers: { some: { id: 't1' } },
            noteSets: { some: { active: true } },
          },
        }),
      );
    });

    it('skips non-working days and complete groups, sorts overdue first', async () => {
      mockPrisma.group.findMany.mockResolvedValue([
        pendingGroup({ id: 'g1', name: 'Бджілка', teachers: [{ id: 'u1' }] }),
        pendingGroup({
          id: 'g2',
          name: 'Веселка',
          kind: GroupKind.school_class,
        }),
        pendingGroup({
          id: 'g3',
          name: 'Гномики',
          noteSets: [
            {
              deadline: '12:00',
              questions: [{ id: 'q1', required: true }],
            },
          ],
        }),
        pendingGroup({ id: 'g4', name: 'Дзвіночок', children: [child('c1')] }),
      ]);
      mockCalendar.entriesBetween.mockResolvedValue([
        {
          startDate: d('2026-11-03'),
          endDate: d('2026-11-03'),
          type: CalendarDayType.non_working,
          scope: CalendarScope.school_class,
          groupId: null,
          institutionId: null,
          title: 'Канікули',
          voidedAt: null,
        },
      ]);
      mockPrisma.noteAnswer.findMany.mockResolvedValue([
        { childId: 'c1', questionId: 'q1' },
      ]);
      const rows = await service.pending(
        manager,
        new Date('2026-11-03T11:00:00.000Z'),
      );
      expect(rows).toEqual([
        {
          group: { id: 'g3', name: 'Гномики' },
          own: false,
          pending: 1,
          overdue: true,
        },
        {
          group: { id: 'g1', name: 'Бджілка' },
          own: true,
          pending: 1,
          overdue: false,
        },
      ]);
    });

    it('returns nothing without groups', async () => {
      expect(await service.pending(manager, NOW)).toEqual([]);
      expect(mockPrisma.noteAnswer.findMany).not.toHaveBeenCalled();
    });
  });

  describe('parentNotes', () => {
    const parentAnswer = (over: Record<string, unknown> = {}) => ({
      date: d('2026-11-03'),
      questionText: 'Обід',
      questionType: NoteQuestionType.choice,
      unit: null,
      valueText: '50%',
      valueBool: null,
      valueNumber: null,
      question: { set: { id: 's1', name: 'Щоденні нотатки' } },
      ...over,
    });

    it('hides other children', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.parentNotes('p1', 'c1', undefined, undefined, NOW),
      ).rejects.toThrow(new NotFoundException('Child not found'));
      expect(mockPrisma.child.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', parents: { some: { id: 'p1' } } },
        select: { id: true },
      });
    });

    it('groups answers by day and set, only days with answers', async () => {
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.noteAnswer.findMany.mockResolvedValue([
        parentAnswer(),
        parentAnswer({
          questionText: 'Сон',
          questionType: NoteQuestionType.number,
          unit: 'год',
          valueText: null,
          valueNumber: new Prisma.Decimal('1.5'),
        }),
        parentAnswer({
          questionText: 'Прогулянка',
          questionType: NoteQuestionType.yes_no,
          valueText: null,
          valueBool: false,
          question: { set: { id: 's2', name: 'Прогулянка' } },
        }),
        parentAnswer({ date: d('2026-10-30'), valueText: '100%' }),
      ]);
      const result = await service.parentNotes(
        'p1',
        'c1',
        undefined,
        undefined,
        NOW,
      );
      expect(result).toEqual({
        days: [
          {
            date: '2026-11-03',
            sets: [
              {
                name: 'Щоденні нотатки',
                answers: [
                  {
                    question: 'Обід',
                    type: 'choice',
                    value: '50%',
                    unit: null,
                  },
                  { question: 'Сон', type: 'number', value: 1.5, unit: 'год' },
                ],
              },
              {
                name: 'Прогулянка',
                answers: [
                  {
                    question: 'Прогулянка',
                    type: 'yes_no',
                    value: false,
                    unit: null,
                  },
                ],
              },
            ],
          },
          {
            date: '2026-10-30',
            sets: [
              {
                name: 'Щоденні нотатки',
                answers: [
                  {
                    question: 'Обід',
                    type: 'choice',
                    value: '100%',
                    unit: null,
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(mockPrisma.noteAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            childId: 'c1',
            date: { gte: d('2026-10-28'), lte: d('2026-11-03') },
            voidedAt: null,
          },
        }),
      );
    });

    it('validates the period', async () => {
      await expect(
        service.parentNotes('p1', 'c1', '2026-11-03', '2026-11-01', NOW),
      ).rejects.toThrow(new BadRequestException('Invalid period'));
      await expect(
        service.parentNotes('p1', 'c1', '2026-08-01', '2026-11-01', NOW),
      ).rejects.toThrow(new BadRequestException('Period too long'));
    });
  });
});
