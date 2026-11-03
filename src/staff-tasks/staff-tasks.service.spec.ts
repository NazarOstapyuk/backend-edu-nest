import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, PermissionLevel, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { StaffTasksService } from './staff-tasks.service';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const DUE = new Date('2026-11-03T12:00:00.000Z');
const PAST = new Date('2026-11-02T12:00:00.000Z');

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  positionId: 'p1',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [],
  scopeInstitutionIds: null,
  permissions: { users: PermissionLevel.edit },
  ...over,
});

const admin = user();
const root = user({
  id: 'r1',
  role: Role.root,
  login: 'root',
  positionId: null,
});
const teacher = user({
  id: 't1',
  role: Role.teacher,
  login: 'teacher',
  permissions: {},
});
const parent = user({
  id: 'pa1',
  role: Role.parent,
  login: 'parent',
  positionId: null,
  permissions: {},
});

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  firstName: `Ім'я ${id}`,
  lastName: `Прізвище ${id}`,
  middleName: null,
  role: Role.teacher,
  isActive: true,
  accessScope: AccessScope.all,
  institutions: [] as { institutionId: string }[],
  ...over,
});

const row = (userId: string, over: Record<string, unknown> = {}) => ({
  id: `row-${userId}`,
  taskId: 'task1',
  userId,
  doneAt: null as Date | null,
  removedAt: null as Date | null,
  user: person(userId),
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: 'task1',
  title: 'Здати плани',
  description: null as string | null,
  dueAt: DUE,
  createdById: 'a1',
  cancelledAt: null as Date | null,
  cancelledById: null as string | null,
  createdBy: { id: 'a1', firstName: 'Ольга', lastName: 'Адмін' },
  assignees: [row('t1'), row('t2')],
  ...over,
});

const createDto = {
  title: '  Здати плани  ',
  description: '',
  dueDate: '2026-11-03',
  dueTime: '14:00',
  assigneeIds: ['t1', 't2'],
};

