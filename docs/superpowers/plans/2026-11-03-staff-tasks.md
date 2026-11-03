# Staff Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Root gives tasks to admins and teachers, admins to teachers, with an exact Kyiv deadline; each assignee marks done; author and assignee see overdue items on the Today page.

**Architecture:** New backend module `src/staff-tasks/` (service decides access, pure `tasks-calc.ts`), a migration with two tables, a `tasks` section in the dashboard. Frontend: page `pages/tasks` (tabs «Мої» and «Поставлені»), a create/edit dialog, a menu counter and dashboard rows.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Jest; React 19, MUI 9, Zustand, react-hook-form/yup.

**Spec:** `docs/superpowers/specs/2026-11-03-staff-tasks-design.md` (backend repo). The "Calls made by me" section is binding.

## Global Constraints

- Backend `D:\IT\backend-edu-nest`, frontend `D:\IT\EduNest`, branch `main`, commit per task, never push. Read each repo's `CLAUDE.md` first and follow it (module conventions with `src/children/` as reference, no comments, English error messages, no new dependencies, FSD and mobile rules on the frontend).
- Prisma CLI needs Node 22: prefix commands with `PATH=/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH`. Create the migration with `npx prisma migrate dev --name staff_tasks`. Never reset or drop data.
- Backend verification per task: `npx jest <changed specs>`, `npx eslint <changed files>` (not `npm run lint`), `npm run build`, then full `npx jest`. Frontend: `npm run build`, `npm run lint` at baseline (7 problems: 1 error `useForm<any>` in `EditUserModal.tsx`, 6 warnings).
- Access is role-based, no permission area: `root` assigns `admin` and `teacher`; `admin` assigns `teacher` only; `teacher` only receives; `parent` gets 403 `Insufficient permissions` on every route. Routes use `JwtAuthGuard` only and the service decides (like `DashboardService`); never put `Role.admin`/`Role.root` in `@Roles`.
- Admin institution match: admin's granted scope `baseScope(actor)` (`src/access/access-calc.ts`, header ignored); `null` = any active teacher; otherwise the teacher must have `accessScope = institutions` and at least one `UserInstitution` in that set.
- Deadline input `dueDate` (`YYYY-MM-DD`) + `dueTime` (`HH:MM`), Europe/Kyiv; stored as `dueAt` instant via `deadlineFor(parseDay(dueDate), dueTime)` from `src/meals/meals-calc.ts` (validate with `parseTime`). Responses carry `dueAt` (ISO) plus `dueDate`/`dueTime` in Kyiv.
- Limits: title trimmed 1–200, description ≤ 2000 (trimmed, empty → null), 1–200 unique assignees.
- History window 30 days; page size 30.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Kyiv deadline: `dueDate 2026-11-03`, `dueTime 14:00` is `12:00Z` in winter, `11:00Z` in summer; overdue flips at that instant.
- A deactivated assignee: not counted in `done/total`, absent from `notDone`, gets no dashboard rows, but the row stays visible to the author with `isActive: false`.
- Removing then re-adding the same person: one row (unique `taskId,userId`), `removedAt` cleared and `doneAt` reset to null.
- A scoped admin picking a teacher with scope `all` or of another institution → 403 `Cannot assign this user`; the `assignable` list must never offer such a teacher.
- An assignee calling `GET /staff-tasks/given` sees only tasks they authored (teachers: always empty / 403), never other assignees of a task given to them.

---

### Task 1: Schema, migration, delete guard, pure rules (backend)

**Files:** `prisma/schema.prisma`, new migration, `src/users/users.service.ts` (+ spec), create `src/staff-tasks/tasks-calc.ts`, `src/staff-tasks/tasks-calc.spec.ts`.

**Produces (Prisma models):**
- `StaffTask { id uuid, title, description String?, dueAt DateTime, createdById (User "StaffTaskCreatedBy", Restrict), cancelledAt DateTime?, cancelledById String? (User "StaffTaskCancelledBy", Restrict), createdAt, updatedAt, assignees StaffTaskAssignee[]; @@index([createdById, dueAt]) }`
- `StaffTaskAssignee { id uuid, taskId (Cascade), userId (User "StaffTaskAssignee", Restrict), doneAt DateTime?, removedAt DateTime?, createdAt, updatedAt; @@unique([taskId, userId]) @@index([userId]) }`

**Produces (`tasks-calc.ts`):**
- `type AssignTarget = { role: Role; isActive: boolean; accessScope: AccessScope; institutionIds: string[] }`
- `canAssign(actorRole: Role, actorBase: Set<string> | null, target: AssignTarget): boolean` (rules in Global Constraints; inactive → false; root/parent targets → false).
- `type AssigneeState = 'open' | 'overdue' | 'done' | 'cancelled'`; `assigneeState(task: { dueAt: Date; cancelledAt: Date | null }, row: { doneAt: Date | null }, now: Date): AssigneeState` (cancelled wins, then done, then `now > dueAt` → overdue).
- `progress(rows: { doneAt: Date | null; removedAt: Date | null; user: { isActive: boolean } }[]): { done: number; total: number }` (removed and inactive rows not counted).
- `isClosed(task: { cancelledAt: Date | null }, counted: { done: number; total: number }): boolean` (cancelled, or `total > 0 && done === total`).
- `normalizeTitle(raw: string): string | null` (trim, 1–200 else null), `normalizeDescription(raw?: string | null): { value: string | null } | null` (trim; empty or missing → `{ value: null }`; > 2000 → `null` = invalid).

