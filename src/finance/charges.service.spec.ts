import { AccessScope, PermissionLevel, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChargeSource, FinanceCategory, GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChargesService } from './charges.service';

const mockPrisma = {
  child: { findUnique: jest.fn(), findFirst: jest.fn() },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

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

describe('ChargesService', () => {
  let service: ChargesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    const module = await Test.createTestingModule({
      providers: [
        ChargesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ChargesService);
  });

  describe('create', () => {
    const dto = {
      category: FinanceCategory.tuition,
      amount: '15500.00',
      description: 'October',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    };

    it('creates a manual charge', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.create.mockResolvedValue({
        id: 'c1',
        childId: 'child-1',
      });

      const result = await service.create('child-1', dto, 'u1', fullAdmin);

      expect(result).toEqual({ id: 'c1', childId: 'child-1' });
      expect(mockPrisma.charge.create).toHaveBeenCalledWith({
        data: {
          childId: 'child-1',
          category: FinanceCategory.tuition,
          amount: '15500.00',
          description: 'October',
          periodStart: new Date('2026-10-01'),
          periodEnd: new Date('2026-10-31'),
          sourceType: ChargeSource.manual,
          createdById: 'u1',
        },
      });
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(
        service.create('missing', dto, 'u1', fullAdmin),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    });

    it('rejects zero amount', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await expect(
        service.create('child-1', { ...dto, amount: '0.00' }, 'u1', fullAdmin),
      ).rejects.toThrow('Amount must be greater than 0');
    });

    it('rejects period end before period start', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await expect(
        service.create(
          'child-1',
          { ...dto, periodEnd: '2026-09-30' },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Period end must not be before period start');
    });
  });

  describe('void', () => {
    it('locks the row, voids active allocations and the charge', async () => {
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'c1',
        voidedAt: null,
      });
      mockPrisma.charge.update.mockResolvedValue({
        id: 'c1',
        childId: 'child-1',
      });

      const result = await service.void('c1', 'duplicate', 'u1', fullAdmin);

      expect(result).toEqual({ id: 'c1', childId: 'child-1' });
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.charge.findUnique.mock.invocationCallOrder[0],
      );
      const data = {
        voidedAt: expect.any(Date) as Date,
        voidedById: 'u1',
        voidReason: 'duplicate',
      };
      expect(mockPrisma.allocation.updateMany).toHaveBeenCalledWith({
        where: { chargeId: 'c1', voidedAt: null },
        data,
      });
      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data,
      });
    });

    it('throws NotFoundException when charge does not exist', async () => {
      mockPrisma.charge.findUnique.mockResolvedValue(null);

      await expect(
        service.void('missing', 'x', 'u1', fullAdmin),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already voided', async () => {
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'c1',
        voidedAt: new Date(),
      });

      await expect(service.void('c1', 'x', 'u1', fullAdmin)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
    });
  });

  describe('scope', () => {
    it('hides the child on create', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.create(
          'child-1',
          {
            category: FinanceCategory.tuition,
            amount: '10.00',
            description: 'x',
          },
          'kg1',
          kgAccountant,
        ),
      ).rejects.toThrow('Child not found');
      expect(mockPrisma.child.findFirst).toHaveBeenCalledWith({
        where: { id: 'child-1', group: { kind: GroupKind.kindergarten } },
        select: { id: true },
      });
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    });

    it('hides an out-of-scope charge on void', async () => {
      mockPrisma.charge.findUnique.mockResolvedValue({ childId: 'child-1' });
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.void('c1', 'x', 'kg1', kgAccountant),
      ).rejects.toThrow('Charge not found');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
    });

    it('skips the extra lookups without a scope', async () => {
      mockPrisma.charge.findUnique.mockResolvedValue(null);
      await expect(service.void('c1', 'x', 'u1', fullAdmin)).rejects.toThrow(
        'Charge not found',
      );
      expect(mockPrisma.child.findFirst).not.toHaveBeenCalled();
    });
  });
});
