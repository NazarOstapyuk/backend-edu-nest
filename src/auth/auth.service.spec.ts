// src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { AuthService, hashToken, sessionTokenState } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Session = {
  id: string;
  userId: string;
  tokenHash: string;
  previousTokenHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
};

type SessionWhere = {
  id?: string | { not: string };
  userId?: string;
  tokenHash?: string;
  expiresAt?: { lte: Date };
};

const sessions = new Map<string, Session>();

const matches = (s: Session, where: SessionWhere) => {
  if (typeof where.id === 'string' && s.id !== where.id) return false;
  if (typeof where.id === 'object' && s.id === where.id.not) return false;
  if (where.userId !== undefined && s.userId !== where.userId) return false;
  if (where.tokenHash !== undefined && s.tokenHash !== where.tokenHash)
    return false;
  if (where.expiresAt && s.expiresAt.getTime() > where.expiresAt.lte.getTime())
    return false;
  return true;
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
  userPasswordCopy: { upsert: jest.fn() },
  authSession: {
    create: jest.fn(({ data }: { data: Partial<Session> }) => {
      const row = {
        previousTokenHash: null,
        rotatedAt: null,
        ...data,
      } as Session;
      sessions.set(row.id, row);
      return Promise.resolve(row);
    }),
    findUnique: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(sessions.get(where.id) ?? null),
    ),
    updateMany: jest.fn(
      ({ where, data }: { where: SessionWhere; data: Partial<Session> }) => {
        let count = 0;
        for (const s of sessions.values()) {
          if (!matches(s, where)) continue;
          Object.assign(s, data);
          count++;
        }
        return Promise.resolve({ count });
      },
    ),
    deleteMany: jest.fn(({ where }: { where: SessionWhere }) => {
      let count = 0;
      for (const s of [...sessions.values()]) {
        if (!matches(s, where)) continue;
        sessions.delete(s.id);
        count++;
      }
      return Promise.resolve({ count });
    }),
  },
};

const config: Record<string, string> = {
  JWT_SECRET: 'secret',
  JWT_ACCESS_EXPIRES: '1h',
  JWT_REFRESH_EXPIRES: '60d',
};

const mockConfig = {
  get: jest.fn((key: string) => config[key]),
};

const mockAudit = {
  recordAuth: jest.fn().mockResolvedValue(undefined),
};

const meta = { ip: '10.0.0.1', userAgent: 'jest' };

const mockRes = {
  cookie: jest.fn(),
  clearCookie: jest.fn(),
};

const res = mockRes as unknown as Response;

const reqWith = (token?: string) =>
  ({ cookies: token ? { refreshToken: token } : {} }) as unknown as Request;

