import { FinanceCategory, PaymentStatus, Prisma } from '@prisma/client';

export const AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;

export type Money = Prisma.Decimal;
export type MoneyInput = string | number | Prisma.Decimal;
export type ChargeState = 'unpaid' | 'partial' | 'paid';

export interface AllocationLike {
  amount: Money;
  voidedAt: Date | null;
}

export interface ChargeLike {
  id: string;
  category: FinanceCategory;
  amount: Money;
  description: string;
  periodStart: Date | null;
  createdAt: Date;
  voidedAt: Date | null;
  allocations: AllocationLike[];
}

export interface PaymentLike {
  amount: Money;
  category: FinanceCategory | null;
  status: PaymentStatus;
  voidedAt: Date | null;
  allocations: AllocationLike[];
}

export interface CategorySummary {
  category: FinanceCategory;
  charged: string;
  paid: string;
  debt: string;
  prepayment: string;
}

export interface FinanceSummary {
  totals: { totalDue: string; unallocated: string };
  categories: CategorySummary[];
}

export interface SuggestionLine {
  chargeId: string;
  category: FinanceCategory;
  description: string;
  periodStart: Date | null;
  createdAt: Date;
  remaining: string;
  suggestedAmount: string;
}

export const money = (value: MoneyInput): Money => new Prisma.Decimal(value);

export const formatMoney = (value: MoneyInput): string => {
  const decimal = new Prisma.Decimal(value);
  return (decimal.isZero() ? new Prisma.Decimal(0) : decimal).toFixed(2);
};

export const sumMoney = (values: MoneyInput[]): Money =>
  values.reduce<Money>((acc, value) => acc.plus(value), new Prisma.Decimal(0));

export const activeAllocated = (allocations: AllocationLike[]): Money =>
  sumMoney(allocations.filter((a) => !a.voidedAt).map((a) => a.amount));

export const isCountedPayment = (payment: PaymentLike): boolean =>
  !payment.voidedAt && payment.status === PaymentStatus.confirmed;

export const paymentFree = (payment: PaymentLike): Money =>
  payment.amount.minus(activeAllocated(payment.allocations));

export const chargeRemaining = (charge: ChargeLike): Money =>
  charge.amount.minus(activeAllocated(charge.allocations));

export const chargeState = (amount: Money, paid: Money): ChargeState => {
  if (paid.isZero()) return 'unpaid';
  return paid.gte(amount) ? 'paid' : 'partial';
};

export function summarize(
  charges: ChargeLike[],
  payments: PaymentLike[],
): FinanceSummary {
  const counted = payments.filter(isCountedPayment);
  const categories = Object.values(FinanceCategory).map((category) => {
    const own = charges.filter((c) => !c.voidedAt && c.category === category);
    const charged = sumMoney(own.map((c) => c.amount));
    const paid = sumMoney(own.map((c) => activeAllocated(c.allocations)));
    const prepayment = sumMoney(
      counted.filter((p) => p.category === category).map(paymentFree),
    );
    return { category, charged, paid, debt: charged.minus(paid), prepayment };
  });
  const unallocated = sumMoney(
    counted.filter((p) => p.category === null).map(paymentFree),
  );
  const totalDue = sumMoney(categories.map((c) => c.debt))
    .minus(sumMoney(categories.map((c) => c.prepayment)))
    .minus(unallocated);

  return {
    totals: {
      totalDue: formatMoney(totalDue),
      unallocated: formatMoney(unallocated),
    },
    categories: categories.map((c) => ({
      category: c.category,
      charged: formatMoney(c.charged),
      paid: formatMoney(c.paid),
      debt: formatMoney(c.debt),
      prepayment: formatMoney(c.prepayment),
    })),
  };
}

const orderKey = (charge: ChargeLike) =>
  (charge.periodStart ?? charge.createdAt).getTime();

export function suggestAllocation(
  charges: ChargeLike[],
  amount: Money,
): { lines: SuggestionLine[]; leftover: string } {
  const open = charges
    .filter((c) => !c.voidedAt)
    .map((charge) => ({ charge, remaining: chargeRemaining(charge) }))
    .filter(({ remaining }) => remaining.gt(0))
    .sort(
      (a, b) =>
        orderKey(a.charge) - orderKey(b.charge) ||
        a.charge.createdAt.getTime() - b.charge.createdAt.getTime(),
    );

  let left = amount;
  const lines = open.map(({ charge, remaining }) => {
    const take = Prisma.Decimal.min(remaining, left);
    left = left.minus(take);
    return {
      chargeId: charge.id,
      category: charge.category,
      description: charge.description,
      periodStart: charge.periodStart,
      createdAt: charge.createdAt,
      remaining: formatMoney(remaining),
      suggestedAmount: formatMoney(take),
    };
  });

  return { lines, leftover: formatMoney(left) };
}
