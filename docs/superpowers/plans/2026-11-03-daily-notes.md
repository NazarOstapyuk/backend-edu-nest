# Daily Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins define question sets per institution and assign them to groups; teachers answer them daily per child; parents see the answers; teachers are reminded in the CRM.

**Architecture:** New backend module `src/daily-notes/` (sets service, notes service, pure `notes-calc.ts`), a migration with three tables, a `notes` section in the dashboard and a parent cabinet route. Frontend: a new page `pages/notes` (tabs «Заповнення» and «Питання»), a menu counter, a dashboard row and a parent «Нотатки» section.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Jest; React 19, MUI 9, Zustand, react-hook-form/yup.

**Spec:** `docs/superpowers/specs/2026-11-03-daily-notes-design.md` (backend repo). The "Calls made by me" section is binding.

## Global Constraints

- Backend `D:\IT\backend-edu-nest`, frontend `D:\IT\EduNest`, branch `main`, commit per task, never push. Read each repo's `CLAUDE.md` first and follow it (module conventions with `src/children/` as reference, no comments, English error messages, no new dependencies, FSD and mobile rules on the frontend).
- Prisma CLI needs Node 22: prefix commands with `PATH=/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH`. Create the migration with `npx prisma migrate dev --name daily_notes`. Never reset or drop data.
- Backend verification per task: `npx jest <changed specs>`, `npx eslint <changed files>` (not `npm run lint`), `npm run build`, then full `npx jest`. Frontend: `npm run build`, `npm run lint` at baseline (7 problems: 1 error `useForm<any>` in `EditUserModal.tsx`, 6 warnings).
- Access reuses area `register`: `register: view` reads, `register: edit` manages sets and fills any group in scope (any past day, reason outside the window); role `teacher` fills/reads own groups (`Group.teachers`) within `attendanceEditDays` (`RegisterService.getEditDays()`).
- Deadline: `HH:MM` Europe/Kyiv on the note's day, default `17:00`; reuse `parseTime` / `deadlineFor` from `src/meals/meals-calc.ts`.
- Limits: set name trimmed 1–100 (unique per institution), ≤ 30 questions per set, question text 1–300, choice 2–10 options each 1–50 (unique, trimmed), unit ≤ 20, number |value| ≤ 99999999.99 with ≤ 2 decimals, text answer ≤ 1000.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A child moved to another group: only children whose current `groupId` is the group can be answered (400 `Child is not in this group`); the day view lists current members only.
- A choice option renamed after answers exist: old answers keep their snapshot label in views; saving the old label again is 400 `Invalid answer`.
- Number answers as strings with a comma or letters (`"2,5"`, `"abc"`) are 400 `Invalid answer`; the frontend sends numbers with a dot.
- The same child + question twice in one save → 400 `Duplicate answer`.
- Deadline in Kyiv time: `17:00` Kyiv is `15:00Z` in winter; overdue must flip at that instant, not at 17:00 UTC.

---

### Task 1: Schema, migration and delete guards (backend)

**Files:** `prisma/schema.prisma`, new migration, `src/children/children.service.ts`, `src/groups/groups.service.ts`, `src/users/users.service.ts` + their specs.

**Produces (Prisma models):**
- `enum NoteQuestionType { choice text yes_no number }`
- `NoteSet { id uuid, institutionId (Restrict), name, deadline String @default("17:00"), active Boolean @default(true), groups Group[] @relation("NoteSetGroups"), questions NoteQuestion[], createdAt, updatedAt; @@unique([institutionId, name]) }`
- `NoteQuestion { id, setId (Cascade), text, type NoteQuestionType, required Boolean @default(false), options String[], min Decimal? @db.Decimal(10,2), max Decimal? @db.Decimal(10,2), unit String?, sortOrder Int, active Boolean @default(true), answers NoteAnswer[], createdAt, updatedAt; @@index([setId]) }`
- `NoteAnswer { id, childId, groupId, questionId (Restrict), date @db.Date, questionText, questionType NoteQuestionType, unit String?, valueText String?, valueBool Boolean?, valueNumber Decimal? @db.Decimal(10,2), answeredById (User "NoteAnsweredBy"), createdAt, voidedAt?, voidedById? (User "NoteVoidedBy", Restrict), voidReason?; @@index([childId, date]) @@index([groupId, date]) }` (choice and text both use `valueText`). Back-relations on Child, Group, User, Institution.

