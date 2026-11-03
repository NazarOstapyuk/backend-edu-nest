import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope, Prisma, Role } from '@prisma/client';
import { baseScope } from '../access/access-calc';
import { kyivDayStart } from '../audit/audit-calc';
import { kyivStamp } from '../backups/backup-retention';
import { parseDay } from '../classes/access';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { deadlineFor, parseTime } from '../meals/meals-calc';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { CreateStaffTaskDto } from './dto/create-staff-task.dto';
import { ListStaffTasksDto } from './dto/list-staff-tasks.dto';
import { UpdateStaffTaskDto } from './dto/update-staff-task.dto';
import {
  AssigneeState,
  assigneeState,
  canAssign,
  isClosed,
  normalizeDescription,
  normalizeTitle,
  progress,
} from './tasks-calc';

const HISTORY_DAYS = 30;
const PAGE_SIZE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const authorSelect = { id: true, firstName: true, lastName: true } as const;

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  role: true,
  isActive: true,
} as const;

const taskInclude = {
  createdBy: { select: authorSelect },
  assignees: { include: { user: { select: personSelect } } },
} satisfies Prisma.StaffTaskInclude;

const myInclude = {
  task: { include: { createdBy: { select: authorSelect } } },
} satisfies Prisma.StaffTaskAssigneeInclude;

type TaskRecord = Prisma.StaffTaskGetPayload<{ include: typeof taskInclude }>;
type MyRecord = Prisma.StaffTaskAssigneeGetPayload<{
  include: typeof myInclude;
}>;

type Author = { id: string; firstName: string; lastName: string };

export type GivenTaskView = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  dueDate: string;
  dueTime: string;
  cancelledAt: string | null;
  author: Author;
  overdue: boolean;
  done: number;
  total: number;
  assignees: {
    id: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    role: Role;
    isActive: boolean;
    doneAt: string | null;
  }[];
};

export type MyTaskView = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  dueDate: string;
  dueTime: string;
  author: Author;
  status: AssigneeState;
  doneAt: string | null;
};

export type TaskPage<T> = { items: T[]; nextBefore: string | null };

export type TasksDashboard = {
  mine: {
    id: string;
    title: string;
    dueAt: string;
    dueTime: string;
    overdue: boolean;
  }[];
  given: {
    id: string;
    title: string;
    dueAt: string;
    dueTime: string;
    done: number;
    total: number;
    notDone: Author[];
  }[];
};

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const kyivParts = (instant: Date) => {
  const stamp = kyivStamp(instant);
  return {
    dueDate: stamp.slice(0, 10),
    dueTime: `${stamp.slice(11, 13)}:${stamp.slice(13, 15)}`,
  };
};

const counted = {
  removedAt: null,
  user: { isActive: true },
} satisfies Prisma.StaffTaskAssigneeWhereInput;

const openTaskWhere: Prisma.StaffTaskWhereInput = {
  cancelledAt: null,
  OR: [
    { assignees: { some: { ...counted, doneAt: null } } },
    { assignees: { none: counted } },
  ],
};

const openRowWhere: Prisma.StaffTaskAssigneeWhereInput = {
  doneAt: null,
  task: { cancelledAt: null },
};

const closedRowWhere: Prisma.StaffTaskAssigneeWhereInput = {
  OR: [{ doneAt: { not: null } }, { task: { cancelledAt: { not: null } } }],
};

const forbidden = () => new ForbiddenException('Insufficient permissions');
const notFound = () => new NotFoundException('Task not found');

const isGiver = (user: AuthenticatedUser) =>
  user.role === Role.root || user.role === Role.admin;

const actorBase = (user: AuthenticatedUser) => {
  const base = baseScope(user);
  return base === null ? null : new Set(base);
};

function parseDeadline(dueDate: string, dueTime: string): Date {
  if (parseTime(dueTime) === null)
    throw new BadRequestException('Invalid deadline');
  let day: Date;
  try {
    day = parseDay(dueDate);
  } catch {
    throw new BadRequestException('Invalid deadline');
  }
  return deadlineFor(day, dueTime);
}

