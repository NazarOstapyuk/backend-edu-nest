# Parent Cabinet and Session Refresh (Part 6) Design

Date: 2026-10-12. Repos: backend `backend-edu-nest`, frontend `frontend-edu-nest` (`D:\IT\EduNest`).

## Goal

A parent logs in and sees all their children in one cabinet: each child's card (full name, birth date, group or class, parents' contacts, tariff enrollments, class packages), the history of all visits, and all money: what was charged and for which period, how much is paid, what remains, prepayments, partial payments and debts from previous periods. Payments appear as soon as they are confirmed (the online payment itself is Part 7). The frontend refreshes the session transparently on 401.

## Decisions

| Topic | Decision |
|---|---|
| Access | Admin creates the parent account and links children (existing child modal "Батьки"); the parent must change the password on first login and after any admin password reset. |
| Contacts / names | `phone` (required for parents) and `email` (optional) on `User`; optional `middleName` on `User` and `Child`. |
| Several children | Money per child; the family page adds totals (debt, overdue, prepayment). No shared family account. |
| Parent may edit | Own password and own contacts (phone, email). Child data only via admin. |
| Visits | Show what exists: class lessons, adaptation visits, legacy subscription attendances, plus enrollment pauses. A daily kindergarten/school register is a separate later part. |
| Finance view | Charges list (newest first) with period, amount, paid, remaining, status, overdue flag; payments list with their allocations; category summary. |
| Architecture | Separate backend module with parent-safe views under `/me/...`; separate parent layout on the frontend. |

## Data Model

Migration `add_parent_cabinet`:

```prisma
model User {
  middleName         String?
  phone              String?
  email              String?
  mustChangePassword Boolean @default(false)
}

model Child {
  middleName String?
}
```

The migration also runs `UPDATE "User" SET "mustChangePassword" = true WHERE role = 'parent';` (existing parent passwords were known to admins). No new tables; a family is the set of children linked to the parent through the existing `ChildParents` relation.

## Backend

### Users and auth

- `CreateUserDto` / `UpdateUserDto`: `middleName?` (string, max 100), `phone?` (`/^\+380\d{9}$/`), `email?` (`IsEmail`, max 200). `UpdateUserDto` accepts `null` to clear `middleName`/`email`.
- Creating a `parent` without `phone` → 400 `Phone is required for parents`. Updating a parent to remove the phone (null) → same error. Existing parents without a phone keep working.
- Creating any user sets `mustChangePassword = true` when the role is `parent`. `PATCH /users/:id` with `password` sets `mustChangePassword = true` for the target user (admin reset) and clears its `refreshToken`.
- `CreateChildDto` / `UpdateChildDto`: `middleName?`.
- User responses (`/users`, child `parents`) include `middleName`, `phone`, `email`, `mustChangePassword`; `password` and `refreshToken` stay stripped.
- `GET /auth/me` returns `{ id, role, login, firstName, lastName, middleName, mustChangePassword }` (read from the DB).
- `POST /me/password` (any authenticated role) body `{ currentPassword, newPassword }`; `newPassword` min 8. Wrong current → 400 `Invalid current password`; same as current → 400 `New password must differ from the current one`. On success: hash and store, `mustChangePassword = false`, `refreshToken = null` (other devices must log in again), then set fresh cookies for this session (same as login). Response `{ message: 'Password changed' }`.
- `PATCH /me/contacts` (any authenticated role) body `{ phone?, email? }` (email accepts `null`); a parent cannot clear the phone (400 `Phone is required for parents`). Returns the updated `GET /auth/me`-shaped profile plus `phone`, `email`.
- **Password-change gate:** `JwtAuthGuard` checks the loaded user; when `mustChangePassword` is true it rejects with 403 `Password change required` unless the handler is marked `@AllowWithoutPasswordChange()`. Marked handlers: `GET /auth/me`, `POST /auth/logout`, `POST /me/password`. (`/auth/login` and `/auth/refresh` are not behind `JwtAuthGuard`.) `JwtStrategy.validate` exposes `mustChangePassword` on `AuthenticatedUser`.

### Parent cabinet module `src/parent-cabinet/`

All routes `@Roles(Role.parent)`. Ownership: the child must have the current user among `parents`; otherwise 404 `Child not found` (same for non-existent ids).

`GET /me/family`:

```ts
{
  children: { id, firstName, lastName, middleName, group: { id, name } | null, due: string, overdue: string, prepayment: string }[],
  totals: { due: string, overdue: string, prepayment: string }
}
```

`GET /me/children/:id` (card):

```ts
{
  id, firstName, lastName, middleName, birthDate, group: { id, name } | null,
  parents: { id, firstName, lastName, middleName, phone, email }[],
  enrollments: { id, tariffName, startDate, endDate, pauses: { startDate, endDate }[] }[],
  packages: { id, directionName, sessionsTotal, used, remaining, expiresAt, state }[],
  visits: (
    | { type: 'lesson', date, groupName, directionName, status, isGuest }
    | { type: 'adaptation', date, hours: string }
    | { type: 'legacy', date, note: string | null, directionName }
  )[]
}
```

- Enrollments: non-voided pauses only. Packages: non-voided only, state from `consumption.ts`. Visits: active lesson attendances, non-voided adaptation visits, legacy subscription attendances; sorted by date desc, then type.

`GET /me/children/:id/finance`:

