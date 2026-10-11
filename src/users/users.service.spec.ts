// src/users/users.service.spec.ts
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  charge: { count: jest.fn() },
  payment: { count: jest.fn() },
  allocation: { count: jest.fn() },
  tariffPrice: { count: jest.fn() },
  enrollment: { count: jest.fn() },
  enrollmentAdjustment: { count: jest.fn() },
  adaptationVisit: { count: jest.fn() },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('create', () => {
    it('throws ForbiddenException when admin tries to create root', async () => {
      await expect(
        service.create(
          { login: 'x', password: 'pass123', role: Role.root },
          Role.admin,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when login already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create(
          { login: 'taken', password: 'pass123', role: Role.teacher },
          Role.admin,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user and returns without password and refreshToken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        login: 'newuser',
        role: Role.teacher,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: 'hashed',
        refreshToken: null,
      });
      const result = await service.create(
        { login: 'newuser', password: 'pass123', role: Role.teacher },
        Role.admin,
      );
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).toHaveProperty('id', 'new-id');
    });

    it('allows root to create any role including root', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'id2',
        login: 'root2',
        role: Role.root,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: 'hashed',
        refreshToken: null,
      });
      await expect(
        service.create(
          { login: 'root2', password: 'pass123', role: Role.root },
          Role.root,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: Role.admin,
      });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.allocation.count.mockResolvedValue(0);
      mockPrisma.tariffPrice.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollmentAdjustment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
    });

    it('deletes a user without financial records', async () => {
      mockPrisma.user.delete.mockResolvedValue({});

      const result = await service.delete('u1');

      expect(result).toEqual({ message: 'User deleted' });
      expect(mockPrisma.charge.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { voidedById: 'u1' }] },
      });
    });

    it('throws BadRequestException when user has financial records', async () => {
      mockPrisma.allocation.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user created tariff records', async () => {
      mockPrisma.enrollmentAdjustment.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
  });
});
