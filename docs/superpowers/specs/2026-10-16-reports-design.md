# Reports with Excel design

Date: 2026-10-16. Status: approved in brainstorming, awaiting spec review.

Fourth sub-project of Part «Звіти та захист» (backups → access control → change history → reports with Excel).

## Goal

On-demand reports for any period (a day, a week, a month or custom dates): payments, charges, debts, attendance, lessons, meals, payroll. Each is viewed as a table on screen and can be downloaded as an Excel file with the same content. Every report filters by kindergarten / school / all and by group, and respects the existing access areas and scope.

## Decisions

| Topic | Decision |
|---|---|
| Purpose | Occasional look-ups for an arbitrary period (Q1) |
| Reports | All seven, filterable (Q2) |
| Access | Each report behind its existing area (`view`); scope applied automatically; root sees everything (Q3 A) |
| Excel | Built on the backend with `exceljs` 4.4.0 (new backend dependency, approved) (Q4 A) |
| Architecture | `src/reports/` module, one endpoint per report, pure row/total builders, one shared column model for screen and Excel (approach 1) |

## Common rules

- Period `from`–`to`: `YYYY-MM-DD`, Kyiv days, inclusive. Invalid → 400 `Invalid date`; `to < from` → 400 `Invalid period`; longer than 366 days → 400 `Period too long`. Debts take no period.
- Filters: `kind` (`kindergarten` | `school_class`), `groupId`; per report also `childId` or `teacherId` where listed. A `kind` or `groupId` outside the caller's scope → 403 `Outside access scope`; an unknown group → 404 `Group not found`. Lists are always narrowed to the caller's scope (`childScopeWhere` / `groupScopeWhere`).
- Kind/group of a child-based row is the child's current group.
- Voided records never count; payments count only when `confirmed` (`isCountedPayment`); cancelled meal orders never count.
- Money stays `Prisma.Decimal` in code and is a 2-decimal string in JSON.
- Reports only read data: no transactions, no locks, no audit records.

## Reports

| Report | Route | Area | Extra filters |
|---|---|---|---|
| Payments | `/reports/payments` | finance | childId |
| Charges | `/reports/charges` | finance | childId |
| Debts | `/reports/debts` | finance | childId |
| Attendance | `/reports/attendance` | register | childId |
| Lessons | `/reports/lessons` | timetable (school lessons) and/or classes (class-group lessons) | teacherId |
| Meals | `/reports/meals` | meals | — |
| Payroll | `/reports/payroll` | payroll | teacherId |

1. **Payments.** Rows: received date, child, group, category («без категорії» when null), method, amount, reference/note. Included: counted payments with `receivedAt` in the period. Totals: overall, by method, by category.
2. **Charges.** Rows: date, child, group, category, source (`sourceType` label), description, amount. Date = `periodStart` when set, otherwise the Kyiv day of `createdAt`; a charge is in the period by that date. Totals: overall, by category, by source.
3. **Debts.** State as of today. Rows: child, group, parents with phones, debt per category, total debt, overdue part, oldest unpaid charge date. Computed with `childMoney` / `isOverdue` (`cabinet-calc.ts`) on the child's non-voided charges and counted payments, so numbers match the child's card. Only children with total debt > 0.
4. **Attendance.** Rows: child, group, working days, present (incl. late / left early), absent excused, absent unexcused, unmarked, presence percent (present / working days; empty when no working days). Days resolved like the register: `dayInfo` (calendar), mark → approved notice → unmarked (`resolveDay`, `summarizeDays`). Only days the child belonged to the group (current group). Second sheet `Табель`: child × day with short codes (П, З, Р, В — поважна, Н — неповажна, «·» не відмічено, empty for non-working days).
5. **Lessons.** Rows: teacher, type (`Урок` / `Заняття`), subject or direction, class or class group, count. School lessons = `SchoolLesson` rows (teacher = `teacherId`); class-group lessons = `Lesson` with at least one active `present` attendance (teacher = `conductedById`), same as payroll. A caller with only `timetable` sees school lessons only; with only `classes`, class-group lessons only. Second sheet `Список`: date, period (school lessons), type, subject/direction, class/group, teacher, topic.
6. **Meals.** Rows: date, group, complex, orders count, amount. Non-cancelled orders with `date` in the period. Totals: overall, by day, by complex.
7. **Payroll.** Rows: teacher, month, sheet status (`чернетка` / `затверджена`, «немає відомості» when none and nothing computed), accrued, paid in period, balance (accrued − paid for that sheet, all time). Months = every calendar month the period touches. Draft (or missing) sheets are computed live by `PayrollBuilder`; approved sheets use their `PayrollLine`s. Paid in period = non-voided `PayrollPayment`s with `date` in the period. Teachers without terms and without sheets in those months are omitted. No scope filtering (payroll is not scoped).

