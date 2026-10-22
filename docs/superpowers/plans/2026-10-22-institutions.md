# Institutions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add institutions (kindergartens and schools) as the ownership, filtering and access dimension for groups, children, tariffs, menus, calendar, reports and the dashboard, with a per-request institution switcher.

**Architecture:** New `Institution` model; `Group.institutionId` is the anchor (children reach their institution through the group). Staff scope becomes `all` or a set of institution ids (`UserInstitution`). `JwtStrategy` computes the effective scope once per request from the user's scope and the optional `X-Institution-Id` header and puts it on `AuthenticatedUser`; every service keeps calling one helper (`scopeIds(user)`) instead of today's `scopeKind(user)`. Schema changes are additive first (nullable + backfill) and tightened in the module tasks that own them; old enum values are dropped in the last task.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 16, Jest, class-validator.

**Spec:** `docs/superpowers/specs/2026-10-22-institutions-design.md`

## Global Constraints

- Follow `CLAUDE.md`: thin controllers, rules in services, Nest built-in exceptions, English error messages, no code comments, `UpdateXDto` written by hand, IDs `@IsUUID('4')`.
- Never edit applied migrations; each schema change is a new `npx prisma migrate dev --name <name>` migration. Data backfills go into the generated SQL by hand (edit the new migration before applying it with `--create-only` then `npx prisma migrate dev`).
- Never run `prisma migrate reset` / `db push --force-reset` / `docker compose down -v`.
- Existing error strings stay unchanged. New strings, exactly: `Institution not found`, `Institution name already taken`, `Institution is inactive`, `Institution type cannot change`, `Group is required`, `Tariff belongs to another institution`, `Tariff is in use`, `Child has an active enrollment`, `Child has meal orders`, `Institution is required for institution scope`. Scope violations reuse `Outside access scope` (403) and the usual 404 messages.
- Header name: `X-Institution-Id` (read lowercase `x-institution-id`). Parents' requests ignore it.
- Migration creates institutions named exactly «Садок» (`kindergarten`) and «Школа» (`school_class`).
- `GroupKind` and `InstitutionType` have the same values: `kindergarten`, `school_class`. `Group.kind` stays, always equal to its institution's type, never accepted from clients.
- Every changed service method gets service tests with mocked Prisma (`$transaction` mock invokes the callback). Pure functions get tests without mocks.
- Each task ends with `npm run build` and `npm test` green and `npx eslint <changed files>` without errors (`npm run lint` has pre-existing errors in `src/subscription-types` and `src/subscriptions`; do not commit lint `--fix` rewrites of unrelated files).
- Commits: Conventional Commits with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. Root or an `all` user sending `X-Institution-Id` of an inactive institution: must still be narrowed to it (inactive is viewable), not rejected. Test in Task 3.
2. A scoped user (institutions A) sending a stale header for B (access was narrowed after the frontend stored B): every guarded route, `GET /auth/me` included, answers 403 `Outside access scope`; the frontend drops the stored institution on that answer from `/auth/me`. Test in Task 3; documented in Task 14.
3. A teacher with own groups in two institutions and no header: sees both (scope `all`); with a header: sees only that institution's own groups. Test in Task 4 (register groups list).
4. Moving a whole group with one child that has a future meal order: the whole move is refused with `Child has meal orders`, nothing changes. Test in Task 7.
5. Saving one menu for two institutions where one is inactive: whole request refused with `Institution is inactive`, no drafts written. Test in Task 11.

---

## File Structure

- Create `src/institutions/` (`institutions.module.ts`, `institutions.controller.ts`, `institutions.service.ts`, `institutions.service.spec.ts`, `dto/create-institution.dto.ts`, `dto/update-institution.dto.ts`, `move-guard.ts`, `move-guard.spec.ts`).
- Modify `src/access/access-calc.ts`, `src/access/scope.ts` (+ specs): scope by institution ids.
- Modify `src/common/types/authenticated-user.type.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/auth/auth.service.ts` (`/auth/me`).
- Modify module services listed per task.
- `prisma/schema.prisma` + one migration per schema task.

---

### Task 1: Schema foundation and backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_add_institutions/migration.sql`

