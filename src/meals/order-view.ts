import { Prisma } from '@prisma/client';
import { formatMoney } from '../finance/finance-calc';
import { isoDay } from '../tariffs/dates';

export const orderSelect = {
  id: true,
  childId: true,
  date: true,
  price: true,
  createdAt: true,
  cancelledAt: true,
  cancelReason: true,
  complex: { select: { id: true, name: true } },
  items: {
    select: {
      course: { select: { id: true, name: true, sortOrder: true } },
      dish: { select: { id: true, name: true } },
    },
  },
} as const;

export type OrderRow = Prisma.MealOrderGetPayload<{
  select: typeof orderSelect;
}>;

export const toOrderView = (row: OrderRow) => ({
  id: row.id,
  childId: row.childId,
  date: isoDay(row.date),
  complex: row.complex,
  price: formatMoney(row.price),
  items: [...row.items]
    .sort(
      (a, b) =>
        a.course.sortOrder - b.course.sortOrder ||
        a.course.name.localeCompare(b.course.name),
    )
    .map((i) => ({
      courseId: i.course.id,
      courseName: i.course.name,
      dishId: i.dish.id,
      dishName: i.dish.name,
    })),
  createdAt: row.createdAt,
  cancelledAt: row.cancelledAt,
  cancelReason: row.cancelReason,
});

export type OrderView = ReturnType<typeof toOrderView>;
