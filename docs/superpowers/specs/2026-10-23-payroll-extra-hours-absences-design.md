# Payroll: extra hours and teacher absences design

Date: 2026-10-23. Status: approved.

Extends `docs/superpowers/specs/2026-10-13-payroll-design.md`. Teachers only (admins and other staff are a non-goal for now).

## Goal

A teacher has a fixed monthly rate (for example 20 000 грн for 9:00–14:00). Two things change the month's pay:

- **Extra hours**: staying after hours is paid per hour at the teacher's own rate (for example 150 грн/год; every teacher has their own).
- **Absences**: an unpaid day off reduces the monthly rate in proportion to the working days of the month; a paid absence (sick leave and similar) does not.

Today this works only by hand: extra hours as a bonus adjustment computed manually, absences by lowering "worked days". The admin wants to record what happened and let the payroll compute.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Who | Teachers only |
| Extra hour rate | Per teacher, in salary terms (`extraHourRate`) |
| Who records | Admins only (payroll `edit`), never the teacher |
| Extra hours entry | A dated record ("5 листопада — 1,5 год") or a monthly record without a date ("12 год за листопад"); both may be mixed |
| Fractions | Allowed (0.5, 1.5, 0.25) |
| Absence entry | One day or a period (3–7 листопада), with a reason and a "paid" checkbox |
| Unpaid absence | Reduces worked days automatically |
| Paid absence | Recorded, does not change pay |
| Teacher cabinet | Per-teacher switch "show details in Моя зарплата"; when on, the teacher sees their extra hours and absences |

## Data model

- `SalaryTerms.extraHourRate Decimal(12,2)?` — null means no extra hours for this version. Versioned with the terms like `monthlyRate` (started versions are never edited; a new version carries the new rate).
- `PayrollExtraHours`: `id`, `teacherId` (User), `month Date` (first day of the month), `date Date?` (inside `month` when set), `hours Decimal(6,2)` (> 0; ≤ 24 when dated, ≤ 400 for a monthly record), `comment String?`, `createdById`, `createdAt`, `voidedAt/voidedById/voidReason`. Never edited.
- `TeacherAbsence`: `id`, `teacherId`, `startDate Date`, `endDate Date` (≥ start, ≤ 92 days long), `paid Boolean`, `reason String` (required, ≤ 200), `createdById`, `createdAt`, `voidedAt/voidedById/voidReason`. Never edited. Active absences of one teacher never overlap.
- `User.payrollDetailsVisible Boolean @default(false)` — the per-teacher cabinet switch.
- `PayrollLineType` gains `extra_hours`.

## Computation

Pure rules go into `payroll-calc.ts` and are tested without mocks.

- **Worked days.** Today `sheetDays` uses `defaultDays` (working days covered by terms in the month) unless the manual `workedDays` override is set. New: `defaultDays` minus the unpaid absence days, where an unpaid absence day is a day inside an active unpaid absence that is a working day by the terms' calendar (`dayInfo` with the terms' `calendarKind`, the same rule as `defaultDays`). Weekends and holidays inside a period are not counted. Paid absences change nothing. The manual override still wins when set (kept for special cases).
- **Extra hours line.** One `extra_hours` line per sheet: total active hours of the month × rate. Rate: for a dated record, the `extraHourRate` of the terms valid on that date; for a monthly record, the rate of the terms valid on the last day of the month that the teacher has terms in. Records whose rate is null are refused at creation (see errors), so the line never has a null rate. If rates differ inside the month, the line amount is the sum per record; the line `meta` keeps the per-record breakdown (`{ hours, rate, amount, date | null }[]`).
- Approve snapshots the `extra_hours` line and the absence-adjusted `approvedDays` like the other lines. An approved sheet never changes.

## Rules

