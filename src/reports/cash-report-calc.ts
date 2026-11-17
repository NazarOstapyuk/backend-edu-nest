import type {
  CashDirection,
  CashEntryKind,
  CashExpenseCategory,
  CashTransferStatus,
  FinanceCategory,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { formatMoney, sumMoney } from '../finance/finance-calc';
import { uaDay } from '../tariffs/dates';
import type { Cell, Report, ReportRow, ReportSheet } from './report.types';
import {
  CASH_DIRECTION_LABELS,
  CASH_EXPENSE_LABELS,
  CASH_KIND_LABELS,
  CASH_TRANSFER_LABELS,
  CATEGORY_LABELS,
  NO_CATEGORY,
  TOTAL_LABEL,
  moneyTotals,
  periodOf,
  type PeriodRef,
} from './reports-calc';

export interface CashReportEntry {
  createdAt: Date;
  desk: string;
  kind: CashEntryKind;
  direction: CashDirection;
  amount: Prisma.Decimal;
  sign: number;
  paymentCategory: FinanceCategory | null;
  expenseCategory: CashExpenseCategory | null;
  child: string | null;
  group: string | null;
  payer: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  employeeId: string;
  employee: string;
  recipient: string | null;
  transferStatus: CashTransferStatus | null;
  comment: string | null;
  voidedAt: Date | null;
}

export interface CashReportPayment {
  category: FinanceCategory | null;
  direction: CashDirection;
  method: PaymentMethod;
  amount: Prisma.Decimal;
}

export interface CashReportShift {
  desk: string;
  openedAt: Date;
  openedBy: string;
  closedAt: Date | null;
  closedBy: string | null;
  openingCounted: Prisma.Decimal;
  closingExpected: Prisma.Decimal | null;
  closingCounted: Prisma.Decimal | null;
  closingNote: string | null;
}

export interface CashReportInput {
  period: PeriodRef;
  shiftDay: Date | null;
  entries: CashReportEntry[];
  payments: CashReportPayment[];
  shifts: CashReportShift[];
}

const DIRECTIONS: CashDirection[] = ['kindergarten', 'school', 'shared'];

const TUITION_LABELS: Record<CashDirection, string> = {
  kindergarten: 'Абонемент садка',
  school: 'Абонемент школи',
  shared: CATEGORY_LABELS.tuition,
};

const pad = (value: string) => value.padStart(2, '0');

const kyivDateTime = (at: Date | null): string => {
  if (!at) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${pad(parts.day)}.${pad(parts.month)}.${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
};

const periodText = (from: Date | null, to: Date | null): string => {
  if (from && to) return `${uaDay(from)} – ${uaDay(to)}`;
  return from || to ? uaDay((from ?? to) as Date) : '';
};

const signedAmount = (entry: CashReportEntry): Prisma.Decimal => {
  if (entry.kind === 'income') return entry.amount;
  if (entry.kind === 'correction') return entry.amount.mul(entry.sign);
  return entry.amount.neg();
};

const entryCategory = (entry: CashReportEntry): string => {
  if (entry.kind === 'income' && entry.paymentCategory)
    return CATEGORY_LABELS[entry.paymentCategory];
  if (entry.kind === 'expense')
    return CASH_EXPENSE_LABELS[entry.expenseCategory ?? 'other'];
  return '';
};

const paymentLabel = (payment: CashReportPayment): string => {
  if (!payment.category) return NO_CATEGORY;
  return payment.category === 'tuition'
    ? TUITION_LABELS[payment.direction]
    : CATEGORY_LABELS[payment.category];
};

const sumOf = (entries: CashReportEntry[], kind: CashEntryKind): string =>
  formatMoney(
    sumMoney(entries.filter((e) => e.kind === kind).map((e) => e.amount)),
  );

const categorySheet = (payments: CashReportPayment[]): ReportSheet => {
  const order = [
    ...Object.entries(CATEGORY_LABELS).flatMap(([key, label]) =>
      key === 'tuition' ? DIRECTIONS.map((d) => TUITION_LABELS[d]) : [label],
    ),
    NO_CATEGORY,
  ];
  const rows = order
    .map((label) => {
      const own = payments.filter((p) => paymentLabel(p) === label);
      const cash = sumMoney(
        own.filter((p) => p.method === 'cash').map((p) => p.amount),
      );
      const nonCash = sumMoney(
        own.filter((p) => p.method !== 'cash').map((p) => p.amount),
      );
      return {
        count: own.length,
        row: {
          category: label,
          cash: formatMoney(cash),
          nonCash: formatMoney(nonCash),
          total: formatMoney(cash.add(nonCash)),
        },
      };
    })
    .filter(({ count }) => count > 0)
    .map(({ row }) => row);
  return {
    name: 'За категоріями оплат',
    columns: [
      { key: 'category', label: 'Категорія', type: 'text' },
      { key: 'cash', label: 'Готівка', type: 'money' },
      { key: 'nonCash', label: 'Безготівково', type: 'money' },
      { key: 'total', label: 'Разом', type: 'money' },
    ],
    rows,
    totals: {
      category: TOTAL_LABEL,
      ...moneyTotals(rows, ['cash', 'nonCash', 'total']),
    },
  };
};

const expenseSheet = (active: CashReportEntry[]): ReportSheet => {
  const expenses = active.filter((e) => e.kind === 'expense');
  const rows = (Object.keys(CASH_EXPENSE_LABELS) as CashExpenseCategory[])
    .map((key) => ({
      key,
      own: expenses.filter((e) => (e.expenseCategory ?? 'other') === key),
    }))
    .filter(({ own }) => own.length > 0)
    .map(
      ({ key, own }): ReportRow => ({
        category: CASH_EXPENSE_LABELS[key],
        count: own.length,
        amount: formatMoney(sumMoney(own.map((e) => e.amount))),
      }),
    );
  return {
    name: 'Видатки',
    columns: [
      { key: 'category', label: 'Категорія', type: 'text' },
      { key: 'count', label: 'Кількість', type: 'number' },
      { key: 'amount', label: 'Сума', type: 'money' },
    ],
    rows,
    totals: {
      category: TOTAL_LABEL,
      count: expenses.length,
      ...moneyTotals(rows, ['amount']),
    },
  };
};

const transferSheet = (active: CashReportEntry[]): ReportSheet => {
  const transfers = active.filter((e) => e.kind === 'transfer');
  const groups = new Map<string, CashReportEntry[]>();
  for (const entry of transfers) {
    const key = `${entry.recipient ?? ''}\u0000${entry.transferStatus ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const rows = [...groups.values()]
    .map(
      (own): ReportRow => ({
        recipient: own[0].recipient ?? '',
        status: own[0].transferStatus
          ? CASH_TRANSFER_LABELS[own[0].transferStatus]
          : '',
        count: own.length,
        amount: formatMoney(sumMoney(own.map((e) => e.amount))),
      }),
    )
    .sort(
      (a, b) =>
        String(a.recipient).localeCompare(String(b.recipient)) ||
        String(a.status).localeCompare(String(b.status)),
    );
  return {
    name: 'Передачі',
    columns: [
      { key: 'recipient', label: 'Отримувач', type: 'text' },
      { key: 'status', label: 'Статус', type: 'text' },
      { key: 'count', label: 'Кількість', type: 'number' },
      { key: 'amount', label: 'Сума', type: 'money' },
    ],
    rows,
    totals: {
      recipient: TOTAL_LABEL,
      count: transfers.length,
      ...moneyTotals(rows, ['amount']),
    },
  };
};

const directionSheet = (active: CashReportEntry[]): ReportSheet => {
  const rows = DIRECTIONS.map((direction): ReportRow => {
    const own = active.filter((e) => e.direction === direction);
    return {
      direction: CASH_DIRECTION_LABELS[direction],
      income: sumOf(own, 'income'),
      expense: sumOf(own, 'expense'),
      transfer: sumOf(own, 'transfer'),
    };
  });
  return {
    name: 'За напрямами',
    columns: [
      { key: 'direction', label: 'Напрям', type: 'text' },
      { key: 'income', label: 'Надходження', type: 'money' },
      { key: 'expense', label: 'Видатки', type: 'money' },
      { key: 'transfer', label: 'Передачі', type: 'money' },
    ],
    rows,
    totals: {
      direction: TOTAL_LABEL,
      ...moneyTotals(rows, ['income', 'expense', 'transfer']),
    },
  };
};

const employeeSheet = (active: CashReportEntry[]): ReportSheet => {
  const people = new Map(active.map((e) => [e.employeeId, e.employee]));
  const ids = [...people.keys()].sort(
    (a, b) =>
      (people.get(a) ?? '').localeCompare(people.get(b) ?? '') ||
      a.localeCompare(b),
  );
  const rows = ids.map((id): ReportRow => {
    const own = active.filter((e) => e.employeeId === id);
    return {
      employee: people.get(id) ?? '',
      count: own.length,
      income: sumOf(own, 'income'),
      expense: sumOf(own, 'expense'),
      transfer: sumOf(own, 'transfer'),
    };
  });
  return {
    name: 'За працівниками',
    columns: [
      { key: 'employee', label: 'Працівник', type: 'text' },
      { key: 'count', label: 'Операцій', type: 'number' },
      { key: 'income', label: 'Надходження', type: 'money' },
      { key: 'expense', label: 'Видатки', type: 'money' },
      { key: 'transfer', label: 'Передачі', type: 'money' },
    ],
    rows,
    totals: {
      employee: TOTAL_LABEL,
      count: active.length,
      ...moneyTotals(rows, ['income', 'expense', 'transfer']),
    },
  };
};

const shiftSheet = (shifts: CashReportShift[]): ReportSheet => {
  const money = (value: Prisma.Decimal | null): Cell =>
    value ? formatMoney(value) : null;
  const rows = [...shifts]
    .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
    .map((s): ReportRow => {
      const closed = s.closedAt !== null && s.closingCounted !== null;
      const difference =
        closed && s.closingExpected && s.closingCounted
          ? formatMoney(s.closingCounted.sub(s.closingExpected))
          : null;
      return {
        desk: s.desk,
        opened: kyivDateTime(s.openedAt),
        openedBy: s.openedBy,
        closed: kyivDateTime(s.closedAt),
        closedBy: s.closedBy ?? '',
        opening: formatMoney(s.openingCounted),
        expected: money(s.closingExpected),
        counted: money(s.closingCounted),
        difference,
        explanation: s.closingNote ?? '',
      };
    });
  return {
    name: 'Зміни',
    columns: [
      { key: 'desk', label: 'Каса', type: 'text' },
      { key: 'opened', label: 'Відкрито', type: 'text' },
      { key: 'openedBy', label: 'Відкрив', type: 'text' },
      { key: 'closed', label: 'Закрито', type: 'text' },
      { key: 'closedBy', label: 'Закрив', type: 'text' },
      { key: 'opening', label: 'На початок', type: 'money' },
      { key: 'expected', label: 'Очікувано', type: 'money' },
      { key: 'counted', label: 'Пораховано', type: 'money' },
      { key: 'difference', label: 'Різниця', type: 'money' },
      { key: 'explanation', label: 'Пояснення', type: 'text' },
    ],
    rows,
    totals: null,
  };
};

export const shiftFileName = (day: Date): string => `каса-зміна-${uaDay(day)}`;

export function cashReport(input: CashReportInput): Report {
  const entries = [...input.entries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const active = entries.filter((e) => e.voidedAt === null);
  const lines = entries.map(
    (e): ReportRow => ({
      date: kyivDateTime(e.createdAt),
      desk: e.desk,
      kind: CASH_KIND_LABELS[e.kind],
      direction: CASH_DIRECTION_LABELS[e.direction],
      category: entryCategory(e),
      child: e.child ?? '',
      group: e.group ?? '',
      payer: e.payer ?? '',
      period: periodText(e.periodFrom, e.periodTo),
      amount: formatMoney(signedAmount(e)),
      employee: e.employee,
      recipient: e.recipient ?? '',
      transferStatus: e.transferStatus
        ? CASH_TRANSFER_LABELS[e.transferStatus]
        : '',
      comment: e.comment ?? '',
      voided: e.voidedAt ? 'Так' : '',
    }),
  );
  return {
    title: 'Каса',
    fileName: input.shiftDay ? shiftFileName(input.shiftDay) : 'каса',
    period: input.shiftDay ? null : periodOf(input.period),
    datedFileName: input.shiftDay !== null,
    columns: [
      { key: 'date', label: 'Дата і час', type: 'text' },
      { key: 'desk', label: 'Каса', type: 'text' },
      { key: 'kind', label: 'Вид', type: 'text' },
      { key: 'direction', label: 'Напрям', type: 'text' },
      { key: 'category', label: 'Категорія', type: 'text' },
      { key: 'child', label: 'Дитина', type: 'text' },
      { key: 'group', label: 'Група', type: 'text' },
      { key: 'payer', label: 'Платник', type: 'text' },
      { key: 'period', label: 'Період', type: 'text' },
      { key: 'amount', label: 'Сума', type: 'money' },
      { key: 'employee', label: 'Працівник', type: 'text' },
      { key: 'recipient', label: 'Отримувач', type: 'text' },
      { key: 'transferStatus', label: 'Статус передачі', type: 'text' },
      { key: 'comment', label: 'Коментар', type: 'text' },
      { key: 'voided', label: 'Скасовано', type: 'text' },
    ],
    rows: lines,
    totals: {
      date: TOTAL_LABEL,
      amount: formatMoney(sumMoney(active.map(signedAmount))),
    },
    sheets: [
      categorySheet(input.payments),
      expenseSheet(active),
      transferSheet(active),
      directionSheet(active),
      employeeSheet(active),
      shiftSheet(input.shifts),
    ],
  };
}
