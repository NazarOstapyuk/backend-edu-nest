# Kindergarten Daily Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every kindergarten group gets a daily routine («Розпорядок дня»): versioned week templates plus per-date overrides, editable by `timetable` permission holders, readable by teachers (own groups) and parents (child's group).

**Architecture:** Backend module `src/routine/` (pure date resolution in `routine-calc.ts`, `RoutineService`, staff/teacher controller, parent controller). Frontend: API client `shared/api/routine.ts`, a shared read-only widget `widgets/routineDay` (view A), page `pages/routine` (tabs «Розклад» and «Шаблон тижня»), and a parent tab in `pages/familyChild`.

**Tech Stack:** NestJS 11, Prisma 7 (Postgres), Jest; React 19, MUI 9, Zustand 5, react-hook-form + yup.

**Spec:** `docs/superpowers/specs/2026-10-23-kindergarten-routine-design.md` (approved; the section «Settled after the builder check» overrides earlier wording).

## Global Constraints

- Backend rules in `D:\IT\backend-edu-nest\CLAUDE.md`; frontend rules in `D:\IT\EduNest\CLAUDE.md`. No code comments, no new dependencies.
- Error messages verbatim: `Routine is for kindergarten groups`, `Routine version already starts on this date`, `Routine template not found`, `Invalid time range`, `Period too long`, `Cannot copy to the same group`, existing `Group not found`, `Child not found`, `Institution is inactive`.
- Times are `HH:MM` strings 00:00–23:59, end > start; title trimmed, 1–300 chars; ≤ 60 items per weekday (template) or per day (override); `workingHours` ≤ 100, `note` ≤ 1000; `GET` ranges ≤ 62 days.
- Dates are UTC-midnight days (`src/tariffs/dates.ts`, `parseDay` in `src/classes/access.ts`); weekday is ISO 1–7 (Mon = 1).
- Permission area `timetable`: reads `view`, writes `edit`. Teachers without it: read only, own groups (`Group.teachers`). Scope via `scopeIds(user)` + `groupScopeWhere`; outside scope or not own → 404 `Group not found`.
- Migrations: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` into a new folder, `npx prisma migrate deploy`, `npx prisma generate`; `--exit-code` must print "No difference detected." Never reset the DB.
- Backend verify: `npm test`, `npm run build`, `npx eslint <changed files>` (not `npm run lint`). Frontend verify: `npm run build`, `npm run lint` (baseline: 1 error in `EditUserModal.tsx`, 6 warnings).
- Commits: Conventional, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Backend tasks commit in `D:\IT\backend-edu-nest`, frontend tasks in `D:\IT\EduNest`.

## Review Focus

- A date whose template version started mid-week or ended yesterday: the routine must switch exactly on `validFrom` (test in Task 2).
- An override with no items on a working day must show an empty day (source `override`), not fall back to the template (test in Task 2).
- Overlapping items (08:00–09:15 and 09:10–09:30) are accepted and kept in start-time order (test in Task 2).
- Creating a version earlier than an existing later one: it gets `validTo` = later start − 1 and the earlier open version is closed at its start − 1 (test in Task 3).
- A teacher without permission requesting a group that is not theirs gets 404 `Group not found`, never the data (test in Task 3).

---

### Task 1: Schema

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<timestamp>_kindergarten_routine/migration.sql`.

**Interfaces:**
- Produces Prisma models:
  - `RoutineTemplate { id, groupId, validFrom @db.Date, validTo @db.Date?, workingHours String?, note String?, createdById, createdAt, updatedAt, items RoutineTemplateItem[] }`, `@@unique([groupId, validFrom])`, index `[groupId, validFrom]`.
  - `RoutineTemplateItem { id, templateId (onDelete Cascade), weekday Int, startTime String, endTime String, title String, sortOrder Int }`.
  - `RoutineDay { id, groupId, date @db.Date, note String?, createdById, createdAt, updatedAt, items RoutineDayItem[] }`, `@@unique([groupId, date])`.
  - `RoutineDayItem { id, dayId (onDelete Cascade), startTime, endTime, title, sortOrder }`.
  - Relations: `Group.routineTemplates`, `Group.routineDays` (Restrict), `User` back-relations for `createdBy` (Restrict).

