import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import {
  baseScope,
  effectiveScope,
  toPermissionMap,
} from '../../access/access-calc';
import { OUTSIDE_SCOPE } from '../../access/scope';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { findInstitution } from '../../institutions/institution-checks';
import { positionSelect } from '../../positions/position-select';
import { PrismaService } from '../../prisma/prisma.service';

const selectedInstitution = (req: Request): string | null => {
  if (
    (req as Request & { ignoreInstitutionHeader?: boolean })
      .ignoreInstitutionHeader
  )
    return null;
  const header = req.headers['x-institution-id'];
  return typeof header === 'string' && header !== '' ? header : null;
};

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
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: { sub: string; role: string },
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        position: positionSelect,
        institutions: { select: { institutionId: true } },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const institutionIds = user.institutions.map((row) => row.institutionId);
    const selected =
      user.role === Role.parent ? null : selectedInstitution(req);
    if (selected !== null) await findInstitution(this.prisma, selected);
    const scope = effectiveScope(
      baseScope({
        role: user.role,
        accessScope: user.accessScope,
        institutionIds,
      }),
      selected,
    );
    if (scope === 'outside') throw new ForbiddenException(OUTSIDE_SCOPE);
    return {
      id: user.id,
      role: user.role,
      login: user.login,
      positionId: user.positionId,
      mustChangePassword: user.mustChangePassword,
      accessScope: user.accessScope,
      institutionIds,
      scopeInstitutionIds: scope,
      permissions: toPermissionMap(user.position?.permissions ?? []),
    };
  }
}
