import { AdjustmentType, BillingMode, Prisma } from '@prisma/client';
import { formatMoney } from '../finance/finance-calc';
import {
  addDays,
  dayCount,
  daysInMonth,
  firstDayOfMonth,
  isoDay,
  lastDayOfMonth,
  maxDay,
  minDay,
  monthDay,
  uaDay,
} from './dates';

export interface PriceLike {
  price: Prisma.Decimal;
  effectiveFrom: Date;
}

export interface AdjustmentLike {
  type: AdjustmentType;
  value: Prisma.Decimal | null;
  startDate: Date;
  endDate: Date | null;
  voidedAt: Date | null;
}

export interface EnrollmentInput {
  tariffName: string;
  startDate: Date;
  endDate: Date | null;
  mode: BillingMode;
  prices: PriceLike[];
  adjustments: AdjustmentLike[];
}

export interface PeriodRange {
  periodStart: Date;
  periodEnd: Date;
  fullDays: number;
  isFirst: boolean;
}

export interface PeriodBill {
  periodStart: Date;
  periodEnd: Date;
  amount: Prisma.Decimal;
  description: string;
  zero: boolean;
  note: string | null;
}

export type PeriodResult =
  | { ok: true; bill: PeriodBill }
  | { ok: false; periodStart: Date; periodEnd: Date; reason: 'no_price' };

const time = (day: Date) => day.getTime();

const isActiveOn = (adjustment: AdjustmentLike, day: Date) =>
  !adjustment.voidedAt &&
  time(adjustment.startDate) <= time(day) &&
  (adjustment.endDate === null || time(adjustment.endDate) >= time(day));

const findActive = (
  adjustments: AdjustmentLike[],
  type: AdjustmentType,
  day: Date,
) => adjustments.find((a) => a.type === type && isActiveOn(a, day));

export function priceOn(prices: PriceLike[], day: Date): Prisma.Decimal | null {
  const candidates = prices
    .filter((p) => time(p.effectiveFrom) <= time(day))
    .sort((a, b) => time(b.effectiveFrom) - time(a.effectiveFrom));
  return candidates[0]?.price ?? null;
}

export function periodsUntil(
  input: EnrollmentInput,
  until: Date,
): PeriodRange[] {
  const { startDate, endDate, mode } = input;
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const anchor = startDate.getUTCDate();
  const periods: PeriodRange[] = [];

  for (let k = 0; ; k++) {
    let periodStart: Date;
    let naturalEnd: Date;
    let fullDays: number;

    if (mode === BillingMode.anniversary) {
      periodStart = monthDay(year, month + k, anchor);
      naturalEnd = addDays(monthDay(year, month + k + 1, anchor), -1);
      fullDays = dayCount(periodStart, naturalEnd);
    } else {
      const monthStart = monthDay(year, month + k, 1);
      periodStart = k === 0 ? startDate : monthStart;
      naturalEnd = lastDayOfMonth(monthStart);
      fullDays = daysInMonth(
        monthStart.getUTCFullYear(),
        monthStart.getUTCMonth(),
      );
    }

    if (time(periodStart) > time(until)) break;
    if (endDate && time(periodStart) > time(endDate)) break;

    const periodEnd =
      endDate && time(endDate) < time(naturalEnd) ? endDate : naturalEnd;
    periods.push({ periodStart, periodEnd, fullDays, isFirst: k === 0 });
  }

  return periods;
}

export function computePeriod(
  input: EnrollmentInput,
  range: PeriodRange,
): PeriodResult {
  const { periodStart, periodEnd, fullDays, isFirst } = range;
  const custom = findActive(
    input.adjustments,
    AdjustmentType.custom_price,
    periodStart,
  );
  const base = custom?.value ?? priceOn(input.prices, periodStart);
  if (!base) return { ok: false, periodStart, periodEnd, reason: 'no_price' };

  const percent = findActive(
    input.adjustments,
    AdjustmentType.discount_percent,
    periodStart,
  );
  const fixed = findActive(
    input.adjustments,
    AdjustmentType.discount_amount,
    periodStart,
  );

  let price = new Prisma.Decimal(base);
  if (percent?.value)
    price = price.mul(new Prisma.Decimal(100).minus(percent.value)).div(100);
  if (fixed?.value) price = price.minus(fixed.value);
  if (price.lt(0)) price = new Prisma.Decimal(0);

  const windowStart =
    isFirst && input.mode === BillingMode.calendar_full
      ? firstDayOfMonth(periodStart)
      : periodStart;
  const pausedDays = input.adjustments
    .filter((a) => a.type === AdjustmentType.pause && !a.voidedAt)
    .reduce((sum, a) => {
      const from = maxDay(a.startDate, periodStart);
      const to = minDay(a.endDate ?? periodEnd, periodEnd);
      return time(from) <= time(to) ? sum + dayCount(from, to) : sum;
    }, 0);
  const billableDays = Math.max(
    dayCount(windowStart, periodEnd) - pausedDays,
    0,
  );

  const amount = price
    .mul(billableDays)
    .div(fullDays)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const description =
    `${input.tariffName}, ${uaDay(periodStart)}–${uaDay(periodEnd)}: ${formatMoney(base)}` +
    (custom ? ' (індивідуальна ціна)' : '') +
    (percent?.value ? ` − ${percent.value.toString()}%` : '') +
    (fixed?.value ? ` − ${formatMoney(fixed.value)}` : '') +
    (billableDays < fullDays ? `, ${billableDays}/${fullDays} дн.` : '') +
    (pausedDays > 0 ? `, пауза ${pausedDays} дн.` : '');

  const zero = amount.isZero();
  const note = zero
    ? billableDays === 0 && pausedDays > 0
      ? 'pause'
      : 'zero amount'
    : null;

  return {
    ok: true,
    bill: { periodStart, periodEnd, amount, description, zero, note },
  };
}

export function dueBills(
  input: EnrollmentInput,
  billedStarts: Date[],
  today: Date,
  leadDays: number,
): PeriodResult[] {
  const billed = new Set(billedStarts.map(isoDay));
  return periodsUntil(input, addDays(today, leadDays))
    .filter((range) => !billed.has(isoDay(range.periodStart)))
    .map((range) => computePeriod(input, range));
}

export function nextPeriod(
  input: EnrollmentInput,
  billedStarts: Date[],
  today: Date,
): PeriodResult | null {
  const billed = new Set(billedStarts.map(isoDay));
  const horizon = addDays(maxDay(today, input.startDate), 400);
  const range = periodsUntil(input, horizon).find(
    (r) => !billed.has(isoDay(r.periodStart)),
  );
  return range ? computePeriod(input, range) : null;
}

export function findPeriod(
  input: EnrollmentInput,
  periodStart: Date,
): PeriodRange | null {
  return (
    periodsUntil(input, periodStart).find(
      (range) => isoDay(range.periodStart) === isoDay(periodStart),
    ) ?? null
  );
}
