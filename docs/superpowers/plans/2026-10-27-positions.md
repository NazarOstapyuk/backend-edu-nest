# Positions («Посади») Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-user staff permissions with positions: named permission sets (with a "teaching" flag that decides `User.role`) assigned to staff users.

**Architecture:** New `Position` + `PositionPermission` tables and `User.positionId`; a data migration turns today's per-user permission sets into positions; `JwtStrategy` / `AuthService` build the permission map from the position so guards stay untouched. New `src/positions/` CRUD module; users create/update/access switch from `role`/`permissions` to `positionId`. `UserPermission` is dropped in a second migration once no code reads it. Frontend gets a «Посади» page and a «Посада» select in the user forms and access dialog.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL 16), Jest; React 19, MUI 9, Zustand 5, react-hook-form + yup.

**Spec:** `docs/superpowers/specs/2026-10-27-positions-design.md`

## Global Constraints

- Backend repo `D:\IT\backend-edu-nest`, frontend repo `D:\IT\EduNest` (read its `CLAUDE.md` before frontend tasks). Windows; files are CRLF; use the Edit tool for edits.
- Error messages in English, exactly: `Position not found` (404), `Position name already taken` (409), `Position is in use` (400), `Position type cannot change` (400), `Position is required` (400), `Duplicate permission` (400), `Cannot grant more than you have` (403), `Cannot change own access` (403), `Outside access scope` (403), `Access applies to staff only` (400), `Root access cannot be changed` (403), `User has salary terms` (400).
- Position name: trimmed, 1–100 chars, unique. Positions are global (no institution).
- Invariant: `admin`/`teacher` users always have `positionId`; `root`/`parent` never. `role = teacher` iff the position is `teaching`, else `admin`.
- Non-root position writes need granted scope `all` (`baseScope(actor) === null`) and the actor must hold every permission of the position before and after (any write incl. rename). Root bypasses.
- "Position has users" counts inactive users too.
- No code comments. No new dependencies. Don't touch `README.md`, CORS, ValidationPipe, cookies, JWT config. Don't edit applied migrations. Never reset or drop the local DB.
- Migrations: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<name>/migration.sql` (strip any "Loaded Prisma config" line), then `npx prisma migrate deploy`, `npx prisma generate`, and `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` must print "No difference detected."
- Backend checks: `npx eslint <changed files>` (not `npm run lint`), `npm run build`, `npx jest <paths>`; full `npm test` at the end. Frontend checks: `npm run build` + `npm run lint` (baseline 7 problems: 1 error in `EditUserModal.tsx` `useForm<any>`, 6 warnings; must not grow).
- Commits: Conventional, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One task = one commit per repo. Don't push.

## Review Focus

- Migration on real data: an admin with zero permissions, an admin with all 12 at `edit`, a teacher with extra permissions, and an admin and a teacher with the same set must each end up with a position whose map equals their old map, and admin/teacher with equal sets get different positions (teaching differs). Covered by the Task 1 verification query.
- Root and parents never get a position, including root rows with stray `UserPermission` rows. Task 1 query + Task 4 tests.
- An actor editing the position they hold themselves → 403 `Cannot change own access`, even when they are allowed everything else. Task 3 test.
- Flipping `teaching` while a concurrent request assigns that position: the position row is locked `FOR UPDATE` in position writes and `FOR SHARE` in user assignment. Task 3/4 tests assert the lock query is issued.
- A deactivated user keeps a position "in use": delete and teaching change refuse. Task 3 test (count query has no `isActive` filter).

---

### Task 1: Schema and data migration (backend)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261027100000_positions/migration.sql`

**Interfaces:**
- Produces: Prisma models `Position { id, name @unique, teaching Boolean, createdAt, updatedAt, permissions PositionPermission[], users User[] }`, `PositionPermission { id, positionId (onDelete Cascade), area PermissionArea, level PermissionLevel, @@unique([positionId, area]) }`, `User.positionId String?` + `position Position? @relation(onDelete: Restrict)`. `UserPermission` stays in this task.

- [ ] **Step 1: Snapshot current access** — run in `docker exec edu_postgres psql -U postgres -d edu_db`: `SELECT u.id, u.role, string_agg(p.area||':'||p.level, ',' ORDER BY p.area::text) FROM "User" u LEFT JOIN "UserPermission" p ON p."userId"=u.id GROUP BY u.id, u.role ORDER BY u.id;` and save the output to the scratchpad.
- [ ] **Step 2: Add the models to `schema.prisma`**, generate the DDL with `migrate diff` into the migration folder.
- [ ] **Step 3: Append the data step to `migration.sql`** (after the DDL, before nothing else):
  - staff = users with role `admin`/`teacher`; `perms` = `string_agg(area||':'||level, ',' ORDER BY area::text)` or `''`.
  - groups = distinct `(role, perms)` with `first = MIN("createdAt")`.
  - name: teacher + `''` → `Педагог`; admin + all 12 areas at `edit` → `Адміністратор`; other teacher groups → `Педагогічна посада N`, other admin groups → `Посада N`, `N` = `row_number() OVER (PARTITION BY role ORDER BY first, perms)` among the non-special groups of that role.
  - insert `Position` (`gen_random_uuid()`, name, `teaching = role = 'teacher'`, `updatedAt = now()`), copy each group's permission rows into `PositionPermission`, set `User.positionId` for every staff user.