- [ ] Step 1: Failing tests: children/groups/users delete refuse when `noteAnswer.count` > 0 with the existing messages (`Cannot delete: child has financial records` style lists already used there: add the count to the same guard as `dailyAttendance`).
- [ ] Step 2: Schema + `npx prisma migrate dev --name daily_notes` + `npx prisma generate`; add the counts to the three guards.
- [ ] Step 3: Tests pass, eslint, build, full jest. Commit `feat: add daily notes schema`.

### Task 2: Pure rules (backend)

**Files:** create `src/daily-notes/notes-calc.ts`, `src/daily-notes/notes-calc.spec.ts`.

**Produces:**
- `type QuestionInput = { text: string; type: NoteQuestionType; required?: boolean; options?: string[]; min?: number | null; max?: number | null; unit?: string | null }`
- `validateQuestion(q: QuestionInput): string | null` → null or an error message: `Invalid question text`, `Choice needs 2 to 10 options`, `Invalid option`, `Duplicate option`, `Options are only for choice questions`, `Invalid range` (min > max or outside limits), `Invalid unit`.
- `type AnswerValue = { valueText: string | null; valueBool: boolean | null; valueNumber: string | null }`
- `normalizeAnswer(q: { type; options: string[]; min: string | null; max: string | null }, raw: unknown): { clear: true } | { clear: false; value: AnswerValue } | { error: 'Invalid answer' }`: `null`, `''` (after trim) → clear; choice: string equal to an option; text: string ≤ 1000 after trim; yes_no: boolean; number: finite JS number or a string matching `^-?\d{1,8}(\.\d{1,2})?$`, within min/max; `valueNumber` returned as a 2-decimal string.
- `isComplete(questions: { id: string; required: boolean }[], answeredIds: Set<string>): boolean` (required all answered; no required → at least one answered; no questions → true).
- `type PendingSet = { deadline: string; questions: { id: string; required: boolean }[] }`, `pendingForGroup(sets: PendingSet[], expectedChildIds: string[], answered: Map<string, Set<string>>, date: Date, now: Date): { pending: number; overdue: boolean }` (a child counts once if incomplete for any set; `overdue` when some set with an incomplete expected child is past `deadlineFor(date, deadline)`).

- [ ] Step 1: Tests: each `validateQuestion` error; `normalizeAnswer` for every type incl. `"2,5"` / `"abc"` → error, `2.5` → `"2.50"`, `"3"` → `"3.00"`, out of min/max → error, renamed option → error, `null`/`'  '` → clear; `isComplete` cases above; `pendingForGroup` with deadline `17:00` on `2026-11-03`: `now = 2026-11-03T14:59:00Z` → overdue false, `15:00:00Z` → true; absent children not passed in → not counted; two sets with different deadlines.
- [ ] Step 2: Implement; tests pass; eslint; commit `feat: add daily notes rules`.

### Task 3: Question sets API (backend)

**Files:** create `src/daily-notes/daily-notes.module.ts` (register in `AppModule`), `note-sets.service.ts`, `note-sets.controller.ts`, `dto/create-note-set.dto.ts`, `dto/update-note-set.dto.ts`, `dto/note-question.dto.ts`, `note-sets.service.spec.ts`.

