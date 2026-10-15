# Staff Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "every admin sees everything" with per-section permissions (`view`/`edit`) and a kindergarten/school scope per staff member, grantable by root or by staff with `users: edit` (never more than they hold), with teachers able to receive extra sections.

**Architecture:** A pure `src/access/access-calc.ts` (levels, `hasPermission`, `scopeKind`, `grantDenial`) and DB helpers `src/access/scope.ts` (Prisma filters, `assertChildInScope`, `assertKindInScope`). `JwtStrategy` loads `accessScope` + permissions into `AuthenticatedUser`; a `@Permission(area, level)` decorator is honoured by `RolesGuard`. Controllers move from `@Roles(admin)` to `@Permission`; services replace admin/teacher checks with `hasPermission` and apply the scope to children, finance, tariffs, register and meals. The frontend gets an access dialog, permission-aware navigation and read-only pages.

**Tech Stack:** NestJS 11, Prisma 7, class-validator, Jest. Frontend: React 19, MUI 9, Zustand 5, react-hook-form, axios.

**Spec:** `docs/superpowers/specs/2026-10-15-access-control-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest`: branch `feature/access-control` from `main` at the start of Task 1, Tasks 1–9. Frontend `D:\IT\EduNest`: branch `feature/access-control` from `main` at the start of Task 10, Tasks 10–11.

## Global Constraints

- Node 22 for Prisma/Jest: `export PATH="/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH"`. Docker `edu_postgres` must be running for migrations (`docker ps`); if it is not, generate the migration offline with `npx prisma migrate diff` and report it.
- Areas exactly: `users`, `children`, `finance`, `tariffs`, `classes`, `register`, `timetable`, `meals`, `payroll`, `backups`, `settings`. Levels `view`, `edit` (edit satisfies view). Scopes `all`, `kindergarten`, `school_class`.
- `root` always passes `@Permission` checks and has every permission; `parent` never has permissions. Routes with only `@Roles` keep today's behaviour (root does NOT get extra access to teacher-only or parent-only routes).
- Error messages exactly: 403 `Insufficient permissions`, 403 `Outside access scope`, 403 `Cannot change own access`, 403 `Cannot grant more than you have`, 403 `Root access cannot be changed`, 400 `Access applies to staff only`, 400 `Duplicate permission`. Out-of-scope single records answer 404 with the record's existing not-found message.
- Children without a group are visible only with scope `all` (or root).
- The data migration gives every existing `admin` `edit` on all 11 areas; nothing else changes for them.
- Never run `prisma migrate reset`, `db push`, `docker compose down -v`; don't edit applied migrations.
- No new dependencies. No code comments. Don't change CORS, ValidationPipe, cookies or JWT config.
- Backend: `npx eslint --fix <touched files>` per commit; no new lint errors (pre-existing `_p`/`_r` errors in `src/users/users.service.ts` and pre-existing tsc errors in `users.service.spec.ts` stay). Jest mocks without `as unknown as`; never `as any`.
- Frontend: tsc baseline `<scratchpad>/fe-tsc-baseline-access.txt` saved before Task 10; no new tsc errors; eslint 0 errors on touched files; MUI 9 has no system props on `Stack`/`Typography` (use `sx`); never touch untracked `src/shared/api/children 2.ts` / `children 3.ts` / `CreateSubscriptionModal 2.tsx`; never `git add -A`.
- Commits: Conventional Commits, one task = one commit, attribution trailer. Never push.
- Live checks: PORT=3101 (3000/5173 belong to the user; 3100 may be held). Never print `ROOT_PASSWORD`.
- Scratchpad: `C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad`.

## Review Focus

1. An existing admin must keep working exactly as before right after the migration (all areas `edit`, scope `all`). Pinned in Task 1 (migration SQL) and Task 9 (live check).
2. A staff member with `users: edit` but only `finance: view` must not be able to grant `finance: edit`, grant `payroll`, remove someone's `payroll`, widen a scope, or change their own access. Pinned in Task 2 (`grantDenial`) and Task 4.
3. A kindergarten-scoped accountant opening a school child's finance by URL gets 404 `Child not found`, and the balances list contains no school children nor children without a group. Pinned in Task 7.
4. A teacher with `register: edit` sees and edits all groups in the register (like an admin), but a teacher without it still sees only own groups. Pinned in Task 5 and Task 8.
5. Root keeps every route working (e.g. finance, payroll, backups) after `admin` is removed from `@Roles`; a parent cannot reach staff routes. Pinned in Task 3 (guard tests) and Task 9 (live check).

---

## File Map

Backend:

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | enums `PermissionArea`, `PermissionLevel`, `AccessScope`; `User.accessScope`; model `UserPermission` |
| `src/access/access-calc.ts` | Pure: `PermissionMap`, `ALL_AREAS`, `allPermissions`, `levelSatisfies`, `hasPermission`, `scopeKind`, `scopeCovers`, `grantDenial` |
| `src/access/scope.ts` | `OUTSIDE_SCOPE`, `childScopeWhere`, `groupScopeWhere`, `assertKindInScope`, `assertChildInScope` |
| `src/common/decorators/permission.decorator.ts` | `@Permission(area, level)` |
| `src/auth/guards/roles.guard.ts` | roles OR permission |
| `src/common/types/authenticated-user.type.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/auth/auth.service.ts` | access in the request user and `/auth/me` |
| `src/users/*` | `PATCH /users/:id/access`, access in responses, role→parent clears access |
| all staff controllers | `@Permission` per the spec table |
| register, timetable, classes, meals-views, absence-reasons services | `hasPermission` instead of admin/teacher checks |
| children, groups, finance, tariffs, attendance, meals services | scope filters |

Frontend: `src/shared/api/users.ts` (access types/API), `src/entities/user` (profile permissions, `useCan`), `src/pages/users/ui/AccessDialog.tsx`, sidebar nav, read-only page gating, error translations.

---

### Task 1: Schema, migration with data backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_access_control/migration.sql`

**Interfaces:**
- Produces: enums `PermissionArea`, `PermissionLevel`, `AccessScope`; `User.accessScope`; `User.permissions UserPermission[]`; model `UserPermission { id, userId, area, level }` unique `userId_area`.

- [ ] **Step 1: Branch** — `cd /d/IT/backend-edu-nest && git checkout -b feature/access-control`

- [ ] **Step 2: Schema** — append:

```prisma
enum PermissionArea {
  users
  children
  finance
  tariffs
  classes
  register
  timetable
  meals
  payroll
  backups
  settings
}

enum PermissionLevel {
  view
  edit
}

enum AccessScope {
  all
  kindergarten
  school_class
}

model UserPermission {
  id     String          @id @default(uuid())
  userId String
  user   User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  area   PermissionArea
  level  PermissionLevel

  @@unique([userId, area])
}
```

In `model User` add after `isActive`:

```prisma
  accessScope         AccessScope            @default(all)
```

and after the last relation line:

```prisma
  permissions         UserPermission[]
```

- [ ] **Step 3: Migration** — create it without applying, append the backfill, then apply:

```bash
export PATH="/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH"
npx prisma format && npx prisma migrate dev --name add_access_control --create-only
```

Append to the generated `migration.sql`:

```sql
INSERT INTO "UserPermission" ("id", "userId", "area", "level")
SELECT gen_random_uuid()::text, u."id", a.area, 'edit'::"PermissionLevel"
FROM "User" u
CROSS JOIN unnest(enum_range(NULL::"PermissionArea")) AS a(area)
WHERE u."role" = 'admin';
```

Then `npx prisma migrate dev` (applies it) and `npx prisma generate`. Verify: `docker exec edu_postgres psql -U postgres -d edu_db -c 'select u.login, count(p.*) from "User" u left join "UserPermission" p on p."userId" = u.id where u.role = '"'"'admin'"'"' group by u.login'` → every admin has 11. If Prisma reports drift or asks to reset: STOP and report.

- [ ] **Step 4: Verify and commit**

```bash
npm run build && npm test
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add staff permissions and access scope schema"
```

---

### Task 2: Pure access rules and scope helpers

**Files:**
- Create: `src/access/access-calc.ts`, `src/access/access-calc.spec.ts`, `src/access/scope.ts`, `src/access/scope.spec.ts`

