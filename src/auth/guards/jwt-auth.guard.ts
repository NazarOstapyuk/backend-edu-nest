import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_WITHOUT_PASSWORD_CHANGE } from '../../common/decorators/allow-without-password-change.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { assertPasswordChanged } from '../password-gate';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed =
      this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_PASSWORD_CHANGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      ignoreInstitutionHeader?: boolean;
    }>();
    if (allowed) request.ignoreInstitutionHeader = true;
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    assertPasswordChanged(request.user, allowed);
    return true;
  }
}
