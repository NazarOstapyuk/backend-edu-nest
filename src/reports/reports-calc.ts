import {
  ChargeSource,
  DailyStatus,
  FinanceCategory,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import {
  CalendarEntryLike,
  GroupLike,
  MarkLike,
  NoticeLike,
  ResolvedDay,
  dayInfo,
  dayRange,
  resolveDay,
} from '../attendance/register-calc';
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

export interface AttendanceChild {
  child: string;
  group: GroupLike & { name: string };
  marks: MarkLike[];
  notices: NoticeLike[];
}

export interface MealOrderRow {
  date: Date;
  group: string | null;
  complex: string;
  price: Prisma.Decimal;
}

const MARK_CODES: Record<DailyStatus, string> = {
  present: 'П',
  late: 'З',
  left_early: 'Р',
  absent: 'В',
};

const percentOf = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 10000) / 10000;

const sumNumbers = (rows: ReportRow[], key: string): number =>
  rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);

function dayCode(
  resolved: ResolvedDay,
  excusedReasonIds: ReadonlySet<string>,
): string {
  if (resolved.state === 'non_working') return '';
  if (resolved.state === 'unmarked') return '·';
  if (resolved.status && resolved.status !== DailyStatus.absent)
    return MARK_CODES[resolved.status];
  const excused =
    resolved.reasonId !== null && excusedReasonIds.has(resolved.reasonId);
  return excused ? MARK_CODES.absent : 'Н';
}

export function attendanceReport(
  period: PeriodRef,
  children: AttendanceChild[],
  entries: CalendarEntryLike[],
  excusedReasonIds: ReadonlySet<string>,
): Report {
  const days = dayRange(period.from, period.to);
  const computed = [...children]
    .sort(
      (a, b) =>
        a.group.name.localeCompare(b.group.name) ||
        a.child.localeCompare(b.child),
    )
    .map((item) => {
      const resolved = days.map((day) => {
        const { working } = dayInfo(day, item.group, entries);
        return resolveDay(day, working, item.marks, item.notices);
      });
      const counted = resolved.filter((r) => r.working);
      const absent = counted.filter(
        (r) => r.state === 'absent' || r.state === 'expected_absent',
      );
      const isExcused = (r: ResolvedDay) =>
        r.reasonId !== null && excusedReasonIds.has(r.reasonId);
      return {
        item,
        resolved,
        working: counted.length,
        present: counted.filter((r) => r.state === 'present').length,
        excused: absent.filter(isExcused).length,
        unexcused: absent.filter((r) => !isExcused(r)).length,
        unmarked: counted.filter((r) => r.state === 'unmarked').length,
      };
    });
  const lines: ReportRow[] = computed.map((c) => ({
    child: c.item.child,
    group: c.item.group.name,
    working: c.working,
    present: c.present,
    excused: c.excused,
    unexcused: c.unexcused,
    unmarked: c.unmarked,
    percent: percentOf(c.present, c.working),
  }));
  const totalWorking = sumNumbers(lines, 'working');
  const totalPresent = sumNumbers(lines, 'present');
  const dayColumns: ReportColumn[] = days.map((day) => ({
    key: `d_${isoDay(day)}`,
    label: `${isoDay(day).slice(8, 10)}.${isoDay(day).slice(5, 7)}`,
    type: 'text',
  }));
  return {
    title: 'Відвідування',
    fileName: 'відвідування',
    period: periodOf(period),
    columns: [
      { key: 'child', label: 'Дитина', type: 'text' },
      { key: 'group', label: 'Група', type: 'text' },
      { key: 'working', label: 'Робочих днів', type: 'number' },
      { key: 'present', label: 'Присутній', type: 'number' },
      { key: 'excused', label: 'Відсутній з поважної', type: 'number' },
      { key: 'unexcused', label: 'Відсутній без поважної', type: 'number' },
      { key: 'unmarked', label: 'Не відмічено', type: 'number' },
      { key: 'percent', label: 'Присутність', type: 'percent' },
    ],
    rows: lines,
    totals: {
      child: TOTAL_LABEL,
      working: totalWorking,
      present: totalPresent,
      excused: sumNumbers(lines, 'excused'),
      unexcused: sumNumbers(lines, 'unexcused'),
      unmarked: sumNumbers(lines, 'unmarked'),
      percent: percentOf(totalPresent, totalWorking),
    },
    sheets: [
      {
        name: 'Табель',
        columns: [
          { key: 'child', label: 'Дитина', type: 'text' },
          { key: 'group', label: 'Група', type: 'text' },
          ...dayColumns,
        ],
        rows: computed.map((c) => ({
          child: c.item.child,
          group: c.item.group.name,
          ...Object.fromEntries(
            days.map((day, i) => [
              `d_${isoDay(day)}`,
              dayCode(c.resolved[i], excusedReasonIds),
            ]),
          ),
        })),
        totals: null,
      },
    ],
  };
}