**Interfaces:**
- Produces:
  - `type PermissionMap = Partial<Record<PermissionArea, PermissionLevel>>`
  - `interface AccessUser { role: Role; accessScope: AccessScope; permissions: PermissionMap }`
  - `ALL_AREAS: PermissionArea[]`, `allPermissions(level): PermissionMap`
  - `levelSatisfies(have: PermissionLevel | undefined, need: PermissionLevel): boolean`
  - `hasPermission(user: AccessUser, area: PermissionArea, level: PermissionLevel): boolean`
  - `scopeKind(user: AccessUser): GroupKind | null`
  - `scopeCovers(granter: AccessScope, target: AccessScope): boolean`
  - `type GrantDenial = 'root' | 'staff_only' | 'self' | 'too_much' | null`
  - `grantDenial(granter: AccessUser & { id: string }, target: { id: string; role: Role; accessScope: AccessScope; permissions: PermissionMap }, request: { accessScope: AccessScope; permissions: PermissionMap }): GrantDenial`
  - `toPermissionMap(rows: { area: PermissionArea; level: PermissionLevel }[]): PermissionMap`
  - scope.ts: `OUTSIDE_SCOPE = 'Outside access scope'`, `childScopeWhere(kind: GroupKind | null): Prisma.ChildWhereInput`, `groupScopeWhere(kind): Prisma.GroupWhereInput`, `assertKindInScope(kind: GroupKind | null, target: GroupKind | null): void` (403), `assertChildInScope(db: Pick<Prisma.TransactionClient, 'child'>, kind: GroupKind | null, childId: string, message?: string): Promise<void>` (404, default `Child not found`)

- [ ] **Step 1: Failing tests** (`src/access/access-calc.spec.ts`)

```ts
import {
  AccessScope,
  GroupKind,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import {
  ALL_AREAS,
  allPermissions,
  grantDenial,
  hasPermission,
  levelSatisfies,
  scopeCovers,
  scopeKind,
  toPermissionMap,
} from './access-calc';

const user = (
  role: Role,
  permissions = {},
  accessScope: AccessScope = AccessScope.all,
  id = 'u1',
) => ({ id, role, accessScope, permissions });

describe('levels and permissions', () => {
  it('lets edit satisfy view but not the other way round', () => {
    expect(levelSatisfies(PermissionLevel.edit, PermissionLevel.view)).toBe(true);
    expect(levelSatisfies(PermissionLevel.view, PermissionLevel.edit)).toBe(false);
    expect(levelSatisfies(undefined, PermissionLevel.view)).toBe(false);
  });

  it('gives root everything, parents nothing, staff what they hold', () => {
    expect(hasPermission(user(Role.root), PermissionArea.payroll, PermissionLevel.edit)).toBe(true);
    expect(
      hasPermission(
        user(Role.parent, allPermissions(PermissionLevel.edit)),
        PermissionArea.finance,
        PermissionLevel.view,
      ),
    ).toBe(false);
    const accountant = user(Role.admin, { finance: PermissionLevel.view });
    expect(hasPermission(accountant, PermissionArea.finance, PermissionLevel.view)).toBe(true);
    expect(hasPermission(accountant, PermissionArea.finance, PermissionLevel.edit)).toBe(false);
    expect(hasPermission(accountant, PermissionArea.payroll, PermissionLevel.view)).toBe(false);
    const teacher = user(Role.teacher, { register: PermissionLevel.edit });
    expect(hasPermission(teacher, PermissionArea.register, PermissionLevel.edit)).toBe(true);
  });

  it('builds full maps and maps rows', () => {
    expect(ALL_AREAS).toHaveLength(11);
    expect(Object.keys(allPermissions(PermissionLevel.view))).toHaveLength(11);
    expect(
      toPermissionMap([{ area: PermissionArea.meals, level: PermissionLevel.edit }]),
    ).toEqual({ meals: PermissionLevel.edit });
  });
});

describe('scope', () => {
  it('maps scope to a group kind', () => {
    expect(scopeKind(user(Role.admin))).toBeNull();
    expect(scopeKind(user(Role.root, {}, AccessScope.kindergarten))).toBeNull();
    expect(scopeKind(user(Role.admin, {}, AccessScope.kindergarten))).toBe(GroupKind.kindergarten);
    expect(scopeKind(user(Role.teacher, {}, AccessScope.school_class))).toBe(GroupKind.school_class);
  });

  it('checks scope coverage', () => {
    expect(scopeCovers(AccessScope.all, AccessScope.kindergarten)).toBe(true);
    expect(scopeCovers(AccessScope.kindergarten, AccessScope.kindergarten)).toBe(true);
    expect(scopeCovers(AccessScope.kindergarten, AccessScope.all)).toBe(false);
    expect(scopeCovers(AccessScope.kindergarten, AccessScope.school_class)).toBe(false);
  });
});

describe('grantDenial', () => {
  const deputy = user(
    Role.admin,
    { users: PermissionLevel.edit, finance: PermissionLevel.view, register: PermissionLevel.edit },
    AccessScope.all,
    'g1',
  );
  const target = (
    permissions = {},
    accessScope: AccessScope = AccessScope.all,
    role: Role = Role.admin,
  ) => ({ id: 't1', role, accessScope, permissions });
  const request = (permissions = {}, accessScope: AccessScope = AccessScope.all) => ({
    permissions,
    accessScope,
  });

  it('protects root, parents and oneself', () => {
    expect(grantDenial(user(Role.root, {}, AccessScope.all, 'r1'), target({}, AccessScope.all, Role.root), request())).toBe('root');
    expect(grantDenial(deputy, target({}, AccessScope.all, Role.parent), request())).toBe('staff_only');
    expect(grantDenial(deputy, { ...target(), id: 'g1' }, request())).toBe('self');
  });

  it('lets root grant anything', () => {
    expect(
      grantDenial(user(Role.root, {}, AccessScope.all, 'r1'), target(), request(allPermissions(PermissionLevel.edit))),
    ).toBeNull();
  });

  it('requires users: edit', () => {
    const viewer = user(Role.admin, { users: PermissionLevel.view, finance: PermissionLevel.edit }, AccessScope.all, 'g2');
    expect(grantDenial(viewer, target(), request({ finance: PermissionLevel.view }))).toBe('too_much');
  });

  it('allows granting what the granter holds', () => {
    expect(
      grantDenial(deputy, target(), request({ finance: PermissionLevel.view, register: PermissionLevel.edit })),
    ).toBeNull();
  });

  it('refuses a higher level, an area not held, removing an area not held', () => {
    expect(grantDenial(deputy, target(), request({ finance: PermissionLevel.edit }))).toBe('too_much');
    expect(grantDenial(deputy, target(), request({ payroll: PermissionLevel.view }))).toBe('too_much');
    expect(grantDenial(deputy, target({ payroll: PermissionLevel.edit }), request({}))).toBe('too_much');
  });

  it('ignores unchanged areas the granter does not hold', () => {
    expect(
      grantDenial(
        deputy,
        target({ payroll: PermissionLevel.edit }),
        request({ payroll: PermissionLevel.edit, register: PermissionLevel.view }),
      ),
    ).toBeNull();
  });

  it('refuses a scope wider than the granter or changing a wider target', () => {
    const kgDeputy = { ...deputy, id: 'g3', accessScope: AccessScope.kindergarten };
    expect(grantDenial(kgDeputy, target({}, AccessScope.kindergarten), request({}, AccessScope.kindergarten))).toBeNull();
    expect(grantDenial(kgDeputy, target({}, AccessScope.kindergarten), request({}, AccessScope.all))).toBe('too_much');
    expect(grantDenial(kgDeputy, target({}, AccessScope.all), request({}, AccessScope.all))).toBe('too_much');
    expect(grantDenial(kgDeputy, target({}, AccessScope.school_class), request({}, AccessScope.kindergarten))).toBe('too_much');
  });
});
```

`src/access/scope.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupKind } from '@prisma/client';
import {
  assertChildInScope,
  assertKindInScope,
  childScopeWhere,
  groupScopeWhere,
} from './scope';

describe('scope helpers', () => {
  it('builds filters', () => {
    expect(childScopeWhere(null)).toEqual({});
    expect(childScopeWhere(GroupKind.kindergarten)).toEqual({ group: { kind: GroupKind.kindergarten } });
    expect(groupScopeWhere(null)).toEqual({});
    expect(groupScopeWhere(GroupKind.school_class)).toEqual({ kind: GroupKind.school_class });
  });

  it('rejects another kind', () => {
    expect(() => assertKindInScope(null, GroupKind.kindergarten)).not.toThrow();
    expect(() => assertKindInScope(GroupKind.kindergarten, GroupKind.kindergarten)).not.toThrow();
    expect(() => assertKindInScope(GroupKind.kindergarten, GroupKind.school_class)).toThrow(
      new ForbiddenException('Outside access scope'),
    );
    expect(() => assertKindInScope(GroupKind.kindergarten, null)).toThrow('Outside access scope');
  });

  it('hides children outside the scope as not found', async () => {
    const db = { child: { findFirst: jest.fn() } };
    await assertChildInScope(db, null, 'c1');
    expect(db.child.findFirst).not.toHaveBeenCalled();

    db.child.findFirst.mockResolvedValue({ id: 'c1' });
    await assertChildInScope(db, GroupKind.kindergarten, 'c1');
    expect(db.child.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', group: { kind: GroupKind.kindergarten } },
      select: { id: true },
    });

    db.child.findFirst.mockResolvedValue(null);
    await expect(assertChildInScope(db, GroupKind.kindergarten, 'c1')).rejects.toThrow(
      new NotFoundException('Child not found'),
    );
    await expect(
      assertChildInScope(db, GroupKind.kindergarten, 'c1', 'Charge not found'),
    ).rejects.toThrow('Charge not found');
  });
});
```

