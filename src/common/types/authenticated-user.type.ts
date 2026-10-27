import { AccessScope, Role } from '@prisma/client';
import type { PermissionMap } from '../../access/access-calc';

export type AuthenticatedUser = {
  id: string;
  role: Role;
  login: string;
  positionId: string | null;
  mustChangePassword: boolean;
  accessScope: AccessScope;
  institutionIds: string[];
  scopeInstitutionIds: string[] | null;
  permissions: PermissionMap;
};
