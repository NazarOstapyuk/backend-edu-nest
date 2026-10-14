# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

NestJS 11 + Prisma 7 (PostgreSQL) backend for an education center: users with roles, groups, children, subscription types, subscriptions (session packs) and attendance tracking. Frontend is expected at `http://localhost:5173` (CORS with credentials is hardcoded in `src/main.ts`).

## Commands

```bash
docker compose up -d            # Postgres 16 on :5432 (user/pass postgres, db edu_db)
npm run start:dev               # watch mode, port from PORT or 3000
npm run build                   # nest build -> dist/
npm run lint                    # eslint WITH --fix: rewrites files, check git diff after
npm run format                  # prettier (singleQuote, trailingComma all)
npm run backup:restore -- <file>   # restore a database copy (backend stopped), see docs/backups.md

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

`.env` keys: `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `ROOT_LOGIN`, `ROOT_PASSWORD`. Optional: `PORT`, `NODE_ENV` (`production` enables `secure` cookies).
Optional backups: `BACKUP_DIR` (folder for database copies; empty disables backups), `BACKUP_PG_CONTAINER` (default `edu_postgres`, empty = local `pg_dump`).

## Architecture

- **PrismaModule** is `@Global`; `PrismaService` extends `PrismaClient` using the `@prisma/adapter-pg` driver adapter. Services inject `PrismaService` directly; there is no repository layer.
- **SeedService** runs on `onApplicationBootstrap` and creates the `root` user from `ROOT_LOGIN`/`ROOT_PASSWORD` if it does not exist.
- **Global `ValidationPipe({ whitelist: true })`**: unknown DTO fields are stripped silently. DTOs use class-validator.

### Auth

- JWT stored in **httpOnly cookies** (`accessToken`, `refreshToken`), not Authorization headers. `JwtStrategy` reads from `req.cookies.accessToken`; `cookie-parser` is required.
- Both tokens are signed with the same `JWT_SECRET`. The refresh token is bcrypt-hashed and stored in `User.refreshToken`; `/auth/refresh` rotates it, `/auth/logout` nulls it.
- Cookie `maxAge` values in `AuthService.setCookies` are hardcoded (15m / 30d) and must be kept in sync with `JWT_ACCESS_EXPIRES` / `JWT_REFRESH_EXPIRES`.
- `JwtStrategy.validate` re-fetches the user on every request and rejects inactive users; `req.user` is `AuthenticatedUser` (`{ id, role, login, mustChangePassword }`), accessed via `@CurrentUser()`.

### Authorization pattern

Controllers use `@UseGuards(JwtAuthGuard, RolesGuard)` plus `@Roles(...)` at class or method level (method overrides class via `getAllAndOverride`). `RolesGuard` allows everything when no `@Roles` is set, so always declare roles on protected routes.

Roles (`Role` enum): `root`, `admin`, `teacher`, `parent`. Rules enforced in services, not guards:
- `admin` cannot create/update a user into `root`; `root` user cannot be deleted and is hidden from `GET /users`.
- `parent` can only read subscriptions of their own children (`SubscriptionsService.findByChild`) and the parent cabinet views (`src/parent-cabinet/`).
- User responses must strip `password` and `refreshToken` (destructuring in UsersService, `omit` in Prisma includes elsewhere).

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

- `Tariff` (unit month/hour/session/package, default billing mode) with dated `TariffPrice` history; a period uses the price effective on its start date.
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
- Marking (`LessonsService.mark`) runs in one transaction: lock the `Lesson` row, then the child's `Package` rows (`ORDER BY id FOR UPDATE`). No usable package → single-lesson charge (`sourceType = extra_session`).
- Corrections void the old attendance + usage (+ single charge via `voidChargeInTx`). Teachers: own groups only (`assertGroupAccess`), corrections only on the lesson day; admins need a reason after the lesson day.
- Legacy `Subscription`s are migrated once (`POST /legacy/subscriptions/migrate`, idempotent) into packages with `needsReconciliation`; reconciliation creates an `opening_balance` charge for the unpaid part. The old subscriptions module is read-only legacy.
- Teachers cannot be deleted while they teach a class group (the m2m join table cascades, so the user delete guard counts class groups).

### Domain: parent cabinet

Spec: `docs/superpowers/specs/2026-10-12-parent-cabinet-design.md`.

- Parents are created by admins (phone required, `mustChangePassword = true`); an admin password reset (`PATCH /users/:id` with `password`) sets the flag again and drops the refresh token.
- `JwtAuthGuard` rejects every request with 403 `Password change required` while `mustChangePassword` is true, except handlers marked `@AllowWithoutPasswordChange()` (`GET /auth/me`, `POST /auth/logout`, `POST /me/password`). Mark new handlers only if a user must reach them before changing the password.
- `GET /auth/me` returns the profile (names, phone, email, `mustChangePassword`); `POST /me/password` and `PATCH /me/contacts` work for every role.
- `src/parent-cabinet/` serves `/me/family`, `/me/children/:id`, `/me/children/:id/finance` for role `parent` only. Every child id is checked against the parent's children (404 `Child not found` otherwise). Views exclude voided records, unconfirmed payments and internal fields; money comes from `finance-calc.ts`, overdue rules from `cabinet-calc.ts`.

