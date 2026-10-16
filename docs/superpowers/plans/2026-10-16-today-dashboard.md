# «Сьогодні» Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake dashboard with «Сьогодні»: real per-user cards (unmarked register, pending notices, overdue debts, today's meals and payments, stuck online payments, unapproved payroll, backup problems), each linking to the page that resolves it.

**Architecture:** Backend `src/dashboard/` (read only): pure counting in `dashboard-calc.ts`, `DashboardService` loads rows per section the user may see, `GET /dashboard/today`. Frontend rewrites `src/pages/dashboard` to render the response.

**Tech Stack:** NestJS 11, Prisma 7, Jest; React 19, MUI 9, Zustand 5, axios.

**Spec:** `docs/superpowers/specs/2026-10-16-today-dashboard-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest` branch `feature/today-dashboard` from `main` (Tasks 1–2); frontend `D:\IT\EduNest` branch `feature/today-dashboard` from `main` (Task 3).

## Global Constraints

- Node 22: `export PATH="/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH"`. No new dependencies, no schema changes, no code comments.
- Read only: no writes, no transactions, no audit records.
- "Today" = `kyivToday()` (`src/tariffs/dates.ts`); Kyiv-day timestamp bounds via `kyivDayStart` (`src/audit/audit-calc.ts`).
- Money: `Prisma.Decimal` in code, 2-decimal strings (`formatMoney`) in JSON; never JS number arithmetic.
- Access: parents → 403 `Insufficient permissions`; sections only for `hasPermission(user, area, view)` (root always) or the teacher role as stated per card; lists narrowed by `scopeKind(user)` (`childScopeWhere` / `groupScopeWhere`). A teacher with the area's permission acts as a manager (all groups in scope); without it, own groups only.
- Thresholds: online invoice pending longer than 15 minutes (`createdAt`); payroll = previous calendar month (Kyiv).
- Route guarded by `JwtAuthGuard` only (documented exception, the service decides access).
- Backend: `npx eslint --fix` on touched files, no new lint errors; jest mocks without `as unknown as` (except Nest framework objects), never `as any`; CRLF files: never stage line-ending-only changes.
- Frontend: tsc baseline `<scratchpad>/fe-tsc-baseline-dashboard.txt` saved before Task 3, per-file counts equal after; eslint 0 errors on touched files; MUI 9 no system props on `Stack`/`Typography`; never touch untracked `children 2.ts`, `children 3.ts`, `CreateSubscriptionModal 2.tsx`, `SubscriptionsPage 2.tsx`; never `git add -A`.
- Commits: Conventional Commits, one task = one commit, `Co-Authored-By` trailer. Never push. Live check on PORT=3101; never print `ROOT_PASSWORD`.
- Scratchpad: `C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad`.

## Review Focus

1. Today is a non-working day for a group (weekend or a `non_working` calendar entry) → that group never appears in «Журнал не відмічено». Pinned in Task 1.
2. A child with an approved absence notice covering today and no mark is not "unmarked". Pinned in Task 1.
3. A kindergarten-scoped admin sees no school data in any card (groups, notices, debts, meals, payments, online invoices). Pinned in Task 2 (service test asserts scope `where` for each section) and the live check.
4. A plain teacher (no permissions) gets only `register` and `meals` sections, limited to own groups; no finance, payroll or backup keys. Pinned in Task 2.
5. Payments received at 23:30 Kyiv today count; 00:30 Kyiv tomorrow does not. Pinned in Task 2 (bounds asserted).

---

### Task 1: Pure dashboard rules

**Files:**
- Create: `src/dashboard/dashboard-calc.ts`, `src/dashboard/dashboard-calc.spec.ts`

**Interfaces:**
- Consumes: `dayInfo`, `resolveDay`, `CalendarEntryLike`, `MarkLike`, `NoticeLike`, `GroupLike` (`src/attendance/register-calc.ts`); `formatMoney`, `sumMoney` (`src/finance/finance-calc.ts`).
- Produces:

```ts
export const PENDING_ONLINE_MINUTES = 15;
export const LIST_LIMIT = 10;
export interface RegisterGroupInput { id: string; name: string; kind: GroupKind; children: { marks: MarkLike[]; notices: NoticeLike[] }[] }
export function unmarkedGroups(today: Date, groups: RegisterGroupInput[], entries: CalendarEntryLike[]): { count: number; names: string[]; more: number };
export function paymentsByMethod(rows: { method: PaymentMethod; amount: Prisma.Decimal }[]): { total: string; count: number; byMethod: Record<PaymentMethod, string> };
export function mealsByGroup(rows: { group: string | null }[]): { count: number; groups: { name: string; count: number }[] };
export function pendingPayrollTeachers(teachers: { id: string; name: string; hasApprovedSheet: boolean }[]): { count: number; names: string[]; more: number };
export function previousMonth(today: Date): { from: Date; to: Date; label: string };
```