```ts
{
  summary: { category, due: string, overdue: string, prepayment: string }[],
  unallocated: string,
  charges: { id, category, description, periodStart, periodEnd, amount, paid, remaining, state: 'unpaid' | 'partial' | 'paid', overdue: boolean, createdAt }[],
  payments: { id, receivedAt, amount, method, category, allocated: string, free: string, allocations: { chargeId, description, amount }[] }[]
}
```

- Only non-voided charges; only confirmed, non-voided payments; only active allocations. No `note`, `reference`, `createdBy`, void fields.
- Amounts via `finance-calc.ts` (`chargeRemaining`, `chargeState`, `paymentFree`, `summarize`) so admin and cabinet always agree.
- **Overdue:** `remaining > 0` and the charge's last day is before Kyiv today. Last day = `periodEnd`, else `periodStart`, else the Kyiv date of `createdAt`.
- `due` = sum of remaining; `prepayment` = category free amount; `unallocated` = free amount of payments without category. Family `prepayment` totals include `unallocated`.

### Errors (new, English, translated on the frontend)

`Password change required` (403), `Invalid current password` (400), `New password must differ from the current one` (400), `Phone is required for parents` (400). Existing: `Child not found` (404).

## Frontend

### Session refresh

In `shared/api/axiosInstance.ts`: on a 401 from any request except `/auth/login`, `/auth/refresh`, `/auth/logout`, call `POST /auth/refresh` once (one shared in-flight promise for parallel 401s), then retry the original request once. If refresh fails: clear the auth store, navigate to `/login`, show one notice «Сесія завершилась, увійдіть знову». 401s never produce the generic error toast. A 403 `Password change required` sends the user to `/change-password` without a toast.

### Auth and routing

- `authStore.profile` gains `firstName`, `lastName`, `middleName`, `mustChangePassword`.
- After login / `fetchMe`: `mustChangePassword` → `/change-password`; role `parent` → `/family`; others → `/`.
- Route guards by role: parent routes (`/family`, `/family/:childId`, `/profile`, `/change-password`) under `ParentLayout`; admin/teacher routes under `AdminLayout`; a parent opening an admin route is redirected to `/family`, staff opening `/family` to `/`.
- `/profile` and `/change-password` also exist for staff (inside `AdminLayout`).

### Parent pages (mobile-friendly)

- `ParentLayout`: top bar with the parent's name, links «Моя сім'я», «Профіль», «Вийти»; `Notifier`.
- «Моя сім'я» `/family`: totals card («До оплати», «з них прострочено», «Передоплата»), then one card per child (full name, group, due/prepayment, «Детальніше»).
- Child page `/family/:childId`, tabs:
  - «Картка»: full name, birth date, group, parents with phone/email (tap to call / mail), enrollments with pauses, class packages with remaining and expiry.
  - «Відвідування»: unified list (date, what, status/hours).
  - «Фінанси»: category summary; charges table (description, period, amount, paid, remaining, status chip, «Прострочено» chip); payments list, expandable to allocations; unallocated shown as prepayment.
- «Профіль» `/profile`: edit phone (normalized to `+380XXXXXXXXX` from inputs like `067 123 45 67`, `(067)…`, `380…`) and email; change password form.
- `/change-password`: forced form (current, new, repeat); after success → role home.

### Admin changes

- User create/edit modals: `middleName`, `phone` (required when role is parent), `email`; the users table shows phone and a «немає телефону» chip for parents without one.
- Child create/edit modals: `middleName`.
- Child finance card header: parents with phones.
- `errorMessages.ts`: the four new messages.

## Integrity Rules

1. A parent sees only children linked to them; any other child id → 404 `Child not found`.
2. Cabinet views never include voided records, unconfirmed payments, internal notes, references or staff names.
3. Cabinet money equals admin money for the same child (same calculation functions).
4. `mustChangePassword` blocks every guarded endpoint except me, logout and password change.
5. Admin password reset forces a change and logs the user out of other sessions; a self-change keeps the current session and logs out others.
6. Parents must have a phone on create/update; legacy parents without one keep working.

## Testing

- Backend unit tests: ownership (own, foreign, missing child), family totals, overdue rule (periodEnd, periodStart, createdAt fallbacks, Kyiv today), exclusion of voided/pending/inactive records, password change (wrong current, same password, success clears flag and refresh token), gate (blocked vs allowed handlers), admin reset sets the flag, phone required for parents, contacts update.
- Live check on PORT=3100: parent with two children sees both and totals; foreign child 404; first login forces password change; payment confirmed by admin appears immediately; voided charge disappears; expired access cookie refreshes transparently (frontend, manual).
- Frontend: `tsc` adds no errors vs baseline; `eslint` clean on touched files.

## Out of Scope

Online payment (Part 7), daily kindergarten/school register and school lesson attendance (separate part after Part 6), monthly statements, self-registration, parent-initiated change requests.

## Commit Order

1. Schema + migration (fields, parent flag data update).
2. Users/children DTO and service changes (contacts, middle name, phone rule, admin reset flag) + tests.
3. Auth: `/auth/me` shape, password-change gate, `POST /me/password`, `PATCH /me/contacts` + tests.
4. Parent cabinet service + controller (family, card, finance) + tests.
5. Backend CLAUDE.md + live check.
6. Frontend: session refresh + password-change redirect + profile shape.
7. Frontend: role routing, `ParentLayout`, family, child, profile, change-password pages.
8. Frontend: admin modal fields, parents in finance card, translations, CLAUDE.md.
