import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind, Prisma } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { groupScopeWhere } from '../access/scope';
import { CalendarService } from '../attendance/calendar.service';
import { parseDay } from '../classes/access';
import { assertOwnChild } from '../common/ownership';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { findInstitution } from '../institutions/institution-checks';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { isTimetableManager } from '../timetable/roles';
import {
  CopyRoutineDto,
  CreateRoutineTemplateDto,
  RoutineItemDto,
  RoutineTemplateItemDto,
  SaveRoutineDayDto,
  UpdateRoutineTemplateDto,
} from './dto/routine.dto';
import { normalizeItems, resolveRoutine, versionBounds } from './routine-calc';

const MAX_DAYS = 62;
const MAX_ITEMS = 60;

type Db = Prisma.TransactionClient;

type RoutineGroup = {
  id: string;
  name: string;
  kind: GroupKind;
  institutionId: string;
};

const groupSelect = {
  id: true,
  name: true,
  kind: true,
  institutionId: true,
  teachers: { select: { id: true } },
} as const;

const itemOrder = [{ weekday: 'asc' }, { sortOrder: 'asc' }] as const;

type TemplateRow = {
  id: string;
  validFrom: Date;
  validTo: Date | null;
  workingHours: string | null;
  note: string | null;
  items: {
    weekday: number;
    startTime: string;
    endTime: string;
    title: string;
  }[];
};

const templateView = (t: TemplateRow) => ({
  id: t.id,
  validFrom: isoDay(t.validFrom),
  validTo: t.validTo ? isoDay(t.validTo) : null,
  workingHours: t.workingHours,
  note: t.note,
  items: t.items.map(({ weekday, startTime, endTime, title }) => ({
    weekday,
    startTime,
    endTime,
    title,
  })),
});

const text = (value: string | undefined | null): string | null =>
  value?.trim() || null;

const assertCount = (count: number) => {
  if (count > MAX_ITEMS) throw new BadRequestException('Too many items');
};

function templateItems(items: RoutineTemplateItemDto[]) {
  const perDay = new Map<number, number>();
  for (const i of items)
    perDay.set(i.weekday, (perDay.get(i.weekday) ?? 0) + 1);
  perDay.forEach(assertCount);
  return normalizeItems(
    items.map(({ weekday, startTime, endTime, title }) => ({
      weekday,
      startTime,
      endTime,
      title,
    })),
  );
}

function dayItems(items: RoutineItemDto[]) {
  assertCount(items.length);
  return normalizeItems(
    items.map(({ startTime, endTime, title }) => ({
      startTime,
      endTime,
      title,
    })),
  );
}

function period(fromValue?: string, toValue?: string) {
  const from = fromValue ? parseDay(fromValue) : kyivToday();
  const to = toValue ? parseDay(toValue) : addDays(from, 6);
  if (to.getTime() < from.getTime())
    throw new BadRequestException('Invalid period');
  if (dayCount(from, to) > MAX_DAYS)
    throw new BadRequestException('Period too long');
  return { from, to };
}

