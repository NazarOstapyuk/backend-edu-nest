import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  countTotal,
  directionForInstitution,
  expectedBalance,
  isUnclosed,
  needsExplanation,
  shiftTotals,
  type TotalsEntry,
} from './cash-calc';

const d = (value: string) => new Prisma.Decimal(value);

const entry = (
  kind: TotalsEntry['kind'],
  amount: string,
  direction: TotalsEntry['direction'],
  extra: Partial<TotalsEntry> = {},
): TotalsEntry => ({
  kind,
  amount: d(amount),
  sign: 1,
  direction,
  voidedAt: null,
  ...extra,
});

describe('countTotal', () => {
  it('sums denominations', () => {
    expect(countTotal({ '100000': 2, '50': 3 }).toFixed(2)).toBe('2001.50');
  });

  it.each<Record<string, number>>([
    { '300': 1 },
    { '100': -1 },
    { '100': 1.5 },
    { '100': 100001 },
  ])('rejects %j', (input) => {
    expect(() => countTotal(input)).toThrow(BadRequestException);
  });
});

describe('shiftTotals', () => {
  const totals = shiftTotals([
    entry('income', '1000', 'kindergarten'),
    entry('income', '500', 'kindergarten', { voidedAt: new Date() }),
    entry('expense', '200', 'shared'),
    entry('transfer', '300', 'school'),
    entry('correction', '50', 'shared', { sign: -1 }),
  ]);

  it('totals by kind ignoring voided', () => {
    expect(totals.income).toBe('1000.00');
    expect(totals.expense).toBe('200.00');
    expect(totals.transfer).toBe('300.00');
    expect(totals.correction).toBe('-50.00');
    expect(totals.byDirection.school.transfer).toBe('300.00');
    expect(totals.byDirection.kindergarten.income).toBe('1000.00');
  });

  it('computes expected balance', () => {
    expect(expectedBalance(d('100.00'), totals).toFixed(2)).toBe('550.00');
  });
});

describe('needsExplanation', () => {
  it('detects a difference', () => {
    expect(needsExplanation(d('10.00'), d('10.00'))).toBe(false);
    expect(needsExplanation(d('10.00'), d('9.90'))).toBe(true);
  });
});

describe('isUnclosed', () => {
  it('is true when opened on an earlier Kyiv day', () => {
    expect(
      isUnclosed(
        new Date('2026-11-16T08:00:00Z'),
        '18:00',
        new Date('2026-11-17T06:00:00Z'),
      ),
    ).toBe(true);
  });

  it('compares Kyiv time with closeBy on the same day', () => {
    const openedAt = new Date('2026-11-17T06:00:00Z');
    expect(
      isUnclosed(openedAt, '18:00', new Date('2026-11-17T15:59:00Z')),
    ).toBe(false);
    expect(
      isUnclosed(openedAt, '18:00', new Date('2026-11-17T16:00:00Z')),
    ).toBe(true);
  });
});

describe('directionForInstitution', () => {
  it('maps institution types', () => {
    expect(directionForInstitution('kindergarten')).toBe('kindergarten');
    expect(directionForInstitution('school_class')).toBe('school');
    expect(directionForInstitution(null)).toBe('shared');
  });
});
