import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CalendarScope,
  type Institution,
  type InstitutionType,
  MenuStatus,
  Prisma,
} from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { assertInstitutionInScope } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import {
  type CalendarEntryLike,
  dayInfo,
  dayRange,
} from '../attendance/register-calc';
import { parseDay } from '../classes/access';
import { findInstitution } from '../institutions/institution-checks';
import { dayCount, isoDay } from '../tariffs/dates';
import { copyTarget } from './meals-calc';
import {
  CopyMenuDto,
  MenuPeriodDto,
  MenuRangeDto,
  SaveMenuDayDto,
} from './dto/menu.dto';

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

type InstitutionRef = { id: string; type: InstitutionType };

const byId = <T extends { id: string }>(list: T[]) =>
  [...list].sort((a, b) => a.id.localeCompare(b.id));

@Injectable()
export class MenusService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  workingFor(institution: InstitutionRef, entries: CalendarEntryLike[]) {
    const relevant = entries.filter(
      (e) =>
        e.scope === CalendarScope.all ||
        (e.scope === CalendarScope.institution &&
          e.institutionId === institution.id) ||
        String(e.scope) === String(institution.type),
    );
    const group = {
      id: '',
      kind: institution.type,
      institutionId: institution.id,
    };
    return (day: Date) => dayInfo(day, group, relevant);
  }

  async resolveInstitutions(
    institutionIds: string[],
    user: AuthenticatedUser,
    write: boolean,
  ): Promise<Pick<Institution, 'id' | 'type' | 'isActive' | 'name'>[]> {
    const found: Awaited<ReturnType<typeof findInstitution>>[] = [];
    for (const id of institutionIds)
      found.push(await findInstitution(this.prisma, id));
    const ids = scopeIds(user);
    for (const institution of found)
      assertInstitutionInScope(ids, institution.id);
    if (write && found.some((i) => !i.isActive))
      throw new BadRequestException('Institution is inactive');
    return found;
  }

  async list(query: MenuPeriodDto, user: AuthenticatedUser) {
    const [institution] = await this.resolveInstitutions(
      [query.institutionId],
      user,
      false,
    );
    const { from, to } = parsePeriod(query.from, query.to, 62);
    return this.views(institution, from, to);
  }

  private async views(institution: InstitutionRef, from: Date, to: Date) {
    const [entries, days] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.prisma.menuDay.findMany({
        where: { institutionId: institution.id, date: { gte: from, lte: to } },
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
    const working = this.workingFor(institution, entries);
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

  async saveDay(
    dateValue: string,
    dto: SaveMenuDayDto,
    user: AuthenticatedUser,
  ) {
    const institutions = await this.resolveInstitutions(
      dto.institutionIds,
      user,
      true,
    );
    const date = parseDay(dateValue);
    const entries = await this.calendar.entriesBetween(date, date);
    if (institutions.some((i) => !this.workingFor(i, entries)(date).working))
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
      for (const { id: institutionId } of byId(institutions)) {
        const existing = await tx.menuDay.findUnique({
          where: { date_institutionId: { date, institutionId } },
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
          where: { date_institutionId: { date, institutionId } },
          create: { date, institutionId },
          update: {},
        });
        await tx.menuDayItem.deleteMany({ where: { menuDayId: day.id } });
        await tx.menuDayItem.createMany({
          data: dto.dishIds.map((dishId) => ({ menuDayId: day.id, dishId })),
        });
      }
    });
    const result: Awaited<ReturnType<MenusService['views']>>[number][] = [];
    for (const institution of institutions) {
      const [view] = await this.views(institution, date, date);
      result.push(view);
    }
    return result;
  }

  async publish(dto: MenuRangeDto, user: AuthenticatedUser) {
    const institutions = await this.resolveInstitutions(
      dto.institutionIds,
      user,
      true,
    );
    const { from, to } = parsePeriod(dto.from, dto.to, 92);
    const { count } = await this.prisma.menuDay.updateMany({
      where: {
        institutionId: { in: institutions.map((i) => i.id) },
        date: { gte: from, lte: to },
        status: MenuStatus.draft,
        items: { some: {} },
      },
      data: { status: MenuStatus.published, publishedAt: new Date() },
    });
    return { count };
  }

  async unpublish(dto: MenuRangeDto, user: AuthenticatedUser) {
    const institutions = await this.resolveInstitutions(
      dto.institutionIds,
      user,
      false,
    );
    const { from, to } = parsePeriod(dto.from, dto.to, 92);
    return this.prisma.$transaction(async (tx) => {
      const days = await tx.menuDay.findMany({
        where: {
          institutionId: { in: institutions.map((i) => i.id) },
          date: { gte: from, lte: to },
          status: MenuStatus.published,
        },
        select: { id: true },
      });
      if (!days.length) return { count: 0 };
      const ids = days.map((d) => d.id);
      await tx.$queryRaw`SELECT id FROM "MenuDay" WHERE id IN (${Prisma.join(ids)}) ORDER BY "institutionId", id FOR UPDATE`;
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
    institutions: InstitutionRef[],
    plan: { date: Date; dishIds: string[] }[],
    overwrite: boolean,
  ): Promise<FillResult> {
    const result: FillResult = { created: 0, overwritten: 0, skipped: 0 };
    if (!plan.length) return result;
    const times = plan.map((p) => p.date.getTime());
    const from = new Date(Math.min(...times));
    const to = new Date(Math.max(...times));
    const [entries, existingAll] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.prisma.menuDay.findMany({
        where: {
          institutionId: { in: institutions.map((i) => i.id) },
          date: { gte: from, lte: to },
        },
        select: { id: true, date: true, status: true, institutionId: true },
      }),
    ]);
    await this.prisma.$transaction(async (tx) => {
      for (const institution of byId(institutions)) {
        const existing = existingAll.filter(
          (e) => e.institutionId === institution.id,
        );
        const working = this.workingFor(institution, entries);
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
            await tx.menuDayItem.deleteMany({
              where: { menuDayId: current.id },
            });
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
                institutionId: institution.id,
                items: { create: item.dishIds.map((dishId) => ({ dishId })) },
              },
            });
            result.created++;
          }
        }
      }
    });
    return result;
  }

  async copy(dto: CopyMenuDto, user: AuthenticatedUser) {
    const [source] = await this.resolveInstitutions(
      [dto.sourceInstitutionId],
      user,
      false,
    );
    const targets = await this.resolveInstitutions(
      dto.institutionIds,
      user,
      true,
    );
    const { from, to } = parsePeriod(dto.fromStart, dto.fromEnd, 92);
    const toStart = parseDay(dto.toStart);
    const days = await this.prisma.menuDay.findMany({
      where: { institutionId: source.id, date: { gte: from, lte: to } },
      select: {
        date: true,
        items: { select: { dishId: true, dish: { select: { active: true } } } },
      },
      orderBy: { date: 'asc' },
    });
    const plan = days
      .map((d) => ({
        date: copyTarget(from, toStart, d.date),
        dishIds: d.items.filter((i) => i.dish.active).map((i) => i.dishId),
      }))
      .filter((p) => p.dishIds.length);
    return this.fill(targets, plan, dto.overwrite ?? false);
  }

  async deleteDay(
    dateValue: string,
    institutionId: string,
    user: AuthenticatedUser,
  ) {
    await this.resolveInstitutions([institutionId], user, false);
    const date = parseDay(dateValue);
    await this.prisma.$transaction(async (tx) => {
      const day = await tx.menuDay.findUnique({
        where: { date_institutionId: { date, institutionId } },
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
