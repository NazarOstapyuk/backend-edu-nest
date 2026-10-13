import { Test } from '@nestjs/testing';
import {
  AttendanceStatus,
  ClassFormat,
  PayrollAdjustmentKind,
  PayrollCalendar,
  PayrollLessonType,
  PayrollLineType,
  PayrollPaymentMethod,
  PayrollSourceType,
  PayrollStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { PayrollBuilder } from './payroll-builder.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dec = (value: string) => new Prisma.Decimal(value);
const OCT = day('2026-10-01');
const teacher = { id: 't1', firstName: 'Олена', lastName: 'Коваль' };
const staffRef = { id: 'a1', firstName: 'Адмін', lastName: 'Головний' };

const termsRow = {
  id: 'st1',
  teacherId: 't1',
  validFrom: day('2026-09-01'),
  validTo: null,
  monthlyRate: dec('22000'),
  calendarKind: PayrollCalendar.all,
  rates: [
    {
      id: 'r1',
      termsId: 'st1',
      lessonType: PayrollLessonType.school_lesson,
      subjectId: null,
      classGroupId: null,
      amount: dec('300'),
    },
  ],
  allowances: [],
};

const adjustment = (id: string, voidedAt: Date | null) => ({
  id,
  sheetId: 'ps1',
  kind: PayrollAdjustmentKind.bonus,
  amount: dec('500'),
  reason: 'Премія',
  createdById: 'a1',
  createdBy: staffRef,
  createdAt: new Date('2026-10-10T10:00:00Z'),
  voidedAt,
  voidedById: voidedAt ? 'a1' : null,
  voidReason: voidedAt ? 'Помилка' : null,
});

const payment = (id: string, amount: string, voidedAt: Date | null) => ({
  id,
  sheetId: 'ps1',
  date: day('2026-10-15'),
  amount: dec(amount),
  method: PayrollPaymentMethod.cash,
  comment: null,
  createdById: 'a1',
  createdBy: staffRef,
  createdAt: new Date('2026-10-15T10:00:00Z'),
  voidedAt,
  voidedById: voidedAt ? 'a1' : null,
  voidReason: voidedAt ? 'Помилка' : null,
});

const mockPrisma = {
  user: { findUnique: jest.fn() },
  salaryTerms: { findMany: jest.fn() },
  schoolLesson: { findMany: jest.fn() },
  lesson: { findMany: jest.fn() },
  payrollSheet: { findUnique: jest.fn(), findMany: jest.fn() },
  payrollLine: { findMany: jest.fn() },
};
const mockCalendar = { entriesBetween: jest.fn() };

describe('PayrollBuilder', () => {
  let builder: PayrollBuilder;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.salaryTerms.findMany.mockResolvedValue([termsRow]);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
    mockPrisma.lesson.findMany.mockResolvedValue([]);
    mockPrisma.payrollSheet.findUnique.mockResolvedValue(null);
    mockPrisma.payrollSheet.findMany.mockResolvedValue([]);
    mockPrisma.payrollLine.findMany.mockResolvedValue([]);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        PayrollBuilder,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
      ],
    }).compile();
    builder = module.get(PayrollBuilder);
    prisma = module.get(PrismaService);
  });

  it('rejects a user who is not a teacher', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...teacher,
      role: Role.parent,
    });
    await expect(builder.teacher(prisma, 't1')).rejects.toThrow(
      'Teacher not found',
    );
  });

  it('computes a draft from terms and conducted lessons', async () => {
    mockPrisma.schoolLesson.findMany.mockResolvedValue([
      {
        id: 'sl1',
        date: day('2026-10-05'),
        subjectId: 's1',
        subject: { name: 'Математика' },
      },
    ]);
    mockPrisma.lesson.findMany.mockResolvedValue([
      {
        id: 'cl1',
        date: day('2026-10-06'),
        classGroupId: 'cg1',
        classGroup: { name: 'Вокал', format: ClassFormat.individual },
      },
    ]);

    const detail = await builder.detail(prisma, teacher, OCT, true);

    expect(mockPrisma.lesson.findMany).toHaveBeenCalledWith({
      where: {
        conductedById: 't1',
        date: { gte: OCT, lte: day('2026-10-31') },
        attendances: {
          some: { voidedAt: null, status: AttendanceStatus.present },
        },
      },
      select: expect.any(Object) as object,
    });
    expect(mockPrisma.schoolLesson.findMany).toHaveBeenCalledWith({
      where: { teacherId: 't1', date: { gte: OCT, lte: day('2026-10-31') } },
      select: expect.any(Object) as object,
    });
    expect(detail.month).toBe('2026-10');
    expect(detail.status).toBe(PayrollStatus.draft);
    expect(detail.lines).toEqual([
      {
        type: PayrollLineType.base,
        title: '',
        date: null,
        lessonType: null,
        refMonth: null,
        amount: '22000.00',
        noRate: false,
        sourceType: null,
        sourceId: null,
      },
      {
        type: PayrollLineType.lesson,
        title: 'Математика',
        date: '2026-10-05',
        lessonType: PayrollLessonType.school_lesson,
        refMonth: null,
        amount: '300.00',
        noRate: false,
        sourceType: PayrollSourceType.school_lesson,
        sourceId: 'sl1',
      },
      {
        type: PayrollLineType.lesson,
        title: 'Вокал',
        date: '2026-10-06',
        lessonType: PayrollLessonType.individual,
        refMonth: null,
        amount: '0.00',
        noRate: true,
        sourceType: PayrollSourceType.class_lesson,
        sourceId: 'cl1',
      },
    ]);
    expect(detail.warnings).toEqual({ noRate: 1, lessonsWithoutTerms: 0 });
    expect(detail.lessons).toBe(2);
    expect(detail.totals).toEqual({
      accrued: '22300.00',
      paid: '0.00',
      balance: '22300.00',
    });
    expect(mockPrisma.payrollLine.findMany).not.toHaveBeenCalled();
  });

  it('reads an approved sheet from its stored lines only', async () => {
    mockPrisma.payrollSheet.findUnique.mockResolvedValue({
      id: 'ps1',
      teacherId: 't1',
      month: OCT,
      status: PayrollStatus.approved,
      workedDays: null,
      approvedDays: {
        normDays: 22,
        defaultDays: 22,
        workedDays: 22,
        override: false,
      },
      approvedAt: new Date('2026-11-01T09:00:00Z'),
      reopenReason: null,
      lines: [
        {
          id: 'pl1',
          sheetId: 'ps1',
          position: 0,
          type: PayrollLineType.base,
          sourceType: null,
          sourceId: null,
          lessonType: null,
          date: null,
          refMonth: null,
          title: '',
          amount: dec('1000'),
          meta: { normDays: 22, defaultDays: 22, workedDays: 22 },
        },
        {
          id: 'pl2',
          sheetId: 'ps1',
          position: 1,
          type: PayrollLineType.lesson,
          sourceType: PayrollSourceType.school_lesson,
          sourceId: 'sl1',
          lessonType: PayrollLessonType.school_lesson,
          date: day('2026-10-05'),
          refMonth: null,
          title: 'Математика',
          amount: dec('0'),
          meta: { noRate: true },
        },
      ],
      adjustments: [],
      payments: [payment('pp1', '400', null)],
    });

    const detail = await builder.detail(prisma, teacher, OCT, true);

    expect(mockPrisma.schoolLesson.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.salaryTerms.findMany).not.toHaveBeenCalled();
    expect(detail.status).toBe(PayrollStatus.approved);
    expect(detail.approvedAt).toBe('2026-11-01T09:00:00.000Z');
    expect(detail.days).toEqual({
      normDays: 22,
      defaultDays: 22,
      workedDays: 22,
      override: false,
    });
    expect(detail.lessons).toBe(1);
    expect(detail.warnings).toEqual({ noRate: 1, lessonsWithoutTerms: 0 });
    expect(detail.totals).toEqual({
      accrued: '1000.00',
      paid: '400.00',
      balance: '600.00',
    });
    expect(detail.payments[0]).toMatchObject({
      id: 'pp1',
      date: '2026-10-15',
      amount: '400.00',
      createdBy: staffRef,
    });
  });

  it('adds corrections for lessons of approved months only before the month', async () => {
    mockPrisma.payrollSheet.findMany.mockResolvedValue([
      { month: day('2026-09-01') },
    ]);
    mockPrisma.schoolLesson.findMany.mockImplementation(
      (args: { where: { date: { gte: Date } } }) =>
        Promise.resolve(
          args.where.date.gte.getTime() === day('2026-09-01').getTime()
            ? [
                {
                  id: 'sl0',
                  date: day('2026-09-30'),
                  subjectId: 's1',
                  subject: { name: 'Математика' },
                },
              ]
            : [],
        ),
    );

    const detail = await builder.detail(prisma, teacher, OCT, true);

    expect(mockPrisma.payrollSheet.findMany).toHaveBeenCalledWith({
      where: {
        teacherId: 't1',
        status: PayrollStatus.approved,
        month: { lt: OCT },
      },
      select: { month: true },
      orderBy: { month: 'asc' },
    });
    expect(mockPrisma.schoolLesson.findMany).toHaveBeenCalledWith({
      where: {
        teacherId: 't1',
        date: { gte: day('2026-09-01'), lte: day('2026-09-30') },
      },
      select: expect.any(Object) as object,
    });
    expect(mockPrisma.payrollLine.findMany).toHaveBeenCalledWith({
      where: {
        sheet: { teacherId: 't1', status: PayrollStatus.approved },
        type: { in: [PayrollLineType.lesson, PayrollLineType.correction] },
        date: { lt: OCT },
      },
      select: expect.any(Object) as object,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const correction = detail.lines.find(
      (l) => l.type === PayrollLineType.correction,
    );
    expect(correction).toMatchObject({
      sourceId: 'sl0',
      refMonth: '2026-09',
      amount: '300.00',
    });
  });

  it('hides staff names and voided records from the teacher', async () => {
    mockPrisma.payrollSheet.findUnique.mockResolvedValue({
      id: 'ps1',
      teacherId: 't1',
      month: OCT,
      status: PayrollStatus.draft,
      workedDays: null,
      approvedDays: null,
      approvedAt: null,
      reopenReason: null,
      lines: [],
      adjustments: [
        adjustment('pa1', null),
        adjustment('pa2', new Date('2026-10-11T10:00:00Z')),
      ],
      payments: [
        payment('pp1', '100', null),
        payment('pp2', '50', new Date('2026-10-16T10:00:00Z')),
      ],
    });

    const own = await builder.detail(prisma, teacher, OCT, false);
    const staff = await builder.detail(prisma, teacher, OCT, true);

    expect(own.adjustments).toHaveLength(1);
    expect(own.adjustments[0]).not.toHaveProperty('createdBy');
    expect(own.payments).toHaveLength(1);
    expect(own.payments[0]).not.toHaveProperty('createdBy');
    expect(own.totals).toEqual({
      accrued: '22500.00',
      paid: '100.00',
      balance: '22400.00',
    });
    expect(staff.adjustments).toHaveLength(2);
    expect(staff.adjustments[1]).toMatchObject({
      createdBy: staffRef,
      voidReason: 'Помилка',
    });
    expect(staff.payments).toHaveLength(2);
  });
});
