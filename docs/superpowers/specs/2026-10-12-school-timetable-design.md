# School Timetable and Lesson Attendance Design

Date: 2026-10-12. Repos: backend `backend-edu-nest`, frontend `frontend-edu-nest` (`D:\IT\EduNest`). Builds on the attendance register (`docs/superpowers/specs/2026-10-12-attendance-register-design.md`).

## Goal

School classes (`Group.kind = school_class`) get a weekly timetable with bell schedules, subgroups and odd/even weeks; admins record per-date changes (cancel, replace, extra lesson). Teachers see their lessons for a day and record attendance, topic, homework and optional НУШ levels. Absences from the daily register show up on lessons automatically. Parents see the child's schedule, lesson topics, homework, lesson attendance and levels.

## Decisions

| Topic | Decision |
|---|---|
| Lesson times | Several bell schedules (`BellSchedule` with numbered periods and times); each school class is linked to one. Conflicts compare real times. |
| Timetable shape | Weekly entries per class with optional subgroup and week parity (`every`, `odd`, `even`, ISO week number). |
| Versions | A class has timetable versions with non-overlapping `validFrom`/`validTo`; a started version is never edited, a new version is created from a date. |
| Per-date changes | `LessonChange`: `cancel`, `replace` (teacher/subject/room), `extra`. Move = cancel + extra. Voided, never edited. |
| Lessons on a date | Computed from version + calendar + changes; a `SchoolLesson` row exists only once the lesson is recorded. |
| Register link | Daily register is primary: a child absent or expected absent for the day is shown absent on lessons with the day's reason; the teacher's lesson mark always wins; lessons never change the daily register. |
| Lesson content | Optional topic, homework and per-child НУШ level + comment. |
| Grading | Only НУШ levels for now (school has grades 1–4): `needs_support`, `progressing`, `with_help`, `independent`. Points scale later. |
| Conflicts | Blocking: 409 `Schedule conflict` with a list. |

## Data Model

Migration `add_school_timetable`:

```prisma
model Subject {
  id     String  @id @default(uuid())
  name   String  @unique
  active Boolean @default(true)
}

model Room {
  id     String  @id @default(uuid())
  name   String  @unique
  active Boolean @default(true)
}

model BellSchedule {
  id      String        @id @default(uuid())
  name    String        @unique
  active  Boolean       @default(true)
  periods BellPeriod[]
}

model BellPeriod {
  id         String       @id @default(uuid())
  scheduleId String
  number     Int
  startTime  String
  endTime    String
  @@unique([scheduleId, number])
}

model Group {
  bellScheduleId String?
}

model Subgroup {
  id      String           @id @default(uuid())
  groupId String
  name    String
  active  Boolean          @default(true)
  members SubgroupMember[]
  @@unique([groupId, name])
}

model SubgroupMember {
  subgroupId String
  childId    String
  @@id([subgroupId, childId])
}

enum WeekParity {
  every
  odd
  even
}

model Timetable {
  id          String           @id @default(uuid())
  groupId     String
  validFrom   DateTime         @db.Date
  validTo     DateTime?        @db.Date
  createdById String
  createdAt   DateTime         @default(now())
  entries     TimetableEntry[]
}

model TimetableEntry {
  id          String     @id @default(uuid())
  timetableId String
  weekday     Int
  period      Int
  parity      WeekParity @default(every)
  subjectId   String
  teacherId   String
  roomId      String?
  subgroupId  String?
}

enum LessonChangeType {
  cancel
  replace
  extra
}

model LessonChange {
  id          String           @id @default(uuid())
  groupId     String
  date        DateTime         @db.Date
  period      Int
  subgroupId  String?
  type        LessonChangeType
  subjectId   String?
  teacherId   String?
  roomId      String?
  reason      String
  createdById String
  createdAt   DateTime         @default(now())
  voidedAt    DateTime?
  voidedById  String?
  voidReason  String?
}

model SchoolLesson {
  id            String   @id @default(uuid())
  groupId       String
  date          DateTime @db.Date
  period        Int
  subgroupKey   String
  subgroupId    String?
  subjectId     String
  teacherId     String
  roomId        String?
  topic         String?
  homework      String?
  conductedById String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  marks         LessonMark[]
  @@unique([groupId, date, period, subgroupKey])
}

enum LessonStatus {
  present
  late
  absent
}

enum NushLevel {
  needs_support
  progressing
  with_help
  independent
}

model LessonMark {
  id         String        @id @default(uuid())
  lessonId   String
  childId    String
  status     LessonStatus
  reasonId   String?
  level      NushLevel?
  comment    String?
  markedById String
  createdAt  DateTime      @default(now())
  voidedAt   DateTime?
  voidedById String?
  voidReason String?
}
```