function assertUnique(ids: string[]) {
  if (new Set(ids).size !== ids.length)
    throw new BadRequestException('Duplicate assignee');
}

function title(raw: string): string {
  const value = normalizeTitle(raw);
  if (value === null) throw new BadRequestException('Invalid title');
  return value;
}

function description(raw: string | null | undefined): string | null {
  const result = normalizeDescription(raw);
  if (result === null) throw new BadRequestException('Invalid description');
  return result.value;
}

const byDueAsc = (a: { dueAt: Date }, b: { dueAt: Date }) =>
  a.dueAt.getTime() - b.dueAt.getTime();

function historyOrder<T>(
  items: T[],
  dueAt: (item: T) => Date,
  closed: (item: T) => boolean,
): T[] {
  const open = items.filter((item) => !closed(item));
  const done = items.filter(closed);
  open.sort((a, b) => dueAt(a).getTime() - dueAt(b).getTime());
  done.sort((a, b) => dueAt(b).getTime() - dueAt(a).getTime());
  return [...open, ...done];
}

function givenView(task: TaskRecord, now: Date): GivenTaskView {
  const count = progress(task.assignees);
  const active = task.assignees
    .filter((row) => row.removedAt === null)
    .sort(
      (a, b) =>
        a.user.lastName.localeCompare(b.user.lastName) ||
        a.user.firstName.localeCompare(b.user.firstName),
    );
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    dueAt: task.dueAt.toISOString(),
    ...kyivParts(task.dueAt),
    cancelledAt: iso(task.cancelledAt),
    author: task.createdBy,
    overdue:
      task.cancelledAt === null &&
      now.getTime() > task.dueAt.getTime() &&
      count.done < count.total,
    done: count.done,
    total: count.total,
    assignees: active.map((row) => ({
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      middleName: row.user.middleName,
      role: row.user.role,
      isActive: row.user.isActive,
      doneAt: iso(row.doneAt),
    })),
  };
}

function myView(row: MyRecord, now: Date): MyTaskView {
  return {
    id: row.task.id,
    title: row.task.title,
    description: row.task.description,
    dueAt: row.task.dueAt.toISOString(),
    ...kyivParts(row.task.dueAt),
    author: row.task.createdBy,
    status: assigneeState(row.task, row, now),
    doneAt: iso(row.doneAt),
  };
}

@Injectable()
export class StaffTasksService {
  constructor(private prisma: PrismaService) {}

  private assertStaff(user: AuthenticatedUser) {
    if (user.role === Role.parent) throw forbidden();
  }

  private assertGiver(user: AuthenticatedUser) {
    if (!isGiver(user)) throw forbidden();
  }

