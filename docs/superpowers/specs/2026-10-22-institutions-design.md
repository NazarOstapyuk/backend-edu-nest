# Institutions design

Date: 2026-10-22. Status: approved.

## Goal

One installation serves several institutions in one building: kindergartens and schools. Today the only split is `Group.kind` (`kindergarten` / `school_class`) and staff `accessScope` by kind. That cannot tell two kindergartens apart. The owner wants to create institutions, put every group and class into one, give staff access to chosen institutions, keep tariffs and menus per institution, and view everything either for one institution or for all together.

Business logic stays the same everywhere: institutions are a new dimension for ownership, filtering and access, not new rules.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Institution | Admin creates it: name + type `kindergarten` or `school_class`. Several institutions of one type allowed. An institution never mixes kindergarten groups and school classes |
| Groups | Every group/class belongs to exactly one institution; its kind comes from the institution type |
| Children | A group is required when a child is created; the child's institution is the institution of its group |
| Staff access | All institutions, or a chosen list (one or more). Other institutions are invisible |
| Tariffs | Per institution |
| Menus | Per institution and day; one action can create/copy/apply the same menu for several institutions |
| Shared | Meal directories (courses, dishes, complexes, price categories), settings (`mealOrderDeadline`, `attendanceEditDays`, `chargeLeadDays`), one bank account for online payments |
| Classes (гуртки) | One class group may have children from different institutions; each child is charged separately |
| Money in reports | By the child's current institution; when a child moves from kindergarten to school, history moves with the child |
| Viewing | A switcher at the top of the app: «Усі заклади» or one institution; it filters every page, report and «Сьогодні» |

## Data model

- enum `InstitutionType`: `kindergarten`, `school_class` (same values as `GroupKind`).
- `Institution`: `id`, `name` (unique), `type InstitutionType`, `isActive` (default true), `createdAt`, `updatedAt`. Deactivated, never deleted.
- `Group.institutionId` (required, `onDelete: Restrict`). `Group.kind` stays as a stored copy of the institution type, set by the service; it is no longer accepted from clients. Group name unique per institution: `@@unique([institutionId, name])` replaces the global unique.
- `Tariff.institutionId` (optional). `null` = shared tariff for all institutions (used for classes/гуртки, which mix institutions). Tariff name unique per institution (nulls: unique among shared tariffs; enforce in the service if Postgres null semantics get in the way).
- `MenuDay`: `institutionId` (required) replaces `kind` in the unique key: `@@unique([date, institutionId])`. `kind` column is dropped (the institution gives it).
- `CalendarDay`: new `institutionId` (optional) and `CalendarScope` value `institution`. Precedence becomes group > institution > group kind > all; `non_working` still wins a tie. The kind levels stay ("all kindergartens").
- Staff scope: `AccessScope` becomes `all` | `institutions`; new `UserInstitution` (`userId` Cascade, `institutionId` Restrict, `@@id([userId, institutionId])`). `accessScope = institutions` with at least one row. `all` covers institutions created later.

### Migration of existing data

1. Create institutions «Садок» (`kindergarten`) and «Школа» (`school_class`). Admins rename or deactivate them later.
2. Every group gets the institution of its kind; every `MenuDay` gets the institution of its kind.
3. Users with `accessScope = kindergarten` / `school_class` → `institutions` + one `UserInstitution` row for the matching institution.
4. Existing tariffs stay shared (`institutionId = null`); admins assign them later.
5. Existing calendar entries keep their scope.

## Access and scope

The scope of a request is a set of institution ids or "all":

- root, `accessScope = all` → all institutions; `institutions` → the user's rows.
- Teachers keep role-based rights to their own groups (unchanged); staff scope applies on top for permission-based access as today.
- The switcher narrows it: header `X-Institution-Id` (optional). If present it must be an institution inside the user's scope, else 403 `Outside access scope`; unknown id → 404 `Institution not found`. The effective scope = that one institution. Parents' requests ignore the header.
- Everything that today filters by `scopeKind` filters by the effective institution set instead: children, groups, finance, tariffs, register, meals, calendar, notices, online payment requests, dashboard, reports. Single records outside the scope keep answering 404 with their usual message; creating or moving data into an institution outside the scope → 403 `Outside access scope`.
- Children without a group (legacy rows only) stay visible only with scope `all` and no header.
- Tariffs: a scoped user sees shared tariffs plus tariffs of their institutions; changing a shared tariff needs scope `all`.
- Class groups (гуртки) are not tied to an institution (as today, area `classes` is not scoped). The switcher has no effect on class groups; it does filter money and reports of their children.
- Payroll stays unscoped (teachers can work in several institutions).
- Grants (`PATCH /users/:id/access`, user create/update): a granter covers a target when the granter has `all`, or the target's institution set is a subset of the granter's. `grantDenial` and `coversUser` use this instead of `scopeCovers`. Staff created by a scoped actor (or promoted from parent) get the actor's institution set. Error strings unchanged.

## Behaviour per module

