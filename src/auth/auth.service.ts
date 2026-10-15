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
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../audit/request-meta';

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

    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
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
    if (!token) return this.refreshFailed(meta, null, '');

    let payload: { sub: string; role: string };
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
    if (!user.isActive || !user.refreshToken)
      return this.refreshFailed(meta, payload.sub, user.login);

    const match = await bcrypt.compare(token, user.refreshToken);
    if (!match) return this.refreshFailed(meta, payload.sub, user.login);

    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
    return { message: 'Token refreshed' };
  }

  async logout(userId: string, res: Response, meta: RequestMeta) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
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
    permissions: { select: { area: true, level: true } },
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
      permissions: { area: PermissionArea; level: PermissionLevel }[];
    },
  >(user: T) {
    const { permissions, ...profile } = user;
    return {
      ...profile,
      permissions:
        user.role === Role.root
          ? allPermissions(PermissionLevel.edit)
          : toPermissionMap(permissions),
    };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
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
        refreshToken: null,
      },
    });
    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
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

  private async generateTokens(userId: string, role: string) {
    const payload = { sub: userId, role };
    const secret = this.config.get<string>('JWT_SECRET');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret,
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES') as StringValue,
      }),
      this.jwtService.signAsync(payload, {
        secret,
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES') as StringValue,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, token: string) {
    const hashed = await bcrypt.hash(token, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });
  }

  private setCookies(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const cookieBase = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.get<string>('NODE_ENV') === 'production',
    };
    res.cookie('accessToken', tokens.accessToken, {
      ...cookieBase,
      maxAge: 15 * 60 * 1000, // 15 minutes — matches JWT_ACCESS_EXPIRES
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      ...cookieBase,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — matches JWT_REFRESH_EXPIRES
    });
  }
}
