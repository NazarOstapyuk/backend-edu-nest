import {
  GroupKind,
  PayrollAdjustmentKind,
  PayrollCalendar,
  PayrollLessonType,
  PayrollLineType,
  PayrollSourceType,
  Prisma,
} from '@prisma/client';
import { type CalendarEntryLike, dayInfo } from '../attendance/register-calc';
import {
  addDays,
  firstDayOfMonth,
  lastDayOfMonth,
  maxDay,
  minDay,
} from '../tariffs/dates';

type Decimal = Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);

const round = (value: Decimal) =>
  value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const time = (day: Date) => day.getTime();

export interface RateLike {
  lessonType: PayrollLessonType;
  subjectId: string | null;
  classGroupId: string | null;
  amount: Decimal;
}

export interface AllowanceLike {
  name: string;
  amount: Decimal;
}

export interface TermsLike {
  id: string;
  validFrom: Date;
  validTo: Date | null;
  monthlyRate: Decimal;
  extraHourRate: Decimal | null;
  calendarKind: PayrollCalendar;
  rates: RateLike[];
  allowances: AllowanceLike[];
}

export interface AbsenceLike {
  id: string;
  startDate: Date;
  endDate: Date;
  paid: boolean;
  voidedAt: Date | null;
}

export interface ExtraHoursLike {
  id: string;
  date: Date | null;
  hours: Decimal;
  rate: Decimal | null;
  voidedAt: Date | null;
}

export interface LessonSource {
  sourceType: PayrollSourceType;
  sourceId: string;
  date: Date;
  lessonType: PayrollLessonType;
  subjectId: string | null;
  classGroupId: string | null;
  title: string;
}

export interface BookedLine {
  sourceType: PayrollSourceType;
  sourceId: string;
  lessonType: PayrollLessonType;
  date: Date;
  title: string;
  amount: Decimal;
}

export interface AdjustmentLike {
  kind: PayrollAdjustmentKind;
  amount: Decimal;
  reason: string;
  voidedAt: Date | null;
}

export type LineMeta = {
  noRate?: boolean;
  normDays?: number;
  defaultDays?: number;
  workedDays?: number;
  extraHours?: {
    id: string;
    date: string | null;
    hours: string;
    rate: string | null;
    amount: string;
  }[];
};

export interface ComputedLine {
  type: PayrollLineType;
  sourceType: PayrollSourceType | null;
  sourceId: string | null;
  lessonType: PayrollLessonType | null;
  date: Date | null;
  refMonth: Date | null;
  title: string;
  amount: Decimal;
  meta: LineMeta | null;
}

export type SheetDays = {
  normDays: number;
  defaultDays: number;
  workedDays: number;
  unpaidAbsenceDays: number;
  override: boolean;
};

export interface Segment {
  terms: TermsLike;
  days: number;
  norm: number;
}

export interface SheetInput {
  month: Date;
  terms: TermsLike[];
  entries: CalendarEntryLike[];
  workedDays: number | null;
  lessons: LessonSource[];
  past: LessonSource[];
  booked: BookedLine[];
  adjustments: AdjustmentLike[];
  absences: AbsenceLike[];
  extraHours: ExtraHoursLike[];
}

export interface ComputedSheet {
  days: SheetDays;
  lines: ComputedLine[];
  warnings: {
    noRate: number;
    lessonsWithoutTerms: number;
    lessonsOnAbsenceDays: string[];
  };
  lessons: number;
}

const calendarGroup = (kind: PayrollCalendar) => {
  if (kind === PayrollCalendar.kindergarten)
    return { id: '', kind: GroupKind.kindergarten };
  if (kind === PayrollCalendar.school_class)
    return { id: '', kind: GroupKind.school_class };
  return null;
};

export function workingDays(
  from: Date,
  to: Date,
  kind: PayrollCalendar,
  entries: CalendarEntryLike[],
): number {
  const group = calendarGroup(kind);
  let count = 0;
  for (let day = from; time(day) <= time(to); day = addDays(day, 1)) {
    if (dayInfo(day, group, entries).working) count++;
  }
  return count;
}

