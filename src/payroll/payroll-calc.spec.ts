import {
  CalendarDayType,
  CalendarScope,
  PayrollAdjustmentKind,
  PayrollCalendar,
  PayrollLessonType,
  PayrollLineType,
  PayrollSourceType,
  Prisma,
} from '@prisma/client';
import type { CalendarEntryLike } from '../attendance/register-calc';
import {
  type AbsenceLike,
  type BookedLine,
  type ExtraHoursLike,
  type LessonSource,
  type TermsLike,
  adjustmentLines,
  baseLines,
  computeSheet,
  correctionLines,
  absenceWorkingDays,
  extraHoursLine,
  lessonsOnAbsenceDays,
  unpaidAbsenceDays,
  lessonLines,
  monthSegments,
  rateFor,
  sheetDays,
  sumAmounts,
  workingDays,
} from './payroll-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dec = (value: string) => new Prisma.Decimal(value);
const OCT = day('2026-10-01');

const holiday = (
  date: string,
  scope: CalendarScope = CalendarScope.all,
): CalendarEntryLike => ({
  startDate: day(date),
  endDate: day(date),
  type: CalendarDayType.non_working,
  scope,
  groupId: null,
  title: 'Свято',
  voidedAt: null,
});

const terms = (over: Partial<TermsLike> = {}): TermsLike => ({
  id: 't1',
  validFrom: day('2026-09-01'),
  validTo: null,
  monthlyRate: dec('22000'),
  extraHourRate: null,
  calendarKind: PayrollCalendar.all,
  rates: [],
  allowances: [],
  ...over,
});

const school = (
  id: string,
  date: string,
  subjectId = 's-math',
): LessonSource => ({
  sourceType: PayrollSourceType.school_lesson,
  sourceId: id,
  date: day(date),
  lessonType: PayrollLessonType.school_lesson,
  subjectId,
  classGroupId: null,
  title: 'Математика',
});

const booked = (id: string, date: string, amount: string): BookedLine => ({
  sourceType: PayrollSourceType.school_lesson,
  sourceId: id,
  lessonType: PayrollLessonType.school_lesson,
  date: day(date),
  title: 'Математика',
  amount: dec(amount),
});

const rates = [
  {
    lessonType: PayrollLessonType.school_lesson,
    subjectId: null,
    classGroupId: null,
    amount: dec('300'),
  },
  {
    lessonType: PayrollLessonType.school_lesson,
    subjectId: 's-math',
    classGroupId: null,
    amount: dec('350'),
  },
  {
    lessonType: PayrollLessonType.class_group,
    subjectId: null,
    classGroupId: null,
    amount: dec('400'),
  },
  {
    lessonType: PayrollLessonType.individual,
    subjectId: null,
    classGroupId: 'cg1',
    amount: dec('500'),
  },
];

const amounts = (lines: { amount: Prisma.Decimal }[]) =>
  lines.map((l) => l.amount.toFixed(2));

describe('workingDays', () => {
  it('counts Mon–Fri of October 2026', () => {
    expect(workingDays(OCT, day('2026-10-31'), PayrollCalendar.all, [])).toBe(
      22,
    );
  });

  it('applies kind-specific entries only to that calendar', () => {
    const entries = [holiday('2026-10-14', CalendarScope.kindergarten)];
    const end = day('2026-10-31');
    expect(workingDays(OCT, end, PayrollCalendar.kindergarten, entries)).toBe(
      21,
    );
    expect(workingDays(OCT, end, PayrollCalendar.school_class, entries)).toBe(
      22,
    );
    expect(workingDays(OCT, end, PayrollCalendar.all, entries)).toBe(22);
  });
});

