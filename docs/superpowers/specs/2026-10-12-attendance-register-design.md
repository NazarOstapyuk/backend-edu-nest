# Daily Attendance Register Design

Date: 2026-10-12. Repos: backend `backend-edu-nest`, frontend `frontend-edu-nest` (`D:\IT\EduNest`).

## Goal

Staff keep a daily attendance register for kindergarten groups and school classes; parents see their child's days and can notify about an upcoming absence, which an admin approves. The register does not change money; it prepares the data the meals part (Part 5) will charge from. School timetable and lesson attendance are a separate later part.

## Decisions

| Topic | Decision |
|---|---|
| Scope | Daily register only (kindergarten and school). Timetable + lesson attendance = next part. |
| Money | No effect on tuition. Register exposes expected presence for meals (Part 5). Absence-based tuition recalculation is a later tariff option. |
| Statuses | `present`, `late`, `left_early`, `absent`; `late`/`left_early` count as present. |
| Absence reasons | Admin-managed directory: name, `excused`, `requiresDocument`, `active`, `sortOrder`. Deactivated, never deleted. |
| Who marks | Teachers of the group and admins. Parents submit absence notices; an admin approves or rejects them. |
| Calendar | Mon–Fri working by default; `CalendarDay` entries make periods non-working or a weekend day working; scope all / kindergarten / school_class / one group. |
| Corrections | Teacher: own groups, from today back `attendanceEditDays` days (AppSetting, default 3). Admin: any past day; outside the window a reason is required. Corrections void the old mark. |
| Notices in the register | Notices stay separate; the day state is resolved: mark → approved notice → unmarked. A mark always wins. |

## Data Model

Migration `add_attendance_register`:

```prisma
enum GroupKind {
  kindergarten
  school_class
}

model Group {
  kind GroupKind @default(kindergarten)
}

enum DailyStatus {
  present
  late
  left_early
  absent
}

model AbsenceReason {
  id               String  @id @default(uuid())
  name             String  @unique
  excused          Boolean
  requiresDocument Boolean @default(false)
  active           Boolean @default(true)
  sortOrder        Int     @default(0)
}

enum CalendarDayType {
  non_working
  working
}

enum CalendarScope {
  all
  kindergarten
  school_class
  group
}

model CalendarDay {
  id          String          @id @default(uuid())
  startDate   DateTime        @db.Date
  endDate     DateTime        @db.Date
  type        CalendarDayType
  scope       CalendarScope
  groupId     String?
  title       String
  createdById String
  createdAt   DateTime        @default(now())
  voidedAt    DateTime?
  voidedById  String?
  voidReason  String?
}

model DailyAttendance {
  id               String      @id @default(uuid())
  childId          String
  groupId          String
  date             DateTime    @db.Date
  status           DailyStatus
  reasonId         String?
  note             String?
  documentProvided Boolean     @default(false)
  markedById       String
  createdAt        DateTime    @default(now())
  voidedAt         DateTime?
  voidedById       String?
  voidReason       String?
}

enum NoticeStatus {
  pending
  approved
  rejected
  cancelled
}

model AbsenceNotice {
  id           String       @id @default(uuid())
  childId      String
  startDate    DateTime     @db.Date
  endDate      DateTime     @db.Date
  reasonId     String
  comment      String?
  status       NoticeStatus @default(pending)
  createdById  String
  decidedById  String?
  decidedAt    DateTime?
  rejectReason String?
  createdAt    DateTime     @default(now())
}
```

- Relations: `DailyAttendance` → `Child`, `Group`, `AbsenceReason`, `User` (markedBy, voidedBy); `CalendarDay` → `Group?`, `User`; `AbsenceNotice` → `Child`, `AbsenceReason`, `User` (createdBy, decidedBy). FKs `RESTRICT`.
- Partial unique index (raw SQL in the migration): one active mark per child and day — `CREATE UNIQUE INDEX "DailyAttendance_child_date_active" ON "DailyAttendance"("childId", "date") WHERE "voidedAt" IS NULL;`. Indexes on `(groupId, date)` and `AbsenceNotice(childId, startDate)`.
- `CalendarDay`: single day = `startDate = endDate`; `groupId` required iff `scope = group`.
- Seed (migration SQL): reasons Хвороба (excused, requires document), Сімейні обставини (excused), Відпустка (excused), Без причини (not excused).
- `AppSetting` key `attendanceEditDays`, default 3 when missing.
- Existing groups become `kindergarten`.

