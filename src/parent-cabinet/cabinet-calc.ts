import { FinanceCategory } from '@prisma/client';
import {
  ChargeLike,
  Money,
  PaymentLike,
  chargeRemaining,
  formatMoney,
  summarize,
  sumMoney,
} from '../finance/finance-calc';
import { kyivToday } from '../tariffs/dates';

export interface ChargeMoneyLike extends ChargeLike {
  periodEnd: Date | null;
}

export interface ChildMoney {
  due: string;
  overdue: string;
  prepayment: string;
  unallocated: string;
  categories: {
    category: FinanceCategory;
    due: string;
    overdue: string;
    prepayment: string;
  }[];
}

export const chargeLastDay = (c: {
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
}): Date => c.periodEnd ?? c.periodStart ?? kyivToday(c.createdAt);

export const isOverdue = (c: ChargeMoneyLike, today: Date): boolean =>
  chargeRemaining(c).gt(0) && chargeLastDay(c).getTime() < today.getTime();

export function childMoney(
  charges: ChargeMoneyLike[],
  payments: PaymentLike[],
  today: Date,
): ChildMoney {
  const summary = summarize(charges, payments);
  const active = charges.filter((c) => !c.voidedAt);
  const categories = summary.categories.map((c) => ({
    category: c.category,
    due: c.debt,
    overdue: formatMoney(
      sumMoney(
        active
          .filter((x) => x.category === c.category && isOverdue(x, today))
          .map((x): Money => chargeRemaining(x)),
      ),
    ),
    prepayment: c.prepayment,
  }));
  return {
    due: formatMoney(sumMoney(categories.map((c) => c.due))),
    overdue: formatMoney(sumMoney(categories.map((c) => c.overdue))),
    prepayment: formatMoney(
      sumMoney(categories.map((c) => c.prepayment)).plus(
        summary.totals.unallocated,
      ),
    ),
    unallocated: summary.totals.unallocated,
    categories,
  };
}
