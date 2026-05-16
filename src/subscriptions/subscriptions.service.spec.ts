import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SubscriptionStatus } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  child: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
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
    const dto = { childId: 'child-1', subscriptionTypeId: 'type-1', totalSessions: 10 };
    const child = { id: 'child-1', firstName: 'Ivan' };
    const type = { id: 'type-1', name: 'Football', pricePerSession: 100 };

    it('creates subscription and fixes price from type at creation time', async () => {
      const created = {
        id: 'sub-1',
        childId: 'child-1',
        subscriptionTypeId: 'type-1',
        totalSessions: 10,
        remainingSessions: 10,
        pricePerSession: 100,
        totalPrice: 1000,
        status: SubscriptionStatus.active,
        child,
        subscriptionType: type,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.child.findUnique.mockResolvedValue(child);
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(type);
      mockPrisma.subscription.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrisma.subscription.create).toHaveBeenCalledWith({
        data: {
          childId: 'child-1',
          subscriptionTypeId: 'type-1',
          totalSessions: 10,
          remainingSessions: 10,
          pricePerSession: 100,
          totalPrice: 1000,
        },
        include: { child: true, subscriptionType: true },
      });
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription type does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(child);
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  describe('findByChild', () => {
    const subs = [{ id: 'sub-1', childId: 'child-1', subscriptionType: {} }];

    it('returns subscriptions for admin without ownership check', async () => {
      const admin = { id: 'user-1', role: Role.admin, login: 'admin' };
      mockPrisma.subscription.findMany.mockResolvedValue(subs);

      const result = await service.findByChild('child-1', admin);

      expect(result).toEqual(subs);
      expect(mockPrisma.child.findFirst).not.toHaveBeenCalled();
    });

    it('returns subscriptions for parent when child belongs to them', async () => {
      const parent = { id: 'parent-1', role: Role.parent, login: 'parent' };
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'child-1' });
      mockPrisma.subscription.findMany.mockResolvedValue(subs);

      const result = await service.findByChild('child-1', parent);

      expect(result).toEqual(subs);
      expect(mockPrisma.child.findFirst).toHaveBeenCalledWith({
        where: { id: 'child-1', parents: { some: { id: 'parent-1' } } },
      });
    });

    it('throws ForbiddenException when parent does not own child', async () => {
      const parent = { id: 'parent-1', role: Role.parent, login: 'parent' };
      mockPrisma.child.findFirst.mockResolvedValue(null);

      await expect(service.findByChild('child-1', parent)).rejects.toThrow(ForbiddenException);
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
      mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', status: SubscriptionStatus.finished });

      await expect(service.cancel('sub-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.cancel('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