## Backend

Module `src/attendance/`. Dates are UTC-midnight days; "today" = `kyivToday()`.

### Pure logic `register-calc.ts`

- `isWorkingDay(day, group: { id, kind }, entries: CalendarDay[])`: default Mon–Fri working, Sat/Sun not. Non-voided entries covering the day apply by precedence group > group kind > all; within the same level `non_working` wins over `working`.
- `resolveDay({ working, mark, notice })` → `{ state, status?, reasonId?, source }`, `state` ∈ `present | absent | expected_absent | unmarked | non_working`, `source` ∈ `mark | notice | none`. An active mark always decides the state, even if the day became non-working after marking. Otherwise a non-working day → `non_working`; else an approved notice covering the day → `expected_absent`; else `unmarked`. `late`/`left_early` → `present`.
- `summarizeDays(days, reasons)` → `{ workingDays, present, absentExcused, absentUnexcused, expectedAbsent, unmarked }`. An absence without a reason is unexcused; `expected_absent` uses the notice's reason only for display, it is counted separately.

### Endpoints

Reasons:
- `GET /absence-reasons` (all roles; non-admins get active only), `POST /absence-reasons`, `PATCH /absence-reasons/:id` (root/admin). Duplicate name → 409 `Absence reason already exists`.

Calendar:
- `GET /calendar?from&to&groupId?` (root/admin/teacher), `POST /calendar` (root/admin), `POST /calendar/:id/void` `{ reason }` (root/admin). `endDate < startDate` → 400 `Invalid period`; `scope = group` without `groupId` (or with groupId otherwise) → 400 `Group is required for group scope`.

Register:
- `GET /groups/:id/register?date=YYYY-MM-DD` (root/admin, teacher of the group): `{ date, working, calendarTitle, canEdit, needsReason, children: [{ child: { id, firstName, lastName, middleName }, state, mark: { id, status, reasonId, note, documentProvided, markedBy: { id, firstName, lastName }, createdAt } | null, notice: { id, startDate, endDate, reasonId, comment } | null, documentRequired }] }`. Children = current members of the group plus children with an active mark for that group on that date.
- `PUT /groups/:id/register` `{ date, reason?, marks: [{ childId, status, reasonId?, note?, documentProvided? }] }` → the day view. One transaction: lock active marks of the group's children for the date (`SELECT ... FOR UPDATE`), skip unchanged rows, void changed ones (`voidReason` = reason or `Corrected`), create new. A unique violation → 409 `Register changed, reload`.
- `GET /groups/:id/register/month?month=YYYY-MM` (same roles): `{ month, days: [{ date, working, title }], children: [{ child, days: [{ date, state, status, reasonId }], summary }] }`.

Rules (register):
- Teacher not teaching the group → 403 `Forbidden` (same pattern as classes `assertGroupAccess`).
- Date after Kyiv today → 400 `Cannot mark future days`.
- Non-working day → 400 `Not a working day`.
- Teacher outside the window (`today − attendanceEditDays`) → 403 `Edit window has passed`. Admin outside the window without `reason` → 400 `Reason is required`.
- `reasonId`/`documentProvided` only with `absent` → 400 `Reason is only allowed for absences`. Unknown or inactive reason → 400 `Absence reason not found`.
- Child not a current member and without a mark for this group/date → 400 `Child is not in this group`.

Notices (admin):
- `GET /absence-notices?status=&groupId=` (root/admin), `POST /absence-notices/:id/approve`, `POST /absence-notices/:id/reject` `{ reason }`, `POST /absence-notices/:id/cancel` `{ reason }` (approved only). Not pending (approve/reject) → 400 `Notice already decided`.

