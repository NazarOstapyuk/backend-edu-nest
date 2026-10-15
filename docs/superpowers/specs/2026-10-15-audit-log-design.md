# Change history (audit log) design

Date: 2026-10-15. Status: approved in brainstorming, awaiting spec review.

Third sub-project of Part «Звіти та захист» (backups → access control → change history → reports with Excel).

## Goal

Answer "who changed what, when, and what it was before" and "who logged in or tried to". Every mutating request is recorded; key entities also record field-level before/after; logins are recorded separately. The head (and staff given the new `audit` permission) browse it on a page and from entity cards. Nobody can edit or delete records; they expire after one year.

## Decisions

| Topic | Decision |
|---|---|
| What is recorded | Every mutating request as an event + before/after for key entities (Q1 C) |
| Logins | Success, failure (with reason), logout, password change, failed session refresh, with IP and browser (Q2 A) |
| Who sees it | root + new permission area `audit` (Q3 B) |
| Retention | 1 year for everything, deleted nightly (Q4 C) |
| Where | Page «Історія змін» (actions, logins) + «Історія» button on key cards (Q5 B) |
| Capture | Global interceptor for events, explicit `recordChange` in key services inside their transactions, request id via `AsyncLocalStorage` (approach 1) |

## Data model

- `AuditEvent`: `id`, `at` (default now), `requestId`, `actorId` (User, nullable, `onDelete: SetNull`), `actorRole` (nullable), `method`, `route` (route template, e.g. `PATCH /children/:id`), `entityType` (nullable), `entityId` (nullable), `statusCode`, `ip` (nullable), `userAgent` (nullable, ≤ 500 chars), `body` Json (nullable). Indexes: `at`, `(entityType, entityId)`, `actorId`, `requestId`.
- `AuditChange`: `id`, `at`, `requestId`, `actorId` (nullable, `SetNull`), `entityType`, `entityId`, `action` enum `AuditAction` (`create`, `update`, `delete`, `void`), `changes` Json `[{ field, before, after }]`. Indexes: `(entityType, entityId)`, `requestId`, `at`.
- `AuthEvent`: `id`, `at`, `userId` (nullable, `SetNull`), `login` (as typed, ≤ 100 chars), `type` enum `AuthEventType` (`login_success`, `login_failed`, `logout`, `password_changed`, `refresh_failed`), `reason` (nullable: `invalid_credentials`, `account_disabled`, `invalid_refresh`), `ip`, `userAgent`. Indexes: `at`, `login`, `userId`.
- `PermissionArea` gains `audit` (12 areas). Migration: every existing `admin` gets `audit: edit` (same as the access-control backfill). `UpdateAccessDto.permissions` `ArrayMaxSize` becomes 12.

Audit tables have no foreign keys that block user deletion (`SetNull`); they are not counted by the user delete guard.

## Capture

### Request id

A global middleware creates `requestId = randomUUID()` and runs the rest of the request inside `AsyncLocalStorage` (`src/audit/request-context.ts`: `runWithRequest(id, fn)`, `currentRequestId(): string | null`). No new dependency.

### Events (interceptor)

`AuditInterceptor` registered as `APP_INTERCEPTOR`:

- Applies to `POST`, `PUT`, `PATCH`, `DELETE`. Skips `/auth/login`, `/auth/refresh`, `/auth/logout`, `/me/password` (covered by `AuthEvent`).
- After the response (success via `tap`, failure via `catchError` that rethrows) writes one `AuditEvent`: actor from `req.user` (absent on 401), `route` = method + controller path + handler path as a template, `entityType` = first path segment of the template (`children`, `payroll`, `salary-terms`, …), `entityId` = `params.id` (or `params.childId`, `params.teacherId` when no `id`) or, for `POST` responses that return an object with `id`, that id; `statusCode` from the response or the exception (`getStatus()`, else 500); `ip` = `req.ip`; `userAgent` from the header; `body` = sanitized request body.
- Writing is fire-and-forget (`void this.audit.recordEvent(...).catch(log)`): a failure to write never changes the response.

### Changes (services)

`AuditService.recordChange(db, { entityType, entityId, action, before, after, fields })`:

- `db` is the service's transaction client (or `PrismaService` when the service has no transaction), so the change is rolled back with the data.
- `changes = diffFields(before, after, fields)`; nothing is written when it is empty for `update`.
- `actorId` comes from the caller (`user.id`), `requestId` from `currentRequestId()` (empty string when outside a request, e.g. the billing cron).

Recorded entities and fields (only these fields; `create`/`delete`/`void` record the listed fields with `before` or `after` null):

