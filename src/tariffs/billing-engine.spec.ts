import { AdjustmentType, BillingMode, Prisma } from '@prisma/client';
import {
  AdjustmentLike,
  EnrollmentInput,
  PeriodResult,
  computePeriod,
  dueBills,
  findPeriod,
  nextPeriod,
  periodsUntil,
  priceOn,
} from './billing-engine';
import { isoDay } from './dates';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const input = (over: Partial<EnrollmentInput> = {}): EnrollmentInput => ({
  tariffName: 'Садочок',
  startDate: day('2026-10-15'),
  endDate: null,
  mode: BillingMode.anniversary,
  prices: [{ price: d('15500'), effectiveFrom: day('2026-01-01') }],
  adjustments: [],
  ...over,
});

const adj = (
  type: AdjustmentType,
  value: string | null,
  start: string,
  end: string | null,
  voided = false,
): AdjustmentLike => ({
  type,
  value: value === null ? null : d(value),
  startDate: day(start),
  endDate: end === null ? null : day(end),
  voidedAt: voided ? new Date() : null,
});

const ranges = (i: EnrollmentInput, until: string) =>
  periodsUntil(i, day(until)).map((r) => [
    isoDay(r.periodStart),
    isoDay(r.periodEnd),
    r.fullDays,
  ]);

const bill = (result: PeriodResult) => {
  if (!result.ok) throw new Error('expected a bill');
  return result.bill;
};

const amountFor = (i: EnrollmentInput, periodStart: string) => {
  const range = findPeriod(i, day(periodStart));
  if (!range) throw new Error('no period');
  return bill(computePeriod(i, range)).amount.toFixed(2);
};

describe('periodsUntil', () => {
  it('builds anniversary periods from the start date', () => {
    expect(ranges(input(), '2027-01-20')).toEqual([
      ['2026-10-15', '2026-11-14', 31],
      ['2026-11-15', '2026-12-14', 30],
      ['2026-12-15', '2027-01-14', 31],
      ['2027-01-15', '2027-02-14', 31],
    ]);
  });

  it('clamps anniversary days to short months', () => {
    expect(
      ranges(input({ startDate: day('2026-01-31') }), '2026-03-31'),
    ).toEqual([
      ['2026-01-31', '2026-02-27', 28],
      ['2026-02-28', '2026-03-30', 31],
      ['2026-03-31', '2026-04-29', 30],
    ]);
    expect(
      isoDay(
        periodsUntil(
          input({ startDate: day('2028-01-31') }),
          day('2028-02-29'),
        )[1].periodStart,
      ),
    ).toBe('2028-02-29');
  });

  it('builds calendar periods with a partial first month', () => {
    expect(
      ranges(input({ mode: BillingMode.calendar_prorated }), '2026-12-01'),
    ).toEqual([
      ['2026-10-15', '2026-10-31', 31],
      ['2026-11-01', '2026-11-30', 30],
      ['2026-12-01', '2026-12-31', 31],
    ]);
  });

  it('truncates the last period at the end date and stops after it', () => {
    expect(ranges(input({ endDate: day('2026-11-30') }), '2027-06-01')).toEqual(
      [
        ['2026-10-15', '2026-11-14', 31],
        ['2026-11-15', '2026-11-30', 30],
      ],
    );
  });
});

describe('priceOn', () => {
  it('takes the latest price effective on the day', () => {
    const prices = [
      { price: d('15500'), effectiveFrom: day('2026-01-01') },
      { price: d('16500'), effectiveFrom: day('2027-01-01') },
    ];
    expect(priceOn(prices, day('2026-12-31'))?.toFixed(2)).toBe('15500.00');
    expect(priceOn(prices, day('2027-01-01'))?.toFixed(2)).toBe('16500.00');
    expect(priceOn(prices, day('2025-12-31'))).toBeNull();
  });
});