Parent cabinet (role parent, ownership as Part 6, foreign → 404 `Child not found`):
- `POST /me/children/:id/absence-notices` `{ startDate, endDate, reasonId, comment? }`: `startDate ≥ today`, `endDate ≥ startDate` (else 400 `Invalid period`), period ≤ 60 days (400 `Notice period is too long`), overlap with a pending/approved notice → 400 `Notice overlaps an existing notice`.
- `GET /me/children/:id/absence-notices` (newest first), `POST /me/children/:id/absence-notices/:noticeId/cancel` (pending only, else 400 `Notice already decided`).
- `GET /me/children/:id/register?month=YYYY-MM` → `{ month, days: [{ date, state, status, reasonName }], summary }`. No notes, no staff names.

Meals contract (no endpoint yet): `AttendanceService.expectedPresence(childIds: string[], from: Date, to: Date): Promise<{ childId, date }[]>` — working days where the resolved state is not `absent`/`expected_absent`, for the child's group on that day (mark's group, else current group).

### Errors (new, English)

`Not a working day`, `Cannot mark future days`, `Edit window has passed`, `Reason is required`, `Reason is only allowed for absences`, `Absence reason not found`, `Absence reason already exists`, `Child is not in this group`, `Invalid period`, `Group is required for group scope`, `Notice overlaps an existing notice`, `Notice period is too long`, `Notice already decided`, `Register changed, reload`.

## Frontend

- Groups: «Тип» (Садок / Клас) in create/edit modals, column in the table.
- `/register` «Журнал» (root/admin/teacher): group + date pickers (teacher sees own groups); child rows with status toggle (Присутній / Запізнився / Пішов раніше / Відсутній), reason, note, «Довідку надано» when required; approved notice preselects «Відсутній (повідомили батьки)»; «Усі присутні», «Зберегти» (bulk, unsaved highlight); non-working day banner; disabled fields outside the window for teachers, «Причина виправлення» for admins. Tab «Табель»: month grid with codes П/З/Р/В/В*/?/—, colors for excused/unexcused, per-child summary, click opens the day.
- `/absence-notices` (root/admin): tabs Очікують / Підтверджені / Відхилені; approve, reject with reason, cancel approved with reason; pending count badge in the menu.
- `/calendar` (root/admin): list for a year, add form (date or period, type, scope, group, title), void with reason.
- Absence reasons page (root/admin): name, «Поважна», «Потрібна довідка», «Активна», order.
- Parent child page, tab «Відвідування»: month picker, summary, month grid by state, list below (class lessons, adaptation, register days with reasons); «Повідомити про відсутність» form; notices list with status and «Скасувати» for pending.
- Translations for all new errors; mobile-friendly register.

## Integrity Rules

1. At most one active mark per child and day (DB-enforced); corrections void, never edit.
2. A mark always wins over a notice; day states and summaries are computed, never stored.
3. Teachers: own groups, inside the edit window; nobody marks future days.
4. Parents see and create notices only for their children; parent views have no staff notes or staff names.
5. Decided notices are not edited; an approved notice can only be cancelled by an admin.
6. The register never creates charges or changes money.

## Testing

- Pure: working day with all calendar levels and weekend transfers; resolveDay (mark vs notice, voided, non-working); month summary.
- Services: teacher access (foreign group, window edges), future day, non-working day, reason on present, correction voids old mark, unchanged rows untouched, notices (overlap, length, past start, decide twice), parent ownership and field exclusion, expectedPresence.
- Live check on PORT=3100: school class, holiday, parent notice → approve → register shows expected absence → teacher marks present → mark wins; month grid; parent view.
- Frontend: `tsc` adds no errors vs baseline; `eslint` clean on touched files.

## Out of Scope

School timetable and lesson attendance (next part), tuition recalculation for absences, meals charging (Part 5), messenger/email notifications, Excel export, uploading document files.

## Commit Order

1. Schema + migration (seed reasons, partial unique index).
2. `register-calc.ts` + tests.
3. Absence reasons + calendar.
4. Register (day, save, month).
5. Notices + parent cabinet endpoints + expectedPresence.
6. Backend CLAUDE.md + live check.
7. Frontend: group kind, reasons page, calendar page.
8. Frontend: register and month grid.
9. Frontend: notices admin, parent «Відвідування» tab, translations, CLAUDE.md.
