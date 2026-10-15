# Staff access control design

Date: 2026-10-15. Status: approved in brainstorming, awaiting spec review.

Second sub-project of Part «Звіти та захист» (order: backups → access control → change history → reports with Excel). Change history is a separate spec; it will also log access changes.

## Goal

Today every `admin` sees and changes everything. The head must be able to give each staff member only the sections they need (accountant: finance, tariffs, payroll; deputy for the school: register and timetable of the school; kindergarten head: kindergarten only), read-only or with changes, and optionally limited to the kindergarten or the school. Teachers can get extra sections on top of their normal rights.

## Decisions

| Topic | Decision |
|---|---|
| Model | Per-section permissions with view/edit levels plus fixed job templates that only pre-fill the form (Q1 C, Q6 A) |
| Who gets permissions | `admin` (nothing without permissions) and `teacher` (extra sections on top of own rights); `root` always has everything; `parent` unchanged (Q2 B) |
| Granularity | Section × level `view` / `edit`, edit includes view (Q3 A) |
| Kindergarten / school limit | One `accessScope` per staff member: `all`, `kindergarten`, `school_class`; applies where data belongs to a group kind; children without a group only with `all` (Q4 A) |
| Who grants | `root`, or staff with `users: edit` who can grant only what they hold (level and scope not wider), never to themselves (Q5 B) |
| Storage | `UserPermission` rows + `User.accessScope`; route decorator + guard; scope applied in services (approach 1) |

## Data model

- enum `PermissionArea`: `users`, `children`, `finance`, `tariffs`, `classes`, `register`, `timetable`, `meals`, `payroll`, `backups`, `settings`.
- enum `PermissionLevel`: `view`, `edit`.
- enum `AccessScope`: `all`, `kindergarten`, `school_class`.
- `User.accessScope AccessScope @default(all)`.
- `UserPermission`: `id`, `userId` (User, `onDelete: Cascade`), `area`, `level`, `@@unique([userId, area])`. No row = no access to the section.

Migration: every existing `admin` gets `edit` on all 11 areas; `accessScope` stays `all`. Nothing changes for current admins.

## Rules