Rules: a group is unmarked when `dayInfo(today, group, entries).working` and some child resolves (`resolveDay`) to state `unmarked`; groups without children are never unmarked; `names` sorted, first `LIST_LIMIT`, `more` = remainder. `paymentsByMethod` keys every `PaymentMethod` value (zero → `'0.00'`). `mealsByGroup` names `null` as «Без групи», sorted by name. `previousMonth(2026-10-16)` → `2026-09-01..2026-09-30`, label `'09.2026'`; January → previous December.

- [ ] **Step 0: Branch** — `git checkout main && git checkout -b feature/today-dashboard`.
- [ ] **Step 1: Failing tests** — weekend today → 0; `non_working` entry for the group's kind → 0; all children marked → 0; one child with an approved notice covering today → not counted; one child unmarked → counted; 12 unmarked groups → 10 names + `more: 2`; payments `'100.10' cash + '0.20' card` → total `'100.30'`, `byMethod.bank_transfer '0.00'`; meals with a `null` group → «Без групи»; payroll filters approved; `previousMonth` for 2026-10-16 and 2026-01-05.
- [ ] **Step 2: Run** `npx jest src/dashboard` → FAIL (module not found).
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Run** → PASS; `npm run build`, eslint.
- [ ] **Step 5: Commit** `feat: add dashboard counting rules`.

---

### Task 2: Dashboard service, route, docs, live check

**Files:**
- Create: `src/dashboard/dashboard.service.ts` (+spec), `src/dashboard/dashboard.controller.ts`, `src/dashboard/dashboard.module.ts`
- Modify: `src/app.module.ts`, `src/attendance/register.service.ts` (export `canManageRegister`), `src/backups/backups.module.ts` (export `BackupsService`), `src/online-payments/online-payments.module.ts` (export `OnlinePaymentsService`), `CLAUDE.md`

**Interfaces:**
- Consumes: Task 1; `CalendarService.entriesBetween` (`AttendanceModule` exports it); `BackupsService.status()` → `{ configured, stale, lastFailure, … }`; `OnlinePaymentsService.config()` → `{ enabled }`; `childMoney` (`src/parent-cabinet/cabinet-calc.ts`).
- Produces: `GET /dashboard/today` →

```ts
interface TodayDashboard {
  date: string;
  register?: { count: number; names: string[]; more: number };
  notices?: { count: number };
  debts?: { children: number; amount: string };
  meals?: { count: number; groups: { name: string; count: number }[] };
  payments?: { total: string; count: number; byMethod: Record<'cash' | 'bank_transfer' | 'card' | 'online', string> };
  onlinePending?: { count: number };
  payroll?: { month: string; count: number; names: string[]; more: number };
  backups?: { configured: boolean; stale: boolean };
}
```

Section rules (who / what):
- `register`: `canManageRegister(user)` → groups in scope; else role `teacher` → own groups (`teachers: { some: { id } }`); load groups with current children, today's non-voided `DailyAttendance`, approved `AbsenceNotice`s covering today; entries `entriesBetween(today, today)`.
- `notices`: `register` view → `absenceNotice.count({ status: pending, child: childScopeWhere(scope) })`.
- `debts`: `finance` view → in-scope children with non-voided charges/payments + allocations (same shapes as `src/reports/finance-reports.service.ts` debts), `childMoney(..., today).overdue > 0` → count and sum.
- `meals`: `meals` view → orders of in-scope children; else teacher → orders of children in own groups; non-cancelled, `date = today`.
- `payments`: `finance` view → confirmed non-voided payments of in-scope children with `receivedAt ∈ [kyivDayStart(today), kyivDayStart(today+1))`.
- `onlinePending`: `finance` view and `onlinePayments.config().enabled` → `paymentInvoice.count({ status: pending, createdAt: { lt: now − 15 min }, request: { child: childScopeWhere(scope) } })`; omit the key when the count is 0.
- `payroll`: `payroll` view → teachers with salary terms overlapping `previousMonth`, `hasApprovedSheet` from `payrollSheet` of that month with status `approved`.
- `backups`: `backups` view → from `status()`; omit the key when `configured && !stale`.

