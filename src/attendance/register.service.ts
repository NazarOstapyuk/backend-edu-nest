import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  DailyStatus,
  NoticeStatus,
  PermissionArea,
  PermissionLevel,
  Prisma,
} from '@prisma/client';
import { hasPermission, scopeKind } from '../access/access-calc';
import { groupScopeWhere } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { CalendarService } from './calendar.service';
import {
  dayInfo,
  dayRange,
  parseMonth,
  resolveDay,
  summarizeDays,
} from './register-calc';
import { SaveRegisterDto } from './dto/save-register.dto';

const EDIT_KEY = 'attendanceEditDays';
const DEFAULT_EDIT_DAYS = 3;

const childSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
} as const;

const time = (day: Date) => day.getTime();

const canManageRegister = (
  user: AuthenticatedUser,
  level: PermissionLevel = PermissionLevel.view,
) => hasPermission(user, PermissionArea.register, level);

@Injectable()
export class RegisterService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private audit: AuditService,
  ) {}

  async getEditDays(): Promise<number> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: EDIT_KEY },
    });
    return setting ? Number(setting.value) : DEFAULT_EDIT_DAYS;
  }

  async setEditDays(value: number, userId: string) {
    if (!Number.isInteger(value) || value < 0 || value > 30) {
      throw new BadRequestException('Edit days must be between 0 and 30');
    }
    const previous = await this.getEditDays();
    await this.prisma.appSetting.upsert({
      where: { key: EDIT_KEY },
      create: { key: EDIT_KEY, value: String(value) },
      update: { value: String(value) },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'settings',
      entityId: 'attendanceEditDays',
      action: AuditAction.update,
      before: { value: String(previous) },
      after: { value: String(value) },
      fields: ['value'],
    });
    return { editDays: value };
  }

  groupsFor(user: AuthenticatedUser) {
    return this.prisma.group.findMany({
      where: {
        ...(canManageRegister(user)
          ? {}
          : { teachers: { some: { id: user.id } } }),
        ...groupScopeWhere(scopeKind(user)),
      },
      select: { id: true, name: true, kind: true },
      orderBy: { name: 'asc' },
    });
  }

  private async loadGroup(
    groupId: string,
    user: AuthenticatedUser,
    level: PermissionLevel = PermissionLevel.view,
  ) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        kind: true,
        teachers: { select: { id: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    const kind = scopeKind(user);
    if (kind && group.kind !== kind)
      throw new NotFoundException('Group not found');
    if (
      !canManageRegister(user, level) &&
      !group.teachers.some((t) => t.id === user.id)
    ) {
      throw new ForbiddenException('Not your group');
    }
    return group;
  }

  private childrenOf(groupId: string, from: Date, to: Date) {
    return this.prisma.child.findMany({
      where: {
        OR: [
          { groupId },
          {
            dailyAttendances: {
              some: { groupId, voidedAt: null, date: { gte: from, lte: to } },
            },
          },
        ],
      },
      select: childSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  private inWindow(date: Date, today: Date, editDays: number) {
    return time(date) >= time(addDays(today, -editDays));
  }

  async day(
    groupId: string,
    dateValue: string,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.loadGroup(groupId, user);
    const date = parseDay(dateValue);
    const [entries, editDays, children, reasons] = await Promise.all([
      this.calendar.entriesBetween(date, date),
      this.getEditDays(),
      this.childrenOf(groupId, date, date),
      this.prisma.absenceReason.findMany({
        select: { id: true, requiresDocument: true },
      }),
    ]);
    const ids = children.map((c) => c.id);
    const [marks, notices] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: { childId: { in: ids }, date, voidedAt: null },
        include: {
          markedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.absenceNotice.findMany({
        where: {
          childId: { in: ids },
          status: NoticeStatus.approved,
          startDate: { lte: date },
          endDate: { gte: date },
        },
      }),
    ]);
    const info = dayInfo(date, group, entries);
    const window = this.inWindow(date, today, editDays);
    const notFuture = time(date) <= time(today);
    const requiresDocument = new Set(
      reasons.filter((r) => r.requiresDocument).map((r) => r.id),
    );
    return {
      date: isoDay(date),
      working: info.working,
      calendarTitle: info.title,
      canEdit:
        info.working &&
        notFuture &&
        (canManageRegister(user, PermissionLevel.edit) || window),
      needsReason: canManageRegister(user, PermissionLevel.edit) && !window,
      children: children.map((child) => {
        const own = marks.filter((m) => m.childId === child.id);
        const ownNotices = notices.filter((n) => n.childId === child.id);
        const resolved = resolveDay(date, info.working, own, ownNotices);
        const mark = own[0] ?? null;
        const notice = ownNotices[0] ?? null;
        return {
          child,
          state: resolved.state,
          mark: mark && {
            id: mark.id,
            status: mark.status,
            reasonId: mark.reasonId,
            note: mark.note,
            documentProvided: mark.documentProvided,
            markedBy: mark.markedBy,
            createdAt: mark.createdAt,
          },
          notice: notice && {
            id: notice.id,
            startDate: isoDay(notice.startDate),
            endDate: isoDay(notice.endDate),
            reasonId: notice.reasonId,
            comment: notice.comment,
          },
          documentRequired:
            resolved.reasonId !== null &&
            requiresDocument.has(resolved.reasonId),
        };
      }),
    };
  }

  async save(
    groupId: string,
    dto: SaveRegisterDto,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.loadGroup(groupId, user, PermissionLevel.edit);
    const date = parseDay(dto.date);
    if (time(date) > time(today))
      throw new BadRequestException('Cannot mark future days');
    const [entries, editDays] = await Promise.all([
      this.calendar.entriesBetween(date, date),
      this.getEditDays(),
    ]);
    if (!dayInfo(date, group, entries).working)
      throw new BadRequestException('Not a working day');
    const reason = dto.reason?.trim() || null;
    if (!this.inWindow(date, today, editDays)) {
      if (!canManageRegister(user, PermissionLevel.edit))
        throw new ForbiddenException('Edit window has passed');
      if (!reason) throw new BadRequestException('Reason is required');
    }
    const ids = dto.marks.map((m) => m.childId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Duplicate child in marks');
    for (const m of dto.marks) {
      if (m.status !== DailyStatus.absent && (m.reasonId || m.documentProvided))
        throw new BadRequestException('Reason is only allowed for absences');
    }
    const current = ids.length
      ? await this.prisma.dailyAttendance.findMany({
          where: { childId: { in: ids }, date, voidedAt: null },
          select: { childId: true, reasonId: true },
        })
      : [];
    const keeps = (m: { childId: string; reasonId?: string }) =>
      current.some((c) => c.childId === m.childId && c.reasonId === m.reasonId);
    const newIds = new Set<string>();
    const keptIds = new Set<string>();
    for (const m of dto.marks) {
      if (!m.reasonId) continue;
      if (keeps(m)) keptIds.add(m.reasonId);
      else newIds.add(m.reasonId);
    }
    for (const id of newIds) keptIds.delete(id);
    if (newIds.size || keptIds.size) {
      const keptList = [...keptIds];
      const found = await this.prisma.absenceReason.count({
        where: {
          id: { in: [...newIds, ...keptList] },
          OR: [{ active: true }, { id: { in: keptList } }],
        },
      });
      if (found !== newIds.size + keptIds.size)
        throw new BadRequestException('Absence reason not found');
    }
    const allowed = new Set(
      (await this.childrenOf(groupId, date, date)).map((c) => c.id),
    );
    if (ids.some((id) => !allowed.has(id)))
      throw new BadRequestException('Child is not in this group');

    if (ids.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Child" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        const active = await tx.dailyAttendance.findMany({
          where: { childId: { in: ids }, date, voidedAt: null },
        });
        const now = new Date();
        for (const m of dto.marks) {
          const next = {
            status: m.status,
            reasonId: m.reasonId ?? null,
            note: m.note?.trim() || null,
            documentProvided: m.documentProvided ?? false,
          };
          const existing = active.find((a) => a.childId === m.childId);
          if (
            existing &&
            existing.groupId === groupId &&
            existing.status === next.status &&
            existing.reasonId === next.reasonId &&
            existing.note === next.note &&
            existing.documentProvided === next.documentProvided
          )
            continue;
          if (existing) {
            await tx.dailyAttendance.update({
              where: { id: existing.id },
              data: {
                voidedAt: now,
                voidedById: user.id,
                voidReason: reason ?? 'Corrected',
              },
            });
          }
          await tx.dailyAttendance.create({
            data: {
              childId: m.childId,
              groupId,
              date,
              ...next,
              markedById: user.id,
            },
          });
        }
      });
    }
    return this.day(groupId, dto.date, user, today);
  }

  async month(
    groupId: string,
    monthValue: string,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.loadGroup(groupId, user);
    const { from, to, days } = parseMonth(monthValue);
    const [entries, children, reasons] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.childrenOf(groupId, from, to),
      this.prisma.absenceReason.findMany({
        select: { id: true, excused: true },
      }),
    ]);
    const ids = children.map((c) => c.id);
    const [marks, notices] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: {
          childId: { in: ids },
          date: { gte: from, lte: to },
          voidedAt: null,
        },
      }),
      this.prisma.absenceNotice.findMany({
        where: {
          childId: { in: ids },
          status: NoticeStatus.approved,
          startDate: { lte: to },
          endDate: { gte: from },
        },
      }),
    ]);
    const excused = new Set(reasons.filter((r) => r.excused).map((r) => r.id));
    const infos = days.map((d) => dayInfo(d, group, entries));
    return {
      month: monthValue,
      days: days.map((d, i) => ({
        date: isoDay(d),
        working: infos[i].working,
        title: infos[i].title,
      })),
      children: children.map((child) => {
        const own = marks.filter((m) => m.childId === child.id);
        const ownNotices = notices.filter((n) => n.childId === child.id);
        const resolved = days.map((d, i) =>
          resolveDay(d, infos[i].working, own, ownNotices),
        );
        return {
          child,
          days: resolved.map((r, i) => ({
            date: isoDay(days[i]),
            state: r.state,
            status: r.status,
            reasonId: r.reasonId,
          })),
          summary: summarizeDays(
            resolved.filter((_, i) => time(days[i]) <= time(today)),
            excused,
          ),
        };
      }),
    };
  }

  async childDays(childIds: string[], from: Date, to: Date) {
    const days = dayRange(from, to);
    const groupSelect = { select: { id: true, kind: true } } as const;
    const [children, entries, marks, notices] = await Promise.all([
      this.prisma.child.findMany({
        where: { id: { in: childIds } },
        select: { id: true, group: groupSelect },
      }),
      this.calendar.entriesBetween(from, to),
      this.prisma.dailyAttendance.findMany({
        where: {
          childId: { in: childIds },
          date: { gte: from, lte: to },
          voidedAt: null,
        },
        select: {
          childId: true,
          date: true,
          status: true,
          reasonId: true,
          voidedAt: true,
          group: groupSelect,
        },
      }),
      this.prisma.absenceNotice.findMany({
        where: {
          childId: { in: childIds },
          status: NoticeStatus.approved,
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: {
          childId: true,
          startDate: true,
          endDate: true,
          reasonId: true,
          status: true,
        },
      }),
    ]);
    return children.map((child) => {
      const own = marks.filter((m) => m.childId === child.id);
      const ownNotices = notices.filter((n) => n.childId === child.id);
      return {
        childId: child.id,
        days: days.map((date) => {
          const mark = own.find((m) => time(m.date) === time(date));
          const group = mark?.group ?? child.group;
          const info = dayInfo(date, group, entries);
          return {
            date,
            title: info.title,
            hasGroup: group !== null,
            ...resolveDay(date, info.working, own, ownNotices),
          };
        }),
      };
    });
  }

  async expectedPresence(childIds: string[], from: Date, to: Date) {
    const rows = await this.childDays(childIds, from, to);
    return rows.flatMap((row) =>
      row.days
        .filter(
          (d) =>
            d.hasGroup && (d.state === 'present' || d.state === 'unmarked'),
        )
        .map((d) => ({ childId: row.childId, date: d.date })),
    );
  }
}
