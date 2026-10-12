import { Test } from '@nestjs/testing';
import {
  ChargeSource,
  FinanceCategory,
  Prisma,
  TariffUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PackagesService } from './packages.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  child: { findUnique: jest.fn() },
  direction: { findUnique: jest.fn() },
  tariff: { findUnique: jest.fn() },
  package: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  packageExtension: { create: jest.fn() },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

const tariff = (over: Record<string, unknown> = {}) => ({
  id: 'tp',
  name: 'LEGO пакет 4',
  category: FinanceCategory.extra_classes,
  unit: TariffUnit.package,
  packageSize: 4,
  validityDays: 30,
  isActive: true,
  prices: [{ price: d('1000'), effectiveFrom: day('2026-01-01') }],
  ...over,
});

const pkgRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  childId: 'child-1',
  chargeId: 'c1',
  expiresAt: day('2026-10-30'),
  voidedAt: null,
  extensions: [],
  usages: [],
  ...over,
});

describe('PackagesService', () => {
  let service: PackagesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    mockPrisma.direction.findUnique.mockResolvedValue({
      id: 'd1',
      name: 'LEGO',
    });
    mockPrisma.package.findMany.mockResolvedValue([]);
    mockPrisma.charge.create.mockResolvedValue({ id: 'c-new' });
    const module = await Test.createTestingModule({
      providers: [
        PackagesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(PackagesService);
  });

  describe('purchase', () => {
    const dto = {
      directionId: 'd1',
      tariffId: 'tp',
      purchaseDate: '2026-10-01',
    };

    it('creates a charge and a package with expiry', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

      await service.purchase('child-1', dto, 'u1');

      const charge = firstArg<{
        data: Record<string, unknown> & { amount: Prisma.Decimal };
      }>(mockPrisma.charge.create);
      expect(charge.data).toMatchObject({
        childId: 'child-1',
        category: FinanceCategory.extra_classes,
        description: 'LEGO пакет 4 (LEGO), 01.10.2026',
        sourceType: ChargeSource.extra_package,
        createdById: 'u1',
      });
      expect(charge.data.amount.toFixed(2)).toBe('1000.00');
      const created = firstArg<{ data: Record<string, unknown> }>(
        mockPrisma.package.create,
      );
      expect(created.data).toMatchObject({
        childId: 'child-1',
        directionId: 'd1',
        tariffId: 'tp',
        sessionsTotal: 4,
        purchaseDate: day('2026-10-01'),
        expiresAt: day('2026-10-30'),
        chargeId: 'c-new',
        createdById: 'u1',
        id: charge.data.sourceId,
      });
    });

    it.each([
      [{ unit: TariffUnit.session }, 'Tariff unit must be package'],
      [{ isActive: false }, 'Tariff is not active'],
      [{ prices: [] }, 'No price for this date'],
    ] as [Record<string, unknown>, string][])(
      'rejects tariff %p',
      async (over, message) => {
        mockPrisma.tariff.findUnique.mockResolvedValue(tariff(over));

        await expect(service.purchase('child-1', dto, 'u1')).rejects.toThrow(
          message,
        );
        expect(mockPrisma.charge.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('extend', () => {
    it('rejects a date that is not after the current expiry', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow());

      await expect(
        service.extend(
          'p1',
          { newExpiresAt: '2026-10-30', reason: 'sick' },
          'u1',
        ),
      ).rejects.toThrow('New expiry must be after the current expiry');
    });

    it('records the previous expiry', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow());

      await service.extend(
        'p1',
        { newExpiresAt: '2026-11-15', reason: 'sick' },
        'u1',
      );

      expect(mockPrisma.packageExtension.create).toHaveBeenCalledWith({
        data: {
          packageId: 'p1',
          previousExpiresAt: day('2026-10-30'),
          newExpiresAt: day('2026-11-15'),
          reason: 'sick',
          createdById: 'u1',
        },
      });
    });
  });

  describe('void', () => {
    it('refuses to void a package with used sessions', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(
        pkgRow({ usages: [{ voidedAt: null }] }),
      );

      await expect(service.void('p1', 'mistake', 'u1')).rejects.toThrow(
        'Package has used sessions',
      );
    });

    it('voids the package and its charge', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(
        pkgRow({ usages: [{ voidedAt: new Date() }] }),
      );
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'c1',
        voidedAt: null,
      });

      await service.void('p1', 'mistake', 'u1');

      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'u1',
          voidReason: 'mistake',
        },
      });
      expect(mockPrisma.package.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'u1',
          voidReason: 'mistake',
        },
      });
    });

    it('rejects voiding twice', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(
        pkgRow({ voidedAt: new Date() }),
      );

      await expect(service.void('p1', 'x', 'u1')).rejects.toThrow(
        'Package is voided',
      );
    });
  });

  describe('reconcile', () => {
    const legacy = (over: Record<string, unknown> = {}) => ({
      id: 'p1',
      childId: 'child-1',
      needsReconciliation: true,
      direction: { name: 'Футбол' },
      legacySubscription: { totalPrice: d('1000') },
      ...over,
    });

    beforeEach(() => {
      mockPrisma.package.updateMany.mockResolvedValue({ count: 1 });
    });

    it('creates no charge for paid_full', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await service.reconcile('p1', { outcome: 'paid_full' }, 'u1');

      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
      expect(
        firstArg<{ where: Record<string, unknown> }>(
          mockPrisma.package.updateMany,
        ).where,
      ).toEqual({
        id: 'p1',
        needsReconciliation: true,
      });
    });

    it('charges the unpaid rest for paid_partial', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await service.reconcile(
        'p1',
        { outcome: 'paid_partial', paidAmount: '400', note: 'зошит' },
        'u1',
      );

      const charge = firstArg<{
        data: Record<string, unknown> & { amount: Prisma.Decimal };
      }>(mockPrisma.charge.create);
      expect(charge.data).toMatchObject({
        childId: 'child-1',
        category: FinanceCategory.extra_classes,
        description: 'Початковий залишок (звірка): Футбол',
        sourceType: ChargeSource.opening_balance,
        sourceId: 'p1',
        createdById: 'u1',
      });
      expect(charge.data.amount.toFixed(2)).toBe('600.00');
    });

    it('charges the full price for not_paid', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await service.reconcile('p1', { outcome: 'not_paid' }, 'u1');

      const charge = firstArg<{ data: { amount: Prisma.Decimal } }>(
        mockPrisma.charge.create,
      );
      expect(charge.data.amount.toFixed(2)).toBe('1000.00');
    });

    it.each(['0', '1000', undefined])(
      'rejects paid amount %p',
      async (paidAmount) => {
        mockPrisma.package.findUnique.mockResolvedValue(legacy());

        await expect(
          service.reconcile(
            'p1',
            { outcome: 'paid_partial', paidAmount },
            'u1',
          ),
        ).rejects.toThrow('Invalid paid amount');
      },
    );

    it('rejects a package that does not need reconciliation', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(
        legacy({ needsReconciliation: false }),
      );

      await expect(
        service.reconcile('p1', { outcome: 'paid_full' }, 'u1'),
      ).rejects.toThrow('Package does not need reconciliation');
    });

    it('rejects a voided package', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(
        legacy({ voidedAt: new Date() }),
      );

      await expect(
        service.reconcile('p1', { outcome: 'paid_full' }, 'u1'),
      ).rejects.toThrow('Package is voided');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a concurrent second reconciliation', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());
      mockPrisma.package.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reconcile('p1', { outcome: 'not_paid' }, 'u1'),
      ).rejects.toThrow('Package does not need reconciliation');
    });
  });
});