describe('computePeriod', () => {
  it('charges a full anniversary period at the tariff price', () => {
    expect(amountFor(input(), '2026-10-15')).toBe('15500.00');
  });

  it('prorates the first calendar month in calendar_prorated mode', () => {
    expect(
      amountFor(input({ mode: BillingMode.calendar_prorated }), '2026-10-15'),
    ).toBe('8500.00');
  });

  it('charges the full first month in calendar_full mode', () => {
    expect(
      amountFor(input({ mode: BillingMode.calendar_full }), '2026-10-15'),
    ).toBe('15500.00');
  });

  it('prices each period by the price on its start date', () => {
    const i = input({
      startDate: day('2026-12-15'),
      prices: [
        { price: d('15500'), effectiveFrom: day('2026-01-01') },
        { price: d('16500'), effectiveFrom: day('2027-01-01') },
      ],
    });
    expect(amountFor(i, '2026-12-15')).toBe('15500.00');
    expect(amountFor(i, '2027-01-15')).toBe('16500.00');
  });

  it('uses a custom price while it is active', () => {
    const i = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-10-01'),
      adjustments: [
        adj(AdjustmentType.custom_price, '14000', '2026-11-01', '2026-12-31'),
      ],
    });
    expect(amountFor(i, '2026-10-01')).toBe('15500.00');
    expect(amountFor(i, '2026-11-01')).toBe('14000.00');
    expect(amountFor(i, '2026-12-01')).toBe('14000.00');
    expect(amountFor(i, '2027-01-01')).toBe('15500.00');
  });

  it('applies percent then amount discounts and floors at zero', () => {
    const both = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-11-01'),
      adjustments: [
        adj(AdjustmentType.discount_percent, '10', '2026-11-01', null),
        adj(AdjustmentType.discount_amount, '500', '2026-11-01', null),
      ],
    });
    expect(amountFor(both, '2026-11-01')).toBe('13450.00');

    const huge = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-11-01'),
      adjustments: [
        adj(AdjustmentType.discount_amount, '20000', '2026-11-01', null),
      ],
    });
    const range = findPeriod(huge, day('2026-11-01'));
    const result = bill(computePeriod(huge, range!));
    expect(result.amount.toFixed(2)).toBe('0.00');
    expect(result.zero).toBe(true);
    expect(result.note).toBe('zero amount');
  });

  it('ignores voided adjustments', () => {
    const i = input({
      adjustments: [
        adj(AdjustmentType.discount_percent, '50', '2026-01-01', null, true),
      ],
    });
    expect(amountFor(i, '2026-10-15')).toBe('15500.00');
  });

  it('applies discounts by their state on the period start', () => {
    const i = input({
      adjustments: [
        adj(AdjustmentType.discount_percent, '10', '2026-10-20', null),
      ],
    });
    expect(amountFor(i, '2026-10-15')).toBe('15500.00');
    expect(amountFor(i, '2026-11-15')).toBe('13950.00');
  });

  it('makes a fully paused period zero', () => {
    const i = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-11-01'),
      adjustments: [
        adj(AdjustmentType.pause, null, '2026-11-01', '2026-11-30'),
      ],
    });
    const result = bill(computePeriod(i, findPeriod(i, day('2026-11-01'))!));
    expect(result.amount.toFixed(2)).toBe('0.00');
    expect(result.note).toBe('pause');
  });

  it('prorates partial pauses, including pauses spanning two periods', () => {
    const partial = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-11-01'),
      adjustments: [
        adj(AdjustmentType.pause, null, '2026-11-01', '2026-11-15'),
      ],
    });
    expect(amountFor(partial, '2026-11-01')).toBe('7750.00');

    const spanning = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-11-01'),
      adjustments: [
        adj(AdjustmentType.pause, null, '2026-11-21', '2026-12-10'),
      ],
    });
    expect(amountFor(spanning, '2026-11-01')).toBe('10333.33');
    expect(amountFor(spanning, '2026-12-01')).toBe('10500.00');
  });

  it('counts pause days only within the billed period in calendar_full mode', () => {
    const i = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-10-15'),
      adjustments: [
        adj(AdjustmentType.pause, null, '2026-10-01', '2026-10-20'),
      ],
    });
    expect(amountFor(i, '2026-10-15')).toBe('12500.00');
  });

  it('counts pause days only within the billed period in anniversary mode', () => {
    const i = input({
      adjustments: [
        adj(AdjustmentType.pause, null, '2026-10-01', '2026-10-20'),
      ],
    });
    expect(amountFor(i, '2026-10-15')).toBe('12500.00');
  });

  it('prorates the last period up to the end date', () => {
    const anniversary = input({ endDate: day('2026-11-30') });
    expect(amountFor(anniversary, '2026-11-15')).toBe('8266.67');

    const calendarFull = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-10-05'),
      endDate: day('2026-10-20'),
    });
    expect(amountFor(calendarFull, '2026-10-05')).toBe('10000.00');
  });

  it('reports a missing price', () => {
    const i = input({
      mode: BillingMode.calendar_full,
      startDate: day('2026-12-01'),
      prices: [{ price: d('15500'), effectiveFrom: day('2027-01-01') }],
    });
    const result = computePeriod(i, findPeriod(i, day('2026-12-01'))!);
    expect(result).toMatchObject({ ok: false, reason: 'no_price' });
  });

  it('describes the calculation', () => {
    const i = input({
      mode: BillingMode.calendar_prorated,
      adjustments: [
        adj(AdjustmentType.discount_percent, '10', '2026-10-01', null),
      ],
    });
    const result = bill(computePeriod(i, findPeriod(i, day('2026-10-15'))!));
    expect(result.description).toBe(
      'Садочок, 15.10.2026–31.10.2026: 15500.00 − 10%, 17/31 дн.',
    );
    expect(result.amount.toFixed(2)).toBe('7650.00');
  });
});

describe('dueBills', () => {
  it('returns unbilled periods starting within the lead window', () => {
    const due = dueBills(input(), [], day('2026-11-10'), 5);
    expect(
      due.map((r) => (r.ok ? isoDay(r.bill.periodStart) : 'problem')),
    ).toEqual(['2026-10-15', '2026-11-15']);

    const afterFirst = dueBills(
      input(),
      [day('2026-10-15')],
      day('2026-11-10'),
      5,
    );
    expect(
      afterFirst.map((r) => (r.ok ? isoDay(r.bill.periodStart) : 'problem')),
    ).toEqual(['2026-11-15']);

    expect(
      dueBills(input(), [day('2026-10-15')], day('2026-11-10'), 4),
    ).toEqual([]);
  });

  it('catches up several overdue periods at once', () => {
    expect(dueBills(input(), [], day('2027-01-20'), 0)).toHaveLength(4);
  });
});

describe('nextPeriod', () => {
  it('returns the first unbilled period', () => {
    const next = nextPeriod(input(), [day('2026-10-15')], day('2026-10-20'));
    expect(next && next.ok && isoDay(next.bill.periodStart)).toBe('2026-11-15');
  });

  it('returns null when everything until the end date is billed', () => {
    const i = input({ endDate: day('2026-11-14') });
    expect(nextPeriod(i, [day('2026-10-15')], day('2026-10-20'))).toBeNull();
  });
});
