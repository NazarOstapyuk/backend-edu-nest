import { FinanceCategory, PaymentStatus, Prisma } from '@prisma/client';
import { chargeLastDay, childMoney, isOverdue } from './cabinet-calc';

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const d = (v: string) => new Prisma.Decimal(v);
const TODAY = day('2026-10-12');

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'c',
  description: 'd',
  category: FinanceCategory.tuition,
  amount: d('1000'),
  periodStart: day('2026-09-01'),
  periodEnd: day('2026-09-30'),
  createdAt: new Date('2026-08-27T10:00:00Z'),
  voidedAt: null,
  allocations: [] as { amount: Prisma.Decimal; voidedAt: Date | null }[],
  ...over,
});

describe('chargeLastDay', () => {
  it('uses periodEnd, then periodStart, then the Kyiv day of createdAt', () => {
    expect(chargeLastDay(charge())).toEqual(day('2026-09-30'));
    expect(chargeLastDay(charge({ periodEnd: null }))).toEqual(
      day('2026-09-01'),
    );
    expect(
      chargeLastDay(
        charge({
          periodEnd: null,
          periodStart: null,
          createdAt: new Date('2026-10-11T22:30:00Z'),
        }),
      ),
    ).toEqual(day('2026-10-12'));
  });
});

describe('isOverdue', () => {
  it('is overdue only after the last day with money left', () => {
    expect(isOverdue(charge(), TODAY)).toBe(true);
    expect(isOverdue(charge({ periodEnd: TODAY }), TODAY)).toBe(false);
    expect(
      isOverdue(
        charge({ allocations: [{ amount: d('1000'), voidedAt: null }] }),
        TODAY,
      ),
    ).toBe(false);
    expect(
      isOverdue(
        charge({
          periodEnd: null,
          periodStart: null,
          createdAt: new Date('2026-10-11T20:00:00Z'),
        }),
        TODAY,
      ),
    ).toBe(true);
  });
});

describe('childMoney', () => {
  it('sums due, overdue and prepayment per category and overall', () => {
    const charges = [
      charge({ allocations: [{ amount: d('400'), voidedAt: null }] }),
      charge({ periodStart: day('2026-10-01'), periodEnd: day('2026-10-31') }),
      charge({
        category: FinanceCategory.extra_classes,
        amount: d('300'),
        voidedAt: new Date(),
      }),
    ];
    const payments = [
      {
        amount: d('500'),
        category: FinanceCategory.extra_classes,
        status: PaymentStatus.confirmed,
        voidedAt: null,
        allocations: [],
      },
      {
        amount: d('200'),
        category: null,
        status: PaymentStatus.confirmed,
        voidedAt: null,
        allocations: [],
      },
      {
        amount: d('900'),
        category: null,
        status: PaymentStatus.pending,
        voidedAt: null,
        allocations: [],
      },
    ];

    const money = childMoney(charges, payments, TODAY);

    expect(money).toMatchObject({
      due: '1600.00',
      overdue: '600.00',
      prepayment: '700.00',
      unallocated: '200.00',
    });
    expect(
      money.categories.find((c) => c.category === FinanceCategory.tuition),
    ).toEqual({
      category: FinanceCategory.tuition,
      due: '1600.00',
      overdue: '600.00',
      prepayment: '0.00',
    });
    expect(
      money.categories.find(
        (c) => c.category === FinanceCategory.extra_classes,
      ),
    ).toEqual({
      category: FinanceCategory.extra_classes,
      due: '0.00',
      overdue: '0.00',
      prepayment: '500.00',
    });
  });
});
