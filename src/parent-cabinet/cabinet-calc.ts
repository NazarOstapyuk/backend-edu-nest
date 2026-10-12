import { FinanceCategory } from '@prisma/client';
import {
  AllocationLike,
  Money,
  PaymentLike,
  activeAllocated,
  formatMoney,
  isCountedPayment,
  paymentFree,
  sumMoney,
} from '../finance/finance-calc';
import { kyivToday } from '../tariffs/dates';

export interface ChargeMoneyLike {
  category: FinanceCategory;
  amount: Money;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  voidedAt: Date | null;
  allocations: AllocationLike[];
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

const remaining = (c: ChargeMoneyLike): Money =>
  c.amount.minus(activeAllocated(c.allocations));

export const isOverdue = (c: ChargeMoneyLike, today: Date): boolean =>
  remaining(c).gt(0) && chargeLastDay(c).getTime() < today.getTime();

export function childMoney(
  charges: ChargeMoneyLike[],
  payments: PaymentLike[],
  today: Date,
): ChildMoney {
  const active = charges.filter((c) => !c.voidedAt);
  const counted = payments.filter(isCountedPayment);
  const categories = Object.values(FinanceCategory).map((category) => {
    const own = active.filter((c) => c.category === category);
    return {
      category,
      due: sumMoney(own.map(remaining)),
      overdue: sumMoney(own.filter((c) => isOverdue(c, today)).map(remaining)),
      prepayment: sumMoney(
        counted.filter((p) => p.category === category).map(paymentFree),
      ),
    };
  });
  const unallocated = sumMoney(
    counted.filter((p) => p.category === null).map(paymentFree),
  );
  return {
    due: formatMoney(sumMoney(categories.map((c) => c.due))),
    overdue: formatMoney(sumMoney(categories.map((c) => c.overdue))),
    prepayment: formatMoney(
      sumMoney(categories.map((c) => c.prepayment)).plus(unallocated),
    ),
    unallocated: formatMoney(unallocated),
    categories: categories.map((c) => ({
      category: c.category,
      due: formatMoney(c.due),
      overdue: formatMoney(c.overdue),
      prepayment: formatMoney(c.prepayment),
    })),
  };
}