- `root`: everything, no rows stored, cannot be edited (403 `Root access cannot be changed`).
- `admin`: only granted sections.
- `teacher`: own rights as today (own groups, own lessons, own payroll, today's meal orders of own groups) plus granted sections; a granted section gives the teacher the same rights as an admin with that permission, within `accessScope`.
- `parent`: no permissions; `PATCH /users/:id/access` on a parent → 400 `Access applies to staff only`. Changing a staff member's role to `parent` deletes their permission rows and resets `accessScope` to `all`.
- Level check: `edit` satisfies `view`.
- Granting (pure function `canGrant(granter, target)` in `src/access/access-calc.ts`):
  - granter is `root` → anything;
  - otherwise granter needs `users: edit`; for every requested area the requested level ≤ granter's level in that area (no permission = cannot grant that area); requested scope must be within granter's scope (`all` covers everything; `kindergarten` covers only `kindergarten`; `school_class` only `school_class`);
  - violation → 403 `Cannot grant more than you have`;
  - granter = target → 403 `Cannot change own access`.
- Removing a permission the granter does not hold is also forbidden (it would be a change outside their competence): the comparison applies to the union of old and new rows of the target for every area that changes.

## Enforcement

### Authenticated user

`JwtStrategy.validate` (already re-reads the user every request) also loads permissions; `AuthenticatedUser` becomes `{ id, role, login, mustChangePassword, accessScope, permissions }` where `permissions` is `Partial<Record<PermissionArea, PermissionLevel>>`. Changes take effect on the next request.

`GET /auth/me` adds `accessScope` and `permissions` (root gets every area with `edit`).

### Routes

- New decorator `@Permission(area, level)` (class or method level, method overrides class like `@Roles`).
- `RolesGuard` becomes: allow when the route has neither decorator (unchanged behaviour); otherwise allow when the user's role is listed in `@Roles`; allow when the route has `@Permission` and the user holds it (root always holds every permission, but gets no extra access to routes with only `@Roles`); else 403 `Insufficient permissions` (routes with only `@Roles` keep the existing 403 `Forbidden resource`).
- Staff routes drop `Role.admin` from `@Roles` and get `@Permission`. `GET` = `view`, any mutation = `edit`, unless the table says otherwise.

| Controller (prefix) | Area | Notes |
|---|---|---|
| users | users | all routes |
| groups, children | children | children: teacher keeps role access as today |
| child-finance (`children/:childId/...finance`, charges, payments), finance (`finance/balances`, voids, allocations) | finance | |
| tariffs, enrollments, adaptation, billing (`billing/*`) | tariffs | |
| directions, class-groups (admin routes), packages, legacy migrate, subscription-types, subscriptions, attendances (legacy) | classes | teacher role routes unchanged |
| register (admin/all-groups routes), calendar, absence-reasons (mutations), absence-notices | register | teacher role routes unchanged |
| bell-schedules, directories (subjects, rooms), subgroups, timetables, lesson-changes, lessons (admin use) | timetable | teacher role routes unchanged |
| meal-complexes, meal-directories, menus, menu-templates, meal-orders | meals | `meal-orders/today` keeps teacher role |
| payroll, salary-terms | payroll | `me/payroll` unchanged |
| backups | backups | |
| `PATCH register/settings`, `PATCH settings/billing`, `PATCH meals/settings` | settings | `edit`; their `GET`s follow their module area (`view`) |

Parent routes, `auth`, `me` are untouched.

### Services

- `hasPermission(user, area, level)` and `scopeKind(user)` live in `src/access/access-calc.ts` (pure).
- Existing checks "teacher is limited to own groups" (`assertGroupAccess`, register/lessons/class-groups/meals-today services) become "limited unless `hasPermission(user, <area>, <level>)`".
- Existing checks `role === admin` (e.g. register correction rules, absence-reason visibility) become `hasPermission`.

### Scope (`accessScope`)

`scopeKind(user)` returns `null` for `all` or `root`, else the `GroupKind`. Applied in services of:

- `children` (children list, groups list, child detail, create/update/delete),
- `finance` (balances list, child finance, charges, payments, voids, allocations — via the child's group),
- `tariffs` (enrollments, adjustments, adaptation visits, billing problems list — via the child),
- `register` (groups list, group register, month, absence notices, calendar entries),
- `meals` (menu days and templates by kind, order list and orders by the child's group).

Rules:

- Lists are filtered (`child.group.kind = scope`; children without a group are hidden unless scope is `all`).
- Reading or changing a single record outside the scope answers 404 with the record's usual not-found message (`Child not found`, `Group not found`, `Charge not found`, …).
- Creating a child in, or moving a child to, a group of another kind; creating a group of another kind; a calendar entry with scope `all` or another kind; a menu day of another kind → 403 `Outside access scope`.
- Billing runs (`POST billing/run`) and backups are not scoped (they are whole-institution operations; `billing/run` requires `tariffs: edit` and `accessScope = all`, else 403 `Outside access scope`).
- Classes, payroll, users, timetable, backups and settings are not scoped.

## API

- `PATCH /users/:id/access` `{ accessScope, permissions: [{ area, level }] }` (`users: edit`) → the updated user. The list replaces the target's rows. Duplicated area → 400 `Duplicate permission`.
- `GET /users`, `GET /users/:id` (and the create/update responses) include `accessScope` and `permissions: [{ area, level }]`.
- `GET /auth/me` includes `accessScope` and `permissions` (object `area → level`).

## Errors (new messages)

| Status | Message |
|---|---|
| 403 | `Insufficient permissions`, `Outside access scope`, `Cannot change own access`, `Cannot grant more than you have`, `Root access cannot be changed` |
| 400 | `Access applies to staff only`, `Duplicate permission` |

## Frontend

- User card, tab «Доступ»: template picker (fills the form): «Адміністратор» (all areas `edit`, `all`), «Бухгалтер» (`finance`, `tariffs`, `payroll` edit; `children` view; `all`), «Завуч школи» (`register`, `timetable`, `children` edit; `school_class`), «Керівник садочка» (`register`, `children`, `meals` edit; `finance` view; `kindergarten`), «Відповідальний за харчування» (`meals` edit; `all`); scope select «Усе / Садочок / Школа»; a row per area with «Немає / Перегляд / Зміна»; options above the current user's own rights disabled; read-only for root and for oneself.
- Navigation items declare an area (and optionally roles); an item shows when the role matches or the profile's `permissions` has that area.
- Pages hide create/edit/void buttons when the profile has only `view` for the page's area.
- New error messages translated.

## Testing

- `access-calc.spec.ts` (pure): level comparison, `canGrant` (root, missing `users: edit`, level above own, area not held, scope wider, removing a not-held area, self), `scopeKind`, template definitions.
- Guard spec: no decorators, `@Roles` match, `@Permission` match, root, denial messages.
- Service specs: list filters and single-record 404s in each scoped area, 403 `Outside access scope` on create/move, a teacher with `register` acting as admin, the `PATCH /users/:id/access` rules, role change to parent clearing access, migration of existing admins (data migration SQL reviewed in the plan).

## Out of scope

Per-action permissions, editable templates, per-permission scopes, scoping of classes/payroll/timetable, IP restrictions, two-factor login, change history (next spec).