- [ ] Step 1: Add the models, generate the migration SQL as in Global Constraints, deploy, generate, check no difference.
- [ ] Step 2: `npm run build` and `npm test` green.
- [ ] Step 3: Commit `feat: kindergarten routine schema`.

### Task 2: Pure rules

**Files:** Create `src/routine/routine-calc.ts`, `src/routine/routine-calc.spec.ts`.

**Interfaces:**
- Consumes: `dayInfo(day, group, entries)` from `src/attendance/register-calc.ts`; `addDays`, `isoDay` from `src/tariffs/dates.ts`.
- Produces:
  - `type RoutineItemInput = { startTime: string; endTime: string; title: string }`
  - `normalizeItems<T extends RoutineItemInput>(items: T[]): (T & { sortOrder: number })[]` — trims titles, throws `BadRequestException('Invalid time range')` for a bad `HH:MM` or end ≤ start, sorts by start, end, input order, sets `sortOrder` 0..n.
  - `versionOn<T extends { validFrom: Date; validTo: Date | null }>(versions: T[], day: Date): T | null`
  - `versionBounds(existing: { id: string; validFrom: Date; validTo: Date | null }[], validFrom: Date): { validTo: Date | null; close: { id: string; validTo: Date } | null }` — `validTo` = (next later start − 1) or null; `close` = the version covering `validFrom` (its new `validTo` = validFrom − 1) or null.
  - `resolveRoutine(input: { from: Date; to: Date; group: GroupLike; entries: CalendarEntryLike[]; versions: (VersionLike & { items: (RoutineItemInput & { weekday: number; sortOrder: number })[] })[]; overrides: { date: Date; note: string | null; items: (RoutineItemInput & { sortOrder: number })[] }[] }): RoutineDayView[]` with `RoutineDayView = { date: string; working: boolean; calendarTitle: string | null; source: 'template' | 'override' | 'none'; workingHours: string | null; note: string | null; items: { startTime; endTime; title }[] }`.
    - Override exists → source `override`, its items/note, `workingHours` from the version on that date (or null), `working` from `dayInfo`.
    - Else non-working → source `none`, no items, `workingHours`/`note` null.
    - Else version on that date → items of `weekday` (ISO), its `workingHours`/`note`; no version or no items for that weekday → source `none` (keep version workingHours/note if a version exists).

- [ ] Step 1: Tests (no mocks): `normalizeItems` rejects `25:00`, `10:00–10:00`; keeps overlapping 08:00–09:15 / 09:10–09:30 ordered; `versionOn` switches exactly on `validFrom` and respects `validTo`; `versionBounds` for insert before / between / after existing versions; `resolveRoutine`: template day, Saturday without override → `none`, holiday entry → `working: false` + no items, override on holiday → items + `working: false`, empty override on a working day → `override` with `[]`, ISO weekday mapping (Sunday = 7).
- [ ] Step 2: Run, see them fail. Step 3: implement. Step 4: `npx jest src/routine` green.
- [ ] Step 5: Commit `feat: routine date resolution rules`.

### Task 3: Service, controllers, module

**Files:** Create `src/routine/routine.service.ts`, `routine.service.spec.ts`, `routine.controller.ts`, `parent-routine.controller.ts`, `routine.module.ts`, `dto/routine.dto.ts`; Modify `src/app.module.ts`, `src/parent-cabinet/parent-cabinet.service.ts` (child group view adds `kind`).

**Interfaces:**
- Consumes: Task 2 functions; `CalendarService.entriesBetween` (export it from its module if needed); `scopeIds`, `groupScopeWhere`, `findInstitution(db, id, { active: true })`, `assertOwnChild`, `parseDay`, `isTimetableManager(user, level)` from `src/timetable/roles.ts`.
- Produces routes (all under `@UseGuards(JwtAuthGuard, RolesGuard)`):
  - Reads `@Roles(Role.teacher)` + `@Permission(timetable, view)`: `GET /groups/:id/routine?from&to` → `{ group: {id, name}, days: RoutineDayView[] }`; `GET /groups/:id/routine/templates` → `[{ id, validFrom, validTo, workingHours, note, items: [{ weekday, startTime, endTime, title }] }]` ordered by `validFrom`.
  - Writes `@Permission(timetable, edit)`: `POST /groups/:id/routine/templates` `{ validFrom, workingHours?, note?, items: [{ weekday 1–7, startTime, endTime, title }] }`; `PUT /routine-templates/:id` `{ workingHours?, note?, items }`; `DELETE /routine-templates/:id` → `{ message: 'Routine template deleted' }`; `PUT /groups/:id/routine/days/:date` `{ note?, items }` → the day view; `DELETE /groups/:id/routine/days/:date` → the day view (template again); `POST /groups/:id/routine/copy` `{ sourceGroupId, validFrom }` → the new version. Template writes return the version (same shape as the list item).
  - Parent `@Roles(Role.parent)`: `GET /me/children/:id/routine?from&to` → same shape as the staff read, for the child's group; child without a group or with a school group → `{ group: null, days: [] }`.
