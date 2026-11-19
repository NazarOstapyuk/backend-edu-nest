// src/auth/auth.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthEventType,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import { allPermissions, toPermissionMap } from '../access/access-calc';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateContactsDto } from './dto/update-contacts.dto';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { storePasswordCopy } from '../users/password-vault';
import { positionRef, positionSelect } from '../positions/position-select';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/request-meta';

export const REFRESH_GRACE_MS = 60 * 1000;
const DEFAULT_ACCESS_EXPIRES = '1h';
const DEFAULT_REFRESH_EXPIRES = '60d';

type RefreshPayload = { sub: string; role: string; sid?: string };

type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  previousTokenHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
};

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const sameHash = (a: string, b: string | null) =>
  b !== null &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function sessionTokenState(
  session: Pick<
    SessionRow,
    'tokenHash' | 'previousTokenHash' | 'rotatedAt' | 'expiresAt'
  >,
  hash: string,
  now: Date,
): 'current' | 'grace' | 'expired' | 'invalid' {
  if (session.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (sameHash(hash, session.tokenHash)) return 'current';
  if (
    sameHash(hash, session.previousTokenHash) &&
    session.rotatedAt &&
    now.getTime() - session.rotatedAt.getTime() <= REFRESH_GRACE_MS
  )
    return 'grace';
  return 'invalid';
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  async login(
    login: string,
    password: string,
    res: Response,
    meta: RequestMeta,
  ) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (!user) {
      await this.audit.recordAuth({
        ...meta,
        type: AuthEventType.login_failed,
        login,
        userId: null,
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      await this.audit.recordAuth({
        ...meta,
        type: AuthEventType.login_failed,
        login,
        userId: user.id,
        reason: 'account_disabled',
      });
      throw new UnauthorizedException('Account is disabled');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      await this.audit.recordAuth({
        ...meta,
        type: AuthEventType.login_failed,
        login,
        userId: user.id,
        reason: 'invalid_credentials',
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.authSession.deleteMany({
      where: { userId: user.id, expiresAt: { lte: new Date() } },
    });
    await this.startSession(user, res, meta);
    await this.audit.recordAuth({
      ...meta,
      type: AuthEventType.login_success,
      login,
      userId: user.id,
      reason: null,
    });
    return { message: 'Login successful' };
  }

  private async refreshFailed(
    meta: RequestMeta,
    userId: string | null,
    login: string,
  ): Promise<never> {
    await this.audit.recordAuth({
      ...meta,
      type: AuthEventType.refresh_failed,
      login,
      userId,
      reason: 'invalid_refresh',
    });
    throw new UnauthorizedException('Invalid refresh token');
  }

  async refresh(req: Request, res: Response, meta: RequestMeta) {
    const token: string | undefined = (req.cookies as Record<string, string>)
      ?.refreshToken;
    if (!token) throw new UnauthorizedException('Invalid refresh token');

    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      return this.refreshFailed(meta, null, '');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) return this.refreshFailed(meta, payload.sub, '');
    if (!user.isActive || !payload.sid)
      return this.refreshFailed(meta, payload.sub, user.login);

    const hash = hashToken(token);
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.prisma.authSession.findUnique({
        where: { id: payload.sid },
      });
      if (!session || session.userId !== user.id)
        return this.refreshFailed(meta, payload.sub, user.login);
      const state = sessionTokenState(session, hash, new Date());
      if (state === 'expired') {
        await this.prisma.authSession.deleteMany({
          where: { id: session.id },
        });
        return this.refreshFailed(meta, payload.sub, user.login);
      }
      if (state === 'invalid')
        return this.refreshFailed(meta, payload.sub, user.login);
      if (await this.rotateSession(session, user, res)) {
        return { message: 'Token refreshed' };
      }
    }
    return this.refreshFailed(meta, payload.sub, user.login);
  }

  async logout(userId: string, req: Request, res: Response, meta: RequestMeta) {
    const sid = this.sessionIdOf(req);
    if (sid) {
      await this.prisma.authSession.deleteMany({
        where: { id: sid, userId },
      });
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { login: true },
    });
    await this.audit.recordAuth({
      ...meta,
      type: AuthEventType.logout,
      login: user.login,
      userId,
      reason: null,
    });
    const cookieBase = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get<string>('NODE_ENV') === 'production',
    };
    res.clearCookie('accessToken', cookieBase);
    res.clearCookie('refreshToken', cookieBase);
    return { message: 'Logged out' };
  }

  private readonly profileSelect = {
    id: true,
    login: true,
    role: true,
    firstName: true,
    lastName: true,
    middleName: true,
    phone: true,
    email: true,
    mustChangePassword: true,
    accessScope: true,
    position: positionSelect,
    institutions: { select: { institutionId: true } },
  } as const;

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.profileSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toProfile(user);
  }

  private toProfile<
    T extends {
      role: Role;
      position: {
        id: string;
        name: string;
        teaching: boolean;
        permissions: { area: PermissionArea; level: PermissionLevel }[];
      } | null;
      institutions: { institutionId: string }[];
    },
  >(user: T) {
    const { position, institutions, ...profile } = user;
    return {
      ...profile,
      position: positionRef(position),
      institutionIds: institutions.map((row) => row.institutionId),
      permissions:
        user.role === Role.root
          ? allPermissions(PermissionLevel.edit)
          : toPermissionMap(position?.permissions ?? []),
    };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    req: Request,
    res: Response,
    meta: RequestMeta,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const match = await bcrypt.compare(dto.currentPassword, user.password);
    if (!match) throw new BadRequestException('Invalid current password');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from the current one',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: await bcrypt.hash(dto.newPassword, 10),
        mustChangePassword: false,
      },
    });
    await storePasswordCopy(this.prisma, userId, dto.newPassword);
    const sid = this.sessionIdOf(req);
    await this.prisma.authSession.deleteMany({
      where: { userId, ...(sid ? { id: { not: sid } } : {}) },
    });
    const current = sid
      ? await this.prisma.authSession.findUnique({ where: { id: sid } })
      : null;
    const rotated =
      current?.userId === userId &&
      (await this.rotateSession(current, user, res, true));
    if (!rotated) await this.startSession(user, res, meta);
    await this.audit.recordAuth({
      ...meta,
      type: AuthEventType.password_changed,
      login: user.login,
      userId,
      reason: null,
    });
    return { message: 'Password changed' };
  }

  async updateContacts(userId: string, dto: UpdateContactsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.parent && dto.phone === null) {
      throw new BadRequestException('Phone is required for parents');
    }
    const data: { phone?: string | null; email?: string | null } = {};
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getProfile(userId);
  }

  private sessionIdOf(req: Request): string | null {
    const token: string | undefined = (req.cookies as Record<string, string>)
      ?.refreshToken;
    if (!token) return null;
    try {
      const payload = this.jwtService.decode<RefreshPayload | null>(token);
      return typeof payload?.sid === 'string' ? payload.sid : null;
    } catch {
      return null;
    }
  }

  private async startSession(
    user: { id: string; role: string },
    res: Response,
    meta: RequestMeta,
  ) {
    const sid = randomUUID();
    const tokens = await this.generateTokens(user.id, user.role, sid);
    const now = new Date();
    await this.prisma.authSession.create({
      data: {
        id: sid,
        userId: user.id,
        tokenHash: hashToken(tokens.refreshToken),
        expiresAt: tokens.refreshExpiresAt,
        createdAt: now,
        lastUsedAt: now,
        userAgent: meta.userAgent,
      },
    });
    this.setCookies(res, tokens);
  }

  private async rotateSession(
    session: SessionRow,
    user: { id: string; role: string },
    res: Response,
    forgetPrevious = false,
  ): Promise<boolean> {
    const tokens = await this.generateTokens(user.id, user.role, session.id);
    const now = new Date();
    const { count } = await this.prisma.authSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash },
      data: {
        tokenHash: hashToken(tokens.refreshToken),
        previousTokenHash: forgetPrevious ? null : session.tokenHash,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: tokens.refreshExpiresAt,
      },
    });
    if (count === 0) return false;
    this.setCookies(res, tokens);
    return true;
  }

  private async generateTokens(userId: string, role: string, sid: string) {
    const payload = { sub: userId, role };
    const secret = this.config.get<string>('JWT_SECRET');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret,
        expiresIn: this.accessExpires(),
      }),
      this.jwtService.signAsync(
        { ...payload, sid },
        { secret, expiresIn: this.refreshExpires(), jwtid: randomUUID() },
      ),
    ]);
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: this.expiryOf(accessToken),
      refreshExpiresAt: this.expiryOf(refreshToken),
    };
  }

  private accessExpires(): StringValue {
    return (this.config.get<string>('JWT_ACCESS_EXPIRES') ||
      DEFAULT_ACCESS_EXPIRES) as StringValue;
  }

  private refreshExpires(): StringValue {
    return (this.config.get<string>('JWT_REFRESH_EXPIRES') ||
      DEFAULT_REFRESH_EXPIRES) as StringValue;
  }

  private expiryOf(token: string): Date {
    const payload = this.jwtService.decode<{ exp?: number } | null>(token);
    if (typeof payload?.exp !== 'number')
      throw new Error('Signed token has no expiry');
    return new Date(payload.exp * 1000);
  }

  private setCookies(
    res: Response,
    tokens: {
      accessToken: string;
      refreshToken: string;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    },
  ) {
    const cookieBase = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get<string>('NODE_ENV') === 'production',
    };
    const now = Date.now();
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieBase,
      maxAge: Math.max(0, tokens.accessExpiresAt.getTime() - now),
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      ...cookieBase,
      maxAge: Math.max(0, tokens.refreshExpiresAt.getTime() - now),
    });
  }
}