Controller: `@UseGuards(JwtAuthGuard) @Controller('dashboard')`, `@Get('today')` → `service.today(user)`. Service throws `ForbiddenException('Insufficient permissions')` for `Role.parent`.

- [ ] **Step 1: Failing service tests** (Prisma as plain `jest.fn()` mocks): parent → 403; plain teacher → keys only `date`, `register`, `meals`, with own-group filters; kindergarten-scoped admin with all areas → every child/group query carries the kindergarten filter (Review Focus 3); payments bounds `gte 2026-10-15T21:00:00.000Z`, `lt 2026-10-16T21:00:00.000Z` for today `2026-10-16` (Review Focus 5; use fake timers); onlinePending omitted when disabled or 0; backups omitted when healthy; root sees all keys.
- [ ] **Step 2: Implement** service, controller, module (imports `AttendanceModule`, `BackupsModule`, `OnlinePaymentsModule`), exports listed above, register in `AppModule`.
- [ ] **Step 3: CLAUDE.md** — add under the reports section a `### Domain: dashboard` paragraph: route, sections and who sees them, the 15-minute and previous-month rules, and that the route is guarded by `JwtAuthGuard` only (service decides; parents 403) as a deliberate exception to "always declare roles".
- [ ] **Step 4: Verify** — `npx jest src/dashboard`, `npm test`, `npm run build`, eslint. Live check on PORT=3101 as root (credentials from `.env`, never printed): `GET /dashboard/today` → 200 with all keys allowed by the data; as the existing kindergarten-scoped admin «Тест Звіт» (login `testzvit_17895`, finance + register view; reset its password as root via `PATCH /users/:id` if unknown, change it as the user) → only `register`, `notices`, `debts`, `payments`(, `onlinePending`) keys; as parent `test_online_parent` → 403. Stop the server.
- [ ] **Step 5: Commit** `feat: add today dashboard endpoint`.

---

### Task 3: Frontend «Сьогодні» page

**Repo:** `D:\IT\EduNest` (read its `CLAUDE.md`).

**Files:**
- Create: `src/shared/api/dashboard.ts` (types mirroring `TodayDashboard`, `dashboardApi.today()`), `src/pages/dashboard/ui/DashboardCard.tsx`
- Modify: `src/shared/api/index.ts`, `src/pages/dashboard/ui/DashboardPage.tsx` (rewrite), delete `src/pages/dashboard/ui/BackupBanner.tsx` and `src/pages/dashboard/model/backupStatusStore.ts` if nothing else imports them, `src/widgets/sidebar/model/nav-items.ts` (label «Сьогодні»), `src/widgets/header/ui/Header.tsx` (title «Сьогодні»), `CLAUDE.md`

UI: a grid of `DashboardCard` tiles (same visual style as the old stats tiles), each a `RouterLink` to its page:
- «Журнал не відмічено» → `/register`, number + group names (+ «і ще N»); 0 → «Усі групи відмічено».
- «Заяви на відсутність» → `/absence-notices`; 0 → «Нових заяв немає».
- «Прострочені борги» → `/finance`, children count + amount; 0 → «Прострочених боргів немає».
- «Обіди сьогодні» → `/meals`, count + per group.
- «Оплати сьогодні» → `/reports`, total + per method («Готівка», «Переказ», «Картка», «Онлайн»).
- «Онлайн-оплати очікують» → `/finance` (only when present).
- «Зарплати за <MM.YYYY>» → `/payroll`, count + names; 0 → «Усі відомості затверджені».
- «Резервні копії» → `/backups` (only when present): «Резервні копії не налаштовані» or «Остання резервна копія невдала або застаріла».
Zero states use a calm (success) colour, non-zero a warning colour. Loading → skeleton tiles; error → «Не вдалося завантажити дані.» + «Спробувати ще»; no keys besides `date` → «Для вас поки немає карток». Data loads on mount (local state, set only in promise callbacks).

- [ ] **Step 1: Branch + baseline** — `git checkout main && git checkout -b feature/today-dashboard`; `npx tsc -b > <scratchpad>/fe-tsc-baseline-dashboard.txt 2>&1`.
- [ ] **Step 2: API client and card component.**
- [ ] **Step 3: Rewrite the page; rename nav and header; remove the old banner/store if unused; CLAUDE.md paragraph.**
- [ ] **Step 4: Verify** — per-file tsc counts equal the baseline; eslint 0 errors on touched files; `git status --short`, add files by name.
- [ ] **Step 5: Commit** `feat: replace dashboard with today page`.
