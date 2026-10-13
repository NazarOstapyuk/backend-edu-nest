import { Test } from '@nestjs/testing';
import { PayrollStatus, Role } from '@prisma/client';
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
});