If the `db` mock literal is not assignable to `Pick<Prisma.TransactionClient, 'child'>`, type the helper's parameter as `{ child: { findFirst(args: Prisma.ChildFindFirstArgs): Promise<{ id: string } | null> } }` instead.

Run `npx jest src/access` → FAIL (modules missing).

- [ ] **Step 2: Implement `src/access/access-calc.ts`**

```ts
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
    if (before !== undefined && !levelSatisfies(held, before)) return 'too_much';
    if (after !== undefined && !levelSatisfies(held, after)) return 'too_much';
  }
  return null;
}
```

- [ ] **Step 3: Implement `src/access/scope.ts`**

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupKind, Prisma } from '@prisma/client';

export const OUTSIDE_SCOPE = 'Outside access scope';

export const childScopeWhere = (
  kind: GroupKind | null,
): Prisma.ChildWhereInput => (kind ? { group: { kind } } : {});

export const groupScopeWhere = (
  kind: GroupKind | null,
): Prisma.GroupWhereInput => (kind ? { kind } : {});

export function assertKindInScope(
  kind: GroupKind | null,
  target: GroupKind | null,
): void {
  if (kind && target !== kind) throw new ForbiddenException(OUTSIDE_SCOPE);
}

export async function assertChildInScope(
  db: Pick<Prisma.TransactionClient, 'child'>,
  kind: GroupKind | null,
  childId: string,
  message = 'Child not found',
): Promise<void> {
  if (!kind) return;
  const found = await db.child.findFirst({
    where: { id: childId, ...childScopeWhere(kind) },
    select: { id: true },
  });
  if (!found) throw new NotFoundException(message);
}
```

- [ ] **Step 4: Run** `npx jest src/access` → PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint --fix src/access
git add src/access
git commit -m "feat: add pure access rules and scope helpers"
```

---

### Task 3: Request user access, `@Permission`, guard, `/auth/me`

**Files:**
- Create: `src/common/decorators/permission.decorator.ts`, `src/auth/guards/roles.guard.spec.ts`
- Modify: `src/common/types/authenticated-user.type.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/auth/guards/roles.guard.ts`, `src/auth/auth.service.ts` (+ its spec), every `*.spec.ts` that builds an `AuthenticatedUser` literal (type-only update)

**Interfaces:**
- Consumes: `hasPermission`, `toPermissionMap`, `allPermissions`, `PermissionMap` (Task 2).
- Produces:
  - `AuthenticatedUser = { id; role; login; mustChangePassword; accessScope: AccessScope; permissions: PermissionMap }`
  - `PERMISSION_KEY`, `Permission(area, level)` decorator
  - guard semantics: no decorators → allow; role listed in `@Roles` → allow; `@Permission` present → allow if `hasPermission` (root always) else 403 `Insufficient permissions`; otherwise deny (Nest default 403 `Forbidden resource`).
  - `GET /auth/me` adds `accessScope` and `permissions` (object area → level; root: `allPermissions('edit')`).

- [ ] **Step 1: Type and decorator**

`src/common/types/authenticated-user.type.ts`:

```ts
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
```

`src/common/decorators/permission.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';

export const PERMISSION_KEY = 'permission';

export interface RequiredPermission {
  area: PermissionArea;
  level: PermissionLevel;
}

export const Permission = (area: PermissionArea, level: PermissionLevel) =>
  SetMetadata(PERMISSION_KEY, { area, level } satisfies RequiredPermission);
```

- [ ] **Step 2: Failing guard tests** (`src/auth/guards/roles.guard.spec.ts`)

```ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope, PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

const context = (user: unknown) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const staff = (role: Role, permissions = {}) => ({
  id: 'u1',
  role,
  login: 'x',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions,
});

describe('RolesGuard', () => {
  const meta: Record<string, unknown> = {};
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  beforeEach(() => {
    meta[ROLES_KEY] = undefined;
    meta[PERMISSION_KEY] = undefined;
  });

  it('allows routes without decorators', () => {
    expect(guard.canActivate(context(staff(Role.parent)))).toBe(true);
  });

  it('allows listed roles', () => {
    meta[ROLES_KEY] = [Role.teacher];
    expect(guard.canActivate(context(staff(Role.teacher)))).toBe(true);
    expect(guard.canActivate(context(staff(Role.admin)))).toBe(false);
  });

  it('does not give root extra access to role-only routes', () => {
    meta[ROLES_KEY] = [Role.parent];
    expect(guard.canActivate(context(staff(Role.root)))).toBe(false);
  });

  it('checks permissions and lets root through', () => {
    meta[PERMISSION_KEY] = { area: PermissionArea.finance, level: PermissionLevel.edit };
    expect(guard.canActivate(context(staff(Role.root)))).toBe(true);
    expect(
      guard.canActivate(context(staff(Role.admin, { finance: PermissionLevel.edit }))),
    ).toBe(true);
    expect(() =>
      guard.canActivate(context(staff(Role.admin, { finance: PermissionLevel.view }))),
    ).toThrow('Insufficient permissions');
    expect(() => guard.canActivate(context(staff(Role.parent)))).toThrow(
      'Insufficient permissions',
    );
  });

  it('allows a listed role even without the permission', () => {
    meta[ROLES_KEY] = [Role.teacher];
    meta[PERMISSION_KEY] = { area: PermissionArea.register, level: PermissionLevel.view };
    expect(guard.canActivate(context(staff(Role.teacher)))).toBe(true);
    expect(
      guard.canActivate(context(staff(Role.admin, { register: PermissionLevel.view }))),
    ).toBe(true);
  });

  it('treats an empty @Roles() override as no role access', () => {
    meta[ROLES_KEY] = [];
    meta[PERMISSION_KEY] = { area: PermissionArea.classes, level: PermissionLevel.edit };
    expect(() => guard.canActivate(context(staff(Role.teacher)))).toThrow(
      'Insufficient permissions',
    );
  });
});
```

(The single `as unknown as` casts here build Nest framework objects, not Prisma mocks; keep them.)

Run `npx jest src/auth/guards` → FAIL.

- [ ] **Step 3: Guard** (`src/auth/guards/roles.guard.ts`)

```ts
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
```

- [ ] **Step 4: JwtStrategy**

```ts
  async validate(payload: { sub: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { permissions: { select: { area: true, level: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return {
      id: user.id,
      role: user.role,
      login: user.login,
      mustChangePassword: user.mustChangePassword,
      accessScope: user.accessScope,
      permissions: toPermissionMap(user.permissions),
    };
  }
```

(import `toPermissionMap` from `../../access/access-calc`). If a `jwt.strategy.spec.ts` exists, update its mocks/expectations.

- [ ] **Step 5: `/auth/me`** — in `AuthService` add `accessScope: true` and `permissions: { select: { area: true, level: true } }` to `profileSelect`, and make `getProfile` return:

```ts
    const { permissions, ...profile } = user;
    return {
      ...profile,
      permissions:
        user.role === Role.root
          ? allPermissions(PermissionLevel.edit)
          : toPermissionMap(permissions),
    };
```

Every other method that returns `profileSelect` data (e.g. contacts update) must return the same shape; route them through one private `toProfile(user)` helper. Update `src/auth/auth.service.spec.ts` expectations accordingly and add a test: root profile has `permissions.payroll === 'edit'`; an admin profile maps rows to an object.

- [ ] **Step 6: Fixtures** — run `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "spec.ts"` (or `npm test`) and, in every spec that builds an `AuthenticatedUser` literal (`grep -rln "mustChangePassword: false" src --include=*.spec.ts`), add `accessScope: AccessScope.all, permissions: {}` (import `AccessScope`). Behaviour does not change in this task: services still use roles.

- [ ] **Step 7: Verify and commit**

```bash
npx eslint --fix src/access src/auth src/common $(grep -rln "mustChangePassword: false" src --include=*.spec.ts)
npm run build && npm test
git add src/auth src/common $(grep -rln "mustChangePassword: false" src --include=*.spec.ts)
git commit -m "feat: load staff permissions into the request user and guard"
```

---

### Task 4: Access management on users

**Files:**
- Create: `src/users/dto/update-access.dto.ts`
- Modify: `src/users/users.controller.ts`, `src/users/users.service.ts`, `src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `grantDenial`, `toPermissionMap` (Task 2); `AuthenticatedUser` (Task 3); `Permission` decorator.
- Produces: `PATCH /users/:id/access` `{ accessScope, permissions: [{ area, level }] }` → user view; user views (`GET /users`, create, update, access) include `accessScope` and `permissions: [{ area, level }]`; role change to `parent` clears access.

- [ ] **Step 1: DTO** (`src/users/dto/update-access.dto.ts`)

```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { AccessScope, PermissionArea, PermissionLevel } from '@prisma/client';