- Relations to `Group`, `Child`, `User`, `Subject`, `Room`, `AbsenceReason`, `BellSchedule` with `RESTRICT` FKs; `TimetableEntry` cascades with its `Timetable` (entries are replaced as a unit while the version has not started); `SubgroupMember` cascades with its `Subgroup`.
- `weekday` 1 (Mon) – 6 (Sat). `startTime`/`endTime` are `HH:MM` strings, `startTime < endTime`, periods of one schedule do not overlap.
- `subgroupKey` = `subgroupId` or `"class"`.
- One active `LessonMark` per lesson and child, enforced by locking the children rows (`SELECT id FROM "Child" WHERE id IN (...) ORDER BY id FOR UPDATE`) inside the save transaction, like the daily register.

## Backend

Module `src/timetable/`. Dates are UTC-midnight days, "today" = `kyivToday()`, date params parsed by `parseDay`. The calendar and day states come from `src/attendance/` (`CalendarService.entriesBetween`, `dayInfo`, `RegisterService.childDays`).

### Pure logic `schedule-calc.ts`

- `isoWeekParity(day): 'odd' | 'even'`.
- `versionOn(timetables, day)`: the version with `validFrom ≤ day ≤ (validTo ?? ∞)`.
- `slotsForDay(day, { working, entries, changes, periods })` → slots `{ period, startTime, endTime, subgroupId, subjectId, teacherId, roomId, source: 'timetable' | 'replace' | 'extra', cancelled, changeId }`. Non-working day → `[]`. Entries with matching weekday and parity; non-voided changes for the date applied: `cancel` marks the slot (same period + subgroup) cancelled, `replace` overrides the given fields, `extra` adds a slot. Sorted by period, then whole class before subgroups.
- `findConflicts(slots)` over concrete time intervals (from each class's bell schedule): same teacher in overlapping intervals, same room in overlapping intervals, a whole-class slot and a subgroup slot of the same class overlapping, two subgroup slots of one class overlapping whose member sets intersect. Cancelled slots ignored. Returns `{ kind: 'teacher' | 'room' | 'class' | 'subgroup', a, b }[]`.
- `pupilState({ dayState, dayReasonId, mark })` → `{ status: present | late | absent | null, reasonId, source: 'mark' | 'register' | 'none' }`: the active mark wins; otherwise day state `absent`/`expected_absent` → `absent` with the day reason (`source: 'register'`); otherwise unmarked.

### Endpoints

Directories (root/admin; GET also teacher): `GET/POST /subjects`, `PATCH /subjects/:id`; same for `/rooms`; `GET/POST /bell-schedules`, `PATCH /bell-schedules/:id` (body includes `periods: [{ number, startTime, endTime }]`, replaced as a unit); `GET/POST /groups/:id/subgroups`, `PATCH /subgroups/:id` (`name`, `active`, `childIds` — each child must belong to the class: 400 `Child is not in this class`). `PATCH /groups/:id` accepts `bellScheduleId` (school classes only, else 400 `Not a school class`).

Timetable (root/admin):
- `GET /groups/:id/timetables` → versions with entries.
- `POST /groups/:id/timetables` `{ validFrom, entries: [{ weekday, period, parity, subjectId, teacherId, roomId?, subgroupId? }] }`: class must be `school_class` with a bell schedule (400 `Not a school class` / `Class has no bell schedule`); every `period` exists in the bell schedule (400 `Bell period not found`); `validFrom` after the start of the current version (else 400 `Timetable periods overlap`); the current version gets `validTo = validFrom − 1`; a later not-yet-started version → 400 `Timetable periods overlap`. Conflict check (see below). Teachers must have role `teacher` (400 `User is not a teacher`).
- `PUT /timetables/:id/entries` `{ entries }`: only if `validFrom > today` (else 400 `Timetable already started`); same validation.
- `GET /groups/:id/schedule?from&to` (root/admin, teacher of the class or teaching in it) → `{ days: [{ date, working, title, slots: [...slot, subjectName, teacherName, roomName, subgroupName, lessonId|null] }] }`; range ≤ 31 days (400 `Invalid period`).

Changes (root/admin): `POST /groups/:id/lesson-changes` `{ date, period, subgroupId?, type, subjectId?, teacherId?, roomId?, reason }` (`cancel`/`replace` need an existing non-cancelled slot → 404 `Lesson not found`; `replace` needs at least one field; `extra` needs subject + teacher and a free class slot); `POST /lesson-changes/:id/void` `{ reason }`. A cancel on a recorded lesson (with marks) → 400 `Lesson already recorded`.

Conflict check: for a timetable version, all dates are abstract — compare each new entry against entries of all other classes' versions whose validity overlaps, per weekday, with parity overlap (`every` overlaps both) and real-time overlap. For changes, compare the resulting slots of that date across all classes. Any conflict → 409 `{ statusCode: 409, message: 'Schedule conflict', conflicts: [{ kind, weekday|date, period, groupName, other: { groupName, period, subjectName } }] }`.

Lessons:
- `GET /me/lessons?date=` (teacher; admins may pass `teacherId`) → slots across classes where the effective teacher is the user, with class names and `lessonId`.
- `GET /groups/:id/lessons/:date/:period?subgroupId=` (root/admin, effective teacher of that slot) → `{ slot, lesson: { id, topic, homework } | null, canEdit, needsReason, pupils: [{ child, state, mark, dayState, dayReasonId }] }`. Pupils = current class members (or subgroup members still in the class) plus children with an active mark on this lesson. Missing slot → 404 `Lesson not found`; other teacher → 403 `Not your lesson`.
- `PUT` same path `{ topic?, homework?, reason?, marks: [{ childId, status, reasonId?, level?, comment? }] }`: future date → 400 `Cannot mark future days`; teacher outside `attendanceEditDays` → 403 `Edit window has passed`; admin outside without reason → 400 `Reason is required`; `reasonId` only for `absent` (400 `Reason is only allowed for absences`); `level` only for `present`/`late` (400 `Level is only allowed for present students`); pupil not in the lesson → 400 `Child is not in this subgroup`. Creates the `SchoolLesson` (snapshot of subject/teacher/room) on first save; locks children; unchanged marks skipped, changed ones voided and recreated; only changed rows are sent by the frontend.

Parent cabinet (role parent, `assertOwnChild`, foreign → 404 `Child not found`):
- `GET /me/children/:id/schedule?from&to` (≤ 31 days) → days with the child's slots (whole class + the child's subgroups), cancelled/replaced flags, and for recorded lessons `topic`, `homework`.
- `GET /me/children/:id/lessons?month=` → `{ month, lessons: [{ date, period, subjectName, status, reasonName, level, comment, source }], summary: { missed, missedExcused, bySubject: [{ subjectName, levels: { needs_support, progressing, with_help, independent } }] } }`. No `markedBy`, no void data, no teacher notes beyond the level comment.