- [ ] **Step 4: Apply** — `npx prisma migrate deploy`, `npx prisma generate`, `--exit-code` diff prints "No difference detected."
- [ ] **Step 5: Verify** — query: every admin/teacher has `positionId`, no root/parent has one, and `SELECT u.id, string_agg(pp.area||':'||pp.level, ',' ORDER BY pp.area::text) FROM "User" u LEFT JOIN "PositionPermission" pp ON pp."positionId"=u."positionId" WHERE u.role IN ('admin','teacher') GROUP BY u.id` equals the Step 1 snapshot for staff rows. Also run the data step logic mentally on: admin with no rows → `Посада 1`.
- [ ] **Step 6: `npm run build`** passes (no code change needed).
- [ ] **Step 7: Commit** `feat: add positions schema and migrate staff permissions`.

### Task 2: Permissions from the position (backend)

**Files:**
- Modify: `src/common/types/authenticated-user.type.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/auth/auth.service.ts`, `src/access/access-calc.ts`
- Test: `src/auth/strategies/jwt.strategy.spec.ts`, `src/auth/auth.service.spec.ts`, `src/access/access-calc.spec.ts`

**Interfaces:**
- Consumes: Task 1 models.
- Produces: `AuthenticatedUser.positionId: string | null`; `holdsAll(actor: AccessUser, map: PermissionMap): boolean` in `access-calc.ts` (root → true, parent → false, else every area in `map` satisfied by `actor.permissions`); `positionSelect = { select: { id: true, name: true, teaching: true, permissions: { select: { area: true, level: true } } } } as const` exported from new `src/positions/position-select.ts` together with `positionRef(p: {id,name,teaching} | null) => {id,name,teaching} | null`.

- [ ] **Step 1: Failing tests** — `holdsAll`: root true for any map; admin with `{finance:'edit'}` holds `{finance:'view'}` but not `{finance:'edit', users:'view'}`; empty map → true. JWT strategy: user row `{ role: 'admin', position: { permissions: [{area:'finance', level:'edit'}] } }` → `permissions` `{ finance: 'edit' }`, `positionId` set; position `null` → `{}`. `getProfile`: returns `position { id, name, teaching }` (no `permissions` inside it) and `permissions` map from the position; root → `allPermissions(edit)`, `position: null`.
- [ ] **Step 2: Run** `npx jest src/auth src/access` → FAIL.
- [ ] **Step 3: Implement** — both readers include `position: positionSelect` instead of `permissions`; map via `toPermissionMap(user.position?.permissions ?? [])`.
- [ ] **Step 4: Run** tests → PASS; `npm run build` passes (UsersService still compiles against `UserPermission`).
- [ ] **Step 5: Commit** `feat: read staff permissions from positions`.

### Task 3: Positions module (backend)

