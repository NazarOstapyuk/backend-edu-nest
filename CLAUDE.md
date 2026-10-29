# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

NestJS 11 + Prisma 7 (PostgreSQL) backend for an education center: users with roles, groups, children, subscription types, subscriptions (session packs) and attendance tracking. Frontend is expected at `http://localhost:5173` (CORS with credentials in `src/main.ts`, origin from `CORS_ORIGIN`). Production deployment: free services (Render + Neon + Netlify, nightly backups via `.github/workflows/database-backup.yml`) in `docs/deploy-render.md`; a VM (Oracle Cloud, Caddy, systemd) in `docs/deploy.md`, files in `deploy/`.

## Commands

```bash
docker compose up -d            # Postgres 16 on :5432 (user/pass postgres, db edu_db)
npm run start:dev               # watch mode, port from PORT or 3000
npm run build                   # nest build -> dist/
npm run lint                    # eslint WITH --fix: rewrites files, check git diff after
npm run format                  # prettier (singleQuote, trailingComma all)
npm run backup:restore -- <file>   # restore a database copy (backend stopped), see docs/backups.md
deploy/deploy.sh                # on the server: safety copy, pull, migrate deploy, build, restart (docs/deploy.md)

npm test                        # unit tests (*.spec.ts under src/)
npx jest src/users/users.service.spec.ts   # single file
npx jest -t "throws when user not found"   # single test by name
npm run test:e2e                # test/jest-e2e.json

npx prisma migrate dev --name <name>   # create + apply migration
npx prisma generate                    # regenerate client after schema change
```

Verification before claiming done: `npm run lint` + `npm run build` + `npm test`, all clean.

## Stack versions

NestJS 11 and **Prisma 7** are newer than most of the model's training data. Prisma 7 differs from older versions: config in `prisma.config.ts` (datasource URL from `DATABASE_URL` via dotenv, not in `schema.prisma`), driver adapter `@prisma/adapter-pg` passed to `PrismaClient`. The `generator` in `schema.prisma` is `prisma-client-js` with no `output`, so the client is generated into `node_modules/.prisma/client` and imported from `@prisma/client` (if `output` is ever set, the client moves there). Check those generated types and `prisma.config.ts` instead of relying on memory.

## Environment

`.env` keys: `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `ROOT_LOGIN`, `ROOT_PASSWORD`. Optional: `PORT`, `NODE_ENV` (`production` enables `secure` cookies), `CORS_ORIGIN` (default `http://localhost:5173`), `TRUST_PROXY` (Express `trust proxy`: `true` behind Render/Netlify, default `loopback`). `docker-compose.prod.yml` also needs `POSTGRES_PASSWORD`.
Optional backups: `BACKUP_DIR` (folder for database copies; empty disables backups), `BACKUP_PG_CONTAINER` (default `edu_postgres`, empty = local `pg_dump`).
Optional online payments: `PAYMENT_PROVIDER` (`test` | `monobank`; empty disables), `PAYMENT_WEBHOOK_URL` (public base for webhooks; empty = polling only), `PUBLIC_APP_URL` (frontend base, default `http://localhost:5173`), `INSTITUTION_NAME` (default `EduNest`).

## Architecture

- **PrismaModule** is `@Global`; `PrismaService` extends `PrismaClient` using the `@prisma/adapter-pg` driver adapter. Services inject `PrismaService` directly; there is no repository layer.
- **SeedService** runs on `onApplicationBootstrap` and creates the `root` user from `ROOT_LOGIN`/`ROOT_PASSWORD` if it does not exist.
- **Global `ValidationPipe({ whitelist: true })`**: unknown DTO fields are stripped silently. DTOs use class-validator.

### Auth

- JWT stored in **httpOnly cookies** (`accessToken`, `refreshToken`), not Authorization headers. `JwtStrategy` reads from `req.cookies.accessToken`; `cookie-parser` is required.
- Both tokens are signed with the same `JWT_SECRET`. The refresh token is bcrypt-hashed and stored in `User.refreshToken`; `/auth/refresh` rotates it, `/auth/logout` nulls it.
- Cookie `maxAge` values in `AuthService.setCookies` are hardcoded (15m / 30d) and must be kept in sync with `JWT_ACCESS_EXPIRES` / `JWT_REFRESH_EXPIRES`.
- `JwtStrategy.validate` re-fetches the user on every request and rejects inactive users; `req.user` is `AuthenticatedUser` (`{ id, role, login, mustChangePassword, accessScope, positionId, permissions, institutionIds, scopeInstitutionIds }`), accessed via `@CurrentUser()`.

### Authorization pattern

Controllers use `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles(...)` and/or `@Permission(area, level)` (class or method level, method overrides class). `RolesGuard` allows a request when no decorator is set, when the user's role is listed in `@Roles`, or when the route has `@Permission` and `hasPermission` passes (root always; `edit` satisfies `view`), else 403 (`Insufficient permissions` for permission routes). Staff routes use `@Permission` only; teacher-shared routes use `@Roles(Role.teacher)` + `@Permission`; parent routes use `@Roles(Role.parent)`. Never put `Role.admin` or `Role.root` in `@Roles` on new routes. `@PermissionAny(areas, level)` is handler-only (read from the handler, not the class) and decides the route alone: passes when the user holds any listed area at that level (root always).

Spec: `docs/superpowers/specs/2026-10-15-access-control-design.md`. The permissions of the user's position (`PositionPermission` rows, area × `view`/`edit`; root = all `edit`, parents none) and `User.accessScope` (`all`/`institutions`, plus `UserInstitution` rows) are loaded into `AuthenticatedUser` by `JwtStrategy` (`institutionIds` = granted, `scopeInstitutionIds` = effective). Pure rules live in `src/access/access-calc.ts` (`hasPermission`, `baseScope`, `effectiveScope`, `scopeIds`, `grantDenial`, `coversUser`); scope helpers in `src/access/scope.ts` take institution id sets (`childScopeWhere`, `groupScopeWhere`, `assertInstitutionInScope`, `assertChildInScope`). Areas: users, children, finance, tariffs, classes, register, timetable, meals, payroll, backups, settings, audit. The scope applies to children/groups, finance, tariffs, register, meals via the child's group institution: lists are filtered, single records outside answer 404 with their usual message, creating/moving into another institution → 403 `Outside access scope`. Children without a group (legacy) are visible only with scope `all` (no header); `groupId` is required for new children and cannot be cleared. `PATCH /users/:id/access` replaces a user's position and scope; a granter (non-root) needs `users: edit` and can change only areas they hold at that level (old and new position), within their scope, never for themselves (`Cannot change own access`, `Cannot grant more than you have`, `Root access cannot be changed`, `Access applies to staff only`). A teacher with a permission acts as a manager in that area.

