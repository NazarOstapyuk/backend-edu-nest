import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { AttendancesService } from './attendances.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  subscription: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  attendance: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((fn) => fn(mockPrisma)),
};

describe('AttendancesService', () => {
  let service: AttendancesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    const module = await Test.createTestingModule({
      providers: [
        AttendancesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AttendancesService);
  });

  describe('create', () => {
    it('marks attendance and decrements remainingSessions', async () => {
      const sub = { id: 'sub-1', remainingSessions: 3, status: SubscriptionStatus.active };
      const attendance = { id: 'att-1', subscriptionId: 'sub-1', date: new Date(), note: null };
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.create.mockResolvedValue(attendance);
      mockPrisma.subscription.update.mockResolvedValue({});

      const result = await service.create('sub-1', {});

      expect(result).toEqual(attendance);
      expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
        data: { subscriptionId: 'sub-1', note: undefined, date: undefined },
      });
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 2, status: SubscriptionStatus.active },
      });
    });

    it('sets status to finished when the last session is used', async () => {
      const sub = { id: 'sub-1', remainingSessions: 1, status: SubscriptionStatus.active };
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.create.mockResolvedValue({ id: 'att-1', subscriptionId: 'sub-1' });
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.create('sub-1', {});

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 0, status: SubscriptionStatus.finished },
      });
    });

    it('throws ForbiddenException when subscription is not active', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        remainingSessions: 5,
        status: SubscriptionStatus.cancelled,
      });

      await expect(service.create('sub-1', {})).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.create('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('removes attendance and increments remainingSessions', async () => {
      const attendance = { id: 'att-1', subscriptionId: 'sub-1' };
      const sub = { id: 'sub-1', remainingSessions: 2, status: SubscriptionStatus.active };
      mockPrisma.attendance.findUnique.mockResolvedValue(attendance);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.delete.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.delete('sub-1', 'att-1');

      expect(mockPrisma.attendance.delete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 3, status: SubscriptionStatus.active },
      });
    });

    it('reverts finished subscription to active when attendance is deleted', async () => {
      const attendance = { id: 'att-1', subscriptionId: 'sub-1' };
      const sub = { id: 'sub-1', remainingSessions: 0, status: SubscriptionStatus.finished };
      mockPrisma.attendance.findUnique.mockResolvedValue(attendance);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.delete.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.delete('sub-1', 'att-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 1, status: SubscriptionStatus.active },
      });
    });

    it('throws NotFoundException when attendance does not exist', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue(null);

      await expect(service.delete('sub-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when attendance belongs to a different subscription', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue({ id: 'att-1', subscriptionId: 'other-sub' });

      await expect(service.delete('sub-1', 'att-1')).rejects.toThrow(BadRequestException);
    });
  });
});