const lastCookie = (name: string) => {
  const calls = mockRes.cookie.mock.calls.filter(
    (call: unknown[]) => call[0] === name,
  );
  return calls[calls.length - 1] as [string, string, { maxAge: number }];
};

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;

  beforeEach(async () => {
    jest.clearAllMocks();
    sessions.clear();
    jwt = new JwtService({ secret: 'secret' });
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('x', 'y', res, meta)).rejects.toThrow(
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
      await expect(service.login('x', 'pass', res, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when password does not match', async () => {
      const hashed = await bcrypt.hash('correct', 4);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      await expect(service.login('x', 'wrong', res, meta)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('sets two cookies and opens a session on successful login', async () => {
      const hashed = await bcrypt.hash('pass', 4);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      await service.login('x', 'pass', res, meta);
      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
      const [, refresh] = lastCookie('refreshToken');
      const payload = jwt.decode<{ sub: string; sid: string }>(refresh);
      expect(payload.sub).toBe('uid');
      const session = sessions.get(payload.sid);
      expect(session).toMatchObject({
        userId: 'uid',
        tokenHash: hashToken(refresh),
        userAgent: 'jest',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('derives cookie lifetimes from the configured expiries', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid',
        password: await bcrypt.hash('pass', 4),
        isActive: true,
        role: 'admin',
      });
      await service.login('x', 'pass', res, meta);
      const hour = 60 * 60 * 1000;
      const accessAge = lastCookie('accessToken')[2].maxAge;
      const refreshAge = lastCookie('refreshToken')[2].maxAge;
      expect(accessAge).toBeGreaterThan(hour - 5000);
      expect(accessAge).toBeLessThanOrEqual(hour);
      expect(refreshAge).toBeGreaterThan(60 * 24 * hour - 5000);
      expect(refreshAge).toBeLessThanOrEqual(60 * 24 * hour);
    });

    it('drops expired sessions of the user on login', async () => {
      sessions.set('old', {
        id: 'old',
        userId: 'uid',
        tokenHash: 'x',
        previousTokenHash: null,
        rotatedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        lastUsedAt: new Date(),
        userAgent: null,
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid',
        password: await bcrypt.hash('pass', 4),
        isActive: true,
        role: 'admin',
      });
      await service.login('x', 'pass', res, meta);
      expect(sessions.has('old')).toBe(false);
      expect(sessions.size).toBe(1);
    });
  });

  describe('login audit', () => {
    it('records an unknown login without a user id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('ghost', 'y', res, meta)).rejects.toThrow(
        'Invalid credentials',
      );
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
      await expect(service.login('off', 'pass', res, meta)).rejects.toThrow(
        'Account is disabled',
      );
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
      await expect(service.login('known', 'wrong', res, meta)).rejects.toThrow(
        'Invalid credentials',
      );
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
      await service.login('ok', 'pass', res, meta);
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

  describe('sessions', () => {
    const activeUser = {
      id: 'u1',
      login: 'admin',
      role: 'admin',
      isActive: true,
      mustChangePassword: false,
    };

    beforeEach(async () => {
      activeUser.isActive = true;
      mockPrisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; login?: string } }) =>
          Promise.resolve(
            where.id === 'u1' || where.login === 'admin'
              ? { ...activeUser, password: passwordHash }
              : null,
          ),
      );
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ login: 'admin' });
      passwordHash = passwordHash || (await bcrypt.hash('pass', 4));
    });

    let passwordHash = '';

    const loginDevice = async () => {
      await service.login('admin', 'pass', res, meta);
      return lastCookie('refreshToken')[1];
    };

    const refresh = async (token: string) => {
      await service.refresh(reqWith(token), res, meta);
      return lastCookie('refreshToken')[1];
    };

    const sidOf = (token: string) => jwt.decode<{ sid: string }>(token).sid;

    it('keeps several devices logged in independently', async () => {
      const phone = await loginDevice();
      const laptop = await loginDevice();
      expect(sidOf(phone)).not.toBe(sidOf(laptop));

      const phone2 = await refresh(phone);
      const laptop2 = await refresh(laptop);
      await expect(refresh(phone2)).resolves.toEqual(expect.any(String));
      await expect(refresh(laptop2)).resolves.toEqual(expect.any(String));
      expect(sessions.size).toBe(2);
    });

    it('rotates the refresh token and extends the session', async () => {
      const first = await loginDevice();
      const session = sessions.get(sidOf(first))!;
      session.expiresAt = new Date(Date.now() + 60_000);

      const second = await refresh(first);

      expect(second).not.toBe(first);
      expect(sidOf(second)).toBe(sidOf(first));
      expect(session.tokenHash).toBe(hashToken(second));
      expect(session.previousTokenHash).toBe(hashToken(first));
      expect(session.rotatedAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 59 * 24 * 60 * 60 * 1000,
      );
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'accessToken',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('accepts the previous token within the grace window', async () => {
      const first = await loginDevice();
      const second = await refresh(first);

      const third = await refresh(first);

      const session = sessions.get(sidOf(first))!;
      expect(session.tokenHash).toBe(hashToken(third));
      expect(session.previousTokenHash).toBe(hashToken(second));
      await expect(refresh(second)).resolves.toEqual(expect.any(String));
    });

    it('keeps the previous token valid until the next rotation, however late', async () => {
      const first = await loginDevice();
      await refresh(first);
      const session = sessions.get(sidOf(first))!;
      session.rotatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

      await expect(refresh(first)).resolves.toEqual(expect.any(String));
    });

    it('rejects a token two rotations old', async () => {
      const first = await loginDevice();
      const second = await refresh(first);
      await refresh(second);

      await expect(refresh(first)).rejects.toThrow('Invalid refresh token');
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'refresh_failed', userId: 'u1' }),
      );
    });

    it('signs typed access and refresh tokens with the session id', async () => {
      const refreshToken = await loginDevice();
      const accessToken = lastCookie('accessToken')[1];
      const access = jwt.decode<{ typ: string; sid: string }>(accessToken);
      const refreshPayload = jwt.decode<{ typ: string; sid: string }>(
        refreshToken,
      );
      expect(access.typ).toBe('access');
      expect(refreshPayload.typ).toBe('refresh');
      expect(access.sid).toBe(refreshPayload.sid);
    });

    it('rejects an access token used as a refresh token', async () => {
      await loginDevice();
      const accessToken = lastCookie('accessToken')[1];

      await expect(refresh(accessToken)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('retries once when another request rotated concurrently', async () => {
      const first = await loginDevice();
      const session = sessions.get(sidOf(first))!;
      const original =
        mockPrisma.authSession.updateMany.getMockImplementation()!;
      mockPrisma.authSession.updateMany.mockImplementationOnce((args) => {
        session.previousTokenHash = session.tokenHash;
        session.tokenHash = 'rotated-elsewhere';
        session.rotatedAt = new Date();
        return original(args);
      });

      const next = await refresh(first);

      expect(session.tokenHash).toBe(hashToken(next));
      expect(session.previousTokenHash).toBe('rotated-elsewhere');
    });

    it('rejects and deletes an expired session', async () => {
      const first = await loginDevice();
      const session = sessions.get(sidOf(first))!;
      session.expiresAt = new Date(Date.now() - 1000);

      await expect(refresh(first)).rejects.toThrow('Invalid refresh token');
      expect(sessions.has(session.id)).toBe(false);
    });

    it('rejects a token without a session id', async () => {
      const legacy = await jwt.signAsync(
        { sub: 'u1', role: 'admin' },
        { expiresIn: '1d' },
      );
      await expect(refresh(legacy)).rejects.toThrow('Invalid refresh token');
    });

    it('rejects a session of another user', async () => {
      const first = await loginDevice();
      sessions.get(sidOf(first))!.userId = 'u2';
      await expect(refresh(first)).rejects.toThrow('Invalid refresh token');
    });

    it('rejects an inactive user', async () => {
      const first = await loginDevice();
      activeUser.isActive = false;
      await expect(refresh(first)).rejects.toThrow('Invalid refresh token');
    });

    it('logout removes only the current session', async () => {
      const phone = await loginDevice();
      const laptop = await loginDevice();

      await service.logout('u1', reqWith(phone), res, meta);

      expect(sessions.has(sidOf(phone))).toBe(false);
      expect(sessions.has(sidOf(laptop))).toBe(true);
      await expect(refresh(laptop)).resolves.toEqual(expect.any(String));
      await expect(refresh(phone)).rejects.toThrow('Invalid refresh token');
    });

    it('logout does not touch a session of another user', async () => {
      const phone = await loginDevice();
      await service.logout('u2', reqWith(phone), res, meta);
      expect(sessions.has(sidOf(phone))).toBe(true);
    });

    it('password change keeps the current session and ends the others', async () => {
      const phone = await loginDevice();
      const laptop = await loginDevice();

      await service.changePassword(
        'u1',
        { currentPassword: 'pass', newPassword: 'newpass12' },
        reqWith(phone),
        res,
        meta,
      );

      const fresh = lastCookie('refreshToken')[1];
      expect(sidOf(fresh)).toBe(sidOf(phone));
      expect([...sessions.keys()]).toEqual([sidOf(phone)]);
      await expect(refresh(laptop)).rejects.toThrow('Invalid refresh token');
      await expect(refresh(phone)).rejects.toThrow('Invalid refresh token');
      await expect(refresh(fresh)).resolves.toEqual(expect.any(String));
    });

    it('password change ignores an unsigned session cookie', async () => {
      const phone = await loginDevice();
      const forged = jwt.sign(
        { sub: 'u1', role: 'admin', sid: sidOf(phone), typ: 'refresh' },
        { secret: 'other' },
      );

      await service.changePassword(
        'u1',
        { currentPassword: 'pass', newPassword: 'newpass12' },
        reqWith(forged),
        res,
        meta,
      );

      const fresh = lastCookie('refreshToken')[1];
      expect([...sessions.keys()]).toEqual([sidOf(fresh)]);
      expect(sidOf(fresh)).not.toBe(sidOf(phone));
    });

    it('password change drops the current session when its rotation fails', async () => {
      const phone = await loginDevice();
      mockPrisma.authSession.updateMany.mockResolvedValueOnce({ count: 0 });

      await service.changePassword(
        'u1',
        { currentPassword: 'pass', newPassword: 'newpass12' },
        reqWith(phone),
        res,
        meta,
      );

      const fresh = lastCookie('refreshToken')[1];
      expect(sessions.has(sidOf(phone))).toBe(false);
      expect([...sessions.keys()]).toEqual([sidOf(fresh)]);
    });

    it('password change without a session cookie opens a new session', async () => {
      await loginDevice();

      await service.changePassword(
        'u1',
        { currentPassword: 'pass', newPassword: 'newpass12' },
        reqWith(),
        res,
        meta,
      );

      const fresh = lastCookie('refreshToken')[1];
      expect([...sessions.keys()]).toEqual([sidOf(fresh)]);
    });
  });

  describe('sessionTokenState', () => {
    const now = new Date('2026-11-19T10:00:00.000Z');
    const base = {
      tokenHash: 'b'.repeat(64),
      previousTokenHash: 'a'.repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
    };

    it('classifies current, previous, expired and invalid tokens', () => {
      expect(sessionTokenState(base, 'b'.repeat(64), now)).toBe('current');
      expect(sessionTokenState(base, 'a'.repeat(64), now)).toBe('previous');
      expect(sessionTokenState(base, 'c'.repeat(64), now)).toBe('invalid');
      expect(
        sessionTokenState(
          { ...base, previousTokenHash: null },
          'a'.repeat(64),
          now,
        ),
      ).toBe('invalid');
      expect(
        sessionTokenState({ ...base, expiresAt: now }, 'b'.repeat(64), now),
      ).toBe('expired');
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

    it('does not record a missing cookie', async () => {
      await expect(service.refresh(reqWith(), res, meta)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(mockAudit.recordAuth).not.toHaveBeenCalled();
    });

    it('records an undecodable token without a user id', async () => {
      await expect(service.refresh(reqWith('t'), res, meta)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed(null, ''));
    });

    it('records the decoded sub when the user is missing', async () => {
      const token = await jwt.signAsync({ sub: 'u1', role: 'admin', sid: 's' });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.refresh(reqWith(token), res, meta)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed('u1', ''));
    });

    it('records the login of an inactive user', async () => {
      const token = await jwt.signAsync({ sub: 'u1', role: 'admin', sid: 's' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'off',
        isActive: false,
      });
      await expect(service.refresh(reqWith(token), res, meta)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed('u1', 'off'));
    });

    it('does not record a successful refresh', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'on',
        role: 'admin',
        isActive: true,
        password: await bcrypt.hash('pass', 4),
      });
      await service.login('on', 'pass', res, meta);
      const token = lastCookie('refreshToken')[1];
      mockAudit.recordAuth.mockClear();

      await service.refresh(reqWith(token), res, meta);

      expect(mockAudit.recordAuth).not.toHaveBeenCalled();
    });

    it('records an unknown session', async () => {
      const token = await jwt.signAsync({
        sub: 'u1',
        role: 'admin',
        sid: 's',
        typ: 'refresh',
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        login: 'on',
        isActive: true,
      });
      await expect(service.refresh(reqWith(token), res, meta)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(mockAudit.recordAuth).toHaveBeenCalledWith(failed('u1', 'on'));
    });
  });

  describe('logout', () => {
    it('clears both cookies and records the logout', async () => {
      mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
        login: 'teacher1',
      });
      await service.logout('uid', reqWith(), res, meta);
      expect(mockPrisma.authSession.deleteMany).not.toHaveBeenCalled();
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
          reqWith(),
          res,
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
          reqWith(),
          res,
          meta,
        ),
      ).rejects.toThrow('New password must differ from the current one');
    });

    it('stores the new password, clears the flag and issues fresh cookies', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);

      const result = await service.changePassword(
        'u1',
        { currentPassword: 'oldpass1', newPassword: 'newpass12' },
        reqWith(),
        res,
        meta,
      );

      expect(result).toEqual({ message: 'Password changed' });
      const firstUpdate = (
        mockPrisma.user.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(firstUpdate).toMatchObject({ mustChangePassword: false });
      expect(firstUpdate).not.toHaveProperty('refreshToken');
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
        reqWith(),
        res,
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
          reqWith(),
          res,
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
        position: null,
        institutions: [],
      });

      const profile = await service.getProfile('r1');

      expect(profile.position).toBeNull();
      expect(profile.permissions.payroll).toBe('edit');
      expect(profile.permissions.settings).toBe('edit');
    });

    it('maps admin permission rows to an object', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'a1',
        role: 'admin',
        accessScope: 'institutions',
        position: {
          id: 'p1',
          name: 'Manager',
          teaching: false,
          permissions: [
            { area: 'finance', level: 'view' },
            { area: 'children', level: 'edit' },
          ],
        },
        institutions: [{ institutionId: 'inst-k' }],
      });

      const profile = await service.getProfile('a1');

      expect(profile.position).toEqual({
        id: 'p1',
        name: 'Manager',
        teaching: false,
      });

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
        position: null,
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
