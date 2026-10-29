import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope, Role, SubscriptionStatus } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  child: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  subscriptionType: {
    findUnique: jest.fn(),
  },
  subscription: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SubscriptionsService);
  });

  describe('create', () => {
    it('refuses creation of legacy subscriptions', async () => {
      await expect(service.create()).rejects.toThrow(
        new BadRequestException('Subscriptions are read-only'),
      );
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
      expect(mockPrisma.subscriptionType.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findByChild', () => {
    const subs = [{ id: 'sub-1', childId: 'child-1', subscriptionType: {} }];

    it('returns subscriptions for admin without ownership check', async () => {
      const admin = {
        id: 'user-1',
        role: Role.admin,
        login: 'admin',
        mustChangePassword: false,
        accessScope: AccessScope.all,
        institutionIds: [] as string[],
        scopeInstitutionIds: null as string[] | null,
        permissions: {},
      };
      mockPrisma.subscription.findMany.mockResolvedValue(subs);

      const result = await service.findByChild('child-1', admin);

      expect(result).toEqual(subs);
      expect(mockPrisma.child.findFirst).not.toHaveBeenCalled();
    });

    it('returns subscriptions for parent when child belongs to them', async () => {
      const parent = {
        id: 'parent-1',
        role: Role.parent,
        login: 'parent',
        mustChangePassword: false,
        accessScope: AccessScope.all,
        institutionIds: [] as string[],
        scopeInstitutionIds: null as string[] | null,
        permissions: {},
      };
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'child-1' });
      mockPrisma.subscription.findMany.mockResolvedValue(subs);

      const result = await service.findByChild('child-1', parent);

      expect(result).toEqual(subs);
      expect(mockPrisma.child.findFirst).toHaveBeenCalledWith({
        where: { id: 'child-1', parents: { some: { id: 'parent-1' } } },
      });
    });

    it('throws ForbiddenException when parent does not own child', async () => {
      const parent = {
        id: 'parent-1',
        role: Role.parent,
        login: 'parent',
        mustChangePassword: false,
        accessScope: AccessScope.all,
        institutionIds: [] as string[],
        scopeInstitutionIds: null as string[] | null,
        permissions: {},
      };
      mockPrisma.child.findFirst.mockResolvedValue(null);

      await expect(service.findByChild('child-1', parent)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.subscription.findMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels an active subscription', async () => {
      const sub = { id: 'sub-1', status: SubscriptionStatus.active };
      const cancelled = { ...sub, status: SubscriptionStatus.cancelled };
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.update.mockResolvedValue(cancelled);

      const result = await service.cancel('sub-1');

      expect(result.status).toBe(SubscriptionStatus.cancelled);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: SubscriptionStatus.cancelled },
      });
    });

    it('throws BadRequestException when subscription is not active', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionStatus.finished,
      });

      await expect(service.cancel('sub-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.cancel('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