- Service rules: group lookup `findFirst({ id, ...groupScopeWhere(scopeIds(user)) })` else 404 `Group not found`; kind ≠ kindergarten → 400 `Routine is for kindergarten groups`; reader without `isTimetableManager(user)` must be in `group.teachers` else 404; writes need the group's institution active; template create/delete/copy lock the group row (`SELECT id FROM "Group" WHERE id = $1 FOR UPDATE`) inside `$transaction`, then use `versionBounds`; same `validFrom` → 409; delete reopens the previous version (`validTo` = deleted.validTo); `from`/`to` default to today (Kyiv)…+6, range > 62 days → 400 `Period too long`, `to < from` → 400 `Invalid period`; ≤ 60 items per weekday/day → else 400 `Too many items`.
- DTOs: class-validator with `@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)` for times, `@ArrayMaxSize(420)` on template items (60 × 7), `@ArrayMaxSize(60)` on day items, `@IsInt @Min(1) @Max(7)` weekday, `@MaxLength` per Global Constraints.

- [ ] Step 1: Service tests with Prisma mocks: scope 404; teacher not in group 404; teacher with permission reads any scoped group; school group 400; create closes the open version and sets `validTo` before a later one; same date 409; delete reopens previous; copy 404 without source version, 400 same group, copies workingHours/note; day override replace + delete; inactive institution 400; period too long 400; parent with school child gets empty days.
- [ ] Step 2: Run, see them fail. Step 3: implement service, DTOs, controllers, module, register in `AppModule`, add `kind` to the parent child group view (update its spec if it asserts the shape).
- [ ] Step 4: `npm test`, `npm run build`, `npx eslint src/routine src/parent-cabinet src/app.module.ts` clean.
- [ ] Step 5: Commit `feat: kindergarten routine api`.

### Task 4: Backend docs

**Files:** Modify `CLAUDE.md`.

- [ ] Step 1: Add «Domain: daily routine» (spec link, models, resolution order override → calendar → template version, versions/locking, permissions/teachers/parents) and a Frontend bullet listing the new routes, response shapes, `group.kind` in parent child views and the new error messages (`Routine is for kindergarten groups`, `Routine version already starts on this date`, `Routine template not found`, `Invalid time range`, `Cannot copy to the same group`, `Too many items`).
- [ ] Step 2: Commit `docs: describe kindergarten routine`.

### Task 5: Frontend API, widget and «Розклад» tab

**Files (D:\IT\EduNest):** Create `src/shared/api/routine.ts`, `src/widgets/routineDay/index.ts`, `src/widgets/routineDay/ui/RoutineWeek.tsx`, `src/pages/routine/index.ts`, `src/pages/routine/model/routineStore.ts`, `src/pages/routine/ui/RoutinePage.tsx`, `src/pages/routine/ui/RoutineScheduleTab.tsx`, `src/pages/routine/ui/DayOverrideDialog.tsx`, `src/pages/routine/ui/RoutineItemsEditor.tsx`; Modify `src/shared/api/index.ts`, `src/shared/api/errorMessages.ts`, `src/app/router/index.tsx`, `src/widgets/sidebar/model/nav-items.ts`.

