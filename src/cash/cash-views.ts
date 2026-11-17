import { Prisma } from '@prisma/client';
import type {
  CashDirection,
  CashEntryKind,
  CashExpenseCategory,
  CashTransferStatus,
} from '@prisma/client';
import { formatMoney } from '../finance/finance-calc';
import { isoDay } from '../tariffs/dates';
import {
  expectedBalance,
  shiftTotals,
  type CashTotals,
  type TotalsEntry,
} from './cash-calc';

interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
}

export interface Person {
  id: string;
  name: string;
}

export const personSelect = {
  select: { id: true, firstName: true, lastName: true },
} as const;

export const entryInclude = {
  createdBy: personSelect,
  voidedBy: personSelect,
  recipient: personSelect,
  payment: {
    select: {
      id: true,
      method: true,
      category: true,
      payerName: true,
      periodFrom: true,
      periodTo: true,
      child: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          group: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

export const totalsSelect = {
  kind: true,
  amount: true,
  sign: true,
  direction: true,
  voidedAt: true,
} as const;

export const shiftInclude = {
  desk: { select: { name: true } },
  openedBy: personSelect,
  closedBy: personSelect,
} as const;

export const person = (user: PersonRow): Person => ({
  id: user.id,
  name: `${user.lastName} ${user.firstName}`,
});

const personOrNull = (user: PersonRow | null | undefined): Person | null =>
  user ? person(user) : null;

const dayOrNull = (day: Date | null): string | null =>
  day ? isoDay(day) : null;

const moneyOrNull = (value: Prisma.Decimal | null): string | null =>
  value ? formatMoney(value) : null;

export type EntryRow = TotalsEntry & {
  id: string;
  shiftId: string;
  expenseCategory: CashExpenseCategory | null;
  comment: string | null;
  createdAt: Date;
  createdBy: PersonRow;
  voidedBy: PersonRow | null;
  voidReason: string | null;
  correctsId: string | null;
  recipient: PersonRow | null;
  transferStatus: CashTransferStatus | null;
  transferNote: string | null;
  confirmedAt: Date | null;
  payment: {
    id: string;
    method: string;
    category: string | null;
    payerName: string | null;
    periodFrom: Date | null;
    periodTo: Date | null;
    child: PersonRow & { group: { id: string; name: string } | null };
  } | null;
};

export interface CashEntryView {
  id: string;
  shiftId: string;
  kind: CashEntryKind;
  amount: string;
  sign: number;
  direction: CashDirection;
  expenseCategory: CashExpenseCategory | null;
  comment: string | null;
  createdAt: Date;
  createdBy: Person;
  voidedAt: Date | null;
  voidedBy: Person | null;
  voidReason: string | null;
  correctsId: string | null;
  transfer: {
    recipient: Person;
    status: CashTransferStatus | null;
    note: string | null;
    confirmedAt: Date | null;
  } | null;
  payment: {
    id: string;
    method: string;
    category: string | null;
    payerName: string | null;
    periodFrom: string | null;
    periodTo: string | null;
    child: Person;
    group: { id: string; name: string } | null;
  } | null;
}

export const entryView = (entry: EntryRow): CashEntryView => ({
  id: entry.id,
  shiftId: entry.shiftId,
  kind: entry.kind,
  amount: formatMoney(entry.amount),
  sign: entry.sign,
  direction: entry.direction,
  expenseCategory: entry.expenseCategory,
  comment: entry.comment,
  createdAt: entry.createdAt,
  createdBy: person(entry.createdBy),
  voidedAt: entry.voidedAt,
  voidedBy: personOrNull(entry.voidedBy),
  voidReason: entry.voidReason,
  correctsId: entry.correctsId,
  transfer: entry.recipient
    ? {
        recipient: person(entry.recipient),
        status: entry.transferStatus,
        note: entry.transferNote,
        confirmedAt: entry.confirmedAt,
      }
    : null,
  payment: entry.payment
    ? {
        id: entry.payment.id,
        method: entry.payment.method,
        category: entry.payment.category,
        payerName: entry.payment.payerName,
        periodFrom: dayOrNull(entry.payment.periodFrom),
        periodTo: dayOrNull(entry.payment.periodTo),
        child: person(entry.payment.child),
        group: entry.payment.child.group,
      }
    : null,
});

export interface ShiftRow {
  id: string;
  deskId: string;
  desk: { name: string };
  openedAt: Date;
  openedBy: PersonRow;
  openingExpected: Prisma.Decimal;
  openingCounted: Prisma.Decimal;
  openingNote: string | null;
  closedAt: Date | null;
  closedBy: PersonRow | null;
  closingExpected: Prisma.Decimal | null;
  closingCounted: Prisma.Decimal | null;
  closingNote: string | null;
  denominations: Prisma.JsonValue;
  totals: Prisma.JsonValue;
}

export interface CashShiftView {
  id: string;
  deskId: string;
  deskName: string;
  openedAt: Date;
  openedBy: Person;
  openingExpected: string;
  openingCounted: string;
  openingNote: string | null;
  closedAt: Date | null;
  closedBy: Person | null;
  closingExpected: string | null;
  closingCounted: string | null;
  closingNote: string | null;
  denominations: Prisma.JsonValue;
  totals: CashTotals;
  expected: string;
  difference: string | null;
}

export const shiftView = (
  shift: ShiftRow,
  entries: TotalsEntry[],
): CashShiftView => {
  const closed = shift.closedAt !== null;
  const totals = closed
    ? (shift.totals as unknown as CashTotals)
    : shiftTotals(entries);
  const expected =
    closed && shift.closingExpected
      ? shift.closingExpected
      : expectedBalance(shift.openingCounted, totals);
  return {
    id: shift.id,
    deskId: shift.deskId,
    deskName: shift.desk.name,
    openedAt: shift.openedAt,
    openedBy: person(shift.openedBy),
    openingExpected: formatMoney(shift.openingExpected),
    openingCounted: formatMoney(shift.openingCounted),
    openingNote: shift.openingNote,
    closedAt: shift.closedAt,
    closedBy: personOrNull(shift.closedBy),
    closingExpected: moneyOrNull(shift.closingExpected),
    closingCounted: moneyOrNull(shift.closingCounted),
    closingNote: shift.closingNote,
    denominations: shift.denominations,
    totals,
    expected: formatMoney(expected),
    difference:
      closed && shift.closingCounted
        ? formatMoney(shift.closingCounted.sub(expected))
        : null,
  };
};

export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';