- Records belong to the month of their date (dated hours, absence days). A period absence can span months; each month counts only its own days.
- Creating or voiding extra hours or an absence that touches an approved month → 400 `Payroll is approved` (reopen first). Months in the future: absences may be planned ahead (allowed); extra hours only up to today (400 `Date is in the future`).
- Absence overlap with another active absence of the teacher → 409 `Absence overlaps another absence`.
- Extra hours when the terms have no rate → 400 `No extra hour rate`. No terms at all on the date / in the month → 400 `Salary terms not found` (existing message).
- Voiding needs a reason (≤ 200) like adjustments; voiding twice → 400 `Extra hours are voided` / `Absence is voided`.
- Teacher must have role teacher (existing `User is not a teacher`).
- Audit: the global middleware already logs the requests; no field-level `recordChange` needed (same as adjustments). The visibility switch is recorded with `recordChange` on users (`payrollDetailsVisible`).

## Rules settled after review (builder's calls)

- **Allowances scale too.** Unpaid absences lower worked days, which scales the monthly rate and the monthly allowances alike (unchanged existing behaviour of `share`).
- **Absences and lessons are independent.** Lessons recorded under the teacher on an absence day are still paid as recorded (they are separate lines); the card shows a warning `lessonsOnAbsenceDays` (count + dates) so the admin can fix the lesson record or the absence.
- **Only working days inside the terms' validity count.** Absence days before `validFrom`, after `validTo` or in a gap between versions are ignored.
- **Manual override wins.** With the `workedDays` override set, unpaid absences do not change pay; the card flags it (`days.override = true` plus `unpaidAbsenceDays`), creating an absence never clears the override.
- **Missing rate later.** `No extra hour rate` is checked at creation. If a later terms change leaves a record without a rate, the builder counts it as 0 and marks it `noRate` in the line meta (like lesson lines), plus a warning.
- **Approved months are frozen.** A period absence that overlaps any approved month is refused as a whole (400 `Payroll is approved`); a monthly or dated extra-hours record in an approved month is refused the same way. There is no correction mechanism for hours or absences: reopen the month first (existing reopen rules unchanged).
- **Teacher cabinet with the switch off** shows neither records nor `unpaidAbsenceDays`; with it on, both.

## API

Staff (permission `payroll`; reads `view`, writes `edit`):

- `GET /payroll/:teacherId/:month` (existing card) gains `extraHours: [{ id, date|null, hours, rate, amount, comment, voided... }]`, `absences: [{ id, startDate, endDate, paid, reason, workingDays (in this month), voided... }]`, and `days` shows `unpaidAbsenceDays`.
- `POST /payroll/:teacherId/:month/extra-hours` `{ date?: 'YYYY-MM-DD', hours: '1.5', comment? }` → the card.
- `POST /payroll-extra-hours/:id/void` `{ reason }` → the card.
- `POST /teachers/:teacherId/absences` `{ startDate, endDate?, paid, reason }` (endDate defaults to startDate) → the absence.
- `GET /teachers/:teacherId/absences?from&to` → list (for the card and a future calendar).
- `POST /teacher-absences/:id/void` `{ reason }` → the absence.
- `PATCH /payroll/teachers/:teacherId/details-visibility` `{ visible: boolean }` (payroll `edit`; teachers only) sets `User.payrollDetailsVisible`; the payroll card and `GET /salary-terms` responses include it.
- Salary terms DTOs accept `extraHourRate` (string money, optional, null clears on not-started versions).

Teacher (`/me/payroll/:month`): when `payrollDetailsVisible` is true, the response adds `extraHours` (date, hours, amount, comment) and `absences` (dates, paid, reason) without staff names and without voided records. When false, these keys are absent; the totals and the `extra_hours` line amount are always included so the total stays explainable.

Frontend (separate plan): rate field in the terms dialog; in the payroll card two blocks "Додаткові години" and "Відсутності" with add/void; the visibility switch on the teacher (terms tab or card header); teacher cabinet blocks.

## Non-goals

- Payroll for admins or other staff.
- Teachers recording their own hours or absences.
- Time clock / arrival-departure tracking.
- Different rates by time of day or weekday.
- Absences influencing the attendance register or lessons (they only feed payroll).

## Left to the builder

- Exact response shapes inside the rules above.
- Task split (schema first, pure rules + tests, services, controllers, then frontend).