**Interfaces:**
- Produces: types `RoutineItem`, `RoutineDay`, `RoutineView`, `RoutineTemplate`, `RoutineTemplateDto`, `RoutineDayDto`; `routineApi = { getRoutine(groupId, from, to), getTemplates(groupId), createTemplate(groupId, dto), updateTemplate(id, dto), deleteTemplate(id), saveDay(groupId, date, dto), resetDay(groupId, date), copy(groupId, sourceGroupId, validFrom), getChildRoutine(childId, from, to) }`.
- `RoutineWeek({ days: RoutineDay[]; today: string; onEditDay?: (date: string) => void; onResetDay?: (date: string) => void })` — view A: chips Пн–Пт with dates (a day chip for Сб/Нд only when that day has items), selected day defaults to today if in the week else Monday; list rows «HH:MM–HH:MM  title», the item covering the current Kyiv time on today highlighted (`primary` left border, «зараз»); «Вихідний» (+ calendar title) for `working: false`; working hours line «Режим роботи: …» and the note under the list; «Змінено для цього дня» chip when `source === 'override'`; edit buttons only when callbacks are passed.
- `RoutineItemsEditor({ value, onChange, error })` — rows «з» (`type="time"`), «до», «що робимо», remove icon, «+ Пункт»; reused by Task 6.
- Page: menu «Розпорядок дня» (`ScheduleIcon`-like icon, visible for `area: 'timetable'` or role teacher), route `/routine`; group picker = kindergarten groups (`GET /groups`, filtered `kind === 'kindergarten'`; teachers without the permission: groups where they are a teacher), week navigation (‹ ›, Mon–Sun range), tabs «Розклад» | «Шаблон тижня» (the second only for `useCan('timetable','edit')`; Task 6 fills it).
- Error translations: `Routine is for kindergarten groups` → «Розпорядок дня є лише для садкових груп», `Routine version already starts on this date` → «Версія з цієї дати вже існує», `Routine template not found` → «Шаблон розпорядку не знайдено», `Invalid time range` → «Кінець має бути пізніше за початок», `Cannot copy to the same group` → «Не можна копіювати в ту саму групу», `Too many items` → «Забагато пунктів».

- [ ] Step 1: API client + translations. Step 2: widget. Step 3: page, store, override dialog (prefilled with the day's items, «Зберегти», and «Скинути до шаблону» when source is override).
- [ ] Step 4: `npm run build`, `npm run lint` at baseline.
- [ ] Step 5: Commit `feat: kindergarten routine page`.

### Task 6: «Шаблон тижня» editor

**Files:** Create `src/pages/routine/ui/RoutineTemplateTab.tsx`, `src/pages/routine/ui/CopyRoutineDialog.tsx`; Modify `src/pages/routine/ui/RoutinePage.tsx`, `src/pages/routine/model/routineStore.ts`.

**Interfaces:** Consumes `routineApi`, `RoutineItemsEditor`.

- [ ] Step 1: Versions list («з 01.11.2026 – дотепер», «з … по …»), select one to edit; «Нова версія з дати» (date + start from a copy of the selected version or empty); delete version with confirmation.
- [ ] Step 2: Editor: weekday chips Пн–Пт (+ Сб/Нд only if they have items), `RoutineItemsEditor` per weekday, «Скопіювати день у…» (multi-select weekdays, replaces their items), fields «Режим роботи» and «Примітка», one «Зберегти» for the whole version (`PUT`), unsaved-changes guard on version switch.
- [ ] Step 3: «Скопіювати з іншої групи» dialog: source group (kindergarten groups in scope except current) + «Діє з» date → `POST copy`, then reload versions.
- [ ] Step 4: `npm run build`, `npm run lint` at baseline. Step 5: Commit `feat: routine week template editor`.

### Task 7: Parent tab and frontend docs

**Files:** Create `src/pages/familyChild/ui/RoutineTab.tsx`, `src/pages/familyChild/model/childRoutineStore.ts`; Modify `src/pages/familyChild/ui/FamilyChildPage.tsx`, `src/shared/api/parentCabinet.ts` (group `kind`), `CLAUDE.md`.

- [ ] Step 1: Tab «Розпорядок» shown when the child's `group.kind === 'kindergarten'`, using `RoutineWeek` read-only with week navigation; the existing «Розклад» tab hidden for kindergarten children (it shows school lessons only).
- [ ] Step 2: `CLAUDE.md`: a «Daily routine» paragraph (page, widget, parent tab, API module; routine data comes from the backend, never computed on the frontend).
- [ ] Step 3: `npm run build`, `npm run lint` at baseline. Step 4: Commit `feat: routine in the parent cabinet`.
