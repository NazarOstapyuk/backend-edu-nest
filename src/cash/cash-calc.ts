import { BadRequestException } from '@nestjs/common';
import type {
  CashDirection,
  CashEntryKind,
  InstitutionType,
  Prisma,
} from '@prisma/client';
import { kyivDayStart } from '../audit/audit-calc';
import { formatMoney, money, sumMoney } from '../finance/finance-calc';
import { kyivToday } from '../tariffs/dates';

export const DENOMINATIONS: readonly string[] = [
  '100000',
  '50000',
  '20000',
  '10000',
  '5000',
  '2000',
  '1000',
  '500',
  '200',
  '100',
  '50',
  '10',
];

const MAX_COUNT = 100000;

export type TotalsEntry = {
  kind: CashEntryKind;
  amount: Prisma.Decimal;
  sign: number;
  direction: CashDirection;
  voidedAt: Date | null;
};

type KindTotals = {
  income: string;
  expense: string;
  transfer: string;
  correction: string;
};

export interface CashTotals extends KindTotals {
  byDirection: Record<CashDirection, KindTotals>;
}

export function countTotal(
  denominations: Record<string, number>,
): Prisma.Decimal {
  const parts = Object.entries(denominations).map(([key, count]) => {
    if (
      !DENOMINATIONS.includes(key) ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_COUNT
    ) {
      throw new BadRequestException('Invalid denominations');
    }
    return money(key).mul(count).div(100);
  });
  return sumMoney(parts);
}

const sumKind = (
  entries: TotalsEntry[],
  kind: CashEntryKind,
  signed: boolean,
): string =>
  formatMoney(
    sumMoney(
      entries
        .filter((entry) => entry.kind === kind)
        .map((entry) => (signed ? entry.amount.mul(entry.sign) : entry.amount)),
    ),
  );

const kindTotals = (entries: TotalsEntry[]): KindTotals => ({
  income: sumKind(entries, 'income', false),
  expense: sumKind(entries, 'expense', false),
  transfer: sumKind(entries, 'transfer', false),
  correction: sumKind(entries, 'correction', true),
});

export function shiftTotals(entries: TotalsEntry[]): CashTotals {
  const active = entries.filter((entry) => entry.voidedAt === null);
  const byDirection = {
    kindergarten: kindTotals(
      active.filter((entry) => entry.direction === 'kindergarten'),
    ),
    school: kindTotals(active.filter((entry) => entry.direction === 'school')),
    shared: kindTotals(active.filter((entry) => entry.direction === 'shared')),
  };
  return { ...kindTotals(active), byDirection };
}

export function expectedBalance(
  openingCounted: Prisma.Decimal,
  totals: CashTotals,
): Prisma.Decimal {
  return money(openingCounted)
    .add(totals.income)
    .sub(totals.expense)
    .sub(totals.transfer)
    .add(totals.correction);
}

export function directionForInstitution(
  type: InstitutionType | null | undefined,
): CashDirection {
  if (type === 'kindergarten') return 'kindergarten';
  if (type === 'school_class') return 'school';
  return 'shared';
}

export const needsExplanation = (
  expected: Prisma.Decimal,
  counted: Prisma.Decimal,
): boolean => !money(expected).eq(money(counted));

const kyivTime = (now: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);

export function isUnclosed(
  openedAt: Date,
  closeBy: string,
  now: Date,
): boolean {
  const openedDay = kyivToday(openedAt).toISOString().slice(0, 10);
  const today = kyivToday(now).toISOString().slice(0, 10);
  if (kyivDayStart(openedDay).getTime() < kyivDayStart(today).getTime()) {
    return true;
  }
  return kyivTime(now) >= closeBy;
}