| entityType | Where | Fields |
|---|---|---|
| `users` | `UsersService.create/update/delete/setAccess` | login, role, firstName, lastName, middleName, phone, email, isActive, accessScope, permissions (as a sorted `area:level` list), password (only the marker `"змінено"` in `after` when a password is set) |
| `children` | `ChildrenService.create/update/delete` | firstName, lastName, middleName, birthDate, gender, groupId, parentIds (sorted) |
| `groups` | `GroupsService.create/update/delete` | name, kind, teacherIds (sorted), bellScheduleId, mealPriceCategoryId |
| `tariffs` | `TariffsService.create/update/delete`, price add | name, unit, billingMode, validityDays, isActive; prices as `price@validFrom` |
| `enrollments` | `EnrollmentsService.create/end/addAdjustment/voidAdjustment` | childId, tariffId, startDate, endDate, billingMode; adjustments as `type value from–to` |
| `salary-terms` | `SalaryTermsService.create/update/remove/close` | teacherId, validFrom, validTo, monthlyRate, calendarKind, note, rates (`type:target=amount`), allowances (`name=amount`) |
| `settings` | billing lead days, register edit days, meals deadline setters | the setting key and value |

### Pure helpers (`src/audit/audit-calc.ts`)

- `diffFields(before, after, fields)`: compares normalized values (Decimal → `toFixed(2)` string, Date → ISO date or date-time, arrays → joined sorted strings, undefined → null).
- `sanitizeBody(body)`: removes keys (any depth) `password`, `currentPassword`, `newPassword`, `refreshToken`, `accessToken`, `token`; JSON longer than 10 000 characters becomes `{ truncated: true, size }`.
- `entityFromRoute(template, params, responseBody)`: returns `{ entityType, entityId }`.

### Logins

`AuthService` writes `AuthEvent`:

- login: `login_success` with `userId`, or `login_failed` with `reason` `invalid_credentials` (unknown login or wrong password, `userId` set only when the login exists) or `account_disabled`;
- logout: `logout`;
- `POST /me/password` success: `password_changed`;
- refresh failure: `refresh_failed` with reason `invalid_refresh` (userId when the token decoded).

`ip`/`userAgent` are passed from the controller (`@Req()`). Write failures are logged, never thrown.

### Retention

`AuditRetentionScheduler` `@Cron('0 4 * * *', { timeZone: 'Europe/Kyiv' })`: `deleteMany` where `at < now − 365 days` on the three tables; errors logged.

## API

All routes `@Permission(audit, view)`; pages of 50, newest first; response `{ items, total, page }`.

- `GET /audit/events?from&to&actorId&entityType&entityId&failedOnly&page` → events with `actor { id, firstName, lastName, login } | null`.
- `GET /audit/events/:id` → the event plus `changes: AuditChange[]` with the same `requestId` (404 `Audit event not found`).
- `GET /audit/changes?entityType&entityId&page` → changes of one object (with actor).
- `GET /audit/auth?from&to&userId&login&type&page` → login events (with user).
- `from`/`to` are `YYYY-MM-DD` (Kyiv days, inclusive); invalid → 400 `Invalid date`; `to < from` → 400 `Invalid period`.

## Frontend

- Page «Історія змін» (`/audit`, nav item with area `audit`):
  - tab «Дії»: table (час, хто, дія, об'єкт, результат); action label from a route map in `shared/api/audit.ts` («Змінено дитину», «Прийнято оплату», … — unknown routes show the raw route); failed requests (status ≥ 400) highlighted; filters: period, user, object type, «лише помилки»; row click → dialog with the request body (pretty JSON) and the «поле: було → стало» table.
  - tab «Входи»: час, логін, користувач, подія (Ukrainian labels incl. reason), IP, браузер; filters: period, login, type.
- «Історія» button (visible with `audit` view) on the user card/row, child card, tariff, enrollment and salary terms views → dialog listing `GET /audit/changes` for that object.
- Access dialog and templates: area `audit` («Історія змін»); template «Адміністратор» includes it.
- New messages translated: `Audit event not found`.

## Errors (new messages)

| Status | Message |
|---|---|
| 404 | `Audit event not found` |

(`Invalid date`, `Invalid period` already exist.)

## Testing

- `audit-calc.spec.ts`: diff of Decimal/Date/null/arrays/unchanged; nested sanitizing and truncation; entity from route for `:id`, `:childId`, created id from the response.
- Interceptor spec: success and failure both recorded with status; auth routes skipped; non-mutating requests skipped; a failing write does not change the response.
- Service specs: each recorded entity calls `recordChange` inside its transaction with the expected fields; passwords appear only as the marker.
- Auth spec: the five event types and reasons.
- Retention spec and audit query specs (filters, pagination, 404).

## Out of scope

Recording reads/views, exporting the log, field-level history for finance/meals/payroll records (they are already immutable with void reasons), alerting on suspicious logins, IP allow-lists.
