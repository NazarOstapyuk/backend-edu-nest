# Teacher payroll (Part «Зарплати педагогів») design

Date: 2026-10-13. Status: approved in brainstorming, awaiting spec review.

## Goal

Track teacher pay: monthly rate, pay per conducted lesson (school lessons, group classes, individual classes), recurring and one-off allowances and deductions, accrued and paid amounts. Conducted lessons enter the calculation automatically from the configured terms. A teacher sees only their own payroll; the head (admin/root) sees everyone.

## Decisions

| Topic | Decision |
|---|---|
| Which lessons count | Recorded lessons count automatically; a month is frozen by approval; later lesson changes in an approved month become corrections in a later draft month (Q1 C) |
| Lesson pay | Fixed amount per conducted lesson; rates per lesson type with optional subject / class group override (Q2 A) |
| Monthly rate | Prorated by working days of the attendance calendar inside the terms dates; the head can override worked days in a draft (Q3 B) |
| Allowances | One-off adjustments in a sheet + recurring monthly allowances in the terms (Q4 B) |
| Payouts | Bound to a month sheet; advances allowed before approval; void, never edit (Q5 A) |
| Taxes | Not tracked; amounts are net (Q6 A) |
| Who | Users with role `teacher` only (Q7 A) |
| Architecture | Draft sheets are computed live; approval snapshots lines (approach 1) |

## Data model

All money is `Decimal(12,2)`, `Prisma.Decimal` in code, 2-decimal strings in the API. Months are `YYYY-MM` strings in the API and the first day of the month (`@db.Date`, UTC midnight) in the DB.

### SalaryTerms

A version of a teacher's pay conditions.

- `teacherId` (User, role `teacher`), `validFrom` (`@db.Date`), `validTo` (`@db.Date`, nullable = open).
- `monthlyRate` Decimal (≥ 0).
- `calendarKind` enum `PayrollCalendar`: `all`, `kindergarten`, `school_class`. Selects which calendar entries define working days (scope `all` always applies; `kindergarten` / `school_class` add the entries of that group kind; group-scoped entries never apply).
- `note` optional.
- `createdById`, `createdAt`.
- Relations: `rates SalaryRate[]`, `allowances SalaryAllowance[]`.

Rules:
- Versions of one teacher never overlap. Creating a version with `validFrom` D closes the open version that started before D (`validTo = D − 1`). A version that starts on or after D, or a closed version that overlaps D, → 400 `Salary terms overlap`.
- A version whose `validFrom` ≤ Kyiv today is started: its rates, allowances and amounts are never changed (400 `Started salary terms cannot be changed`). A not-started version may be deleted (cascades its rates/allowances).
- `PATCH /salary-terms/:id/close` sets `validTo` (≥ `validFrom`, else 400 `Invalid date range`). Only the open version can be closed; a closed one → 400 `Salary terms are closed`.
- Closing or creating terms never touches approved sheets.

### SalaryRate

