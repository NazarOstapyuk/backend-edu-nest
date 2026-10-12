// src/auth/auth.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateContactsDto } from './dto/update-contacts.dto';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(login: string, password: string, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
    return { message: 'Login successful' };
  }

  async refresh(req: Request, res: Response) {
    const token: string | undefined = (req.cookies as Record<string, string>)
      ?.refreshToken;
    if (!token) throw new UnauthorizedException('Invalid refresh token');

    let payload: { sub: string; role: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive || !user.refreshToken)
      throw new UnauthorizedException('Invalid refresh token');

    const match = await bcrypt.compare(token, user.refreshToken);
    if (!match) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
    return { message: 'Token refreshed' };
  }

  async logout(userId: string, res: Response) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
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
  } as const;

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.profileSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto, res: Response) {
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
