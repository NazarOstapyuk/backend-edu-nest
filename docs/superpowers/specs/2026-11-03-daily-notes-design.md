# Daily notes design

## Intent

Parents want to know how their child's day went: how much the child ate at lunch, whether they slept, what mood they were in. Teachers already see the children every day; the CRM should give them a short, fixed list of questions per child per day and show the answers to parents right away. The administration decides which questions are asked, for which groups, and by what time they must be answered, and teachers get reminded inside the CRM when they are late.

Success: every working day each teacher fills the notes for the children of their groups before the deadline, without thinking about what to write, and parents open the cabinet and see the answers for today and previous days.

## Goals

- Admins (root or staff with the right permission, see Access) create **question sets** ("Щоденні нотатки"). A set has a name, a deadline time and an ordered list of questions, and is assigned to groups (kindergarten groups and school classes alike).
- Question types: **choice** (one of the options the admin defines, e.g. "0%", "15%", "50%", "100%"), **text** (free text), **yes/no**, **number**. A question can be marked **required**.
- Each working day, the teacher of a group answers the questions of every set assigned to the group, for each child.
- Parents see the answers in the cabinet **immediately after saving**, for today and previous days.
- Teachers are reminded **inside the CRM only**: an item on the Today page and a counter next to the menu item, before the deadline ("not filled yet") and as overdue after it. Late filling is always allowed.
- Corrections work like the attendance register: teachers can edit answers for the last `attendanceEditDays` days (existing setting, default 3); admins can edit any past day. Parents see the corrected answer.

## Non-goals

- No notifications outside the CRM (no Telegram, e-mail or push) for now.
- No answers from parents, no comments or chat on notes.
- No photos or files in answers.
- No reports or exports of notes (can come later on top of the stored data).
- No per-child question sets; sets go to groups only.

## Anti-goals

- Parents must never see staff-only data (staff names, voided answers, internal fields), and never another family's child.
- Changing or switching off a question must never rewrite what parents already saw for past days.
- The reminder must not nag about children who were absent that day.
- Filling must stay fast on a phone: one screen per group and day, not one page per child.

## Decisions (from the conversation)

- The administration defines the questions and how many there are; the deadline time is configured by root/admin. Overdue → the teacher is reminded, but can still fill.
- Answer types: choice, text, yes/no, number.
- Both kindergarten groups and school classes can get sets.
- Parents see answers right after the teacher saves.
- Reminders only in the CRM.
- Editing like the register: teachers for the last few days (`attendanceEditDays`), admins any past day.

## Calls made by me (not discussed, may be changed)

- **Deadline per set:** a time of day (`HH:MM`, Europe/Kyiv) on the note's own day, default `17:00`.
- **Several sets per group** are allowed; a group's daily notes are all questions of all active sets assigned to it, set by set in set order (name), questions in their order.
- **Required questions:** a child's note for a day is *complete* when every required question of every assigned active set has an answer. Optional questions never block completeness. A set with no required questions counts as complete once any answer for that set is saved for the child.
- **Working days only:** notes are expected on working days of the group per the attendance calendar (`dayInfo`). Teachers may still fill a non-working day; it is never expected or reminded. Future days cannot be filled.
- **Absent children:** a child whose register mark that day is `absent`, or who has an approved absence notice covering the day, is shown but not expected; they do not count in reminders. Filling them is optional.
- **Children in scope of a day:** the children whose group is the group on that day (current membership, as the register uses).
- **Question changes:** answers store a snapshot of the question text, type and the chosen option label. Editing a question's text or options affects only future answers. A question or set that has answers cannot be deleted, only deactivated; inactive questions/sets are not asked anymore, old answers stay visible to parents with their snapshot.
- **Corrections:** saving overwrites the current answer of that child, day and question; the previous value is kept as a voided row (like register marks), so the audit trail exists. Parents only ever see the active answer.
- **Number answers:** decimal, up to 2 decimals, admin may set optional min/max and a unit label (e.g. "год"). **Text answers:** up to 1000 characters. **Choice:** 2–10 options, each label 1–50 characters.
- **Sets belong to one institution:** a set has a required `institutionId`; only groups of that institution can be assigned to it (400 when another institution's group is sent). Set lists are filtered by the effective scope; creating, editing, assigning and deactivating need the set's institution in the user's granted scope (403 `Outside access scope`), a set outside the scope answers 404. Writes into an inactive institution are refused like elsewhere. To ask the same questions in two institutions, the admin creates a set per institution (a copy action is a nice-to-have, not required).
- **Reason for late corrections:** like the register, an admin editing (or clearing) answers of a day outside the `attendanceEditDays` window must give a reason (400 `Reason is required` style); the day view tells the client whether a reason is needed. The reason is stored on the voided rows.
- **Clearing an answer:** allowed. Sending an empty value for a question voids its current answer without a replacement (same edit-window and reason rules as a change). A cleared required answer makes the note incomplete again, and parents no longer see that answer.
- **Overdue with several sets:** counted per set. A child is overdue in a group when some assigned active set is past its deadline and that child's note for the set is incomplete. The dashboard row per group carries the number of expected children without a complete note and `overdue: true` if any of them is overdue; the counter counts children, not sets.
- **Access:** reuse the existing permission area `register` (no new area). `register: edit` manages question sets and fills/edits notes for any group in scope (any past day). `register: view` reads notes of groups in scope. A teacher (role `teacher`) fills and reads notes of their own groups (the group's `teachers`, like the register), within `attendanceEditDays`. Parents read only their own children.
- **Menu:** staff get a new item «Нотатки» next to «Журнал» (visible to teachers and to `register: view`), with the counter of today's not-filled children of the user's own groups (teachers) or groups in scope (managers only if they are also teachers of the group: managers get the Today item but no counter). The set management lives under the same page as a tab «Питання» for `register: edit`.
- **Today page:** a new section `notes` in `GET /dashboard/today`: for each relevant group, the number of expected children without a complete note today and whether the deadline has passed. Shown to teachers for their own groups and to `register: view` users for groups in scope (same rules as the `register` section). Overdue groups come first; the row text uses "прострочено" after the deadline.
- **Parent cabinet:** the child page gets a «Нотатки» section: today's answers on top, then previous days (newest first, paged by date range like the register, ≤ 62 days per request). Only answered questions are shown; days without any answer are not listed.

## What the builder decides

- Table, DTO and route names, following the existing module conventions (`src/<module>/`, reference `src/children/`, pure rules in a `*-calc.ts` file tested without mocks, `$transaction` with row locks in child-id order as in the register).
- Exact UI layout of the teacher filling screen (one group and day, children as rows or cards with compact controls; choice as segmented buttons, yes/no as a two-way toggle, number and text as inputs) within the calm design tokens in the frontend `CLAUDE.md`.
- Error message strings (English, stable, translated on the frontend).
- Whether the dashboard reuses register helpers or gets its own counting function in `dashboard-calc.ts`.

## Constraints

- Backend: NestJS 11 + Prisma 7, a new migration, global `ValidationPipe`, error messages in English, audit middleware covers writes; record field-level changes for question sets via `AuditService.recordChange`. No new dependencies.
- Frontend: FSD layering, no new dependencies, mobile rules (phone cards, full-screen dialogs), new Ukrainian error translations.
- Scope rules: lists and records are filtered by the effective institution scope; groups outside → 404 `Group not found`; teachers only own groups.
- Backend and frontend deploy together.