## Backend

- `src/reports/`: `reports.module.ts`, `reports.controller.ts`, one service per report (or a few grouped services), `reports-calc.ts` (pure builders), `xlsx-writer.ts`, `dto/report-query.dto.ts`.
- Query `format=json|xlsx` (default `json`).
- JSON response: `{ title, period: { from, to } | null, columns: [{ key, label, type }], rows: Record<string, string | number | null>[], totals: Record<string, string | number | null> | null, sheets?: [{ name, columns, rows }] }`. Column types: `text`, `money`, `number`, `date`, `percent`.
- `xlsx` response: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename*=UTF-8''<name>_<from>_<to>.xlsx` (Ukrainian name, e.g. `оплати`).
- `xlsx-writer.ts` renders a report object: title row (bold, report title + period), frozen header row, number formats (money `0.00`, date `dd.mm.yyyy`, percent `0%`), money written as numbers from `Decimal.toFixed(2)`, bold totals row, column widths from content, one extra worksheet per `sheets` entry.
- Pure builders in `reports-calc.ts` take plain loaded rows and return `{ columns, rows, totals, sheets }`; they reuse `finance-calc`, `cabinet-calc`, `register-calc`, `payroll-calc`, and are tested without mocks.

## Frontend

- Page «Звіти» (`/reports`, nav item visible when any report is available to the user).
- Report list showing only reports the user can open (area checks via `useCan`).
- Filters: quick ranges «Сьогодні», «Цей тиждень», «Цей місяць», «Минулий місяць» (Kyiv dates) plus custom from–to; kind (hidden when the user's scope is narrower than all); group; child or teacher where the report supports it.
- «Сформувати» renders the table from `columns` (formatted money/dates, bold totals); extra `sheets` as tabs below.
- «Завантажити Excel» downloads the same query with `format=xlsx` (blob, file name from `Content-Disposition`).
- States: loading, «Немає даних за період», error with «Спробувати ще».
- API client `src/shared/api/reports.ts` with the response types; translate `Period too long`.

## Errors (new messages)

| Status | Message |
|---|---|
| 400 | `Period too long` |

(`Invalid date`, `Invalid period`, `Outside access scope`, `Group not found` already exist.)

## Testing

- `reports-calc.spec.ts` (no mocks): Decimal totals; categories and methods; charge date rule; debts and overdue equal `childMoney`; attendance with an approved notice and a non-working day; lesson counts incl. a class lesson without present attendance (not counted); meals excluding cancelled; payroll months touched by a period, draft vs approved.
- `xlsx-writer.spec.ts`: build a workbook and read it back with `exceljs` (title, header, number formats, totals row, extra sheets).
- Service specs: scope narrowing, 403 / 400 / 404, `format=xlsx` returns a buffer with the right headers.
- Live check on a scratch port: every report as JSON and xlsx for the current month; a kindergarten-scoped admin sees no school rows; a user without the area gets 403.

## Out of scope

Charts, saved report templates, scheduled e-mailing, PDF export, historical debt as of a past date.