@Injectable()
export class RoutineService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  private async findGroup(db: Db, user: AuthenticatedUser, id: string) {
    const group = await db.group.findFirst({
      where: { id, ...groupScopeWhere(scopeIds(user)) },
      select: groupSelect,
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  private assertKindergarten(group: { kind: GroupKind }) {
    if (group.kind !== GroupKind.kindergarten)
      throw new BadRequestException('Routine is for kindergarten groups');
  }

  private async readableGroup(user: AuthenticatedUser, id: string) {
    const group = await this.findGroup(this.prisma, user, id);
    if (
      !isTimetableManager(user) &&
      !group.teachers.some((t) => t.id === user.id)
    )
      throw new NotFoundException('Group not found');
    this.assertKindergarten(group);
    return group;
  }

  private async writableGroup(db: Db, user: AuthenticatedUser, id: string) {
    const group = await this.findGroup(db, user, id);
    this.assertKindergarten(group);
    await findInstitution(db, group.institutionId, { active: true });
    return group;
  }

  private lockGroup(db: Db, id: string) {
    return db.$queryRaw`SELECT id FROM "Group" WHERE id = ${id} FOR UPDATE`;
  }

  private async build(group: RoutineGroup, from: Date, to: Date) {
    const [versions, overrides, entries] = await Promise.all([
      this.prisma.routineTemplate.findMany({
        where: {
          groupId: group.id,
          validFrom: { lte: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
        include: { items: true },
      }),
      this.prisma.routineDay.findMany({
        where: { groupId: group.id, date: { gte: from, lte: to } },
        include: { items: true },
      }),
      this.calendar.entriesBetween(from, to),
    ]);
    return {
      group: { id: group.id, name: group.name },
      days: resolveRoutine({
        from,
        to,
        group: {
          id: group.id,
          kind: group.kind,
          institutionId: group.institutionId,
        },
        entries,
        versions,
        overrides,
      }),
    };
  }

  private async dayView(group: RoutineGroup, day: Date) {
    const { days } = await this.build(group, day, day);
    return days[0];
  }

  async routine(
    user: AuthenticatedUser,
    id: string,
    from?: string,
    to?: string,
  ) {
    const range = period(from, to);
    const group = await this.readableGroup(user, id);
    return this.build(group, range.from, range.to);
  }

  async groups(user: AuthenticatedUser) {
    const rows = await this.prisma.group.findMany({
      where: {
        kind: GroupKind.kindergarten,
        ...groupScopeWhere(scopeIds(user)),
        ...(isTimetableManager(user)
          ? {}
          : { teachers: { some: { id: user.id } } }),
      },
      select: {
        id: true,
        name: true,
        institution: { select: { id: true, name: true } },
        _count: { select: { routineTemplates: true } },
      },
      orderBy: [{ institution: { name: 'asc' } }, { name: 'asc' }],
    });
    return rows.map(({ _count, ...group }) => ({
      ...group,
      hasTemplate: _count.routineTemplates > 0,
    }));
  }

  async templates(user: AuthenticatedUser, id: string) {
    const group = await this.readableGroup(user, id);
    const rows = await this.prisma.routineTemplate.findMany({
      where: { groupId: group.id },
      orderBy: { validFrom: 'asc' },
      include: { items: { orderBy: [...itemOrder] } },
    });
    return rows.map(templateView);
  }

  private async insertVersion(
    tx: Db,
    user: AuthenticatedUser,
    groupId: string,
    validFrom: Date,
    data: {
      workingHours: string | null;
      note: string | null;
      items: ReturnType<typeof templateItems>;
    },
  ) {
    await this.lockGroup(tx, groupId);
    const existing = await tx.routineTemplate.findMany({
      where: { groupId },
      select: { id: true, validFrom: true, validTo: true },
    });
    if (existing.some((v) => v.validFrom.getTime() === validFrom.getTime()))
      throw new ConflictException(
        'Routine version already starts on this date',
      );
    const bounds = versionBounds(existing, validFrom);
    if (bounds.close)
      await tx.routineTemplate.update({
        where: { id: bounds.close.id },
        data: { validTo: bounds.close.validTo },
      });
    const created = await tx.routineTemplate.create({
      data: {
        groupId,
        validFrom,
        validTo: bounds.validTo,
        workingHours: data.workingHours,
        note: data.note,
        createdById: user.id,
        items: { create: data.items },
      },
      include: { items: { orderBy: [...itemOrder] } },
    });
    return templateView(created);
  }

  async createTemplate(
    user: AuthenticatedUser,
    id: string,
    dto: CreateRoutineTemplateDto,
  ) {
    const validFrom = parseDay(dto.validFrom);
    const items = templateItems(dto.items);
    return this.prisma.$transaction(async (tx) => {
      const group = await this.writableGroup(tx, user, id);
      return this.insertVersion(tx, user, group.id, validFrom, {
        workingHours: text(dto.workingHours),
        note: text(dto.note),
        items,
      });
    });
  }

  private async findTemplate(db: Db, user: AuthenticatedUser, id: string) {
    const template = await db.routineTemplate.findFirst({
      where: { id, group: groupScopeWhere(scopeIds(user)) },
      select: { id: true, groupId: true },
    });
    if (!template) throw new NotFoundException('Routine template not found');
    return template;
  }

  async updateTemplate(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateRoutineTemplateDto,
  ) {
    const items = templateItems(dto.items);
    return this.prisma.$transaction(async (tx) => {
      const template = await this.findTemplate(tx, user, id);
      await this.writableGroup(tx, user, template.groupId);
      await this.lockGroup(tx, template.groupId);
      const current = await tx.routineTemplate.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!current) throw new NotFoundException('Routine template not found');
      await tx.routineTemplateItem.deleteMany({ where: { templateId: id } });
      const updated = await tx.routineTemplate.update({
        where: { id },
        data: {
          workingHours: text(dto.workingHours),
          note: text(dto.note),
          items: { create: items },
        },
        include: { items: { orderBy: [...itemOrder] } },
      });
      return templateView(updated);
    });
  }

  async deleteTemplate(user: AuthenticatedUser, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const template = await this.findTemplate(tx, user, id);
      await this.writableGroup(tx, user, template.groupId);
      await this.lockGroup(tx, template.groupId);
      const versions = await tx.routineTemplate.findMany({
        where: { groupId: template.groupId },
        select: { id: true, validFrom: true, validTo: true },
      });
      const target = versions.find((v) => v.id === id);
      if (!target) throw new NotFoundException('Routine template not found');
      const previous = versions
        .filter((v) => v.validFrom.getTime() < target.validFrom.getTime())
        .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
      if (previous)
        await tx.routineTemplate.update({
          where: { id: previous.id },
          data: { validTo: target.validTo },
        });
      await tx.routineTemplate.delete({ where: { id } });
    });
    return { message: 'Routine template deleted' };
  }

  async copy(user: AuthenticatedUser, id: string, dto: CopyRoutineDto) {
    if (dto.sourceGroupId === id)
      throw new BadRequestException('Cannot copy to the same group');
    const validFrom = parseDay(dto.validFrom);
    return this.prisma.$transaction(async (tx) => {
      const target = await this.writableGroup(tx, user, id);
      const source = await this.findGroup(tx, user, dto.sourceGroupId);
      this.assertKindergarten(source);
      const version = await tx.routineTemplate.findFirst({
        where: {
          groupId: source.id,
          validFrom: { lte: validFrom },
          OR: [{ validTo: null }, { validTo: { gte: validFrom } }],
        },
        include: { items: true },
      });
      if (!version) throw new NotFoundException('Routine template not found');
      return this.insertVersion(tx, user, target.id, validFrom, {
        workingHours: version.workingHours,
        note: version.note,
        items: [...version.items]
          .sort((a, b) => a.weekday - b.weekday || a.sortOrder - b.sortOrder)
          .map(({ weekday, startTime, endTime, title, sortOrder }) => ({
            weekday,
            startTime,
            endTime,
            title,
            sortOrder,
          })),
      });
    });
  }

  async saveDay(
    user: AuthenticatedUser,
    id: string,
    date: string,
    dto: SaveRoutineDayDto,
  ) {
    const day = parseDay(date);
    const items = dayItems(dto.items);
    const note = text(dto.note);
    const group = await this.prisma.$transaction(async (tx) => {
      const found = await this.writableGroup(tx, user, id);
      await this.lockGroup(tx, found.id);
      const existing = await tx.routineDay.findUnique({
        where: { groupId_date: { groupId: found.id, date: day } },
        select: { id: true },
      });
      if (existing) {
        await tx.routineDayItem.deleteMany({ where: { dayId: existing.id } });
        await tx.routineDay.update({
          where: { id: existing.id },
          data: { note, items: { create: items } },
        });
      } else {
        await tx.routineDay.create({
          data: {
            groupId: found.id,
            date: day,
            note,
            createdById: user.id,
            items: { create: items },
          },
        });
      }
      return found;
    });
    return this.dayView(group, day);
  }

  async deleteDay(user: AuthenticatedUser, id: string, date: string) {
    const day = parseDay(date);
    const group = await this.prisma.$transaction(async (tx) => {
      const found = await this.writableGroup(tx, user, id);
      await this.lockGroup(tx, found.id);
      await tx.routineDay.deleteMany({
        where: { groupId: found.id, date: day },
      });
      return found;
    });
    return this.dayView(group, day);
  }

  async parentRoutine(
    parentId: string,
    childId: string,
    from?: string,
    to?: string,
  ) {
    const range = period(from, to);
    await assertOwnChild(this.prisma, parentId, childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: {
        group: {
          select: { id: true, name: true, kind: true, institutionId: true },
        },
      },
    });
    const group = child?.group;
    if (!group || group.kind !== GroupKind.kindergarten)
      return { group: null, days: [] };
    return this.build(group, range.from, range.to);
  }
}
