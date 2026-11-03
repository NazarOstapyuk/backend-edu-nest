# Staff tasks design

## Intent

The administration often needs a staff member to do something by a certain time: "take the notebooks to the 1st floor", "hand in the lesson plans", "sign the safety journal". Today this goes through chats and is easy to forget. The CRM should let root give such tasks to admins and teachers, and admins to teachers, with an exact deadline; every assignee marks the task done for themselves, the author sees who did it, and once the deadline passes both the assignee and the author see it on the Today page.

Success: a task given to five teachers in the morning shows up for each of them right away; by the deadline the author sees "3 of 5 done" and the names of the two who did not, and those two see it as overdue on their Today page.

## Goals

- **Who gives tasks to whom:** root gives tasks to admins and teachers; an admin gives tasks only to teachers. Teachers and parents never create tasks; nobody gives tasks to root or to parents.
- **A task** has a title, an optional description and a deadline with exact date and time (Europe/Kyiv). One task can go to several people at once.
- **Done per person:** each assignee marks "done" for themselves. The author sees every assignee with done/not done and when it was done.
- **Reminders inside the CRM only:** an assignee sees their open tasks in «Мої завдання» and a counter next to the menu item «Завдання». After the deadline: the assignee sees "Прострочено: <title>" on the Today page; the author sees "Не виконали: <title>, 2 з 5" with the names.
- Marking done after the deadline is allowed.
- The author can change the title, description, deadline and assignees, and can cancel the task.

## Non-goals

- No notifications outside the CRM (no e-mail, Telegram, push).
- No recurring tasks, no subtasks, no comments or chat, no files or photos.
- No tasks for parents, no tasks between teachers.
- No reports or exports of tasks.

## Anti-goals

- A teacher must never see tasks of other people or who else got the task beyond what the author shows (assignees see only their own status, not the others').
- An admin must not be able to give tasks to other admins or to teachers outside their institutions.
- The Today page must not fill up with old finished tasks: only open overdue items are shown there.
- Creating a task for "all teachers" must stay quick on a phone (pick several people at once, not one by one in separate dialogs).

## Decisions (from the conversation)

- Root → admins and teachers; admin → teachers only.
- One task, many assignees; each marks done separately; the author sees who did.
- Deadline has an exact time.
- After the deadline both the assignee and the author see a message on the Today page.
- Before the deadline the assignee sees the task in «Мої завдання» with a menu counter (like daily notes).
- Done can be marked after the deadline.
- The author can cancel the task or change its deadline.
- Admins give tasks only to teachers of their institutions.
- Reminders only in the CRM.

## Calls made by me (not discussed, may be changed)

- **Roles, not permissions:** "admin" means a user with role `admin` (any non-teaching position), "teacher" role `teacher`. No new permission area. Root can also give tasks to teachers. A teacher with extra permissions is still a teacher and cannot create tasks.
- **Institutions for admins:** an admin with access scope `all` can pick any active teacher; an admin with scope `institutions` can pick active teachers who have at least one of the admin's granted institutions (teachers with scope `all` are not pickable by such an admin). The check happens when assignees are added; a later change of grants does not remove anyone from existing tasks.
- **Only active users** can be assigned. A deactivated assignee stays on the task but is not counted in "N of M" and never appears in reminders.
- **Editing:** only the author edits or cancels a task; root can additionally see and cancel any task (oversight of admins' tasks), but not edit it. Changing the assignees: added people get the task, removed people lose it (their done mark goes with them). A cancelled task cannot be edited or reopened and is shown to assignees as "Скасовано" in the history; it is never counted in reminders.
- **Deadline:** must be in the future when a task is created or when the deadline is changed (400). Moving the deadline later makes the task not overdue again for those who have not done it.
- **Done mark:** an assignee can undo their own done mark (mistaken click) while the task is not cancelled. The author cannot mark done for someone else.
- **Lengths:** title 1–200 characters (trimmed), description up to 2000, 1–200 assignees per task.
- **Overdue** = now (server time) is past the deadline, the task is not cancelled and the assignee (active) has not marked done.
- **Today page:** a new section `tasks` in `GET /dashboard/today` for staff who have any: `mine` — the user's open tasks that are overdue or due today (Kyiv day), overdue first, then by deadline; `given` — tasks the user authored whose deadline passed and that still have not-done active assignees, with the count and names of those not done. Omitted when both lists are empty.
- **Menu counter:** number of the user's open (not done, not cancelled) assigned tasks; overdue ones make the badge use the warning color.
- **History:** «Мої завдання» shows open tasks first by deadline, then done and cancelled ones from the last 30 days; «Поставлені» shows the author's tasks with progress "3 з 5", open first, finished (all done or cancelled) from the last 30 days; older ones via a "Показати раніше" control (paging by deadline).
- **Audit:** the global audit middleware is enough; no field-level `recordChange` for tasks.
- **Institution match uses grants:** "teachers of the admin's institutions" means the teacher's granted institutions (`UserInstitution`), not the groups they teach. The admin's side is the granted scope (`baseScope`); the `X-Institution-Id` header is ignored for picking and for the check, so the picker and the validation always agree.
- **Editing after the deadline or when everyone is done** is allowed (only cancelled tasks are frozen). If the author is deactivated or loses the admin role, the task stays as it is; root can still cancel it.
- **Removed assignees keep history:** removing an assignee marks their row removed (`removedAt`) instead of deleting it; removed rows are not counted, not reminded and not shown to that person anymore. Adding the same person back reactivates the row without the old done mark.
- **What an assignee sees:** title, description, deadline, the author's name and their own status. Never the other assignees or the "N of M" count.
- **Dashboard:** the `tasks` section is decided in the service: parents get nothing; any teacher or admin gets `mine`; `given` only for users who authored tasks.
- **User deletion:** a user who authored a task or has an assignment row cannot be deleted (400 `User has tasks`); deactivate instead.
- **Paging and the counter** (cursor or page, a separate count endpoint or part of a list) are the builder's call; the API section of the backend `CLAUDE.md` documents what was chosen.

## What the builder decides

- Table, DTO and route names following the module conventions (`src/<module>/`, reference `src/children/`, pure rules like overdue and counting in a `*-calc.ts` tested without mocks).
- How the role rules are expressed on routes, respecting "never put `Role.admin` or `Role.root` in `@Roles`" (for example a service-decided route like the dashboard).
- Locking/transaction details for concurrent edits and done marks.
- Exact UI layout of the «Завдання» page (tabs «Мої» and «Поставлені», a create/edit dialog with multi-select of people, full-screen on phones) within the design tokens of the frontend `CLAUDE.md`.
- Error message strings (English, stable, translated on the frontend).

## Constraints

- Backend: NestJS 11 + Prisma 7, a new migration, global `ValidationPipe`, English error messages, no new dependencies. Users who authored or are assigned tasks cannot be deleted while those rows exist, or the rows are handled explicitly (builder decides, must not lose history silently).
- Frontend: FSD layering, no new dependencies, mobile rules (phone cards, full-screen dialogs), Ukrainian error translations.
- Backend and frontend deploy together.