describe('base and allowances', () => {
  it('pays the full rate for a full month with a holiday', () => {
    const segments = monthSegments(OCT, [terms()], [holiday('2026-10-14')]);
    const days = sheetDays(segments, null);
    expect(days).toEqual({
      normDays: 21,
      defaultDays: 21,
      workedDays: 21,
      unpaidAbsenceDays: 0,
      override: false,
    });
    expect(amounts(baseLines(segments, days))).toEqual(['22000.00']);
  });

  it('prorates two versions inside one month', () => {
    const segments = monthSegments(
      OCT,
      [
        terms({ validTo: day('2026-10-15') }),
        terms({
          id: 't2',
          validFrom: day('2026-10-16'),
          monthlyRate: dec('33000'),
        }),
      ],
      [],
    );
    const lines = baseLines(segments, sheetDays(segments, null));
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe(PayrollLineType.base);
    expect(lines[0].amount.toFixed(2)).toBe('27500.00');
    expect(lines[0].meta).toEqual({
      normDays: 22,
      defaultDays: 22,
      workedDays: 22,
    });
  });

  it('prorates a teacher hired mid-month', () => {
    const segments = monthSegments(
      OCT,
      [terms({ validFrom: day('2026-10-16'), monthlyRate: dec('33000') })],
      [],
    );
    const days = sheetDays(segments, null);
    expect(days.defaultDays).toBe(11);
    expect(amounts(baseLines(segments, days))).toEqual(['16500.00']);
  });

  it('applies the worked-days override with half-up rounding', () => {
    const segments = monthSegments(
      OCT,
      [terms({ monthlyRate: dec('10000') })],
      [],
    );
    const days = sheetDays(segments, 7);
    expect(days).toEqual({
      normDays: 22,
      defaultDays: 22,
      workedDays: 7,
      unpaidAbsenceDays: 0,
      override: true,
    });
    expect(amounts(baseLines(segments, days))).toEqual(['3181.82']);
  });

  it('uses the kindergarten norm for kindergarten terms', () => {
    const segments = monthSegments(
      OCT,
      [
        terms({
          calendarKind: PayrollCalendar.kindergarten,
          monthlyRate: dec('21000'),
        }),
      ],
      [holiday('2026-10-14', CalendarScope.kindergarten)],
    );
    const days = sheetDays(segments, null);
    expect(days.normDays).toBe(21);
    expect(amounts(baseLines(segments, days))).toEqual(['21000.00']);
  });

  it('gives zero when the whole month is non-working', () => {
    const closed: CalendarEntryLike = {
      ...holiday('2026-10-01'),
      endDate: day('2026-10-31'),
    };
    const segments = monthSegments(OCT, [terms()], [closed]);
    expect(amounts(baseLines(segments, sheetDays(segments, null)))).toEqual([
      '0.00',
    ]);
  });

  it('prorates allowances like the rate and omits the base line for a zero rate', () => {
    const segments = monthSegments(
      OCT,
      [
        terms({
          monthlyRate: dec('0'),
          allowances: [{ name: 'Класне керівництво', amount: dec('1000') }],
        }),
      ],
      [],
    );
    const lines = baseLines(segments, sheetDays(segments, 11));
    expect(lines.map((l) => [l.type, l.title, l.amount.toFixed(2)])).toEqual([
      [PayrollLineType.allowance, 'Класне керівництво', '500.00'],
    ]);
  });
});

