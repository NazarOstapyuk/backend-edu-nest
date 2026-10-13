import { Injectable } from '@nestjs/common';
import { MenuStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { assertOwnChild } from '../common/ownership';
import { CalendarService } from '../attendance/calendar.service';
import { dayInfo } from '../attendance/register-calc';
import { formatMoney } from '../finance/finance-calc';
import { isoDay } from '../tariffs/dates';
import {
  deadlineFor,
  isBeforeDeadline,
  priceOn,
  resolveChoices,
} from './meals-calc';
import { MealSettingsService } from './meal-settings.service';
import { MealOrdersService } from './meal-orders.service';
import { parsePeriod } from './menus.service';
import { orderSelect, toOrderView } from './order-view';
import { ParentMealOrdersDto } from './dto/meal-order.dto';

const complexSelect = {
  id: true,
  name: true,
  description: true,
  courses: {
    select: {
      course: { select: { id: true, name: true, sortOrder: true } },
    },
  },
} as const;

type ComplexRow = Prisma.MealComplexGetPayload<{
  select: typeof complexSelect;
}>;

const byCourse = <
  T extends { name: string; course: { sortOrder: number; name: string } },
>(
  a: T,
  b: T,
) =>
  a.course.sortOrder - b.course.sortOrder ||
  a.course.name.localeCompare(b.course.name) ||
  a.name.localeCompare(b.name);

type MenuIssue = 'no_group' | 'no_price_category' | null;

@Injectable()
export class ParentMealsService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private settings: MealSettingsService,
    private orders: MealOrdersService,
  ) {}

  async menu(
    parentId: string,
    childId: string,
    fromValue: string,
    toValue: string,
    now: Date = new Date(),
  ) {
    await assertOwnChild(this.prisma, parentId, childId);
    const { from, to } = parsePeriod(fromValue, toValue, 31);
    const deadline = await this.settings.getDeadline();
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: {
        id: true,
        group: {
          select: {
            id: true,
            kind: true,
            mealPriceCategory: { select: { id: true, active: true } },
          },
        },
      },
    });
    const group = child?.group;
    if (!group) return { deadline, issue: 'no_group' as MenuIssue, days: [] };
    const category = group.mealPriceCategory?.active
      ? group.mealPriceCategory
      : null;
    const [entries, menus, complexes, prices, orders] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.prisma.menuDay.findMany({
        where: {
          kind: group.kind,
          status: MenuStatus.published,
          date: { gte: from, lte: to },
        },
        select: {
          id: true,
          date: true,
          items: {
            select: {
              dish: {
                select: {
                  id: true,
                  name: true,
                  course: { select: { id: true, name: true, sortOrder: true } },
                },
              },
            },
          },
        },
        orderBy: { date: 'asc' },
      }),
      category
        ? this.prisma.mealComplex.findMany({
            where: { active: true },
            select: complexSelect,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          })
        : Promise.resolve<ComplexRow[]>([]),
      category
        ? this.prisma.mealComplexPrice.findMany({
            where: { priceCategoryId: category.id },
          })
        : Promise.resolve<Prisma.MealComplexPriceGetPayload<object>[]>([]),
      this.prisma.mealOrder.findMany({
        where: {
          childId,
          cancelledAt: null,
          date: { gte: from, lte: to },
        },
        select: orderSelect,
      }),
    ]);
    const hasOrder = (date: Date) =>
      orders.some((o) => o.date.getTime() === date.getTime());
    const days = menus
      .map((m) => ({
        menu: m,
        working: dayInfo(m.date, group, entries).working,
      }))
      .filter((m) => m.working || hasOrder(m.menu.date))
      .map((m) => ({ ...m.menu, working: m.working }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((m) => {
        const dishes = m.items.map((i) => i.dish).sort(byCourse);
        const open = isBeforeDeadline(m.date, deadline, now);
        const available =
          category && m.working
            ? complexes.flatMap((c) => {
                const price = priceOn(prices, c.id, category.id, m.date);
                const courses = c.courses
                  .map((cc) => cc.course)
                  .sort(
                    (a, b) =>
                      a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
                  );
                const check = resolveChoices(
                  courses.map((cc) => cc.id),
                  dishes.map((d) => ({ id: d.id, courseId: d.course.id })),
                  [],
                );
                if (
                  !price ||
                  ('error' in check && check.error === 'course_missing')
                )
                  return [];
                return [
                  {
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    price: formatMoney(price.price),
                    courses: courses.map((cc) => ({
                      id: cc.id,
                      name: cc.name,
                      options: dishes
                        .filter((d) => d.course.id === cc.id)
                        .map((d) => ({ id: d.id, name: d.name })),
                    })),
                  },
                ];
              })
            : [];
        const order = orders.find((o) => o.date.getTime() === m.date.getTime());
        return {
          date: isoDay(m.date),
          deadlineAt: deadlineFor(m.date, deadline).toISOString(),
          open,
          working: m.working,
          dishes,
          complexes: open ? available : [],
          order: order ? toOrderView(order) : null,
          canOrder: open && !order && available.length > 0,
          canCancel: open && !!order,
        };
      });
    return {
      deadline,
      issue: (category ? null : 'no_price_category') as MenuIssue,
      days,
    };
  }

  async order(
    user: AuthenticatedUser,
    childId: string,
    dto: ParentMealOrdersDto,
  ) {
    await assertOwnChild(this.prisma, user.id, childId);
    return this.orders.create(childId, dto.days, user);
  }

  async cancel(user: AuthenticatedUser, childId: string, orderId: string) {
    await assertOwnChild(this.prisma, user.id, childId);
    return this.orders.cancel(orderId, user, undefined, new Date(), childId);
  }
}