**Files:**
- Create: `src/positions/positions.module.ts`, `positions.controller.ts`, `positions.service.ts`, `positions.service.spec.ts`, `dto/create-position.dto.ts`, `dto/update-position.dto.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `holdsAll`, `baseScope`, `toPermissionMap`, `positionSelect`, `PermissionItemDto` (reuse from `src/users/dto/update-access.dto.ts` until Task 4 moves it; Task 4 keeps it exported from there).
- Produces: `PositionsService.list()`, `create(dto, actor)`, `update(id, dto, actor)`, `remove(id, actor)`; view `{ id, name, teaching, permissions: {area, level}[], userCount }`; routes `GET /positions` (`users: view`), `POST`, `PATCH /:id`, `DELETE /:id` (`users: edit`). `remove` → `{ message: 'Position deleted' }`.

- [ ] **Step 1: DTOs** — create: `name` `@IsString @Transform(trim) @IsNotEmpty @MaxLength(100)`, `teaching` `@IsBoolean`, `permissions` `@IsArray @ArrayMaxSize(12) @ValidateNested({each}) @Type(() => PermissionItemDto)`; update: same, every field `@IsOptional`.
- [ ] **Step 2: Failing tests** in `positions.service.spec.ts` (mock `$transaction` calling back with the mock, `$queryRaw` mocked):
  - `list` orders by name and maps `_count.users` to `userCount`.
  - `create` by root saves name, teaching, permissions; duplicate areas → `Duplicate permission`; existing name → `Position name already taken` (409); audit `recordChange` with entity `positions`, fields `['name','teaching','permissions']`, permissions as `area:level`.
  - non-root with scope `institutions` → `Outside access scope`; non-root missing an area of the new set → `Cannot grant more than you have`.
  - `update`: unknown → `Position not found`; rename by a non-root who lacks an area of the CURRENT set → `Cannot grant more than you have`; actor's own position (`actor.positionId === id`) → `Cannot change own access`; `teaching` change with a user count > 0 → `Position type cannot change` and the count query has no `isActive` filter; issues a `FOR UPDATE` lock on the position row (assert `$queryRaw`/`$executeRaw` called) before counting; `permissions` replaces the set (deleteMany + createMany).
  - `remove`: with users (count includes inactive) → `Position is in use`; own position → `Cannot change own access`; else deletes and returns `{ message: 'Position deleted' }`.
- [ ] **Step 3: Run** `npx jest src/positions` → FAIL.
- [ ] **Step 4: Implement** service + thin controller (`@UseGuards(JwtAuthGuard, RolesGuard)`, `@Permission(users, view)` on class, `edit` on writes), register module.
- [ ] **Step 5: Run** tests → PASS; eslint on new files; `npm run build`.
- [ ] **Step 6: Commit** `feat: add positions module`.

### Task 4: Users switch to positions, drop UserPermission (backend)

**Files:**
- Modify: `src/users/users.service.ts`, `src/users/dto/create-user.dto.ts`, `src/users/dto/update-user.dto.ts`, `src/users/dto/update-access.dto.ts`, `src/access/access-calc.ts` (only if `grantDenial` signature needs adapting), `prisma/schema.prisma`, `CLAUDE.md`
- Create: `prisma/migrations/20261027110000_drop_user_permissions/migration.sql`
- Test: `src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `positionSelect`, `positionRef`, `holdsAll`, Task 3 lock pattern.
- Produces API: `CreateUserDto { role?: 'parent' | 'root'; positionId?: uuid; ...rest unchanged }`; `UpdateUserDto { role?: 'parent'; positionId?: uuid; ...rest }`; `UpdateAccessDto { positionId: uuid; accessScope; institutionIds? }` (`PermissionItemDto` stays exported here); user responses `{ ..., position: {id,name,teaching}|null, permissions: {area,level}[] (from the position), institutionIds }`.

Rules (service):
- `create`: no `role` → `positionId` required (`Position is required`); `role` given together with `positionId` → `Access applies to staff only`; role `root` only by root (`Forbidden` as today). Staff: read the position in `$transaction` with `SELECT ... FOR SHARE` (404 `Position not found`), non-root actor must `holdsAll(actor, positionMap)` → `Cannot grant more than you have`; `role` = teaching ? teacher : admin. Scoped actors still copy their scope/institutions.
- `update`: `positionId` and `role: 'parent'` together → `Access applies to staff only`; becoming staff from parent requires `positionId` (`Position is required`); target root + `positionId` → `Root access cannot be changed`; own position change → `Cannot change own access`; leaving a teaching position (to non-teaching or parent) keeps the `User has salary terms` guard; becoming parent clears `positionId`, institutions, scope `all`.
- `setAccess`: `grantDenial` and `coversUser` checks as today with permission maps of the current and the new position; position looked up `FOR SHARE`; also updates `role` from `teaching` (same salary-terms guard when leaving teaching).
- Audit: `USER_FIELDS` replaces `permissions` with `position` (position name or `null`).
- `findAll`/responses include `position: positionSelect` and map to `position` + `permissions` array.

- [ ] **Step 1: Update the spec file first** — replace `permissions` fixtures with `position` fixtures; add failing tests: create teacher via teaching position sets role `teacher`; create without role and position → `Position is required`; non-root assigning a position with an area they lack → `Cannot grant more than you have`; `setAccess` to a non-teaching position for a teacher with salary terms → `User has salary terms`; own `positionId` change → `Cannot change own access`; becoming parent clears `positionId`; response has `position` and derived `permissions`; root create with `positionId` → `Access applies to staff only`.
- [ ] **Step 2: Run** `npx jest src/users` → FAIL.
- [ ] **Step 3: Implement** service and DTOs.
- [ ] **Step 4: Remove `UserPermission`** from the schema (and `User.permissions`), generate `20261027110000_drop_user_permissions` with `migrate diff`, deploy, generate, `--exit-code` clean. `grep -rn "userPermission\|UserPermission" src` returns nothing.
- [ ] **Step 5: Update `CLAUDE.md`** — Authorization section: permissions come from `Position` (`PositionPermission`), `User.positionId`, teaching flag → role, position write rules and errors; add a "Positions API (frontend must follow)" bullet in the Frontend section listing the routes, DTO changes and new errors from this plan.
- [ ] **Step 6: Run** `npx eslint` on changed files, `npm run build`, full `npm test` → all pass.
- [ ] **Step 7: Commit** `feat: assign staff access through positions`.

