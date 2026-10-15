import { SetMetadata } from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';

export const PERMISSION_KEY = 'permission';

export interface RequiredPermission {
  area: PermissionArea;
  level: PermissionLevel;
}

export const Permission = (area: PermissionArea, level: PermissionLevel) =>
  SetMetadata(PERMISSION_KEY, { area, level } satisfies RequiredPermission);