**Produces (routes, `JwtAuthGuard, RolesGuard`):**
- `GET /note-sets` (`register: view`) → `NoteSetView[]` in the effective scope, by institution name then set name. `NoteSetView = { id, name, deadline, active, institution: { id, name }, groups: { id, name }[], questions: { id, text, type, required, options, min: number|null, max: number|null, unit, active, sortOrder, answered: boolean }[] }` (questions by `sortOrder`, inactive included).
- `POST /note-sets` (`register: edit`) `{ institutionId, name, deadline?, groupIds: uuid[], questions: QuestionDto[] }` → view. `QuestionDto = { id?: uuid, text, type, required?, options?, min?, max?, unit? }`; order = array order.
- `PATCH /note-sets/:id` (`register: edit`) `{ name?, deadline?, active?, groupIds?, questions? }` → view. `questions` replaces the list: items with `id` update that question (type cannot change once `answered`: 400 `Question type cannot change`), items without `id` are created, omitted questions are deleted when never answered, else set `active: false`; sending an inactive question's id reactivates it.
- `DELETE /note-sets/:id` (`register: edit`) → `{ message: 'Note set deleted' }`, or 400 `Note set is in use` when any of its questions has answers (then deactivate instead).
- Rules: institution via `findInstitution` (404/400 inactive) and in the granted scope (`baseScope`, else 403 `Outside access scope`); set outside the effective scope → 404 `Note set not found`; every `groupId` must exist in that institution (400 `Group belongs to another institution`, unknown → 404 `Group not found`); `deadline` via `parseTime` (400 `Invalid deadline`); > 30 questions → 400 `Too many questions`; question errors from `validateQuestion` (400); duplicate name → 409 `Note set name already taken`. Update/delete lock the `NoteSet` row `FOR UPDATE` in `$transaction`. Audit `recordChange` with `entityType: 'note-sets'` for name, deadline, active, groups (ids), questions (count + texts).

- [ ] Step 1: Service tests (mocked Prisma): create ok; scoped user + other institution → 403; foreign group → 400; bad deadline; too many questions; rename to taken name → 409; update removes an answered question → deactivated not deleted; type change of answered question → 400; delete in use → 400.
- [ ] Step 2: Implement; tests, eslint, build, full jest. Commit `feat: add note sets api`.

### Task 4: Notes, reminders, parents, dashboard (backend)

**Files:** create `src/daily-notes/daily-notes.service.ts`, `daily-notes.controller.ts`, `dto/save-notes.dto.ts`, `daily-notes.service.spec.ts`; modify `src/parent-cabinet/` (controller + service + spec) or add a parent controller in the module with `@Roles(Role.parent)` under `me/children`, `src/dashboard/dashboard.service.ts` (+ spec), backend `CLAUDE.md` (domain section + Frontend API list).

**Consumes:** Task 2 functions, `RegisterService.getEditDays()`, `CalendarService.entriesBetween`, `dayInfo` / `resolveDay` from `register-calc.ts`, `assertOwnChild`.

**Produces (routes):**
- `GET /daily-notes/groups` → groups the user may fill or read that have ≥ 1 active set: teachers own groups, `register: view` all groups in scope → `[{ id, name, kind, institution: { id, name } }]` by name.
- `GET /groups/:groupId/notes/:date` → `NotesDayView = { date, working, calendarTitle, canEdit, needsReason, sets: [{ id, name, deadline, overdue, questions: [{ id, text, type, required, options, min, max, unit }] }], children: [{ child: { id, firstName, lastName, middleName }, absent, expected, complete, answers: [{ questionId, questionText, questionType, unit, value: string | number | boolean, answeredBy: { id, firstName, lastName }, createdAt }] }] }`. `sets` = active sets assigned to the group with active questions; `answers` = active answers of that day (also for inactive questions, with snapshot). `absent` = register state `absent` (mark or approved notice). `expected = working && !absent`. `canEdit` = not future && (`register: edit` || teacher in window). Group lookup like the register (404 `Group not found`, 403 `Not your group`).
- `PUT /groups/:groupId/notes/:date` `{ reason?: string, answers: [{ childId: uuid, questionId: uuid, value: unknown (@Allow) }] }` (≤ 2000 items) → `NotesDayView`. Errors: future → 400 `Cannot fill future days`; outside window: teacher 403 `Edit window has passed`, manager without reason 400 `Reason is required`; duplicate child+question → 400 `Duplicate answer`; child not a current member → 400 `Child is not in this group`; question not active in a set assigned to the group → 400 `Question is not in this group`; value → 400 `Invalid answer`. Non-working days are allowed. Transaction: lock the children rows `ORDER BY id FOR UPDATE`, read active answers, skip unchanged, void the old (`voidReason = reason ?? 'Corrected'`, or `reason ?? 'Cleared'` for clears) and create the new with snapshots.
- `GET /daily-notes/pending` → today's `[{ group: { id, name }, own: boolean, pending: number, overdue: boolean }]` for groups the user is teacher of plus (with `register: view`) groups in scope, only rows with `pending > 0`, overdue first then name; skipped on non-working days.
- Dashboard: `TodayDashboard.notes?: { groups: { id, name, pending, overdue }[] }` from the same computation, present for teachers and `register: view` users (same condition as `register`), omitted when empty.
- Parent: `GET /me/children/:id/notes?from&to` (default Kyiv today − 6 .. today, ≤ 62 days `Period too long`, from > to `Invalid period`) → `{ days: [{ date, sets: [{ name, answers: [{ question, type, value, unit }] }] }] }` newest day first, only days with answers, answers grouped by the question's set (current set name) in question order; no staff names, no voided rows.

