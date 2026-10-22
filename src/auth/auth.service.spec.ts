// src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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

const mockAudit = {
  recordAuth: jest.fn().mockResolvedValue(undefined),
};

const meta = { ip: '10.0.0.1', userAgent: 'jest' };

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
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login('x', 'y', mockRes as unknown as Response, meta),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: 'hash',
        isActive: false,
        role: 'admin',
      });
      await expect(
        service.login('x', 'pass', mockRes as unknown as Response, meta),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password does not match', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      await expect(
        service.login('x', 'wrong', mockRes as unknown as Response, meta),
      ).rejects.toThrow(UnauthorizedException);
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
      await service.login('x', 'pass', mockRes as unknown as Response, meta);
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

  describe('login audit', () => {
    it('records an unknown login without a user id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login('ghost', 'y', mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid credentials');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith({
        type: 'login_failed',
        reason: 'invalid_credentials',
        userId: null,
        login: 'ghost',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
    });

    it('records a disabled account with the user id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u9',
        password: 'hash',
        isActive: false,
        role: 'admin',
      });
      await expect(
        service.login('off', 'pass', mockRes as unknown as Response, meta),
      ).rejects.toThrow('Account is disabled');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith({
        type: 'login_failed',
        reason: 'account_disabled',
        userId: 'u9',
        login: 'off',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
    });

    it('records a wrong password with the user id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u8',
        password: await bcrypt.hash('correct', 4),
        isActive: true,
        role: 'admin',
      });
      await expect(
        service.login('known', 'wrong', mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid credentials');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith({
        type: 'login_failed',
        reason: 'invalid_credentials',
        userId: 'u8',
        login: 'known',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
    });

    it('records a successful login', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u7',
        password: await bcrypt.hash('pass', 4),
        isActive: true,
        role: 'admin',
      });
      mockPrisma.user.update.mockResolvedValue({});
      await service.login('ok', 'pass', mockRes as unknown as Response, meta);
      expect(mockAudit.recordAuth).toHaveBeenCalledTimes(1);
      expect(mockAudit.recordAuth).toHaveBeenCalledWith({
        type: 'login_success',
        reason: null,
        userId: 'u7',
        login: 'ok',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
    });
  });

  describe('refresh audit', () => {
    const failed = (userId: string | null, login: string) => ({
      type: 'refresh_failed',
      reason: 'invalid_refresh',
      userId,
      login,
      ip: '10.0.0.1',
      userAgent: 'jest',
    });
    const reqWith = (token?: string) =>
      ({ cookies: token ? { refreshToken: token } : {} }) as unknown as Request;

    it('does not record a missing cookie', async () => {
      await expect(
        service.refresh(reqWith(), mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid refresh token');
      expect(mockAudit.recordAuth).not.toHaveBeenCalled();
    });

    it('records an undecodable token without a user id', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('bad');
      });
      await expect(
        service.refresh(reqWith('t'), mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid refresh token');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed(null, ''));
    });

    it('records the decoded sub when the user is missing', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'u1', role: 'admin' });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.refresh(reqWith('t'), mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid refresh token');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed('u1', ''));
    });

    it('records the login of an inactive user', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'u1', role: 'admin' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'off',
        isActive: false,
        refreshToken: 'h',
      });
      await expect(
        service.refresh(reqWith('t'), mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid refresh token');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed('u1', 'off'));
    });

    it('records a rotated token mismatch', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'u1', role: 'admin' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'on',
        isActive: true,
        refreshToken: await bcrypt.hash('other', 4),
      });
      await expect(
        service.refresh(reqWith('t'), mockRes as unknown as Response, meta),
      ).rejects.toThrow('Invalid refresh token');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed('u1', 'on'));
    });

    it('does not record a successful refresh', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'u1', role: 'admin' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'on',
        role: 'admin',
        isActive: true,
        refreshToken: await bcrypt.hash('t', 4),
      });
      mockPrisma.user.update.mockResolvedValue({});
      await service.refresh(reqWith('t'), mockRes as unknown as Response, meta);
      expect(mockAudit.recordAuth).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('clears refreshToken in DB and clears both cookies', async () => {
      mockPrisma.user.update.mockResolvedValue({ login: 'teacher1' });
      await service.logout('uid', mockRes as unknown as Response, meta);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uid' },
        data: { refreshToken: null },
        select: { login: true },
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'accessToken',
        expect.any(Object),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'refreshToken',
        expect.any(Object),
      );
      expect(mockAudit.recordAuth).toHaveBeenCalledWith({
        type: 'logout',
        reason: null,
        userId: 'uid',
        login: 'teacher1',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
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
          meta,
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
          meta,
        ),
      ).rejects.toThrow('New password must differ from the current one');
    });

    it('stores the new password, clears the flag and issues fresh cookies', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);

      const result = await service.changePassword(
        'u1',
        { currentPassword: 'oldpass1', newPassword: 'newpass12' },
        mockRes as unknown as Response,
        meta,
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

  describe('password audit', () => {
    it('records a password change', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'mom',
        role: 'parent',
        password: await bcrypt.hash('oldpass1', 4),
      });
      await service.changePassword(
        'u1',
        { currentPassword: 'oldpass1', newPassword: 'newpass12' },
        mockRes as unknown as Response,
        meta,
      );
      expect(mockAudit.recordAuth).toHaveBeenCalledWith({
        type: 'password_changed',
        reason: null,
        userId: 'u1',
        login: 'mom',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
    });

    it('records nothing for a wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'mom',
        role: 'parent',
        password: await bcrypt.hash('oldpass1', 4),
      });
      await expect(
        service.changePassword(
          'u1',
          { currentPassword: 'x', newPassword: 'newpass12' },
          mockRes as unknown as Response,
          meta,
        ),
      ).rejects.toThrow('Invalid current password');
      expect(mockAudit.recordAuth).not.toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('gives root every permission at edit level', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'r1',
        role: 'root',
        accessScope: 'all',
        permissions: [],
        institutions: [],
      });

      const profile = await service.getProfile('r1');

      expect(profile.permissions.payroll).toBe('edit');
      expect(profile.permissions.settings).toBe('edit');
    });

    it('maps admin permission rows to an object', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'a1',
        role: 'admin',
        accessScope: 'institutions',
        permissions: [
          { area: 'finance', level: 'view' },
          { area: 'children', level: 'edit' },
        ],
        institutions: [{ institutionId: 'inst-k' }],
      });

      const profile = await service.getProfile('a1');

      expect(profile.permissions).toEqual({
        finance: 'view',
        children: 'edit',
      });
      expect(profile.accessScope).toBe('institutions');
      expect(profile.institutionIds).toEqual(['inst-k']);
      expect(profile).not.toHaveProperty('institutions');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            institutions: { select: { institutionId: true } },
          }) as unknown,
        }),
      );
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
        institutions: [],
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
