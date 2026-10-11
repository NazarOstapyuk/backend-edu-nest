import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  AdjustmentType,
  BillingMode,
  ChargeSource,
  FinanceCategory,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  enrollment: { findUnique: jest.fn(), findMany: jest.fn() },
  billedPeriod: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const enrollment = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  childId: 'child-1',
  tariffId: 't1',
  startDate: day('2026-10-15'),
  endDate: null,
  billingMode: null,
  note: null,
  tariff: {
    id: 't1',
    name: 'Садочок',
    category: FinanceCategory.tuition,
    billingMode: BillingMode.anniversary,
    prices: [{ price: d('15500'), effectiveFrom: day('2026-01-01') }],
  },
  adjustments: [],
  billedPeriods: [],
  child: { id: 'child-1', firstName: 'Ivan', lastName: 'Petrenko' },
  ...over,
});

type CallArg = { data: { amount: Prisma.Decimal } & Record<string, unknown> };
const firstArg = (fn: jest.Mock): CallArg =>
  (fn.mock.calls as CallArg[][])[0][0];

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    mockPrisma.charge.create.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ id: 'new-charge', ...data }),
    );
    const module = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(BillingService);
  });

  describe('lead days', () => {
    it('defaults to 5', async () => {
      await expect(service.getLeadDays()).resolves.toBe(5);
    });

    it('validates the range', async () => {
      await expect(service.setLeadDays(61)).rejects.toThrow(
        'Lead days must be between 0 and 60',
      );
      await expect(service.setLeadDays(1.5)).rejects.toThrow(
        'Lead days must be between 0 and 60',
      );
    });

    it('stores a valid value', async () => {
      await expect(service.setLeadDays(7)).resolves.toEqual({
        chargeLeadDays: 7,
      });
      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'chargeLeadDays' },
        create: { key: 'chargeLeadDays', value: '7' },
        update: { value: '7' },
      });
    });
  });

  describe('billEnrollment', () => {
    it('creates a charge and a billed period for each due period', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment());

      const result = await service.billEnrollment(
        'e1',
        'u1',
        day('2026-11-10'),
      );

      expect(result).toMatchObject({
        created: 2,
        skippedZero: 0,
        alreadyBilled: 0,
        problems: [],
        failed: [],
      });
      const firstCharge = firstArg(mockPrisma.charge.create).data;
      expect(firstCharge).toMatchObject({
        childId: 'child-1',
        category: FinanceCategory.tuition,
        description: 'Садочок, 15.10.2026–14.11.2026: 15500.00',
        periodStart: day('2026-10-15'),
        periodEnd: day('2026-11-14'),
        sourceType: ChargeSource.monthly,
        sourceId: 'e1',
        createdById: 'u1',
      });
      expect(firstCharge.amount.toFixed(2)).toBe('15500.00');
      expect(firstArg(mockPrisma.billedPeriod.create).data).toMatchObject({
        enrollmentId: 'e1',
        periodStart: day('2026-10-15'),
        periodEnd: day('2026-11-14'),
        chargeId: 'new-charge',
        note: null,
      });
    });

    it('skips periods that are already billed', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        enrollment({
          billedPeriods: [
            {
              periodStart: day('2026-10-15'),
              periodEnd: day('2026-11-14'),
              charge: null,
            },
          ],
        }),
      );

      const result = await service.billEnrollment(
        'e1',
        'u1',
        day('2026-11-10'),
      );

      expect(result.created).toBe(1);
      expect(mockPrisma.charge.create).toHaveBeenCalledTimes(1);
    });

    it('treats a concurrent duplicate as already billed', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(enrollment());
      mockPrisma.billedPeriod.create.mockRejectedValueOnce(uniqueViolation());

      const result = await service.billEnrollment(
        'e1',
        'u1',
        day('2026-11-10'),
      );

      expect(result).toMatchObject({ created: 1, alreadyBilled: 1 });
    });

    it('stores a zero period without a charge', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        enrollment({
          adjustments: [
            {
              type: AdjustmentType.pause,
              value: null,
              startDate: day('2026-10-15'),
              endDate: day('2026-11-14'),
              voidedAt: null,
            },
          ],
        }),
      );

      const result = await service.billEnrollment(
        'e1',
        'u1',
        day('2026-10-20'),
      );

      expect(result).toMatchObject({ created: 0, skippedZero: 1 });
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
      expect(firstArg(mockPrisma.billedPeriod.create).data).toMatchObject({
        chargeId: null,
        note: 'pause',
      });
    });

    it('reports periods without a price', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(
        enrollment({
          tariff: {
            ...enrollment().tariff,
            prices: [{ price: d('15500'), effectiveFrom: day('2027-01-01') }],
          },
        }),
      );

      const result = await service.billEnrollment(
        'e1',
        'u1',
        day('2026-10-20'),
      );

      expect(result.problems).toEqual([
        {
          enrollmentId: 'e1',
          childId: 'child-1',
          childName: 'Petrenko Ivan',
          tariffName: 'Садочок',
          periodStart: day('2026-10-15'),
          reason: 'no_price',
        },
      ]);
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown enrollment', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(service.billEnrollment('missing', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('runAll', () => {
    it('continues after one enrollment fails', async () => {
      mockPrisma.enrollment.findMany.mockResolvedValue([
        enrollment(),
        enrollment({ id: 'e2' }),
      ]);
      mockPrisma.charge.create
        .mockImplementationOnce(({ data }: { data: object }) =>
          Promise.resolve({ id: 'c-a', ...data }),
        )
        .mockImplementationOnce(({ data }: { data: object }) =>
          Promise.resolve({ id: 'c-b', ...data }),
        )
        .mockRejectedValueOnce(new Error('db down'));

      const result = await service.runAll('u1', day('2026-11-10'));

      expect(result.created).toBe(2);
      expect(result.failed).toEqual([
        { enrollmentId: 'e2', message: 'db down' },
      ]);
    });
  });

  describe('recalculate', () => {
    const billed = (over: Record<string, unknown> = {}) => ({
      id: 'bp1',
      enrollmentId: 'e1',
      periodStart: day('2026-10-15'),
      periodEnd: day('2026-11-14'),
      chargeId: 'old-charge',
      enrollment: enrollment({
        adjustments: [
          {
            type: AdjustmentType.discount_percent,
            value: d('10'),
            startDate: day('2026-10-01'),
            endDate: null,
            voidedAt: null,
          },
        ],
      }),
      ...over,
    });

    it('voids the old charge and creates a new one with current conditions', async () => {
      mockPrisma.billedPeriod.findUnique.mockResolvedValue(billed());
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'old-charge',
        voidedAt: null,
      });

      await expect(
        service.recalculate('bp1', 'discount added', 'u1'),
      ).resolves.toEqual({
        childId: 'child-1',
      });

      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'old-charge' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'u1',
          voidReason: 'discount added',
        },
      });
      expect(firstArg(mockPrisma.charge.create).data.amount.toFixed(2)).toBe(
        '13950.00',
      );
      expect(firstArg(mockPrisma.billedPeriod.update)).toMatchObject({
        where: { id: 'bp1' },
        data: { chargeId: 'new-charge', note: null },
      });
    });

    it('does not fail when the old charge was already voided in Finance', async () => {
      mockPrisma.billedPeriod.findUnique.mockResolvedValue(billed());
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'old-charge',
        voidedAt: new Date(),
      });

      await service.recalculate('bp1', 'redo', 'u1');

      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockPrisma.charge.create).toHaveBeenCalledTimes(1);
    });

    it('zeroes a period that now lies after the end date', async () => {
      mockPrisma.billedPeriod.findUnique.mockResolvedValue(
        billed({
          periodStart: day('2026-11-15'),
          periodEnd: day('2026-12-14'),
          enrollment: enrollment({ endDate: day('2026-11-10') }),
        }),
      );
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'old-charge',
        voidedAt: null,
      });

      await service.recalculate('bp1', 'ended', 'u1');

      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
      expect(firstArg(mockPrisma.billedPeriod.update).data).toMatchObject({
        chargeId: null,
        note: 'after end date',
      });
    });

    it('throws NotFoundException for an unknown billed period', async () => {
      mockPrisma.billedPeriod.findUnique.mockResolvedValue(null);

      await expect(service.recalculate('missing', 'x', 'u1')).rejects.toThrow(
        'Billed period not found',
      );
    });
  });
});
