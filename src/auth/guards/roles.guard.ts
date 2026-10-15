import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { hasPermission } from '../../access/access-calc';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from '../../common/decorators/permission.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets,
    );
    const permission = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(PERMISSION_KEY, targets);
    if (!roles && !permission) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return false;
    if (roles?.includes(user.role)) return true;
    if (permission) {
      if (hasPermission(user, permission.area, permission.level)) return true;
      throw new ForbiddenException('Insufficient permissions');
    }
    return false;
  }
}
