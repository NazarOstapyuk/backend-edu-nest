import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, WeekParity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { addDays, dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { isTimetableManager } from './roles';
import {
  type ConflictItem,
  type EntryLike,
  type PeriodLike,
  findConflicts,
  toMinutes,
} from './schedule-calc';
import {
  type ConflictRef,
  ScheduleService,
  subgroupKey,
} from './schedule.service';
import {
  CreateTimetableDto,
  TimetableEntriesDto,
  TimetableEntryDto,
} from './dto/timetable.dto';

type ClassInfo = { id: string; name: string; periods: PeriodLike[] };

const toEntry = (dto: TimetableEntryDto): EntryLike => ({
  weekday: dto.weekday,
  period: dto.period,
  parity: dto.parity ?? WeekParity.every,
  subjectId: dto.subjectId,
  teacherId: dto.teacherId,
  roomId: dto.roomId ?? null,
  subgroupId: dto.subgroupId ?? null,
});

const unique = (values: (string | null | undefined)[]) => [
  ...new Set(values.filter((v): v is string => !!v)),
];

@Injectable()
export class TimetablesService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
  ) {}

  async list(groupId: string) {
    await this.schedule.requireClass(groupId);
    const versions = await this.prisma.timetable.findMany({
      where: { groupId },
      include: {
        entries: { orderBy: [{ weekday: 'asc' }, { period: 'asc' }] },
      },
      orderBy: { validFrom: 'asc' },
    });
    return versions.map((v) => ({
      ...v,
      validFrom: isoDay(v.validFrom),
      validTo: v.validTo ? isoDay(v.validTo) : null,
    }));
  }

  private async validateEntries(
    group: ClassInfo,
    entries: TimetableEntryDto[],
  ) {
    const numbers = new Set(group.periods.map((p) => p.number));
    if (entries.some((e) => !numbers.has(e.period)))
      throw new BadRequestException('Bell period not found');
    const subgroupIds = unique(entries.map((e) => e.subgroupId));
    if (subgroupIds.length) {
      const count = await this.prisma.subgroup.count({
        where: { id: { in: subgroupIds }, groupId: group.id },
      });
      if (count !== subgroupIds.length)
        throw new BadRequestException('Subgroup does not belong to this class');
    }
    const subjectIds = unique(entries.map((e) => e.subjectId));
    if (
      subjectIds.length &&
      (await this.prisma.subject.count({
        where: { id: { in: subjectIds }, active: true },
      })) !== subjectIds.length
    )
      throw new NotFoundException('Subject not found');
    const roomIds = unique(entries.map((e) => e.roomId));
    if (
      roomIds.length &&
      (await this.prisma.room.count({
        where: { id: { in: roomIds }, active: true },
      })) !== roomIds.length
    )
      throw new NotFoundException('Room not found');
    const teacherIds = unique(entries.map((e) => e.teacherId));
    if (
      teacherIds.length &&
      (await this.prisma.user.count({
        where: { id: { in: teacherIds }, role: Role.teacher, isActive: true },
      })) !== teacherIds.length
    )
      throw new BadRequestException('User is not a teacher');
  }

  private async assertNoConflicts(
    group: ClassInfo,
    entries: EntryLike[],
    start: Date,
    end: Date | null,
  ) {
    const [others, members] = await Promise.all([
      this.prisma.timetable.findMany({
        where: {
          groupId: { not: group.id },
          ...(end ? { validFrom: { lte: end } } : {}),
          OR: [{ validTo: null }, { validTo: { gte: start } }],
        },
        include: {
          entries: true,
          group: {
            select: {
              name: true,
              bellSchedule: { select: { periods: true } },
            },
          },
        },
      }),
      this.prisma.subgroupMember.findMany({
        where: { subgroup: { groupId: group.id } },
        select: { subgroupId: true, childId: true },
      }),
    ]);
    const items: ConflictItem[] = [];
    const refs = new Map<string, ConflictRef>();
    const add = (
      ref: string,
      groupId: string,
      groupName: string,
      periods: PeriodLike[],
      e: EntryLike,
      isNew: boolean,
    ) => {
      const bell = periods.find((p) => p.number === e.period);
      if (!bell) return;
      refs.set(ref, {
        groupName,
        weekday: e.weekday,
        date: null,
        period: e.period,
        subjectId: e.subjectId,
        isNew,
      });
      items.push({
        ref,
        bucket: String(e.weekday),
        parity: e.parity,
        start: toMinutes(bell.startTime),
        end: toMinutes(bell.endTime),
        groupId,
        teacherId: e.teacherId,
        roomId: e.roomId,
        subgroupId: e.subgroupId,
        memberIds:
          groupId === group.id && e.subgroupId
            ? members
                .filter((m) => m.subgroupId === e.subgroupId)
                .map((m) => m.childId)
            : [],
        isNew,
      });
    };
    entries.forEach((e, i) =>
      add(`new-${i}`, group.id, group.name, group.periods, e, true),
    );
    for (const other of others) {
      for (const e of other.entries)
        add(
          e.id,
          other.groupId,
          other.group.name,
          other.group.bellSchedule?.periods ?? [],
          e,
          false,
        );
    }
    const conflicts = findConflicts(items);
    if (conflicts.length) await this.schedule.throwConflicts(conflicts, refs);
  }

  async create(
    groupId: string,
    dto: CreateTimetableDto,
    user: AuthenticatedUser,
  ) {
    const group = await this.schedule.requireClass(groupId);
    const validFrom = parseDay(dto.validFrom);
    await this.validateEntries(group, dto.entries);
    const versions = await this.prisma.timetable.findMany({
      where: { groupId },
      orderBy: { validFrom: 'asc' },
    });
    if (versions.some((v) => v.validFrom.getTime() >= validFrom.getTime()))
      throw new BadRequestException('Timetable periods overlap');
    const recorded = await this.prisma.schoolLesson.count({
      where: { groupId, date: { gte: validFrom } },
    });
    if (recorded > 0) throw new BadRequestException('Lesson already recorded');
    const entries = dto.entries.map(toEntry);
    await this.assertNoConflicts(group, entries, validFrom, null);
    const previous = versions[versions.length - 1];
    return this.prisma.$transaction(async (tx) => {
      if (
        previous &&
        (previous.validTo === null ||
          previous.validTo.getTime() >= validFrom.getTime())
      ) {
        await tx.timetable.update({
          where: { id: previous.id },
          data: { validTo: addDays(validFrom, -1) },
        });
      }
      return tx.timetable.create({
        data: {
          groupId,
          validFrom,
          createdById: user.id,
          entries: { create: entries },
        },
        include: { entries: true },
      });
    });
  }

  async replaceEntries(
    id: string,
    dto: TimetableEntriesDto,
    today: Date = kyivToday(),
  ) {
    const version = await this.prisma.timetable.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Timetable not found');
    if (version.validFrom.getTime() <= today.getTime())
      throw new BadRequestException('Timetable already started');
    const group = await this.schedule.requireClass(version.groupId);
    await this.validateEntries(group, dto.entries);
    const entries = dto.entries.map(toEntry);
    await this.assertNoConflicts(
      group,
      entries,
      version.validFrom,
      version.validTo,
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.timetableEntry.deleteMany({ where: { timetableId: id } });
      await tx.timetableEntry.createMany({
        data: entries.map((e) => ({ ...e, timetableId: id })),
      });
      return tx.timetable.findUnique({
        where: { id },
        include: { entries: true },
      });
    });
  }

  async view(
    groupId: string,
    fromValue: string,
    toValue: string,
    user: AuthenticatedUser,
  ) {
    const from = parseDay(fromValue);
    const to = parseDay(toValue);
    if (to.getTime() < from.getTime() || dayCount(from, to) > 31)
      throw new BadRequestException('Invalid period');
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
    if (group.kind !== 'school_class')
      throw new BadRequestException('Not a school class');
    const [schedule] = await this.schedule.build(from, to, [groupId]);
    const slots = schedule.days.flatMap((d) => d.slots);
    if (
      !isTimetableManager(user) &&
      !group.teachers.some((t) => t.id === user.id) &&
      !slots.some((s) => s.teacherId === user.id)
    )
      throw new ForbiddenException('Not your group');
    const [lessons, names] = await Promise.all([
      this.prisma.schoolLesson.findMany({
        where: { groupId, date: { gte: from, lte: to } },
        select: { id: true, date: true, period: true, subgroupKey: true },
      }),
      this.schedule.describe(slots),
    ]);
    return {
      group: { id: group.id, name: group.name },
      periods: schedule.group.periods,
      days: schedule.days.map((d) => ({
        date: isoDay(d.date),
        working: d.working,
        title: d.title,
        slots: d.slots.map((s) => ({
          ...s,
          ...names(s),
          lessonId:
            lessons.find(
              (l) =>
                l.date.getTime() === d.date.getTime() &&
                l.period === s.period &&
                l.subgroupKey === subgroupKey(s.subgroupId),
            )?.id ?? null,
        })),
      })),
    };
  }
}