export function termsOn(terms: TermsLike[], day: Date): TermsLike | null {
  return (
    terms.find(
      (t) =>
        time(t.validFrom) <= time(day) &&
        (t.validTo === null || time(day) <= time(t.validTo)),
    ) ?? null
  );
}

export function rateFor(
  terms: TermsLike,
  lesson: LessonSource,
): Decimal | null {
  const sameType = terms.rates.filter(
    (r) => r.lessonType === lesson.lessonType,
  );
  const specific = sameType.find(
    (r) =>
      (r.subjectId !== null && r.subjectId === lesson.subjectId) ||
      (r.classGroupId !== null && r.classGroupId === lesson.classGroupId),
  );
  const general = sameType.find(
    (r) => r.subjectId === null && r.classGroupId === null,
  );
  return (specific ?? general)?.amount ?? null;
}

export function monthSegments(
  month: Date,
  terms: TermsLike[],
  entries: CalendarEntryLike[],
): Segment[] {
  const from = firstDayOfMonth(month);
  const to = lastDayOfMonth(month);
  return terms
    .filter(
      (t) =>
        time(t.validFrom) <= time(to) &&
        (t.validTo === null || time(t.validTo) >= time(from)),
    )
    .sort((a, b) => time(a.validFrom) - time(b.validFrom))
    .map((t) => ({
      terms: t,
      days: workingDays(
        maxDay(from, t.validFrom),
        t.validTo ? minDay(to, t.validTo) : to,
        t.calendarKind,
        entries,
      ),
      norm: workingDays(from, to, t.calendarKind, entries),
    }));
}

const isoDay = (day: Date) => day.toISOString().slice(0, 10);

const absenceDayTimes = (
  month: Date,
  segments: Segment[],
  absences: AbsenceLike[],
  entries: CalendarEntryLike[],
): Set<number> => {
  const monthFrom = firstDayOfMonth(month);
  const monthTo = lastDayOfMonth(month);
  const counted = new Set<number>();
  for (const segment of segments) {
    const { terms } = segment;
    const group = calendarGroup(terms.calendarKind);
    const from = maxDay(monthFrom, terms.validFrom);
    const to = terms.validTo ? minDay(monthTo, terms.validTo) : monthTo;
    for (const absence of absences) {
      const start = maxDay(from, absence.startDate);
      const end = minDay(to, absence.endDate);
      for (let day = start; time(day) <= time(end); day = addDays(day, 1)) {
        if (dayInfo(day, group, entries).working) counted.add(time(day));
      }
    }
  }
  return counted;
};

export function absenceWorkingDays(
  month: Date,
  segments: Segment[],
  absence: AbsenceLike,
  entries: CalendarEntryLike[],
): number {
  return absenceDayTimes(month, segments, [absence], entries).size;
}

export function unpaidAbsenceDays(
  month: Date,
  segments: Segment[],
  absences: AbsenceLike[],
  entries: CalendarEntryLike[],
): number {
  const unpaid = absences.filter((a) => !a.paid && a.voidedAt === null);
  return absenceDayTimes(month, segments, unpaid, entries).size;
}

export function sheetDays(
  segments: Segment[],
  override: number | null,
  unpaidDays = 0,
): SheetDays {
  const defaultDays = segments.reduce((sum, s) => sum + s.days, 0);
  const normDays = segments.length ? segments[segments.length - 1].norm : 0;
  return {
    normDays,
    defaultDays,
    workedDays: override ?? Math.max(0, defaultDays - unpaidDays),
    unpaidAbsenceDays: unpaidDays,
    override: override !== null,
  };
}

const share = (amount: Decimal, segment: Segment, days: SheetDays) =>
  segment.norm === 0 || days.defaultDays === 0
    ? ZERO
    : amount
        .mul(segment.days)
        .div(segment.norm)
        .mul(days.workedDays)
        .div(days.defaultDays);

