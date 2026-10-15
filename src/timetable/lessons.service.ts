import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LessonStatus, PermissionLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { RegisterService } from '../attendance/register.service';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { isTimetableManager } from './roles';
import { type Slot, pupilState } from './schedule-calc';
import { ScheduleService, subgroupKey } from './schedule.service';
import { SaveLessonDto } from './dto/save-lesson.dto';

const time = (day: Date) => day.getTime();

@Injectable()
export class LessonsService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
    private register: RegisterService,
  ) {}

  async myLessons(
    user: AuthenticatedUser,
    dateValue: string,
    teacherId?: string,
  ) {
    const date = parseDay(dateValue);
    const target = isTimetableManager(user) && teacherId ? teacherId : user.id;
    const schedules = await this.schedule.build(date, date);
    const rows = schedules.flatMap((s) =>
      s.days[0].slots
        .filter((slot) => !slot.cancelled && slot.teacherId === target)
        .map((slot) => ({
          group: { id: s.group.id, name: s.group.name },
          slot,
        })),
    );
    const [names, lessons] = await Promise.all([
      this.schedule.describe(rows.map((r) => r.slot)),
      this.prisma.schoolLesson.findMany({
        where: { date, groupId: { in: rows.map((r) => r.group.id) } },
        select: { id: true, groupId: true, period: true, subgroupKey: true },
      }),
    ]);
    return {
      date: isoDay(date),
      lessons: rows
        .sort(
          (a, b) =>
            a.slot.startTime.localeCompare(b.slot.startTime) ||
            a.group.name.localeCompare(b.group.name),
        )
        .map((r) => ({
          group: r.group,
          ...r.slot,
          ...names(r.slot),
          lessonId:
            lessons.find(
              (l) =>
                l.groupId === r.group.id &&
                l.period === r.slot.period &&
                l.subgroupKey === subgroupKey(r.slot.subgroupId),
            )?.id ?? null,
        })),
    };
  }

  private async locate(
    groupId: string,
    dateValue: string,
    period: number,
    subgroupId: string | null,
    user: AuthenticatedUser,
  ) {
    const date = parseDay(dateValue);
    const [schedule] = await this.schedule.build(date, date, [groupId]);
    const slot = schedule?.days[0].slots.find(
      (s) => !s.cancelled && s.period === period && s.subgroupId === subgroupId,
    );
    if (!schedule || !slot) throw new NotFoundException('Lesson not found');
    if (
      !isTimetableManager(user, PermissionLevel.edit) &&
      slot.teacherId !== user.id
    )
      throw new ForbiddenException('Not your lesson');
    return { date, slot, group: schedule.group };
  }

  private async pupilIds(groupId: string, slot: Slot, lessonId: string | null) {
    const base = slot.subgroupId
      ? (
          await this.prisma.subgroupMember.findMany({
            where: { subgroupId: slot.subgroupId, child: { groupId } },
            select: { childId: true },
          })
        ).map((m) => m.childId)
      : (
          await this.prisma.child.findMany({
            where: { groupId },
            select: { id: true },
          })
        ).map((c) => c.id);
    const marked = lessonId
      ? (
          await this.prisma.lessonMark.findMany({
            where: { lessonId, voidedAt: null },
            select: { childId: true },
          })
        ).map((m) => m.childId)
      : [];
    return [...new Set([...base, ...marked])];
  }

  private lessonKey(groupId: string, date: Date, period: number, slot: Slot) {
    return {
      groupId_date_period_subgroupKey: {
        groupId,
        date,
        period,
        subgroupKey: subgroupKey(slot.subgroupId),
      },
    };
  }

  async view(
    groupId: string,
    dateValue: string,
    period: number,
    subgroupId: string | null,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const { date, slot, group } = await this.locate(
      groupId,
      dateValue,
      period,
      subgroupId,
      user,
    );
    const lesson = await this.prisma.schoolLesson.findUnique({
      where: this.lessonKey(groupId, date, period, slot),
      include: { marks: { where: { voidedAt: null } } },
    });
    const ids = await this.pupilIds(groupId, slot, lesson?.id ?? null);
    const [children, dayRows, editDays, names] = await Promise.all([
      this.prisma.child.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true, middleName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.register.childDays(ids, date, date),
      this.register.getEditDays(),
      this.schedule.describe([slot]),
    ]);
    const inWindow = time(date) >= time(addDays(today, -editDays));
    return {
      group: { id: group.id, name: group.name },
      date: isoDay(date),
      slot: { ...slot, ...names(slot) },
      lesson: lesson && {
        id: lesson.id,
        topic: lesson.topic,
        homework: lesson.homework,
      },
      canEdit:
        time(date) <= time(today) &&
        (isTimetableManager(user, PermissionLevel.edit) || inWindow),
      needsReason: isTimetableManager(user, PermissionLevel.edit) && !inWindow,
      pupils: children.map((child) => {
        const dayState =
          dayRows.find((r) => r.childId === child.id)?.days[0] ?? null;
        const mark = lesson?.marks.find((m) => m.childId === child.id) ?? null;
        return {
          child,
          state: pupilState(
            dayState?.state ?? null,
            dayState?.reasonId ?? null,
            mark,
          ),
          mark: mark && {
            id: mark.id,
            status: mark.status,
            reasonId: mark.reasonId,
            level: mark.level,
            comment: mark.comment,
          },
          dayState: dayState?.state ?? null,
          dayReasonId: dayState?.reasonId ?? null,
        };
      }),
    };
  }

  async save(
    groupId: string,
    dateValue: string,
    period: number,
    subgroupId: string | null,
    dto: SaveLessonDto,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const { date, slot } = await this.locate(
      groupId,
      dateValue,
      period,
      subgroupId,
      user,
    );
    if (time(date) > time(today))
      throw new BadRequestException('Cannot mark future days');
    const editDays = await this.register.getEditDays();
    const reason = dto.reason?.trim() || null;
    if (time(date) < time(addDays(today, -editDays))) {
      if (!isTimetableManager(user, PermissionLevel.edit))
        throw new ForbiddenException('Edit window has passed');
      if (!reason) throw new BadRequestException('Reason is required');
    }
    const ids = dto.marks.map((m) => m.childId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Duplicate child in marks');
    for (const m of dto.marks) {
      if (m.status !== LessonStatus.absent && m.reasonId)
        throw new BadRequestException('Reason is only allowed for absences');
      if (m.status === LessonStatus.absent && m.level)
        throw new BadRequestException(
          'Level is only allowed for present students',
        );
    }
    const existing = await this.prisma.schoolLesson.findUnique({
      where: this.lessonKey(groupId, date, period, slot),
      include: { marks: { where: { voidedAt: null } } },
    });
    const allowed = new Set(
      await this.pupilIds(groupId, slot, existing?.id ?? null),
    );
    if (ids.some((id) => !allowed.has(id)))
      throw new BadRequestException('Child is not in this subgroup');
    const kept = new Set(
      dto.marks
        .filter(
          (m) =>
            m.reasonId &&
            existing?.marks.some(
              (e) => e.childId === m.childId && e.reasonId === m.reasonId,
            ),
        )
        .map((m) => m.reasonId as string),
    );
    const fresh = [
      ...new Set(
        dto.marks.flatMap((m) =>
          m.reasonId && !kept.has(m.reasonId) ? [m.reasonId] : [],
        ),
      ),
    ];
    if (fresh.length) {
      const found = await this.prisma.absenceReason.count({
        where: { id: { in: fresh }, active: true },
      });
      if (found !== fresh.length)
        throw new BadRequestException('Absence reason not found');
    }
    const key = subgroupKey(slot.subgroupId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "SchoolLesson" ("id", "groupId", "date", "period", "subgroupKey", "subgroupId", "subjectId", "teacherId", "roomId", "conductedById", "updatedAt") VALUES (${randomUUID()}, ${groupId}, ${date}::date, ${period}, ${key}, ${slot.subgroupId}, ${slot.subjectId}, ${slot.teacherId}, ${slot.roomId}, ${user.id}, NOW()) ON CONFLICT ("groupId", "date", "period", "subgroupKey") DO NOTHING`;
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "SchoolLesson" WHERE "groupId" = ${groupId} AND "date" = ${date}::date AND "period" = ${period} AND "subgroupKey" = ${key} FOR UPDATE`;
      const lessonId = locked[0].id;
      if (dto.topic !== undefined || dto.homework !== undefined) {
        await tx.schoolLesson.update({
          where: { id: lessonId },
          data: {
            topic:
              dto.topic === undefined ? undefined : dto.topic.trim() || null,
            homework:
              dto.homework === undefined
                ? undefined
                : dto.homework.trim() || null,
          },
        });
      }
      if (!ids.length) return;
      await tx.$queryRaw`SELECT id FROM "Child" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const active = await tx.lessonMark.findMany({
        where: { lessonId, childId: { in: ids }, voidedAt: null },
      });
      const now = new Date();
      for (const m of dto.marks) {
        const next = {
          status: m.status,
          reasonId: m.reasonId ?? null,
          level: m.level ?? null,
          comment: m.comment?.trim() || null,
        };
        const current = active.find((a) => a.childId === m.childId);
        if (
          current &&
          current.status === next.status &&
          current.reasonId === next.reasonId &&
          current.level === next.level &&
          current.comment === next.comment
        )
          continue;
        if (current) {
          await tx.lessonMark.update({
            where: { id: current.id },
            data: {
              voidedAt: now,
              voidedById: user.id,
              voidReason: reason ?? 'Corrected',
            },
          });
        }
        await tx.lessonMark.create({
          data: { lessonId, childId: m.childId, ...next, markedById: user.id },
        });
      }
    });
    return this.view(groupId, dateValue, period, slot.subgroupId, user, today);
  }
}