export class PermissionItemDto {
  @IsEnum(PermissionArea)
  area: PermissionArea;

  @IsEnum(PermissionLevel)
  level: PermissionLevel;
}

export class UpdateAccessDto {
  @IsEnum(AccessScope)
  accessScope: AccessScope;

  @IsArray()
  @ArrayMaxSize(11)
  @ValidateNested({ each: true })
  @Type(() => PermissionItemDto)
  permissions: PermissionItemDto[];
}
```

- [ ] **Step 2: Failing service tests** — add to `src/users/users.service.spec.ts` (mock additions: `userPermission: { deleteMany: jest.fn(), createMany: jest.fn() }`, `$transaction: jest.fn()` resolving its array argument):

```ts
  describe('setAccess', () => {
    const actor = {
      id: 'g1',
      role: Role.admin,
      login: 'deputy',
      mustChangePassword: false,
      accessScope: AccessScope.all,
      permissions: { users: PermissionLevel.edit, finance: PermissionLevel.edit },
    };
    const targetRow = (over: Record<string, unknown> = {}) => ({
      id: 't1',
      role: Role.admin,
      accessScope: AccessScope.all,
      permissions: [],
      ...over,
    });

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
      mockPrisma.userPermission.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userPermission.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('replaces permissions and scope', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(targetRow())
        .mockResolvedValueOnce({
          ...targetRow({ permissions: [{ area: PermissionArea.finance, level: PermissionLevel.view }] }),
          login: 'acc',
        });

      const view = await service.setAccess(
        't1',
        { accessScope: AccessScope.all, permissions: [{ area: PermissionArea.finance, level: PermissionLevel.view }] },
        actor,
      );

      expect(mockPrisma.userPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: 't1' } });
      expect(mockPrisma.userPermission.createMany).toHaveBeenCalledWith({
        data: [{ userId: 't1', area: PermissionArea.finance, level: PermissionLevel.view }],
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { accessScope: AccessScope.all },
      });
      expect(view.permissions).toEqual([{ area: PermissionArea.finance, level: PermissionLevel.view }]);
    });

    it('maps denials to errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(targetRow({ role: Role.root }));
      await expect(
        service.setAccess('t1', { accessScope: AccessScope.all, permissions: [] }, actor),
      ).rejects.toThrow('Root access cannot be changed');

      mockPrisma.user.findUnique.mockResolvedValue(targetRow({ role: Role.parent }));
      await expect(
        service.setAccess('t1', { accessScope: AccessScope.all, permissions: [] }, actor),
      ).rejects.toThrow('Access applies to staff only');

      mockPrisma.user.findUnique.mockResolvedValue(targetRow({ id: 'g1' }));
      await expect(
        service.setAccess('g1', { accessScope: AccessScope.all, permissions: [] }, actor),
      ).rejects.toThrow('Cannot change own access');

      mockPrisma.user.findUnique.mockResolvedValue(targetRow());
      await expect(
        service.setAccess(
          't1',
          { accessScope: AccessScope.all, permissions: [{ area: PermissionArea.payroll, level: PermissionLevel.view }] },
          actor,
        ),
      ).rejects.toThrow('Cannot grant more than you have');
      expect(mockPrisma.userPermission.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects duplicates and a missing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(targetRow());
      await expect(
        service.setAccess(
          't1',
          {
            accessScope: AccessScope.all,
            permissions: [
              { area: PermissionArea.finance, level: PermissionLevel.view },
              { area: PermissionArea.finance, level: PermissionLevel.edit },
            ],
          },
          actor,
        ),
      ).rejects.toThrow('Duplicate permission');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setAccess('t1', { accessScope: AccessScope.all, permissions: [] }, actor),
      ).rejects.toThrow('User not found');
    });
  });
```

Also add to the `update` tests: changing a teacher (no salary terms) to `parent` sends `data` containing `permissions: { deleteMany: {} }` and `accessScope: AccessScope.all`.

- [ ] **Step 3: Implement in `UsersService`**

```ts
const permissionSelect = { select: { area: true, level: true } } as const;

  async setAccess(id: string, dto: UpdateAccessDto, actor: AuthenticatedUser) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: permissionSelect },
    });
    if (!target) throw new NotFoundException('User not found');
    const areas = new Set(dto.permissions.map((p) => p.area));
    if (areas.size !== dto.permissions.length)
      throw new BadRequestException('Duplicate permission');
    const denial = grantDenial(
      actor,
      {
        id: target.id,
        role: target.role,
        accessScope: target.accessScope,
        permissions: toPermissionMap(target.permissions),
      },
      {
        accessScope: dto.accessScope,
        permissions: toPermissionMap(dto.permissions),
      },
    );
    if (denial === 'root')
      throw new ForbiddenException('Root access cannot be changed');
    if (denial === 'staff_only')
      throw new BadRequestException('Access applies to staff only');
    if (denial === 'self')
      throw new ForbiddenException('Cannot change own access');
    if (denial === 'too_much')
      throw new ForbiddenException('Cannot grant more than you have');
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId: id } }),
      this.prisma.userPermission.createMany({
        data: dto.permissions.map((p) => ({
          userId: id,
          area: p.area,
          level: p.level,
        })),
      }),
      this.prisma.user.update({
        where: { id },
        data: { accessScope: dto.accessScope },
      }),
    ]);
    const updated = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: permissionSelect },
    });
    const { password: _p, refreshToken: _r, ...view } = updated!;
    return view;
  }
```

Adapt the destructuring to the file's existing style for stripping `password`/`refreshToken` (do not add new lint errors; the file already has `_p`/`_r`). In `findAll`'s `select` add `accessScope: true, permissions: permissionSelect`. In `create` and `update` add `include: { permissions: permissionSelect }` to the Prisma call so the returned object carries them. In `update`, when `dto.role === Role.parent && user.role !== Role.parent`, add to `data`: `permissions: { deleteMany: {} }, accessScope: AccessScope.all` (extend the local `data` type).

- [ ] **Step 4: Controller** — `users.controller.ts`: class decorators `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Permission(PermissionArea.users, PermissionLevel.view)` (remove `@Roles`); `@Permission(PermissionArea.users, PermissionLevel.edit)` on `create`, `delete`, `update`, and the new:

```ts
  @Patch(':id/access')
  @Permission(PermissionArea.users, PermissionLevel.edit)
  setAccess(
    @Param('id') id: string,
    @Body() dto: UpdateAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.setAccess(id, dto, user);
  }
