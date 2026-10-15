import {
  ChargeSource,
  FinanceCategory,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import {
  PaymentLike,
  chargeRemaining,
  formatMoney,
  money,
  sumMoney,
} from '../finance/finance-calc';
import { ChargeMoneyLike, childMoney } from '../parent-cabinet/cabinet-calc';
import { isoDay, kyivToday } from '../tariffs/dates';
import { Report, ReportColumn, ReportRow, ReportSheet } from './report.types';

export interface PeriodRef {
  from: Date;
  to: Date;
}

export interface PaymentRow {
  receivedAt: Date;
  child: string;
  group: string | null;
  category: FinanceCategory | null;
  method: PaymentMethod;
  amount: Prisma.Decimal;
  reference: string;
  note: string | null;
}

export interface ChargeRow {
  periodStart: Date | null;
  createdAt: Date;
  child: string;
  group: string | null;
  category: FinanceCategory;
  sourceType: ChargeSource;
  description: string;
  amount: Prisma.Decimal;
}

export interface DebtChild {
  child: string;
  group: string | null;
  parents: string;
  charges: (ChargeMoneyLike & { periodEnd: Date | null })[];
  payments: PaymentLike[];
}

const NO_CATEGORY = 'Без категорії';
const TOTAL_LABEL = 'Разом';

export const CATEGORY_LABELS: Record<FinanceCategory, string> = {
  tuition: 'Навчання',
  adaptation: 'Адаптація',
  extra_classes: 'Додаткові заняття',
  meals: 'Харчування',
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Готівка',
  bank_transfer: 'Переказ',
  online: 'Онлайн',
};

const SOURCE_LABELS: Record<ChargeSource, string> = {
  manual: 'Вручну',
  opening_balance: 'Початковий борг',
  monthly: 'Місячна оплата',
  adaptation: 'Адаптація',
  extra_package: 'Пакет занять',
  extra_session: 'Разове заняття',
  meals: 'Харчування',
};

const categoryLabel = (category: FinanceCategory | null): string =>
  category ? CATEGORY_LABELS[category] : NO_CATEGORY;

const kyivDayIso = (at: Date): string => isoDay(kyivToday(at));

export const chargeDay = (c: {
  periodStart: Date | null;
  createdAt: Date;
}): Date => c.periodStart ?? kyivToday(c.createdAt);

const periodOf = (period: PeriodRef) => ({
  from: isoDay(period.from),
  to: isoDay(period.to),
});

const moneyTotals = (rows: ReportRow[], keys: string[]): ReportRow =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      formatMoney(sumMoney(rows.map((row) => String(row[key] ?? '0')))),
    ]),
  );

function groupTotals<T>(
  items: T[],
  keyOf: (item: T) => string,
  amountOf: (item: T) => Prisma.Decimal,
  labelOrder: string[],
  name: string,
  labelColumn: ReportColumn,
): ReportSheet {
  const rows = labelOrder
    .map((label) => ({
      label,
      own: items.filter((item) => keyOf(item) === label),
    }))
    .filter(({ own }) => own.length > 0)
    .map(({ label, own }) => ({
      [labelColumn.key]: label,
      amount: formatMoney(sumMoney(own.map(amountOf))),
    }));
  return {
    name,
    columns: [labelColumn, { key: 'amount', label: 'Сума', type: 'money' }],
    rows,
    totals: {
      [labelColumn.key]: TOTAL_LABEL,
      ...moneyTotals(rows, ['amount']),
    },
  };
}

export function paymentsReport(period: PeriodRef, rows: PaymentRow[]): Report {
  const sorted = [...rows].sort(
    (a, b) =>
      a.receivedAt.getTime() - b.receivedAt.getTime() ||
      a.child.localeCompare(b.child),
  );
  const lines: ReportRow[] = sorted.map((p) => ({
    date: kyivDayIso(p.receivedAt),
    child: p.child,
    group: p.group,
    category: categoryLabel(p.category),
    method: METHOD_LABELS[p.method],
    amount: formatMoney(p.amount),
    reference: p.note ? `${p.reference} · ${p.note}` : p.reference,
  }));
  return {
    title: 'Оплати',
    fileName: 'оплати',
    period: periodOf(period),
    columns: [
      { key: 'date', label: 'Дата', type: 'date' },
      { key: 'child', label: 'Дитина', type: 'text' },
      { key: 'group', label: 'Група', type: 'text' },
      { key: 'category', label: 'Категорія', type: 'text' },
      { key: 'method', label: 'Спосіб', type: 'text' },
      { key: 'amount', label: 'Сума', type: 'money' },
      { key: 'reference', label: 'Номер / коментар', type: 'text' },
    ],
    rows: lines,
    totals: { child: TOTAL_LABEL, ...moneyTotals(lines, ['amount']) },
    sheets: [
      groupTotals(
        sorted,
        (p) => METHOD_LABELS[p.method],
        (p) => p.amount,
        Object.values(METHOD_LABELS),
        'За способами',
        { key: 'method', label: 'Спосіб', type: 'text' },
      ),
      groupTotals(
        sorted,
        (p) => categoryLabel(p.category),
        (p) => p.amount,
        [...Object.values(CATEGORY_LABELS), NO_CATEGORY],
        'За категоріями',
        { key: 'category', label: 'Категорія', type: 'text' },
      ),
    ],
  };
}