const mockPrisma = {
  user: { findMany: jest.fn() },
  staffTask: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  staffTaskAssignee: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    createMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const sqlOf = (call: number) =>
  (mockPrisma.$queryRaw.mock.calls[call] as [TemplateStringsArray])[0].join(
    '?',
  );

describe('StaffTasksService', () => {
  let service: StaffTasksService;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([person('t1'), person('t2')]);
    mockPrisma.staffTask.create.mockResolvedValue(task());
    mockPrisma.staffTask.findUnique.mockResolvedValue(task());
    mockPrisma.staffTask.findMany.mockResolvedValue([]);
    mockPrisma.staffTask.count.mockResolvedValue(0);
    mockPrisma.staffTaskAssignee.findMany.mockResolvedValue([]);
    mockPrisma.staffTaskAssignee.count.mockResolvedValue(0);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StaffTasksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(StaffTasksService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('access', () => {
    it('rejects parents on every route', async () => {
      const calls = [
        () => service.assignable(parent),
        () => service.create(createDto, parent),
        () => service.update('task1', { title: 'x' }, parent),
        () => service.cancel('task1', parent),
        () => service.given({}, parent),
        () => service.mine({}, parent),
        () => service.done('task1', parent),
        () => service.undone('task1', parent),
        () => service.summary(parent),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toThrow(
          new ForbiddenException('Insufficient permissions'),
        );
      }
    });

    it('rejects teachers creating, listing given or assignable', async () => {
      await expect(service.create(createDto, teacher)).rejects.toThrow(
        new ForbiddenException('Insufficient permissions'),
      );
      await expect(service.given({}, teacher)).rejects.toThrow(
        new ForbiddenException('Insufficient permissions'),
      );
      await expect(service.assignable(teacher)).rejects.toThrow(
        new ForbiddenException('Insufficient permissions'),
      );
      expect(mockPrisma.staffTask.create).not.toHaveBeenCalled();
    });
  });

  describe('assignable', () => {
    it('offers a scoped admin only teachers of the granted institutions', async () => {
      const scoped = user({
        accessScope: AccessScope.institutions,
        institutionIds: ['i1'],
        scopeInstitutionIds: ['i1'],
      });
      mockPrisma.user.findMany.mockResolvedValue([
        person('t1', {
          accessScope: AccessScope.institutions,
          institutions: [{ institutionId: 'i1' }],
        }),
        person('t2'),
      ]);
      const result = await service.assignable(scoped);
      expect(result).toEqual([
        {
          id: 't1',
          firstName: "Ім'я t1",
          lastName: 'Прізвище t1',
          middleName: null,
          role: Role.teacher,
        },
      ]);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            role: { in: [Role.teacher] },
            accessScope: AccessScope.institutions,
            institutions: { some: { institutionId: { in: ['i1'] } } },
          },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
      );
    });

    it('offers root admins and teachers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        person('a2', { role: Role.admin }),
        person('t1'),
      ]);
      const result = await service.assignable(root);
      expect(result.map((r) => r.id)).toEqual(['a2', 't1']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, role: { in: [Role.admin, Role.teacher] } },
        }),
      );
    });
  });

  describe('create', () => {
    it('creates with the Kyiv deadline and returns the given view', async () => {
      const result = await service.create(createDto, admin);
      expect(mockPrisma.staffTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            title: 'Здати плани',
            description: null,
            dueAt: new Date('2026-11-03T12:00:00.000Z'),
            createdById: 'a1',
            assignees: {
              createMany: { data: [{ userId: 't1' }, { userId: 't2' }] },
            },
          },
        }),
      );
      expect(result).toEqual({
        id: 'task1',
        title: 'Здати плани',
        description: null,
        dueAt: '2026-11-03T12:00:00.000Z',
        dueDate: '2026-11-03',
        dueTime: '14:00',
        cancelledAt: null,
        author: { id: 'a1', firstName: 'Ольга', lastName: 'Адмін' },
        overdue: false,
        done: 0,
        total: 2,
        assignees: [
          {
            id: 't1',
            firstName: "Ім'я t1",
            lastName: 'Прізвище t1',
            middleName: null,
            role: Role.teacher,
            isActive: true,
            doneAt: null,
          },
          {
            id: 't2',
            firstName: "Ім'я t2",
            lastName: 'Прізвище t2',
            middleName: null,
            role: Role.teacher,
            isActive: true,
            doneAt: null,
          },
        ],
      });
    });

    it('rejects an admin assigning another admin', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        person('a2', { role: Role.admin }),
      ]);
      await expect(
        service.create({ ...createDto, assigneeIds: ['a2'] }, admin),
      ).rejects.toThrow(new ForbiddenException('Cannot assign this user'));
    });

    it('rejects a scoped admin assigning a teacher with scope all', async () => {
      const scoped = user({
        accessScope: AccessScope.institutions,
        institutionIds: ['i1'],
      });
      mockPrisma.user.findMany.mockResolvedValue([person('t1')]);
      await expect(
        service.create({ ...createDto, assigneeIds: ['t1'] }, scoped),
      ).rejects.toThrow(new ForbiddenException('Cannot assign this user'));
    });

    it('rejects an unknown or inactive user', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        person('t1', { isActive: false }),
      ]);
      await expect(service.create(createDto, admin)).rejects.toThrow(
        new ForbiddenException('Cannot assign this user'),
      );
    });

    it('rejects a deadline in the past', async () => {
      await expect(
        service.create({ ...createDto, dueTime: '11:59' }, admin),
      ).rejects.toThrow(new BadRequestException('Deadline is in the past'));
    });

    it('rejects invalid input', async () => {
      await expect(
        service.create({ ...createDto, dueTime: '25:00' }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid deadline'));
      await expect(
        service.create({ ...createDto, dueDate: '2026-02-30' }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid deadline'));
      await expect(
        service.create({ ...createDto, title: '   ' }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid title'));
      await expect(
        service.create({ ...createDto, description: 'x'.repeat(2001) }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid description'));
      await expect(
        service.create({ ...createDto, assigneeIds: ['t1', 't1'] }, admin),
      ).rejects.toThrow(new BadRequestException('Duplicate assignee'));
    });
  });

  describe('update', () => {
    it('hides tasks of others from a non-author admin', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(
        task({ createdById: 'a9' }),
      );
      await expect(
        service.update('task1', { title: 'Нове' }, admin),
      ).rejects.toThrow(new NotFoundException('Task not found'));
    });

    it('answers 404 for a missing task', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(null);
      await expect(
        service.update('task1', { title: 'Нове' }, admin),
      ).rejects.toThrow(new NotFoundException('Task not found'));
    });

    it('forbids root editing a task of another author', async () => {
      await expect(
        service.update('task1', { title: 'Нове' }, root),
      ).rejects.toThrow(new ForbiddenException('Not your task'));
    });

    it('rejects editing a cancelled task', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(
        task({ cancelledAt: PAST }),
      );
      await expect(
        service.update('task1', { title: 'Нове' }, admin),
      ).rejects.toThrow(new BadRequestException('Task is cancelled'));
    });

    it('locks the task row and updates fields', async () => {
      await service.update(
        'task1',
        { title: ' Нове ', description: ' опис ' },
        admin,
      );
      expect(sqlOf(0)).toContain('"StaffTask"');
      expect(sqlOf(0)).toContain('FOR UPDATE');
      expect(mockPrisma.staffTask.update).toHaveBeenCalledWith({
        where: { id: 'task1' },
        data: { title: 'Нове', description: 'опис' },
      });
    });

    it('needs date and time together', async () => {
      await expect(
        service.update('task1', { dueDate: '2026-11-04' }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid deadline'));
    });

    it('rejects null title, date and time', async () => {
      await expect(
        service.update('task1', { title: null }, admin),
      ).rejects.toThrow(new BadRequestException('Invalid title'));
      for (const dto of [
        { dueDate: null, dueTime: null },
        { dueDate: '2026-11-04', dueTime: null },
        { dueDate: null, dueTime: '14:00' },
        { dueDate: null },
      ]) {
        await expect(service.update('task1', dto, admin)).rejects.toThrow(
          new BadRequestException('Invalid deadline'),
        );
      }
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('clears the description with null', async () => {
      await service.update('task1', { description: null }, admin);
      expect(mockPrisma.staffTask.update).toHaveBeenCalledWith({
        where: { id: 'task1' },
        data: { description: null },
      });
    });

    it('rejects moving the deadline into the past', async () => {
      await expect(
        service.update(
          'task1',
          { dueDate: '2026-11-03', dueTime: '09:00' },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Deadline is in the past'));
    });

    it('allows an unchanged past deadline', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(task({ dueAt: PAST }));
      await service.update(
        'task1',
        { dueDate: '2026-11-02', dueTime: '14:00' },
        admin,
      );
      expect(mockPrisma.staffTask.update).toHaveBeenCalledWith({
        where: { id: 'task1' },
        data: { dueAt: PAST },
      });
    });

    it('replaces assignees: removes missing, re-adds removed, creates new', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(
        task({
          assignees: [
            row('t1', { doneAt: PAST }),
            row('t2'),
            row('t3', { removedAt: PAST, doneAt: PAST }),
          ],
        }),
      );
      mockPrisma.user.findMany.mockResolvedValue([person('t3'), person('t4')]);
      await service.update('task1', { assigneeIds: ['t1', 't3', 't4'] }, admin);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['t3', 't4'] } } }),
      );
      expect(mockPrisma.staffTaskAssignee.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['row-t2'] } },
        data: { removedAt: NOW },
      });
      expect(mockPrisma.staffTaskAssignee.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['row-t3'] } },
        data: { removedAt: null, doneAt: null },
      });
      expect(mockPrisma.staffTaskAssignee.createMany).toHaveBeenCalledWith({
        data: [{ taskId: 'task1', userId: 't4' }],
      });
    });

    it('rejects adding a user that cannot be assigned', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        person('a2', { role: Role.admin }),
      ]);
      await expect(
        service.update('task1', { assigneeIds: ['t1', 'a2'] }, admin),
      ).rejects.toThrow(new ForbiddenException('Cannot assign this user'));
    });
  });

  describe('cancel', () => {
    it('lets root cancel a task of an admin', async () => {
      await service.cancel('task1', root);
      expect(sqlOf(0)).toContain('FOR UPDATE');
      expect(mockPrisma.staffTask.update).toHaveBeenCalledWith({
        where: { id: 'task1' },
        data: { cancelledAt: NOW, cancelledById: 'r1' },
      });
    });

    it('hides the task from a non-author admin', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(
        task({ createdById: 'a9' }),
      );
      await expect(service.cancel('task1', admin)).rejects.toThrow(
        new NotFoundException('Task not found'),
      );
    });

    it('rejects cancelling twice', async () => {
      mockPrisma.staffTask.findUnique.mockResolvedValue(
        task({ cancelledAt: PAST }),
      );
      await expect(service.cancel('task1', admin)).rejects.toThrow(
        new BadRequestException('Task is cancelled'),
      );
    });
  });

  describe('done / undone', () => {
    const myRow = (over: Record<string, unknown> = {}) => ({
      ...row('t1'),
      task: task(),
      ...over,
    });

    it('answers 404 for a non-assignee', async () => {
      mockPrisma.staffTaskAssignee.findUnique.mockResolvedValue(null);
      await expect(service.done('task1', teacher)).rejects.toThrow(
        new NotFoundException('Task not found'),
      );
    });

    it('answers 404 for a removed row', async () => {
      mockPrisma.staffTaskAssignee.findUnique.mockResolvedValue(
        myRow({ removedAt: PAST }),
      );
      await expect(service.done('task1', teacher)).rejects.toThrow(
        new NotFoundException('Task not found'),
      );
    });

    it('rejects a cancelled task', async () => {
      mockPrisma.staffTaskAssignee.findUnique.mockResolvedValue(
        myRow({ task: task({ cancelledAt: PAST }) }),
      );
      await expect(service.done('task1', teacher)).rejects.toThrow(
        new BadRequestException('Task is cancelled'),
      );
    });

    it('marks done under a share lock and returns my view', async () => {
      mockPrisma.staffTaskAssignee.findUnique.mockResolvedValue(myRow());
      const result = await service.done('task1', teacher);
      expect(sqlOf(0)).toContain('FOR SHARE');
      expect(mockPrisma.staffTaskAssignee.update).toHaveBeenCalledWith({
        where: { id: 'row-t1' },
        data: { doneAt: NOW },
      });
      expect(result).toEqual({
        id: 'task1',
        title: 'Здати плани',
        description: null,
        dueAt: '2026-11-03T12:00:00.000Z',
        dueDate: '2026-11-03',
        dueTime: '14:00',
        author: { id: 'a1', firstName: 'Ольга', lastName: 'Адмін' },
        status: 'done',
        doneAt: NOW.toISOString(),
      });
      expect(result).not.toHaveProperty('assignees');
    });

    it('leaves a done row unchanged', async () => {
      mockPrisma.staffTaskAssignee.findUnique.mockResolvedValue(
        myRow({ doneAt: PAST }),
      );
      const result = await service.done('task1', teacher);
      expect(mockPrisma.staffTaskAssignee.update).not.toHaveBeenCalled();
      expect(result.doneAt).toBe(PAST.toISOString());
    });

    it('undoes a done mark', async () => {
      mockPrisma.staffTaskAssignee.findUnique.mockResolvedValue(
        myRow({ doneAt: PAST }),
      );
      const result = await service.undone('task1', teacher);
      expect(mockPrisma.staffTaskAssignee.update).toHaveBeenCalledWith({
        where: { id: 'row-t1' },
        data: { doneAt: null },
      });
      expect(result.status).toBe('open');
    });
  });

  describe('given', () => {
    it('excludes removed rows and counts only active users', async () => {
      mockPrisma.staffTask.findMany.mockResolvedValue([
        task({
          dueAt: PAST,
          assignees: [
            row('t1', { doneAt: PAST }),
            row('t2', { user: person('t2', { isActive: false }) }),
            row('t3', { removedAt: PAST }),
          ],
        }),
      ]);
      const result = await service.given({}, admin);
      expect(result.nextBefore).toBeNull();
      expect(result.items).toHaveLength(1);
      const [view] = result.items;
      expect(view.assignees.map((a) => a.id)).toEqual(['t1', 't2']);
      expect(view.assignees[1].isActive).toBe(false);
      expect(view.done).toBe(1);
      expect(view.total).toBe(1);
      expect(view.overdue).toBe(false);
      const calls = mockPrisma.staffTask.findMany.mock.calls as [
        { where: { OR: [{ OR: { assignees: unknown }[] }] } },
      ][];
      const where = calls[0][0];
      expect(where.where.OR[0].OR[0].assignees).toEqual({
        some: {
          removedAt: null,
          user: { isActive: true, role: { in: [Role.admin, Role.teacher] } },
          doneAt: null,
        },
      });
    });

    it('keeps assignees who became parent or root but does not count them', async () => {
      mockPrisma.staffTask.findMany.mockResolvedValue([
        task({
          dueAt: PAST,
          assignees: [
            row('t1', { doneAt: PAST }),
            row('t2', { user: person('t2', { role: Role.parent }) }),
            row('t3', { user: person('t3', { role: Role.root }) }),
          ],
        }),
      ]);
      const [view] = (await service.given({}, admin)).items;
      expect(view.assignees.map((a) => [a.id, a.role])).toEqual([
        ['t1', Role.teacher],
        ['t2', Role.parent],
        ['t3', Role.root],
      ]);
      expect(view.done).toBe(1);
      expect(view.total).toBe(1);
      expect(view.overdue).toBe(false);
      expect(mockPrisma.staffTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdById: 'a1' }) as object,
        }),
      );
    });

    it('orders open tasks first and flags overdue ones', async () => {
      const later = new Date('2026-11-05T12:00:00.000Z');
      mockPrisma.staffTask.findMany.mockResolvedValue([
        task({ id: 'closed', dueAt: PAST, cancelledAt: PAST }),
        task({ id: 'late', dueAt: later }),
        task({ id: 'over', dueAt: PAST }),
      ]);
      mockPrisma.staffTask.count.mockResolvedValue(2);
      const result = await service.given({}, admin);
      expect(result.items.map((i) => i.id)).toEqual(['over', 'late', 'closed']);
      expect(result.items[0].overdue).toBe(true);
      expect(result.items[2].overdue).toBe(false);
      expect(result.nextBefore).toBe('2026-10-04T10:00:00.000Z');
    });

    it('lets root see every task with all=true', async () => {
      await service.given({ all: 'true' }, root);
      const arg = mockPrisma.staffTask.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(arg[0].where).not.toHaveProperty('createdById');
    });

    it('pages older closed tasks by a compound cursor without losing ties', async () => {
      const tie = new Date('2026-09-01T09:00:00.000Z');
      const stored = Array.from({ length: 31 }, (_, i) =>
        task({
          id: `x${String(99 - i).padStart(2, '0')}`,
          cancelledAt: PAST,
          dueAt: i >= 29 ? tie : new Date(Date.UTC(2026, 9, 2) - i * 3_600_000),
        }),
      );
      type Page = {
        dueAt?: { lt: Date };
        OR?: [{ dueAt: { lt: Date } }, { dueAt: Date; id: { lt: string } }];
      };
      mockPrisma.staffTask.findMany.mockImplementation(
        ({ where }: { where: { AND: [unknown, Page] } }) => {
          const page = where.AND[1];
          const keep = (t: ReturnType<typeof task>) => {
            if (page.dueAt) return t.dueAt < page.dueAt.lt;
            const [older, same] = page.OR!;
            return (
              t.dueAt < older.dueAt.lt ||
              (t.dueAt.getTime() === same.dueAt.getTime() && t.id < same.id.lt)
            );
          };
          return Promise.resolve(stored.filter(keep).slice(0, 30));
        },
      );
      const first = await service.given(
        { before: '2026-10-04T10:00:00.000Z' },
        admin,
      );
      expect(first.items).toHaveLength(30);
      expect(first.nextBefore).toBe('2026-09-01T09:00:00.000Z|x70');
      expect(mockPrisma.staffTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ dueAt: 'desc' }, { id: 'desc' }],
          take: 30,
        }),
      );
      const second = await service.given({ before: first.nextBefore! }, admin);
      expect(second.items.map((i) => i.id)).toEqual(['x69']);
      expect(second.nextBefore).toBeNull();
      const ids = [...first.items, ...second.items].map((i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(['x70', 'x69']));
      expect(new Set(ids).size).toBe(31);
    });

    it('rejects a garbage cursor', async () => {
      for (const before of [
        'abc',
        '2026-10-04|x',
        '2026-10-04T10:00:00.000Z|',
      ]) {
        await expect(service.given({ before }, admin)).rejects.toThrow(
          new BadRequestException('Invalid cursor'),
        );
        await expect(service.mine({ before }, teacher)).rejects.toThrow(
          new BadRequestException('Invalid cursor'),
        );
      }
      expect(mockPrisma.staffTask.findMany).not.toHaveBeenCalled();
    });
  });

  describe('mine', () => {
    it('returns my rows without other assignees', async () => {
      mockPrisma.staffTaskAssignee.findMany.mockResolvedValue([
        { ...row('t1'), task: task({ id: 'b', dueAt: PAST }) },
        { ...row('t1', { doneAt: PAST }), task: task({ id: 'c' }) },
        { ...row('t1'), task: task({ id: 'a' }) },
      ]);
      const result = await service.mine({}, teacher);
      expect(result.items.map((i) => [i.id, i.status])).toEqual([
        ['b', 'overdue'],
        ['a', 'open'],
        ['c', 'done'],
      ]);
      expect(result.items[0]).not.toHaveProperty('assignees');
      expect(result.items[0]).not.toHaveProperty('total');
      expect(mockPrisma.staffTaskAssignee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 't1',
            removedAt: null,
          }) as object,
        }),
      );
    });

    it('pages my closed rows by task dueAt and id', async () => {
      mockPrisma.staffTaskAssignee.findMany.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          ...row('t1', { doneAt: PAST }),
          task: task({ id: `y${i}`, dueAt: PAST }),
        })),
      );
      const result = await service.mine(
        { before: '2026-11-02T12:00:00.000Z|z' },
        teacher,
      );
      expect(result.nextBefore).toBe('2026-11-02T12:00:00.000Z|y29');
      expect(mockPrisma.staffTaskAssignee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 't1',
            removedAt: null,
            AND: [
              expect.anything(),
              {
                OR: [
                  { task: { dueAt: { lt: PAST } } },
                  { task: { dueAt: PAST }, taskId: { lt: 'z' } },
                ],
              },
            ],
          },
          orderBy: [{ task: { dueAt: 'desc' } }, { taskId: 'desc' }],
          take: 30,
        }),
      );
    });

    it('is empty for root', async () => {
      expect(await service.mine({}, root)).toEqual({
        items: [],
        nextBefore: null,
      });
      expect(mockPrisma.staffTaskAssignee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('summary', () => {
    it('counts open and overdue rows', async () => {
      mockPrisma.staffTaskAssignee.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1);
      expect(await service.summary(teacher)).toEqual({ open: 3, overdue: 1 });
      expect(mockPrisma.staffTaskAssignee.count).toHaveBeenCalledWith({
        where: {
          userId: 't1',
          removedAt: null,
          doneAt: null,
          task: { cancelledAt: null, dueAt: { lt: NOW } },
        },
      });
    });
  });

  describe('dashboard', () => {
    it('lists my overdue and today tasks', async () => {
      mockPrisma.staffTaskAssignee.findMany.mockResolvedValue([
        { ...row('t1'), task: task({ id: 'over', dueAt: PAST }) },
        { ...row('t1'), task: task({ id: 'today' }) },
      ]);
      const result = await service.dashboard(teacher);
      expect(result).toEqual({
        mine: [
          {
            id: 'over',
            title: 'Здати плани',
            dueAt: PAST.toISOString(),
            dueTime: '14:00',
            overdue: true,
          },
          {
            id: 'today',
            title: 'Здати плани',
            dueAt: DUE.toISOString(),
            dueTime: '14:00',
            overdue: false,
          },
        ],
        given: [],
      });
      expect(mockPrisma.staffTaskAssignee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 't1',
            removedAt: null,
            doneAt: null,
            task: {
              cancelledAt: null,
              dueAt: { lt: new Date('2026-11-03T22:00:00.000Z') },
            },
          },
        }),
      );
    });

    it('lists given overdue tasks with names of those not done', async () => {
      mockPrisma.staffTask.findMany.mockResolvedValue([
        task({
          dueAt: PAST,
          assignees: [
            row('t1', { doneAt: PAST }),
            row('t2'),
            row('t3', { user: person('t3', { isActive: false }) }),
            row('t4', { removedAt: PAST }),
            row('t5', { user: person('t5', { role: Role.parent }) }),
          ],
        }),
      ]);
      const result = await service.dashboard(admin);
      expect(result?.given).toEqual([
        {
          id: 'task1',
          title: 'Здати плани',
          dueAt: PAST.toISOString(),
          dueTime: '14:00',
          done: 1,
          total: 2,
          notDone: [
            { id: 't2', firstName: "Ім'я t2", lastName: 'Прізвище t2' },
          ],
        },
      ]);
    });

    it('returns null when both lists are empty', async () => {
      expect(await service.dashboard(teacher)).toBeNull();
    });
  });
});
