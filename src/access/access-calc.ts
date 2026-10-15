import {
  AccessScope,
  GroupKind,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';

export type PermissionMap = Partial<Record<PermissionArea, PermissionLevel>>;

export interface AccessUser {
  role: Role;
  accessScope: AccessScope;
  permissions: PermissionMap;
}

export type GrantDenial = 'root' | 'staff_only' | 'self' | 'too_much' | null;

export const ALL_AREAS = Object.values(PermissionArea);

const RANK: Record<PermissionLevel, number> = {
  [PermissionLevel.view]: 1,
  [PermissionLevel.edit]: 2,
};

export const allPermissions = (level: PermissionLevel): PermissionMap =>
  Object.fromEntries(ALL_AREAS.map((area) => [area, level]));

export const toPermissionMap = (
  rows: { area: PermissionArea; level: PermissionLevel }[],
): PermissionMap =>
  Object.fromEntries(rows.map((row) => [row.area, row.level]));

export const levelSatisfies = (
  have: PermissionLevel | undefined,
  need: PermissionLevel,
): boolean => have !== undefined && RANK[have] >= RANK[need];

export function hasPermission(
  user: AccessUser,
  area: PermissionArea,
  level: PermissionLevel,
): boolean {
  if (user.role === Role.root) return true;
  if (user.role === Role.parent) return false;
  return levelSatisfies(user.permissions[area], level);
}

export function scopeKind(user: AccessUser): GroupKind | null {
  if (user.role === Role.root || user.accessScope === AccessScope.all)
    return null;
  return user.accessScope === AccessScope.kindergarten
    ? GroupKind.kindergarten
    : GroupKind.school_class;
}

export const scopeCovers = (granter: AccessScope, target: AccessScope) =>
  granter === AccessScope.all || granter === target;

export function grantDenial(
  granter: AccessUser & { id: string },
  target: {
    id: string;
    role: Role;
    accessScope: AccessScope;
    permissions: PermissionMap;
  },
  request: { accessScope: AccessScope; permissions: PermissionMap },
): GrantDenial {
  if (target.role === Role.root) return 'root';
  if (target.role === Role.parent) return 'staff_only';
  if (granter.id === target.id) return 'self';
  if (granter.role === Role.root) return null;
  if (!levelSatisfies(granter.permissions.users, PermissionLevel.edit))
    return 'too_much';
  if (!scopeCovers(granter.accessScope, request.accessScope)) return 'too_much';
  if (
    request.accessScope !== target.accessScope &&
    !scopeCovers(granter.accessScope, target.accessScope)
  )
    return 'too_much';
  for (const area of ALL_AREAS) {
    const before = target.permissions[area];
    const after = request.permissions[area];
    if (before === after) continue;
    const held = granter.permissions[area];
    if (before !== undefined && !levelSatisfies(held, before))
      return 'too_much';
    if (after !== undefined && !levelSatisfies(held, after)) return 'too_much';
  }
  return null;
}

export function coversUser(
  actor: AccessUser,
  target: { role: Role; accessScope: AccessScope; permissions: PermissionMap },
): boolean {
  if (actor.role === Role.root) return true;
  if (target.role === Role.root) return false;
  if (target.role === Role.parent) return true;
  if (!scopeCovers(actor.accessScope, target.accessScope)) return false;
  return ALL_AREAS.every((area) => {
    const level = target.permissions[area];
    return (
      level === undefined || levelSatisfies(actor.permissions[area], level)
    );
  });
}