const plainLine = (
  type: PayrollLineType,
  title: string,
  amount: Decimal,
  meta: LineMeta | null = null,
): ComputedLine => ({
  type,
  sourceType: null,
  sourceId: null,
  lessonType: null,
  date: null,
  refMonth: null,
  title,
  amount,
  meta,
});

type LessonRef = Omit<LessonSource, 'subjectId' | 'classGroupId'>;

const lessonLine = (
  type: PayrollLineType,
  lesson: LessonRef,
  amount: Decimal,
  noRate: boolean,
  refMonth: Date | null,
): ComputedLine => ({
  type,
  sourceType: lesson.sourceType,
  sourceId: lesson.sourceId,
  lessonType: lesson.lessonType,
  date: lesson.date,
  refMonth,
  title: lesson.title,
  amount,
  meta: noRate ? { noRate: true } : null,
});

export function baseLines(
  segments: Segment[],
  days: SheetDays,
): ComputedLine[] {
  const lines: ComputedLine[] = [];
  if (segments.some((s) => s.terms.monthlyRate.gt(0))) {
    const amount = segments.reduce(
      (sum, s) => sum.add(share(s.terms.monthlyRate, s, days)),
      ZERO,
    );
    lines.push(
      plainLine(PayrollLineType.base, '', round(amount), {
        normDays: days.normDays,
        defaultDays: days.defaultDays,
        workedDays: days.workedDays,
      }),
    );
  }
  for (const segment of segments) {
    for (const allowance of segment.terms.allowances) {
      lines.push(
        plainLine(
          PayrollLineType.allowance,
          allowance.name,
          round(share(allowance.amount, segment, days)),
        ),
      );
    }
  }
  return lines;
}

const byDate = (a: LessonRef, b: LessonRef) =>
  time(a.date) - time(b.date) || a.sourceId.localeCompare(b.sourceId);

export function lessonLines(
  lessons: LessonSource[],
  terms: TermsLike[],
): { lines: ComputedLine[]; withoutTerms: number } {
  const lines: ComputedLine[] = [];
  let withoutTerms = 0;
  for (const lesson of [...lessons].sort(byDate)) {
    const version = termsOn(terms, lesson.date);
    if (!version) {
      withoutTerms++;
      continue;
    }
    const rate = rateFor(version, lesson);
    lines.push(
      lessonLine(
        PayrollLineType.lesson,
        lesson,
        rate ?? ZERO,
        rate === null,
        null,
      ),
    );
  }
  return { lines, withoutTerms };
}

const sourceKey = (item: LessonRef) => `${item.sourceType}:${item.sourceId}`;

export function correctionLines(
  past: LessonSource[],
  booked: BookedLine[],
  terms: TermsLike[],
): ComputedLine[] {
  const net = new Map<string, Decimal>();
  const original = new Map<string, Decimal>();
  const samples = new Map<string, BookedLine>();
  for (const line of booked) {
    const key = sourceKey(line);
    net.set(key, (net.get(key) ?? ZERO).add(line.amount));
    const top = original.get(key);
    if (top === undefined || line.amount.gt(top))
      original.set(key, line.amount);
    if (!samples.has(key)) samples.set(key, line);
  }
  const lines: ComputedLine[] = [];
  const counted = new Set<string>();
  for (const lesson of [...past].sort(byDate)) {
    const version = termsOn(terms, lesson.date);
    if (!version) continue;
    const key = sourceKey(lesson);
    counted.add(key);
    const refMonth = firstDayOfMonth(lesson.date);
    const bookedNet = net.get(key);
    if (bookedNet === undefined) {
      const rate = rateFor(version, lesson);
      lines.push(
        lessonLine(
          PayrollLineType.correction,
          lesson,
          rate ?? ZERO,
          rate === null,
          refMonth,
        ),
      );
      continue;
    }
    const top = original.get(key) ?? ZERO;
    const target = top.gt(0) ? top : ZERO;
    const diff = target.sub(bookedNet);
    if (!diff.isZero())
      lines.push(
        lessonLine(PayrollLineType.correction, lesson, diff, false, refMonth),
      );
  }
  const removed = [...samples.entries()]
    .filter(([key]) => !counted.has(key))
    .map(([, sample]) => sample)
    .sort(byDate);
  for (const sample of removed) {
    const bookedNet = net.get(sourceKey(sample)) ?? ZERO;
    if (bookedNet.isZero()) continue;
    lines.push(
      lessonLine(
        PayrollLineType.correction,
        sample,
        bookedNet.neg(),
        false,
        firstDayOfMonth(sample.date),
      ),
    );
  }
  return lines;
}