```

Declare `PATCH ':id/access'` before `PATCH ':id'`.

- [ ] **Step 5: Verify and commit**

```bash
npx jest src/users && npm run build && npm test
npx eslint --fix src/users
git add src/users
git commit -m "feat: manage staff access on users"
```

---
### Task 5: Route permissions and permission-based service checks

**Files:**
- Modify: every staff controller listed below; `src/timetable/roles.ts`; `src/attendance/register.service.ts`; `src/attendance/absence-reasons.service.ts`; `src/classes/access.ts`; `src/classes/lessons.service.ts`; `src/meals/meal-views.service.ts`; `src/timetable/{directories,lessons,timetables}.service.ts`; their specs.

**Interfaces:**
- Consumes: `Permission` (Task 3), `hasPermission`, `allPermissions` (Task 2).
- Produces: `assertGroupAccess(group, user, area = PermissionArea.classes)`; `isTimetableManager(user, level)` in `src/timetable/roles.ts`; `canManageRegister(user, level)` in `register.service.ts`.

Rule for every controller: remove `Role.root` and `Role.admin` from `@Roles(...)`. A class-level `@Roles(Role.root, Role.admin)` becomes class-level `@Permission(<area>, PermissionLevel.view)`; every mutation handler (`@Post/@Put/@Patch/@Delete`) gets method-level `@Permission(<area>, PermissionLevel.edit)` unless noted. A list like `@Roles(Role.root, Role.admin, Role.teacher)` becomes `@Roles(Role.teacher)` plus the `@Permission`. A method-level `@Roles(Role.root, Role.admin)` under a class that allows teachers becomes `@Roles()` (empty: no role access) plus `@Permission(<area>, edit)`. Import `PermissionArea`, `PermissionLevel` from `@prisma/client` and `Permission` from `../common/decorators/permission.decorator`; drop unused `Role`/`Roles` imports.

- [ ] **Step 1: Controllers** — apply exactly:

| File | Class level | Method overrides |
|---|---|---|
| `src/groups/groups.controller.ts` | `@Permission(children, view)` | POST, PATCH, DELETE → `children, edit` |
| `src/children/children.controller.ts` | `@Roles(Role.teacher)` + `@Permission(children, view)` | POST, PATCH, DELETE → `children, edit` (teachers keep role access) |
| `src/finance/child-finance.controller.ts` | `@Permission(finance, view)` | `POST charges`, `POST payments` → `finance, edit`; `POST allocation-suggestion` stays `view` |
| `src/finance/finance.controller.ts` | `@Permission(finance, view)` | all POSTs → `finance, edit` |
| `src/tariffs/tariffs.controller.ts`, `enrollments.controller.ts`, `adaptation.controller.ts` | `@Permission(tariffs, view)` | all mutations → `tariffs, edit` |
| `src/tariffs/billing.controller.ts` | `@Permission(tariffs, view)` | `POST billing/run` → `tariffs, edit`; `PATCH settings/billing` → `settings, edit` |
| `src/classes/directions.controller.ts`, `packages.controller.ts` | `@Permission(classes, view)` | all mutations → `classes, edit` |
| `src/classes/class-groups.controller.ts` | `@Roles(Role.teacher)` + `@Permission(classes, view)` | methods now `@Roles(Role.root, Role.admin)` → `@Roles()` + `classes, edit`; `PUT class-groups/:id/lessons/:date` → `classes, edit` (teacher keeps role) |
| `src/subscription-types/subscription-types.controller.ts` | — | GETs `@Roles(Role.teacher)` + `classes, view`; mutations: remove `@Roles`, add `classes, edit` |
| `src/subscriptions/subscriptions.controller.ts`, `attendances.controller.ts` | — | same mapping as above per method (teacher-allowed methods keep `@Roles(Role.teacher)`; GET → `classes, view`; others `classes, edit`) |
| `src/subscriptions/child-subscriptions.controller.ts` | `@Roles(Role.teacher, Role.parent)` + `@Permission(classes, view)` | — |
| `src/attendance/register.controller.ts` | `@Roles(Role.teacher)` + `@Permission(register, view)` | `PUT groups/:id/register` → `register, edit`; `PATCH register/settings` → `@Roles()` + `settings, edit` |
| `src/attendance/calendar.controller.ts` | `@Permission(register, edit)` | `GET` → `@Roles(Role.teacher)` + `register, view` |
| `src/attendance/absence-reasons.controller.ts` | `@Permission(register, edit)` | `GET` → `@Roles(Role.teacher, Role.parent)` + `register, view` |
| `src/attendance/absence-notices.controller.ts` | `@Permission(register, view)` | POSTs → `register, edit` |
| `src/timetable/bell-schedules.controller.ts`, `directories.controller.ts`, `subgroups.controller.ts` | `@Permission(timetable, edit)` | GETs → `@Roles(Role.teacher)` + `timetable, view` |
| `src/timetable/timetables.controller.ts` | `@Permission(timetable, view)` | POST, PUT → `timetable, edit`; `GET groups/:id/schedule` → `@Roles(Role.teacher)` + `timetable, view` |
| `src/timetable/lesson-changes.controller.ts` | `@Permission(timetable, edit)` | — |
| `src/timetable/lessons.controller.ts` | `@Roles(Role.teacher)` + `@Permission(timetable, view)` | `PUT` → `timetable, edit` |
| `src/meals/meal-complexes.controller.ts`, `menus.controller.ts`, `menu-templates.controller.ts` | `@Permission(meals, view)` | mutations → `meals, edit` |
| `src/meals/meal-directories.controller.ts` | `@Permission(meals, view)` | mutations → `meals, edit`; `PATCH meals/settings` → `settings, edit` |
| `src/meals/meal-orders.controller.ts` | `@Permission(meals, view)` | POSTs → `meals, edit`; `GET today` → `@Roles(Role.teacher)` + `meals, view` |
| `src/payroll/payroll.controller.ts`, `salary-terms.controller.ts` | `@Permission(payroll, view)` | mutations → `payroll, edit` |
| `src/backups/backups.controller.ts` | `@Permission(backups, view)` | `POST` → `backups, edit` |

Unchanged: parent controllers, `my-payroll.controller.ts` (`@Roles(Role.teacher)`), auth/me controllers, `users.controller.ts` (done in Task 4). After editing, `grep -rn "Role.admin" src --include=*.controller.ts` must return nothing, and `grep -rn "Role.root" src --include=*.controller.ts` must return nothing.

- [ ] **Step 2: Service checks** — replace role checks with permissions:
  - `src/timetable/roles.ts`: replace `isAdmin` with

    ```ts
    import { PermissionArea, PermissionLevel } from '@prisma/client';
    import { hasPermission } from '../access/access-calc';
    import type { AuthenticatedUser } from '../common/types/authenticated-user.type';

    export const isTimetableManager = (
      user: AuthenticatedUser,
      level: PermissionLevel = PermissionLevel.view,
    ): boolean => hasPermission(user, PermissionArea.timetable, level);
    ```

    Update callers: `directories.service.ts` (show inactive) → `isTimetableManager(user)`; `lessons.service.ts:35` (choose another teacher) → `isTimetableManager(user)`; `lessons.service.ts:88` (record a lesson that is not yours), `:169-170` (`canEdit`/`needsReason`), `:217` → `isTimetableManager(user, PermissionLevel.edit)`; `timetables.service.ts:295` → `isTimetableManager(user)`.
  - `src/attendance/register.service.ts`: replace `isAdmin` with `const canManageRegister = (user: AuthenticatedUser, level: PermissionLevel = PermissionLevel.view) => hasPermission(user, PermissionArea.register, level);` — lines 65 and 82 use `view`; 152, 153, 205 use `edit`.
  - `src/attendance/absence-reasons.service.ts:17` → `hasPermission(user, PermissionArea.register, PermissionLevel.view)`.
  - `src/classes/access.ts`:

    ```ts
    export function assertGroupAccess(
      group: { teachers: { id: string }[] },
      user: AuthenticatedUser,
      area: PermissionArea = PermissionArea.classes,
    ) {
      if (
        !group.teachers.some((t) => t.id === user.id) &&
        !hasPermission(user, area, PermissionLevel.view)
      ) {
        throw new ForbiddenException('Not your class group');
      }
    }
    ```

    `meal-views.service.ts:98` passes `PermissionArea.meals`.
  - `src/classes/lessons.service.ts:170`: `const isTeacher = !hasPermission(user, PermissionArea.classes, PermissionLevel.edit);`
  - Leave untouched: checks that a target user IS a teacher (`class-groups.service.ts:34`, `groups.service.ts:27`, payroll, lesson-changes, timetables `role: Role.teacher` queries) and `meal-orders.service.ts` parent checks.

- [ ] **Step 3: Tests** — in the specs of the services above, admin/root fixtures that expect manager behaviour get `permissions: allPermissions(PermissionLevel.edit)` (root fixtures keep `{}`: root passes by role). Add tests:
  - register: a teacher with `{ register: 'view' }` gets all groups from `groupsFor` (no `teachers.some` filter); a teacher without it gets only own groups; a teacher with `{ register: 'edit' }` gets `canEdit` outside the window and `needsReason: true`.
  - classes `assertGroupAccess`: teacher of the group passes; other teacher with `{ classes: 'view' }` passes; admin with `{}` throws `Not your class group`.
  - timetable lessons: a teacher with `{ timetable: 'edit' }` can record another teacher's lesson.
- [ ] **Step 4: Verify and commit**

```bash
npx eslint --fix src
npm run build && npm test
git add src
git commit -m "feat: guard staff routes by permissions"
```

`git add src` is acceptable here only if `git status` shows nothing outside the intended controllers/services/specs; otherwise add files explicitly.

---

### Task 6: Scope for children and groups

**Files:**
- Modify: `src/children/children.controller.ts`, `children.service.ts` (+spec), `src/groups/groups.controller.ts`, `groups.service.ts` (+spec)

**Interfaces:**
- Consumes: `scopeKind` (Task 2), `childScopeWhere`, `groupScopeWhere`, `assertKindInScope` (Task 2).
- Produces: `ChildrenService.findAll(user)`, `.create(dto, user)`, `.update(id, dto, user)`, `.delete(id, user)`; `GroupsService.findAll(user)`, `.create(dto, user)`, `.update(id, dto, user)`, `.delete(id, user)`.

Controllers pass `@CurrentUser() user: AuthenticatedUser` to every method. Rules (with `kind = scopeKind(user)`):

- `ChildrenService.findAll(user)`: `where: childScopeWhere(kind)` (teachers by role keep today's list: apply the scope only when the caller is not a teacher acting by role — i.e. compute `kind` only when `hasPermission(user, children, view)`; a plain teacher gets the unscoped list as today).
- `create(dto, user)`: if `dto.groupId` load the group (existing 404) and `assertKindInScope(kind, group.kind)`; if no `groupId` and `kind` is set → 403 `Outside access scope`.
- `update(id, dto, user)`: load child with group; if `kind` and the child's group kind !== kind (or no group) → 404 `Child not found`; a new `dto.groupId` → `assertKindInScope(kind, newGroup.kind)`; `dto.groupId === null` with `kind` set → 403 `Outside access scope`.
- `delete(id, user)`: same 404 rule before the existing checks.
- `GroupsService.findAll(user)`: `where: groupScopeWhere(kind)`; create/update/delete: `assertKindInScope(kind, dto.kind ?? group.kind)` for create/update kind changes; update/delete of a group of another kind → 404 `Group not found`.

- [ ] **Step 1: Failing tests** (add to `children.service.spec.ts`; adapt mock names to the file):

```ts
  describe('scope', () => {
    const kgAdmin = {
      id: 'a1',
      role: Role.admin,
      login: 'kg',
      mustChangePassword: false,
      accessScope: AccessScope.kindergarten,
      permissions: { children: PermissionLevel.edit },
    };

    it('lists only children of the scope', async () => {
      mockPrisma.child.findMany.mockResolvedValue([]);
      await service.findAll(kgAdmin);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { group: { kind: GroupKind.kindergarten } } }),
      );
    });

    it('refuses a child in a group of another kind', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', kind: GroupKind.school_class });
      await expect(service.create({ ...validDto, groupId: 'g1' }, kgAdmin)).rejects.toThrow(
        'Outside access scope',
      );
    });

    it('refuses a child without a group for a scoped user', async () => {
      await expect(service.create({ ...validDto, groupId: undefined }, kgAdmin)).rejects.toThrow(
        'Outside access scope',
      );
    });

    it('hides a child of another kind on update and delete', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'c1',
        groupId: 'g2',
        group: { kind: GroupKind.school_class },
      });
      await expect(service.update('c1', {}, kgAdmin)).rejects.toThrow('Child not found');
      await expect(service.delete('c1', kgAdmin)).rejects.toThrow('Child not found');
    });
  });
