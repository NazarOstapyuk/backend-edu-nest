# «Сьогодні» dashboard design

Date: 2026-10-16. Status: approved in chat (variant 2), written up for review.

## Why

The current dashboard (`D:\IT\EduNest\src\pages\dashboard`) shows hard-coded numbers (245 pupils, 32 teachers, «Середній бал 4.2») that come from nowhere; only the backup banner is real. The user asked for a page that does a job. Decision: replace it with «Сьогодні» — what needs attention right now, each item a clickable card leading to the page where it gets done.

## Goals

- One screen an admin opens in the morning to see what to act on today.
- Each card shows a number (and a short breakdown) and links to the page that resolves it.
- Every user sees only cards of areas they can access, within their access scope (kindergarten / school / all); a teacher sees their own groups.
- Numbers match the source pages (same rules as the register, finance card, meals, payroll, backups).

## Non-goals

- Charts, trends, history, comparisons with past periods.
- Editing anything from the dashboard.
- A dashboard for parents (they keep the «Сім'я» page; parents landing on `/` keep today's behaviour of being redirected to their cabinet, if any, otherwise see no cards).

## Anti-goals

- Made-up or static numbers.
- Slow first screen: the whole endpoint must answer in well under a second for this institution's size (tens of groups, hundreds of children).
- Leaking data across scopes or to roles without the area.

## Cards

All "today" means the Kyiv day (`kyivToday()`).

| Card | Who sees it | Number | Breakdown / detail | Link |
|---|---|---|---|---|
| Журнал не відмічено | `register` view (all groups in scope) or a teacher (own groups) | groups where today is a working day (`dayInfo` with the group) and at least one child of the group has no active `DailyAttendance` for today and no approved absence notice covering today | list of group names (≤ 10, then «і ще N») | `/register` |
| Заяви на відсутність | `register` view | `AbsenceNotice` with status `pending` (children in scope) | — | `/absence-notices` |
| Прострочені борги | `finance` view | number of children (in scope) with `childMoney(...).overdue > 0` | total overdue amount (money string) | `/finance` |
| Обіди сьогодні | `meals` view, or a teacher (own groups) | non-cancelled `MealOrder` with `date = today` (children in scope / teacher's groups) | count per group | `/meals` |
| Оплати сьогодні | `finance` view | sum of confirmed, non-voided `Payment` with `receivedAt` on today's Kyiv day (children in scope) | sum per method (`cash`, `bank_transfer`, `card`, `online`) and count | `/reports` (payments, today) |
| Онлайн-оплати очікують | `finance` view, only when online payments are enabled | `PaymentInvoice` with status `pending` created more than 15 minutes ago (children in scope) | — | `/finance` |
| Зарплати минулого місяця | `payroll` view | teachers with salary terms overlapping the previous month whose `PayrollSheet` for that month is not `approved` | month label | `/payroll` |
| Резервні копії | `backups` view | shown only when backups are not configured, or the last copy failed or is older than the existing «stale» rule | the existing banner text | `/backups` |

Cards with a zero number are still shown as calm "все добре" tiles (green), except «Резервні копії» and «Онлайн-оплати очікують», which appear only when there is a problem. Cards the user has no access to are not shown at all.

## How it is built (decided)

- Backend: new read-only module `src/dashboard/` with `GET /dashboard/today`, guarded by `JwtAuthGuard` only. Neither `@Roles` nor `@Permission`/`@PermissionAny` fits (the route serves several areas plus the teacher role), so the service decides: parents → 403 `Insufficient permissions`; everyone else gets only the sections they may see (`hasPermission(user, area, view)`, root always; teacher sections by role). A user with none of them gets `{ date }` only. This is a deliberate, documented exception to "always declare roles", noted in CLAUDE.md.
- Response: `{ date: 'YYYY-MM-DD', register?: {...}, notices?: {...}, debts?: {...}, meals?: {...}, payments?: {...}, onlinePending?: {...}, payroll?: {...}, backups?: {...} }`; a key is present only when the user may see that card. Money as 2-decimal strings.
- Reuse existing rules, never re-implement them: `dayInfo` / calendar entries (`CalendarService.entriesBetween`), `childMoney` / `isOverdue` (`cabinet-calc.ts`), `scopeKind` / `childScopeWhere` / `groupScopeWhere`, `canManageRegister` (register teacher rule), backup status from `BackupsService.status()`, online-payments `enabled` from its config.
- Pure counting logic (which groups are unmarked, payment sums per method, payroll pending teachers) goes into `dashboard-calc.ts` and is unit-tested without mocks; the service only loads rows.
- Frontend: `DashboardPage` is rewritten to call `GET /dashboard/today` and render the cards (MUI `Paper` tiles in a grid, like today's layout), each tile a link; loading skeletons; error → «Не вдалося завантажити дані» + «Спробувати ще». The hard-coded `stats` array and its icons go away; `BackupBanner` is replaced by the backups card. Page title «Сьогодні», nav label «Сьогодні» instead of «Дашборд».

## Constraints

- No new dependencies. No schema changes. Read only (no writes, no transactions, no audit records).
- Money is `Prisma.Decimal` in code, 2-decimal strings in JSON.
- Existing conventions in `D:\IT\backend-edu-nest\CLAUDE.md` and `D:\IT\EduNest\CLAUDE.md` apply.

## Left to the builder

- Exact query shapes and how to batch them (one `findMany` per section is fine).
- Card copy beyond the titles above, icons and colours (keep the existing visual style).
- Whether the frontend refreshes the data on window focus.

## Details settled after the builder check

- **Debts:** load non-voided charges and payments with allocations for every in-scope child and run `childMoney` per child, exactly like `/reports/debts` and the finance card do; the number matches the finance card.
- **Links** go to the plain target pages (`/register`, `/absence-notices`, `/finance`, `/meals`, `/payroll`, `/backups`); «Оплати сьогодні» links to `/reports`. No changes to target pages.
- **Sidebar** `pendingNotices` badge stays independent. `/` remains the dashboard route; a staff user with no cards sees «Для вас поки немає карток». Parents keep the current behaviour.
- **Teachers with a permission act as managers** (same rule as the register): `register` view → all groups in scope; otherwise a teacher sees only own groups. Same for meals (`meals` view → all in scope, otherwise own groups). `canManageRegister` is exported from `src/attendance/register.service.ts` (or moved to a shared helper) rather than copied.
- **Unmarked rule** covers groups of both kinds; the calendar is applied per group (`dayInfo(today, group, entries)`, group > kind > all); children counted are those currently in the group (`Child.groupId`); children without a group are not part of the register card.
- **Meals:** non-cancelled orders of in-scope children for today, grouped by the child's group; children without a group appear as «Без групи» (only reachable with scope `all`).
- **Payroll:** a teacher whose salary terms overlap the previous month and who has no approved sheet for it (including no sheet at all) counts as pending. The card always shows (calm at zero).
- **Online pending:** threshold applies to `PaymentInvoice.createdAt`.
- **Backups:** same rule as today's banner (shown when not configured, or the last copy failed or is stale).

## My calls (not discussed with the user)

- The 15-minute threshold for «Онлайн-оплати очікують».
- «Журнал не відмічено» counts a group when any child lacks a mark (not only when nobody is marked).
- Payroll card uses the previous calendar month only.
- Zero-value cards are shown as calm tiles; the two problem-only cards are hidden at zero.
- Nav label renamed to «Сьогодні».