describe('rates and lessons', () => {
  const version = terms({ rates });

  it('prefers the most specific rate', () => {
    expect(rateFor(version, school('l1', '2026-10-05'))?.toFixed(2)).toBe(
      '350.00',
    );
    expect(
      rateFor(version, school('l2', '2026-10-05', 's-art'))?.toFixed(2),
    ).toBe('300.00');
    expect(
      rateFor(version, {
        ...school('l3', '2026-10-05'),
        sourceType: PayrollSourceType.class_lesson,
        lessonType: PayrollLessonType.class_group,
        subjectId: null,
        classGroupId: 'cg9',
      })?.toFixed(2),
    ).toBe('400.00');
  });

  it('lists a lesson without a rate with zero and a flag', () => {
    const lesson: LessonSource = {
      ...school('l4', '2026-10-06'),
      sourceType: PayrollSourceType.class_lesson,
      lessonType: PayrollLessonType.individual,
      subjectId: null,
      classGroupId: 'cg2',
      title: 'Вокал',
    };
    const { lines } = lessonLines([lesson], [version]);
    expect(lines[0].amount.toFixed(2)).toBe('0.00');
    expect(lines[0].meta).toEqual({ noRate: true });
  });

  it('ignores lessons outside any terms and sorts by date', () => {
    const late = terms({ validFrom: day('2026-10-16'), rates });
    const result = lessonLines(
      [
        school('l6', '2026-10-20'),
        school('l5', '2026-10-10'),
        school('l7', '2026-10-19'),
      ],
      [late],
    );
    expect(result.withoutTerms).toBe(1);
    expect(result.lines.map((l) => l.sourceId)).toEqual(['l7', 'l6']);
    expect(result.lines[0].type).toBe(PayrollLineType.lesson);
  });
});

describe('correctionLines', () => {
  const version = [terms({ rates })];

  it('adds a lesson recorded after its month was approved', () => {
    const lines = correctionLines([school('l1', '2026-09-10')], [], version);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe(PayrollLineType.correction);
    expect(lines[0].amount.toFixed(2)).toBe('350.00');
    expect(lines[0].refMonth).toEqual(day('2026-09-01'));
  });

  it('removes a booked lesson that no longer counts', () => {
    const lines = correctionLines(
      [],
      [booked('l2', '2026-09-11', '300')],
      version,
    );
    expect(amounts(lines)).toEqual(['-300.00']);
    expect(lines[0].sourceId).toBe('l2');
    expect(lines[0].refMonth).toEqual(day('2026-09-01'));
  });

  it('does not repeat an already booked lesson', () => {
    expect(
      correctionLines(
        [school('l1', '2026-09-10')],
        [booked('l1', '2026-09-10', '350')],
        version,
      ),
    ).toEqual([]);
  });

  it('restores a removed lesson at its original amount', () => {
    const lines = correctionLines(
      [school('l1', '2026-09-10')],
      [booked('l1', '2026-09-10', '320'), booked('l1', '2026-09-10', '-320')],
      version,
    );
    expect(amounts(lines)).toEqual(['320.00']);
  });

  it('books a lesson without a rate once with zero', () => {
    const lesson: LessonSource = {
      ...school('l9', '2026-09-12'),
      lessonType: PayrollLessonType.individual,
      sourceType: PayrollSourceType.class_lesson,
      subjectId: null,
      classGroupId: 'cg2',
    };
    const first = correctionLines([lesson], [], version);
    expect(amounts(first)).toEqual(['0.00']);
    expect(first[0].meta).toEqual({ noRate: true });
    expect(
      correctionLines(
        [lesson],
        [{ ...booked('l9', '2026-09-12', '0'), sourceType: lesson.sourceType }],
        version,
      ),
    ).toEqual([]);
  });

  it('removes a booked lesson whose date has no terms any more', () => {
    const lines = correctionLines(
      [school('l1', '2026-08-10')],
      [booked('l1', '2026-08-10', '350')],
      version,
    );
    expect(amounts(lines)).toEqual(['-350.00']);
  });
});

describe('adjustments and totals', () => {
  it('signs adjustments and skips voided ones', () => {
    const lines = adjustmentLines([
      {
        kind: PayrollAdjustmentKind.bonus,
        amount: dec('500'),
        reason: 'Премія',
        voidedAt: null,
      },
      {
        kind: PayrollAdjustmentKind.deduction,
        amount: dec('200'),
        reason: 'Аванс з каси',
        voidedAt: null,
      },
      {
        kind: PayrollAdjustmentKind.bonus,
        amount: dec('900'),
        reason: 'Помилка',
        voidedAt: day('2026-10-02'),
      },
    ]);
    expect(lines.map((l) => [l.type, l.title, l.amount.toFixed(2)])).toEqual([
      [PayrollLineType.adjustment, 'Премія', '500.00'],
      [PayrollLineType.adjustment, 'Аванс з каси', '-200.00'],
    ]);
  });

  it('sums amounts', () => {
    expect(
      sumAmounts([{ amount: dec('1.10') }, { amount: dec('-0.10') }]).toFixed(
        2,
      ),
    ).toBe('1.00');
    expect(sumAmounts([]).toFixed(2)).toBe('0.00');
  });
});

