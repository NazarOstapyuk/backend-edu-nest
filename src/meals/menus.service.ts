import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CalendarScope, GroupKind, MenuStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import {
  type CalendarEntryLike,
  dayInfo,
  dayRange,
} from '../attendance/register-calc';
import { parseDay } from '../classes/access';
import { dayCount, isoDay } from '../tariffs/dates';
import { copyTarget } from './meals-calc';
import { CopyMenuDto, MenuPeriodDto, SaveMenuDayDto } from './dto/menu.dto';

export interface FillResult {
  created: number;
  overwritten: number;
  skipped: number;
}

export function parsePeriod(
  fromValue: string,
  toValue: string,
  maxDays: number,
): { from: Date; to: Date } {
  const from = parseDay(fromValue);
  const to = parseDay(toValue);
  if (to.getTime() < from.getTime())
    throw new BadRequestException('Invalid period');
  if (dayCount(from, to) > maxDays)
    throw new BadRequestException('Period is too long');
  return { from, to };
}

const dishSelect = {
  id: true,
  name: true,
  active: true,
  course: { select: { id: true, name: true, sortOrder: true } },
} as const;

const sortDishes = <
  T extends { name: string; course: { sortOrder: number; name: string } },
>(
  dishes: T[],
) =>
  [...dishes].sort(
    (a, b) =>
      a.course.sortOrder - b.course.sortOrder ||
      a.course.name.localeCompare(b.course.name) ||
      a.name.localeCompare(b.name),
  );

