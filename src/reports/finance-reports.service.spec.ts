import { BadRequestException } from '@nestjs/common';
import {
  AccessScope,
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
