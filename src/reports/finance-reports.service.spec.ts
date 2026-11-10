import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AccessScope,
  ChargeSource,
  FinanceCategory,
  GroupKind,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { FinanceReportsService } from './finance-reports.service';

const user = (accessScope: AccessScope, ids: string[] = ['inst-k']) => ({
  id: 'u1',
  role: Role.admin,
  login: 'a',
  mustChangePassword: false,
  accessScope,
  institutionIds: accessScope === AccessScope.institutions ? ids : [],
  scopeInstitutionIds: accessScope === AccessScope.institutions ? ids : null,
  permissions: {},
});

describe('FinanceReportsService', () => {
  let service: FinanceReportsService;
  const prisma = {
    group: { findUnique: jest.fn() },
    payment: { findMany: jest.fn() },
    charge: { findMany: jest.fn() },
    child: { findMany: jest.fn() },
    tariff: { findUnique: jest.fn() },
    enrollment: { findMany: jest.fn() },
    package: { findMany: jest.fn() },
    adaptationVisit: { findMany: jest.fn() },
    lessonAttendance: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.charge.findMany.mockResolvedValue([]);
    prisma.child.findMany.mockResolvedValue([]);
    service = new FinanceReportsService(prisma as never);
  });

  describe('payments', () => {
    it('queries confirmed, non-voided payments within Kyiv day bounds', async () => {
      await service.payments(
        { from: '2026-10-01', to: '2026-10-31' },
        user(AccessScope.institutions),
      );
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            voidedAt: null,
            status: PaymentStatus.confirmed,
            receivedAt: {
              gte: new Date('2026-09-30T21:00:00.000Z'),
              lt: new Date('2026-10-31T22:00:00.000Z'),
            },
            child: { group: { institutionId: { in: ['inst-k'] } } },
          },
        }),
      );
    });

    it('maps rows into the report', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          receivedAt: new Date('2026-10-05T10:00:00.000Z'),
          category: FinanceCategory.tuition,
          method: PaymentMethod.cash,
          amount: new Prisma.Decimal('100'),
          reference: 'r1',
          note: null,
          child: {
            firstName: 'Ivan',
            lastName: 'Petrenko',
            group: { name: 'G1' },
          },
        },
      ]);
      const report = await service.payments(
        { from: '2026-10-01', to: '2026-10-31' },
        user(AccessScope.all),
      );
      expect(report.rows).toHaveLength(1);
      expect(report.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
      expect(JSON.stringify(report.rows[0])).toContain('Petrenko Ivan');
    });

    it('intersects a requested kind with the scope', async () => {
      await service.payments(
        {
          from: '2026-10-01',
          to: '2026-10-31',
          kind: GroupKind.school_class,
        },
        user(AccessScope.institutions),
      );
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            child: {
              group: {
                kind: GroupKind.school_class,
                institutionId: { in: ['inst-k'] },
              },
            },
          }) as unknown,
        }),
      );
    });

    it('rejects an invalid period', async () => {
      await expect(
        service.payments(
          { from: '2026-10-31', to: '2026-10-01' },
          user(AccessScope.all),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('charges', () => {
    it('queries both period branches', async () => {
      await service.charges(
        { from: '2026-10-01', to: '2026-10-31' },
        user(AccessScope.all),
      );
      expect(prisma.charge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            voidedAt: null,
            child: {},
            OR: [
              {
                periodStart: {
                  gte: new Date('2026-10-01T00:00:00.000Z'),
                  lte: new Date('2026-10-31T00:00:00.000Z'),
                },
              },
              {
                periodStart: null,
                createdAt: {
                  gte: new Date('2026-09-30T21:00:00.000Z'),
                  lt: new Date('2026-10-31T22:00:00.000Z'),
                },
              },
            ],
          },
        }),
      );
      expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
    });

    const charge = (
      sourceType: ChargeSource,
      sourceId: string | null,
      amount: string,
      category: FinanceCategory = FinanceCategory.tuition,
    ) => ({
      periodStart: new Date('2026-10-05T00:00:00.000Z'),
      createdAt: new Date('2026-10-05T08:00:00.000Z'),
      category,
      sourceType,
      sourceId,
      description: 'd',
      amount: new Prisma.Decimal(amount),
      child: {
        id: 'c1',
        firstName: 'Ivan',
        lastName: 'Petrenko',
        group: { name: 'G1' },
      },
    });

    const mockSources = () => {
      prisma.charge.findMany.mockResolvedValue([
        charge(ChargeSource.monthly, 'e1', '1000'),
        charge(ChargeSource.monthly, 'e1', '1000'),
        charge(ChargeSource.extra_package, 'p1', '500'),
        charge(ChargeSource.adaptation, 'v1', '200'),
        charge(ChargeSource.extra_session, 'a1', '100'),
        charge(ChargeSource.meals, 'o1', '50', FinanceCategory.meals),
        charge(ChargeSource.opening_balance, 'p1', '30'),
      ]);
      prisma.enrollment.findMany.mockResolvedValue([
        { id: 'e1', tariff: { id: 't-month', name: 'Абонемент' } },
      ]);
      prisma.package.findMany.mockResolvedValue([
        { id: 'p1', tariff: { id: 't-lego', name: 'Лего' } },
      ]);
      prisma.adaptationVisit.findMany.mockResolvedValue([
        { id: 'v1', tariff: { id: 't-adapt', name: 'Адаптація' } },
      ]);
      prisma.lessonAttendance.findMany.mockResolvedValue([
        {
          id: 'a1',
          lesson: {
            classGroup: { singleTariff: { id: 't-art', name: 'Малювання' } },
          },
        },
      ]);
    };

    it('resolves tariffs in one batch query per source type', async () => {
      mockSources();
      const report = await service.charges(
        { from: '2026-10-01', to: '2026-10-31' },
        user(AccessScope.all),
      );
      expect(prisma.enrollment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['e1'] } } }),
      );
      expect(prisma.package.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['p1'] } } }),
      );
      expect(prisma.adaptationVisit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['v1'] } } }),
      );
      expect(prisma.lessonAttendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['a1'] } } }),
      );
      expect(report.rows.map((r) => r.tariff)).toEqual([
        'Абонемент',
        'Абонемент',
        'Лего',
        'Адаптація',
        'Малювання',
        'Харчування',
        'Без тарифу',
      ]);
      expect(report.sheets[0].rows[0]).toEqual({
        tariff: 'Абонемент',
        count: 2,
        children: 1,
        amount: '2000.00',
      });
    });

    it('keeps only charges of the requested tariff', async () => {
      mockSources();
      prisma.tariff.findUnique.mockResolvedValue({ institutionId: null });
      const tariffId = '0b7e6a52-6f4d-4c1b-8d3e-2f6c1a9b7e10';
      prisma.package.findMany.mockResolvedValue([
        { id: 'p1', tariff: { id: tariffId, name: 'Лего' } },
      ]);
      const report = await service.charges(
        { from: '2026-10-01', to: '2026-10-31', tariffId },
        user(AccessScope.institutions),
      );
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0].tariff).toBe('Лего');
    });

    it('answers 404 for an unknown tariff', async () => {
      prisma.tariff.findUnique.mockResolvedValue(null);
      await expect(
        service.charges(
          { from: '2026-10-01', to: '2026-10-31', tariffId: 'x' },
          user(AccessScope.all),
        ),
      ).rejects.toThrow(new NotFoundException('Tariff not found'));
    });

    it('answers 404 for a tariff of an institution outside the scope', async () => {
      prisma.tariff.findUnique.mockResolvedValue({ institutionId: 'inst-s' });
      await expect(
        service.charges(
          { from: '2026-10-01', to: '2026-10-31', tariffId: 'x' },
          user(AccessScope.institutions, ['inst-k']),
        ),
      ).rejects.toThrow(new NotFoundException('Tariff not found'));
      expect(prisma.charge.findMany).not.toHaveBeenCalled();
    });

    it('allows a tariff of an institution inside the scope', async () => {
      prisma.tariff.findUnique.mockResolvedValue({ institutionId: 'inst-k' });
      await expect(
        service.charges(
          { from: '2026-10-01', to: '2026-10-31', tariffId: 'x' },
          user(AccessScope.institutions, ['inst-k']),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('debts', () => {
    const charge = (id: string, amount: string) => ({
      id,
      category: FinanceCategory.tuition,
      amount: new Prisma.Decimal(amount),
      description: 'd',
      periodStart: new Date('2020-01-01T00:00:00.000Z'),
      periodEnd: new Date('2020-01-31T00:00:00.000Z'),
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      voidedAt: null,
      allocations: [],
    });
    const child = (lastName: string, amount: string) => ({
      firstName: 'A',
      lastName,
      group: { name: 'G' },
      parents: [{ firstName: 'P', lastName: 'Q', phone: '123' }],
      charges: [charge(lastName, amount)],
      payments: [],
    });

    it('returns only children with debt', async () => {
      prisma.child.findMany.mockResolvedValue([
        child('Debtor', '50'),
        child('Clean', '0'),
      ]);
      const report = await service.debts({}, user(AccessScope.all));
      expect(report.rows).toHaveLength(1);
      expect(JSON.stringify(report.rows[0])).toContain('Debtor A');
      expect(JSON.stringify(report.rows[0])).toContain('Q P 123');
    });

    it('applies the scope filter to the child query', async () => {
      await service.debts({}, user(AccessScope.institutions, ['inst-s']));
      expect(prisma.child.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group: { institutionId: { in: ['inst-s'] } } },
        }),
      );
    });
  });
});
