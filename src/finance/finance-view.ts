import { FinanceCategory, GroupKind, Prisma } from '@prisma/client';
import {
  ChargeLike,
  PaymentLike,
  activeAllocated,
  chargeState,
  formatMoney,
  money,
  paymentFree,
  sumMoney,
  summarize,
} from './finance-calc';

const personSelect = {
  select: { id: true, firstName: true, lastName: true },
} as const;
const allocationAmounts = { select: { amount: true, voidedAt: true } } as const;

export const chargeInclude = {
  allocations: true,
  createdBy: personSelect,
  voidedBy: personSelect,
} satisfies Prisma.ChargeInclude;

export const paymentInclude = {
  createdBy: personSelect,
  voidedBy: personSelect,
  allocations: {
    include: {
      createdBy: personSelect,
      voidedBy: personSelect,
      charge: {
        select: {
          id: true,
          category: true,
          description: true,
          periodStart: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PaymentInclude;

export const balanceChildSelect = {
  id: true,
  firstName: true,
  lastName: true,
  group: {
    select: {
      id: true,
      name: true,
      institution: { select: { id: true, name: true, type: true } },
    },
  },
  charges: {
    select: {
      id: true,
      category: true,
      amount: true,
      description: true,
      periodStart: true,
      createdAt: true,
      voidedAt: true,
      allocations: allocationAmounts,
    },
  },
  payments: {
    select: {
      amount: true,
      category: true,
      status: true,
      voidedAt: true,
      allocations: allocationAmounts,
    },
  },
} satisfies Prisma.ChildSelect;

export type LoadedCharge = Prisma.ChargeGetPayload<{
  include: typeof chargeInclude;
}>;
export type LoadedPayment = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;
export type PersonRef = { id: string; firstName: string; lastName: string };

export type FinanceEventType =
  | 'charge_created'
  | 'charge_voided'
  | 'payment_recorded'
  | 'payment_voided'
  | 'allocation_created'
  | 'allocation_voided';

export interface FinanceEvent {
  type: FinanceEventType;
  at: Date;
  by: PersonRef | null;
  amount: string;
  description: string;
  reason: string | null;
}

export interface BalanceGroup {
  id: string;
  name: string;
  institution: { id: string; name: string; type: GroupKind };
}

export interface BalanceRow {
  childId: string;
  firstName: string;
  lastName: string;
  totalDue: string;
  debt: string;
  prepayment: string;
  unallocated: string;
  group: BalanceGroup | null;
}

export const toChargeView = (charge: LoadedCharge) => {
  const paid = activeAllocated(charge.allocations);
  return {
    id: charge.id,
    category: charge.category,
    amount: formatMoney(charge.amount),
    description: charge.description,
    periodStart: charge.periodStart,
    periodEnd: charge.periodEnd,
    sourceType: charge.sourceType,
    sourceId: charge.sourceId,
    createdAt: charge.createdAt,
    createdBy: charge.createdBy,
    voidedAt: charge.voidedAt,
    voidedBy: charge.voidedBy,
    voidReason: charge.voidReason,
    paid: formatMoney(paid),
    remaining: formatMoney(charge.amount.minus(paid)),
    state: chargeState(charge.amount, paid),
  };
};

export const toPaymentView = (payment: LoadedPayment) => ({
  id: payment.id,
  amount: formatMoney(payment.amount),
  category: payment.category,
  method: payment.method,
  status: payment.status,
  reference: payment.reference,
  receivedAt: payment.receivedAt,
  note: payment.note,
  createdAt: payment.createdAt,
  createdBy: payment.createdBy,
  voidedAt: payment.voidedAt,
  voidedBy: payment.voidedBy,
  voidReason: payment.voidReason,
  allocated: formatMoney(activeAllocated(payment.allocations)),
  free: formatMoney(paymentFree(payment)),
  allocations: payment.allocations.map((a) => ({
    id: a.id,
    paymentId: a.paymentId,
    chargeId: a.chargeId,
    amount: formatMoney(a.amount),
    createdAt: a.createdAt,
    createdBy: a.createdBy,
    voidedAt: a.voidedAt,
    voidedBy: a.voidedBy,
    voidReason: a.voidReason,
    charge: a.charge,
  })),
});

export const buildChildFinance = (
  child: PersonRef,
  charges: LoadedCharge[],
  payments: LoadedPayment[],
) => ({
  child,
  ...summarize(charges, payments),
  charges: charges.map(toChargeView),
  payments: payments.map(toPaymentView),
});

export function buildHistory(
  charges: LoadedCharge[],
  payments: LoadedPayment[],
): FinanceEvent[] {
  const events: FinanceEvent[] = [];

  for (const charge of charges) {
    const amount = formatMoney(charge.amount);
    events.push({
      type: 'charge_created',
      at: charge.createdAt,
      by: charge.createdBy,
      amount,
      description: charge.description,
      reason: null,
    });
    if (charge.voidedAt) {
      events.push({
        type: 'charge_voided',
        at: charge.voidedAt,
        by: charge.voidedBy,
        amount,
        description: charge.description,
        reason: charge.voidReason,
      });
    }
  }

  for (const payment of payments) {
    const amount = formatMoney(payment.amount);
    const title = payment.reference || 'Оплата';
    events.push({
      type: 'payment_recorded',
      at: payment.createdAt,
      by: payment.createdBy,
      amount,
      description: title,
      reason: null,
    });
    if (payment.voidedAt) {
      events.push({
        type: 'payment_voided',
        at: payment.voidedAt,
        by: payment.voidedBy,
        amount,
        description: title,
        reason: payment.voidReason,
      });
    }
    for (const allocation of payment.allocations) {
      const description = `${title} → ${allocation.charge.description}`;
      const allocated = formatMoney(allocation.amount);
      events.push({
        type: 'allocation_created',
        at: allocation.createdAt,
        by: allocation.createdBy,
        amount: allocated,
        description,
        reason: null,
      });
      if (allocation.voidedAt) {
        events.push({
          type: 'allocation_voided',
          at: allocation.voidedAt,
          by: allocation.voidedBy,
          amount: allocated,
          description,
          reason: allocation.voidReason,
        });
      }
    }
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function buildBalanceRow(
  child: PersonRef & { group?: BalanceGroup | null },
  charges: ChargeLike[],
  payments: PaymentLike[],
  category?: FinanceCategory,
): BalanceRow {
  const summary = summarize(charges, payments);
  const categories = category
    ? summary.categories.filter((c) => c.category === category)
    : summary.categories;
  const debt = sumMoney(categories.map((c) => c.debt));
  const prepayment = sumMoney(categories.map((c) => c.prepayment));
  const totalDue = category
    ? debt.minus(prepayment)
    : money(summary.totals.totalDue);

  return {
    childId: child.id,
    firstName: child.firstName,
    lastName: child.lastName,
    totalDue: formatMoney(totalDue),
    debt: formatMoney(debt),
    prepayment: formatMoney(prepayment),
    unallocated: summary.totals.unallocated,
    group: child.group ?? null,
  };
}
