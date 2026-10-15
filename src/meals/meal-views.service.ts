import { Injectable, NotFoundException } from '@nestjs/common';
import { PermissionArea } from '@prisma/client';
import { scopeKind } from '../access/access-calc';
import { childScopeWhere } from '../access/scope';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { assertGroupAccess, parseDay } from '../classes/access';
import { isoDay, kyivToday } from '../tariffs/dates';
import { orderSelect, toOrderView, type OrderView } from './order-view';
import { MealOrdersQueryDto } from './dto/meal-views.dto';

const person = { select: { id: true, firstName: true, lastName: true } };

const adminSelect = {
  ...orderSelect,
  child: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      group: { select: { id: true, name: true } },
    },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
  cancelledBy: person,
} as const;

export function summarize(orders: OrderView[]) {
  const complexes = new Map<
    string,
    { complexId: string; name: string; count: number }
  >();
  const dishes = new Map<
    string,
    { dishId: string; name: string; courseName: string; count: number }
  >();
  for (const order of orders) {
    if (order.cancelledAt) continue;
    const c = complexes.get(order.complex.id) ?? {
      complexId: order.complex.id,
      name: order.complex.name,
      count: 0,
    };
    c.count++;
    complexes.set(c.complexId, c);
    for (const item of order.items) {
      const d = dishes.get(item.dishId) ?? {
        dishId: item.dishId,
        name: item.dishName,
        courseName: item.courseName,
        count: 0,
      };
      d.count++;
      dishes.set(d.dishId, d);
    }
  }
  return { complexes: [...complexes.values()], dishes: [...dishes.values()] };
}

@Injectable()
export class MealViewsService {
  constructor(private prisma: PrismaService) {}

  async adminList(query: MealOrdersQueryDto, user: AuthenticatedUser) {
    const date = parseDay(query.date);
    const groupFilter =
      query.kind || query.groupId
        ? { group: { kind: query.kind, id: query.groupId } }
        : undefined;
    const rows = await this.prisma.mealOrder.findMany({
      where: {
        date,
        child: { ...groupFilter, ...childScopeWhere(scopeKind(user)) },
      },
      select: adminSelect,
      orderBy: [{ child: { lastName: 'asc' } }, { createdAt: 'asc' }],
    });
    const orders = rows.map((r) => ({
      ...toOrderView(r),
      child: {
        id: r.child.id,
        firstName: r.child.firstName,
        lastName: r.child.lastName,
      },
      group: r.child.group,
      createdBy: r.createdBy,
      cancelledBy: r.cancelledBy,
    }));
    return { orders, summary: summarize(orders) };
  }

  async today(
    groupId: string,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, kind: true, teachers: { select: { id: true } } },
    });
    if (!group) throw new NotFoundException('Group not found');
    const kind = scopeKind(user);
    if (kind && group.kind !== kind)
      throw new NotFoundException('Group not found');
    assertGroupAccess(group, user, PermissionArea.meals);
    const rows = await this.prisma.mealOrder.findMany({
      where: { date: today, cancelledAt: null, child: { groupId } },
      select: { ...orderSelect, child: person },
      orderBy: { child: { lastName: 'asc' } },
    });
    const views = rows.map((r) => ({
      view: toOrderView(r),
      child: {
        id: r.child.id,
        firstName: r.child.firstName,
        lastName: r.child.lastName,
      },
    }));
    return {
      date: isoDay(today),
      orders: views.map(({ view, child }) => ({
        id: view.id,
        child,
        complex: view.complex,
        items: view.items,
      })),
      summary: summarize(views.map((v) => v.view)),
    };
  }
}
