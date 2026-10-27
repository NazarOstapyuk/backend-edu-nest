# Positions («Посади») — design

## Intent

Staff access is configured per user today: every admin or teacher gets their own set of area permissions (`UserPermission`, 12 areas × `view`/`edit`). The institution has many kinds of staff (assistant, accountant, caretaker, senior educator...) and wants to describe each kind once and assign it to people. Changing what a kind of staff may do must change it for everyone holding it.

A **position** is a named permission set created by staff with user management rights. Every staff user (except root) holds exactly one position, and their permissions come only from it. There are no per-user permissions any more.

## Decisions (agreed with the user)

- Positions are created on a separate place in the UI ("Посади"), with a name and the same 12 areas × none/view/edit.
- Each position has a flag **"Педагогічна посада"** (`teaching`). A teaching position gives everything the `teacher` role gives today (own groups, lessons, register for own groups, payroll as a teacher, `/me/payroll`) plus its checked areas. A non-teaching position gives only its checked areas.
- The user form has one field "Посада": the list of positions plus "Батьки". The system derives `User.role` from the position: `teacher` for a teaching position, `admin` otherwise. Parents and root stay outside positions.
- Changing a position's permissions immediately changes them for all its users.
- The `teaching` flag cannot change while the position has users.
- Institution scope (`accessScope` `all`/`institutions` + `UserInstitution`) stays on the user, not on the position: two assistants share a position but may work in different institutions.
- A position with users cannot be deleted; it can be renamed or edited.
- Root stays outside positions with full access.
- The rule "you cannot give more than you have" stays: assigning a position requires holding all its permissions.
- Migration: existing staff get positions automatically. Users with identical (role kind, permission set) share one position. Teachers without permissions → «Педагог»; admins with every area at `edit` → «Адміністратор»; other sets get generated names («Посада 1», «Педагогічна посада 1», ...) that can be renamed later.

## Non-goals

- No per-user extra permissions on top of a position.
- No institution-bound positions (positions are global).
- No change to how permissions are checked in routes (`@Permission`, `hasPermission`, `RolesGuard`): only where the permission map comes from changes.
- No change to the `teacher` role's built-in behaviour; `Role` enum stays as is.
- No position history (who held which position when); the audit log records changes.

## Anti-goals

- A user must never end up with more access than before the migration, nor less.
- A non-root actor must never be able to raise anyone's access (including their own) by editing or assigning a position.
- Teachers' payroll, group links and lessons must not break when positions are introduced.

## Data model

- `Position`: `id`, `name` (unique, trimmed 1–100), `teaching` boolean, `createdAt`, `updatedAt`.
- `PositionPermission`: `positionId` (cascade), `area`, `level`; unique `(positionId, area)`.
- `User.positionId` nullable FK (`Restrict`). Invariant enforced in services: staff (`admin`, `teacher`) always have a position; `root` and `parent` never do. `User.role` equals `teacher` iff the position is teaching, `admin` otherwise.
- `UserPermission` is removed after its data is moved (same migration).

## Permission resolution

`JwtStrategy` and `AuthService` (`/auth/me`) build the permission map from the user's position (`toPermissionMap(position.permissions)`), root keeps `allPermissions(edit)`, parents an empty map. `AuthenticatedUser.permissions` keeps its shape, so guards and services are untouched. `coversUser` / `grantDenial` keep working on permission maps taken from positions.

## API

Positions (`src/positions/`):

- `GET /positions` — `users: view`. `[{ id, name, teaching, permissions: [{area, level}], userCount }]` ordered by name.
- `POST /positions` `{ name, teaching, permissions: [{area, level}] }` — `users: edit`.
- `PATCH /positions/:id` `{ name?, teaching?, permissions? }` — `users: edit`. `permissions` replaces the whole set.
- `DELETE /positions/:id` — `users: edit`, only without users → `{ message: 'Position deleted' }`.

Rules for a non-root actor on position writes:

- Granted scope `all` is required (a position affects users in every institution) → 403 `Outside access scope` otherwise.
- The actor must hold every permission of the position, both the current set and the requested one, for any write including a rename (my call: stricter than today's per-changed-area `grantDenial`, because a position change affects every holder at once) → 403 `Cannot grant more than you have`.
- `userCount` and "position has users" count inactive users too.
- Editing the actor's own position → 403 `Cannot change own access`.
- Root may do anything.

Errors: `Position not found` (404), `Position name already taken` (409), `Position is in use` (400, delete with users), `Position type cannot change` (400, `teaching` change with users), `Duplicate permission` (400).

Users:

- `POST /users`: staff are created with `positionId` (required unless `role` is `parent` or `root`); `role` in the body is accepted only as `parent` or `root` (root only by root); for staff the role is derived from the position. Missing position for staff → 400 `Position is required`.
- `PATCH /users/:id`: `positionId` changes the position (and the derived role); switching between parent and staff works as today (becoming a parent clears position and institutions; becoming staff requires `positionId`). The existing guard stays: leaving a teaching position for a non-teaching one (or parent) with salary terms / extra hours / absences → 400 `User has salary terms`.
- `PATCH /users/:id/access` takes `{ positionId, accessScope, institutionIds }` instead of `permissions`; same denial rules as today, applied to the old and new position's permission maps.
- User responses replace `permissions` with `position: { id, name, teaching } | null` and keep `permissions` (derived from the position) for display.
- `GET /auth/me` adds `position { id, name, teaching } | null`; `permissions` stays.

Assigning a position (create, update, access) by a non-root actor requires `users: edit`, covering the target (as today) and holding every permission of the new position (`Cannot grant more than you have`). Nobody changes their own position (`Cannot change own access`).

## Audit

- `recordChange` for positions (entity `positions`, fields `name`, `teaching`, `permissions` as `area:level` strings) on create, update, delete.
- User audit records `positionId` (and position name) instead of `permissions`.

## Migration

One migration, in this order: create `Position`/`PositionPermission`, add `User.positionId`; with SQL, group admin and teacher users by (role, sorted permission set), create one position per group (teaching = role is teacher), named by the rules above, copy permissions, set `positionId`; drop `UserPermission` (stray rows of root or parent users are dropped). The migration writes no audit entries. Positions get deterministic names; generated numbering follows the order of the smallest `createdAt` of the users in the group.

## Frontend

Part of this work (the user asked for the feature end to end), in the frontend repo `D:\IT\EduNest` following its own CLAUDE.md. The backend change breaks the current frontend (`PATCH /users/:id/access` drops `permissions`, `POST /users` no longer takes staff roles), so both ship and deploy together; no transition period.

- New tab or page "Посади" under users (visible with `users: view`, editable with `users: edit`): list with name, «Педагогічна» mark, number of users; dialog with name, `teaching` switch (disabled when users exist), 12 areas × none/view/edit; delete for unused positions.
- Create/Edit user: the role select becomes "Посада" (positions + «Батьки»; «Root» shown read-only for root). Institution scope fields stay.
- `AccessDialog` becomes position + institutions.
- Users table shows the position name instead of the role.
- New error translations for the new messages.

## Left to the builder

- Exact module layout, DTO names, test cases.
- Whether `GET /positions` permissions come as array or map, as long as the frontend mirrors it.
- Generated name wording beyond the rules above.
- UI placement details (tab on the users page vs separate route).
