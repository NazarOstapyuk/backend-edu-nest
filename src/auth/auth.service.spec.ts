// src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = {
  signAsync: jest.fn().mockResolvedValue('signed-token'),
  verify: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_SECRET: 'secret',
      JWT_ACCESS_EXPIRES: '15m',
      JWT_REFRESH_EXPIRES: '30d',
    };
    return map[key];
  }),
};

const mockRes = {
  cookie: jest.fn(),
  clearCookie: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('x', 'y', mockRes as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: 'hash',
        isActive: false,
        role: 'admin',
      });
      await expect(service.login('x', 'pass', mockRes as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when password does not match', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      await expect(service.login('x', 'wrong', mockRes as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('sets two cookies on successful login', async () => {
      const hashed = await bcrypt.hash('pass', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      mockPrisma.user.update.mockResolvedValue({});
      await service.login('x', 'pass', mockRes as any);
      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'accessToken',
        expect.any(String),
        expect.any(Object),
      );
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('logout', () => {
    it('clears refreshToken in DB and clears both cookies', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await service.logout('uid', mockRes as any);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uid' },
        data: { refreshToken: null },
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'accessToken',
        expect.any(Object),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.any(Object),
      );
    });
  });

  describe('changePassword', () => {
    let stored: Record<string, unknown>;

    beforeAll(async () => {
      stored = {
        id: 'u1',
        role: 'parent',
        password: await bcrypt.hash('oldpass1', 4),
        mustChangePassword: true,
      };
    });

    it('rejects a wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);

      await expect(
        service.changePassword(
          'u1',
          { currentPassword: 'x', newPassword: 'newpass12' },
          mockRes as unknown as Response,
        ),
      ).rejects.toThrow('Invalid current password');
    });

    it('rejects the same password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);

      await expect(
        service.changePassword(
          'u1',
          { currentPassword: 'oldpass1', newPassword: 'oldpass1' },
          mockRes as unknown as Response,
        ),
      ).rejects.toThrow('New password must differ from the current one');
    });

    it('stores the new password, clears the flag and issues fresh cookies', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);

      const result = await service.changePassword(
        'u1',
        { currentPassword: 'oldpass1', newPassword: 'newpass12' },
        mockRes as unknown as Response,
      );

      expect(result).toEqual({ message: 'Password changed' });
      const firstUpdate = (
        mockPrisma.user.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(firstUpdate).toMatchObject({
        mustChangePassword: false,
        refreshToken: null,
      });
      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProfile', () => {
    it('gives root every permission at edit level', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'r1',
        role: 'root',
        accessScope: 'all',
        permissions: [],
      });

      const profile = await service.getProfile('r1');

      expect(profile.permissions.payroll).toBe('edit');
      expect(profile.permissions.settings).toBe('edit');
    });

    it('maps admin permission rows to an object', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'a1',
        role: 'admin',
        accessScope: 'kindergarten',
        permissions: [
          { area: 'finance', level: 'view' },
          { area: 'children', level: 'edit' },
        ],
      });

      const profile = await service.getProfile('a1');

      expect(profile.permissions).toEqual({
        finance: 'view',
        children: 'edit',
      });
      expect(profile.accessScope).toBe('kindergarten');
    });
  });

  describe('updateContacts', () => {
    it('refuses to clear a parent phone', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'parent',
        phone: '+380671234567',
      });

      await expect(
        service.updateContacts('u1', { phone: null }),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('updates phone and email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'parent',
        phone: '+380671234567',
        permissions: [],
      });
      mockPrisma.user.update.mockResolvedValue({});

      await service.updateContacts('u1', {
        phone: '+380501112233',
        email: null,
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { phone: '+380501112233', email: null },
      });
    });
  });
});