- **Institutions** (`src/institutions/`): `GET /institutions` (any staff: institutions in the user's scope, active first; used by the switcher), `POST /institutions`, `PATCH /institutions/:id` (name, isActive; type only while the institution has no groups, else 400 `Institution type cannot change`). Create/update need `settings: edit` and scope `all`. Duplicate name → 409 `Institution name already taken`. Changes are written to the audit log with `recordChange`.
- **Groups**: create takes `institutionId` (required, active institution, else 400 `Institution is inactive`); kind is copied from it. Moving a group to another institution is allowed only to one of the same type and within the scope. Group lists filtered by the effective scope; optional `institutionId` query filter.
- **Children**: `groupId` required on create; update cannot clear it (400 `Group is required`). Moving a child to a group of another institution follows the scope rules above.
- **Tariffs and enrollments**: create/update take optional `institutionId`. Enrolling a child on a tariff of another institution → 400 `Tariff belongs to another institution`; shared tariffs are allowed for anyone.
- **Meals**: menu endpoints take `institutionId` instead of `kind`. Create, copy and apply-template accept `institutionIds[]` and produce one draft per institution and day (existing per-day error prefix rule applies). Orders use the menu of the child's institution. Price on date, deadline, directories unchanged.
- **Calendar**: entries can target an institution; `dayInfo` gets the group's institution.
- **Register, notices, timetable**: unchanged logic; lists follow the effective scope through groups.
- **Reports**: new optional `institutionId` filter; `kind` stays. Both go through `resolveFilter` (institution outside scope → 403 `Outside access scope`).
- **Dashboard**: every section narrowed by the effective scope.
- **Parent cabinet**: children views add `institution: { id, name }`. Nothing else changes; parents never send the header.
- **Online payments**: unchanged; `INSTITUTION_NAME` stays the merchant name for the single account.
- **Audit**: institution create/update and the institution set of user access are recorded like other access changes.

## Rules settled after review (builder's calls, approved with the spec)

- **Moving a child or a group to another institution** is refused while the moved children have an active enrollment on a tariff of the old institution (400 `Child has an active enrollment`) or active meal orders from today on (400 `Child has meal orders`). The admin ends the enrollment / cancels the orders first. Shared-tariff enrollments do not block.
- **Calendar for scoped users**: they create and void entries only at institution or group level inside their scope. Entries at `all` or group-kind level need scope `all`. Their list shows every entry that affects their institutions (including `all` and kind level), read-only where they cannot change it.
- **Payroll** ignores institution-level calendar entries: `SalaryTerms.calendarKind` keeps its values, payroll working days stay as today.
- **Tariff links**: class groups (single-lesson and package tariffs) may link only shared tariffs (400 `Tariff belongs to another institution`); packages and single-lesson charges inherit that, so marking never needs the check. Enrollments and adaptation visits accept shared tariffs and tariffs of the child's institution.
- **Changing a tariff's institution** is allowed only while it has no enrollments, adaptation visits or class-group links (400 `Tariff is in use`).
- **Teachers and the header**: the header narrows teachers too. Lists of own groups, lessons and `meal-orders/today` show only the chosen institution; a single own-group record of another institution answers 404 as if outside the scope.
- **Deactivated institution** means "closed for new things": no new groups, no groups or children moved into it, no new menus for it, not grantable in new access. Everything already there keeps working (billing, register, meal orders, reports). It still appears in the switcher and reports, marked inactive.

## API changes for the frontend

- New `GET/POST /institutions`, `PATCH /institutions/:id`.
- New optional request header `X-Institution-Id` on all staff routes. The frontend keeps the switcher choice per browser and sends the header from the axios instance; «Усі заклади» = no header.
- Groups: `institutionId` required on create, `kind` no longer accepted, responses include `institution { id, name, type }`.
- Children: `groupId` required on create; responses include the institution through the group.
- Tariffs: optional `institutionId` in requests and responses.
- Menus: `institutionId` / `institutionIds[]` replace `kind`.
- Calendar: scope `institution` + `institutionId`.
- Users access: `accessScope` `all` | `institutions` + `institutionIds[]` (replaces `kindergarten` / `school_class`).
- Reports: `institutionId` query.
- Parent cabinet: `institution` in child views.
- New messages: `Institution not found`, `Institution name already taken`, `Institution is inactive`, `Institution type cannot change`, `Group is required`, `Tariff belongs to another institution`, `Tariff is in use`, `Child has an active enrollment`, `Child has meal orders`.

## Non-goals

- Separate bank accounts, requisites or online-payment merchants per institution.
- Per-institution settings.
- Per-institution directories for meals, subjects, rooms, bell schedules, absence reasons.
- Attributing past money to the institution the child was in at the time.
- Institution-specific payroll and institution calendars in payroll working days.

## Left to the builder

- Splitting the work into tasks (schema + migration first; scope helpers next, then module by module; frontend last).
- How the effective scope is carried (request context next to `requestId` vs explicit argument), as long as services stay testable with mocks.
- Exact query/DTO shapes inside the rules above.

## Testing

- Pure rules (scope covering, effective scope with the header, calendar precedence with institutions) get unit tests without mocks.
- Every changed service method keeps or gains service tests (mocked Prisma), including: scoped user cannot see or create in another institution; header outside scope → 403; menu for several institutions; tariff of another institution rejected.