**Interfaces:**
- Produces: `enum InstitutionType { kindergarten school_class }`; `model Institution { id String @id @default(uuid()); name String @unique; type InstitutionType; isActive Boolean @default(true); createdAt; updatedAt; groups Group[]; tariffs Tariff[]; menuDays MenuDay[]; calendarDays CalendarDay[]; users UserInstitution[] }`; `Group.institutionId String?` + relation (`onDelete: Restrict`); `model UserInstitution { userId (User, Cascade); institutionId (Institution, Restrict); @@id([userId, institutionId]) }` with `User.institutions UserInstitution[]`; `AccessScope` gains value `institutions` (old values stay until Task 14); `Tariff.institutionId String?` (Restrict); `MenuDay.institutionId String?` (Restrict); `CalendarDay.institutionId String?` (Restrict); `CalendarScope` gains value `institution`.

- [ ] **Step 1:** Edit the schema as above. Run `npx prisma migrate dev --create-only --name add_institutions`.
- [ ] **Step 2:** Append backfill SQL to the generated migration (after the DDL): insert «Садок» (`kindergarten`) and «Школа» (`school_class`) with `gen_random_uuid()`; `UPDATE "Group"` set `institutionId` to the institution whose type equals `kind`; `UPDATE "MenuDay"` the same by `kind`; for users with `accessScope` `kindergarten`/`school_class`: insert `UserInstitution` rows for the matching institution, then set `accessScope = 'institutions'`. Adding an enum value and using it in the same transaction fails in Postgres: put the `ALTER TYPE ... ADD VALUE` statements in this migration and the user `accessScope` update into a second migration `backfill_user_institutions` (create it with `--create-only` right after, SQL only).
- [ ] **Step 3:** Run `npx prisma migrate dev`. Expected: both migrations applied, client generated. Check with `docker exec edu_postgres psql -U postgres -d edu_db -c 'select name, type from "Institution"'` → two rows.
- [ ] **Step 4:** `npm run build` and `npm test`. Expected: green (all new columns nullable, old enum values present).
- [ ] **Step 5:** Commit `feat: add institutions schema and backfill`.

### Task 2: Institutions module

