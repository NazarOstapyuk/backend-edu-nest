import { AccessScope, Role } from '@prisma/client';
import type { PermissionMap } from '../../access/access-calc';

export type AuthenticatedUser = {
  id: string;
  role: Role;
  login: string;
  mustChangePassword: boolean;
  accessScope: AccessScope;
  permissions: PermissionMap;
};
