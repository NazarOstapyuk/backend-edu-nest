import { AccessScope, PermissionLevel, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { Test } from '@nestjs/testing';
import {
  AdjustmentType,
  BillingMode,
  FinanceCategory,
  Prisma,
  TariffUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnrollmentsService } from './enrollments.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  child: { findUnique: jest.fn(), findFirst: jest.fn() },
  tariff: { findUnique: jest.fn() },
  enrollment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  enrollmentAdjustment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const tariff = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Садочок',
  category: FinanceCategory.tuition,
  unit: TariffUnit.month,
  billingMode: BillingMode.anniversary,
  isActive: true,
  prices: [{ price: d('15500'), effectiveFrom: day('2026-01-01') }],
  ...over,
});

const loaded = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  childId: 'child-1',
  tariffId: 't1',
  startDate: day('2026-10-15'),
  endDate: null,
  billingMode: null,
  note: null,
  tariff: tariff(),
  adjustments: [],
  billedPeriods: [],
  child: { id: 'child-1', firstName: 'Ivan', lastName: 'Petrenko' },
  ...over,
});

const fullAdmin: AuthenticatedUser = {
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: { finance: PermissionLevel.edit, tariffs: PermissionLevel.edit },
};

const kgAccountant: AuthenticatedUser = {
  id: 'kg1',
  role: Role.admin,
  login: 'kg',
  mustChangePassword: false,
  accessScope: AccessScope.kindergarten,
  permissions: { finance: PermissionLevel.edit, tariffs: PermissionLevel.edit },
};

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    mockPrisma.enrollment.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(EnrollmentsService);
  });

  it('lists enrollments with the next period preview', async () => {
    mockPrisma.enrollment.findMany.mockResolvedValue([loaded()]);

    const [view] = await service.listForChild(
      'child-1',
      fullAdmin,
      day('2026-10-11'),
    );

    expect(view.effectiveBillingMode).toBe(BillingMode.anniversary);
    expect(view.nextPeriod).toMatchObject({
      amount: '15500.00',
      problem: null,
    });
  });

  describe('create', () => {
    const dto = { tariffId: 't1', startDate: '2026-10-15' };

    it('creates an enrollment', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

      await service.create('child-1', dto, 'u1', fullAdmin);

      expect(mockPrisma.enrollment.create).toHaveBeenCalledWith({
        data: {
          childId: 'child-1',
          tariffId: 't1',
          startDate: day('2026-10-15'),
          endDate: null,
          billingMode: null,
          note: undefined,
          createdById: 'u1',
        },
      });
    });

    const tariffRejections: [Record<string, unknown>, string][] = [
      [{ isActive: false }, 'Tariff is not active'],
      [{ unit: TariffUnit.hour }, 'Tariff unit must be month'],
      [
        { prices: [{ price: d('15500'), effectiveFrom: day('2027-01-01') }] },
        'No price for this date',
      ],
    ];

    it.each(tariffRejections)('rejects tariff %p', async (over, message) => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff(over));

      await expect(
        service.create('child-1', dto, 'u1', fullAdmin),
      ).rejects.toThrow(message);
    });

    it('rejects an end date before the start date', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

      await expect(
        service.create(
          'child-1',
          { ...dto, endDate: '2026-10-01' },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('End date must not be before start date');
    });

    it('rejects an overlapping enrollment on the same tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.findMany.mockResolvedValueOnce([
        { startDate: day('2026-09-01'), endDate: null },
      ]);

      await expect(
        service.create('child-1', dto, 'u1', fullAdmin),
      ).rejects.toThrow(
        'Enrollment overlaps an existing enrollment on this tariff',
      );
    });

    it('rejects an unknown child', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(
        service.create('missing', dto, 'u1', fullAdmin),
      ).rejects.toThrow('Child not found');
    });
  });

  describe('adjustments', () => {
    beforeEach(() => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(loaded());
      mockPrisma.enrollmentAdjustment.findMany.mockResolvedValue([]);
    });

    const invalidValues: [AdjustmentType, string | undefined][] = [
      [AdjustmentType.discount_percent, '101'],
      [AdjustmentType.discount_percent, undefined],
      [AdjustmentType.custom_price, '0'],
      [AdjustmentType.discount_amount, undefined],
      [AdjustmentType.pause, '10'],
    ];

    it.each(invalidValues)('rejects %s with value %p', async (type, value) => {
      await expect(
        service.addAdjustment(
          'e1',
          { type, value, startDate: '2026-11-01', reason: 'x' },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Invalid adjustment value');
    });

    it('rejects an overlapping adjustment of the same type', async () => {
      mockPrisma.enrollmentAdjustment.findMany.mockResolvedValue([
        { startDate: day('2026-11-01'), endDate: day('2026-11-30') },
      ]);

      await expect(
        service.addAdjustment(
          'e1',
          {
            type: AdjustmentType.pause,
            startDate: '2026-11-20',
            endDate: '2026-12-05',
            reason: 'sick',
          },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow(
        'Adjustment overlaps an existing adjustment of the same type',
      );
      expect(mockPrisma.enrollmentAdjustment.findMany).toHaveBeenCalledWith({
        where: {
          enrollmentId: 'e1',
          type: AdjustmentType.pause,
          voidedAt: null,
        },
      });
    });

    it('creates a valid discount', async () => {
      await service.addAdjustment(
        'e1',
        {
          type: AdjustmentType.discount_percent,
          value: '10',
          startDate: '2026-11-01',
          reason: 'second child',
        },
        'u1',
        fullAdmin,
      );

      expect(mockPrisma.enrollmentAdjustment.create).toHaveBeenCalledWith({
        data: {
          enrollmentId: 'e1',
          type: AdjustmentType.discount_percent,
          value: '10',
          startDate: day('2026-11-01'),
          endDate: null,
          reason: 'second child',
          createdById: 'u1',
        },
      });
    });

    it('rejects voiding twice', async () => {
      mockPrisma.enrollmentAdjustment.findUnique.mockResolvedValue({
        id: 'a1',
        voidedAt: new Date(),
        enrollment: { childId: 'child-1' },
      });

      await expect(
        service.voidAdjustment('a1', 'x', 'u1', fullAdmin),
      ).rejects.toThrow('Adjustment is voided');
    });
  });

  it('ends an enrollment', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue(loaded());

    await service.end('e1', { endDate: '2026-12-31' }, fullAdmin);

    expect(mockPrisma.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { endDate: day('2026-12-31') },
    });
  });

  it('rejects ending into a later enrollment on the same tariff', async () => {
    mockPrisma.enrollment.findUnique.mockResolvedValue(loaded());
    mockPrisma.enrollment.findMany.mockResolvedValueOnce([
      { startDate: day('2027-01-01'), endDate: null },
    ]);

    await expect(
      service.end('e1', { endDate: '2027-02-01' }, fullAdmin),
    ).rejects.toThrow(
      'Enrollment overlaps an existing enrollment on this tariff',
    );
    expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith({
      where: { childId: 'child-1', tariffId: 't1', id: { not: 'e1' } },
    });
    expect(mockPrisma.enrollment.update).not.toHaveBeenCalled();
  });

  describe('scope', () => {
    const row = { id: 'e1', childId: 'child-1' };

    beforeEach(() => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.child.findFirst.mockResolvedValue(null);
    });

    it('hides an out-of-scope child on list and create', async () => {
      await expect(
        service.listForChild('child-1', kgAccountant),
      ).rejects.toThrow('Child not found');
      await expect(
        service.create(
          'child-1',
          { tariffId: 't1', startDate: '2026-10-01' },
          'kg1',
          kgAccountant,
        ),
      ).rejects.toThrow('Child not found');
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('hides an out-of-scope enrollment', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(row);
      await expect(
        service.end('e1', { endDate: '2026-12-31' }, kgAccountant),
      ).rejects.toThrow('Enrollment not found');
      await expect(
        service.addAdjustment(
          'e1',
          {
            type: AdjustmentType.pause,
            startDate: '2026-10-01',
            reason: 'x',
          },
          'kg1',
          kgAccountant,
        ),
      ).rejects.toThrow('Enrollment not found');
      await expect(service.childIdOf('e1', kgAccountant)).rejects.toThrow(
        'Enrollment not found',
      );
      expect(mockPrisma.enrollment.update).not.toHaveBeenCalled();
      expect(mockPrisma.enrollmentAdjustment.create).not.toHaveBeenCalled();
    });

    it('hides an out-of-scope adjustment on void', async () => {
      mockPrisma.enrollmentAdjustment.findUnique.mockResolvedValue({
        id: 'a1',
        voidedAt: null,
        enrollment: { childId: 'child-1' },
      });
      await expect(
        service.voidAdjustment('a1', 'x', 'kg1', kgAccountant),
      ).rejects.toThrow('Adjustment not found');
      expect(mockPrisma.enrollmentAdjustment.update).not.toHaveBeenCalled();
    });
  });
});
