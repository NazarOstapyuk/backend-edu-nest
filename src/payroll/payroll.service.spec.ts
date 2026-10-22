import { Test } from '@nestjs/testing';
import {
  PayrollAdjustmentKind,
  PayrollLessonType,
  PayrollLineType,
  PayrollPaymentMethod,
  PayrollSourceType,
  PayrollStatus,
  Prisma,
  Role,
  AccessScope,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollBuilder } from './payroll-builder.service';
import { PayrollService } from './payroll.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const OCT = day('2026-10-01');
const teacher = { id: 't1', firstName: 'Олена', lastName: 'Коваль' };
const teacherUser = {
  id: 't1',
  role: Role.teacher,
  login: 'olena',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: {},
};

const detailOf = (
  id: string,
  accrued: string,
  paid: string,
  balance: string,
  month = '2026-10',
) => ({
  teacher: { id, firstName: 'Ім’я', lastName: id },
  month,
  status: PayrollStatus.draft,
  approvedAt: null,
  reopenReason: null,
  days: { normDays: 22, defaultDays: 22, workedDays: 22, override: false },
  lines: [],
  adjustments: [],
  payments: [],
  warnings: { noRate: 0, lessonsWithoutTerms: 0 },
  lessons: 3,
  totals: { accrued, paid, balance },
});