export function chargesReport(period: PeriodRef, rows: ChargeRow[]): Report {
  const inside = rows
    .map((row) => ({ row, day: chargeDay(row) }))
    .filter(
      ({ day }) =>
        day.getTime() >= period.from.getTime() &&
        day.getTime() <= period.to.getTime(),
    )
    .sort(
      (a, b) =>
        a.day.getTime() - b.day.getTime() ||
        a.row.child.localeCompare(b.row.child),
    );
  const items = inside.map(({ row }) => row);
  const lines: ReportRow[] = inside.map(({ row, day }) => ({
    date: isoDay(day),
    child: row.child,
    group: row.group,
    category: CATEGORY_LABELS[row.category],
    source: SOURCE_LABELS[row.sourceType],
    description: row.description,
    amount: formatMoney(row.amount),
  }));
  return {
    title: 'Нарахування',
    fileName: 'нарахування',
    period: periodOf(period),
    columns: [
      { key: 'date', label: 'Дата', type: 'date' },
      { key: 'child', label: 'Дитина', type: 'text' },
      { key: 'group', label: 'Група', type: 'text' },
      { key: 'category', label: 'Категорія', type: 'text' },
      { key: 'source', label: 'Джерело', type: 'text' },
      { key: 'description', label: 'Опис', type: 'text' },
      { key: 'amount', label: 'Сума', type: 'money' },
    ],
    rows: lines,
    totals: { child: TOTAL_LABEL, ...moneyTotals(lines, ['amount']) },
    sheets: [
      groupTotals(
        items,
        (c) => CATEGORY_LABELS[c.category],
        (c) => c.amount,
        Object.values(CATEGORY_LABELS),
        'За категоріями',
        { key: 'category', label: 'Категорія', type: 'text' },
      ),
      groupTotals(
        items,
        (c) => SOURCE_LABELS[c.sourceType],
        (c) => c.amount,
        Object.values(SOURCE_LABELS),
        'За джерелами',
        { key: 'source', label: 'Джерело', type: 'text' },
      ),
    ],
  };
}

export function debtsReport(children: DebtChild[], today: Date): Report {
  const categories = Object.values(FinanceCategory);
  const computed = children
    .map((child) => {
      const summary = childMoney(child.charges, child.payments, today);
      const oldest = child.charges
        .filter((c) => !c.voidedAt && chargeRemaining(c).gt(0))
        .map((c) => chargeDay(c).getTime())
        .reduce<number | null>(
          (min, t) => (min === null || t < min ? t : min),
          null,
        );
      return { child, summary, oldest };
    })
    .filter(({ summary }) => money(summary.due).gt(0))
    .sort(
      (a, b) =>
        money(b.summary.due).comparedTo(money(a.summary.due)) ||
        a.child.child.localeCompare(b.child.child),
    );
  const lines: ReportRow[] = computed.map(({ child, summary, oldest }) => ({
    child: child.child,
    group: child.group,
    parents: child.parents,
    ...Object.fromEntries(
      categories.map((category) => [
        `debt_${category}`,
        summary.categories.find((c) => c.category === category)?.due ?? '0.00',
      ]),
    ),
    due: summary.due,
    overdue: summary.overdue,
    oldest: oldest === null ? null : isoDay(new Date(oldest)),
  }));
  const moneyKeys = [...categories.map((c) => `debt_${c}`), 'due', 'overdue'];
  return {
    title: 'Борги',
    fileName: 'борги',
    period: null,
    columns: [
      { key: 'child', label: 'Дитина', type: 'text' },
      { key: 'group', label: 'Група', type: 'text' },
      { key: 'parents', label: 'Батьки', type: 'text' },
      ...categories.map(
        (category): ReportColumn => ({
          key: `debt_${category}`,
          label: CATEGORY_LABELS[category],
          type: 'money',
        }),
      ),
      { key: 'due', label: 'Борг', type: 'money' },
      { key: 'overdue', label: 'Прострочено', type: 'money' },
      { key: 'oldest', label: 'Найстаріше неоплачене', type: 'date' },
    ],
    rows: lines,
    totals: { child: TOTAL_LABEL, ...moneyTotals(lines, moneyKeys) },
    sheets: [],
  };
}