interface MealBucket {
  day: string;
  group: string;
  complex: string;
  prices: Prisma.Decimal[];
}

const mealSheet = (
  name: string,
  labelColumn: ReportColumn,
  buckets: { label: string; prices: Prisma.Decimal[] }[],
): ReportSheet => {
  const rows: ReportRow[] = buckets.map(({ label, prices }) => ({
    [labelColumn.key]: label,
    count: prices.length,
    amount: formatMoney(sumMoney(prices)),
  }));
  return {
    name,
    columns: [
      labelColumn,
      { key: 'count', label: 'Замовлень', type: 'number' },
      { key: 'amount', label: 'Сума', type: 'money' },
    ],
    rows,
    totals: {
      [labelColumn.key]: TOTAL_LABEL,
      count: sumNumbers(rows, 'count'),
      ...moneyTotals(rows, ['amount']),
    },
  };
};

const bucketsBy = (
  rows: MealBucket[],
  labelOf: (bucket: MealBucket) => string,
): { label: string; prices: Prisma.Decimal[] }[] => {
  const map = new Map<string, Prisma.Decimal[]>();
  for (const row of rows)
    map.set(labelOf(row), [...(map.get(labelOf(row)) ?? []), ...row.prices]);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, prices]) => ({ label, prices }));
};

export function mealsReport(period: PeriodRef, orders: MealOrderRow[]): Report {
  const map = new Map<string, MealBucket>();
  for (const order of orders) {
    const bucket = {
      day: isoDay(order.date),
      group: order.group ?? '',
      complex: order.complex,
    };
    const key = JSON.stringify(bucket);
    const existing = map.get(key);
    if (existing) existing.prices.push(order.price);
    else map.set(key, { ...bucket, prices: [order.price] });
  }
  const buckets = [...map.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.group.localeCompare(b.group) ||
      a.complex.localeCompare(b.complex),
  );
  const lines: ReportRow[] = buckets.map((b) => ({
    date: b.day,
    group: b.group,
    complex: b.complex,
    count: b.prices.length,
    amount: formatMoney(sumMoney(b.prices)),
  }));
  return {
    title: 'Харчування',
    fileName: 'харчування',
    period: periodOf(period),
    columns: [
      { key: 'date', label: 'Дата', type: 'date' },
      { key: 'group', label: 'Група', type: 'text' },
      { key: 'complex', label: 'Комплекс', type: 'text' },
      { key: 'count', label: 'Замовлень', type: 'number' },
      { key: 'amount', label: 'Сума', type: 'money' },
    ],
    rows: lines,
    totals: {
      date: TOTAL_LABEL,
      count: sumNumbers(lines, 'count'),
      ...moneyTotals(lines, ['amount']),
    },
    sheets: [
      mealSheet(
        'За днями',
        { key: 'date', label: 'Дата', type: 'date' },
        bucketsBy(buckets, (b) => b.day),
      ),
      mealSheet(
        'За комплексами',
        { key: 'complex', label: 'Комплекс', type: 'text' },
        bucketsBy(buckets, (b) => b.complex),
      ),
    ],
  };
}
