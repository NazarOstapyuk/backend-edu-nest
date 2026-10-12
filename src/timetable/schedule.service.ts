import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { dayInfo, dayRange } from '../attendance/register-calc';
import {
  type ChangeLike,
  type Conflict,
  type PeriodLike,
  type Slot,
  slotsForDay,
  versionOn,
} from './schedule-calc';

export const subgroupKey = (id: string | null): string => id ?? 'class';

export interface ScheduleDay {
  date: Date;
  working: boolean;
  title: string | null;
  slots: Slot[];
}

export interface ClassSchedule {
  group: { id: string; name: string; periods: PeriodLike[] };
  days: ScheduleDay[];
}

export interface PendingChange {
  groupId: string;
  change: ChangeLike & { date: Date };
}

export interface ConflictRef {
  groupName: string;
  weekday: number | null;
  date: string | null;
  period: number;
  subjectId: string;
  isNew: boolean;
}

const periodSelect = {
  select: { number: true, startTime: true, endTime: true },
  orderBy: { number: 'asc' },
} as const;

@Injectable()
export class ScheduleService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  async requireClass(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        kind: true,
        bellSchedule: { select: { periods: periodSelect } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.kind !== GroupKind.school_class)
      throw new BadRequestException('Not a school class');
    if (!group.bellSchedule)
      throw new BadRequestException('Class has no bell schedule');
    return {
      id: group.id,
      name: group.name,
      periods: group.bellSchedule.periods,
    };
  }

  async build(
    from: Date,
    to: Date,
    groupIds?: string[],
    pending?: PendingChange,
  ): Promise<ClassSchedule[]> {
    const [groups, calendarEntries] = await Promise.all([
      this.prisma.group.findMany({
        where: {
          kind: GroupKind.school_class,
          ...(groupIds ? { id: { in: groupIds } } : {}),
        },
        select: {
          id: true,
          name: true,
          kind: true,
          bellSchedule: { select: { periods: periodSelect } },
          timetables: {
            where: {
              validFrom: { lte: to },
              OR: [{ validTo: null }, { validTo: { gte: from } }],
            },
            include: { entries: true },
          },
          lessonChanges: {
            where: { date: { gte: from, lte: to }, voidedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.calendar.entriesBetween(from, to),
    ]);
    const days = dayRange(from, to);
    return groups.map((group) => {
      const periods = group.bellSchedule?.periods ?? [];
      const changes: (ChangeLike & { date: Date })[] = [
        ...group.lessonChanges,
        ...(pending && pending.groupId === group.id ? [pending.change] : []),
      ];
      return {
        group: { id: group.id, name: group.name, periods },
        days: days.map((date) => {
          const info = dayInfo(date, group, calendarEntries);
          const version = versionOn(group.timetables, date);
          return {
            date,
            working: info.working,
            title: info.title,
            slots: slotsForDay(date, {
              working: info.working,
              entries: version?.entries ?? [],
              changes: changes.filter(
                (c) => c.date.getTime() === date.getTime(),
              ),
              periods,
            }),
          };
        }),
      };
    });
  }

  async describe(slots: Slot[]) {
    const ids = (pick: (slot: Slot) => string | null) => [
      ...new Set(slots.map(pick).filter((v): v is string => !!v)),
    ];
    const [subjects, teachers, rooms, subgroups] = await Promise.all([
      this.prisma.subject.findMany({
        where: { id: { in: ids((s) => s.subjectId) } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids((s) => s.teacherId) } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.room.findMany({
        where: { id: { in: ids((s) => s.roomId) } },
        select: { id: true, name: true },
      }),
      this.prisma.subgroup.findMany({
        where: { id: { in: ids((s) => s.subgroupId) } },
        select: { id: true, name: true },
      }),
    ]);
    const find = <T extends { id: string }>(list: T[], id: string | null) =>
      id ? (list.find((x) => x.id === id) ?? null) : null;
    return (slot: Slot) => {
      const teacher = find(teachers, slot.teacherId);
      return {
        subjectName: find(subjects, slot.subjectId)?.name ?? null,
        teacherName: teacher
          ? `${teacher.lastName} ${teacher.firstName}`
          : null,
        roomName: find(rooms, slot.roomId)?.name ?? null,
        subgroupName: find(subgroups, slot.subgroupId)?.name ?? null,
      };
    };
  }

  async throwConflicts(
    conflicts: Conflict[],
    refs: Map<string, ConflictRef>,
  ): Promise<never> {
    const subjectIds = [...new Set([...refs.values()].map((r) => r.subjectId))];
    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true },
    });
    const subjectName = (id: string) =>
      subjects.find((s) => s.id === id)?.name ?? null;
    throw new ConflictException({
      statusCode: 409,
      message: 'Schedule conflict',
      error: 'Conflict',
      conflicts: conflicts.map((c) => {
        const first = refs.get(c.a) as ConflictRef;
        const second = refs.get(c.b) as ConflictRef;
        const [own, other] = first.isNew ? [first, second] : [second, first];
        return {
          kind: c.kind,
          weekday: own.weekday,
          date: own.date,
          period: own.period,
          groupName: own.groupName,
          subjectName: subjectName(own.subjectId),
          other: {
            groupName: other.groupName,
            period: other.period,
            subjectName: subjectName(other.subjectId),
          },
        };
      }),
    });
  }
}