Positions (spec `docs/superpowers/specs/2026-10-27-positions-design.md`, code `src/positions/`): a `Position` (name unique, trimmed 1–100, global) is a named permission set (`PositionPermission`, unique per area) with a `teaching` flag; there are no per-user permissions. Invariant: `admin`/`teacher` users always have `User.positionId`, `root`/`parent` never; `role` is derived = `teacher` iff the position is `teaching`, else `admin` (the `Role` enum and the teacher role's built-in rights are unchanged). Changing a position's permissions changes them for every holder at once. Position writes (`users: edit`): a non-root actor needs granted scope `all` (403 `Outside access scope`) and must hold every permission of the position before and after any write, including a rename (403 `Cannot grant more than you have`); editing one's own position → 403 `Cannot change own access`; `teaching` cannot change while the position has users (400 `Position type cannot change`); a position with users (inactive ones count) cannot be deleted (400 `Position is in use`); `Position name already taken` (409), `Duplicate permission` (400), `Position not found` (404). Position update/delete lock the `Position` row `FOR UPDATE`; user assignment paths (create, update with `positionId`, `PATCH /users/:id/access`) read it `FOR SHARE` inside their transaction. Assigning a position (non-root) requires covering the target and holding every permission of the new position (`Cannot grant more than you have`); nobody changes their own position. Users: `POST /users` takes `positionId` for staff (400 `Position is required`) or `role` `parent`/`root` (root only by root; `role` with `positionId` → 400 `Access applies to staff only`); `PATCH /users/:id` takes `positionId` (changes position and derived role; a parent becomes staff this way) or `role: 'parent'` (clears position, institutions, scope `all`); both together → 400 `Access applies to staff only`; root + `positionId` → 403 `Root access cannot be changed`. Leaving a teaching position (non-teaching position or parent, via update or access) with salary terms, extra hours or absences → 400 `User has salary terms`. User audit records `position` (name) instead of `permissions`.

Institution scope: `baseScope(user)` = granted institutions (`null` = all, for root, `all` scope and parents); `effectiveScope(base, header)` narrows it to the institution chosen in header `X-Institution-Id`; `scopeIds(user)` = effective. Ordinary list/record queries use the effective scope. Global actions use the granted scope (`baseScope`) and ignore the header: `POST /billing/run`, creating/changing shared tariffs, calendar entries of level all/kind, institution create/update, grants and `coversUser`. `JwtStrategy` validates the header (unknown id → 404 `Institution not found`, outside the granted scope → 403 `Outside access scope`); parents ignore it; it is ignored (not validated) on `@AllowWithoutPasswordChange` handlers. Grants: `PATCH /users/:id/access` takes `accessScope` `all`|`institutions` plus `institutionIds` (non-empty for `institutions`, newly granted ones active); staff created or promoted by a scoped actor copy the actor's institutions; user responses include `institutionIds`. Teachers: the header narrows their own-group lists and records (register, lessons, `meal-orders/today`); class groups stay unscoped.

User management: non-root actors can update/delete only staff they cover (every area level of the target ≤ the actor's, scope covered), never root (403 `Cannot manage this user`); only root can create a user with role root; nobody can change their own position or role, deactivate or delete themselves (403 `Cannot change own access`); `PATCH /users/:id/access` also requires covering the target and the requested access; staff created by a scoped actor (or promoted from parent) get the actor's scope and institutions. Teachers' role-based rights (own groups, lessons, payroll) are not counted by `coversUser`: any `users: edit` holder who covers a teacher's permissions can manage that teacher (including password resets).

Roles (`Role` enum): `root`, `admin`, `teacher`, `parent`. Rules enforced in services, not guards:
- `root` can be created only by root via `POST /users` and is never assigned through update; `root` user cannot be deleted and is hidden from `GET /users`.
- `parent` can only read subscriptions of their own children (`SubscriptionsService.findByChild`) and the parent cabinet views (`src/parent-cabinet/`).
- User responses must strip `password` and `refreshToken` (`omit` in UsersService and Prisma includes elsewhere).

### Domain: subscriptions

- `POST /subscriptions` takes `childIds[]` and creates one subscription per child. `Subscription` snapshots `pricePerSession` from its `SubscriptionType`; `totalPrice = pricePerSession * totalSessions`. `PATCH /subscriptions/:id` changes `totalSessions` of an active subscription (not below sessions used) and recalculates `remainingSessions`/`totalPrice`. `DELETE /subscriptions/:id` exists but fails while attendances exist (FK `RESTRICT`).
- `SubscriptionsModule` hosts three controllers: `/subscriptions`, nested `/subscriptions/:subscriptionId/attendances`, and `/children/:childId/subscriptions` (route shared with `ChildrenController` prefix).
- Creating an attendance decrements `remainingSessions` in a `$transaction`; hitting 0 sets status `finished`. Deleting an attendance increments it back and reverts `finished` to `active`. Only `active` subscriptions accept attendance; only `active` ones can be cancelled.

### Domain: finance

Spec: `docs/superpowers/specs/2026-10-11-finance-design.md`. Per-child ledger in `src/finance/`:

- `Charge` (owed), `Payment` (received), `Allocation` (payment part → charge). Balances are never stored; `finance-calc.ts` computes them, `finance-view.ts` shapes responses.
- Records are never edited or deleted: void with a reason (`voidedAt/voidedById/voidReason`). Voiding a charge or payment voids its active allocations. Only non-voided records and `confirmed` payments count.
- A categorised payment covers only charges of its category; a payment without category covers any. Leftover = prepayment of the category / unallocated.
- Money is `Prisma.Decimal` in code and 2-decimal strings in the API. Never use JS `number` for money.
- Allocation and voiding lock rows with `SELECT ... FOR UPDATE` inside `$transaction` before reading sums.
- Every mutation endpoint returns the child's full `ChildFinance` view.
- Children/users with finance records cannot be deleted (400).

### Domain: tariffs and billing

Spec: `docs/superpowers/specs/2026-10-11-tariffs-design.md`. Code in `src/tariffs/`:

- `Tariff` (unit month/hour/session/package, default billing mode) with dated `TariffPrice` history; a period uses the price effective on its start date. `POST /tariffs/:id/prices` for a date that already has a price replaces its amount (existing charges keep their amounts; billed periods change only on recalculation).
- `Enrollment` (child on a monthly tariff, start/end date, optional own billing mode) with `EnrollmentAdjustment` conditions (`custom_price`, `discount_percent`, `discount_amount`, `pause`); conditions are voided, never edited.
- `billing-engine.ts` is pure (periods, proration, discounts, pauses); `dates.ts` handles UTC-midnight days and `kyivToday()`. Keep business logic there and test it without mocks.
- `BilledPeriod` is unique per `(enrollmentId, periodStart)`; billing creates the Part 1 `Charge` (`sourceType = monthly`) and the billed period in one transaction; a unique violation means "already billed".
- Billing runs daily at 03:00 Europe/Kyiv (`BillingScheduler`, as the root user) and via `POST /billing/run` / `POST /enrollments/:id/bill`. Lead days = `AppSetting` `chargeLeadDays` (default 5).
- Past periods are never changed automatically; `POST /billed-periods/:id/recalculate` voids the old charge (via `voidChargeInTx`) and recreates it.
- `AdaptationVisit` charges `hours × rate` immediately (`sourceType = adaptation`); voiding the visit voids its charge.
- A tariff's billingMode cannot change while it has enrollments (400) — changing it would shift the period grid and double-bill; create a new tariff instead.
- Recalculation zeroes a period only when it starts after the enrollment endDate; an off-grid billed period returns 400 "Billed period no longer matches the enrollment schedule".

### Domain: classes and packages

Spec: `docs/superpowers/specs/2026-10-11-classes-packages-design.md`. Code in `src/classes/`:

- `Direction` has a missed-lesson rule (`no_charge`, `always`, `unexcused_only`); `ClassGroup` has teachers, members (`ClassGroupMember` with start/end dates), a single-lesson tariff (unit `session`) and a package tariff (unit `package`).
- `Package` = sessions bought for a direction (charge `sourceType = extra_package`); remaining = `sessionsTotal − usedBefore − active SessionUsage`, never stored. Validity from `Tariff.validityDays`; extensions are separate rows.
- `consumption.ts` is pure: whether a mark consumes, which package (expiring first), package state. Keep rules there and test without mocks.
- Purchase (`PackagesService.purchase`, `POST /children/:id/packages`): child in scope (404 `Child not found`), direction active (400 `Direction is not active`), tariff active package, and an active class group of the direction must have this tariff as `packageTariffId` (400 `Tariff is not a package of this direction`).
- Class group teachers and tariffs must be active (400 `Teacher is inactive`, `Tariff is not active`); values already stored on the group stay valid on update when unchanged. Same rule for group teachers (`Teacher is inactive`), a group's bell schedule (`Bell schedule is inactive`), child parents (`Parent is inactive`); new salary terms for an inactive teacher → 400 `Teacher is inactive`.
- Marking (`LessonsService.mark`) runs in one transaction: lock the `Lesson` row, then the child's `Package` rows (`ORDER BY id FOR UPDATE`). No usable package → single-lesson charge (`sourceType = extra_session`).
- Corrections void the old attendance + usage (+ single charge via `voidChargeInTx`). Teachers: own groups only (`assertGroupAccess`), corrections only on the lesson day; admins need a reason after the lesson day.
- Legacy `Subscription`s are migrated once (`POST /legacy/subscriptions/migrate`, idempotent) into packages with `needsReconciliation`; reconciliation creates an `opening_balance` charge for the unpaid part. The old subscriptions module is read-only legacy.
- Teachers cannot be deleted while they teach a class group (the m2m join table cascades, so the user delete guard counts class groups).

### Domain: parent cabinet

Spec: `docs/superpowers/specs/2026-10-12-parent-cabinet-design.md`.

- Parents are created by admins (phone required, `mustChangePassword = true`); an admin password reset (`PATCH /users/:id` with `password`) sets the flag again and drops the refresh token.
- `JwtAuthGuard` rejects every request with 403 `Password change required` while `mustChangePassword` is true, except handlers marked `@AllowWithoutPasswordChange()` (`GET /auth/me`, `POST /auth/logout`, `POST /me/password`). Mark new handlers only if a user must reach them before changing the password.
- `GET /auth/me` returns the profile (names, phone, email, `mustChangePassword`); `POST /me/password` and `PATCH /me/contacts` work for every role.
- `src/parent-cabinet/` serves `/me/family`, `/me/children/:id`, `/me/children/:id/finance` for role `parent` only. Every child id is checked against the parent's children (404 `Child not found` otherwise). Child views include `institution {id, name}|null`. Views exclude voided records, unconfirmed payments and internal fields; money comes from `finance-calc.ts`, overdue rules from `cabinet-calc.ts`.

### Domain: attendance register

Spec: `docs/superpowers/specs/2026-10-12-attendance-register-design.md`. Code in `src/attendance/`:

- `Group.kind` is `kindergarten` or `school_class`, always copied from the group's institution type (see Domain: institutions). `AbsenceReason` is an admin directory (`excused`, `requiresDocument`, deactivated, never deleted).
- `CalendarDay` entries (void, never edit) make periods non-working or a weekend working; `CalendarScope` levels all (1) < kind (2) < institution (3, `institutionId` required: 400 `Institution is required for institution scope`) < group (4), `non_working` wins a tie; payroll ignores institution entries; scoped users write only institution/group entries in their scope; inactive institutions allowed. Default: Mon–Fri working.
- `DailyAttendance` = one active mark per child and day (`present`, `late`, `left_early`, `absent` + reason). Saving locks the children rows (`ORDER BY id FOR UPDATE`) before reading marks; corrections void the old mark. Teachers: own groups, `today − attendanceEditDays` (AppSetting, default 3) to today; admins any past day, with a reason outside the window. No future days, no non-working days.
- `AbsenceNotice`: parents submit (today or later, ≤ 60 days, no overlap with pending/approved), admins approve/reject/cancel. Notices are never copied into marks: `register-calc.ts` resolves a day as mark → approved notice → unmarked. Keep day logic there and test it without mocks.
- The register never touches money. Approving an absence notice cancels the child's meal orders for its days whose deadline had not passed when the notice was submitted (`src/meals/notice-orders.ts`).
- Parent routes (`/me/children/:id/register`, `/me/children/:id/absence-notices`) check ownership with `assertOwnChild` (`src/common/ownership.ts`) and never return staff notes or staff names.

### Domain: school timetable

Spec: `docs/superpowers/specs/2026-10-12-school-timetable-design.md`. Code in `src/timetable/`:

- Directories: `Subject`, `Room`, `BellSchedule` (numbered periods with `HH:MM` times), `Subgroup` (children of one class). Deactivated, never deleted. A school class (`Group.kind = school_class`) links one bell schedule.
- `Timetable` versions per class (`validFrom`/`validTo`, never overlapping; a new version closes the previous one; started versions are never edited) with `TimetableEntry` (weekday 1–6, period, `every`/`odd`/`even` ISO week, subject, teacher, room, subgroup).
- Lessons on a date are computed by `ScheduleService.build` from the version, the attendance calendar and `LessonChange`s (`cancel`, `replace`, `extra`; voided, never edited). Pure rules live in `schedule-calc.ts`; keep them there and test without mocks.
- Saving a timetable or a change rejects real-time conflicts (teacher, room, class vs subgroup, intersecting subgroups) with 409 `Schedule conflict` and a `conflicts` list.
- `SchoolLesson` is created on first save and snapshots subject/teacher/room; `LessonMark` = one active mark per pupil (children rows locked before reading marks; corrections void). Only the effective teacher (after replacement) or admins record lessons, within `attendanceEditDays`. Daily-register absences show on lessons; lesson marks never change the register.
- НУШ levels (`needs_support`, `progressing`, `with_help`, `independent`) only; comments are visible to parents. Parent routes `/me/children/:id/schedule` and `/me/children/:id/lessons` use `assertOwnChild`.

### Domain: daily routine

Spec: `docs/superpowers/specs/2026-10-23-kindergarten-routine-design.md`. Code in `src/routine/`:

- Kindergarten groups only (400 `Routine is for kindergarten groups`). `RoutineTemplate` versions per group (`validFrom`/`validTo`, never overlapping, unique `(groupId, validFrom)`, `workingHours` ≤ 100, `note` ≤ 1000) with `RoutineTemplateItem` (ISO weekday 1–7, `HH:MM` `startTime` < `endTime`, title trimmed 1–300, `sortOrder`); `RoutineDay` = one override per group and date with `RoutineDayItem`s (an override without items = no routine that day). Items may overlap; order is start, end, input order. ≤ 60 items per weekday or day (400 `Too many items`), end ≤ start → 400 `Invalid time range`.
- A date resolves as override → calendar → template version: an override is always shown (`source override`, `working` still from the calendar); otherwise a non-working day (`dayInfo` with the group) has no items; otherwise the items of that weekday from the version valid on the date (`template`, or `none`). Day views carry `calendarTitle`; `workingHours` comes from the valid version. Pure rules in `routine-calc.ts` (`normalizeItems`, `versionOn`, `versionBounds`, `resolveRoutine`); keep them there and test without mocks.
- Versions: a new version closes the one covering its date at `validFrom − 1` and ends before a later one (`next start − 1`); same start → 409 `Routine version already starts on this date`. Versions are editable any time (`PUT` replaces the whole version: items, and omitted `workingHours`/`note` become `null`); `validFrom` is never edited. Deleting reopens the previous version (`validTo` = deleted `validTo`). Copy creates a version from the source group's version valid on `validFrom` (items, working hours, note; overrides are not copied; same group → 400 `Cannot copy to the same group`, no source version → 404 `Routine template not found`).
- Every write locks the group row (`FOR UPDATE`) in `$transaction` before reading versions/overrides and re-checks the template under the lock; writes need an active institution (400 `Institution is inactive`). No field-level audit (middleware only).
- Access: area `timetable` (reads `view`, writes `edit`). Groups are looked up in the effective scope (404 `Group not found`); a teacher without the permission reads only own groups (`Group.teachers`, else 404), a teacher with it acts as a manager. Parents use `/me/children/:id/routine` (`assertOwnChild`); a child without a group or in a school class gets `{ group: null, days: [] }`. Ranges default to Kyiv today..+6, ≤ 62 days (`Period too long`, `Invalid period`).

### Domain: meals

Spec: `docs/superpowers/specs/2026-10-13-meals-design.md`. Code in `src/meals/`:

- Directories: `MealCourse`, `Dish` (belongs to a course), `MealPriceCategory` (linked to `Group.mealPriceCategoryId`), `MealComplex` (a set of courses) with dated `MealComplexPrice` per category; `POST /meal-complexes/:id/prices` for a date that already has a price replaces its amount (orders keep their snapshot), only future prices can be deleted. Deactivated, never deleted.
- `MenuDay` is one menu per date and institution (unique `(date, institutionId)`, `draft` / `published`; routes keep the `/menu-days` prefix, writes take `institutionIds`) with `MenuDayItem` dishes; several dishes of one course = the parent picks one. Templates (`MenuTemplate`, N-week cycle) and copying create drafts only; template changes never touch existing days. Writes need active institutions except unpublish/delete (cleanup allowed); multi-institution writes lock in institution id order; orders and parent menus use the child's group institution. Removing a dish used by an active order → 400 `Dish is ordered`; unpublishing a period with active orders → 400 `Menu has orders`.
- `MealOrder` = one active order per child and day (child row locked before reading orders; all needed menu days locked `FOR SHARE` in one id-ordered statement). Each order creates a `Charge` (`category meals`, `sourceType meals`, `sourceId` = order id) in the same transaction; cancelling voids it. Snapshots: complex, price category, price, chosen dishes (`MealOrderItem`).
- Deadline: `AppSetting` `mealOrderDeadline` (default `10:00` Europe/Kyiv on the meal day). Parents order/cancel only before it; admins any time, a cancel after the deadline needs a reason. Per-day order errors are prefixed with the ISO date (`2026-10-14: Menu is not published`).
- Pure rules live in `meals-calc.ts` (deadline, price on date, dish choice, template week, copy offset); keep them there and test without mocks.
- Teachers see `GET /meal-orders/today?groupId` for their own groups; parents use `/me/children/:id/menu` and `/me/children/:id/meal-orders` (`assertOwnChild`) and never see staff names.

### Domain: institutions

Spec: `docs/superpowers/specs/2026-10-22-institutions-design.md`. Code in `src/institutions/`:

- `Institution` (name unique, `type` = `GroupKind` value, active flag) owns groups; `Group.institutionId` is required, `Group.kind` is copied from the type and never accepted from clients; group name unique per institution. The migration created «Садок» and «Школа» and moved existing groups.
- `GET /institutions` for any staff (granted scope, header ignored; parents 403); `POST`/`PATCH`/`DELETE` need `settings: edit` and granted scope `all`. `DELETE /institutions/:id` removes only an unused institution (no groups, tariffs, menu days, calendar entries or staff grants; else 400 `Institution is in use`); otherwise deactivate. Type cannot change while it has groups (row lock, 400 `Institution type cannot change`); duplicate name → 409 `Institution name already taken`; writes into an inactive institution → 400 `Institution is inactive`. `findInstitution` in `institution-checks.ts`, `assertChildrenCanMove` in `move-guard.ts`.
- Groups: moves only to an active institution of the same type in scope; create/move take the institution `FOR SHARE`; moving locks the children and refuses with an active enrollment (`Child has an active enrollment`) or meal orders (`Child has meal orders`). `GET /groups?institutionId`; responses include `institution {id, name, type}`.
- Children: `groupId` required on create, `null` on update → 400 `Group is required`; responses include `group.institution`.
- Tariffs: optional `institutionId` (null = shared); name unique per institution (service check, NULL-safe); scoped lists = shared + own; changing the institution while used → 400 `Tariff is in use`; enrollments and adaptation reject another institution's tariff, class groups accept only shared ones (400 `Tariff belongs to another institution`).

### Domain: payroll

Spec: `docs/superpowers/specs/2026-10-13-payroll-design.md`. Code in `src/payroll/`:

- `SalaryTerms` versions per teacher (`validFrom`/`validTo`, never overlapping; a new version closes the open one; started versions are never edited, only closed; not started ones can be edited or deleted, deleting reopens the previous one) with `SalaryRate` (per lesson type, optional subject or class group; the most specific wins) and `SalaryAllowance` (monthly, prorated like the rate).
- Conducted lessons: a `SchoolLesson` row (paid to `teacherId`, the teacher after replacement) and a classes `Lesson` with at least one active `present` attendance (paid to `conductedById`). Lessons outside any terms are ignored and counted as a warning.
- Pure rules live in `payroll-calc.ts` (working days via `dayInfo` with the terms' `calendarKind`, proration `rate × segment days / norm × worked / default`, rate lookup, corrections); keep them there and test without mocks.
- `PayrollSheet` per teacher and month is created lazily. A `draft` is computed live by `PayrollBuilder`; `approve` snapshots `PayrollLine`s and `approvedDays`, and an approved sheet never changes. Lessons added or removed in an approved month become `correction` lines in later drafts (booked = `lesson` + `correction` lines of approved sheets for that lesson, dated before the draft month).
- Mutations lock the sheet row (`createMany skipDuplicates` + `FOR UPDATE`); `approve` then locks all approved sheets of the teacher (id-ordered); `reopen` locks that set first. Reopen is refused after a payment created after approval or a later correction for that month.
- `PayrollAdjustment` (bonus/deduction, drafts only) and `PayrollPayment` (cash/card, advances and overpayment allowed) are voided, never edited. Taxes are not tracked.
- Teachers read only their own payroll via `/me/payroll` (no staff names, no voided records). Users with salary terms or payroll records cannot be deleted; a teacher with salary terms cannot change role (400 `User has salary terms`).
- Extra hours and absences (spec `docs/superpowers/specs/2026-10-23-payroll-extra-hours-absences-design.md`, teachers only, recorded by payroll `edit`): `SalaryTerms.extraHourRate` (versioned like the rate); `PayrollExtraHours` (dated or monthly, fractional hours ≤ 24 dated / ≤ 400 monthly else 400 `Invalid hours`, optional own hourly `rate`, no future dates) feed one `extra_hours` line (per-record breakdown in `meta`; a record without any rate counts 0 with `noRate`). `TeacherAbsence` (one day or a period ≤ 92 days, `paid`, reason; active ones never overlap, 409 `Absence overlaps another absence`): unpaid working days inside terms lower worked days (rate and allowances scale), paid ones change nothing, the manual `workedDays` override still wins; lessons on absence days stay paid and show the `lessonsOnAbsenceDays` warning. Both are voided, never edited; touching an approved month → 400 `Payroll is approved`. Absence writes lock the teacher row (`FOR NO KEY UPDATE`), then every touched month's sheet in month order. `User.payrollDetailsVisible` (audited via `recordChange`) decides whether `/me/payroll` shows the records and `unpaidAbsenceDays`; totals and the line amount are always shown.

### Domain: backups

Spec: `docs/superpowers/specs/2026-10-13-backups-design.md`. Code in `src/backups/`, user guide in `docs/backups.md`:

- `BackupsService.create` runs `pg_dump -Fc` (inside `BACKUP_PG_CONTAINER` via `docker exec`, or locally) into `<name>.part` under `BACKUP_DIR`, renames it on success and records a `BackupRun`. One run at a time per process (409 `Backup is already running`); 10-minute timeout; runs left `running` are marked `Interrupted` at startup.
- The password goes only into the child environment (`PGPASSWORD`); stored errors pass through `maskSecret`. Never put it in arguments or logs.
- Names and retention are pure (`backup-retention.ts`): 30 newest scheduled copies + newest per month for 12 months, manual copies 30 days, pre-restore copies kept; only our file names are ever deleted.
- Daily cron at 02:00 Europe/Kyiv (`BackupsScheduler`); at startup a background catch-up copy runs when no copy succeeded in the last 24 hours. Restore resets the `public` schema first (`DROP SCHEMA ... CASCADE`), then `pg_restore`; run `npx prisma migrate deploy` afterwards. Dumps skip `BackupRun` rows. `GET /backups`, `POST /backups`, `GET /backups/runs` for root/admin. There is no restore or delete endpoint: restore is `npm run backup:restore` with the backend stopped, after a safety copy.

### Domain: audit log

Spec: `docs/superpowers/specs/2026-10-15-audit-log-design.md`. Code in `src/audit/` (global module):

- `AuditMiddleware` gives every request a `requestId` (`AsyncLocalStorage`, `src/audit/request-context.ts`) and, on `res.finish`, writes an `AuditEvent` for every POST/PUT/PATCH/DELETE (including 4xx/5xx and guard rejections) except `/auth/login|refresh|logout` and `/me/password`. Bodies go through `sanitizeBody` (no passwords/tokens, ≤ 10 000 chars). `AuditResponseInterceptor` captures created ids.
- Key services call `AuditService.recordChange(txOrPrisma, …)` with field-level before/after (`diffFields`): users (incl. access; password only as `"змінено"`), children, groups, tariffs and prices, enrollments and adjustments, salary terms, settings. New code that edits such entities must record changes too.
- `AuthService` writes `AuthEvent`s (`login_success`, `login_failed` + reason, `logout`, `password_changed`, `refresh_failed`) with IP and user agent.
- Event/auth writes never throw; change writes run inside the caller's transaction. Records are never edited; `AuditRetentionScheduler` deletes those older than 365 days at 04:00 Kyiv.
- `GET /audit/events|events/:id|changes|auth` need permission area `audit` (view). Periods are Kyiv days (`kyivDayStart`).

### Domain: reports

Spec: `docs/superpowers/specs/2026-10-16-reports-design.md`. Code in `src/reports/` (read only):

- `GET /reports/payments|charges|debts` (finance), `attendance` (register), `lessons` (timetable for school lessons and/or classes for class-group lessons, `@PermissionAny`), `meals` (meals), `payroll` (payroll), all `view`. Query: `from`, `to` (Kyiv days, ≤ 366 days, `Period too long`), `kind`, `institutionId` (404/403, intersected with kind and scope; class-group lessons and payroll are not narrowed by it), `groupId`, `childId`/`teacherId`, `format=json|xlsx`. Debts have no period (state today).
- Services load rows; pure builders in `reports-calc.ts` return one `Report` (`columns`, `rows`, `totals`, `sheets`) reusing `finance-calc`, `cabinet-calc`, `register-calc` and `PayrollService.list`, so numbers match the cards. Keep report logic there and test it without mocks.
- `xlsx-writer.ts` (`exceljs`) renders any `Report`: money as numbers `0.00`, dates `dd.mm.yyyy`, bold totals, extra sheets. Filters go through `resolveFilter` (scope: `Outside access scope`, `Group not found`).
- Attendance counts only working days (marks on non-working days only show in the timesheet sheet). Payroll rows = months touched by the period plus months of sheets paid inside the period; "Виплачено за період" = non-voided payments dated in the period.

### Domain: dashboard

Spec: `docs/superpowers/specs/2026-10-16-today-dashboard-design.md`. Code in `src/dashboard/` (read only):

- `GET /dashboard/today` returns `{ date, ...sections }`; a key is present only when the user may see it. `register` (groups with unmarked children on a working day; `register` view = all groups in scope, a teacher otherwise own groups), `notices` (`register` view), `debts` (`finance`; children with overdue > 0 via `childMoney`), `meals` (`meals` view, or a teacher: own groups), `payments` (`finance`; confirmed payments of the Kyiv day, per method), `onlinePending` (`finance`, online payments enabled, invoices pending longer than 15 minutes; omitted at 0), `payroll` (`payroll`; teachers with terms in the previous calendar month and no approved sheet), `backups` (`backups`; only when not configured or stale). Everything is narrowed by the access scope.
- The route is guarded by `JwtAuthGuard` only: no `@Roles`/`@Permission` fits several areas plus the teacher role, so `DashboardService` decides (parents get 403 `Insufficient permissions`). Deliberate exception to "always declare roles".
- Pure counting rules live in `dashboard-calc.ts`; keep them there and test without mocks. `canManageRegister` is exported from `register.service.ts` and reused.

### Domain: online payments

Spec: `docs/superpowers/specs/2026-10-16-online-payments-design.md`. Code in `src/online-payments/`:

- `PaymentRequest` (child, category, amount; `cabinet` or 7-day `link` with only the SHA-256 of its key stored) has `PaymentInvoice` attempts at a `PaymentProvider` (`TestProvider` now; a monobank adapter later replaces the `PAYMENT_PROVIDER` factory). Pure rules (kopecks, amount range, expiry, payer name, link keys) live in `online-payments-calc.ts`. Online amounts are 1.00–1000000.00 (kopecks are int4), else 400 `Amount is out of range`. `PAYMENT_PROVIDER=test` is ignored when `NODE_ENV=production` (online payments stay disabled).
- Status arrives by webhook (signature verified, then `getStatus`; the body is never trusted) or by polling every 2 minutes; both call `applyInvoiceStatus`, which is idempotent. Lock order: invoice row, then child row, then the payment insert, then the child's charges (Child-first like meals/notices). Polling also re-queries invoices older than 24 h and expires them only when the provider does not report success. Success creates a confirmed `Payment` (`method online`, `externalId = invoiceId`, `createdById null`) auto-allocated to the category's oldest charges (allocations by root); an amount mismatch credits nothing (final). A provider success that arrives after a local `expired` or another `failure` is still credited (logged as a warning); other statuses never change a final invoice. A nightly `expireRequests` cron at 00:30 Kyiv marks open links past their date `expired`.
- Routes: parents `POST /me/children/:id/online-payments`, `GET /me/online-payments/:id` (our `PaymentInvoice` row id, the `?invoice=` value of the return URL); staff `POST /children/:childId/payment-links`, `GET /children/:childId/payment-requests`, `POST /payment-requests/:id/cancel` (finance); public `GET /pay/:token`, `POST /pay/:token/invoice`, `POST /online-payments/webhook/:provider`, `POST /online-payments/test/:invoiceId` (test provider only; the provider invoice id; its `pageUrl` carries `?return=<redirectUrl>`), `GET /online-payments/config`. `main.ts` enables `rawBody` for webhooks.
- Manual payments accept `cash`, `bank_transfer`, `card`; `reference` (receipt / transfer number) is optional and stored as an empty string when missing (history and reports fall back to «Оплата» / the note).

## Module conventions

**Reference module: `src/children/`** (module + controller + service + `dto/` + `service.spec.ts`). For transactions and nested routes see `src/subscriptions/`. Copy these patterns, don't invent new ones.

- Folder `src/<module>/`: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `<module>.service.spec.ts`, `dto/create-<x>.dto.ts`, `dto/update-<x>.dto.ts`. Register the module in `AppModule`.
- DTOs: `CreateXDto` / `UpdateXDto` with class-validator decorators. `UpdateXDto` is written by hand with `@IsOptional()` on every field (no `PartialType`). IDs validated with `@IsUUID('4')`, dates as `@IsDateString()` strings converted with `new Date()` in the service.
- Controllers are thin: guards + roles + delegate to the service. Existence checks, role rules and business rules live in services.
- Errors: throw Nest built-ins: `NotFoundException` (missing entity), `ConflictException` (unique clash), `ForbiddenException` (role/ownership), `BadRequestException` (invalid state or relation), `UnauthorizedException` (auth only).
- **Error messages are in English** (`'Child not found'`). The frontend translates them to Ukrainian, so keep existing message strings stable; changing one is an API change (see Frontend). Response shape is Nest default `{ statusCode, message, error }`; for ValidationPipe errors `message` is an array of strings.
- Mutations with no meaningful result respond `{ message: '...' }` (e.g. delete).

## Testing conventions

New or changed service methods need unit tests. Unit tests cover services only, using `Test.createTestingModule` with `PrismaService` replaced by a plain object of `jest.fn()` mocks (see `src/auth/auth.service.spec.ts`). For code using `$transaction(async tx => ...)`, mock `$transaction` to invoke the callback with the mock client. No test DB is used.

## Frontend

Frontend repo: `frontend-edu-nest` (https://github.com/NazarOstapyuk/frontend-edu-nest, React, has its own CLAUDE.md). Each backend module has a client in `src/shared/api/<module>.ts` there with mirrored DTO interfaces.

- Changing an endpoint path, method, request DTO, response shape, status code or error message breaks the frontend. List all API changes in the final summary so the frontend can be updated.
- Institutions API changes (frontend must follow): header `X-Institution-Id` (selected institution; unknown → 404 `Institution not found`, outside scope → 403 `Outside access scope`; ignored for parents and on `GET /auth/me`, `POST /auth/logout`, `POST /me/password`); `GET /auth/me` also returns `institutionIds` (the client drops a stored institution not in that list unless root/all scope); new `GET|POST|PATCH|DELETE /institutions` (`DELETE` → `{ message: 'Institution deleted' }` or 400 `Institution is in use`); `AccessScope` is `all`|`institutions` and `PATCH /users/:id/access` takes `institutionIds`, user responses include `institutionIds`; groups require `institutionId`, no `kind` in bodies, `GET /groups?institutionId`, responses carry `institution`; children require `groupId` (null on update → 400 `Group is required`), responses carry `group.institution`; tariffs take optional `institutionId` and tariff responses include `institutionId`; calendar entries accept scope `institution` + `institutionId` and calendar entry responses include `institutionId` and `institution {id, name}`; menus are per institution: `GET /menu-days?institutionId&from&to`, `PUT /menu-days/:date` `{institutionIds, dishIds}` (now returns an ARRAY of day views, one per institution in request order, each view includes `institutionId`, instead of a single object), `GET /meal-orders` accepts `?institutionId`, `GET /finance/balances` accepts `?groupId` (within the scope) and its rows include `group {id, name, institution {id, name, type}}|null`, `DELETE /menu-days/:date/:institutionId`, publish/unpublish `{institutionIds, from, to}`, copy `{sourceInstitutionId, institutionIds, fromStart, fromEnd, toStart, overwrite?}`, `POST /menu-templates/:id/apply` `{institutionIds, ...}`; `?institutionId` on all `/reports` routes; parent cabinet child views carry `institution {id, name}|null`; new errors `Institution not found`, `Institution name already taken`, `Institution is inactive`, `Institution type cannot change`, `Group is required`, `Tariff belongs to another institution`, `Tariff is in use`, `Child has an active enrollment`, `Child has meal orders`, `Institution is required for institution scope`.
- Payroll extra hours and absences API (frontend must follow): salary terms DTOs accept `extraHourRate` (money string, optional, null clears on not-started versions), terms responses include it and `payrollDetailsVisible`; the card `GET /payroll/:teacherId/:month` adds `extraHours[]`, `absences[]` (with `workingDays` in the month), `days.unpaidAbsenceDays`, `payrollDetailsVisible`, warning `lessonsOnAbsenceDays`, line type `extra_hours`; new `POST /payroll/:teacherId/:month/extra-hours` `{date?, hours, rate?, comment?}` and `POST /payroll-extra-hours/:id/void` `{reason}` (→ card), `POST /teachers/:teacherId/absences` `{startDate, endDate?, paid, reason}`, `GET /teachers/:teacherId/absences?from&to`, `POST /teacher-absences/:id/void` `{reason}` (→ absence), `PATCH /payroll/teachers/:teacherId/details-visibility` `{visible}`; `/me/payroll/:month` adds `extraHours`/`absences` only when the switch is on; new errors `No extra hour rate`, `Invalid hours`, `Date is in the future`, `Extra hours not found`, `Extra hours are voided`, `Absence not found`, `Absence is voided`, `Absence overlaps another absence`.
- Reference validation API (frontend must follow): `POST /children/:id/packages` now also answers 404 `Child not found` (outside scope), 400 `Direction is not active`, 400 `Tariff is not a package of this direction`; `POST /children/:childId/payments` rejects `receivedAt` after Kyiv today with 400 `Date is in the future`; new 400 errors `Teacher is inactive` (class groups, groups, new salary terms), `Bell schedule is inactive`, `Parent is inactive`, and `Tariff is not active` on class groups. Already stored inactive teachers, tariffs, bell schedules and parents stay valid when an update does not change them.
- Daily routine API (frontend must follow): `GET /routine/groups` → kindergarten groups the user may read (scope; teachers without the permission: own groups) `[{ id, name, institution {id, name} }]`; `GET /groups/:id/routine?from&to` and `GET /me/children/:id/routine?from&to` → `{ group {id, name}|null, days: [{ date, working, calendarTitle, source: 'template'|'override'|'none', workingHours, note, items: [{startTime, endTime, title}] }] }`; `GET /groups/:id/routine/templates` → `[{ id, validFrom, validTo, workingHours, note, items: [{weekday, startTime, endTime, title}] }]` by `validFrom` (dates `YYYY-MM-DD`); `POST /groups/:id/routine/templates` `{validFrom, workingHours?, note?, items}` and `PUT /routine-templates/:id` `{workingHours?, note?, items}` (replaces the whole version; omitted texts become null) → the version; `DELETE /routine-templates/:id` → `{ message: 'Routine template deleted' }`; `PUT /groups/:id/routine/days/:date` `{note?, items}` and `DELETE /groups/:id/routine/days/:date` → the day view; `POST /groups/:id/routine/copy` `{sourceGroupId, validFrom}` → the new version. Parent cabinet child views: `group` is now `{ id, name, kind }`. New errors `Routine is for kindergarten groups`, `Routine version already starts on this date`, `Routine template not found`, `Invalid time range`, `Cannot copy to the same group`, `Too many items`.
- Positions API (frontend must follow; backend and frontend deploy together): new `GET /positions` (`users: view`) → `[{ id, name, teaching, permissions: [{area, level}], userCount }]` by name; `POST /positions` `{ name, teaching, permissions: [{area, level}] }` and `PATCH /positions/:id` `{ name?, teaching?, permissions? }` (`permissions` replaces the whole set) → the position view (`users: edit`); `DELETE /positions/:id` → `{ message: 'Position deleted' }`. `POST /users` no longer accepts staff roles: staff send `positionId` (role derived), `role` is only `parent` or `root`. `PATCH /users/:id` accepts `positionId` and `role` only as `parent`. `PATCH /users/:id/access` takes `{ positionId, accessScope, institutionIds? }` (no `permissions`). User responses (`GET /users`, create, update, access) carry `positionId`, `position: { id, name, teaching } | null` and `permissions: [{area, level}]` derived from the position; `GET /auth/me` adds `position { id, name, teaching } | null` (`permissions` map unchanged). New errors `Position not found`, `Position name already taken`, `Position is in use`, `Position type cannot change`, `Position is required`; `Cannot grant more than you have`, `Cannot change own access`, `Outside access scope`, `Duplicate permission`, `Root access cannot be changed`, `Access applies to staff only`, `User has salary terms` now also come from position and user position writes.
- UX audit API changes (frontend must follow): `POST /users` for staff also takes optional `accessScope` (`all`|`institutions`) and `institutionIds` (non-empty for `institutions`), applied in the same transaction with the same rules as `PATCH /users/:id/access` (non-root: scope and the position's permissions must be covered, else 403 `Cannot grant more than you have`; institutions must exist and be active, 404 `Institution not found` / 400 `Institution is inactive`); sending `accessScope` with `role` (parent/root) → 400 `Access applies to staff only`; without `accessScope` the old behaviour stays (scoped actor's scope is copied). New `GET /users/lookup?role=teacher|parent[&includeInactive=true]` (staff with view of users, children, classes, timetable, payroll, finance or register; parents 403; declared before `:id`) → `[{ id, firstName, lastName, middleName, phone, isActive, institutionIds }]` by last/first name, active only unless `includeInactive=true`. `role=parent` additionally needs `users` or `children` view (else 403 `Insufficient permissions`) and, when the caller's effective scope is limited, returns only parents with a child in that scope or with no children; `phone` is always `null` for `role=teacher`. `POST /subscriptions` always answers 400 `Subscriptions are read-only` (legacy module; edit and cancel unchanged). `GET /routine/groups` items gain `hasTemplate: boolean` (a version with `validTo` null or not before Kyiv today, usable for copying). Payroll card `GET /payroll/:teacherId/:month` (staff only, omitted in `/me/payroll`) gains `extraHourRate` (money string | null: the extra hour rate of the terms valid at month end, else the latest terms in the month; null for approved sheets). Class-group lesson roster (`GET /class-groups/:id/lessons/:date` and the `PUT` response, top level) gains `hasSingleTariff: boolean` (single-lesson tariff with a price on the date).
- Don't edit the frontend repo from this session unless asked. If asked, read its CLAUDE.md first.
- `POST /auth/login` (body `{ login, password }`):
  - Success: `201`, body `{ message: 'Login successful' }`, `accessToken` + `refreshToken` cookies set.
  - Unknown login or wrong password: `401` `{ statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' }` (same message for both, don't reveal which).
  - Inactive user (correct login): `401` `{ statusCode: 401, message: 'Account is disabled', error: 'Unauthorized' }`.
  - Empty/missing `login` or `password`: `400` ValidationPipe error, `message` is an array.
- `POST /auth/logout` is behind `JwtAuthGuard`: with an expired access cookie it returns `401 Unauthorized` and does not clear cookies or the stored refresh token.
- `POST /auth/refresh` (used by the frontend's planned refresh-in-interceptor):
  - Success: `201` (Nest default for POST), body `{ message: 'Token refreshed' }`, new `accessToken` + `refreshToken` cookies set (refresh token rotated).
  - Missing, invalid, expired or already-rotated refresh cookie, or inactive user: `401` `{ statusCode: 401, message: 'Invalid refresh token', error: 'Unauthorized' }`. Cookies are not cleared. The client must not retry refresh on this 401.
- `GET /auth/me`: `200` profile `{ id, login, role, firstName, lastName, middleName, phone, email, mustChangePassword }`; allowed while a password change is pending.
- While `mustChangePassword` is true every guarded route except `GET /auth/me`, `POST /auth/logout`, `POST /me/password` returns `403` `{ statusCode: 403, message: 'Password change required', error: 'Forbidden' }`.
- Any guarded route with an expired or missing access cookie returns `401` `{ statusCode: 401, message: 'Unauthorized' }`.

## Workflow (superpowers)

Design specs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Check the relevant spec before changing a module's behavior.

For new modules and features:

1. `superpowers:brainstorming` → spec `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`, commit `docs: add <feature> design spec`.
2. `superpowers:writing-plans` → plan `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, commit `docs: add <feature> implementation plan`.
3. `superpowers:subagent-driven-development` or `superpowers:executing-plans` → one plan task = one commit (schema first, then service + tests, then controller + module).
4. `superpowers:verification-before-completion` → lint + build + test.

Full cycle example: `docs/superpowers/specs/2026-05-16-subscriptions-design.md` → `docs/superpowers/plans/2026-05-16-subscriptions.md`.

Bug fixes and changes touching one or two files: no brainstorming or plan, implement directly + verify.

## Comments

Don't write code comments. Exceptions: lint directives required by the codebase, and a one-line comment only when the code would otherwise look like a bug (a deliberate workaround, e.g. the `groupId: null` note in `UpdateChildDto`). Don't delete or rewrite existing comments.

## Git

- Single branch `main`. No CI yet.
- Don't push without an explicit request.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`), one logical change per commit.

## Don'ts

- Never run `prisma migrate reset`, `prisma db push --force-reset`, `docker compose down -v` or otherwise drop data without an explicit request.
- Don't edit migrations that are already applied; create a new one with `prisma migrate dev --name <name>`.
- Don't change CORS in `main.ts`, the global `ValidationPipe`, cookie options or JWT config without an explicit request.
- Don't add dependencies without approval.
- Don't commit `.env` or secrets.
- Don't touch `README.md` (Nest boilerplate) without a request.
