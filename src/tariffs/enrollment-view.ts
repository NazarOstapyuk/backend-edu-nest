import { Prisma } from '@prisma/client';
import {
  activeAllocated,
  chargeState,
  formatMoney,
} from '../finance/finance-calc';
import { EnrollmentInput, PeriodResult, nextPeriod } from './billing-engine';

export const enrollmentInclude = {
  tariff: { include: { prices: true } },
  adjustments: { orderBy: { createdAt: 'asc' } },
  billedPeriods: {
    orderBy: { periodStart: 'asc' },
    include: { charge: { include: { allocations: true } } },
  },
  child: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.EnrollmentInclude;

export type LoadedEnrollment = Prisma.EnrollmentGetPayload<{
  include: typeof enrollmentInclude;
}>;

export const toEngineInput = (e: LoadedEnrollment): EnrollmentInput => ({
  tariffName: e.tariff.name,
  startDate: e.startDate,
  endDate: e.endDate,
  mode: e.billingMode ?? e.tariff.billingMode,
  prices: e.tariff.prices,
  adjustments: e.adjustments,
});

const toNextPeriod = (result: PeriodResult | null) => {
  if (!result) return null;
  if (!result.ok) {
    return {
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      amount: null,
      description: null,
      problem: result.reason,
    };
  }
  return {
    periodStart: result.bill.periodStart,
    periodEnd: result.bill.periodEnd,
    amount: formatMoney(result.bill.amount),
    description: result.bill.description,
    problem: null,
  };
};

export const toEnrollmentView = (e: LoadedEnrollment, today: Date) => ({
  id: e.id,
  childId: e.childId,
  tariff: {
    id: e.tariff.id,
    name: e.tariff.name,
    category: e.tariff.category,
    billingMode: e.tariff.billingMode,
  },
  startDate: e.startDate,
  endDate: e.endDate,
  billingMode: e.billingMode,
  effectiveBillingMode: e.billingMode ?? e.tariff.billingMode,
  note: e.note,
  adjustments: e.adjustments.map((a) => ({
    id: a.id,
    type: a.type,
    value: a.value ? formatMoney(a.value) : null,
    startDate: a.startDate,
    endDate: a.endDate,
    reason: a.reason,
    createdAt: a.createdAt,
    voidedAt: a.voidedAt,
    voidReason: a.voidReason,
  })),
  billedPeriods: e.billedPeriods.map((p) => ({
    id: p.id,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    amount: formatMoney(p.amount),
    note: p.note,
    chargeId: p.chargeId,
    chargeVoided: Boolean(p.charge?.voidedAt),
    chargeState:
      p.charge && !p.charge.voidedAt
        ? chargeState(p.charge.amount, activeAllocated(p.charge.allocations))
        : null,
    needsRecalculation:
      p.chargeId !== null &&
      e.endDate !== null &&
      p.periodEnd.getTime() > e.endDate.getTime(),
  })),
  nextPeriod: toNextPeriod(
    nextPeriod(
      toEngineInput(e),
      e.billedPeriods.map((p) => p.periodStart),
      today,
    ),
  ),
});

export type EnrollmentView = ReturnType<typeof toEnrollmentView>;