### Errors (new, English)

`Schedule conflict`, `Timetable periods overlap`, `Timetable already started`, `Bell period not found`, `Bell periods overlap`, `Invalid bell time`, `Not a school class`, `Class has no bell schedule`, `User is not a teacher`, `Lesson not found`, `Not your lesson`, `Lesson already recorded`, `Subgroup does not belong to this class`, `Child is not in this class`, `Child is not in this subgroup`, `Level is only allowed for present students`, `Subject not found`, `Room not found`, `Subject already exists`, `Room already exists`, `Bell schedule already exists`, `Subgroup already exists`. Reused: `Invalid period`, `Invalid date`, `Invalid month`, `Cannot mark future days`, `Edit window has passed`, `Reason is required`, `Reason is only allowed for absences`, `Absence reason not found`, `Group not found`, `Child not found`.

Delete guards: groups, children and users also count timetables, lessons, marks, changes and subgroup memberships they own/created.

## Frontend

- `/schedule-setup` «Довідники розкладу» (root/admin): tabs Предмети, Кабінети, Дзвінки (schedule + periods table), Підгрупи (class → subgroups → children of the class).
- Group modal: «Розклад дзвінків» select for `school_class`.
- `/schedule` «Розклад» (root/admin; replaces the stub): class + version selector («діє з … по …», «Нова версія з дати»); grid weekdays × periods with times; cell = subject, teacher, room, parity badge, subgroup; cell modal; «Зберегти»; conflicts listed above the grid with highlighted cells. Tab «Тиждень»: actual lessons of a week incl. holidays; per lesson «Скасувати», «Заміна», «Додатковий урок» with reason; cancelled struck through, replaced marked; click opens the lesson page.
- `/my-lessons` «Мої уроки» (teacher): date picker, list of the day's lessons (time, class, subgroup, room, «заміна»).
- `/lessons/:groupId/:date/:period` lesson page (teacher of the lesson, root/admin): topic, homework, pupil cards (absent by register greyed with reason, changeable), status toggle Присутній / Запізнився / Відсутній, reason, optional НУШ level (4 buttons) and comment, «Усі присутні», «Зберегти» (changed rows only), reason dialog for admins outside the window, load-error retry.
- Parent child page: new tab «Розклад» (week with arrows, lessons per day, topic and homework); «Відвідування» tab gets a «Уроки» block for the month (missed lessons with reasons, НУШ levels by subject with comments).
- Translations for all new errors; mobile-friendly teacher pages.