- `termsId`, `lessonType` enum `PayrollLessonType`: `school_lesson`, `class_group`, `individual`.
- `subjectId` optional (only for `school_lesson`), `classGroupId` optional (only for `class_group` / `individual`, and the group's format must match).
- `amount` Decimal (≥ 0).
- Unique per terms: `(lessonType, subjectId, classGroupId)`; duplicates → 400 `Duplicate salary rate`.

Rate lookup for a lesson: the terms version effective on the lesson date; inside it the rate with the matching subject / class group, else the rate of the lesson type with no subject / class group. No rate → the lesson is listed with amount 0 and flag `noRate`.

### SalaryAllowance

- `termsId`, `name` (non-blank), `amount` Decimal (> 0). Monthly, prorated like the monthly rate.

### PayrollSheet

One per teacher and month, created lazily on the first mutation (upsert on `(teacherId, month)`).

- `teacherId`, `month` (`@db.Date`, first day), `status` enum `PayrollStatus`: `draft`, `approved`.
- `workedDays` Int nullable (override; null = default).
- `approvedAt`, `approvedById`, `reopenedAt`, `reopenedById`, `reopenReason` (last reopen).
- `@@unique([teacherId, month])`.

### PayrollLine

Snapshot rows written on approval, deleted on reopen.

- `sheetId`, `type` enum `PayrollLineType`: `base`, `allowance`, `lesson`, `correction`, `adjustment`.
- `sourceType` enum `PayrollSourceType` nullable: `school_lesson`, `class_lesson`. `sourceId` nullable (lesson id).
- `lessonType` nullable, `date` nullable (lesson date), `refMonth` nullable (for `correction`: month of the corrected lesson).
- `title` (human text: allowance name, subject / class group name, adjustment reason).
- `amount` Decimal (signed; deductions and negative corrections are negative).
- `meta` Json nullable (base: `{ normDays, defaultDays, workedDays }`; lesson: `{ noRate }`).
- `@@index([sourceType, sourceId])`.

### PayrollAdjustment

One-off bonus or deduction in a sheet.

- `sheetId`, `kind` enum `PayrollAdjustmentKind`: `bonus`, `deduction`. `amount` Decimal (> 0, stored positive; deductions count negative). `reason` (non-blank).
- `createdById`, `createdAt`, `voidedAt`, `voidedById`, `voidReason`.
- Only in a draft sheet (create or void on an approved sheet → 400 `Payroll is approved`).

### PayrollPayment

- `sheetId`, `date` (`@db.Date`, not in the future), `amount` Decimal (> 0), `method` enum `PayrollPaymentMethod`: `cash`, `card`. `comment` optional.
- `createdById`, `createdAt`, `voidedAt`, `voidedById`, `voidReason`.
- Allowed on draft and approved sheets. Overpayment allowed.

## What counts as a conducted lesson

- **School lesson:** a `SchoolLesson` row. Belongs to `teacherId` (the effective teacher after replacement, snapshotted on first save). Lesson type `school_lesson`, subject = `subjectId`, date = `date`.
- **Class lesson:** a `Lesson` row with at least one active (`voidedAt` null) `LessonAttendance` with status `present`. Belongs to `conductedById`. Lesson type `individual` when `ClassGroup.format = individual`, else `class_group`; class group = `classGroupId`.
- A lesson counts only if its teacher has terms effective on its date. Lessons outside any terms are ignored (and listed as a warning count `lessonsWithoutTerms`).

## Calculation (`src/payroll/payroll-calc.ts`, pure)

For teacher T and month M (days d1..dn):

1. **Norm days** `normDays(kind)` = working days of the whole month M by `dayInfo` from `register-calc.ts`, called with a pseudo group `{ id: '', kind }` (or `null` for `all`). Each terms version uses the norm of its own `calendarKind`.
2. **Segments:** for each terms version intersecting M, `segmentDays` = working days of M inside `[validFrom, validTo]` by that version's kind.
3. `defaultDays` = Σ `segmentDays`. `workedDays` = sheet override ?? `defaultDays`. `ratio` = `defaultDays > 0 ? workedDays / defaultDays : 0`.
4. **Base** = Σ segments `monthlyRate × segmentDays / normDays(kind)` × `ratio`, rounded to 2 decimals once at the end (half-up). One `base` line (omitted when 0 and no terms with a rate).
5. **Allowances**: per allowance per segment `amount × segmentDays / normDays × ratio`, rounded; one `allowance` line per allowance name+segment.
6. **Lessons**: one `lesson` line per counted lesson in M with the rate amount.
7. **Adjustments**: active adjustments of the sheet, `bonus` positive, `deduction` negative.
8. **Corrections** (only for a draft sheet): for every lesson source dated in a month < M whose sheet is approved:
   - `expected` = amount the lesson would earn now if it counts (rate lookup as today), else 0;
   - `booked` = Σ amounts of all `lesson` and `correction` lines with that `(sourceType, sourceId)` in approved sheets of T;
   - if the lesson currently counts and nothing is booked → correction `+expected`; if it no longer counts (or now belongs to another teacher) and `booked ≠ 0` → correction `−booked`. Amount changes from rate edits are never corrected (started terms cannot change anyway).
   - Booked lines of T whose lesson now belongs to another teacher are corrected out in T's draft; the new teacher gets a `+expected` correction in theirs.
   - Corrections appear in every draft sheet of T after the source month; approving one of them books them, and the others recompute to nothing.
9. **Totals**: `accrued` = Σ lines; `paid` = Σ active payments; `balance` = `accrued − paid` (negative = overpaid).

`normDays = 0` (whole month non-working) → base and allowances are 0 for that segment.

An approved sheet's totals come from its `PayrollLine` rows only; nothing is recomputed.

## Approval and reopening

- `POST /payroll/:teacherId/:month/approve`: month must not be after Kyiv current month (400 `Month is in the future`). In one transaction: upsert + `SELECT ... FOR UPDATE` the sheet; lock all approved sheets of T (`ORDER BY id FOR UPDATE`) so concurrent approvals cannot book the same correction twice; status must be `draft` (400 `Payroll is approved`); compute; insert `PayrollLine`s; set `approved`.
- `POST /payroll/:teacherId/:month/reopen` `{ reason }`: sheet must be `approved` (400 `Payroll is not approved`); no active payment created after `approvedAt` (400 `Payroll has payments after approval`); no later approved sheet of T that booked a correction for a lesson of this month (400 `Payroll has later corrections`); deletes its lines, sets `draft`, stores reopen fields. Same locking as approve.
- A teacher may have any number of draft sheets; approval order is free.

## API

All routes need `JwtAuthGuard` + `RolesGuard`. Management routes: `@Roles(admin, root)`.

### Terms

- `GET /salary-terms?teacherId=` → versions of the teacher (newest first) with rates (subject / class group names) and allowances.
- `GET /salary-terms/:id`.
- `POST /salary-terms` `{ teacherId, validFrom, monthlyRate, calendarKind, note?, rates: [{ lessonType, subjectId?, classGroupId?, amount }], allowances: [{ name, amount }] }`. Teacher must exist with role `teacher` (400 `User is not a teacher`); subject / class group must exist (404 `Subject not found` / `Class group not found`); `rates` ≤ 100, `allowances` ≤ 20.
- `PATCH /salary-terms/:id` (only not started): same body without `teacherId`.
- `DELETE /salary-terms/:id` (only not started) → `{ message: 'Salary terms deleted' }`.
- `PATCH /salary-terms/:id/close` `{ validTo }`.

### Payroll (head)

- `GET /payroll?month=YYYY-MM` → `{ month, rows: [{ teacher: { id, firstName, lastName }, status, accrued, paid, balance, lessons, warnings: { noRate, lessonsWithoutTerms } }], totals: { accrued, paid, balance } }`. Rows: teachers with terms intersecting M, or with a sheet for M.
- `GET /payroll/:teacherId/:month` → `PayrollDetail`:
  `{ teacher, month, status, approvedAt, reopenReason, days: { normDays, defaultDays, workedDays, override }, lines: [{ type, title, date, lessonType, refMonth, amount, noRate, sourceType, sourceId }], adjustments: [{ id, kind, amount, reason, createdAt, createdBy, voidedAt, voidReason }], payments: [{ id, date, amount, method, comment, createdAt, createdBy, voidedAt, voidReason }], totals: { accrued, paid, balance } }`.
- `PATCH /payroll/:teacherId/:month/worked-days` `{ workedDays: number | null }` (0..31, draft only).
- `POST /payroll/:teacherId/:month/adjustments` `{ kind, amount, reason }`; `POST /payroll-adjustments/:id/void` `{ reason }`.
- `POST /payroll/:teacherId/:month/payments` `{ date, amount, method, comment? }`; `POST /payroll-payments/:id/void` `{ reason }`.
- `POST /payroll/:teacherId/:month/approve`; `POST /payroll/:teacherId/:month/reopen` `{ reason }`.
- Every mutation returns the full `PayrollDetail`. Every mutation locks the sheet row (`FOR UPDATE`) inside `$transaction` before reading.
- `:teacherId` not a teacher → 404 `Teacher not found`. Bad month string → 400 `Invalid month`.

### Payroll (teacher)

`@Roles(teacher)`:
- `GET /me/payroll?year=YYYY` → `{ year, months: [{ month, status, accrued, paid, balance }] }` (months with terms or a sheet).
- `GET /me/payroll/:month` → `PayrollDetail` without `createdBy` fields and without voided adjustments / payments.

## Users

- Deleting a teacher with any `SalaryTerms`, `PayrollSheet`, or being creator of payroll records → 400 with the existing message `Cannot delete: user has financial records, deactivate instead`.
- Changing a user's role away from `teacher` while they have salary terms → 400 `User has salary terms`.

## Errors (new messages)

| Status | Message |
|---|---|
| 404 | `Salary terms not found`, `Teacher not found`, `Payroll adjustment not found`, `Payroll payment not found` |
| 400 | `User is not a teacher`, `Salary terms overlap`, `Started salary terms cannot be changed`, `Salary terms are closed`, `Duplicate salary rate`, `Rate does not match class group format`, `Subject rate must be a school lesson`, `Payroll is approved`, `Payroll is not approved`, `Invalid date range`, `Payroll has payments after approval`, `Payroll has later corrections`, `Month is in the future`, `Invalid month`, `Payment date is in the future`, `Adjustment is voided`, `Payment is voided`, `User has salary terms` |

## Frontend

- Admin section «Зарплати» with two tabs:
  - «Відомість»: month picker, table of teachers (нараховано / виплачено / залишок / статус, warnings, totals row). Click → detail: base with editable worked days (draft), lessons grouped by type with count and sum (expandable list), allowances, corrections, adjustments (add / void), payments (add / void), «Затвердити» / «Відкрити повторно».
  - «Умови»: teacher picker → version history, create a new version (monthly rate, calendar, rates, allowances), edit / delete a not-started version, close the open one.
- Teacher page «Моя зарплата»: months of a year with summary, read-only detail.
- New error messages translated in the frontend error map.

## Testing

- `payroll-calc.spec.ts` (no mocks): proration across two versions and a month with holidays; worked-days override; norm 0; most specific rate wins; no rate → 0 + flag; lesson outside terms ignored; corrections: appeared lesson, removed lesson, moved to another teacher, already-booked not repeated; balance and overpayment; rounding.
- Service specs with mocked Prisma: teacher sees only own data; terms overlap / close / started-immutable; approved sheet rejects adjustments and worked-days; reopen blocked by later payments and later corrections; future month; locks issued inside the transaction; user delete and role change guards.

## Out of scope

Taxes, non-teacher staff, staff absence tracking, percentage allowances, per-child or revenue-share lesson pay, Excel export (comes with Part «Звіти»).