### Domain: attendance register

Spec: `docs/superpowers/specs/2026-10-12-attendance-register-design.md`. Code in `src/attendance/`:

- `Group.kind` is `kindergarten` or `school_class`. `AbsenceReason` is an admin directory (`excused`, `requiresDocument`, deactivated, never deleted).
- `CalendarDay` entries (void, never edit) make periods non-working or a weekend working; precedence group > group kind > all, `non_working` wins a tie. Default: Mon–Fri working.
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

### Domain: meals

Spec: `docs/superpowers/specs/2026-10-13-meals-design.md`. Code in `src/meals/`:

- Directories: `MealCourse`, `Dish` (belongs to a course), `MealPriceCategory` (linked to `Group.mealPriceCategoryId`), `MealComplex` (a set of courses) with dated `MealComplexPrice` per category. Deactivated, never deleted.
- `MenuDay` is one menu per date and group kind (`draft` / `published`) with `MenuDayItem` dishes; several dishes of one course = the parent picks one. Templates (`MenuTemplate`, N-week cycle) and copying create drafts only; template changes never touch existing days. Removing a dish used by an active order → 400 `Dish is ordered`; unpublishing a period with active orders → 400 `Menu has orders`.
- `MealOrder` = one active order per child and day (child row locked before reading orders; all needed menu days locked `FOR SHARE` in one id-ordered statement). Each order creates a `Charge` (`category meals`, `sourceType meals`, `sourceId` = order id) in the same transaction; cancelling voids it. Snapshots: complex, price category, price, chosen dishes (`MealOrderItem`).
- Deadline: `AppSetting` `mealOrderDeadline` (default `10:00` Europe/Kyiv on the meal day). Parents order/cancel only before it; admins any time, a cancel after the deadline needs a reason. Per-day order errors are prefixed with the ISO date (`2026-10-14: Menu is not published`).
- Pure rules live in `meals-calc.ts` (deadline, price on date, dish choice, template week, copy offset); keep them there and test without mocks.
- Teachers see `GET /meal-orders/today?groupId` for their own groups; parents use `/me/children/:id/menu` and `/me/children/:id/meal-orders` (`assertOwnChild`) and never see staff names.

### Domain: payroll

Spec: `docs/superpowers/specs/2026-10-13-payroll-design.md`. Code in `src/payroll/`:

- `SalaryTerms` versions per teacher (`validFrom`/`validTo`, never overlapping; a new version closes the open one; started versions are never edited, only closed; not started ones can be edited or deleted, deleting reopens the previous one) with `SalaryRate` (per lesson type, optional subject or class group; the most specific wins) and `SalaryAllowance` (monthly, prorated like the rate).
- Conducted lessons: a `SchoolLesson` row (paid to `teacherId`, the teacher after replacement) and a classes `Lesson` with at least one active `present` attendance (paid to `conductedById`). Lessons outside any terms are ignored and counted as a warning.
- Pure rules live in `payroll-calc.ts` (working days via `dayInfo` with the terms' `calendarKind`, proration `rate × segment days / norm × worked / default`, rate lookup, corrections); keep them there and test without mocks.
- `PayrollSheet` per teacher and month is created lazily. A `draft` is computed live by `PayrollBuilder`; `approve` snapshots `PayrollLine`s and `approvedDays`, and an approved sheet never changes. Lessons added or removed in an approved month become `correction` lines in later drafts (booked = `lesson` + `correction` lines of approved sheets for that lesson, dated before the draft month).
- Mutations lock the sheet row (`createMany skipDuplicates` + `FOR UPDATE`); `approve` then locks all approved sheets of the teacher (id-ordered); `reopen` locks that set first. Reopen is refused after a payment created after approval or a later correction for that month.
- `PayrollAdjustment` (bonus/deduction, drafts only) and `PayrollPayment` (cash/card, advances and overpayment allowed) are voided, never edited. Taxes are not tracked.
- Teachers read only their own payroll via `/me/payroll` (no staff names, no voided records). Users with salary terms or payroll records cannot be deleted; a teacher with salary terms cannot change role (400 `User has salary terms`).

### Domain: backups

Spec: `docs/superpowers/specs/2026-10-13-backups-design.md`. Code in `src/backups/`, user guide in `docs/backups.md`:

- `BackupsService.create` runs `pg_dump -Fc` (inside `BACKUP_PG_CONTAINER` via `docker exec`, or locally) into `<name>.part` under `BACKUP_DIR`, renames it on success and records a `BackupRun`. One run at a time per process (409 `Backup is already running`); 10-minute timeout; runs left `running` are marked `Interrupted` at startup.
- The password goes only into the child environment (`PGPASSWORD`); stored errors pass through `maskSecret`. Never put it in arguments or logs.
- Names and retention are pure (`backup-retention.ts`): 30 newest scheduled copies + newest per month for 12 months, manual copies 30 days, pre-restore copies kept; only our file names are ever deleted.
- Daily cron at 02:00 Europe/Kyiv (`BackupsScheduler`). `GET /backups`, `POST /backups`, `GET /backups/runs` for root/admin. There is no restore or delete endpoint: restore is `npm run backup:restore` with the backend stopped, after a safety copy.

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
