import { ForbiddenException } from '@nestjs/common';

export function assertPasswordChanged(
  user: { mustChangePassword: boolean } | undefined,
  allowed: boolean,
) {
  if (user?.mustChangePassword && !allowed) {
    throw new ForbiddenException('Password change required');
  }
}
