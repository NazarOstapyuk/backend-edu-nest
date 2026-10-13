import { BadRequestException, Injectable } from '@nestjs/common';
import { GroupKind, LessonStatus, NushLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnChild } from '../common/ownership';
import { parseDay } from '../classes/access';
import { RegisterService } from '../attendance/register.service';
import { parseMonth } from '../attendance/register-calc';
import { dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { type Slot, pupilState } from './schedule-calc';
import { ScheduleService, subgroupKey } from './schedule.service';

const emptyLevels = (): Record<NushLevel, number> => ({
  needs_support: 0,
  progressing: 0,
  with_help: 0,
  independent: 0,
});

@Injectable()
export class ParentTimetableService {
  constructor(
    private prisma: PrismaService,
    private scheduler: ScheduleService,
    private register: RegisterService,
  ) {}

  private async childClass(parentId: string, childId: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: {
        groupId: true,
        group: { select: { kind: true } },
        subgroupMemberships: { select: { subgroupId: true } },
      },
    });
    const groupId =
      child?.group?.kind === GroupKind.school_class ? child.groupId : null;
    const subgroups = new Set(
      child?.subgroupMemberships.map((m) => m.subgroupId) ?? [],
    );
    return {
      groupId,
      applies: (slot: Slot) =>
        slot.subgroupId === null || subgroups.has(slot.subgroupId),
    };
  }

  async schedule(
    parentId: string,
    childId: string,
    fromValue: string,
    toValue: string,
  ) {
    const from = parseDay(fromValue);
    const to = parseDay(toValue);
    if (to.getTime() < from.getTime() || dayCount(from, to) > 31)
      throw new BadRequestException('Invalid period');
    const { groupId, applies } = await this.childClass(parentId, childId);
    if (!groupId) return { days: [] };
    const [schedule] = await this.scheduler.build(from, to, [groupId]);
    const lessons = await this.prisma.schoolLesson.findMany({
      where: { groupId, date: { gte: from, lte: to } },
      select: {
        date: true,
        period: true,
        subgroupKey: true,
        topic: true,
        homework: true,
      },
    });
    const names = await this.scheduler.describe(
      schedule.days.flatMap((d) => d.slots.filter(applies)),
    );
    return {
      days: schedule.days.map((d) => ({
        date: isoDay(d.date),
        working: d.working,
        title: d.title,
        slots: d.slots.filter(applies).map((s) => {
          const lesson = lessons.find(
            (l) =>
              l.date.getTime() === d.date.getTime() &&
              l.period === s.period &&
              l.subgroupKey === subgroupKey(s.subgroupId),
          );
          const { subjectName, teacherName, roomName, subgroupName } = names(s);
          return {
            period: s.period,
            startTime: s.startTime,
            endTime: s.endTime,
            subjectName,
            teacherName,
            roomName,
            subgroupName,
            cancelled: s.cancelled,
            replaced: s.source === 'replace',
            extra: s.source === 'extra',
            topic: lesson?.topic ?? null,
            homework: lesson?.homework ?? null,
          };
        }),
      })),
    };
  }

  async lessons(
    parentId: string,
    childId: string,
    monthValue: string,
    today: Date = kyivToday(),
  ) {
    const { from, to } = parseMonth(monthValue);
    const { groupId, applies } = await this.childClass(parentId, childId);
    const empty = {
      month: monthValue,
      lessons: [],
      summary: { missed: 0, missedExcused: 0, bySubject: [] },
    };
    const end = to.getTime() < today.getTime() ? to : today;
    if (!groupId || end.getTime() < from.getTime()) return empty;
    const [schedule] = await this.scheduler.build(from, end, [groupId]);
    const [recorded, dayRows, reasons, subjects] = await Promise.all([
      this.prisma.schoolLesson.findMany({
        where: { groupId, date: { gte: from, lte: end } },
        select: {
          date: true,
          period: true,
          subgroupKey: true,
          subjectId: true,
          marks: {
            where: { childId, voidedAt: null },
            select: {
              status: true,
              reasonId: true,
              level: true,
              comment: true,
              voidedAt: true,
            },
          },
        },
      }),
      this.register.childDays([childId], from, end),
      this.prisma.absenceReason.findMany({
        select: { id: true, name: true, excused: true },
      }),
      this.prisma.subject.findMany({ select: { id: true, name: true } }),
    ]);
    const subjectName = (id: string) =>
      subjects.find((s) => s.id === id)?.name ?? null;
    const days = dayRows[0]?.days ?? [];
    const lessons = schedule.days.flatMap((d) => {
      const registerDay =
        days.find((r) => r.date.getTime() === d.date.getTime()) ?? null;
      return d.slots
        .filter((s) => !s.cancelled && applies(s))
        .flatMap((s) => {
          const lesson = recorded.find(
            (l) =>
              l.date.getTime() === d.date.getTime() &&
              l.period === s.period &&
              l.subgroupKey === subgroupKey(s.subgroupId),
          );
          const mark = lesson?.marks[0] ?? null;
          const state = pupilState(
            registerDay?.state ?? null,
            registerDay?.reasonId ?? null,
            mark,
          );
          if (state.status === null) return [];
          return [
            {
              date: isoDay(d.date),
              period: s.period,
              subjectName: subjectName(lesson?.subjectId ?? s.subjectId),
              status: state.status,
              reasonName: state.reasonId
                ? (reasons.find((r) => r.id === state.reasonId)?.name ?? null)
                : null,
              level: mark?.level ?? null,
              comment: mark?.comment ?? null,
              source: state.source,
            },
          ];
        });
    });
    const missedRows = lessons.filter((l) => l.status === LessonStatus.absent);
    const excusedNames = new Set(
      reasons.filter((r) => r.excused).map((r) => r.name),
    );
    const bySubject = new Map<string, Record<NushLevel, number>>();
    for (const l of lessons) {
      if (!l.level || !l.subjectName) continue;
      const levels = bySubject.get(l.subjectName) ?? emptyLevels();
      levels[l.level] += 1;
      bySubject.set(l.subjectName, levels);
    }
    return {
      month: monthValue,
      lessons,
      summary: {
        missed: missedRows.length,
        missedExcused: missedRows.filter(
          (l) => l.reasonName !== null && excusedNames.has(l.reasonName),
        ).length,
        bySubject: [...bySubject.entries()].map(([name, levels]) => ({
          subjectName: name,
          levels,
        })),
      },
    };
  }
}