**Files:**
- Create: `src/institutions/institutions.module.ts`, `institutions.controller.ts`, `institutions.service.ts`, `institutions.service.spec.ts`, `dto/create-institution.dto.ts`, `dto/update-institution.dto.ts`, `institution-checks.ts`, `institution-checks.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 schema. In `list`, read the user's `UserInstitution` rows from Prisma (Task 3 adds them to `AuthenticatedUser` later).
- Produces: `InstitutionsService.list(user: AuthenticatedUser)`, `create(dto: CreateInstitutionDto, user)`, `update(id: string, dto: UpdateInstitutionDto, user)`; response shape `{ id, name, type, isActive }`. Routes: `GET /institutions`, `POST /institutions`, `PATCH /institutions/:id`. Audit `entityType: 'institutions'`, fields `['name', 'type', 'isActive']`.
- Produces in `institution-checks.ts`: `findInstitution(db: { institution: { findUnique } }, id: string, opts?: { active?: boolean }): Promise<{ id: string; type: InstitutionType; isActive: boolean; name: string }>` → 404 `Institution not found`; with `active: true` also 400 `Institution is inactive`. Every later task validating an institution uses it.

DTOs: create `{ name: string (trimmed, 2..100, @Matches(/\S/)), type: InstitutionType }`; update `{ name?, type?, isActive?: boolean }`.

Guards: class `@UseGuards(JwtAuthGuard, RolesGuard)`; `GET` has no `@Roles`/`@Permission` (service rejects parents with 403 `Insufficient permissions`, like `DashboardService`); `POST`/`PATCH` `@Permission(PermissionArea.settings, PermissionLevel.edit)`; service additionally requires root or `accessScope === all`, else 403 `Outside access scope`.

- [ ] **Step 1: Write failing tests** in `institutions.service.spec.ts`:
  - `list returns all institutions for root, active first then by name`
  - `list returns only granted institutions for a scoped user`
  - `list rejects parents with Insufficient permissions`
  - `create rejects a duplicate name with Institution name already taken` (409)
  - `create rejects a scoped admin with Outside access scope`
  - `create records an audit change with entityType institutions`
  - `update rejects a type change while the institution has groups with Institution type cannot change` (400)
  - `update allows a type change when there are no groups`
  - `update of a missing id throws Institution not found` (404)
  - in `institution-checks.spec.ts`: missing → `Institution not found`; inactive with `active: true` → `Institution is inactive`; inactive without the option → returns the row
- [ ] **Step 2:** Run `npx jest src/institutions` → FAIL (module missing).
- [ ] **Step 3:** Implement service, DTOs, controller, module; register in `AppModule`.
- [ ] **Step 4:** Run `npx jest src/institutions` → PASS; `npm run build`.
- [ ] **Step 5:** Commit `feat: add institutions module`.

### Task 3: Scope by institutions (core + switch every call site)

**Files:**
- Modify: `src/access/access-calc.ts`, `src/access/access-calc.spec.ts` (create if absent), `src/access/scope.ts`, `src/access/scope.spec.ts` (create if absent), `src/common/types/authenticated-user.type.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/auth/auth.service.ts` (+ spec)
- Modify every file that imports `scopeKind`, `childScopeWhere`, `groupScopeWhere`, `assertKindInScope` or `assertChildInScope` (list: `grep -rln "scopeKind\|ScopeWhere\|assertKindInScope\|assertChildInScope" src`), and their specs' user fixtures.

**Interfaces:**
- Produces in `access-calc.ts`:
  - `AccessUser` gains `institutionIds: string[]`.
  - `baseScope(user: { role: Role; accessScope: AccessScope; institutionIds: string[] }): string[] | null` → `null` for root, parent and `all`; the ids for `institutions`.
  - `effectiveScope(base: string[] | null, selected: string | null): string[] | null | 'outside'` → `selected` null → `base`; `base` null → `[selected]`; `selected` in `base` → `[selected]`; else `'outside'`.
  - `scopeIds(user: { scopeInstitutionIds: string[] | null }): string[] | null`.
  - `scopeKind` is deleted.
- Produces in `scope.ts` (same names, new parameter `ids: string[] | null`):
  - `childScopeWhere(ids)` → `ids ? { group: { institutionId: { in: ids } } } : {}`
  - `groupScopeWhere(ids)` → `ids ? { institutionId: { in: ids } } : {}`
  - `assertInstitutionInScope(ids, institutionId: string | null): void` (403 `Outside access scope`; `null` institution with non-null ids is outside); replaces `assertKindInScope`.
  - `assertChildInScope(db, ids, childId, message = 'Child not found')`.
- Produces on `AuthenticatedUser`: `institutionIds: string[]` (granted rows) and `scopeInstitutionIds: string[] | null` (effective, header applied). `GET /auth/me` response gains `institutionIds`.
- `JwtStrategy` uses `passReqToCallback: true`; loads `institutions: { select: { institutionId: true } }`; for non-parents with a header: unknown institution → 404 `Institution not found`, `'outside'` → 403 `Outside access scope`.

Interim rules for call sites whose final behaviour belongs to later tasks (keep them compiling and safe until then):
- Comparisons `group.kind !== kind` become `ids && !ids.includes(group.institutionId)` (group lists, children, register, meal views, calendar group entries, report filter).
- Kind-addressed endpoints (menus, menu templates, meal views `kind` query, calendar `all`/kind entries, report `kind` filter): scoped users (`ids !== null`) get 403 `Outside access scope` for menus/templates/calendar kind-level writes; meal views and reports intersect `kind` with `ids` (`{ group: { kind, institutionId: { in: ids } } }`). Tasks 10, 11, 13 replace these.
- `billing.service.ts` `if (scopeKind(user))` → `if (scopeIds(user))`.

- [ ] **Step 1: Write failing tests** (pure, no mocks): `baseScope` (root → null, all → null, parent → null, institutions → ids); `effectiveScope` (no header → base; base null + header → [header]; header in base → [header]; header outside → 'outside'); `childScopeWhere([a])` / `groupScopeWhere(null)` shapes; `assertInstitutionInScope([a], b)` throws 403, `([a], a)` passes, `(null, x)` passes, `([a], null)` throws.
- [ ] **Step 2: Write failing strategy test** `src/auth/strategies/jwt.strategy.spec.ts`: header for unknown id → `Institution not found`; scoped user header outside → `Outside access scope`; root + header of an inactive institution → `scopeInstitutionIds = [id]`; parent + header → `scopeInstitutionIds = null`; no header + scoped → granted ids.
- [ ] **Step 3:** Run `npx jest src/access src/auth` → FAIL.
- [ ] **Step 4:** Implement core, strategy, `/auth/me`; then switch every call site (mechanical `scopeKind(user)` → `scopeIds(user)` plus the interim rules). Update user fixtures in specs (`institutionIds: []`, `scopeInstitutionIds: null`, scoped fixtures `accessScope: 'institutions'`, ids `['inst-k']`). Existing scope tests keep their meaning with ids instead of kinds.
- [ ] **Step 5:** `npm run build`, `npm test` → green.
- [ ] **Step 6:** Commit `refactor: scope access by institutions`.

### Task 4: Teacher paths follow the switcher

**Files:**
- Modify: `src/attendance/register.service.ts`, `src/timetable/*` lesson lists for teachers, `src/meals/meal-views.service.ts` (`meal-orders/today`), `src/classes/access.ts` only if it lists school groups (class groups stay unscoped) + specs

**Interfaces:**
- Consumes: `scopeIds`, `groupScopeWhere` (Task 3).
- Rule: teacher own-group queries add `groupScopeWhere(scopeIds(user))`; a single own-group record of another institution → the route's usual 404 (`Group not found` / `Lesson not found`).

- [ ] **Step 1: Failing tests**: `register groups list for a teacher with header returns only own groups of that institution`; `register day for an own group outside the header answers Group not found`; `meal-orders today for an own group outside the header answers Group not found`.
- [ ] **Step 2:** Run the specs → FAIL. **Step 3:** Implement. **Step 4:** Specs PASS, build green.
- [ ] **Step 5:** Commit `feat: narrow teacher views by institution`.

### Task 5: Staff access by institution sets

**Files:**
- Modify: `src/access/access-calc.ts` (+ spec), `src/users/dto/update-access.dto.ts`, `src/users/users.service.ts` (+ spec), `src/users/users.controller.ts` only if the DTO wiring changes

**Interfaces:**
- Produces: `scopeCovers(granter: { accessScope; institutionIds: string[] }, target: { accessScope; institutionIds: string[] }): boolean` → granter `all` → true; target `all` → false; else every target id in granter ids. `grantDenial` and `coversUser` take targets/requests with `institutionIds` and use it.
- `UpdateAccessDto`: `accessScope` `@IsIn(['all', 'institutions'])`; `institutionIds?: string[]` (`@IsArray() @ArrayUnique() @IsUUID('4', { each: true })`), non-empty when `institutions` via `@ValidateIf(o => o.accessScope === 'institutions') @ArrayNotEmpty()` (a ValidationPipe error, no new business message); ignored for `all`.
- Unknown institution id in the request → 404 `Institution not found`; inactive ids may not be newly granted → 400 `Institution is inactive` (kept ids that are already granted may stay).
- `PATCH /users/:id/access` replaces `UserInstitution` rows in the same transaction as permissions. `create` and parent→staff promotion by a scoped actor copy the actor's `accessScope` and institution ids. `becomesParent` clears rows and sets `all`. User responses (`findAll`, access) include `institutionIds`.
- Audit: user access change records `institutionIds` (sorted) next to `accessScope`.

- [ ] **Step 1: Failing tests**: pure `scopeCovers` cases (all/all, subset, superset, disjoint); service: `updateAccess by a granter holding [A] cannot grant [A,B]` → `Cannot grant more than you have`; `granter [A,B] can grant [A]`; `scoped actor creating staff copies its institution ids`; `promotion from parent by scoped actor copies institution ids`; `grant of an inactive institution → Institution is inactive`; `unknown id → Institution not found`; `audit change contains institutionIds`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: grant staff access per institution`.

### Task 6: Move guard

**Files:**
- Create: `src/institutions/move-guard.ts`, `src/institutions/move-guard.spec.ts`

**Interfaces:**
- Produces: `assertChildrenCanMove(db: Prisma.TransactionClient | PrismaService, childIds: string[], fromInstitutionId: string, today: Date): Promise<void>` → 400 `Child has an active enrollment` when any child has an enrollment with `endDate` null or `>= today` on a tariff whose `institutionId === fromInstitutionId`; 400 `Child has meal orders` when any child has a `MealOrder` with `cancelledAt` null and `date >= today`. No-op for an empty list.

- [ ] **Step 1: Failing tests** (mocked db): active enrollment on the old institution's tariff blocks; ended enrollment (endDate yesterday) does not; shared-tariff enrollment does not; future active order blocks; cancelled order does not; empty list does not query.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: guard moving children between institutions`.

### Task 7: Groups belong to institutions

**Files:**
- Modify: `prisma/schema.prisma` (`Group.institutionId` required; `@@unique([institutionId, name])` replaces `name @unique`), new migration `group_institution_required`
- Modify: `src/groups/dto/create-group.dto.ts`, `update-group.dto.ts`, `src/groups/groups.service.ts` (+ spec), `src/groups/groups.controller.ts`

**Interfaces:**
- Consumes: `assertInstitutionInScope`, `groupScopeWhere`, `scopeIds` (Task 3); `assertChildrenCanMove` (Task 6).
- DTOs: create `institutionId: string` (`@IsUUID('4')`, required); `kind` removed from both DTOs (whitelist strips it); update `institutionId?: string`.
- `create`: institution must exist (404 `Institution not found`), be active (400 `Institution is inactive`), be in scope (403); `kind` = institution type; bell schedule check uses that kind; name unique within the institution (409 `Group name already taken`).
- `update` with another `institutionId`: same type required (400 `Institution type cannot change`), target active and in scope, then `assertChildrenCanMove(tx, group's child ids, old institutionId, kyivToday())` inside the transaction before updating.
- `findAll(user, institutionId?: string)`: `GET /groups?institutionId=` (`@IsOptional() @IsUUID('4')` query DTO), intersected with scope; responses include `institution: { id, name, type }`.
- Audit `GROUP_FIELDS` gains `institutionId`.

- [ ] **Step 1: Failing tests**: create copies kind from a school institution; create in an inactive institution → `Institution is inactive`; create outside scope → `Outside access scope`; same name in two institutions allowed, same name in one → `Group name already taken`; move to an institution of another type → `Institution type cannot change`; move with a child holding a future meal order → `Child has meal orders` and no update call; list with `institutionId` filter.
- [ ] **Step 2:** Run `npx jest src/groups` → FAIL. **Step 3:** Schema + migration (`--create-only`, check no NULL `institutionId` remains, then apply), implement. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: create groups inside institutions`.

### Task 8: Children require a group

**Files:**
- Modify: `src/children/dto/create-child.dto.ts`, `update-child.dto.ts`, `src/children/children.service.ts` (+ spec)

**Interfaces:**
- Consumes: Tasks 3, 6, 7.
- Create: `groupId` required (`@IsUUID('4')`, no `@IsOptional`). Update: the DTO keeps accepting `null`; the service answers explicit `null` with 400 `Group is required`. Leave the existing comment in `UpdateChildDto` as it is (comments rule).
- Moving a child to a group of another institution: target in scope, target institution active (400 `Institution is inactive`), then `assertChildrenCanMove([childId], oldInstitutionId, kyivToday())`.
- Child responses include `group.institution { id, name, type }`.

- [ ] **Step 1: Failing tests**: update with `groupId: null` → `Group is required`; move to a group of another institution with an active enrollment on the old institution's tariff → `Child has an active enrollment`; move within the same institution skips the guard; move into an inactive institution → `Institution is inactive`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: require a group for every child`.

### Task 9: Tariffs per institution

**Files:**
- Modify: `prisma/schema.prisma` (`Tariff`: drop `name @unique`, add `@@unique([institutionId, name])`), migration `tariff_institution_unique`
- Modify: `src/tariffs/dto/create-tariff.dto.ts`, `update-tariff.dto.ts`, `src/tariffs/tariffs.service.ts`, `tariffs.controller.ts`, `enrollments.service.ts`, `adaptation.service.ts`, `src/classes/class-groups.service.ts` (+ specs)

**Interfaces:**
- `TariffsService` methods take `user: AuthenticatedUser` instead of `userId` (controller passes `user`).
- DTO: `institutionId?: string | null` on create and update (`@ValidateIf(v => v !== null) @IsUUID('4') @IsOptional()`).
- `list(user)`: scoped → `OR: [{ institutionId: null }, { institutionId: { in: ids } }]`.
- Name uniqueness via `findFirst({ where: { name, institutionId } })` (null-safe), message unchanged `Tariff with this name already exists`.
- Changing a shared tariff (institutionId null) or creating one needs scope `all` (403 `Outside access scope`); an institution tariff must be in scope; target institution active.
- Changing `institutionId` when the tariff has enrollments, adaptation visits or class-group links (`singleGroups`/`packageGroups`) → 400 `Tariff is in use`.
- Enrollments `create` and adaptation `create`: tariff with `institutionId` not equal to the child's group institution → 400 `Tariff belongs to another institution`.
- `ClassGroupsService.assertTariff`: tariff with non-null `institutionId` → 400 `Tariff belongs to another institution`.
- Audit `TARIFF_FIELDS` gains `institutionId`.

- [ ] **Step 1: Failing tests**: scoped list includes shared + own only; same name allowed in two institutions; scoped admin cannot edit a shared tariff; moving a used tariff → `Tariff is in use`; enrollment on another institution's tariff → `Tariff belongs to another institution`; enrollment on a shared tariff passes; adaptation same rule; class group with an institution tariff → `Tariff belongs to another institution`.
- [ ] **Step 2:** FAIL. **Step 3:** Schema + migration, implement. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: tariffs per institution`.

### Task 10: Calendar per institution

**Files:**
- Modify: `src/attendance/register-calc.ts` (+ spec), `src/attendance/dto/create-calendar-day.dto.ts`, `src/attendance/calendar.service.ts` (+ spec), every `dayInfo` caller's group select: `register.service.ts`, `dashboard/dashboard-calc.ts` callers, `meals/meal-orders.service.ts`, `meals/parent-meals.service.ts`, `reports/reports-calc.ts` callers, `timetable/schedule.service.ts`

**Interfaces:**
- `GroupLike` gains `institutionId?: string | null`; `CalendarEntryLike` gains `institutionId?: string | null`. Levels: `all` 1, kind 2, `institution` 3 (entry.institutionId === group.institutionId), `group` 4. Payroll's synthetic group has no `institutionId`, so institution entries never match it (spec: payroll unchanged).
- DTO: `institutionId?: string` (`@IsUUID('4') @IsOptional()`); scope `institution` requires it (400 `Institution is required for institution scope`, like `Group is required for group scope`). Other scopes reject it the same way groupId is handled today.
- Service rules: scoped users create/void only `institution` entries in scope and `group` entries whose group is in scope; `all`/kind entries need scope `all` (403 `Outside access scope`). `list`: scoped → entries `all`, kind entries for the types of their institutions, `institution` entries in scope, `group` entries of groups in scope; `groupId` query keeps today's shape plus the group's institution entries. Responses include `institution { id, name }`.

- [ ] **Step 1: Failing tests** (pure): institution entry beats kind entry; group entry beats institution entry; non_working wins a tie at institution level; institution entry of another institution is ignored; payroll-style group without institutionId ignores institution entries. Service: scoped user creating a kind-level entry → `Outside access scope`; scoped user creating an institution entry in scope passes; list for a scoped user returns all-level, own-kind, own institution, own groups only.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; add `institutionId: true` to every group select feeding `dayInfo`. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: calendar entries per institution`.

### Task 11: Menus per institution

**Files:**
- Modify: `prisma/schema.prisma` (`MenuDay.institutionId` required, `@@unique([date, institutionId])`, drop `kind`), migration `menu_day_institution`
- Modify: `src/meals/dto/menu.dto.ts`, `dto/menu-template.dto.ts`, `dto/meal-views.dto.ts`, `menus.service.ts`, `menus.controller.ts`, `menu-templates.service.ts`, `meal-orders.service.ts`, `meal-views.service.ts`, `parent-meals.service.ts` (+ specs)

**Interfaces:**
- Routes/DTOs:
  - `GET /menus?institutionId&from&to` (`MenuPeriodDto.institutionId` required, replaces `kind`).
  - `PUT /menus/:date` body `{ institutionIds: string[]; dishIds: string[] }` (replaces `PUT /menus/:date/:kind`); returns `MenuDayView[]`, one per institution.
  - `DELETE /menus/:date/:institutionId`.
  - `POST /menus/publish` and `/unpublish` body `{ institutionIds: string[]; from; to }`.
  - `POST /menus/copy` body `{ sourceInstitutionId: string; institutionIds: string[]; fromStart; fromEnd; toStart; overwrite? }`.
  - `POST /menu-templates/:id/apply` body `{ institutionIds: string[]; from; to; startWeek; overwrite? }`.
  - `institutionIds`: `@IsArray() @ArrayNotEmpty() @ArrayUnique() @IsUUID('4', { each: true })`.
- Every institution in a request must exist (404), be in scope (403) and, for writes, be active (400 `Institution is inactive`), checked before any write; one transaction for the whole request. Per-day errors keep the ISO date prefix.
- `workingFor(institution: { id: string; type: InstitutionType }, entries)` → `dayInfo(day, { id: '', kind: institution.type, institutionId: institution.id }, entries)`; calendar entries loaded for the institution's kind and id.
- Meal orders: menu lookup `where: { institutionId: group.institutionId, date: { in: ... } }`. Parent menu view the same. Meal views: `kind` query stays (intersect), new optional `institutionId`.

- [ ] **Step 1: Failing tests**: save one dish set for two institutions creates two drafts; save with one inactive institution writes nothing and throws `Institution is inactive`; copy from institution A to B copies dishes; template apply to two institutions; order uses the child's institution menu (menu of the other institution with same date is not used); publish outside scope → `Outside access scope`.
- [ ] **Step 2:** FAIL. **Step 3:** Schema + migration (backfill already done in Task 1; migration only sets NOT NULL, swaps unique, drops `kind`), implement. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: menus per institution`.

### Task 12: Reports and dashboard

**Files:**
- Modify: `src/reports/report-query.ts` (+ spec), report query DTOs under `src/reports/dto/`, `src/dashboard/dashboard.service.ts` (+ spec) only if Task 3 left kind-based logic

**Interfaces:**
- `ReportFilter` becomes `{ kind: GroupKind | null; groupId: string | null; institutionIds: string[] | null }`.
- `resolveFilter(db, user, query: { kind?; groupId?; institutionId? })`: `institutionId` must exist (404 `Institution not found`) and be in scope (403); result `institutionIds` = `[institutionId]` or `scopeIds(user)`; group must be inside `institutionIds` (403). Inactive institutions allowed.
- `childFilterWhere` adds `group: { institutionId: { in } }` combined with `kind`.

- [ ] **Step 1: Failing tests**: filter by institution narrows children; institution outside scope → `Outside access scope`; group of another institution with institution filter → `Outside access scope`; kind + institution combine.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, build green.
- [ ] **Step 5:** Commit `feat: filter reports by institution`.

### Task 13: Parent cabinet shows the institution

**Files:**
- Modify: `src/parent-cabinet/parent-cabinet.service.ts` (+ spec)

**Interfaces:**
- `family` and `card` child views: `group: { id, name }` stays; add `institution: { id, name } | null` (from the group).

- [ ] **Step 1: Failing test**: family view contains the institution name of each child's group.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: show institution in parent cabinet`.

### Task 14: Cleanup and docs

**Files:**
- Modify: `prisma/schema.prisma` (`AccessScope` = `all`, `institutions` only), migration `access_scope_cleanup` (Postgres: create new type, cast, drop old; fail loudly if any row still uses an old value)
- Modify: `CLAUDE.md` (Authorization pattern: institutions scope + header; domain notes for groups, tariffs, meals, calendar, reports; new Domain: institutions section pointing to the spec), `docs/superpowers/specs/2026-10-22-institutions-design.md` untouched

- [ ] **Step 1:** Schema + migration; `npx prisma migrate dev`.
- [ ] **Step 2:** `grep -rn "kindergarten\|school_class" src --include=*.ts | grep -i "accessScope\|AccessScope"` → no hits.
- [ ] **Step 3:** Update `CLAUDE.md`, including the frontend API change list from the spec plus: header `X-Institution-Id`; `GET /auth/me` returns `institutionIds` and may answer 403 `Outside access scope` for a stale header (the client then drops the stored institution).
- [ ] **Step 4:** Full verification: `npx eslint` on all changed files, `npm run build`, `npm test` → green.
- [ ] **Step 5:** Commit `chore: drop kind-based access scope`.

---

Frontend work (switcher, institutions page, forms) is a separate plan in `frontend-edu-nest` after this branch lands.
