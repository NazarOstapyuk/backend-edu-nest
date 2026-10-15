import { SetMetadata } from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';

export const PERMISSION_KEY = 'permission';

export interface RequiredPermission {
  area: PermissionArea;
  level: PermissionLevel;
}

export const Permission = (area: PermissionArea, level: PermissionLevel) =>
  SetMetadata(PERMISSION_KEY, { area, level } satisfies RequiredPermission);

export const PERMISSION_ANY_KEY = 'permissionAny';

export interface RequiredAnyPermission {
  areas: PermissionArea[];
  level: PermissionLevel;
}

export const PermissionAny = (
  areas: PermissionArea[],
  level: PermissionLevel,
) =>
  SetMetadata(PERMISSION_ANY_KEY, {
    areas,
    level,
  } satisfies RequiredAnyPermission);
