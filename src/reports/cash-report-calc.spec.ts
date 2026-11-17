import { Prisma } from '@prisma/client';
import {
  cashReport,
  type CashReportEntry,
  type CashReportPayment,
  type CashReportShift,
} from './cash-report-calc';

const d = (v: string) => new Prisma.Decimal(v);

const entry = (over: Partial<CashReportEntry> = {}): CashReportEntry => ({
  createdAt: new Date('2026-11-10T08:30:00.000Z'),
  desk: 'Каса 1',
  kind: 'income',
  direction: 'kindergarten',
  amount: d('100'),
  sign: 1,
  paymentCategory: 'tuition',
  expenseCategory: null,
  child: 'Іваненко Марко',
  group: 'Сонечко',
  payer: 'Іваненко Ольга',
  periodFrom: new Date('2026-11-01T00:00:00.000Z'),
  periodTo: new Date('2026-11-30T00:00:00.000Z'),
  employee: 'Петренко Анна',
  recipient: null,
  transferStatus: null,
  comment: null,
  voidedAt: null,
  ...over,
});

const payment = (over: Partial<CashReportPayment> = {}): CashReportPayment => ({
  category: 'tuition',
  direction: 'kindergarten',
  method: 'cash',
  amount: d('100'),
  ...over,
});

const period = {
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-11-30T00:00:00.000Z'),
};

const build = (
  entries: CashReportEntry[],
  payments: CashReportPayment[] = [],
  shifts: CashReportShift[] = [],
) => cashReport({ period, shiftDay: null, entries, payments, shifts });

describe('cashReport', () => {
  it('signs amounts and excludes voided rows from totals', () => {
    const report = build([
      entry({ amount: d('100') }),
      entry({ kind: 'expense', amount: d('30') }),
      entry({ kind: 'transfer', amount: d('20') }),
      entry({ kind: 'correction', amount: d('5'), sign: 1 }),
      entry({ kind: 'correction', amount: d('2'), sign: -1 }),
      entry({ amount: d('999'), voidedAt: new Date('2026-11-10T09:00:00Z') }),
    ]);
    expect(report.title).toBe('Каса');
    expect(report.fileName).toBe('каса');
    expect(report.rows.map((r) => r.amount)).toEqual([
      '100.00',
      '-30.00',
      '-20.00',
      '5.00',
      '-2.00',
      '999.00',
    ]);
    expect(report.rows[5].voided).toBe('Так');
    expect(report.rows[0].voided).toBe('');
    expect(report.totals?.amount).toBe('53.00');
  });

  it('formats date and time in Kyiv and labels kinds', () => {
    const report = build([entry()]);
    expect(report.rows[0]).toMatchObject({
      date: '10.11.2026 10:30',
      desk: 'Каса 1',
      kind: 'Надходження',
      direction: 'Садок',
      category: 'Навчання',
      child: 'Іваненко Марко',
      group: 'Сонечко',
      payer: 'Іваненко Ольга',
      period: '01.11.2026 – 30.11.2026',
      employee: 'Петренко Анна',
    });
  });

  it('splits tuition payments by direction and cash / non-cash', () => {
    const report = build(
      [],
      [
        payment({ amount: d('100') }),
        payment({ direction: 'school', method: 'card', amount: d('40') }),
        payment({
          direction: 'shared',
          method: 'bank_transfer',
          amount: d('7'),
        }),
        payment({ category: null, method: 'online', amount: d('3') }),
        payment({ category: 'meals', amount: d('10') }),
      ],
    );
    const sheet = report.sheets.find((s) => s.name === 'За категоріями оплат');
    expect(sheet?.rows).toEqual([
      {
        category: 'Абонемент садка',
        cash: '100.00',
        nonCash: '0.00',
        total: '100.00',
      },
      {
        category: 'Абонемент школи',
        cash: '0.00',
        nonCash: '40.00',
        total: '40.00',
      },
      { category: 'Навчання', cash: '0.00', nonCash: '7.00', total: '7.00' },
      {
        category: 'Харчування',
        cash: '10.00',
        nonCash: '0.00',
        total: '10.00',
      },
      {
        category: 'Без категорії',
        cash: '0.00',
        nonCash: '3.00',
        total: '3.00',
      },
    ]);
    expect(sheet?.totals).toMatchObject({
      cash: '110.00',
      nonCash: '50.00',
      total: '160.00',
    });
  });

  it('builds expense, transfer, direction and employee sheets without voided rows', () => {
    const report = build([
      entry({
        kind: 'expense',
        amount: d('30'),
        expenseCategory: 'household',
        paymentCategory: null,
        direction: 'shared',
      }),
      entry({
        kind: 'expense',
        amount: d('50'),
        expenseCategory: 'household',
        paymentCategory: null,
        voidedAt: new Date(),
      }),
      entry({
        kind: 'transfer',
        amount: d('20'),
        recipient: 'Директор Іван',
        transferStatus: 'pending',
        paymentCategory: null,
      }),
      entry({ amount: d('100') }),
    ]);
    const by = (name: string) => report.sheets.find((s) => s.name === name);
    expect(by('Видатки')?.rows).toEqual([
      { category: 'Господарські', count: 1, amount: '30.00' },
    ]);
    expect(by('Передачі')?.rows).toEqual([
      {
        recipient: 'Директор Іван',
        status: 'Очікує',
        count: 1,
        amount: '20.00',
      },
    ]);
    expect(by('За напрямами')?.rows).toEqual([
      {
        direction: 'Садок',
        income: '100.00',
        expense: '0.00',
        transfer: '20.00',
      },
      { direction: 'Школа', income: '0.00', expense: '0.00', transfer: '0.00' },
      {
        direction: 'Спільне',
        income: '0.00',
        expense: '30.00',
        transfer: '0.00',
      },
    ]);
    expect(by('За працівниками')?.rows).toEqual([
      {
        employee: 'Петренко Анна',
        count: 3,
        income: '100.00',
        expense: '30.00',
        transfer: '20.00',
      },
    ]);
  });

  it('lists shifts with differences and names the file after a single shift', () => {
    const report = cashReport({
      period,
      shiftDay: new Date('2026-11-10T00:00:00.000Z'),
      entries: [],
      payments: [],
      shifts: [
        {
          desk: 'Каса 1',
          openedAt: new Date('2026-11-10T06:00:00.000Z'),
          openedBy: 'Петренко Анна',
          closedAt: new Date('2026-11-10T17:00:00.000Z'),
          closedBy: 'Петренко Анна',
          openingCounted: d('500'),
          closingExpected: d('900'),
          closingCounted: d('890'),
          closingNote: 'Дрібниця',
        },
        {
          desk: 'Каса 1',
          openedAt: new Date('2026-11-11T06:00:00.000Z'),
          openedBy: 'Петренко Анна',
          closedAt: null,
          closedBy: null,
          openingCounted: d('890'),
          closingExpected: null,
          closingCounted: null,
          closingNote: null,
        },
      ],
    });
    expect(report.fileName).toBe('каса-зміна-10.11.2026');
    const sheet = report.sheets.find((s) => s.name === 'Зміни');
    expect(sheet?.rows[0]).toMatchObject({
      opened: '10.11.2026 08:00',
      closed: '10.11.2026 19:00',
      opening: '500.00',
      expected: '900.00',
      counted: '890.00',
      difference: '-10.00',
      explanation: 'Дрібниця',
    });
    expect(sheet?.rows[1]).toMatchObject({
      closed: '',
      expected: null,
      difference: null,
    });
  });
});
