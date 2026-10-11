import { FinanceCategory, PaymentStatus, Prisma } from '@prisma/client';
import {
  ChargeLike,
  PaymentLike,
  chargeState,
  formatMoney,
  money,
  suggestAllocation,
  summarize,
} from './finance-calc';

const d = (value: string) => new Prisma.Decimal(value);
const alloc = (amount: string, voided = false) => ({
  amount: d(amount),
  voidedAt: voided ? new Date() : null,
});
const charge = (over: Partial<ChargeLike> = {}): ChargeLike => ({
  id: 'c1',
  category: FinanceCategory.tuition,
  amount: d('100.00'),
  description: 'October',
  periodStart: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  voidedAt: null,
  allocations: [],
  ...over,
});
const payment = (over: Partial<PaymentLike> = {}): PaymentLike => ({
  amount: d('100.00'),
  category: null,
  status: PaymentStatus.confirmed,
  voidedAt: null,
  allocations: [],
  ...over,
});

describe('formatMoney', () => {
  it('formats with two decimals', () => {
    expect(formatMoney('15500')).toBe('15500.00');
  });

  it('never returns negative zero', () => {
    expect(formatMoney(d('0').negated())).toBe('0.00');
  });
});

describe('chargeState', () => {
  it('returns unpaid, partial and paid', () => {
    expect(chargeState(d('100'), d('0'))).toBe('unpaid');
    expect(chargeState(d('100'), d('40'))).toBe('partial');
    expect(chargeState(d('100'), d('100'))).toBe('paid');
  });
});

describe('summarize', () => {
  it('computes per-category values, unallocated and total due', () => {
    const charges = [
      charge({
        id: 't1',
        amount: d('15500.00'),
        allocations: [alloc('10000.00')],
      }),
      charge({
        id: 'm1',
        category: FinanceCategory.meals,
        amount: d('2000.00'),
      }),
    ];
    const payments = [
      payment({
        amount: d('12000.00'),
        category: FinanceCategory.tuition,
        allocations: [alloc('10000.00')],
      }),
      payment({ amount: d('500.00') }),
    ];

    const result = summarize(charges, payments);

    expect(
      result.categories.find((c) => c.category === FinanceCategory.tuition),
    ).toEqual({
      category: FinanceCategory.tuition,
      charged: '15500.00',
      paid: '10000.00',
      debt: '5500.00',
      prepayment: '2000.00',
    });
    expect(
      result.categories.find((c) => c.category === FinanceCategory.meals),
    ).toEqual({
      category: FinanceCategory.meals,
      charged: '2000.00',
      paid: '0.00',
      debt: '2000.00',
      prepayment: '0.00',
    });
    expect(result.totals).toEqual({
      totalDue: '5000.00',
      unallocated: '500.00',
    });
  });

  it('returns all four categories in enum order', () => {
    expect(summarize([], []).categories.map((c) => c.category)).toEqual([
      FinanceCategory.tuition,
      FinanceCategory.adaptation,
      FinanceCategory.extra_classes,
      FinanceCategory.meals,
    ]);
  });

  it('excludes voided records and non-confirmed payments', () => {
    const charges = [
      charge({ amount: d('100.00'), allocations: [alloc('100.00', true)] }),
      charge({ id: 'c2', amount: d('50.00'), voidedAt: new Date() }),
    ];
    const payments = [
      payment({
        amount: d('100.00'),
        category: FinanceCategory.tuition,
        allocations: [alloc('100.00', true)],
      }),
      payment({ amount: d('70.00'), voidedAt: new Date() }),
      payment({ amount: d('30.00'), status: PaymentStatus.pending }),
    ];

    const result = summarize(charges, payments);

    expect(result.categories[0]).toEqual({
      category: FinanceCategory.tuition,
      charged: '100.00',
      paid: '0.00',
      debt: '100.00',
      prepayment: '100.00',
    });
    expect(result.totals).toEqual({ totalDue: '0.00', unallocated: '0.00' });
  });

  it('adds decimals without floating point drift', () => {
    const charges = [
      charge({ amount: d('0.10') }),
      charge({ id: 'c2', amount: d('0.20') }),
    ];

    expect(summarize(charges, []).categories[0].debt).toBe('0.30');
  });
});

describe('suggestAllocation', () => {
  it('fills the oldest period first and reports leftover', () => {
    const charges = [
      charge({ id: 'nov', periodStart: new Date('2026-11-01') }),
      charge({
        id: 'oct',
        periodStart: new Date('2026-10-01'),
        allocations: [alloc('40.00')],
      }),
    ];

    const result = suggestAllocation(charges, money('200.00'));

    expect(
      result.lines.map((l) => [l.chargeId, l.remaining, l.suggestedAmount]),
    ).toEqual([
      ['oct', '60.00', '60.00'],
      ['nov', '100.00', '100.00'],
    ]);
    expect(result.leftover).toBe('40.00');
  });

  it('uses createdAt when periodStart is missing', () => {
    const charges = [
      charge({ id: 'late', createdAt: new Date('2026-10-05') }),
      charge({ id: 'early', createdAt: new Date('2026-09-05') }),
    ];

    const result = suggestAllocation(charges, money('100.00'));

    expect(result.lines.map((l) => l.chargeId)).toEqual(['early', 'late']);
    expect(result.lines.map((l) => l.suggestedAmount)).toEqual([
      '100.00',
      '0.00',
    ]);
  });

  it('skips paid and voided charges and stops when amount is used', () => {
    const charges = [
      charge({ id: 'paid', allocations: [alloc('100.00')] }),
      charge({ id: 'void', voidedAt: new Date() }),
      charge({ id: 'a', createdAt: new Date('2026-09-01') }),
      charge({ id: 'b', createdAt: new Date('2026-10-01') }),
    ];

    const result = suggestAllocation(charges, money('30.00'));

    expect(result.lines.map((l) => [l.chargeId, l.suggestedAmount])).toEqual([
      ['a', '30.00'],
      ['b', '0.00'],
    ]);
    expect(result.leftover).toBe('0.00');
  });
});