- [ ] Step 1: Service tests: day view marks absent child not expected; save as teacher outside window → 403; manager outside window without reason → 400; duplicate answer; child of another group; inactive question; clear voids without new row; unchanged value creates nothing; pending excludes absent and non-working days; parent view hides other children (404 `Child not found`) and lists only days with answers.
- [ ] Step 2: Implement; dashboard section + spec; parent route.
- [ ] Step 3: Document the domain (`### Domain: daily notes`) and the API list (Frontend section) in backend `CLAUDE.md`.
- [ ] Step 4: Tests, eslint, build, full jest. Commit `feat: add daily notes api`.

### Task 5: Notes page and questions editor (frontend)

**Files:** create `src/shared/api/dailyNotes.ts` (mirrored types + `dailyNotesApi`), export from `src/shared/api/index.ts`; `src/shared/api/errorMessages.ts` (all new backend messages above, Ukrainian); create `src/pages/notes/` (`index.ts`, `ui/NotesPage.tsx`, `ui/FillTab.tsx`, `ui/QuestionsTab.tsx`, `ui/NoteSetDialog.tsx`, `model/notesStore.ts`); `src/shared/model/pendingNotesStore.ts` (like `pendingNoticesStore`: `count` = sum of `pending` where `own`, `refresh()`); route `/notes` in `src/app/router/index.tsx`; nav item «Нотатки» (`section` as «Журнал», `roles: ['teacher']`, `area: 'register'`, `badge: 'pendingNotes'`) in `src/widgets/sidebar/model/nav-items.ts` + badge handling in `Sidebar.tsx`; page title in `Header.tsx`.

- «Заповнення»: group select (`GET /daily-notes/groups`), date (default today, `localToday`), banner when `needsReason` (reason field) or `!canEdit`; one card per child (phone: full width) with the child name, «відсутній» chip, «заповнено» check; controls per question: choice = toggle buttons, yes/no = «Так»/«Ні» toggle, number = numeric input (comma converted to dot, sent as number), text = multiline input; overdue sets show «прострочено» next to the set name. One sticky «Зберегти» button sends only changed answers (cleared fields send `null`); after save refresh `pendingNotesStore`.
- «Питання» (`register: edit` only): list of sets (name, institution, groups, deadline, active switch); `NoteSetDialog` (fullScreen on phone) with name, institution (locked on edit), deadline time, groups multi-select filtered by institution, question rows (text, type, required, options as chips input for choice, min/max/unit for number, move up/down, remove); delete via `ConfirmDialog`.

- [ ] Step 1: Implement; build; lint at baseline. Commit `feat: add daily notes page`.

### Task 6: Dashboard row, parent cabinet, docs (frontend)

**Files:** `src/shared/api/dashboard.ts` (type `notes`), `src/pages/dashboard/**` (attention row «Нотатки не заповнено: {group}, {n} дітей» / «прострочено», link to `/notes?groupId=`; `NotesPage` reads `groupId` from the query), `src/shared/api/parentCabinet.ts` or the file holding parent child API (`notes` call), `src/pages/familyChild/**` («Нотатки» section: today first, then previous days, «Показати раніше» loads the previous 7 days; yes/no shown as «Так»/«Ні», numbers with unit), frontend `CLAUDE.md` (notes page, store, badge).

- [ ] Step 1: Implement; build; lint at baseline. Commit `feat: show daily notes on dashboard and to parents`.