```

(`validDto` = the create DTO the spec already uses; existing tests get a full-access admin user argument.) Mirror the four cases for groups (`findAll` where `{ kind }`, create of another kind → 403, update/delete of another kind → 404 `Group not found`).

- [ ] **Step 2: Implement**, run `npx jest src/children src/groups`, then `npm test`, `npm run build`.
- [ ] **Step 3: Commit** `feat: scope children and groups by kindergarten or school`.

---

### Task 7: Scope for finance and tariffs

**Files:**
- Modify: `src/finance/{finance,charges,payments}.service.ts` (+specs), `src/finance/{finance,child-finance}.controller.ts`, `src/tariffs/{enrollments,adaptation,billing}.service.ts` (+specs), `src/tariffs/{enrollments,adaptation,billing}.controller.ts`

**Interfaces:**
- Consumes: `scopeKind`, `childScopeWhere`, `assertChildInScope`, `OUTSIDE_SCOPE`.
- Produces: every listed service method gains a trailing `user: AuthenticatedUser` parameter (or receives `kind: GroupKind | null` from the controller-facing method) — controllers pass `@CurrentUser()`.

Rules (`kind = scopeKind(user)`):

- `FinanceService.getBalances(query, user)`: `child.findMany({ where: childScopeWhere(kind), … })`.
- `getChildFinance`, `getHistory`, `suggest` (childId): `await assertChildInScope(this.prisma, kind, childId)` before the existing `findChild`.
- `ChargesService.create(childId, …)`, `PaymentsService.create(childId, …)`: `assertChildInScope` with `Child not found`.
- `ChargesService.void(id, …)`: load the charge's `childId` first; out of scope → 404 `Charge not found`. `PaymentsService.allocate(paymentId, …)`, `void(id, …)` → 404 `Payment not found`; `voidAllocation(id, …)` → load allocation → payment → child; out of scope → 404 `Allocation not found`. Use the existing not-found messages of each service (check the file; keep them identical).
- `EnrollmentsService.listForChild/create(childId)`: `assertChildInScope`; `end(id)`, `addAdjustment(enrollmentId)`, `voidAdjustment(id)`: resolve the child (`childIdOf` exists for enrollments; for adjustments load `enrollment.childId`), out of scope → 404 `Enrollment not found` / `Adjustment not found` (existing messages).
- `AdaptationService.listForChild/create(childId)`: `assertChildInScope`; `void(id)` → 404 with its existing message.
- `BillingService.problems(today, user?)`: filter problems to children in scope (filter rows by the child's group kind; add `group: { select: { kind: true } }` to the query if needed). `billEnrollment` (enrollment route) → enrollment child in scope else 404. `runAll` via `POST billing/run`: the controller checks `scopeKind(user) !== null` → 403 `Outside access scope`; the 03:00 scheduler calls `runAll` directly and is unaffected. `recalculate(billedPeriodId)` → child of the billed period in scope else 404 with the existing message.

- [ ] **Step 1: Failing tests** — for each of: `getBalances` passes `where: { group: { kind } }`; `getChildFinance` for an out-of-scope child → `Child not found` without loading records; `ChargesService.void` out of scope → its not-found message and no update; `PaymentsService.create` out of scope → `Child not found`; `EnrollmentsService.create` out of scope → `Child not found`; `BillingController/Service` run with a scoped user → `Outside access scope`; `problems` returns only in-scope rows. Example:

```ts
  it('hides an out-of-scope child', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(service.getChildFinance('c1', kgAccountant)).rejects.toThrow('Child not found');
    expect(mockPrisma.charge.findMany).not.toHaveBeenCalled();
  });
```

(`kgAccountant`: role admin, `accessScope: kindergarten`, `permissions: { finance: 'edit', tariffs: 'edit' }`; add `child: { findFirst: jest.fn() }` to mocks where missing.)

- [ ] **Step 2: Implement**, run `npx jest src/finance src/tariffs`, `npm test`, `npm run build`.
- [ ] **Step 3: Commit** `feat: scope finance and tariffs by kindergarten or school`.

---

### Task 8: Scope for the register, notices and calendar

**Files:**
- Modify: `src/attendance/{register,notices,calendar}.service.ts` (+specs), their controllers

**Interfaces:**
- Consumes: `scopeKind`, `groupScopeWhere`, `childScopeWhere`, `assertKindInScope`.
- Produces: `NoticesService.list(query, user)`, `approve/reject/cancel(id, …, user)` (already take user), `CalendarService.list(from, to, groupId, user)`, `create(dto, user)`, `void(id, reason, user)`.

Rules (`kind = scopeKind(user)`, only for users acting by permission, not plain teachers who are limited to own groups already):

- `RegisterService.groupsFor(user)`: managers get `where: groupScopeWhere(kind)`; `day/save/month` on a group of another kind → 404 `Group not found` (existing message).
- `NoticesService.list`: `where.child = childScopeWhere(kind)` merged with existing filters; `approve/reject/cancel` on a notice whose child is outside → 404 with the existing notice-not-found message.
- `CalendarService.list`: scoped managers see entries with `scope` equal to their kind or `all`, and group entries of their kind's groups; `create`: `scope = all` → 403 `Outside access scope`; `scope = kindergarten|school_class` must equal `kind`; `scope = group` → the group's kind must equal `kind`; `void` of an entry outside these rules → 403 `Outside access scope`.

- [ ] **Step 1: Failing tests** — scoped admin: `groupsFor` where `{ kind }`; `save` for a school group by a kindergarten-scoped user → `Group not found`; notices `list` adds `child: { group: { kind } }`; `approve` out of scope → not found; calendar `create` with scope `all` → `Outside access scope`, with scope `kindergarten` for a kindergarten user → created; `void` of an `all` entry → `Outside access scope`; teacher without permissions keeps own-groups behaviour.
- [ ] **Step 2: Implement**, run `npx jest src/attendance`, `npm test`, `npm run build`.
- [ ] **Step 3: Commit** `feat: scope the register, notices and calendar`.

---

### Task 9: Scope for meals, docs, live check

**Files:**
- Modify: `src/meals/{menus,menu-templates,meal-orders,meal-views}.service.ts` (+specs) and controllers; `CLAUDE.md`

**Interfaces:**
- Consumes: `scopeKind`, `assertKindInScope`, `assertChildInScope`, `childScopeWhere`.

Rules (`kind = scopeKind(user)`):

- `MenusService.list(query, user)`: if `kind` and `query.kind` differs → 403 `Outside access scope`; if no `query.kind` filter, restrict to `kind`. `saveDay/deleteDay(date, kindParam, …, user)`: `assertKindInScope(kind, kindParam)`. `publish/unpublish/copy/fill` with a `kind` in the DTO → same check; without a kind in the DTO and `kind` set → restrict to `kind`.
- `MenuTemplatesService`: templates have no kind and stay shared; only `apply(id, dto, user)` checks `assertKindInScope(kind, dto.kind)` (its DTO carries the target kind).
- `MealOrdersService.create(childId, …, user)` (staff path) → `assertChildInScope`; `cancel(id, …, user)` staff path → order's child in scope else 404 `Order not found`. Parent paths unchanged.
- `MealViewsService.adminList(query, user)`: add `child: childScopeWhere(kind)`; `today(groupId, user)`: group of another kind → 404 `Group not found` for permission holders.

- [ ] **Step 1: Failing tests** for each rule above (one test per rule, same style as Task 6).
- [ ] **Step 2: Implement**, run `npx jest src/meals`, `npm test`, `npm run build`, `npx eslint src`.
- [ ] **Step 3: CLAUDE.md** — replace the "Authorization pattern" section's role list paragraph with:

```markdown
Controllers use `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles(...)` and/or `@Permission(area, level)` (class or method level, method overrides class). `RolesGuard` allows a request when no decorator is set, when the user's role is listed in `@Roles`, or when the route has `@Permission` and `hasPermission` passes (root always; `edit` satisfies `view`), else 403 (`Insufficient permissions` for permission routes). Staff routes use `@Permission` only; teacher-shared routes use `@Roles(Role.teacher)` + `@Permission`; parent routes use `@Roles(Role.parent)`. Never put `Role.admin` or `Role.root` in `@Roles` on new routes.