describe('computeSheet', () => {
  it('combines base, lessons, corrections and adjustments in order', () => {
    const result = computeSheet({
      month: OCT,
      terms: [terms({ rates })],
      entries: [],
      workedDays: null,
      lessons: [school('l1', '2026-10-05')],
      past: [school('l0', '2026-09-30')],
      booked: [],
      adjustments: [
        {
          kind: PayrollAdjustmentKind.bonus,
          amount: dec('100'),
          reason: 'Премія',
          voidedAt: null,
        },
      ],
      absences: [],
      extraHours: [],
    });
    expect(result.lines.map((l) => l.type)).toEqual([
      PayrollLineType.base,
      PayrollLineType.lesson,
      PayrollLineType.correction,
      PayrollLineType.adjustment,
    ]);
    expect(sumAmounts(result.lines).toFixed(2)).toBe('22800.00');
    expect(result.lessons).toBe(1);
    expect(result.warnings).toEqual({
      noRate: 0,
      lessonsWithoutTerms: 0,
      lessonsOnAbsenceDays: [],
    });
    expect(result.days.normDays).toBe(22);
  });

  it('returns an empty sheet without terms', () => {
    const result = computeSheet({
      month: OCT,
      terms: [],
      entries: [],
      workedDays: null,
      lessons: [school('l1', '2026-10-05')],
      past: [],
      booked: [],
      adjustments: [],
      absences: [],
      extraHours: [],
    });
    expect(result.lines).toEqual([]);
    expect(result.days).toEqual({
      normDays: 0,
      defaultDays: 0,
      workedDays: 0,
      unpaidAbsenceDays: 0,
      override: false,
    });
    expect(result.warnings.lessonsWithoutTerms).toBe(1);
  });
});

const NOV = day('2026-11-01');

const absence = (
  id: string,
  from: string,
  to: string,
  over: Partial<AbsenceLike> = {},
): AbsenceLike => ({
  id,
  startDate: day(from),
  endDate: day(to),
  paid: false,
  voidedAt: null,
  ...over,
});

const hoursRec = (
  id: string,
  date: string | null,
  hours: string,
  over: Partial<ExtraHoursLike> = {},
): ExtraHoursLike => ({
  id,
  date: date ? day(date) : null,
  hours: dec(hours),
  rate: null,
  voidedAt: null,
  ...over,
});

const novSheet = (
  t: TermsLike[],
  absences: AbsenceLike[],
  workedDays: number | null = null,
  entries: CalendarEntryLike[] = [],
) =>
  computeSheet({
    month: NOV,
    terms: t,
    entries,
    workedDays,
    lessons: [],
    past: [],
    booked: [],
    adjustments: [],
    absences,
    extraHours: [],
  });

