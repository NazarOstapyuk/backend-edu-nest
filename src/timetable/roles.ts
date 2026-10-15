import { PermissionArea, PermissionLevel } from '@prisma/client';
import { hasPermission } from '../access/access-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';

export const isTimetableManager = (
  user: AuthenticatedUser,
  level: PermissionLevel = PermissionLevel.view,
): boolean => hasPermission(user, PermissionArea.timetable, level);