Spec: `docs/superpowers/specs/2026-10-15-access-control-design.md`. `UserPermission` rows (area × `view`/`edit`) and `User.accessScope` (`all`/`kindergarten`/`school_class`) are loaded into `AuthenticatedUser` by `JwtStrategy`. Pure rules live in `src/access/access-calc.ts` (`hasPermission`, `scopeKind`, `grantDenial`); scope helpers in `src/access/scope.ts`. Areas: users, children, finance, tariffs, classes, register, timetable, meals, payroll, backups, settings. The scope applies to children/groups, finance, tariffs, register, meals via the child's group kind: lists are filtered, single records outside answer 404 with their usual message, creating/moving into another kind → 403 `Outside access scope`; children without a group only with scope `all`. `PATCH /users/:id/access` replaces a user's access; a granter (non-root) needs `users: edit` and can grant/remove only areas they hold at that level, within their scope, never for themselves (`Cannot change own access`, `Cannot grant more than you have`, `Root access cannot be changed`, `Access applies to staff only`, `Duplicate permission`). A teacher with a permission acts as a manager in that area.
```

Keep the existing bullet list about root/parents below it, updating "admin cannot create/update a user into root" (unchanged rule).

- [ ] **Step 4: Live check (PORT=3101)** — start your own server; log in as root (credentials from `.env`, never printed). Create test users prefixed «Тест Д»:
  1. `GET /auth/me` as root → `permissions.payroll === 'edit'`.
  2. Existing admins: `GET /users` → each `admin` has 11 permissions `edit`, scope `all`.
  3. Create admin «Тест Д Бухгалтер» (`POST /users`, role `admin`, login `test_access_acc`, a password you choose; staff are created without a forced password change), `PATCH /users/:id/access` `{ accessScope: 'kindergarten', permissions: [finance edit, children view] }` → 200.
  4. Log in as that user: `GET /finance/balances` → 200, only kindergarten children; `GET /payroll?month=<current>` → 403 `Insufficient permissions`; `GET /children/<a school child id>/finance` → 404 `Child not found`; `PATCH /users/<own id>/access` → 403 (users permission missing → `Insufficient permissions`).
  5. As root give that user `users: edit` too; as that user `PATCH /users/<another admin>/access` with `payroll: view` → 403 `Cannot grant more than you have`; with own id → 403 `Cannot change own access`.
  6. As root: `GET /payroll?month=…`, `GET /backups` → 200.
  Stop only your server; leave «Тест Д» data and list its ids.
- [ ] **Step 5: Commit**

```bash
git add src/meals CLAUDE.md
git commit -m "feat: scope meals and document access control"
```

---
### Task 10: Frontend access types, API, translations, access dialog

**Repo:** `D:\IT\EduNest` (read its `CLAUDE.md` first).

**Files:**
- Create: `src/shared/api/access.ts`, `src/pages/users/ui/AccessDialog.tsx`, `src/entities/user/model/access.ts`
- Modify: `src/shared/api/index.ts`, `src/shared/api/users.ts`, `src/shared/api/errorMessages.ts`, `src/entities/user/model/types.ts`, `src/entities/user/index.ts`, `src/pages/users/ui/UsersPage.tsx`, `src/pages/users/model/usersStore.ts`

**Interfaces:**
- Consumes: backend `PATCH /users/:id/access`, user views with `accessScope` + `permissions: [{ area, level }]`, `GET /auth/me` with `accessScope` + `permissions` object.
- Produces: `PermissionArea`, `PermissionLevel`, `AccessScope` types, `ALL_AREAS`, `areaLabels`, `scopeLabels`, `levelLabels`, `accessTemplates`, `levelSatisfies` (shared/api/access.ts); `canAccess(profile, area, level)` and `useCan(area, level)` (entities/user); `usersApi.setAccess(id, dto)`.

- [ ] **Step 1: Branch and baseline**

```bash
cd /d/IT/EduNest && git checkout main && git checkout -b feature/access-control
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" > "C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad/fe-tsc-baseline-access.txt"
```

- [ ] **Step 2: `src/shared/api/access.ts`**

```ts
export type PermissionArea =
  | 'users'
  | 'children'
  | 'finance'
  | 'tariffs'
  | 'classes'
  | 'register'
  | 'timetable'
  | 'meals'
  | 'payroll'
  | 'backups'
  | 'settings';
export type PermissionLevel = 'view' | 'edit';
export type AccessScope = 'all' | 'kindergarten' | 'school_class';
export type PermissionMap = Partial<Record<PermissionArea, PermissionLevel>>;

export interface PermissionItem {
  area: PermissionArea;
  level: PermissionLevel;
}

export interface UpdateAccessDto {
  accessScope: AccessScope;
  permissions: PermissionItem[];
}

export const areaLabels: Record<PermissionArea, string> = {
  users: 'Користувачі',
  children: 'Діти й групи',
  finance: 'Фінанси',
  tariffs: 'Тарифи й договори',
  classes: 'Гуртки й пакети',
  register: 'Журнал відвідування',
  timetable: 'Розклад школи',
  meals: 'Харчування',
  payroll: 'Зарплати',
  backups: 'Резервні копії',
  settings: 'Налаштування',
};

export const ALL_AREAS = Object.keys(areaLabels) as PermissionArea[];

export const levelLabels: Record<PermissionLevel, string> = {
  view: 'Перегляд',
  edit: 'Зміна',
};

export const scopeLabels: Record<AccessScope, string> = {
  all: 'Усе',
  kindergarten: 'Садочок',
  school_class: 'Школа',
};

const RANK: Record<PermissionLevel, number> = { view: 1, edit: 2 };

export const levelSatisfies = (have: PermissionLevel | undefined, need: PermissionLevel) =>
  have !== undefined && RANK[have] >= RANK[need];

export interface AccessTemplate {
  name: string;
  accessScope: AccessScope;
  permissions: PermissionMap;
}

const all = (level: PermissionLevel): PermissionMap =>
  Object.fromEntries(ALL_AREAS.map((area) => [area, level]));

