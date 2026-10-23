# Payroll Extra Hours and Absences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-teacher extra hour rate with recorded extra hours, and teacher absences (paid/unpaid, one day or a period) that adjust worked days, shown on the payroll card and optionally in the teacher cabinet.

**Architecture:** Two new append-only tables (`PayrollExtraHours`, `TeacherAbsence`) plus `SalaryTerms.extraHourRate` and `User.payrollDetailsVisible`. Pure rules in `payroll-calc.ts` compute unpaid absence days and the `extra_hours` line; `PayrollBuilder.compute/detail` load the records; `PayrollService` adds the mutations.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL 16, Jest.

**Spec:** `docs/superpowers/specs/2026-10-23-payroll-extra-hours-absences-design.md` (extends `docs/superpowers/specs/2026-10-13-payroll-design.md`).

## Global Constraints

- Follow `CLAUDE.md` (thin controllers, Nest exceptions, English messages, hand-written DTOs, `Prisma.Decimal` for money/hours, 2-decimal strings in the API, no comments, unit tests with mocked Prisma).
- Migrations: `prisma migrate dev` does not work non-interactively here; generate SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into a new `prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `npx prisma migrate deploy`, then `npx prisma generate`; `migrate diff --exit-code` must print "No difference detected."
- Exact new messages: `No extra hour rate`, `Absence overlaps another absence` (409), `Extra hours are voided`, `Absence is voided`, `Date is in the future`, `Extra hours not found`, `Absence not found`. Reused: `Payroll is approved`, `Salary terms not found`, `User is not a teacher`, `Teacher not found`, `Invalid date range`.
- Limits: hours `> 0`, `≤ 24` when dated, `≤ 400` for a monthly record, 2 decimals; absence length `≤ 92` days; reasons/comments `≤ 200` chars (absence reason required).
- Permissions: reads `@Permission(payroll, view)`, writes `@Permission(payroll, edit)`. Teachers never write.
- Each task: `npm run build`, `npm test`, `npx eslint <changed files>` (never `npm run lint`). Commits with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.

## Review Focus

1. An absence period that crosses a month boundary (Oct 30 – Nov 3): each month counts only its own working days. Test in Task 2.
2. An absence covering a weekend and a holiday: only working days by the terms' calendar are subtracted. Test in Task 2.
3. A monthly extra-hours record in a month where the terms change mid-month: rate from the terms valid on the last covered day. Test in Task 2.
4. Creating a period absence that overlaps an approved month and an open month: refused as a whole with `Payroll is approved`. Test in Task 5.
5. Teacher with `payrollDetailsVisible = false` calling `/me/payroll/:month`: no `extraHours`, `absences`, `unpaidAbsenceDays` keys, totals unchanged. Test in Task 4.

---

### Task 1: Schema and migration

**Files:** `prisma/schema.prisma`, new migration `<ts>_payroll_extra_hours_absences`.

**Interfaces (produces):**
- `SalaryTerms.extraHourRate Decimal? @db.Decimal(12, 2)`.
- `model PayrollExtraHours { id, teacherId (User "PayrollExtraHoursTeacher"), month Date, date Date?, hours Decimal(6,2), comment String?, createdById (User "PayrollExtraHoursCreatedBy"), createdAt, voidedAt?, voidedById? (User "PayrollExtraHoursVoidedBy", Restrict), voidReason?; @@index([teacherId, month]) }`.
- `model TeacherAbsence { id, teacherId (User "TeacherAbsenceTeacher"), startDate Date, endDate Date, paid Boolean, reason String, createdById (User "TeacherAbsenceCreatedBy"), createdAt, voidedAt?, voidedById? (User "TeacherAbsenceVoidedBy", Restrict), voidReason?; @@index([teacherId, startDate]) }`.
- `User.payrollDetailsVisible Boolean @default(false)` plus the back-relations.
- `PayrollLineType` gains `extra_hours`.

- [ ] Step 1: edit schema; generate + apply migration as in Global Constraints; `npx prisma generate`.
- [ ] Step 2: `npm run build` and `npm test` green; drift check prints "No difference detected."
- [ ] Step 3: commit `feat: add payroll extra hours and absences schema`.

### Task 2: Pure rules

**Files:** `src/payroll/payroll-calc.ts`, `src/payroll/payroll-calc.spec.ts`.

**Interfaces (produces):**
- `TermsLike` gains `extraHourRate: Decimal | null`.
- `interface AbsenceLike { id: string; startDate: Date; endDate: Date; paid: boolean; voidedAt: Date | null }`
- `interface ExtraHoursLike { id: string; date: Date | null; hours: Decimal; voidedAt: Date | null }`
- `unpaidAbsenceDays(month: Date, segments: Segment[], absences: AbsenceLike[], entries: CalendarEntryLike[]): number` — active unpaid absences; count days inside the month that fall inside some segment's terms validity and are working by that terms' `calendarKind` (`dayInfo` via the existing `calendarGroup`); a day counted once even if absences touch it twice (cannot happen, but be safe).
- `absenceWorkingDays(month, segments, absence, entries): number` — same count for one absence (for the card).
- `sheetDays(segments, override, unpaidDays = 0): SheetDays` — `workedDays = override ?? max(0, defaultDays - unpaidDays)`; `SheetDays` gains `unpaidAbsenceDays: number`.
- `extraHoursLine(month: Date, terms: TermsLike[], records: ExtraHoursLike[]): ComputedLine | null` — null when no active records; one line `type extra_hours`, title `Додаткові години: <total> год` (total formatted with up to 2 decimals, comma as decimal separator e.g. `1,5`), amount = Σ hours × rate per record; rate = `termsOn(terms, record.date)` for dated records, else terms valid on the last day of the month covered by any terms; missing terms or null rate → that record contributes 0 and the line meta gets `noRate: true`; meta also `extraHours: { id, date: 'YYYY-MM-DD' | null, hours: string, rate: string | null, amount: string }[]` (extend `LineMeta`).
- `lessonsOnAbsenceDays(lessons: LessonSource[], absences: AbsenceLike[]): string[]` — ISO dates of lessons inside active absences (paid or unpaid).
- `SheetInput` gains `absences: AbsenceLike[]`, `extraHours: ExtraHoursLike[]`; `computeSheet` uses them: days via `unpaidAbsenceDays`, appends `extraHoursLine` after base/allowance lines; `warnings` gains `lessonsOnAbsenceDays: string[]` and noRate counts the extra-hours line too.

- [ ] Step 1: failing tests (no mocks): unpaid 3-day absence Mon–Wed in a 21-day month → workedDays 18 and base `20000 × 18/21`; paid absence → unchanged; absence Oct 30–Nov 3 → November counts Nov 2–3 only (Nov 1 is Sunday); absence over a holiday entry (non_working CalendarDay) skips it; absence before `validFrom` ignored; override wins (`workedDays` = override, `unpaidAbsenceDays` still reported); allowance scaled like the rate; extra hours 1.5 dated + 12 monthly at rate 150 → amount 2025.00, title `Додаткові години: 13,5 год`; monthly record with terms changing on Nov 16 (rate 150 → 200) uses 200; null rate → contributes 0 with `noRate`; voided records ignored; `lessonsOnAbsenceDays` returns the lesson date inside an absence.
- [ ] Step 2: run `npx jest src/payroll/payroll-calc.spec.ts` → FAIL. Step 3: implement. Step 4: PASS; `npm test`, build green.
- [ ] Step 5: commit `feat: payroll rules for extra hours and absences`.

### Task 3: Salary terms rate

**Files:** `src/payroll/dto/salary-terms.dto.ts`, `src/payroll/salary-terms.service.ts`, `src/payroll/terms-view.ts` (+ spec).

**Interfaces:** create/update DTOs accept `extraHourRate?: string | null` (money pattern used by `monthlyRate`, `> 0` when set; `null` clears on not-started versions, same edit rules as other fields); views return `extraHourRate: string | null`; audit field list includes `extraHourRate`.

- [ ] Step 1: failing tests: create stores the rate as Decimal; view returns `'150.00'`; update of a started version with a new rate → existing `Started salary terms cannot be changed`. Step 2: FAIL. Step 3: implement. Step 4: PASS, build green.
- [ ] Step 5: commit `feat: extra hour rate in salary terms`.

### Task 4: Builder and card

**Files:** `src/payroll/payroll-builder.service.ts` (+ spec), `src/payroll/payroll.service.ts` (`myMonth`).

**Interfaces:**
- `compute(db, teacherId, month, workedDays, adjustments)` also loads active+voided `teacherAbsence` rows overlapping the month and `payrollExtraHours` rows with that `month` (staff view needs voided ones; `computeSheet` filters `voidedAt`).
- `detail(db, teacher, month, staff)` adds, for draft and approved sheets:
  - `extraHours`: `{ id, date|null, hours, rate|null, amount, comment, createdAt, createdBy? (staff), voidedAt, voidReason }[]` — teacher view: active only, no `createdBy`.
  - `absences`: `{ id, startDate, endDate, paid, reason, workingDays (in this month), createdAt, createdBy? (staff), voidedAt, voidReason }[]` — teacher view: active only.
  - `days.unpaidAbsenceDays` (from `SheetDays`; approved sheets keep what `approvedDays` stored, default 0 for old ones).
  - `warnings.lessonsOnAbsenceDays`.
  - `payrollDetailsVisible` for staff.
- Teacher view (`staff = false`) includes `extraHours`, `absences` and `days.unpaidAbsenceDays` only when the teacher's `payrollDetailsVisible` is true; otherwise those keys are omitted (`TeacherRef` loads the flag).
- Approve keeps using `compute`, so the `extra_hours` line and the new `approvedDays` are snapshotted automatically; confirm with a test.

- [ ] Step 1: failing tests: draft card shows the extra-hours line and absences with `workingDays`; approve snapshots an `extra_hours` line; teacher view with flag false omits the three keys and keeps totals; with flag true includes active records only.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS, build green.
- [ ] Step 5: commit `feat: extra hours and absences on the payroll card`.

### Task 5: Mutations and routes

**Files:** `src/payroll/payroll.service.ts`, `src/payroll/payroll.controller.ts`, `src/payroll/dto/payroll.dto.ts` (+ spec).

**Interfaces / routes:**
- First: a new migration adding `PayrollExtraHours.rate Decimal(12,2)?` (the record's own hourly rate); the builder passes it as `ExtraHoursLike.rate` and the card shows it.
- `POST /payroll/:teacherId/:month/extra-hours` `ExtraHoursDto { date?: string (IsDateString); hours: string (pattern ^\d{1,3}(\.\d{1,2})?$); rate?: string (money pattern, > 0); comment?: string ≤200 }` → card. Rules: date inside the month else 400 `Invalid date range`; date after `kyivToday()` (or month after current month for monthly records) → 400 `Date is in the future`; limits from Global Constraints; terms/rate check only when no own `rate` (`Salary terms not found` / `No extra hour rate`); sheet locked (`lockSheet`) and `assertDraft` → `Payroll is approved`.
- `POST /payroll-extra-hours/:id/void` `{ reason }` → card (`Extra hours not found`, `Extra hours are voided`, approved month → `Payroll is approved`).
- `POST /teachers/:teacherId/absences` `AbsenceDto { startDate; endDate?; paid: boolean; reason: string 1..200 }` → absence view. Rules: endDate ≥ startDate and ≤ 92 days else `Invalid date range`; in one transaction lock the teacher's `User` row (`FOR UPDATE`) to serialise overlapping inserts; overlap with an active absence → 409 `Absence overlaps another absence`; any approved sheet whose month overlaps the period → 400 `Payroll is approved`.
- `GET /teachers/:teacherId/absences?from&to` (payroll view) → list ordered by startDate, voided included.
- `POST /teacher-absences/:id/void` `{ reason }` → absence view (`Absence not found`, `Absence is voided`, approved overlap → `Payroll is approved`; same User lock).
- `PATCH /payroll/teachers/:teacherId/details-visibility` `{ visible: boolean }` → `{ visible }`; teachers only (`User is not a teacher`); `recordChange` on `users` with field `payrollDetailsVisible`.

- [ ] Step 1: failing tests for each rule above (overlap 409; period spanning an approved month refused with no insert; dated hours tomorrow → `Date is in the future`; hours `25` dated → validation/400; null rate → `No extra hour rate`; void twice → `Extra hours are voided`; visibility for a non-teacher → `User is not a teacher`).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS, build green.
- [ ] Step 5: commit `feat: record extra hours and teacher absences`.

### Task 6: Docs

**Files:** `CLAUDE.md` (Domain: payroll bullets for extra hours, absences, visibility; Frontend API list: new routes, card/me fields, new messages).

- [ ] Step 1: update; build + tests green. Step 2: commit `docs: describe payroll extra hours and absences`.

---

Frontend (terms dialog rate field, card blocks «Додаткові години» / «Відсутності», visibility switch, teacher cabinet blocks) is a separate plan in `frontend-edu-nest` after this lands.