describe('unpaid absences', () => {
  const base = terms({ monthlyRate: dec('20000') });

  it('lowers worked days and the base for an unpaid absence', () => {
    const result = novSheet(
      [base],
      [absence('a1', '2026-11-09', '2026-11-11')],
    );
    expect(result.days.defaultDays).toBe(21);
    expect(result.days.workedDays).toBe(18);
    expect(result.days.unpaidAbsenceDays).toBe(3);
    expect(result.lines[0].amount.toFixed(2)).toBe(
      dec('20000').mul(18).div(21).toFixed(2),
    );
  });

  it('ignores paid and voided absences', () => {
    const result = novSheet(
      [base],
      [
        absence('a1', '2026-11-09', '2026-11-11', { paid: true }),
        absence('a2', '2026-11-16', '2026-11-17', {
          voidedAt: day('2026-11-02'),
        }),
      ],
    );
    expect(result.days.workedDays).toBe(21);
    expect(result.lines[0].amount.toFixed(2)).toBe('20000.00');
  });

  it('counts only the days inside the month', () => {
    const segments = monthSegments(NOV, [base], []);
    const a = absence('a1', '2026-10-30', '2026-11-03');
    expect(unpaidAbsenceDays(NOV, segments, [a], [])).toBe(2);
    expect(absenceWorkingDays(NOV, segments, a, [])).toBe(2);
  });

  it('skips holidays', () => {
    const result = novSheet(
      [base],
      [absence('a1', '2026-11-09', '2026-11-11')],
      null,
      [holiday('2026-11-10')],
    );
    expect(result.days.unpaidAbsenceDays).toBe(2);
    expect(result.days.defaultDays).toBe(20);
    expect(result.days.workedDays).toBe(18);
  });

  it('ignores days before the terms start', () => {
    const late = terms({
      monthlyRate: dec('20000'),
      validFrom: day('2026-11-10'),
    });
    const result = novSheet(
      [late],
      [absence('a1', '2026-11-02', '2026-11-11')],
    );
    expect(result.days.unpaidAbsenceDays).toBe(2);
  });

  it('does not count a weekend-only absence', () => {
    const result = novSheet(
      [base],
      [absence('a1', '2026-11-07', '2026-11-08')],
    );
    expect(result.days.unpaidAbsenceDays).toBe(0);
    expect(result.days.workedDays).toBe(21);
  });

  it('does not count days in a gap between terms versions', () => {
    const first = terms({
      monthlyRate: dec('20000'),
      validTo: day('2026-11-10'),
    });
    const second = terms({
      monthlyRate: dec('20000'),
      validFrom: day('2026-11-20'),
    });
    const segments = monthSegments(NOV, [first, second], []);
    const a = absence('a1', '2026-11-12', '2026-11-16');
    expect(unpaidAbsenceDays(NOV, segments, [a], [])).toBe(0);
    expect(absenceWorkingDays(NOV, segments, a, [])).toBe(0);
  });

  it('keeps the override and still reports unpaid days', () => {
    const result = novSheet(
      [base],
      [absence('a1', '2026-11-09', '2026-11-11')],
      15,
    );
    expect(result.days.workedDays).toBe(15);
    expect(result.days.override).toBe(true);
    expect(result.days.unpaidAbsenceDays).toBe(3);
  });

  it('scales allowances like the rate', () => {
    const withAllowance = terms({
      monthlyRate: dec('21000'),
      allowances: [{ name: 'Класне керівництво', amount: dec('2100') }],
    });
    const result = novSheet(
      [withAllowance],
      [absence('a1', '2026-11-09', '2026-11-11')],
    );
    expect(amounts(result.lines)).toEqual(['18000.00', '1800.00']);
  });

  it('never goes below zero', () => {
    expect(sheetDays(monthSegments(NOV, [base], []), null, 99).workedDays).toBe(
      0,
    );
  });
});