export const accessTemplates: AccessTemplate[] = [
  { name: 'Адміністратор', accessScope: 'all', permissions: all('edit') },
  {
    name: 'Бухгалтер',
    accessScope: 'all',
    permissions: { finance: 'edit', tariffs: 'edit', payroll: 'edit', children: 'view' },
  },
  {
    name: 'Завуч школи',
    accessScope: 'school_class',
    permissions: { register: 'edit', timetable: 'edit', children: 'edit' },
  },
  {
    name: 'Керівник садочка',
    accessScope: 'kindergarten',
    permissions: { register: 'edit', children: 'edit', meals: 'edit', finance: 'view' },
  },
  { name: 'Відповідальний за харчування', accessScope: 'all', permissions: { meals: 'edit' } },
];
```

Re-export from `src/shared/api/index.ts` (values and `export type` separately). In `src/shared/api/users.ts` add `setAccess: (id: string, dto: UpdateAccessDto) => axiosInstance.patch<User>(\`/users/${id}/access\`, dto)`.

- [ ] **Step 3: Entity types** — `src/entities/user/model/types.ts`: add `'admin'` to `UserRole` if missing (keep `roleLabels` complete: `admin: 'Адміністратор'`); add to `User` `accessScope?: AccessScope; permissions?: PermissionItem[]`; add to `SessionProfile` `accessScope: AccessScope; permissions: PermissionMap`. (Imports from `../../../shared/api` with `import type`.) If adding `'admin'` to `UserRole` breaks a `Record<UserRole, …>` elsewhere, add the missing entry there.

`src/entities/user/model/access.ts`:

```ts
import { levelSatisfies, type PermissionArea, type PermissionLevel } from '../../../shared/api'
import type { SessionProfile } from './types'
import { useAuthStore } from './authStore'

export const canAccess = (
  profile: SessionProfile | null,
  area: PermissionArea,
  level: PermissionLevel,
): boolean => {
  if (!profile) return false
  if (profile.role === 'root') return true
  return levelSatisfies(profile.permissions?.[area], level)
}

export const useCan = (area: PermissionArea, level: PermissionLevel): boolean =>
  useAuthStore((s) => canAccess(s.profile, area, level))
```

Export `canAccess`, `useCan` from `src/entities/user/index.ts`.

- [ ] **Step 4: Translations** — add to `errorMessages`:

```ts
  'Insufficient permissions': 'Недостатньо прав',
  'Outside access scope': 'Поза межами вашого доступу',
  'Cannot change own access': 'Не можна змінювати власний доступ',
  'Cannot grant more than you have': 'Не можна надати більше прав, ніж маєте самі',
  'Root access cannot be changed': 'Доступ головного адміністратора не змінюється',
  'Access applies to staff only': 'Доступ налаштовується лише для персоналу',
  'Duplicate permission': 'Розділ повторюється',
```

- [ ] **Step 5: Access dialog** (`src/pages/users/ui/AccessDialog.tsx`)

```tsx
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import {
  ALL_AREAS,
  accessTemplates,
  areaLabels,
  levelLabels,
  levelSatisfies,
  scopeLabels,
  usersApi,
  type AccessScope,
  type PermissionLevel,
  type PermissionMap,
} from '../../../shared/api'
import { useAuthStore, type User } from '../../../entities/user'

interface Props {
  user: User
  onClose: () => void
  onSaved: (user: User) => void
}

const scopes = Object.keys(scopeLabels) as AccessScope[]

const toMap = (user: User): PermissionMap =>
  Object.fromEntries((user.permissions ?? []).map((p) => [p.area, p.level]))

export const AccessDialog = ({ user, onClose, onSaved }: Props) => {
  const profile = useAuthStore((s) => s.profile)
  const [scope, setScope] = useState<AccessScope>(user.accessScope ?? 'all')
  const [permissions, setPermissions] = useState<PermissionMap>(toMap(user))
  const [saving, setSaving] = useState(false)
  const isRoot = profile?.role === 'root'
  const readOnly = !profile || profile.id === user.id || user.role === 'root'
  const allowed = (level: PermissionLevel, area: (typeof ALL_AREAS)[number]) =>
    isRoot || levelSatisfies(profile?.permissions?.[area], level)
  const scopeAllowed = (value: AccessScope) =>
    isRoot || profile?.accessScope === 'all' || profile?.accessScope === value

  const applyTemplate = (name: string) => {
    const template = accessTemplates.find((t) => t.name === name)
    if (!template) return
    setScope(template.accessScope)
    setPermissions(template.permissions)
  }

  const setLevel = (area: (typeof ALL_AREAS)[number], value: PermissionLevel | 'none') => {
    setPermissions((current) => {
      const next = { ...current }
      if (value === 'none') delete next[area]
      else next[area] = value
      return next
    })
  }

  const save = () => {
    setSaving(true)
    usersApi
      .setAccess(user.id, {
        accessScope: scope,
        permissions: ALL_AREAS.flatMap((area) =>
          permissions[area] ? [{ area, level: permissions[area] }] : [],
        ),
      })
      .then(({ data }) => {
        onSaved(data)
        onClose()
      })
      .catch(() => undefined)
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>
        Доступ: {user.lastName} {user.firstName}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {readOnly && (
            <Typography variant="body2" color="text.secondary">
              Цей доступ не можна змінити тут.
            </Typography>
          )}
          <TextField
            select
            label="Шаблон посади"
            value=""
            disabled={readOnly}
            onChange={(event) => applyTemplate(event.target.value)}
          >
            {accessTemplates.map((template) => (
              <MenuItem key={template.name} value={template.name}>
                {template.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Обмеження"
            value={scope}
            disabled={readOnly}
            onChange={(event) => setScope(event.target.value as AccessScope)}
          >
            {scopes.map((value) => (
              <MenuItem key={value} value={value} disabled={!scopeAllowed(value)}>
                {scopeLabels[value]}
              </MenuItem>
            ))}
          </TextField>
          <Table size="small">
            <TableBody>
              {ALL_AREAS.map((area) => (
                <TableRow key={area}>
                  <TableCell>{areaLabels[area]}</TableCell>
                  <TableCell align="right">
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      disabled={readOnly}
                      value={permissions[area] ?? 'none'}
                      onChange={(_, value: PermissionLevel | 'none' | null) => {
                        if (value) setLevel(area, value)
                      }}
                    >
                      <ToggleButton value="none" disabled={!allowed('view', area) && !!permissions[area]}>
                        Немає
                      </ToggleButton>
                      <ToggleButton value="view" disabled={!allowed('view', area)}>
                        {levelLabels.view}
                      </ToggleButton>
                      <ToggleButton value="edit" disabled={!allowed('edit', area)}>
                        {levelLabels.edit}
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Скасувати</Button>
        <Button variant="contained" disabled={readOnly || saving} onClick={save}>
          Зберегти
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

If `react-hooks/set-state-in-effect` or other lint rules complain, keep the logic but follow the reported fix. The `as AccessScope` cast on a select value is acceptable (MUI types `event.target.value` as `string`).

- [ ] **Step 6: Wire into the users page** — in `UsersPage.tsx` add a «Доступ» action (icon button with tooltip, e.g. `AdminPanelSettingsIcon`) on rows whose role is not `parent`, visible only when `useCan('users', 'edit')`; open `AccessDialog` (local state `accessUser`), and `onSaved` replaces the row in the users store (add a store action `replaceUser(user: User)` that maps the list). Show the role label `Адміністратор` for admins.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" | diff - "C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad/fe-tsc-baseline-access.txt"
npx eslint src/shared/api/access.ts src/shared/api/index.ts src/shared/api/users.ts src/shared/api/errorMessages.ts src/entities/user src/pages/users
git add src/shared/api/access.ts src/shared/api/index.ts src/shared/api/users.ts src/shared/api/errorMessages.ts src/entities/user src/pages/users
git commit -m "feat: add staff access dialog"
```

---

### Task 11: Permission-aware navigation and read-only pages, docs

**Repo:** `D:\IT\EduNest`, branch `feature/access-control`.

**Files:**
- Modify: `src/widgets/sidebar/model/nav-items.ts`, `src/widgets/sidebar/ui/Sidebar.tsx`, staff pages listed below, `CLAUDE.md`

**Interfaces:**
- Consumes: `canAccess`, `useCan` (Task 10).

- [ ] **Step 1: Navigation** — `NavItem` gets `area?: PermissionArea`. Visibility: `(item.roles?.includes(role)) || (item.area && canAccess(profile, item.area, 'view')) || (!item.roles && !item.area)`. Replace `roles: ADMIN` with areas: `/schedule` → `timetable`; `/meals` → `meals`; `/payroll` → `payroll`; `/absence-notices` → `register`; `/users` → `users`; `/groups`, `/students` → `children`; `/finance` → `finance`; `/tariffs` → `tariffs`; `/classes` → `classes`; `/calendar`, `/absence-reasons` → `register`; `/schedule-setup` → `timetable`; `/backups` → `backups`; `/settings` → `settings`. `/register` keeps `roles: ['teacher']` plus `area: 'register'`. Teacher-only items (`/my-classes`, `/my-lessons`, `/my-payroll`) unchanged. In `Sidebar.tsx` the pending-notices refresh runs when `canAccess(profile, 'register', 'view')` instead of the role check.

- [ ] **Step 2: Read-only pages** — in each page below compute `const canEdit = useCan('<area>', 'edit')` once in the page (or the tab component) and render create / edit / delete / void / approve / publish / save buttons only when `canEdit` (forms opened from those buttons then never open). Pages → area: `pages/users` → `users`; `pages/groups`, `pages/children` → `children`; `pages/finance` (balances page and `ChildFinancePage`) → `finance`; `pages/tariffs` → `tariffs`; `pages/classes`, `pages/classGroup` (admin actions only; teachers keep marking own lessons) → `classes`; `pages/calendar`, `pages/absenceReasons`, `pages/absenceNotices` → `register`; `pages/scheduleSetup`, `pages/schedule` → `timetable`; `pages/meals` → `meals`; `pages/payroll` → `payroll`; `pages/backups` → `backups`. Settings controls inside pages (register edit window on the calendar page, billing lead days, meals deadline) use `useCan('settings', 'edit')`.

- [ ] **Step 3: Docs** — frontend `CLAUDE.md`: add a paragraph after «Backups»:

```markdown
Access control: staff permissions come from `GET /auth/me` (`permissions`: area → `view`/`edit`, `accessScope`). Use `useCan(area, level)` / `canAccess(profile, area, level)` from `entities/user` to show navigation items (`NavItem.area`) and hide change buttons on read-only pages; the backend still enforces everything (403 `Insufficient permissions`, 404/403 for records outside the kindergarten/school scope). Access is edited in `pages/users/ui/AccessDialog.tsx` (templates pre-fill the form; options above the current user's own rights are disabled).
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" | diff - "C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad/fe-tsc-baseline-access.txt"
npx eslint src/widgets src/pages src/entities
git add src/widgets src/pages CLAUDE.md
git commit -m "feat: show navigation and actions by staff permissions"
```

`git add src/pages` only after `git status` confirms no untracked `* 2.tsx` files would be included; otherwise add files explicitly.