  async assignable(user: AuthenticatedUser) {
    this.assertGiver(user);
    const base = actorBase(user);
    const where: Prisma.UserWhereInput = {
      isActive: true,
      role: {
        in:
          user.role === Role.root ? [Role.admin, Role.teacher] : [Role.teacher],
      },
    };
    if (user.role === Role.admin && base !== null) {
      where.accessScope = AccessScope.institutions;
      where.institutions = { some: { institutionId: { in: [...base] } } };
    }
    const users = await this.prisma.user.findMany({
      where,
      select: {
        ...personSelect,
        accessScope: true,
        institutions: { select: { institutionId: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users
      .filter((target) =>
        canAssign(user.role, base, {
          role: target.role,
          isActive: target.isActive,
          accessScope: target.accessScope,
          institutionIds: target.institutions.map((i) => i.institutionId),
        }),
      )
      .map((target) => ({
        id: target.id,
        firstName: target.firstName,
        lastName: target.lastName,
        middleName: target.middleName,
        role: target.role,
      }));
  }

  private async assertAssignable(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    ids: string[],
  ) {
    if (ids.length === 0) return;
    const targets = await tx.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        role: true,
        isActive: true,
        accessScope: true,
        institutions: { select: { institutionId: true } },
      },
    });
    const base = actorBase(user);
    const allowed = new Set(
      targets
        .filter((target) =>
          canAssign(user.role, base, {
            role: target.role,
            isActive: target.isActive,
            accessScope: target.accessScope,
            institutionIds: target.institutions.map((i) => i.institutionId),
          }),
        )
        .map((target) => target.id),
    );
    if (ids.some((id) => !allowed.has(id)))
      throw new ForbiddenException('Cannot assign this user');
  }

  async create(
    dto: CreateStaffTaskDto,
    user: AuthenticatedUser,
  ): Promise<GivenTaskView> {
    this.assertGiver(user);
    const data = {
      title: title(dto.title),
      description: description(dto.description),
      dueAt: parseDeadline(dto.dueDate, dto.dueTime),
    };
    const now = new Date();
    if (data.dueAt.getTime() <= now.getTime())
      throw new BadRequestException('Deadline is in the past');
    assertUnique(dto.assigneeIds);
    await this.assertAssignable(this.prisma, user, dto.assigneeIds);
    const task = await this.prisma.staffTask.create({
      data: {
        ...data,
        createdById: user.id,
        assignees: {
          createMany: { data: dto.assigneeIds.map((userId) => ({ userId })) },
        },
      },
      include: taskInclude,
    });
    return givenView(task, now);
  }

  private async lockTask(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<TaskRecord> {
    await tx.$queryRaw`SELECT id FROM "StaffTask" WHERE id = ${id} FOR UPDATE`;
    const task = await tx.staffTask.findUnique({
      where: { id },
      include: taskInclude,
    });
    if (!task) throw notFound();
    return task;
  }

  async update(
    id: string,
    dto: UpdateStaffTaskDto,
    user: AuthenticatedUser,
  ): Promise<GivenTaskView> {
    this.assertStaff(user);
    if ((dto.dueDate === undefined) !== (dto.dueTime === undefined))
      throw new BadRequestException('Invalid deadline');
    const data: Prisma.StaffTaskUpdateInput = {};
    if (dto.title !== undefined) data.title = title(dto.title);
    if (dto.description !== undefined)
      data.description = description(dto.description);
    const dueAt =
      dto.dueDate !== undefined && dto.dueTime !== undefined
        ? parseDeadline(dto.dueDate, dto.dueTime)
        : null;
    if (dto.assigneeIds) assertUnique(dto.assigneeIds);
    const now = new Date();

    const task = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockTask(tx, id);
      if (current.createdById !== user.id) {
        if (user.role === Role.root)
          throw new ForbiddenException('Not your task');
        throw notFound();
      }
      if (current.cancelledAt)
        throw new BadRequestException('Task is cancelled');
      if (dueAt && dueAt.getTime() !== current.dueAt.getTime()) {
        if (dueAt.getTime() <= now.getTime())
          throw new BadRequestException('Deadline is in the past');
      }
      if (dueAt) data.dueAt = dueAt;

      if (dto.assigneeIds) {
        const wanted = new Set(dto.assigneeIds);
        const rows = new Map(current.assignees.map((r) => [r.userId, r]));
        const added = dto.assigneeIds.filter((userId) => {
          const existing = rows.get(userId);
          return !existing || existing.removedAt !== null;
        });
        await this.assertAssignable(tx, user, added);
        const removed = current.assignees
          .filter((r) => r.removedAt === null && !wanted.has(r.userId))
          .map((r) => r.id);
        const restored = added
          .map((userId) => rows.get(userId)?.id)
          .filter((rowId): rowId is string => rowId !== undefined);
        const created = added.filter((userId) => !rows.has(userId));
        if (removed.length > 0)
          await tx.staffTaskAssignee.updateMany({
            where: { id: { in: removed } },
            data: { removedAt: now },
          });
        if (restored.length > 0)
          await tx.staffTaskAssignee.updateMany({
            where: { id: { in: restored } },
            data: { removedAt: null, doneAt: null },
          });
        if (created.length > 0)
          await tx.staffTaskAssignee.createMany({
            data: created.map((userId) => ({ taskId: id, userId })),
          });
      }
      if (Object.keys(data).length > 0)
        await tx.staffTask.update({ where: { id }, data });
      return tx.staffTask.findUnique({ where: { id }, include: taskInclude });
    });
    return givenView(task!, now);
  }

  async cancel(id: string, user: AuthenticatedUser): Promise<GivenTaskView> {
    this.assertStaff(user);
    const now = new Date();
    const task = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockTask(tx, id);
      if (current.createdById !== user.id && user.role !== Role.root)
        throw notFound();
      if (current.cancelledAt)
        throw new BadRequestException('Task is cancelled');
      await tx.staffTask.update({
        where: { id },
        data: { cancelledAt: now, cancelledById: user.id },
      });
      return tx.staffTask.findUnique({ where: { id }, include: taskInclude });
    });
    return givenView(task!, now);
  }

  async given(
    query: ListStaffTasksDto,
    user: AuthenticatedUser,
  ): Promise<TaskPage<GivenTaskView>> {
    this.assertGiver(user);
    const now = new Date();
    const author: Prisma.StaffTaskWhereInput =
      user.role === Role.root && query.all === 'true'
        ? {}
        : { createdById: user.id };
    if (query.before) {
      const tasks = await this.prisma.staffTask.findMany({
        where: {
          ...author,
          NOT: openTaskWhere,
          dueAt: { lt: new Date(query.before) },
        },
        include: taskInclude,
        orderBy: { dueAt: 'desc' },
        take: PAGE_SIZE,
      });
      return {
        items: tasks.map((task) => givenView(task, now)),
        nextBefore:
          tasks.length === PAGE_SIZE
            ? tasks[tasks.length - 1].dueAt.toISOString()
            : null,
      };
    }
    const cutoff = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
    const [tasks, older] = await Promise.all([
      this.prisma.staffTask.findMany({
        where: {
          ...author,
          OR: [openTaskWhere, { dueAt: { gte: cutoff } }],
        },
        include: taskInclude,
      }),
      this.prisma.staffTask.count({
        where: { ...author, NOT: openTaskWhere, dueAt: { lt: cutoff } },
      }),
    ]);
    const closed = (task: TaskRecord) =>
      isClosed(task, progress(task.assignees));
    const visible = tasks.filter(
      (task) => !closed(task) || task.dueAt.getTime() >= cutoff.getTime(),
    );
    return {
      items: historyOrder(visible, (task) => task.dueAt, closed).map((task) =>
        givenView(task, now),
      ),
      nextBefore: older > 0 ? cutoff.toISOString() : null,
    };
  }

  async mine(
    query: ListStaffTasksDto,
    user: AuthenticatedUser,
  ): Promise<TaskPage<MyTaskView>> {
    this.assertStaff(user);
    if (user.role === Role.root) return { items: [], nextBefore: null };
    const now = new Date();
    const own = { userId: user.id, removedAt: null };
    if (query.before) {
      const rows = await this.prisma.staffTaskAssignee.findMany({
        where: {
          ...own,
          ...closedRowWhere,
          task: { dueAt: { lt: new Date(query.before) } },
        },
        include: myInclude,
        orderBy: { task: { dueAt: 'desc' } },
        take: PAGE_SIZE,
      });
      return {
        items: rows.map((row) => myView(row, now)),
        nextBefore:
          rows.length === PAGE_SIZE
            ? rows[rows.length - 1].task.dueAt.toISOString()
            : null,
      };
    }
    const cutoff = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
    const [rows, older] = await Promise.all([
      this.prisma.staffTaskAssignee.findMany({
        where: {
          ...own,
          OR: [openRowWhere, { task: { dueAt: { gte: cutoff } } }],
        },
        include: myInclude,
      }),
      this.prisma.staffTaskAssignee.count({
        where: {
          ...own,
          AND: [closedRowWhere, { task: { dueAt: { lt: cutoff } } }],
        },
      }),
    ]);
    const closed = (row: MyRecord) =>
      row.doneAt !== null || row.task.cancelledAt !== null;
    return {
      items: historyOrder(rows, (row) => row.task.dueAt, closed).map((row) =>
        myView(row, now),
      ),
      nextBefore: older > 0 ? cutoff.toISOString() : null,
    };
  }

  private async mark(
    id: string,
    user: AuthenticatedUser,
    done: boolean,
  ): Promise<MyTaskView> {
    this.assertStaff(user);
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "StaffTask" WHERE id = ${id} FOR SHARE`;
      const current = await tx.staffTaskAssignee.findUnique({
        where: { taskId_userId: { taskId: id, userId: user.id } },
        include: myInclude,
      });
      if (!current || current.removedAt !== null) throw notFound();
      if (current.task.cancelledAt)
        throw new BadRequestException('Task is cancelled');
      if (done === (current.doneAt !== null)) return current;
      const doneAt = done ? now : null;
      await tx.staffTaskAssignee.update({
        where: { id: current.id },
        data: { doneAt },
      });
      return { ...current, doneAt };
    });
    return myView(row, now);
  }

  done(id: string, user: AuthenticatedUser) {
    return this.mark(id, user, true);
  }

  undone(id: string, user: AuthenticatedUser) {
    return this.mark(id, user, false);
  }

  async summary(user: AuthenticatedUser) {
    this.assertStaff(user);
    const now = new Date();
    const where = { userId: user.id, removedAt: null, doneAt: null };
    const [open, overdue] = await Promise.all([
      this.prisma.staffTaskAssignee.count({
        where: { ...where, task: { cancelledAt: null } },
      }),
      this.prisma.staffTaskAssignee.count({
        where: { ...where, task: { cancelledAt: null, dueAt: { lt: now } } },
      }),
    ]);
    return { open, overdue };
  }

  async dashboard(user: AuthenticatedUser): Promise<TasksDashboard | null> {
    if (user.role === Role.parent) return null;
    const now = new Date();
    const tomorrow = kyivDayStart(isoDay(addDays(kyivToday(now), 1)));
    const [rows, tasks] = await Promise.all([
      this.prisma.staffTaskAssignee.findMany({
        where: {
          userId: user.id,
          removedAt: null,
          doneAt: null,
          task: { cancelledAt: null, dueAt: { lt: tomorrow } },
        },
        include: myInclude,
      }),
      this.prisma.staffTask.findMany({
        where: {
          createdById: user.id,
          cancelledAt: null,
          dueAt: { lt: now },
          assignees: { some: { ...counted, doneAt: null } },
        },
        include: taskInclude,
      }),
    ]);
    const mine = rows
      .map((row) => row.task)
      .sort(byDueAsc)
      .map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt.toISOString(),
        dueTime: kyivParts(task.dueAt).dueTime,
        overdue: now.getTime() > task.dueAt.getTime(),
      }));
    const given = tasks
      .sort(byDueAsc)
      .map((task) => ({ task, count: progress(task.assignees) }))
      .filter(({ count }) => count.done < count.total)
      .map(({ task, count }) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt.toISOString(),
        dueTime: kyivParts(task.dueAt).dueTime,
        done: count.done,
        total: count.total,
        notDone: task.assignees
          .filter(
            (row) =>
              row.removedAt === null &&
              row.user.isActive &&
              row.doneAt === null,
          )
          .sort((a, b) => a.user.lastName.localeCompare(b.user.lastName))
          .map((row) => ({
            id: row.user.id,
            firstName: row.user.firstName,
            lastName: row.user.lastName,
          })),
      }));
    if (mine.length === 0 && given.length === 0) return null;
    return { mine, given };
  }
}
