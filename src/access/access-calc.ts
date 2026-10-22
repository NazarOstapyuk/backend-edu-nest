import {
  AccessScope,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';

export type PermissionMap = Partial<Record<PermissionArea, PermissionLevel>>;

export interface AccessUser {
  role: Role;
  accessScope: AccessScope;
  institutionIds: string[];
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

export function baseScope(user: {
  role: Role;
  accessScope: AccessScope;
  institutionIds: string[];
}): string[] | null {
  if (user.role === Role.root || user.role === Role.parent) return null;
  if (user.accessScope === AccessScope.all) return null;
  return user.institutionIds;
}

export function effectiveScope(
  base: string[] | null,
  selected: string | null,
): string[] | null | 'outside' {
  if (selected === null) return base;
  if (base === null || base.includes(selected)) return [selected];
  return 'outside';
}

export const scopeIds = (user: {
  scopeInstitutionIds: string[] | null;
}): string[] | null => user.scopeInstitutionIds;

export interface ScopeRef {
  accessScope: AccessScope;
  institutionIds: string[];
}

export const scopeCovers = (granter: ScopeRef, target: ScopeRef): boolean => {
  if (granter.accessScope === AccessScope.all) return true;
  if (target.accessScope === AccessScope.all) return false;
  return target.institutionIds.every((id) =>
    granter.institutionIds.includes(id),
  );
};

const sameScope = (a: ScopeRef, b: ScopeRef): boolean =>
  a.accessScope === b.accessScope &&
  (a.accessScope === AccessScope.all ||
    (a.institutionIds.length === b.institutionIds.length &&
      a.institutionIds.every((id) => b.institutionIds.includes(id))));

export function grantDenial(
  granter: AccessUser & { id: string },
  target: {
    id: string;
    role: Role;
    accessScope: AccessScope;
    institutionIds: string[];
    permissions: PermissionMap;
  },
  request: {
    accessScope: AccessScope;
    institutionIds: string[];
    permissions: PermissionMap;
  },
): GrantDenial {
  if (target.role === Role.root) return 'root';
  if (target.role === Role.parent) return 'staff_only';
  if (granter.id === target.id) return 'self';
  if (granter.role === Role.root) return null;
  if (!levelSatisfies(granter.permissions.users, PermissionLevel.edit))
    return 'too_much';
  if (!scopeCovers(granter, request)) return 'too_much';
  if (!sameScope(request, target) && !scopeCovers(granter, target))
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
  target: {
    role: Role;
    accessScope: AccessScope;
    institutionIds: string[];
    permissions: PermissionMap;
  },
): boolean {
  if (actor.role === Role.root) return true;
  if (target.role === Role.root) return false;
  if (target.role === Role.parent) return true;
  if (!scopeCovers(actor, target)) return false;
  return ALL_AREAS.every((area) => {
    const level = target.permissions[area];
    return (
      level === undefined || levelSatisfies(actor.permissions[area], level)
    );
  });
}