@Injectable()
export class MenusService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  workingFor(kind: GroupKind, entries: CalendarEntryLike[]) {
    const scoped = entries.filter((e) => e.scope !== CalendarScope.group);
    return (day: Date) => dayInfo(day, { id: '', kind }, scoped);
  }

  async list(query: MenuPeriodDto) {
    const { from, to } = parsePeriod(query.from, query.to, 62);
    return this.views(query.kind, from, to);
  }

  private async views(kind: GroupKind, from: Date, to: Date) {
    const [entries, days] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.prisma.menuDay.findMany({
        where: { kind, date: { gte: from, lte: to } },
        include: { items: { select: { dish: { select: dishSelect } } } },
      }),
    ]);
    const counts = days.length
      ? await this.prisma.mealOrder.groupBy({
          by: ['menuDayId'],
          where: {
            menuDayId: { in: days.map((d) => d.id) },
            cancelledAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const working = this.workingFor(kind, entries);
    return dayRange(from, to).map((date) => {
      const info = working(date);
      const menu = days.find((d) => d.date.getTime() === date.getTime());
      return {
        date: isoDay(date),
        working: info.working,
        title: info.title,
        menu: menu
          ? {
              id: menu.id,
              status: menu.status,
              publishedAt: menu.publishedAt,
              activeOrders:
                counts.find((c) => c.menuDayId === menu.id)?._count._all ?? 0,
              dishes: sortDishes(menu.items.map((i) => i.dish)),
            }
          : null,
      };
    });
  }

  async saveDay(dateValue: string, kind: GroupKind, dto: SaveMenuDayDto) {
    const date = parseDay(dateValue);
    const entries = await this.calendar.entriesBetween(date, date);
    if (!this.workingFor(kind, entries)(date).working)
      throw new BadRequestException('Day is not a working day');
    const dishes = dto.dishIds.length
      ? await this.prisma.dish.findMany({
          where: { id: { in: dto.dishIds } },
          select: { id: true, active: true },
        })
      : [];
    if (dto.dishIds.some((id) => !dishes.some((d) => d.id === id)))
      throw new NotFoundException('Dish not found');
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.menuDay.findUnique({
        where: { date_kind: { date, kind } },
        select: { id: true },
      });
      let current: string[] = [];
      if (existing) {
        await tx.$queryRaw`SELECT id FROM "MenuDay" WHERE id = ${existing.id} FOR UPDATE`;
        const items = await tx.menuDayItem.findMany({
          where: { menuDayId: existing.id },
          select: { dishId: true },
        });
        current = items.map((i) => i.dishId);
      }
      if (dishes.some((d) => !d.active && !current.includes(d.id)))
        throw new BadRequestException('Dish is inactive');
      const removed = current.filter((id) => !dto.dishIds.includes(id));
      if (existing && removed.length) {
        const used = await tx.mealOrderItem.count({
          where: {
            dishId: { in: removed },
            order: { menuDayId: existing.id, cancelledAt: null },
          },
        });
        if (used) throw new BadRequestException('Dish is ordered');
      }
      const day = await tx.menuDay.upsert({
        where: { date_kind: { date, kind } },
        create: { date, kind },
        update: {},
      });
      await tx.menuDayItem.deleteMany({ where: { menuDayId: day.id } });
      await tx.menuDayItem.createMany({
        data: dto.dishIds.map((dishId) => ({ menuDayId: day.id, dishId })),
      });
    });
    const [view] = await this.views(kind, date, date);
    return view;
  }

  async publish(dto: MenuPeriodDto) {
    const { from, to } = parsePeriod(dto.from, dto.to, 92);
    const { count } = await this.prisma.menuDay.updateMany({
      where: {
        kind: dto.kind,
        date: { gte: from, lte: to },
        status: MenuStatus.draft,
        items: { some: {} },
      },
      data: { status: MenuStatus.published, publishedAt: new Date() },
    });
    return { count };
  }

  async unpublish(dto: MenuPeriodDto) {
    const { from, to } = parsePeriod(dto.from, dto.to, 92);
    return this.prisma.$transaction(async (tx) => {
      const days = await tx.menuDay.findMany({
        where: {
          kind: dto.kind,
          date: { gte: from, lte: to },
          status: MenuStatus.published,
        },
        select: { id: true },
      });
      if (!days.length) return { count: 0 };
      const ids = days.map((d) => d.id);
      await tx.$queryRaw`SELECT id FROM "MenuDay" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const orders = await tx.mealOrder.count({
        where: { menuDayId: { in: ids }, cancelledAt: null },
      });
      if (orders) throw new BadRequestException('Menu has orders');
      const { count } = await tx.menuDay.updateMany({
        where: { id: { in: ids } },
        data: { status: MenuStatus.draft, publishedAt: null },
      });
      return { count };
    });
  }

  async fill(
    kind: GroupKind,
    plan: { date: Date; dishIds: string[] }[],
    overwrite: boolean,
  ): Promise<FillResult> {
    const result: FillResult = { created: 0, overwritten: 0, skipped: 0 };
    if (!plan.length) return result;
    const times = plan.map((p) => p.date.getTime());
    const from = new Date(Math.min(...times));
    const to = new Date(Math.max(...times));
    const [entries, existing] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.prisma.menuDay.findMany({
        where: { kind, date: { gte: from, lte: to } },
        select: { id: true, date: true, status: true },
      }),
    ]);
    const working = this.workingFor(kind, entries);
    await this.prisma.$transaction(async (tx) => {
      const blocked = new Set<string>();
      const draftIds = existing
        .filter((e) => e.status === MenuStatus.draft)
        .map((e) => e.id);
      if (overwrite && draftIds.length) {
        const ids = draftIds;
        await tx.$queryRaw`SELECT id FROM "MenuDay" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        const fresh = await tx.menuDay.findMany({
          where: { id: { in: ids } },
          select: { id: true, status: true },
        });
        const ordered = await tx.mealOrder.groupBy({
          by: ['menuDayId'],
          where: { menuDayId: { in: ids }, cancelledAt: null },
        });
        for (const f of fresh)
          if (f.status === MenuStatus.published) blocked.add(f.id);
        for (const o of ordered) blocked.add(o.menuDayId);
      }
      for (const item of plan) {
        if (!working(item.date).working) {
          result.skipped++;
          continue;
        }
        const current = existing.find(
          (e) => e.date.getTime() === item.date.getTime(),
        );
        if (current) {
          if (
            !overwrite ||
            current.status === MenuStatus.published ||
            blocked.has(current.id)
          ) {
            result.skipped++;
            continue;
          }
          await tx.menuDayItem.deleteMany({ where: { menuDayId: current.id } });
          await tx.menuDayItem.createMany({
            data: item.dishIds.map((dishId) => ({
              menuDayId: current.id,
              dishId,
            })),
          });
          result.overwritten++;
        } else {
          await tx.menuDay.create({
            data: {
              date: item.date,
              kind,
              items: { create: item.dishIds.map((dishId) => ({ dishId })) },
            },
          });
          result.created++;
        }
      }
    });
    return result;
  }

  async copy(dto: CopyMenuDto) {
    const { from, to } = parsePeriod(dto.fromStart, dto.fromEnd, 92);
    const toStart = parseDay(dto.toStart);
    const source = await this.prisma.menuDay.findMany({
      where: { kind: dto.kind, date: { gte: from, lte: to } },
      select: {
        date: true,
        items: { select: { dishId: true, dish: { select: { active: true } } } },
      },
      orderBy: { date: 'asc' },
    });
    const plan = source
      .map((d) => ({
        date: copyTarget(from, toStart, d.date),
        dishIds: d.items.filter((i) => i.dish.active).map((i) => i.dishId),
      }))
      .filter((p) => p.dishIds.length);
    return this.fill(dto.kind, plan, dto.overwrite ?? false);
  }

  async deleteDay(dateValue: string, kind: GroupKind) {
    const date = parseDay(dateValue);
    await this.prisma.$transaction(async (tx) => {
      const day = await tx.menuDay.findUnique({
        where: { date_kind: { date, kind } },
        select: { id: true },
      });
      if (!day) throw new NotFoundException('Menu day not found');
      await tx.$queryRaw`SELECT id FROM "MenuDay" WHERE id = ${day.id} FOR UPDATE`;
      const fresh = await tx.menuDay.findUnique({
        where: { id: day.id },
        select: { status: true },
      });
      if (!fresh) throw new NotFoundException('Menu day not found');
      if (fresh.status === MenuStatus.published)
        throw new BadRequestException('Menu is published');
      if (await tx.mealOrder.count({ where: { menuDayId: day.id } }))
        throw new BadRequestException('Menu has orders');
      await tx.menuDay.delete({ where: { id: day.id } });
    });
    return { message: 'Menu day deleted' };
  }
}
