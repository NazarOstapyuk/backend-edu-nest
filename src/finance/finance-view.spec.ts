import {
  ChargeSource,
  FinanceCategory,
  GroupKind,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import {
  LoadedCharge,
  LoadedPayment,
  buildBalanceRow,
  buildChildFinance,
  buildHistory,
} from './finance-view';

const d = (value: string) => new Prisma.Decimal(value);
const admin = { id: 'u1', firstName: 'Olena', lastName: 'Admin' };
const child = { id: 'child-1', firstName: 'Ivan', lastName: 'Petrenko' };

const allocation = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  paymentId: 'p1',
  chargeId: 'c1',
  amount: d('60.00'),
  createdById: 'u1',
  createdBy: admin,
  createdAt: new Date('2026-10-03T10:00:00Z'),
  voidedAt: null,
  voidedById: null,
  voidedBy: null,
  voidReason: null,
  charge: {
    id: 'c1',
    category: FinanceCategory.tuition,
    description: 'October',
    periodStart: null,
  },
  ...over,
});

const charge = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    childId: 'child-1',
    category: FinanceCategory.tuition,
    amount: d('100.00'),
    description: 'October',
    periodStart: null,
    periodEnd: null,
    sourceType: ChargeSource.manual,
    sourceId: null,
    createdById: 'u1',
    createdBy: admin,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
    allocations: [allocation()],
    ...over,
  }) as unknown as LoadedCharge;

const payment = (over: Record<string, unknown> = {}) =>
  ({
    id: 'p1',
    childId: 'child-1',
    amount: d('80.00'),
    category: FinanceCategory.tuition,
    method: PaymentMethod.cash,
    status: PaymentStatus.confirmed,
    reference: 'R-1',
    receivedAt: new Date('2026-10-02T00:00:00Z'),
    note: null,
    externalId: null,
    createdById: 'u1',
    createdBy: admin,
    createdAt: new Date('2026-10-02T10:00:00Z'),
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
    allocations: [allocation()],
    ...over,
  }) as unknown as LoadedPayment;

describe('buildChildFinance', () => {
  it('returns child, totals, categories and formatted views', () => {
    const result = buildChildFinance(child, [charge()], [payment()]);

    expect(result.child).toEqual(child);
    expect(result.totals).toEqual({ totalDue: '20.00', unallocated: '0.00' });
    expect(result.charges[0]).toMatchObject({
      id: 'c1',
      amount: '100.00',
      paid: '60.00',
      remaining: '40.00',
      state: 'partial',
      createdBy: admin,
    });
    expect(result.charges[0]).not.toHaveProperty('allocations');
    expect(result.payments[0]).toMatchObject({
      id: 'p1',
      amount: '80.00',
      allocated: '60.00',
      free: '20.00',
    });
    expect(result.payments[0].allocations[0]).toMatchObject({
      id: 'a1',
      amount: '60.00',
      charge: { id: 'c1', description: 'October' },
    });
  });
});

describe('buildHistory', () => {
  it('lists created and voided events newest first', () => {
    const voidedAllocation = allocation({
      voidedAt: new Date('2026-10-04T10:00:00Z'),
      voidedBy: admin,
      voidReason: 'wrong month',
    });

    const events = buildHistory(
      [charge()],
      [payment({ allocations: [voidedAllocation] })],
    );

    expect(events.map((e) => e.type)).toEqual([
      'allocation_voided',
      'allocation_created',
      'payment_recorded',
      'charge_created',
    ]);
    expect(events[0]).toMatchObject({
      amount: '60.00',
      description: 'R-1 → October',
      reason: 'wrong month',
      by: admin,
    });
  });
});

describe('buildBalanceRow', () => {
  it('returns overall values without category', () => {
    const row = buildBalanceRow(child, [charge()], [payment()]);

    expect(row).toEqual({
      childId: 'child-1',
      firstName: 'Ivan',
      lastName: 'Petrenko',
      totalDue: '20.00',
      debt: '40.00',
      prepayment: '20.00',
      unallocated: '0.00',
      group: null,
    });
  });

  it('carries the group and its institution', () => {
    const group = {
      id: 'g-1',
      name: '1–3',
      institution: { id: 'i-1', name: 'Сонечко', type: GroupKind.kindergarten },
    };
    const row = buildBalanceRow({ ...child, group }, [], []);

    expect(row.group).toEqual(group);
  });

  it('narrows debt, prepayment and total due to the category', () => {
    const row = buildBalanceRow(
      child,
      [charge()],
      [payment()],
      FinanceCategory.meals,
    );

    expect(row).toMatchObject({
      totalDue: '0.00',
      debt: '0.00',
      prepayment: '0.00',
    });
  });
});
