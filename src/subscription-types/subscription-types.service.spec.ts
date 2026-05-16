import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionTypesService } from './subscription-types.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  subscriptionType: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
  },
};

describe('SubscriptionTypesService', () => {
  let service: SubscriptionTypesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SubscriptionTypesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SubscriptionTypesService);
  });

  describe('create', () => {
    it('creates a subscription type', async () => {
      const dto = { name: 'Football', pricePerSession: 100 };
      const created = { id: 'type-1', name: 'Football', pricePerSession: 100, isActive: true, createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);
      mockPrisma.subscriptionType.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrisma.subscriptionType.create).toHaveBeenCalledWith({
        data: { name: 'Football', pricePerSession: 100 },
      });
    });

    it('throws BadRequestException when name already exists', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create({ name: 'Football', pricePerSession: 100 }))
        .rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscriptionType.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the subscription type when found', async () => {
      const type = { id: 'type-1', name: 'Football' };
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(type);

      const result = await service.findOne('type-1');
      expect(result).toEqual(type);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates the subscription type', async () => {
      const existing = { id: 'type-1', name: 'Football', pricePerSession: 100 };
      const updated = { ...existing, pricePerSession: 120 };
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(existing);
      mockPrisma.subscriptionType.update.mockResolvedValue(updated);

      const result = await service.update('type-1', { pricePerSession: 120 });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when type does not exist', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { pricePerSession: 120 }))
        .rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscriptionType.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes type when no subscriptions exist', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Football' });
      mockPrisma.subscription.count.mockResolvedValue(0);
      mockPrisma.subscriptionType.delete.mockResolvedValue({});

      const result = await service.delete('type-1');
      expect(result).toEqual({ message: 'Subscription type deleted' });
    });

    it('throws BadRequestException when subscriptions exist for this type', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Football' });
      mockPrisma.subscription.count.mockResolvedValue(2);

      await expect(service.delete('type-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscriptionType.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when type does not exist', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
