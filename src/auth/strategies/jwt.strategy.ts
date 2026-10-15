import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { toPermissionMap } from '../../access/access-calc';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.accessToken ??
          null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: { sub: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { permissions: { select: { area: true, level: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return {
      id: user.id,
      role: user.role,
      login: user.login,
      mustChangePassword: user.mustChangePassword,
      accessScope: user.accessScope,
      permissions: toPermissionMap(user.permissions),
    };
  }
}
