import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FinanceCategory, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from './finance.service';

const d = (value: string) => new Prisma.Decimal(value);
const child = { id: 'child-1', firstName: 'Ivan', lastName: 'Petrenko' };

const mockPrisma = {
  child: { findUnique: jest.fn(), findMany: jest.fn() },
  charge: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
};

const balanceChild = (
  id: string,
  chargeAmount: string,
  paymentAmount: string,
) => ({
  id,
  firstName: id,
  lastName: id,
  charges: [
    {
      id: `${id}-c`,
      category: FinanceCategory.tuition,
      amount: d(chargeAmount),
      description: 'October',
      periodStart: null,
      createdAt: new Date(),
      voidedAt: null,
      allocations: [],
    },
  ],
  payments: [
    {
      amount: d(paymentAmount),
      category: null,
      status: PaymentStatus.confirmed,
      voidedAt: null,
      allocations: [],
    },
  ],
});

describe('FinanceService', () => {
  let service: FinanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.charge.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(FinanceService);
  });

  describe('getChildFinance', () => {
    it('returns the child finance view', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(child);

      const result = await service.getChildFinance('child-1');

      expect(result.child).toEqual(child);
      expect(result.totals).toEqual({ totalDue: '0.00', unallocated: '0.00' });
      expect(mockPrisma.charge.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { childId: 'child-1' } }),
      );
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.getChildFinance('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getHistory', () => {
    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.getHistory('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('suggest', () => {
    it('queries open charges of the category and returns lines', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(child);
      mockPrisma.charge.findMany.mockResolvedValue([
        {
          id: 'c1',
          category: FinanceCategory.tuition,
          amount: d('100.00'),
          description: 'October',
          periodStart: null,
          createdAt: new Date(),
          voidedAt: null,
          allocations: [],
        },
      ]);

      const result = await service.suggest('child-1', {
        amount: '150.00',
        category: FinanceCategory.tuition,
      });

      expect(mockPrisma.charge.findMany).toHaveBeenCalledWith({
        where: {
          childId: 'child-1',
          voidedAt: null,
          category: FinanceCategory.tuition,
        },
        include: { allocations: { where: { voidedAt: null } } },
      });
      expect(result.lines[0]).toMatchObject({
        chargeId: 'c1',
        suggestedAmount: '100.00',
      });
      expect(result.leftover).toBe('50.00');
    });

    it('rejects zero amount', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(child);

      await expect(
        service.suggest('child-1', { amount: '0.00' }),
      ).rejects.toThrow('Amount must be greater than 0');
    });
  });

  describe('getBalances', () => {
    beforeEach(() => {
      mockPrisma.child.findMany.mockResolvedValue([
        balanceChild('debtor', '100.00', '0.00'),
        balanceChild('payer', '100.00', '300.00'),
      ]);
    });

    it('returns a row per child ordered by name', async () => {
      const rows = await service.getBalances({});

      expect(rows.map((r) => r.childId)).toEqual(['debtor', 'payer']);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
      );
    });

    it('filters children with debt', async () => {
      const rows = await service.getBalances({ hasDebt: 'true' });

      expect(rows.map((r) => r.childId)).toEqual(['debtor', 'payer']);
    });

    it('filters children with unallocated money', async () => {
      const rows = await service.getBalances({ hasUnallocated: 'true' });

      expect(rows.map((r) => r.childId)).toEqual(['payer']);
    });
  });
});