### Task 5: Frontend API, types and positions page

Read `D:\IT\EduNest\CLAUDE.md` first.

**Files:**
- Create: `src/shared/api/positions.ts`, `src/entities/position/index.ts`, `src/entities/position/model/positionsStore.ts`, `src/pages/positions/index.ts`, `src/pages/positions/model/positionsPageStore.ts`, `src/pages/positions/ui/PositionsPage.tsx`, `src/pages/positions/ui/PositionDialog.tsx`, `src/pages/positions/ui/DeletePositionDialog.tsx`
- Modify: `src/shared/api/index.ts`, `src/shared/api/access.ts` (remove `accessTemplates`/`AccessTemplate`; `UpdateAccessDto = { positionId: string; accessScope: AccessScope; institutionIds?: string[] }`), `src/shared/api/users.ts` (`CreateUserDto`/`UpdateUserDto`: `role?: 'parent'; positionId?: string` instead of `role: UserRole`), `src/shared/api/errorMessages.ts`, `src/entities/user/model/types.ts` (`PositionRef { id; name; teaching }`, `User.position?: PositionRef | null`, `SessionProfile.position: PositionRef | null`), `src/app/router/index.tsx` (route `positions`), `src/widgets/sidebar/model/nav-items.ts` (`/positions`, «Посади», `area: 'users'`, after «Користувачі»)

**Interfaces:**
- Produces: `Position { id; name; teaching; permissions: PermissionItem[]; userCount: number }`, `PositionDto { name: string; teaching: boolean; permissions: PermissionItem[] }`, `positionsApi.list() / create(dto) / update(id, Partial<PositionDto>) / remove(id)`; entity store `usePositionsStore` with `positions: Position[]`, `load(): Promise<void>`; `canAssignPosition(profile: SessionProfile | null, position: Position): boolean` exported from `entities/position` (root → true; else every permission satisfied via `levelSatisfies`).
- Error translations: `Position not found` → «Посаду не знайдено», `Position name already taken` → «Посада з такою назвою вже є», `Position is in use` → «На цій посаді є працівники», `Position type cannot change` → «Тип посади не можна змінити, поки на ній є працівники», `Position is required` → «Оберіть посаду».

- [ ] **Step 1: API, types, entity store, translations.**
- [ ] **Step 2: Page** — table: Назва, «Педагогічна» (chip when `teaching`), Працівників (`userCount`), actions edit/delete (only with `useCan('users','edit')`; delete hidden when `userCount > 0`). `PositionDialog`: name, switch «Педагогічна посада» (disabled in edit when `userCount > 0`, helper «Не можна змінити, поки на посаді є працівники»), per area a select «Немає / Перегляд / Зміна» (options above the current user's own level disabled for non-root, as in the current `AccessDialog`). Delete via an MUI confirm dialog (no `window.confirm`). After each mutation reload the entity store.
- [ ] **Step 3: Verify** `npm run build` (will fail in `AccessDialog`/user modals until Task 6 — if so, do Task 6 before committing and commit both together as described there).
- [ ] **Step 4: Commit** `feat: add positions page` (only if the build is green; otherwise commit at the end of Task 6).

### Task 6: Frontend user forms, access dialog, table

**Files:**
- Modify: `src/pages/users/ui/CreateUserModal.tsx`, `EditUserModal.tsx`, `AccessDialog.tsx`, `UsersPage.tsx`, `src/pages/users/model/usersStore.ts`, `src/pages/users/model/accessRules.ts`, `D:\IT\EduNest\CLAUDE.md` (Access control paragraph: positions page, «Посада» select, no templates)

**Interfaces:**
- Consumes: Task 5 API, `usePositionsStore`, `canAssignPosition`.

- [ ] **Step 1: Create/Edit modals** — the «Роль» select becomes «Посада»: positions (disabled when `!canAssignPosition`) + «Батьки» (value `parent`). Form field `position: string` required. Submit: `parent` → `role: 'parent'`; else `positionId`. Scope fields shown when not `parent`. Edit preselects `user.position?.id` or `parent`. Load positions on open.
- [ ] **Step 2: AccessDialog** — position select + institution scope; shows the chosen position's permissions read-only (area label + level label); sends `{ positionId, accessScope, institutionIds }`. Remove templates and the per-area grid. `usersStore.applyScope` sends the user's current `position.id`.
- [ ] **Step 3: UsersPage** — role chip shows `user.position?.name` for staff, `roleLabels.parent` for parents.
- [ ] **Step 4: Verify** `npm run build` + `npm run lint` (7 problems baseline).
- [ ] **Step 5: Commit** `feat: assign positions in user forms` (include Task 5 files if they were not committed).