- [ ] Step 1: Failing tests: `canAssign` matrix (root→admin ok, root→teacher ok, root→root/parent no, admin→admin no, admin(all)→teacher ok, admin({A})→teacher institutions [A,B] ok, admin({A})→teacher institutions [B] no, admin({A})→teacher scope all no, inactive teacher no, teacher actor no); `assigneeState` at `dueAt − 1ms`, `dueAt + 1ms`, done after deadline → done, cancelled+done → cancelled; `progress` skipping removed and inactive; `isClosed`; title/description bounds. Users delete test: refuses when `staffTask.count` or `staffTaskAssignee.count` > 0.
- [ ] Step 2: Schema + migration + generate; implement `tasks-calc.ts`; add `staffTask.count({ where: { OR: [{ createdById: id }, { cancelledById: id }] } })` and `staffTaskAssignee.count({ where: { userId: id } })` to the existing user delete guard (keeps its message `Cannot delete: user has financial records, deactivate instead`; ruling over the spec's `User has tasks`, same guard, one stable message).
- [ ] Step 3: Tests pass, eslint, build, full jest. Commit `feat: add staff tasks schema and rules`.

### Task 2: Staff tasks API and dashboard (backend)

**Files:** create `src/staff-tasks/staff-tasks.module.ts` (register in `AppModule`, export the service), `staff-tasks.service.ts`, `staff-tasks.controller.ts`, `dto/create-staff-task.dto.ts`, `dto/update-staff-task.dto.ts`, `dto/list-staff-tasks.dto.ts`, `staff-tasks.service.spec.ts`; modify `src/dashboard/dashboard.service.ts` (+ spec, + module import), backend `CLAUDE.md` (new `### Domain: staff tasks` and a "Staff tasks API" bullet in the Frontend section).

**Consumes:** Task 1 functions, `baseScope`, `deadlineFor`/`parseTime`, `parseDay`/`isoDay`/`kyivToday` (`src/tariffs/dates.ts`).

**Produces (routes, `@UseGuards(JwtAuthGuard)`; parent → 403 `Insufficient permissions` everywhere):**
- `GET /staff-tasks/assignable` (root/admin, else 403 `Insufficient permissions`) → `[{ id, firstName, lastName, middleName, role }]` active users passing `canAssign`, by last/first name.
- `POST /staff-tasks` (root/admin) `{ title, description?, dueDate, dueTime, assigneeIds: uuid[] }` → `GivenTaskView`.
- `PATCH /staff-tasks/:id` (author only) `{ title?, description?, dueDate?, dueTime?, assigneeIds? }` → `GivenTaskView`. `dueDate`/`dueTime` must come together (400 `Invalid deadline`). `assigneeIds` replaces the set: missing rows → `removedAt = now`; new or removed rows → created / `removedAt = null, doneAt = null`; kept rows untouched; added users must pass `canAssign` (403 `Cannot assign this user`), already present ones are not re-checked.
- `POST /staff-tasks/:id/cancel` (author or root) → `GivenTaskView`.
- `GET /staff-tasks/given?before&all` (root/admin) → `{ items: GivenTaskView[], nextBefore: string | null }`. Default: tasks authored by the actor (root with `all=true`: every task) that are open (not `isClosed`) plus closed ones with `dueAt ≥ now − 30 days`, open first by `dueAt` asc, then closed by `dueAt` desc; `nextBefore` = the cutoff ISO when older closed tasks exist, else null. With `before` (ISO): closed tasks with `dueAt < before`, `dueAt` desc, 30 items, `nextBefore` = last item's `dueAt` when a full page came back.
- `GET /staff-tasks/mine?before` (root never has assignments: empty) → `{ items: MyTaskView[], nextBefore }`, same paging over the actor's non-removed rows (closed = done or cancelled).
- `POST /staff-tasks/:id/done`, `POST /staff-tasks/:id/undone` (the assignee, non-removed row; else 404 `Task not found`) → `MyTaskView`; cancelled → 400 `Task is cancelled`; done on a done row / undone on an open row → unchanged view.
- `GET /staff-tasks/summary` → `{ open: number, overdue: number }` (actor's non-removed, not done, not cancelled rows; overdue subset).
- Views: `GivenTaskView = { id, title, description, dueAt, dueDate, dueTime, cancelledAt, author: { id, firstName, lastName }, overdue: boolean (not closed, not cancelled, now > dueAt, some counted row not done), done, total, assignees: [{ id, firstName, lastName, middleName, role, isActive, doneAt }] }` (non-removed rows by last name). `MyTaskView = { id, title, description, dueAt, dueDate, dueTime, author: { id, firstName, lastName }, status: AssigneeState, doneAt }` (no other assignees, no counts).
- Errors: `Task not found` (404, also for a non-author non-root editing or cancelling, so tasks of others are not revealed: root non-author editing → 403 `Not your task`), `Task is cancelled` (400), `Deadline is in the past` (400, on create and when the deadline changes), `Invalid deadline` (400), `Invalid title` (400), `Invalid description` (400), `Cannot assign this user` (403), `Duplicate assignee` (400), `Insufficient permissions` (403). DTO: `@ArrayMinSize(1) @ArrayMaxSize(200)`, `@IsUUID('4', { each: true })`.
- Concurrency: update/cancel lock the `StaffTask` row `FOR UPDATE` in `$transaction` and re-check cancelled; done/undone lock it `FOR SHARE`, then update the assignee row.
- Dashboard: `TodayDashboard.tasks?: { mine: { id, title, dueAt, dueTime, overdue: boolean }[]; given: { id, title, dueAt, dueTime, done, total, notDone: { id, firstName, lastName }[] }[] }` for root/admin/teacher; `mine` = actor's open rows with `dueAt` on Kyiv today or overdue, overdue first then `dueAt`; `given` = actor-authored tasks (root: own only) with `overdue: true`, by `dueAt`; omitted when both empty. Deactivated users get nothing (they cannot log in anyway).

- [ ] Step 1: Service tests (mocked Prisma): teacher create → 403; parent any route → 403; admin assigns admin → 403 `Cannot assign this user`; deadline in the past → 400; create ok with Kyiv conversion (`2026-11-03` `14:00` → `2026-11-03T12:00:00.000Z`); update by non-author admin → 404, by root non-author → 403 `Not your task`; root cancels admin's task ok; update cancelled → 400; assignee replace marks removed and re-adds with `doneAt` null; done by non-assignee → 404; done on cancelled → 400; `given` view excludes removed rows and counts only active users; `mine` view has no assignee list; summary counts; dashboard `tasks` present for a teacher with an overdue task, omitted when empty, `given` lists `notDone` names.
- [ ] Step 2: Implement service, controller, DTOs, module; dashboard section + spec.
- [ ] Step 3: Document in backend `CLAUDE.md`: domain section (rules above, short) and the API bullet listing routes, shapes and errors.
- [ ] Step 4: Tests, eslint, build, full jest. Commit `feat: add staff tasks api`.

### Task 3: Tasks page, dialog, menu counter (frontend)

**Files:** create `src/shared/api/staffTasks.ts` (mirrored types + `staffTasksApi`), export from `src/shared/api/index.ts`; `src/shared/api/errorMessages.ts` (every new backend message, Ukrainian); create `src/pages/tasks/` (`index.ts`, `ui/TasksPage.tsx`, `ui/MyTasksTab.tsx`, `ui/GivenTasksTab.tsx`, `ui/TaskDialog.tsx`, `model/tasksStore.ts`); `src/shared/model/pendingTasksStore.ts` (`open`, `overdue`, `refresh()` from `/staff-tasks/summary`); route `/tasks` in `src/app/router/index.tsx`; nav item «Завдання» (`roles: ['root', 'admin', 'teacher']`, `badge: 'pendingTasks'`, placed after «Сьогодні») in `src/widgets/sidebar/model/nav-items.ts` + badge handling in `Sidebar.tsx` (count = `open`, warning color when `overdue > 0`); page title in `Header.tsx`.

- «Мої»: cards (phone full width) with title, description, «до 03.11 14:00», author, status chip («Прострочено» warning, «Виконано», «Скасовано»); primary action «Виконано», on done rows «Скасувати відмітку»; open first, then history, «Показати раніше» uses `nextBefore`. After any action refresh `pendingTasksStore`.
- «Поставлені» (root/admin only; root has a «Усі завдання» switch → `all=true`): cards/table with title, deadline, «3 з 5», overdue chip; expanding shows assignees with ✓ and time or «не виконав», inactive ones greyed; actions «Редагувати», «Скасувати завдання» (`ConfirmDialog`). Button «Нове завдання».
- `TaskDialog` (fullScreen on phone): title, description, date + time (default today, next full hour), assignees multi-select from `GET /staff-tasks/assignable` with search and «Вибрати всіх вчителів» / role filter, selected count; on edit prefilled, removed people warned «відмітка виконання зникне».
- Dates formatted in `Europe/Kyiv` via `Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', ... })`.

- [ ] Step 1: Implement; build; lint at baseline. Commit `feat: add staff tasks page`.

### Task 4: Dashboard rows and docs (frontend)

**Files:** `src/shared/api/dashboard.ts` (type `tasks`), `src/pages/dashboard/ui/DashboardPage.tsx` (attention rows: assignee «Прострочено: {title}» / «Сьогодні до {time}: {title}», author «Не виконали: {title}, {total − done} з {total}» with names; each links to `/tasks` with the right tab via `?tab=mine|given`; `TasksPage` reads `tab`), frontend `CLAUDE.md` (tasks page, store, badge, API file).

- [ ] Step 1: Implement; build; lint at baseline. Commit `feat: show staff tasks on dashboard`.
