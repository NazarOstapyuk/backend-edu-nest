# Kindergarten daily routine design

Date: 2026-10-23. Status: approved.

Covers the backend (`backend-edu-nest`) and the frontend (`frontend-edu-nest`, local `D:\IT\EduNest`).

## Goal

Each kindergarten group has its own daily routine («Розпорядок дня»): a list of time slots with what the group does (Зустріч дітей, Сніданок, Тематичне коло, Сон, Прогулянка…). Today it lives in PDF files sent to parents (example: `TODDLER_1-3_розклад_для_телефону.pdf` in the backend repo root, group 1–3 years). The school «Розклад» (lessons, bells, subjects) does not fit kindergartens and stays as it is.

Everyone uses the routine: parents in the cabinet on a phone, teachers for their groups, administration for all groups in their scope.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Owner | Every group has its own routine; it may match another group's or not |
| Reuse | Copy a routine from another group |
| Shape | A week template Mon–Fri; each item = time from–to + free text; items may overlap in time (as in the PDF: «Сніданок 09:10–09:30» inside «Зустріч дітей 08:00–09:15») |
| Extra text | A note under the routine («* Час перекусу та прогулянки може коригуватися…») and the group's working hours («08:00–18:00/18:30») |
| Planning ahead | Like meals, plan as far ahead as needed, but simpler: a template version applies automatically from its start date; no «apply» or «publish» step |
| Single day | A specific date can be changed (e.g. 15.11 holiday instead of music); only that date changes |
| New version | A new template «з 01.06» (summer) applies from its date; the previous version stays for earlier dates |
| Who edits | Holders of the `timetable` permission (`edit`); usually the administrator, a teacher only if granted |
| Display | Option A from the mockups: day tabs (Пн–Пт with dates), under them a list «час — що робимо», the current item highlighted; same on a phone |
| Editing | Rows: «з», «до», «що робимо», «+ Пункт», remove; «Скопіювати день у…» other weekdays. No text paste import |

## Data model (backend)

- `RoutineTemplate`: `id`, `groupId`, `validFrom Date`, `validTo Date?` (set when a later version starts; versions of one group never overlap), `workingHours String?` (≤ 100), `note String?` (≤ 1000), `createdById`, `createdAt`, `updatedAt`.
- `RoutineTemplateItem`: `id`, `templateId` (cascade), `weekday Int` (1–7, ISO), `startTime String` `HH:MM`, `endTime String` `HH:MM` (> start), `title String` (1–300), `sortOrder Int`.
- `RoutineDay`: one override per group and date (unique `(groupId, date)`): `id`, `groupId`, `date Date`, `note String?` (≤ 1000), `createdById`, `updatedAt`; items in `RoutineDayItem` (same fields as template items minus `weekday`). A day override with no items means «no routine that day» (e.g. a trip).

Overlapping items are allowed. Items are ordered by `startTime`, then `endTime`, then `sortOrder`.

## Rules

