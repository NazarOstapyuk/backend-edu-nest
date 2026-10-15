import {
  CalendarDayType,
  CalendarScope,
  ChargeSource,
  DailyStatus,
  FinanceCategory,
  GroupKind,
  NoticeStatus,
  PaymentMethod,
  PaymentStatus,
  PayrollStatus,
  Prisma,
} from '@prisma/client';
import { childMoney } from '../parent-cabinet/cabinet-calc';
import {
  attendanceReport,
  chargeDay,
  chargesReport,
  debtsReport,
  lessonsReport,
  mealsReport,
  monthsTouched,
  paymentsReport,
  payrollReport,
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

describe('attendanceReport', () => {
  const week = { from: d('2026-10-05'), to: d('2026-10-11') };
  const group = { id: 'g1', kind: GroupKind.kindergarten, name: 'Сонечко' };
  const mark = (
    iso: string,
    status: DailyStatus,
    reasonId: string | null = null,
  ) => ({ date: d(iso), status, reasonId, voidedAt: null });
  const notice = (iso: string, reasonId: string) => ({
    startDate: d(iso),
    endDate: d(iso),
    reasonId,
    status: NoticeStatus.approved,
  });
  const excused = new Set(['sick']);
  const child = (
    extra: Partial<Parameters<typeof attendanceReport>[1][0]> = {},
  ) => ({
    child: 'А Олег',
    group,
    marks: [
      mark('2026-10-05', DailyStatus.present),
      mark('2026-10-06', DailyStatus.late),
      mark('2026-10-07', DailyStatus.absent, 'sick'),
    ],
    notices: [notice('2026-10-08', 'trip')],
    ...extra,
  });

  it('counts working days and builds the timesheet codes', () => {
    const r = attendanceReport(week, [child()], [], excused);
    expect(r.title).toBe('Відвідування');
    expect(r.fileName).toBe('відвідування');
    expect(r.rows[0]).toMatchObject({
      working: 5,
      present: 2,
      excused: 1,
      unexcused: 1,
      unmarked: 1,
      percent: 0.4,
    });
    expect(r.totals).toMatchObject({
      child: 'Разом',
      working: 5,
      present: 2,
      percent: 0.4,
    });
    const sheet = r.sheets[0];
    expect(sheet.name).toBe('Табель');
    expect(sheet.columns.slice(2).map((c) => c.label)).toEqual([
      '05.10',
      '06.10',
      '07.10',
      '08.10',
      '09.10',
      '10.10',
      '11.10',
    ]);
    expect(sheet.columns[2].key).toBe('d_2026-10-05');
    const codes = sheet.columns.slice(2).map((c) => sheet.rows[0][c.key]);
    expect(codes).toEqual(['П', 'З', 'В', 'Н', '·', '', '']);
  });

  it('maps left_early and unexcused absence marks', () => {
    const r = attendanceReport(
      week,
      [
        child({
          marks: [
            mark('2026-10-05', DailyStatus.left_early),
            mark('2026-10-06', DailyStatus.absent),
          ],
          notices: [],
        }),
      ],
      [],
      excused,
    );
    const sheet = r.sheets[0];
    expect(sheet.rows[0]['d_2026-10-05']).toBe('Р');
    expect(sheet.rows[0]['d_2026-10-06']).toBe('Н');
    expect(r.rows[0]).toMatchObject({ present: 1, unexcused: 1, unmarked: 3 });
  });

  it('removes a non-working calendar day from the counts', () => {
    const entries = [
      {
        startDate: d('2026-10-07'),
        endDate: d('2026-10-07'),
        type: CalendarDayType.non_working,
        scope: CalendarScope.kindergarten,
        groupId: null,
        title: 'Вихідний',
        voidedAt: null,
      },
    ];
    const r = attendanceReport(week, [child()], entries, excused);
    expect(r.rows[0]).toMatchObject({ working: 4, excused: 0 });
    expect(r.sheets[0].rows[0]['d_2026-10-07']).toBe('В');
    const bare = attendanceReport(
      week,
      [child({ marks: [], notices: [] })],
      entries,
      excused,
    );
    expect(bare.sheets[0].rows[0]['d_2026-10-07']).toBe('');
  });

  it('shows a weekend mark but does not count it', () => {
    const r = attendanceReport(
      week,
      [
        child({
          marks: [
            mark('2026-10-05', DailyStatus.present),
            mark('2026-10-10', DailyStatus.present),
          ],
          notices: [],
        }),
      ],
      [],
      excused,
    );
    expect(r.sheets[0].rows[0]['d_2026-10-10']).toBe('П');
    expect(r.rows[0]).toMatchObject({ working: 5, present: 1, percent: 0.2 });
  });

  it('gives a null percent without working days', () => {
    const r = attendanceReport(
      { from: d('2026-10-10'), to: d('2026-10-11') },
      [child({ marks: [], notices: [] })],
      [],
      excused,
    );
    expect(r.rows[0]).toMatchObject({ working: 0, percent: null });
    expect(r.totals).toMatchObject({ working: 0, percent: null });
  });

  it('rounds the percent to four places and sorts by group then child', () => {
    const r = attendanceReport(
      week,
      [
        child({ child: 'Б', group: { ...group, name: 'Я' } }),
        child({
          child: 'В',
          marks: [mark('2026-10-05', DailyStatus.present)],
          notices: [],
        }),
        child({ child: 'А' }),
      ],
      [],
      excused,
    );
    expect(r.rows.map((x) => x.child)).toEqual(['А', 'В', 'Б']);
    const third = attendanceReport(
      { from: d('2026-10-05'), to: d('2026-10-07') },
      [
        child({
          marks: [mark('2026-10-05', DailyStatus.present)],
          notices: [],
        }),
      ],
      [],
      excused,
    );
    expect(third.rows[0].percent).toBe(0.3333);
  });
});

describe('mealsReport', () => {
  const order = (
    iso: string,
    group: string | null,
    complex: string,
    price: string,
  ) => ({ date: d(iso), group, complex, price: dec(price) });

  it('aggregates by day, group and complex with exact sums', () => {
    const r = mealsReport(period, [
      order('2026-10-02', 'Сонечко', 'Повний', '45.50'),
      order('2026-10-02', 'Сонечко', 'Повний', '45.55'),
      order('2026-10-01', null, 'Легкий', '30.00'),
    ]);
    expect(r.title).toBe('Харчування');
    expect(r.fileName).toBe('харчування');
    expect(r.rows).toEqual([
      {
        date: '2026-10-01',
        group: '',
        complex: 'Легкий',
        count: 1,
        amount: '30.00',
      },
      {
        date: '2026-10-02',
        group: 'Сонечко',
        complex: 'Повний',
        count: 2,
        amount: '91.05',
      },
    ]);
    expect(r.totals).toMatchObject({ count: 3, amount: '121.05' });
  });

  it('adds sheets by day and by complex with totals', () => {
    const r = mealsReport(period, [
      order('2026-10-02', 'Сонечко', 'Повний', '45.50'),
      order('2026-10-03', 'Сонечко', 'Повний', '45.55'),
      order('2026-10-03', 'Зайчики', 'Легкий', '30.00'),
    ]);
    expect(r.sheets.map((s) => s.name)).toEqual(['За днями', 'За комплексами']);
    expect(r.sheets[0].rows).toEqual([
      { date: '2026-10-02', count: 1, amount: '45.50' },
      { date: '2026-10-03', count: 2, amount: '75.55' },
    ]);
    expect(r.sheets[1].rows).toEqual([
      { complex: 'Легкий', count: 1, amount: '30.00' },
      { complex: 'Повний', count: 2, amount: '91.05' },
    ]);
    expect(r.sheets[1].totals).toMatchObject({
      complex: 'Разом',
      count: 3,
      amount: '121.05',
    });
  });
});

describe('lessonsReport', () => {
  const school = (date: string, period: number, teacher: string) => ({
    date: d(date),
    period,
    teacher,
    subject: 'Математика',
    group: '1-А',
    topic: period === 1 ? 'Числа' : null,
  });
  const classLesson = (date: string, teacher: string) => ({
    date: d(date),
    teacher,
    direction: 'Англійська',
    classGroup: 'Група 1',
  });

  it('aggregates class lessons by teacher', () => {
    const r = lessonsReport(
      period,
      [],
      [
        classLesson('2026-10-01', 'Іваненко Анна'),
        classLesson('2026-10-02', 'Іваненко Анна'),
        classLesson('2026-10-02', 'Бондар Олег'),
      ],
    );
    expect(r.rows).toEqual([
      {
        teacher: 'Бондар Олег',
        type: 'Заняття',
        subject: 'Англійська',
        group: 'Група 1',
        count: 1,
      },
      {
        teacher: 'Іваненко Анна',
        type: 'Заняття',
        subject: 'Англійська',
        group: 'Група 1',
        count: 2,
      },
    ]);
    expect(r.totals).toMatchObject({ count: 3 });
    expect(r.title).toBe('Уроки');
    expect(r.fileName).toBe('уроки');
  });

  it('labels school lessons and class lessons differently', () => {
    const r = lessonsReport(
      period,
      [school('2026-10-01', 1, 'Іваненко Анна')],
      [classLesson('2026-10-01', 'Іваненко Анна')],
    );
    expect(r.rows.map((row) => row.type)).toEqual(['Заняття', 'Урок']);
  });

  it('lists lessons sorted by date and period', () => {
    const r = lessonsReport(
      period,
      [
        school('2026-10-02', 1, 'Іваненко Анна'),
        school('2026-10-01', 2, 'Іваненко Анна'),
        school('2026-10-01', 1, 'Іваненко Анна'),
      ],
      [classLesson('2026-10-01', 'Бондар Олег')],
    );
    const sheet = r.sheets[0];
    expect(sheet.name).toBe('Список');
    expect(sheet.rows.map((row) => [row.date, row.period, row.type])).toEqual([
      ['2026-10-01', 1, 'Урок'],
      ['2026-10-01', 2, 'Урок'],
      ['2026-10-01', null, 'Заняття'],
      ['2026-10-02', 1, 'Урок'],
    ]);
    expect(sheet.rows[0]).toMatchObject({
      subject: 'Математика',
      group: '1-А',
      teacher: 'Іваненко Анна',
      topic: 'Числа',
    });
  });
});

describe('monthsTouched', () => {
  it('lists every month from start to end', () => {
    expect(monthsTouched(d('2026-09-15'), d('2026-11-02'))).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(monthsTouched(d('2026-10-01'), d('2026-10-31'))).toEqual([
      '2026-10',
    ]);
  });
});

describe('payrollReport', () => {
  const row = (
    teacherId: string,
    teacher: string,
    month: string,
    accrued: string,
    balance: string,
    status: PayrollStatus = PayrollStatus.draft,
  ) => ({ teacherId, teacher, month, status, accrued, balance });

  it('uses paid by key and defaults to zero', () => {
    const r = payrollReport(
      period,
      [
        row('t2', 'Бондар Олег', '2026-10', '100.10', '100.10'),
        row('t1', 'Іваненко Анна', '2026-10', '200.20', '150.20'),
        row(
          't1',
          'Іваненко Анна',
          '2026-09',
          '50.00',
          '0.00',
          PayrollStatus.approved,
        ),
      ],
      new Map([['t1:2026-10', dec('50.00')]]),
    );
    expect(r.rows).toEqual([
      {
        teacher: 'Іваненко Анна',
        month: '09.2026',
        status: 'затверджена',
        accrued: '50.00',
        paid: '0.00',
        balance: '0.00',
      },
      {
        teacher: 'Бондар Олег',
        month: '10.2026',
        status: 'чернетка',
        accrued: '100.10',
        paid: '0.00',
        balance: '100.10',
      },
      {
        teacher: 'Іваненко Анна',
        month: '10.2026',
        status: 'чернетка',
        accrued: '200.20',
        paid: '50.00',
        balance: '150.20',
      },
    ]);
    expect(r.totals).toMatchObject({
      accrued: '350.30',
      paid: '50.00',
      balance: '250.30',
    });
    expect(r.title).toBe('Зарплати');
    expect(r.fileName).toBe('зарплати');
  });
});