describe('extraHoursLine', () => {
  const priced = terms({ extraHourRate: dec('150') });

  it('returns null without active records', () => {
    expect(extraHoursLine(NOV, [priced], [])).toBeNull();
    expect(
      extraHoursLine(
        NOV,
        [priced],
        [hoursRec('h1', null, '2', { voidedAt: day('2026-11-02') })],
      ),
    ).toBeNull();
  });

  it('sums dated and monthly hours at the rate', () => {
    const line = extraHoursLine(
      NOV,
      [priced],
      [
        hoursRec('h1', '2026-11-05', '1.5'),
        hoursRec('h2', null, '12'),
        hoursRec('h3', null, '3', { voidedAt: day('2026-11-02') }),
      ],
    );
    expect(line?.type).toBe(PayrollLineType.extra_hours);
    expect(line?.amount.toFixed(2)).toBe('2025.00');
    expect(line?.title).toBe('Додаткові години: 13,5 год');
    expect(line?.meta?.noRate).toBeUndefined();
    expect(line?.meta?.extraHours).toEqual([
      {
        id: 'h1',
        date: '2026-11-05',
        hours: '1.50',
        rate: '150.00',
        amount: '225.00',
      },
      {
        id: 'h2',
        date: null,
        hours: '12.00',
        rate: '150.00',
        amount: '1800.00',
      },
    ]);
  });

  it('uses the rate valid on the last day for monthly records', () => {
    const early = terms({
      id: 't1',
      validTo: day('2026-11-15'),
      extraHourRate: dec('150'),
    });
    const later = terms({
      id: 't2',
      validFrom: day('2026-11-16'),
      extraHourRate: dec('200'),
    });
    const line = extraHoursLine(
      NOV,
      [early, later],
      [hoursRec('h1', null, '2'), hoursRec('h2', '2026-11-10', '1')],
    );
    expect(line?.amount.toFixed(2)).toBe('550.00');
  });

  it('prefers the record rate over the terms rate', () => {
    const line = extraHoursLine(
      NOV,
      [priced],
      [
        hoursRec('h1', '2026-11-05', '2', { rate: dec('300') }),
        hoursRec('h2', null, '4'),
      ],
    );
    expect(line?.amount.toFixed(2)).toBe('1200.00');
    expect(line?.meta?.extraHours?.map((i) => i.rate)).toEqual([
      '300.00',
      '150.00',
    ]);
  });

  it('uses the record rate even without terms rate', () => {
    const line = extraHoursLine(
      NOV,
      [terms()],
      [hoursRec('h1', null, '2', { rate: dec('100') })],
    );
    expect(line?.amount.toFixed(2)).toBe('200.00');
    expect(line?.meta?.noRate).toBeUndefined();
  });

  it('contributes 0 and flags noRate when there is no rate', () => {
    const line = extraHoursLine(NOV, [terms()], [hoursRec('h1', null, '2')]);
    expect(line?.amount.toFixed(2)).toBe('0.00');
    expect(line?.meta?.noRate).toBe(true);
    expect(line?.meta?.extraHours?.[0].rate).toBeNull();
  });

  it('flags noRate when no terms cover the month', () => {
    const line = extraHoursLine(NOV, [], [hoursRec('h1', '2026-11-05', '2')]);
    expect(line?.meta?.noRate).toBe(true);
  });
});

describe('lessonsOnAbsenceDays', () => {
  it('returns lesson dates inside active absences', () => {
    const lessons = [
      school('l1', '2026-11-10'),
      school('l2', '2026-11-10'),
      school('l3', '2026-11-12'),
    ];
    expect(
      lessonsOnAbsenceDays(lessons, [
        absence('a1', '2026-11-09', '2026-11-11', { paid: true }),
        absence('a2', '2026-11-12', '2026-11-12', {
          voidedAt: day('2026-11-02'),
        }),
      ]),
    ).toEqual(['2026-11-10']);
  });
});

describe('computeSheet with extra hours and absences', () => {
  it('adds the extra hours line after base lines and counts its noRate', () => {
    const result = computeSheet({
      month: NOV,
      terms: [terms({ monthlyRate: dec('21000') })],
      entries: [],
      workedDays: null,
      lessons: [school('l1', '2026-11-10')],
      past: [],
      booked: [],
      adjustments: [],
      absences: [absence('a1', '2026-11-09', '2026-11-11')],
      extraHours: [hoursRec('h1', null, '2')],
    });
    expect(result.lines.map((l) => l.type)).toEqual([
      PayrollLineType.base,
      PayrollLineType.extra_hours,
      PayrollLineType.lesson,
    ]);
    expect(result.warnings.noRate).toBe(2);
    expect(result.warnings.lessonsOnAbsenceDays).toEqual(['2026-11-10']);
  });
});