- Only groups with `kind = kindergarten` (400 `Routine is for kindergarten groups`). Scope: the group's institution must be in the user's scope (404 `Group not found` outside, like other group records).
- Routine of a date = the day override if it exists, else the template version valid on that date (items of that weekday), else nothing. Non-working days from the attendance calendar (`dayInfo` with the group's level) show «Вихідний» and no items, even with a template; a day override on a non-working day is still shown (e.g. a Saturday event, see «Settled after the builder check»).
- Template versions: creating a version with `validFrom` closes the version open on that date (`validTo = validFrom − 1`); a version starting on the same date as an existing one → 409 `Routine version already starts on this date`. Versions may be edited at any time (no money involved; past days just show the edited text). Deleting a version reopens the previous one (like salary terms).
- Day overrides: create/replace/delete for any date; «Скинути до шаблону» deletes the override.
- Copy: `POST /groups/:id/routine/copy { sourceGroupId, validFrom }` creates a new version for the target from the source's version valid on `validFrom` (both groups in scope, both kindergarten); day overrides are not copied.
- Times are `HH:MM` local (Kyiv) wall-clock strings; no time zones.
- Audit: the global middleware logs requests; no field-level `recordChange` (builder's call).

## API (backend)

Staff (permission `timetable`; reads `view`, writes `edit`) and teachers (role `teacher`, read only, own groups):

- `GET /groups/:id/routine?from&to` → `{ group {id, name}, days: [{ date, working: boolean, source: 'template'|'override'|'none', workingHours, note, items: [{ startTime, endTime, title }] }] }` (≤ 62 days).
- `GET /groups/:id/routine/templates` → versions with items.
- `POST /groups/:id/routine/templates` `{ validFrom, workingHours?, note?, items: [{ weekday, startTime, endTime, title }] }`; `PUT /routine-templates/:id` (same body without validFrom); `DELETE /routine-templates/:id`.
- `PUT /groups/:id/routine/days/:date` `{ note?, items: [...] }`; `DELETE /groups/:id/routine/days/:date`.
- `POST /groups/:id/routine/copy` `{ sourceGroupId, validFrom }`.

Parents: `GET /me/children/:id/routine?from&to` (`assertOwnChild`, the child's group; same day shape; no staff names).

Error messages (English, translated on the frontend): `Routine is for kindergarten groups`, `Routine version already starts on this date`, `Routine template not found`, `Invalid time range` (end ≤ start), `Period too long`, plus existing `Group not found`, `Child not found`.

## Frontend

- New page «Розпорядок дня» (menu item for `timetable` area and for teachers): group picker (kindergarten groups in scope; teachers: own groups), tabs «Розклад» (view A: week with day tabs Пн–Пт + dates, list «час — що робимо», current item highlighted on today, «Вихідний» for non-working days, working hours and note shown; week navigation; «Змінити цей день» / «Скинути до шаблону» for editors) and «Шаблон тижня» (versions «з дати», row editor per weekday, «Скопіювати день у…», «Скопіювати з іншої групи», working hours, note).
- Parent cabinet: a «Розпорядок» tab in the child card with the same view A, read only.
- Teachers without the permission see the view only.
- Mockups: `D:\IT\EduNest\.superpowers\brainstorm\134-1792780065\content\routine-view.html` (A chosen) and `routine-editor.html` (rows chosen).

## Settled after the builder check (my calls)

- **Teachers.** A teacher without the permission reads only own groups (`Group.teachers`), only `GET /groups/:id/routine` and `GET .../templates` (read). A teacher with `timetable` view/edit acts as a manager (all kindergarten groups in scope), like elsewhere in the project. Routes use `@Roles(Role.teacher)` + `@Permission('timetable', …)`, own-group check in the service.
- **Non-working days.** `working` always comes from the calendar. Without an override a non-working day has no items («Вихідний»); an override on a non-working day is shown with its items and `working: false` (the UI shows «Вихідний» plus the items).
- **Weekdays.** The API accepts weekday 1–7; the template editor shows Пн–Пт only (Сб/Нд hidden unless they already have items). `GET /routine` returns every date in the range.
- **Copy.** No source version on `validFrom` → 404 `Routine template not found`; target already has a version starting on that date → 409 `Routine version already starts on this date`; `workingHours` and `note` are copied; source = target → 400 `Cannot copy to the same group`.
- **Version dates.** `validFrom` cannot be edited (delete and recreate). A version created earlier than an existing later one gets `validTo` = next start − 1. Group row locked `FOR UPDATE` for template create/delete/copy.
- **Scope.** `X-Institution-Id` narrows the picker and routes via the existing group scope helpers; writes into an inactive institution → 400 `Institution is inactive`.
- **Validation.** `HH:MM` 00:00–23:59, end > start (`Invalid time range`, also for day overrides), title trimmed and non-empty, ≤ 60 items per weekday or day.

## Non-goals

- Linking routine items to meals, lessons, attendance or payroll (meal icons are decoration at most).
- School classes (they use the timetable).
- Notifications to parents about changes.
- Text paste import, PDF export (possible later).

## Left to the builder

- Exact response shapes inside the rules above, migration, DTO validation limits not listed.
- Whether teachers' read route is the same as staff's (with a role check in the service) or separate.
- Task split: schema, pure rules (date resolution) + tests, services/controllers, frontend API, page, cabinet tab, docs.