## Integrity Rules

1. Lessons on a date are never stored; they are computed from the version, the calendar and changes. Only facts are stored (recorded lessons, marks, changes).
2. Timetable versions of a class never overlap; a started version is never edited.
3. Saving a timetable or a change fails on any real-time conflict (teacher, room, class vs subgroup, intersecting subgroups).
4. At most one active mark per pupil and lesson; corrections void. Teachers mark only their (effective) lessons inside the edit window; nobody marks future lessons.
5. Daily-register absences show on lessons; a lesson mark wins; lessons never change the daily register.
6. Parents see only their child's schedule, topics, homework, attendance, levels and level comments; never who marked or correction reasons.
7. No money side effects.

## Testing

- Pure: parity at year boundaries; version on a date; changes (cancel, replace, extra, voided); non-working days; conflicts across different bell schedules, parity overlap, subgroup intersection; pupil state (register vs mark).
- Services: teacher access (foreign lesson, replacement teacher), edit window, future lesson, level only for present, pupil not in subgroup, version overlap, editing a started version, 409 conflict with payload, cancel of a recorded lesson, parent ownership and hidden fields.
- Live check on PORT=3100: bell schedules, subjects, a class with two subgroups, a timetable with odd/even entries, teacher conflict → 409, replacement on a date, teacher records a lesson, a pupil absent by register shows absent, parent views.
- Frontend: `tsc` adds no errors vs baseline; `eslint` clean on touched files.

## Out of Scope

Thematic/semester grades, report cards, the 12-point scale, teacher workload, automatic timetable generation, printing/export, notifications about changes.

## Commit Order

1. Schema + migration.
2. `schedule-calc.ts` + tests.
3. Directories: subjects, rooms, bell schedules, subgroups, class bell schedule.
4. Timetable versions, changes, conflicts, schedule view.
5. Lessons: my lessons, lesson view and save.
6. Parent endpoints, delete guards, CLAUDE.md, live check.
7. Frontend: directories page, group bell schedule.
8. Frontend: timetable grid and week tab.
9. Frontend: my lessons, lesson page, parent tabs.
