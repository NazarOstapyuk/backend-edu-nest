import { Test } from '@nestjs/testing';
import {
  BillingMode,
  ChargeSource,
  FinanceCategory,
  Prisma,
  TariffUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdaptationService } from './adaptation.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  child: { findUnique: jest.fn() },
  tariff: { findUnique: jest.fn() },
  adaptationVisit: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const tariff = (over: Record<string, unknown> = {}) => ({
  id: 't-ad',
  name: 'Адаптація',
  category: FinanceCategory.adaptation,
  unit: TariffUnit.hour,
  billingMode: BillingMode.calendar_full,
  isActive: true,
  prices: [{ price: d('200'), effectiveFrom: day('2026-01-01') }],
  ...over,
});

type CallArg = {
  data: { amount: Prisma.Decimal; ratePerHour: Prisma.Decimal } & Record<
    string,
    unknown
  >;
};
const firstArg = (fn: jest.Mock): CallArg =>
  (fn.mock.calls as CallArg[][])[0][0];

const dto = { tariffId: 't-ad', date: '2026-10-12', hours: '3' };

describe('AdaptationService', () => {
  let service: AdaptationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    mockPrisma.adaptationVisit.findMany.mockResolvedValue([]);
    mockPrisma.charge.create.mockResolvedValue({ id: 'c-ad' });
    const module = await Test.createTestingModule({
      providers: [
        AdaptationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AdaptationService);
  });

  it('charges hours times the tariff rate on that date', async () => {
    mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

    await service.create('child-1', dto, 'u1');

    const chargeData = firstArg(mockPrisma.charge.create).data;
    expect(chargeData).toMatchObject({
      childId: 'child-1',
      category: FinanceCategory.adaptation,
      description: 'Адаптація, 12.10.2026: 3.00 год × 200.00',
      periodStart: day('2026-10-12'),
      periodEnd: day('2026-10-12'),
      sourceType: ChargeSource.adaptation,
      createdById: 'u1',
    });
    expect(chargeData.amount.toFixed(2)).toBe('600.00');
    const visitData = firstArg(mockPrisma.adaptationVisit.create).data;
    expect(visitData).toMatchObject({
      childId: 'child-1',
      tariffId: 't-ad',
      chargeId: 'c-ad',
      id: chargeData.sourceId,
    });
    expect(visitData.ratePerHour.toFixed(2)).toBe('200.00');
  });

  it('uses an explicit rate when given', async () => {
    mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

    await service.create(
      'child-1',
      { ...dto, hours: '1.5', ratePerHour: '250' },
      'u1',
    );

    expect(firstArg(mockPrisma.charge.create).data.amount.toFixed(2)).toBe(
      '375.00',
    );
  });

  const rejections: [Record<string, unknown>, typeof dto, string][] = [
    [{ unit: TariffUnit.month }, dto, 'Tariff unit must be hour'],
    [{ isActive: false }, dto, 'Tariff is not active'],
    [{}, { ...dto, hours: '0' }, 'Invalid hours'],
    [{}, { ...dto, hours: '25' }, 'Invalid hours'],
    [{ prices: [] }, dto, 'No price for this date'],
  ];

  it.each(rejections)(
    'rejects tariff %p with dto %p',
    async (over, body, message) => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff(over));

      await expect(service.create('child-1', body, 'u1')).rejects.toThrow(
        message,
      );
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    },
  );

  it('voids the visit and its charge', async () => {
    mockPrisma.adaptationVisit.findUnique.mockResolvedValue({
      id: 'v1',
      childId: 'child-1',
      chargeId: 'c-ad',
      voidedAt: null,
    });
    mockPrisma.charge.findUnique.mockResolvedValue({
      id: 'c-ad',
      voidedAt: null,
    });

    await service.void('v1', 'wrong day', 'u1');

    expect(mockPrisma.charge.update).toHaveBeenCalledWith({
      where: { id: 'c-ad' },
      data: {
        voidedAt: expect.any(Date) as Date,
        voidedById: 'u1',
        voidReason: 'wrong day',
      },
    });
    expect(mockPrisma.adaptationVisit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: {
        voidedAt: expect.any(Date) as Date,
        voidedById: 'u1',
        voidReason: 'wrong day',
      },
    });
  });

  it('voids the visit even if its charge was voided in Finance', async () => {
    mockPrisma.adaptationVisit.findUnique.mockResolvedValue({
      id: 'v1',
      childId: 'child-1',
      chargeId: 'c-ad',
      voidedAt: null,
    });
    mockPrisma.charge.findUnique.mockResolvedValue({
      id: 'c-ad',
      voidedAt: new Date(),
    });

    await service.void('v1', 'x', 'u1');

    expect(mockPrisma.charge.update).not.toHaveBeenCalled();
    expect(mockPrisma.adaptationVisit.update).toHaveBeenCalled();
  });

  it('rejects voiding twice', async () => {
    mockPrisma.adaptationVisit.findUnique.mockResolvedValue({
      id: 'v1',
      childId: 'child-1',
      chargeId: 'c-ad',
      voidedAt: new Date(),
    });

    await expect(service.void('v1', 'x', 'u1')).rejects.toThrow(
      'Adaptation visit is voided',
    );
  });
});
