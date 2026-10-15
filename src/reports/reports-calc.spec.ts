import {
  ChargeSource,
  FinanceCategory,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { childMoney } from '../parent-cabinet/cabinet-calc';
import {
  chargeDay,
  chargesReport,
  debtsReport,
  paymentsReport,
} from './reports-calc';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dec = (v: string) => new Prisma.Decimal(v);
const period = { from: d('2026-10-01'), to: d('2026-10-31') };

describe('paymentsReport', () => {
  const rows = [
    {
      receivedAt: new Date('2026-10-31T20:30:00.000Z'),
      child: 'Б Ірина',
      group: 'Сонечко',
      category: FinanceCategory.meals,
      method: PaymentMethod.cash,
      amount: dec('100.10'),
      reference: 'R1',
      note: null,
    },
    {
      receivedAt: new Date('2026-10-02T08:00:00.000Z'),
      child: 'А Олег',
      group: null,
      category: null,
      method: PaymentMethod.bank_transfer,
      amount: dec('0.20'),
      reference: 'R2',
      note: 'аванс',
    },
  ];

  it('lists rows by date with Kyiv days and exact totals', () => {
    const r = paymentsReport(period, rows);
    expect(r.rows.map((x) => x.date)).toEqual(['2026-10-02', '2026-10-31']);
    expect(r.rows[0]).toMatchObject({
      category: 'Без категорії',
      method: 'Переказ',
      amount: '0.20',
      reference: 'R2 · аванс',
    });
    expect(r.totals).toMatchObject({ child: 'Разом', amount: '100.30' });
  });

  it('splits totals by method and category', () => {
    const r = paymentsReport(period, rows);
    expect(r.sheets.map((s) => s.name)).toEqual([
      'За способами',
      'За категоріями',
    ]);
    expect(r.sheets[0].rows).toEqual([
      { method: 'Готівка', amount: '100.10' },
      { method: 'Переказ', amount: '0.20' },
    ]);
  });
});

describe('chargesReport', () => {
  it('dates a charge by periodStart, else by the Kyiv day of createdAt', () => {
    expect(
      chargeDay({
        periodStart: d('2026-11-01'),
        createdAt: new Date('2026-10-20T10:00:00Z'),
      }),
    ).toEqual(d('2026-11-01'));
    expect(
      chargeDay({
        periodStart: null,
        createdAt: new Date('2026-10-31T22:30:00Z'),
      }),
    ).toEqual(d('2026-11-01'));
  });

  it('keeps only charges dated inside the period', () => {
    const base = {
      child: 'А',
      group: null,
      category: FinanceCategory.tuition,
      sourceType: ChargeSource.monthly,
      description: 'Жовтень',
      amount: dec('1000.00'),
    };
    const r = chargesReport(period, [
      {
        ...base,
        periodStart: d('2026-10-01'),
        createdAt: new Date('2026-09-26T03:00:00Z'),
      },
      {
        ...base,
        periodStart: d('2026-11-01'),
        createdAt: new Date('2026-10-27T03:00:00Z'),
      },
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      date: '2026-10-01',
      source: 'Місячна оплата',
      category: 'Навчання',
    });
  });
});

describe('debtsReport', () => {
  const today = d('2026-10-16');
  const charge = (
    id: string,
    category: FinanceCategory,
    amount: string,
    periodEnd: string | null,
  ) => ({
    id,
    category,
    amount: dec(amount),
    description: id,
    periodStart: null,
    periodEnd: periodEnd ? d(periodEnd) : null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    voidedAt: null,
    allocations: [],
  });
  const payment = (category: FinanceCategory | null, amount: string) => ({
    amount: dec(amount),
    category,
    status: PaymentStatus.confirmed,
    voidedAt: null,
    allocations: [],
  });

  it('matches childMoney and does not let a meals prepayment cover tuition', () => {
    const child = {
      child: 'А Олег',
      group: 'Сонечко',
      parents: 'А Марія +380501112233',
      charges: [charge('t1', FinanceCategory.tuition, '1000.00', '2026-09-30')],
      payments: [payment(FinanceCategory.meals, '300.00')],
    };
    const r = debtsReport([child], today);
    const expected = childMoney(child.charges, child.payments, today);
    expect(r.rows[0]).toMatchObject({
      due: expected.due,
      overdue: expected.overdue,
      debt_tuition: '1000.00',
      debt_meals: '0.00',
    });
    expect(r.rows[0].due).toBe('1000.00');
    expect(r.rows[0].oldest).toBe('2026-09-01');
  });

  it('skips children without debt and totals the rest', () => {
    const r = debtsReport(
      [
        { child: 'Б', group: null, parents: '', charges: [], payments: [] },
        {
          child: 'В',
          group: null,
          parents: '',
          charges: [charge('m1', FinanceCategory.meals, '45.50', null)],
          payments: [],
        },
      ],
      today,
    );
    expect(r.rows.map((x) => x.child)).toEqual(['В']);
    expect(r.totals).toMatchObject({ child: 'Разом', due: '45.50' });
    expect(r.period).toBeNull();
  });
});
