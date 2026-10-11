import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  BillingMode,
  FinanceCategory,
  Prisma,
  TariffUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TariffsService } from './tariffs.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  tariff: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  tariffPrice: {
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  enrollment: { count: jest.fn() },
  adaptationVisit: { count: jest.fn() },
  package: { count: jest.fn() },
  classGroup: { count: jest.fn() },
  $transaction: jest.fn(),
};

const tariff = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Садочок повний день',
  category: FinanceCategory.tuition,
  unit: TariffUnit.month,
  packageSize: null,
  validityDays: null,
  billingMode: BillingMode.calendar_full,
  isActive: true,
  prices: [
    { id: 'p2', price: d('16500'), effectiveFrom: day('2027-01-01') },
    { id: 'p1', price: d('15500'), effectiveFrom: day('2026-09-01') },
  ],
  ...over,
});

const dto = {
  name: 'Садочок повний день',
  category: FinanceCategory.tuition,
  unit: TariffUnit.month,
  billingMode: BillingMode.calendar_full,
  price: '15500.00',
  effectiveFrom: '2026-09-01',
};

describe('TariffsService', () => {
  let service: TariffsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) =>
      Promise.all(ops),
    );
    const module = await Test.createTestingModule({
      providers: [
        TariffsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(TariffsService);
  });

  it('lists tariffs with the price effective today', async () => {
    mockPrisma.tariff.findMany.mockResolvedValue([tariff()]);

    const [view] = await service.list(day('2026-10-11'));

    expect(view.currentPrice).toBe('15500.00');
    expect(view.prices.map((p) => p.price)).toEqual(['16500.00', '15500.00']);
  });

  describe('create', () => {
    it('creates a tariff with its first price', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(null);
      mockPrisma.tariff.create.mockResolvedValue(
        tariff({ prices: [tariff().prices[1]] }),
      );

      const view = await service.create(dto, 'u1');

      expect(view.name).toBe('Садочок повний день');
      expect(mockPrisma.tariff.create).toHaveBeenCalledWith({
        data: {
          name: 'Садочок повний день',
          category: FinanceCategory.tuition,
          unit: TariffUnit.month,
          packageSize: null,
          validityDays: null,
          billingMode: BillingMode.calendar_full,
          prices: {
            create: {
              price: '15500.00',
              effectiveFrom: day('2026-09-01'),
              createdById: 'u1',
            },
          },
        },
        include: { prices: { orderBy: { effectiveFrom: 'desc' } } },
      });
    });

    it('requires a package size for package tariffs', async () => {
      await expect(
        service.create({ ...dto, unit: TariffUnit.package }, 'u1'),
      ).rejects.toThrow('Package size is required for package tariffs');
    });

    it('rejects a duplicate name', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

      await expect(service.create(dto, 'u1')).rejects.toThrow(
        'Tariff with this name already exists',
      );
    });

    it('rejects a zero price', async () => {
      await expect(
        service.create({ ...dto, price: '0.00' }, 'u1'),
      ).rejects.toThrow('Amount must be greater than 0');
    });
  });

  describe('addPrice', () => {
    it('rejects a second price on the same date', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.tariffPrice.findUnique.mockResolvedValue({ id: 'p1' });

      await expect(
        service.addPrice(
          't1',
          { price: '17000.00', effectiveFrom: '2026-09-01' },
          'u1',
        ),
      ).rejects.toThrow('Price for this date already exists');
    });

    it('adds a dated price', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.tariffPrice.findUnique.mockResolvedValue(null);

      await service.addPrice(
        't1',
        { price: '17000.00', effectiveFrom: '2027-09-01' },
        'u1',
      );

      expect(mockPrisma.tariffPrice.create).toHaveBeenCalledWith({
        data: {
          tariffId: 't1',
          price: '17000.00',
          effectiveFrom: day('2027-09-01'),
          createdById: 'u1',
        },
      });
    });
  });

  describe('update', () => {
    it('refuses to change billing mode when enrollments exist', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(2);

      await expect(
        service.update('t1', { billingMode: BillingMode.anniversary }),
      ).rejects.toThrow('Cannot change billing mode: tariff has enrollments');
      expect(mockPrisma.tariff.update).not.toHaveBeenCalled();
    });

    it('changes billing mode when there are no enrollments', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.tariff.update.mockResolvedValue(
        tariff({ billingMode: BillingMode.anniversary }),
      );

      await service.update('t1', { billingMode: BillingMode.anniversary });

      expect(mockPrisma.tariff.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('refuses to delete a tariff in use', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(1);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);

      await expect(service.delete('t1')).rejects.toThrow(
        'Cannot delete: tariff is in use',
      );
      expect(mockPrisma.tariff.delete).not.toHaveBeenCalled();
    });

    it('deletes an unused tariff with its prices', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);

      await expect(service.delete('t1')).resolves.toEqual({
        message: 'Tariff deleted',
      });
      expect(mockPrisma.tariffPrice.deleteMany).toHaveBeenCalledWith({
        where: { tariffId: 't1' },
      });
      expect(mockPrisma.tariff.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
    });

    it('throws NotFoundException for an unknown tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
