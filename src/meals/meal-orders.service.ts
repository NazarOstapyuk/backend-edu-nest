import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeSource,
  FinanceCategory,
  MenuStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { scopeKind } from '../access/access-calc';
import { assertChildInScope } from '../access/scope';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CalendarService } from '../attendance/calendar.service';
import { dayInfo } from '../attendance/register-calc';
import { parseDay } from '../classes/access';
import { isoDay, uaDay } from '../tariffs/dates';
import {
  choiceErrorMessage,
  isBeforeDeadline,
  priceOn,
  resolveChoices,
} from './meals-calc';
import { MealSettingsService } from './meal-settings.service';
import { cancelOrderInTx } from './notice-orders';
import { orderSelect, toOrderView } from './order-view';
import { OrderDayDto } from './dto/meal-order.dto';

const isParent = (user: AuthenticatedUser) => user.role === Role.parent;

const dayError = (date: Date, message: string) =>
  new BadRequestException(`${isoDay(date)}: ${message}`);

@Injectable()
export class MealOrdersService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private settings: MealSettingsService,
  ) {}

  private async views(ids: string[]) {
    const rows = await this.prisma.mealOrder.findMany({
      where: { id: { in: ids } },
      select: orderSelect,
      orderBy: { date: 'asc' },
    });
    return rows.map(toOrderView);
  }

  async create(
    childId: string,
    days: OrderDayDto[],
    user: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const parsed = days
      .map((d) => ({ ...d, day: parseDay(d.date) }))
      .sort((a, b) => a.day.getTime() - b.day.getTime());
    if (new Set(parsed.map((d) => d.day.getTime())).size !== parsed.length)
      throw new BadRequestException('Duplicate date in order');
    await assertChildInScope(this.prisma, scopeKind(user), childId);
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
    if (!child) throw new NotFoundException('Child not found');
    const group = child.group;
    if (!group) throw new BadRequestException('Child has no group');
    const category = group.mealPriceCategory;
    if (!category?.active)
      throw new BadRequestException('Group has no meal price category');
    const complexIds = [...new Set(parsed.map((d) => d.complexId))];
    const [deadline, entries, complexes, prices] = await Promise.all([
      this.settings.getDeadline(),
      this.calendar.entriesBetween(
        parsed[0].day,
        parsed[parsed.length - 1].day,
      ),
      this.prisma.mealComplex.findMany({
        where: { id: { in: complexIds } },
        select: {
          id: true,
          name: true,
          active: true,
          courses: { select: { courseId: true } },
        },
      }),
      this.prisma.mealComplexPrice.findMany({
        where: { complexId: { in: complexIds }, priceCategoryId: category.id },
      }),
    ]);
    if (complexIds.some((id) => !complexes.some((c) => c.id === id)))
      throw new NotFoundException('Meal complex not found');

    const ids = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${childId} FOR UPDATE`;
      const found = await tx.menuDay.findMany({
        where: { kind: group.kind, date: { in: parsed.map((d) => d.day) } },
        select: { id: true },
      });
      const menus = new Map<number, { id: string; status: MenuStatus }>();
      if (found.length) {
        const menuIds = found.map((m) => m.id);
        await tx.$queryRaw`SELECT id FROM "MenuDay" WHERE id IN (${Prisma.join(menuIds)}) ORDER BY id FOR SHARE`;
        const locked = await tx.menuDay.findMany({
          where: { id: { in: menuIds } },
          select: { id: true, date: true, status: true },
        });
        for (const m of locked)
          menus.set(m.date.getTime(), { id: m.id, status: m.status });
      }
      const created: string[] = [];
      for (const item of parsed) {
        const date = item.day;
        const existing = await tx.mealOrder.findFirst({
          where: { childId, date, cancelledAt: null },
          select: { id: true },
        });
        if (existing) throw dayError(date, 'Order already exists');
        if (!dayInfo(date, group, entries).working)
          throw dayError(date, 'Day is not a working day');
        const menu = menus.get(date.getTime());
        if (!menu || menu.status !== MenuStatus.published)
          throw dayError(date, 'Menu is not published');
        if (isParent(user) && !isBeforeDeadline(date, deadline, now))
          throw dayError(date, 'Order deadline has passed');
        const complex = complexes.find((c) => c.id === item.complexId);
        if (!complex) throw new NotFoundException('Meal complex not found');
        if (!complex.active) throw dayError(date, 'Complex is inactive');
        const menuItems = await tx.menuDayItem.findMany({
          where: { menuDayId: menu.id },
          select: { dishId: true, dish: { select: { courseId: true } } },
        });
        const choice = resolveChoices(
          complex.courses.map((c) => c.courseId),
          menuItems.map((m) => ({ id: m.dishId, courseId: m.dish.courseId })),
          item.dishIds,
        );
        if ('error' in choice)
          throw dayError(date, choiceErrorMessage[choice.error]);
        const price = priceOn(prices, complex.id, category.id, date);
        if (!price) throw dayError(date, 'Complex has no price');
        const charge = await tx.charge.create({
          data: {
            childId,
            category: FinanceCategory.meals,
            amount: price.price,
            description: `Харчування ${uaDay(date)}: ${complex.name}`,
            periodStart: date,
            periodEnd: date,
            sourceType: ChargeSource.meals,
            createdById: user.id,
          },
        });
        const order = await tx.mealOrder.create({
          data: {
            childId,
            date,
            menuDayId: menu.id,
            complexId: complex.id,
            priceCategoryId: category.id,
            price: price.price,
            chargeId: charge.id,
            createdById: user.id,
            items: { create: choice.items },
          },
        });
        await tx.charge.update({
          where: { id: charge.id },
          data: { sourceId: order.id },
        });
        created.push(order.id);
      }
      return created;
    });
    return this.views(ids);
  }

  async cancel(
    orderId: string,
    user: AuthenticatedUser,
    reasonValue?: string,
    now: Date = new Date(),
    childId?: string,
  ) {
    const order = await this.prisma.mealOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        childId: true,
        date: true,
        chargeId: true,
        cancelledAt: true,
      },
    });
    if (!order || (childId && order.childId !== childId))
      throw new NotFoundException('Order not found');
    await assertChildInScope(
      this.prisma,
      scopeKind(user),
      order.childId,
      'Order not found',
    );
    if (order.cancelledAt) throw new BadRequestException('Order is cancelled');
    const deadline = await this.settings.getDeadline();
    const before = isBeforeDeadline(order.date, deadline, now);
    const typed = reasonValue?.trim() || null;
    let reason: string;
    if (isParent(user)) {
      if (!before) throw new BadRequestException('Order deadline has passed');
      reason = 'Скасовано батьками';
    } else {
      if (!before && !typed)
        throw new BadRequestException('Reason is required');
      reason = typed ?? 'Скасовано';
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${order.childId} FOR UPDATE`;
      const fresh = await tx.mealOrder.findUnique({
        where: { id: orderId },
        select: { id: true, chargeId: true, cancelledAt: true },
      });
      if (!fresh) throw new NotFoundException('Order not found');
      if (fresh.cancelledAt)
        throw new BadRequestException('Order is cancelled');
      await cancelOrderInTx(tx, fresh, user.id, reason);
    });
    const [view] = await this.views([orderId]);
    if (!view) throw new NotFoundException('Order not found');
    return view;
  }
}