const mockPrisma = {
  user: { findMany: jest.fn() },
  salaryTerms: { findMany: jest.fn() },
  payrollSheet: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
  },
  payrollLine: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  payrollAdjustment: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  payrollPayment: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockBuilder = {
  teacher: jest.fn(),
  detail: jest.fn(),
  compute: jest.fn(),
};

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockBuilder.teacher.mockResolvedValue(teacher);
    mockBuilder.detail.mockResolvedValue(
      detailOf('t1', '0.00', '0.00', '0.00'),
    );
    const module = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PayrollBuilder, useValue: mockBuilder },
      ],
    }).compile();
    service = module.get(PayrollService);
    prisma = module.get(PrismaService);
  });

  describe('views', () => {
    it('lists teachers with terms or a sheet in the month and sums totals', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 't1', firstName: 'А', lastName: 'А' },
        { id: 't2', firstName: 'Б', lastName: 'Б' },
      ]);
      mockBuilder.detail
        .mockResolvedValueOnce(detailOf('t1', '1000.50', '200.00', '800.50'))
        .mockResolvedValueOnce(detailOf('t2', '500.00', '700.00', '-200.00'));

      const result = await service.list('2026-10');

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          role: Role.teacher,
          OR: [
            {
              salaryTerms: {
                some: {
                  validFrom: { lte: day('2026-10-31') },
                  OR: [{ validTo: null }, { validTo: { gte: OCT } }],
                },
              },
            },
            { payrollSheets: { some: { month: OCT } } },
          ],
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      expect(mockBuilder.detail).toHaveBeenCalledWith(
        prisma,
        { id: 't1', firstName: 'А', lastName: 'А' },
        OCT,
        true,
      );
      expect(result.month).toBe('2026-10');
      expect(result.rows).toHaveLength(2);
      expect(result.rows[1]).toMatchObject({
        accrued: '500.00',
        paid: '700.00',
        balance: '-200.00',
        lessons: 3,
      });
      expect(result.totals).toEqual({
        accrued: '1500.50',
        paid: '900.00',
        balance: '600.50',
      });
    });

    it('rejects an invalid month', async () => {
      await expect(service.detail('t1', '2026-13')).rejects.toThrow(
        'Invalid month',
      );
    });

    it('returns the staff detail of a teacher', async () => {
      await service.detail('t1', '2026-10');
      expect(mockBuilder.teacher).toHaveBeenCalledWith(prisma, 't1');
      expect(mockBuilder.detail).toHaveBeenCalledWith(
        prisma,
        teacher,
        OCT,
        true,
      );
    });

    it('rejects an invalid year', async () => {
      await expect(service.myYear(teacherUser, '20x6')).rejects.toThrow(
        'Invalid year',
      );
    });

    it('lists months of a year that have terms or a sheet', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        { validFrom: day('2020-03-01'), validTo: day('2020-04-30') },
      ]);
      mockPrisma.payrollSheet.findMany.mockResolvedValue([
        { month: day('2020-06-01') },
      ]);
      mockBuilder.detail.mockImplementation(
        (_db: unknown, _teacher: unknown, month: Date) =>
          Promise.resolve(
            detailOf(
              't1',
              '10.00',
              '0.00',
              '10.00',
              month.toISOString().slice(0, 7),
            ),
          ),
      );

      const result = await service.myYear(teacherUser, '2020');

      expect(mockBuilder.teacher).toHaveBeenCalledWith(prisma, 't1');
      expect(result.year).toBe(2020);
      expect(result.months.map((m) => m.month)).toEqual([
        '2020-03',
        '2020-04',
        '2020-06',
      ]);
      expect(result.months[0]).toEqual({
        month: '2020-03',
        status: PayrollStatus.draft,
        accrued: '10.00',
        paid: '0.00',
        balance: '10.00',
      });
      expect(mockBuilder.detail).toHaveBeenCalledWith(
        prisma,
        teacher,
        day('2020-03-01'),
        false,
      );
    });

    it('skips months after the current one', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        { validFrom: day('2099-01-01'), validTo: null },
      ]);
      mockPrisma.payrollSheet.findMany.mockResolvedValue([]);
      const result = await service.myYear(teacherUser, '2099');
      expect(result.months).toEqual([]);
      expect(mockBuilder.detail).not.toHaveBeenCalled();
    });

    it('returns the own month without staff fields', async () => {
      await service.myMonth(teacherUser, '2026-10');
      expect(mockBuilder.teacher).toHaveBeenCalledWith(prisma, 't1');
      expect(mockBuilder.detail).toHaveBeenCalledWith(
        prisma,
        teacher,
        OCT,
        false,
      );
    });
  });

  describe('mutations', () => {
    const admin = {
      id: 'a1',
      role: Role.admin,
      login: 'admin',
      mustChangePassword: false,
      accessScope: AccessScope.all,
      institutionIds: [] as string[],
      scopeInstitutionIds: null as string[] | null,
      permissions: {},
    };
    const dec = (value: string) => new Prisma.Decimal(value);
    const sheet = (over: Record<string, unknown> = {}) => ({
      id: 'ps1',
      teacherId: 't1',
      month: OCT,
      status: PayrollStatus.draft,
      workedDays: null,
      approvedAt: null,
      adjustments: [],
      ...over,
    });
    const sqlOf = (index: number) =>
      (
        mockPrisma.$queryRaw.mock.calls[index] as [TemplateStringsArray]
      )[0].join('?');

    beforeEach(() => {
      mockPrisma.payrollSheet.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.payrollSheet.findUniqueOrThrow.mockResolvedValue(sheet());
    });

    it('locks the sheet before reading it and stores worked days', async () => {
      await service.setWorkedDays('t1', '2026-10', 12);

      expect(mockPrisma.payrollSheet.createMany).toHaveBeenCalledWith({
        data: [{ teacherId: 't1', month: OCT }],
        skipDuplicates: true,
      });
      expect(sqlOf(0)).toContain('FOR UPDATE');
      expect(
        mockPrisma.payrollSheet.createMany.mock.invocationCallOrder[0],
      ).toBeLessThan(mockPrisma.$queryRaw.mock.invocationCallOrder[0]);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.payrollSheet.findUniqueOrThrow.mock.invocationCallOrder[1],
      );
      expect(mockPrisma.payrollSheet.update).toHaveBeenCalledWith({
        where: { id: 'ps1' },
        data: { workedDays: 12 },
      });
      expect(mockBuilder.detail).toHaveBeenCalledWith(
        prisma,
        teacher,
        OCT,
        true,
      );
    });

    it('rejects worked days on an approved sheet', async () => {
      mockPrisma.payrollSheet.findUniqueOrThrow.mockResolvedValue(
        sheet({ status: PayrollStatus.approved }),
      );
      await expect(service.setWorkedDays('t1', '2026-10', 12)).rejects.toThrow(
        'Payroll is approved',
      );
      expect(mockPrisma.payrollSheet.update).not.toHaveBeenCalled();
    });

    it('adds a bonus to a draft', async () => {
      await service.addAdjustment(
        't1',
        '2026-10',
        {
          kind: PayrollAdjustmentKind.bonus,
          amount: '500',
          reason: ' Премія ',
        },
        admin,
      );
      expect(mockPrisma.payrollAdjustment.create).toHaveBeenCalledWith({
        data: {
          sheetId: 'ps1',
          kind: PayrollAdjustmentKind.bonus,
          amount: dec('500'),
          reason: 'Премія',
          createdById: 'a1',
        },
      });
    });

    it('rejects a zero adjustment before opening a transaction', async () => {
      await expect(
        service.addAdjustment(
          't1',
          '2026-10',
          { kind: PayrollAdjustmentKind.deduction, amount: '0', reason: 'x' },
          admin,
        ),
      ).rejects.toThrow('Amount must be greater than 0');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an adjustment on an approved sheet', async () => {
      mockPrisma.payrollSheet.findUniqueOrThrow.mockResolvedValue(
        sheet({ status: PayrollStatus.approved }),
      );
      await expect(
        service.addAdjustment(
          't1',
          '2026-10',
          { kind: PayrollAdjustmentKind.bonus, amount: '1', reason: 'x' },
          admin,
        ),
      ).rejects.toThrow('Payroll is approved');
    });

    it('voids an adjustment of a draft', async () => {
      mockPrisma.payrollAdjustment.findUnique.mockResolvedValue({
        sheet: { id: 'ps1', teacherId: 't1', month: OCT },
      });
      mockPrisma.payrollAdjustment.findUniqueOrThrow.mockResolvedValue({
        voidedAt: null,
      });

      await service.voidAdjustment('pa1', ' Помилка ', admin);

      expect(sqlOf(0)).toContain('FOR UPDATE');
      expect(mockPrisma.payrollAdjustment.update).toHaveBeenCalledWith({
        where: { id: 'pa1' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'a1',
          voidReason: 'Помилка',
        },
      });
      expect(mockBuilder.teacher).toHaveBeenCalledWith(prisma, 't1');
    });

    it('rejects a missing or voided adjustment', async () => {
      mockPrisma.payrollAdjustment.findUnique.mockResolvedValue(null);
      await expect(service.voidAdjustment('pa1', 'x', admin)).rejects.toThrow(
        'Payroll adjustment not found',
      );
      mockPrisma.payrollAdjustment.findUnique.mockResolvedValue({
        sheet: { id: 'ps1', teacherId: 't1', month: OCT },
      });
      mockPrisma.payrollAdjustment.findUniqueOrThrow.mockResolvedValue({
        voidedAt: new Date(),
      });
      await expect(service.voidAdjustment('pa1', 'x', admin)).rejects.toThrow(
        'Adjustment is voided',
      );
    });

    it('records a payment on an approved sheet', async () => {
      mockPrisma.payrollSheet.findUniqueOrThrow.mockResolvedValue(
        sheet({ status: PayrollStatus.approved }),
      );
      await service.addPayment(
        't1',
        '2026-10',
        {
          date: '2026-10-05',
          amount: '5000',
          method: PayrollPaymentMethod.cash,
        },
        admin,
      );
      expect(mockPrisma.payrollPayment.create).toHaveBeenCalledWith({
        data: {
          sheetId: 'ps1',
          date: day('2026-10-05'),
          amount: dec('5000'),
          method: PayrollPaymentMethod.cash,
          comment: null,
          createdById: 'a1',
        },
      });
    });

    it('rejects a payment dated in the future', async () => {
      await expect(
        service.addPayment(
          't1',
          '2026-10',
          {
            date: '2099-01-01',
            amount: '1',
            method: PayrollPaymentMethod.card,
          },
          admin,
        ),
      ).rejects.toThrow('Payment date is in the future');
    });

    it('rejects a missing or voided payment', async () => {
      mockPrisma.payrollPayment.findUnique.mockResolvedValue(null);
      await expect(service.voidPayment('pp1', 'x', admin)).rejects.toThrow(
        'Payroll payment not found',
      );
      mockPrisma.payrollPayment.findUnique.mockResolvedValue({
        sheet: { id: 'ps1', teacherId: 't1', month: OCT },
      });
      mockPrisma.payrollPayment.findUniqueOrThrow.mockResolvedValue({
        voidedAt: new Date(),
      });
      await expect(service.voidPayment('pp1', 'x', admin)).rejects.toThrow(
        'Payment is voided',
      );
    });

    it('voids a payment of an approved sheet', async () => {
      mockPrisma.payrollSheet.findUniqueOrThrow.mockResolvedValue(
        sheet({ status: PayrollStatus.approved }),
      );
      mockPrisma.payrollPayment.findUnique.mockResolvedValue({
        sheet: { id: 'ps1', teacherId: 't1', month: OCT },
      });
      mockPrisma.payrollPayment.findUniqueOrThrow.mockResolvedValue({
        voidedAt: null,
      });
      await service.voidPayment('pp1', 'Дубль', admin);
      expect(mockPrisma.payrollPayment.update).toHaveBeenCalledWith({
        where: { id: 'pp1' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'a1',
          voidReason: 'Дубль',
        },
      });
    });

    it('rejects approving a future month', async () => {
      await expect(service.approve('t1', '2099-01', admin)).rejects.toThrow(
        'Month is in the future',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects approving an approved sheet', async () => {
      mockPrisma.payrollSheet.findUniqueOrThrow.mockResolvedValue(
        sheet({ status: PayrollStatus.approved }),
      );
      await expect(service.approve('t1', '2026-10', admin)).rejects.toThrow(
        'Payroll is approved',
      );
      expect(mockBuilder.compute).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('snapshots computed lines on approval after locking approved sheets', async () => {
      const days = {
        normDays: 22,
        defaultDays: 22,
        workedDays: 22,
        override: false,
      };
      mockBuilder.compute.mockResolvedValue({
        days,
        lines: [
          {
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
            type: PayrollLineType.lesson,
            sourceType: PayrollSourceType.school_lesson,
            sourceId: 'sl1',
            lessonType: PayrollLessonType.school_lesson,
            date: day('2026-10-05'),
            refMonth: null,
            title: 'Математика',
            amount: dec('300'),
            meta: null,
          },
        ],
        warnings: { noRate: 0, lessonsWithoutTerms: 0 },
        lessons: 1,
      });

      await service.approve('t1', '2026-10', admin);

      expect(sqlOf(1)).toContain(`status = 'approved'`);
      expect(sqlOf(1)).toContain('ORDER BY id FOR UPDATE');
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        mockBuilder.compute.mock.invocationCallOrder[0],
      );
      expect(mockBuilder.compute).toHaveBeenCalledWith(
        mockPrisma,
        't1',
        OCT,
        null,
        [],
      );
      expect(mockPrisma.payrollLine.createMany).toHaveBeenCalledWith({
        data: [
          {
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
            sheetId: 'ps1',
            position: 1,
            type: PayrollLineType.lesson,
            sourceType: PayrollSourceType.school_lesson,
            sourceId: 'sl1',
            lessonType: PayrollLessonType.school_lesson,
            date: day('2026-10-05'),
            refMonth: null,
            title: 'Математика',
            amount: dec('300'),
            meta: undefined,
          },
        ],
      });
      expect(mockPrisma.payrollSheet.update).toHaveBeenCalledWith({
        where: { id: 'ps1' },
        data: {
          status: PayrollStatus.approved,
          approvedAt: expect.any(Date) as Date,
          approvedById: 'a1',
          approvedDays: days,
        },
      });
    });

    describe('reopen', () => {
      const approvedAt = new Date('2026-11-01T09:00:00Z');

      it('rejects a sheet that is not approved', async () => {
        mockPrisma.payrollSheet.findUnique.mockResolvedValue(sheet());
        await expect(
          service.reopen('t1', '2026-10', 'x', admin),
        ).rejects.toThrow('Payroll is not approved');
      });

      it('rejects when the sheet is not among the locked approved sheets', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.payrollSheet.findUnique.mockResolvedValue(
          sheet({ status: PayrollStatus.approved, approvedAt }),
        );
        await expect(
          service.reopen('t1', '2026-10', 'x', admin),
        ).rejects.toThrow('Payroll is not approved');
        expect(mockPrisma.payrollLine.deleteMany).not.toHaveBeenCalled();
      });

      it('rejects when a payment was made after approval', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'ps1' }]);
        mockPrisma.payrollSheet.findUnique.mockResolvedValue(
          sheet({ status: PayrollStatus.approved, approvedAt }),
        );
        mockPrisma.payrollPayment.count.mockResolvedValue(1);
        await expect(
          service.reopen('t1', '2026-10', 'x', admin),
        ).rejects.toThrow('Payroll has payments after approval');
        expect(mockPrisma.payrollPayment.count).toHaveBeenCalledWith({
          where: {
            sheetId: 'ps1',
            voidedAt: null,
            createdAt: { gt: approvedAt },
          },
        });
      });

      it('rejects when a later sheet booked a correction for this month', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'ps1' }]);
        mockPrisma.payrollSheet.findUnique.mockResolvedValue(
          sheet({ status: PayrollStatus.approved, approvedAt }),
        );
        mockPrisma.payrollPayment.count.mockResolvedValue(0);
        mockPrisma.payrollLine.count.mockResolvedValue(2);
        await expect(
          service.reopen('t1', '2026-10', 'x', admin),
        ).rejects.toThrow('Payroll has later corrections');
        expect(mockPrisma.payrollLine.count).toHaveBeenCalledWith({
          where: {
            type: PayrollLineType.correction,
            refMonth: OCT,
            sheet: { teacherId: 't1', status: PayrollStatus.approved },
          },
        });
      });

      it('deletes the snapshot and returns the sheet to draft', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'ps1' }]);
        mockPrisma.payrollSheet.findUnique.mockResolvedValue(
          sheet({ status: PayrollStatus.approved, approvedAt }),
        );
        mockPrisma.payrollPayment.count.mockResolvedValue(0);
        mockPrisma.payrollLine.count.mockResolvedValue(0);

        await service.reopen('t1', '2026-10', ' Помилка в ставці ', admin);

        expect(sqlOf(0)).toContain('ORDER BY id FOR UPDATE');
        expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          mockPrisma.payrollSheet.findUnique.mock.invocationCallOrder[0],
        );
        expect(mockPrisma.payrollLine.deleteMany).toHaveBeenCalledWith({
          where: { sheetId: 'ps1' },
        });
        expect(mockPrisma.payrollSheet.update).toHaveBeenCalledWith({
          where: { id: 'ps1' },
          data: {
            status: PayrollStatus.draft,
            approvedAt: null,
            approvedById: null,
            approvedDays: Prisma.JsonNull,
            reopenedAt: expect.any(Date) as Date,
            reopenedById: 'a1',
            reopenReason: 'Помилка в ставці',
          },
        });
      });
    });
  });
});