export function adjustmentLines(adjustments: AdjustmentLike[]): ComputedLine[] {
  return adjustments
    .filter((a) => a.voidedAt === null)
    .map((a) =>
      plainLine(
        PayrollLineType.adjustment,
        a.reason,
        a.kind === PayrollAdjustmentKind.bonus ? a.amount : a.amount.neg(),
      ),
    );
}

export function extraHoursLine(
  month: Date,
  terms: TermsLike[],
  records: ExtraHoursLike[],
): ComputedLine | null {
  const active = records.filter((r) => r.voidedAt === null);
  if (active.length === 0) return null;
  const monthEnd = lastDayOfMonth(month);
  const last = monthSegments(month, terms, []).at(-1)?.terms ?? null;
  const monthlyRate = last
    ? (termsOn(terms, last.validTo ? minDay(monthEnd, last.validTo) : monthEnd)
        ?.extraHourRate ?? null)
    : null;
  let noRate = false;
  let total = ZERO;
  let hours = ZERO;
  const items: NonNullable<LineMeta['extraHours']> = [];
  for (const record of active) {
    const rate =
      record.rate ??
      (record.date
        ? (termsOn(terms, record.date)?.extraHourRate ?? null)
        : monthlyRate);
    if (rate === null) noRate = true;
    const amount = rate === null ? ZERO : record.hours.mul(rate);
    total = total.add(amount);
    hours = hours.add(record.hours);
    items.push({
      id: record.id,
      date: record.date ? isoDay(record.date) : null,
      hours: record.hours.toFixed(2),
      rate: rate === null ? null : rate.toFixed(2),
      amount: round(amount).toFixed(2),
    });
  }
  const label = hours.toDecimalPlaces(2).toFixed().replace('.', ',');
  const meta: LineMeta = { extraHours: items };
  if (noRate) meta.noRate = true;
  return plainLine(
    PayrollLineType.extra_hours,
    'Додаткові години: ' + label + ' год',
    round(total),
    meta,
  );
}

export function lessonsOnAbsenceDays(
  lessons: LessonSource[],
  absences: AbsenceLike[],
): string[] {
  const active = absences.filter((a) => a.voidedAt === null);
  const dates = lessons
    .filter((l) =>
      active.some(
        (a) =>
          time(a.startDate) <= time(l.date) && time(l.date) <= time(a.endDate),
      ),
    )
    .map((l) => isoDay(l.date));
  return [...new Set(dates)].sort();
}

export const sumAmounts = (items: { amount: Decimal }[]): Decimal =>
  items.reduce((sum, item) => sum.add(item.amount), ZERO);

export function computeSheet(input: SheetInput): ComputedSheet {
  const segments = monthSegments(input.month, input.terms, input.entries);
  const unpaid = unpaidAbsenceDays(
    input.month,
    segments,
    input.absences,
    input.entries,
  );
  const days = sheetDays(segments, input.workedDays, unpaid);
  const lessons = lessonLines(input.lessons, input.terms);
  const extra = extraHoursLine(input.month, input.terms, input.extraHours);
  const lines = [
    ...baseLines(segments, days),
    ...(extra ? [extra] : []),
    ...lessons.lines,
    ...correctionLines(input.past, input.booked, input.terms),
    ...adjustmentLines(input.adjustments),
  ];
  return {
    days,
    lines,
    warnings: {
      noRate: lines.filter((l) => l.meta?.noRate).length,
      lessonsWithoutTerms: lessons.withoutTerms,
      lessonsOnAbsenceDays: lessonsOnAbsenceDays(input.lessons, input.absences),
    },
    lessons: lessons.lines.length,
  };
}
