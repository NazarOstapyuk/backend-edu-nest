# School Timetable and Lesson Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** School classes get bell schedules, subjects, rooms, subgroups and versioned weekly timetables with per-date changes; teachers record lesson attendance, topic, homework and optional НУШ levels; parents see schedule, homework, lesson attendance and levels.

**Architecture:** New backend module `src/timetable/` with a pure `schedule-calc.ts` (ISO parity, version on date, slots of a day, conflicts, pupil state) and a `ScheduleService` that assembles the actual slots of any classes for a date range from versions, the attendance calendar and per-date changes. Only facts are stored (`SchoolLesson`, `LessonMark`, `LessonChange`). The frontend adds directory, timetable, teacher lesson pages and parent tabs.

**Tech Stack:** NestJS 11, Prisma 7, class-validator/class-transformer, Jest. Frontend: React 19, MUI 9, Zustand 5, react-hook-form 7 + yup, axios.

**Spec:** `docs/superpowers/specs/2026-10-12-school-timetable-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest` branch `feature/school-timetable` (checked out, spec committed), Tasks 1–6. Frontend `D:\IT\EduNest`: create branch `feature/school-timetable` from `main` at the start of Task 7, Tasks 7–9.

## Global Constraints

- Node 22 on PATH for Prisma/Jest: in Git Bash `export PATH="/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH"` (default node v20.18 is too old). Prisma 7: check generated types in `node_modules/.prisma/client/index.d.ts` instead of guessing.
- Business dates are UTC-midnight `Date`s (`@db.Date`); "today" = `kyivToday()` (`src/tariffs/dates.ts`); date params parsed with `parseDay` (`src/classes/access.ts`, 400 `Invalid date`); months with `parseMonth` (`src/attendance/register-calc.ts`).
- Calendar working days and day states come from `src/attendance/` (`CalendarService.entriesBetween`, `dayInfo`, `RegisterService.childDays`, `RegisterService.getEditDays`); do not duplicate that logic.
- New error messages exactly as in the spec "Errors" section plus `Bell period is in use`, `Bell schedule not found`, `Subject and teacher are required`, `Nothing to replace`, `Lesson change not found`, `Lesson change is voided` (see Task 3/4); every one gets a Ukrainian translation in the frontend.
- Parent views never contain `markedBy`, void data or correction reasons. Level comments are visible to parents.
- No money side effects. Don't change cookie options, JWT config, CORS or the global ValidationPipe. Don't edit applied migrations; never reset or drop data.
- No new dependencies. No code comments.
- Backend: `npx eslint --fix <touched files>` before each commit; no new lint errors. Jest `useValue` mocks without `as unknown as X` casts (eslint `no-unnecessary-type-assertion` flags them); never `as any`. `jest.spyOn` on namespace imports fails; spying on service instance methods is fine.
- Frontend: before Task 7 save `npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx"` to `<scratchpad>/fe-tsc-baseline-timetable.txt`; tasks add no new errors (line shifts of existing ones are fine); `npx eslint` on touched files 0 errors (this repo enforces `react-hooks/set-state-in-effect`; prefer `useWatch` over `watch`). Never touch untracked `src/shared/api/children 2.ts` / `children 3.ts`; never `git add -A`.
- Frontend stores: one selector per field, selectors return primitives or stored references; stale async results ignored by key; failed loads show «Не вдалося завантажити дані.» with «Спробувати ще», never a permanent «Завантаження…»; saves send only changed rows.
- Commits: Conventional Commits, one task = one commit unless stated, with the committing model's attribution trailer. Never push.
- The user's dev servers own ports 3000 and 5173; live checks use PORT=3100 and stop only your own process.
- Scratchpad: `C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad`.

## Review Focus

1. A lesson replaced for a date: the substitute sees and records it, the original teacher gets 403 `Not your lesson`. Pinned in Task 5.
2. A teacher in two classes with different bell schedules whose periods differ in number but overlap in time → 409 `Schedule conflict`; touching but not overlapping times → no conflict. Pinned in Task 2 and Task 4.
3. An `odd` entry and an `every` entry for the same teacher and time conflict; `odd` vs `even` do not. Pinned in Task 2.
4. A pupil absent in the daily register shows absent (source register) on the lesson; the teacher's `present` mark wins; the daily register is untouched. Pinned in Task 2 and Task 5.
5. A new timetable version closes the current one the day before; a version starting on or before an existing one → 400 `Timetable periods overlap`. Pinned in Task 4.

---

## File Map

Backend (`src/timetable/`):

| File | Responsibility |
|---|---|
| `schedule-calc.ts` | Pure: `isoWeekday`, `isoWeekParity`, `versionOn`, `slotsForDay`, `toMinutes`, `findConflicts`, `pupilState`, `checkBellPeriods` |
| `directories.service.ts`, `directories.controller.ts` | Subjects and rooms |
| `bell-schedules.service.ts`, `bell-schedules.controller.ts` | Bell schedules with periods |
| `subgroups.service.ts`, `subgroups.controller.ts` | Subgroups of a class |
| `schedule.service.ts` | Actual slots of classes for a date range, slot descriptions |
| `timetables.service.ts`, `timetables.controller.ts` | Versions, entries, conflicts, schedule view |
| `lesson-changes.service.ts`, `lesson-changes.controller.ts` | Per-date changes |
| `lessons.service.ts`, `lessons.controller.ts` | My lessons, lesson view, lesson save |
| `parent-timetable.service.ts`, `parent-timetable.controller.ts` | Parent schedule and lessons |
| `timetable.module.ts` | Wiring (imports `AttendanceModule`) |

Frontend: `src/shared/api/timetable.ts`; pages `scheduleSetup`, `schedule`, `myLessons`, `lesson`; `familyChild` tabs; groups modal bell schedule.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_school_timetable/migration.sql`

**Interfaces:**
- Produces: enums `WeekParity`, `LessonChangeType`, `LessonStatus`, `NushLevel`; models `Subject`, `Room`, `BellSchedule`, `BellPeriod`, `Subgroup`, `SubgroupMember`, `Timetable`, `TimetableEntry`, `LessonChange`, `SchoolLesson`, `LessonMark`; `Group.bellScheduleId`; relation fields named below.

- [ ] **Step 1: Models**

Append to `prisma/schema.prisma`:

```prisma
enum WeekParity {
  every
  odd
  even
}

enum LessonChangeType {
  cancel
  replace
  extra
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

model Subject {
  id      String           @id @default(uuid())
  name    String           @unique
  active  Boolean          @default(true)
  entries TimetableEntry[]
  changes LessonChange[]
  lessons SchoolLesson[]
}

model Room {
  id      String           @id @default(uuid())
  name    String           @unique
  active  Boolean          @default(true)
  entries TimetableEntry[]
  changes LessonChange[]
  lessons SchoolLesson[]
}

model BellSchedule {
  id      String       @id @default(uuid())
  name    String       @unique
  active  Boolean      @default(true)
  periods BellPeriod[]
  groups  Group[]
}

model BellPeriod {
  id         String       @id @default(uuid())
  scheduleId String
  schedule   BellSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  number     Int
  startTime  String
  endTime    String

  @@unique([scheduleId, number])
}

model Subgroup {
  id      String           @id @default(uuid())
  groupId String
  group   Group            @relation(fields: [groupId], references: [id])
  name    String
  active  Boolean          @default(true)
  members SubgroupMember[]
  entries TimetableEntry[]
  changes LessonChange[]
  lessons SchoolLesson[]

  @@unique([groupId, name])
}

model SubgroupMember {
  subgroupId String
  subgroup   Subgroup @relation(fields: [subgroupId], references: [id], onDelete: Cascade)
  childId    String
  child      Child    @relation(fields: [childId], references: [id])

  @@id([subgroupId, childId])
}

model Timetable {
  id          String           @id @default(uuid())
  groupId     String
  group       Group            @relation(fields: [groupId], references: [id])
  validFrom   DateTime         @db.Date
  validTo     DateTime?        @db.Date
  createdById String
  createdBy   User             @relation("TimetableCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime         @default(now())
  entries     TimetableEntry[]

  @@index([groupId])
}

model TimetableEntry {
  id          String     @id @default(uuid())
  timetableId String
  timetable   Timetable  @relation(fields: [timetableId], references: [id], onDelete: Cascade)
  weekday     Int
  period      Int
  parity      WeekParity @default(every)
  subjectId   String
  subject     Subject    @relation(fields: [subjectId], references: [id])
  teacherId   String
  teacher     User       @relation("EntryTeacher", fields: [teacherId], references: [id])
  roomId      String?
  room        Room?      @relation(fields: [roomId], references: [id], onDelete: Restrict)
  subgroupId  String?
  subgroup    Subgroup?  @relation(fields: [subgroupId], references: [id], onDelete: Restrict)

  @@index([timetableId])
  @@index([teacherId])
}

model LessonChange {
  id          String           @id @default(uuid())
  groupId     String
  group       Group            @relation(fields: [groupId], references: [id])
  date        DateTime         @db.Date
  period      Int
  subgroupId  String?
  subgroup    Subgroup?        @relation(fields: [subgroupId], references: [id], onDelete: Restrict)
  type        LessonChangeType
  subjectId   String?
  subject     Subject?         @relation(fields: [subjectId], references: [id], onDelete: Restrict)
  teacherId   String?
  teacher     User?            @relation("ChangeTeacher", fields: [teacherId], references: [id], onDelete: Restrict)
  roomId      String?
  room        Room?            @relation(fields: [roomId], references: [id], onDelete: Restrict)
  reason      String
  createdById String
  createdBy   User             @relation("ChangeCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime         @default(now())
  voidedAt    DateTime?
  voidedById  String?
  voidedBy    User?            @relation("ChangeVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason  String?

  @@index([groupId, date])
  @@index([date])
}

model SchoolLesson {
  id            String       @id @default(uuid())
  groupId       String
  group         Group        @relation(fields: [groupId], references: [id])
  date          DateTime     @db.Date
  period        Int
  subgroupKey   String
  subgroupId    String?
  subgroup      Subgroup?    @relation(fields: [subgroupId], references: [id], onDelete: Restrict)
  subjectId     String
  subject       Subject      @relation(fields: [subjectId], references: [id])
  teacherId     String
  teacher       User         @relation("SchoolLessonTeacher", fields: [teacherId], references: [id])
  roomId        String?
  room          Room?        @relation(fields: [roomId], references: [id], onDelete: Restrict)
  topic         String?
  homework      String?
  conductedById String
  conductedBy   User         @relation("SchoolLessonConductedBy", fields: [conductedById], references: [id])
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  marks         LessonMark[]

  @@unique([groupId, date, period, subgroupKey])
}

model LessonMark {
  id         String         @id @default(uuid())
  lessonId   String
  lesson     SchoolLesson   @relation(fields: [lessonId], references: [id])
  childId    String
  child      Child          @relation(fields: [childId], references: [id])
  status     LessonStatus
  reasonId   String?
  reason     AbsenceReason? @relation(fields: [reasonId], references: [id], onDelete: Restrict)
  level      NushLevel?
  comment    String?
  markedById String
  markedBy   User           @relation("LessonMarkMarkedBy", fields: [markedById], references: [id])
  createdAt  DateTime       @default(now())
  voidedAt   DateTime?
  voidedById String?
  voidedBy   User?          @relation("LessonMarkVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason String?

  @@index([lessonId])
  @@index([childId])
}
```

- [ ] **Step 2: Back-relations**

`model Group`, after `calendarDays     CalendarDay[]`:

```prisma
  bellScheduleId   String?
  bellSchedule     BellSchedule?     @relation(fields: [bellScheduleId], references: [id], onDelete: Restrict)
  subgroups        Subgroup[]
  timetables       Timetable[]
  lessonChanges    LessonChange[]
  schoolLessons    SchoolLesson[]
```

`model Child`, after `absenceNotices    AbsenceNotice[]`:

```prisma
  subgroupMemberships SubgroupMember[]
  lessonMarks         LessonMark[]
```

`model AbsenceReason`, after `notices          AbsenceNotice[]`:

```prisma
  lessonMarks      LessonMark[]
```

`model User`, after `noticesDecided      AbsenceNotice[]    @relation("NoticeDecidedBy")`:

```prisma
  timetablesCreated   Timetable[]        @relation("TimetableCreatedBy")
  entriesTaught       TimetableEntry[]   @relation("EntryTeacher")
  changesTaught       LessonChange[]     @relation("ChangeTeacher")
  changesCreated      LessonChange[]     @relation("ChangeCreatedBy")
  changesVoided       LessonChange[]     @relation("ChangeVoidedBy")
  schoolLessonsTaught SchoolLesson[]     @relation("SchoolLessonTeacher")
  schoolLessonsLed    SchoolLesson[]     @relation("SchoolLessonConductedBy")
  lessonMarksMarked   LessonMark[]       @relation("LessonMarkMarkedBy")
  lessonMarksVoided   LessonMark[]       @relation("LessonMarkVoidedBy")
```

- [ ] **Step 3: Migration**

Run (Node 22): `npx prisma migrate dev --create-only --name add_school_timetable`. Expected: only CREATE TYPE / CREATE TABLE / indexes / FKs and `ALTER TABLE "Group" ADD COLUMN "bellScheduleId"`. If Prisma reports drift or asks to reset, STOP and report BLOCKED. Then `npx prisma migrate dev`, `npx prisma generate`, `npm run build`, `npx jest` (all pass).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add school timetable schema"
```

---

### Task 2: Pure schedule calculations

**Files:**
- Create: `src/timetable/schedule-calc.ts`, `src/timetable/schedule-calc.spec.ts`

**Interfaces:**
- Consumes: enums `WeekParity`, `LessonChangeType`, `LessonStatus` (Task 1); `DayState` from `src/attendance/register-calc.ts`.
- Produces (all exported):
  - `isoWeekday(day: Date): number` (Mon 1 … Sun 7)
  - `isoWeekParity(day: Date): 'odd' | 'even'`
  - `interface VersionLike { validFrom: Date; validTo: Date | null }`, `versionOn<T extends VersionLike>(versions: T[], day: Date): T | null`
  - `interface EntryLike { weekday: number; period: number; parity: WeekParity; subjectId: string; teacherId: string; roomId: string | null; subgroupId: string | null }`
  - `interface ChangeLike { id: string; period: number; subgroupId: string | null; type: LessonChangeType; subjectId: string | null; teacherId: string | null; roomId: string | null; voidedAt: Date | null }`
  - `interface PeriodLike { number: number; startTime: string; endTime: string }`
  - `type SlotSource = 'timetable' | 'replace' | 'extra'`
  - `interface Slot { period: number; startTime: string; endTime: string; subgroupId: string | null; subjectId: string; teacherId: string; roomId: string | null; source: SlotSource; cancelled: boolean; changeId: string | null }`
  - `slotsForDay(day: Date, input: { working: boolean; entries: EntryLike[]; changes: ChangeLike[]; periods: PeriodLike[] }): Slot[]`
  - `toMinutes(hhmm: string): number`
  - `interface ConflictItem { ref: string; bucket: string; parity: WeekParity; start: number; end: number; groupId: string; teacherId: string; roomId: string | null; subgroupId: string | null; memberIds: readonly string[]; isNew: boolean }`
  - `type ConflictKind = 'teacher' | 'room' | 'class' | 'subgroup'`, `interface Conflict { kind: ConflictKind; a: string; b: string }`
  - `findConflicts(items: ConflictItem[]): Conflict[]`
  - `interface PupilState { status: LessonStatus | null; reasonId: string | null; source: 'mark' | 'register' | 'none' }`
  - `pupilState(dayState: DayState | null, dayReasonId: string | null, mark: { status: LessonStatus; reasonId: string | null; voidedAt: Date | null } | null): PupilState`
  - `checkBellPeriods(periods: PeriodLike[]): 'Invalid bell time' | 'Bell periods overlap' | null`

- [ ] **Step 1: Failing tests `src/timetable/schedule-calc.spec.ts`**

```ts
import { LessonChangeType, LessonStatus, WeekParity } from '@prisma/client';
import {
  type ChangeLike,
  type ConflictItem,
  type EntryLike,
  checkBellPeriods,
  findConflicts,
  isoWeekParity,
  isoWeekday,
  pupilState,
  slotsForDay,
  toMinutes,
  versionOn,
} from './schedule-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
  { number: 3, startTime: '10:30', endTime: '11:15' },
];

const entry = (over: Partial<EntryLike> = {}): EntryLike => ({
  weekday: 1,
  period: 1,
  parity: WeekParity.every,
  subjectId: 'math',
  teacherId: 't1',
  roomId: 'r1',
  subgroupId: null,
  ...over,
});

const change = (over: Partial<ChangeLike>): ChangeLike => ({
  id: 'ch1',
  period: 1,
  subgroupId: null,
  type: LessonChangeType.cancel,
  subjectId: null,
  teacherId: null,
  roomId: null,
  voidedAt: null,
  ...over,
});

describe('weeks', () => {
  it('numbers weekdays from Monday', () => {
    expect(isoWeekday(day('2026-10-12'))).toBe(1);
    expect(isoWeekday(day('2026-10-17'))).toBe(6);
    expect(isoWeekday(day('2026-10-18'))).toBe(7);
  });

  it('uses ISO week numbers for parity', () => {
    expect(isoWeekParity(day('2026-10-12'))).toBe('even');
    expect(isoWeekParity(day('2026-10-18'))).toBe('even');
    expect(isoWeekParity(day('2026-10-19'))).toBe('odd');
    expect(isoWeekParity(day('2025-12-29'))).toBe('odd');
    expect(isoWeekParity(day('2026-12-31'))).toBe('odd');
    expect(isoWeekParity(day('2027-01-04'))).toBe('odd');
  });

  it('picks the version valid on a day', () => {
    const v1 = { id: 'v1', validFrom: day('2026-09-01'), validTo: day('2026-10-31') };
    const v2 = { id: 'v2', validFrom: day('2026-11-01'), validTo: null };
    expect(versionOn([v1, v2], day('2026-10-31'))?.id).toBe('v1');
    expect(versionOn([v1, v2], day('2026-11-01'))?.id).toBe('v2');
    expect(versionOn([v1, v2], day('2026-08-31'))).toBeNull();
  });
});

describe('slotsForDay', () => {
  const monday = day('2026-10-12');

  it('returns nothing on a non-working day', () => {
    expect(slotsForDay(monday, { working: false, entries: [entry()], changes: [], periods })).toEqual([]);
  });

  it('takes entries of the weekday with matching parity and bell times', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [
        entry({ period: 2 }),
        entry({ period: 1, parity: WeekParity.odd, subjectId: 'art' }),
        entry({ period: 1, parity: WeekParity.even, subjectId: 'music' }),
        entry({ weekday: 2, subjectId: 'pe' }),
      ],
      changes: [],
      periods,
    });
    expect(slots.map((s) => [s.period, s.subjectId, s.startTime, s.endTime])).toEqual([
      [1, 'music', '08:30', '09:15'],
      [2, 'math', '09:25', '10:10'],
    ]);
  });

  it('orders the whole class before subgroups in a period', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [entry({ subgroupId: 'g-a', subjectId: 'eng' }), entry({ period: 1 })],
      changes: [],
      periods,
    });
    expect(slots.map((s) => s.subgroupId)).toEqual([null, 'g-a']);
  });

  it('applies cancel, replace and extra, ignoring voided changes', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [entry({ period: 1 }), entry({ period: 2, subjectId: 'read' })],
      changes: [
        change({ id: 'c1', period: 1, type: LessonChangeType.cancel }),
        change({ id: 'c2', period: 2, type: LessonChangeType.replace, teacherId: 't9' }),
        change({ id: 'c3', period: 3, type: LessonChangeType.extra, subjectId: 'art', teacherId: 't2' }),
        change({ id: 'c4', period: 2, type: LessonChangeType.cancel, voidedAt: new Date() }),
      ],
      periods,
    });
    expect(slots).toEqual([
      { period: 1, startTime: '08:30', endTime: '09:15', subgroupId: null, subjectId: 'math', teacherId: 't1', roomId: 'r1', source: 'timetable', cancelled: true, changeId: 'c1' },
      { period: 2, startTime: '09:25', endTime: '10:10', subgroupId: null, subjectId: 'read', teacherId: 't9', roomId: 'r1', source: 'replace', cancelled: false, changeId: 'c2' },
      { period: 3, startTime: '10:30', endTime: '11:15', subgroupId: null, subjectId: 'art', teacherId: 't2', roomId: null, source: 'extra', cancelled: false, changeId: 'c3' },
    ]);
  });

  it('matches changes by period and subgroup', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [entry({ subgroupId: 'g-a' }), entry({ subgroupId: 'g-b', teacherId: 't2' })],
      changes: [change({ subgroupId: 'g-b' })],
      periods,
    });
    expect(slots.map((s) => [s.subgroupId, s.cancelled])).toEqual([
      ['g-a', false],
      ['g-b', true],
    ]);
  });

  it('moves a lesson as cancel plus extra', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [entry({ period: 1 })],
      changes: [
        change({ id: 'c1', period: 1 }),
        change({ id: 'c2', period: 3, type: LessonChangeType.extra, subjectId: 'math', teacherId: 't1' }),
      ],
      periods,
    });
    expect(slots.filter((s) => !s.cancelled).map((s) => s.period)).toEqual([3]);
  });
});

describe('findConflicts', () => {
  const item = (over: Partial<ConflictItem>): ConflictItem => ({
    ref: 'x',
    bucket: '1',
    parity: WeekParity.every,
    start: toMinutes('08:30'),
    end: toMinutes('09:15'),
    groupId: 'g1',
    teacherId: 't1',
    roomId: null,
    subgroupId: null,
    memberIds: [],
    isNew: true,
    ...over,
  });

  it('detects a teacher busy in two classes by real time, not period number', () => {
    const a = item({ ref: 'a', groupId: 'g1' });
    const b = item({ ref: 'b', groupId: 'g2', isNew: false, start: toMinutes('09:00'), end: toMinutes('09:40') });
    expect(findConflicts([a, b])).toEqual([{ kind: 'teacher', a: 'a', b: 'b' }]);
  });

  it('ignores touching intervals, other buckets and pairs of existing items', () => {
    const a = item({ ref: 'a' });
    const touching = item({ ref: 'b', groupId: 'g2', start: toMinutes('09:15'), end: toMinutes('10:00') });
    const otherDay = item({ ref: 'c', groupId: 'g2', bucket: '2' });
    const old1 = item({ ref: 'd', groupId: 'g3', teacherId: 't5', isNew: false });
    const old2 = item({ ref: 'e', groupId: 'g4', teacherId: 't5', isNew: false });
    expect(findConflicts([a, touching, otherDay, old1, old2])).toEqual([]);
  });

  it('treats every as overlapping both parities and odd vs even as disjoint', () => {
    const odd = item({ ref: 'odd', parity: WeekParity.odd });
    const even = item({ ref: 'even', groupId: 'g2', parity: WeekParity.even });
    const every = item({ ref: 'every', groupId: 'g3', parity: WeekParity.every, isNew: false });
    expect(findConflicts([odd, even, every])).toEqual([
      { kind: 'teacher', a: 'odd', b: 'every' },
      { kind: 'teacher', a: 'even', b: 'every' },
    ]);
  });

  it('detects room double booking', () => {
    const a = item({ ref: 'a', roomId: 'r1' });
    const b = item({ ref: 'b', groupId: 'g2', teacherId: 't2', roomId: 'r1' });
    expect(findConflicts([a, b])).toEqual([{ kind: 'room', a: 'a', b: 'b' }]);
  });

  it('detects a class booked twice and a whole-class lesson over a subgroup', () => {
    const whole = item({ ref: 'whole' });
    const sub = item({ ref: 'sub', teacherId: 't2', subgroupId: 's1', memberIds: ['c1'] });
    expect(findConflicts([whole, sub])).toEqual([{ kind: 'class', a: 'whole', b: 'sub' }]);
  });

  it('allows disjoint subgroups and rejects intersecting ones', () => {
    const a = item({ ref: 'a', subgroupId: 's1', memberIds: ['c1', 'c2'] });
    const b = item({ ref: 'b', teacherId: 't2', subgroupId: 's2', memberIds: ['c3'] });
    const c = item({ ref: 'c', teacherId: 't3', subgroupId: 's3', memberIds: ['c2'] });
    expect(findConflicts([a, b, c])).toEqual([{ kind: 'subgroup', a: 'a', b: 'c' }]);
  });

  it('reports one teacher teaching two subgroups at once', () => {
    const a = item({ ref: 'a', subgroupId: 's1', memberIds: ['c1'] });
    const b = item({ ref: 'b', subgroupId: 's2', memberIds: ['c2'] });
    expect(findConflicts([a, b])).toEqual([{ kind: 'teacher', a: 'a', b: 'b' }]);
  });
});

describe('pupilState', () => {
  it('lets the lesson mark win over the register', () => {
    expect(pupilState('absent', 'sick', { status: LessonStatus.present, reasonId: null, voidedAt: null })).toEqual({
      status: LessonStatus.present,
      reasonId: null,
      source: 'mark',
    });
  });

  it('shows register absences and expected absences as absent', () => {
    expect(pupilState('absent', 'sick', null)).toEqual({ status: LessonStatus.absent, reasonId: 'sick', source: 'register' });
    expect(pupilState('expected_absent', 'trip', null)).toEqual({ status: LessonStatus.absent, reasonId: 'trip', source: 'register' });
  });

  it('is unmarked otherwise and ignores voided marks', () => {
    expect(pupilState('present', null, null)).toEqual({ status: null, reasonId: null, source: 'none' });
    expect(pupilState('unmarked', null, { status: LessonStatus.absent, reasonId: null, voidedAt: new Date() })).toEqual({
      status: null,
      reasonId: null,
      source: 'none',
    });
    expect(pupilState(null, null, null).source).toBe('none');
  });
});

describe('checkBellPeriods', () => {
  it('accepts ordered non-overlapping periods', () => {
    expect(checkBellPeriods(periods)).toBeNull();
  });

  it('rejects inverted times and overlaps or duplicate numbers', () => {
    expect(checkBellPeriods([{ number: 1, startTime: '09:00', endTime: '09:00' }])).toBe('Invalid bell time');
    expect(checkBellPeriods([...periods, { number: 4, startTime: '11:00', endTime: '11:40' }])).toBe('Bell periods overlap');
    expect(checkBellPeriods([periods[0], { ...periods[1], number: 1 }])).toBe('Bell periods overlap');
  });
});
```

(Parity facts: 2026-10-12 is in ISO week 42; 2025-12-29 and 2026-12-31 are in weeks 1 and 53; 2027-01-04 is week 1 of 2027 — two odd weeks in a row at a 53-week boundary is expected ISO behaviour.)

- [ ] **Step 2: Run, verify failure**

Run: `npx jest src/timetable/schedule-calc.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/timetable/schedule-calc.ts`**

```ts
import { LessonChangeType, LessonStatus, WeekParity } from '@prisma/client';
import type { DayState } from '../attendance/register-calc';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VersionLike {
  validFrom: Date;
  validTo: Date | null;
}

export interface EntryLike {
  weekday: number;
  period: number;
  parity: WeekParity;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  subgroupId: string | null;
}

export interface ChangeLike {
  id: string;
  period: number;
  subgroupId: string | null;
  type: LessonChangeType;
  subjectId: string | null;
  teacherId: string | null;
  roomId: string | null;
  voidedAt: Date | null;
}

export interface PeriodLike {
  number: number;
  startTime: string;
  endTime: string;
}

export type SlotSource = 'timetable' | 'replace' | 'extra';

export interface Slot {
  period: number;
  startTime: string;
  endTime: string;
  subgroupId: string | null;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  source: SlotSource;
  cancelled: boolean;
  changeId: string | null;
}

export interface ConflictItem {
  ref: string;
  bucket: string;
  parity: WeekParity;
  start: number;
  end: number;
  groupId: string;
  teacherId: string;
  roomId: string | null;
  subgroupId: string | null;
  memberIds: readonly string[];
  isNew: boolean;
}

export type ConflictKind = 'teacher' | 'room' | 'class' | 'subgroup';

export interface Conflict {
  kind: ConflictKind;
  a: string;
  b: string;
}

export interface PupilState {
  status: LessonStatus | null;
  reasonId: string | null;
  source: 'mark' | 'register' | 'none';
}

export const isoWeekday = (day: Date): number => ((day.getUTCDay() + 6) % 7) + 1;

export function isoWeekParity(day: Date): 'odd' | 'even' {
  const thursday = new Date(day.getTime() + (4 - isoWeekday(day)) * DAY_MS);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
  return week % 2 === 1 ? 'odd' : 'even';
}

export const versionOn = <T extends VersionLike>(versions: T[], day: Date): T | null =>
  versions.find(
    (v) =>
      v.validFrom.getTime() <= day.getTime() &&
      (v.validTo === null || day.getTime() <= v.validTo.getTime()),
  ) ?? null;

const parityMatches = (parity: WeekParity, day: Date) =>
  parity === WeekParity.every || String(parity) === isoWeekParity(day);

export function slotsForDay(
  day: Date,
  input: {
    working: boolean;
    entries: EntryLike[];
    changes: ChangeLike[];
    periods: PeriodLike[];
  },
): Slot[] {
  if (!input.working) return [];
  const make = (
    period: number,
    fields: Pick<Slot, 'subgroupId' | 'subjectId' | 'teacherId' | 'roomId'>,
    source: SlotSource,
    changeId: string | null,
  ): Slot => {
    const bell = input.periods.find((p) => p.number === period);
    return {
      period,
      startTime: bell?.startTime ?? '',
      endTime: bell?.endTime ?? '',
      ...fields,
      source,
      cancelled: false,
      changeId,
    };
  };
  const weekday = isoWeekday(day);
  const slots = input.entries
    .filter((e) => e.weekday === weekday && parityMatches(e.parity, day))
    .map((e) =>
      make(
        e.period,
        {
          subgroupId: e.subgroupId,
          subjectId: e.subjectId,
          teacherId: e.teacherId,
          roomId: e.roomId,
        },
        'timetable',
        null,
      ),
    );
  for (const change of input.changes) {
    if (change.voidedAt) continue;
    const target = slots.find(
      (s) =>
        !s.cancelled &&
        s.period === change.period &&
        s.subgroupId === change.subgroupId,
    );
    if (change.type === LessonChangeType.cancel) {
      if (target) {
        target.cancelled = true;
        target.changeId = change.id;
      }
      continue;
    }
    if (change.type === LessonChangeType.replace) {
      if (target) {
        target.subjectId = change.subjectId ?? target.subjectId;
        target.teacherId = change.teacherId ?? target.teacherId;
        target.roomId = change.roomId ?? target.roomId;
        target.source = 'replace';
        target.changeId = change.id;
      }
      continue;
    }
    if (change.subjectId && change.teacherId) {
      slots.push(
        make(
          change.period,
          {
            subgroupId: change.subgroupId,
            subjectId: change.subjectId,
            teacherId: change.teacherId,
            roomId: change.roomId,
          },
          'extra',
          change.id,
        ),
      );
    }
  }
  const rank = (s: Slot) => (s.subgroupId === null ? 0 : 1);
  return slots.sort((a, b) => a.period - b.period || rank(a) - rank(b));
}

export const toMinutes = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

const parityOverlap = (a: WeekParity, b: WeekParity) =>
  a === WeekParity.every || b === WeekParity.every || a === b;

function conflictKind(a: ConflictItem, b: ConflictItem): ConflictKind | null {
  if (a.groupId === b.groupId) {
    if (a.subgroupId === null || b.subgroupId === null || a.subgroupId === b.subgroupId)
      return 'class';
    if (a.memberIds.some((id) => b.memberIds.includes(id))) return 'subgroup';
  }
  if (a.teacherId === b.teacherId) return 'teacher';
  if (a.roomId !== null && a.roomId === b.roomId) return 'room';
  return null;
}

export function findConflicts(items: ConflictItem[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a.isNew && !b.isNew) continue;
      if (a.bucket !== b.bucket || !parityOverlap(a.parity, b.parity)) continue;
      if (!(a.start < b.end && b.start < a.end)) continue;
      const kind = conflictKind(a, b);
      if (kind) conflicts.push({ kind, a: a.ref, b: b.ref });
    }
  }
  return conflicts;
}

export function pupilState(
  dayState: DayState | null,
  dayReasonId: string | null,
  mark: { status: LessonStatus; reasonId: string | null; voidedAt: Date | null } | null,
): PupilState {
  if (mark && !mark.voidedAt)
    return { status: mark.status, reasonId: mark.reasonId, source: 'mark' };
  if (dayState === 'absent' || dayState === 'expected_absent')
    return { status: LessonStatus.absent, reasonId: dayReasonId, source: 'register' };
  return { status: null, reasonId: null, source: 'none' };
}

export function checkBellPeriods(
  periods: PeriodLike[],
): 'Invalid bell time' | 'Bell periods overlap' | null {
  if (periods.some((p) => toMinutes(p.startTime) >= toMinutes(p.endTime)))
    return 'Invalid bell time';
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].number === sorted[i - 1].number) return 'Bell periods overlap';
    if (toMinutes(sorted[i].startTime) < toMinutes(sorted[i - 1].endTime))
      return 'Bell periods overlap';
  }
  return null;
}
```

- [ ] **Step 4: Verify**

Run: `npx jest src/timetable/schedule-calc.spec.ts` → PASS; `npx eslint --fix` on both files; `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/timetable/schedule-calc.ts src/timetable/schedule-calc.spec.ts
git commit -m "feat: add pure school schedule calculations"
```

---

### Task 3: Directories — subjects, rooms, bell schedules, subgroups, class bell schedule

**Files:**
- Create: `src/timetable/roles.ts`, `src/timetable/dto/named.dto.ts`, `src/timetable/dto/bell-schedule.dto.ts`, `src/timetable/dto/subgroup.dto.ts`, `src/timetable/directories.service.ts`, `src/timetable/directories.service.spec.ts`, `src/timetable/directories.controller.ts`, `src/timetable/bell-schedules.service.ts`, `src/timetable/bell-schedules.service.spec.ts`, `src/timetable/bell-schedules.controller.ts`, `src/timetable/subgroups.service.ts`, `src/timetable/subgroups.service.spec.ts`, `src/timetable/subgroups.controller.ts`, `src/timetable/timetable.module.ts`
- Modify: `src/app.module.ts`, `src/groups/dto/create-group.dto.ts`, `src/groups/dto/update-group.dto.ts`, `src/groups/groups.service.ts`, `src/groups/groups.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 models; `checkBellPeriods` (Task 2); `AuthenticatedUser`.
- Produces:
  - `isAdmin(user: AuthenticatedUser): boolean` in `src/timetable/roles.ts`.
  - Routes: `GET/POST /subjects`, `PATCH /subjects/:id`, `GET/POST /rooms`, `PATCH /rooms/:id`, `GET/POST /bell-schedules`, `PATCH /bell-schedules/:id`, `GET/POST /groups/:id/subgroups`, `PATCH /subgroups/:id`.
  - Subgroup response `{ id, groupId, name, active, children: { id, firstName, lastName }[] }`.
  - Bell schedule response `{ id, name, active, periods: { number, startTime, endTime }[] }` (periods ordered by number).
  - `POST/PATCH /groups` accept `bellScheduleId` (`null` clears on PATCH).
  - `TimetableModule` (imports `AttendanceModule`), later tasks add providers/controllers.

- [ ] **Step 1: Helpers and DTOs**

`src/timetable/roles.ts`:

```ts
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';

export const isAdmin = (user: AuthenticatedUser): boolean =>
  user.role === Role.root || user.role === Role.admin;
```

`src/timetable/dto/named.dto.ts`:

```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNamedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class UpdateNamedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
```

`src/timetable/dto/bell-schedule.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BellPeriodDto {
  @IsInt()
  @Min(1)
  number: number;

  @Matches(TIME)
  startTime: string;

  @Matches(TIME)
  endTime: string;
}

export class CreateBellScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BellPeriodDto)
  periods: BellPeriodDto[];
}

export class UpdateBellScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BellPeriodDto)
  @IsOptional()
  periods?: BellPeriodDto[];
}
```

`src/timetable/dto/subgroup.dto.ts`:

```ts
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateSubgroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @IsUUID('4', { each: true })
  childIds: string[];
}

export class UpdateSubgroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  childIds?: string[];
}
```

Group DTOs (`create-group.dto.ts`, `update-group.dto.ts`) — add:

```ts
  @IsUUID('4')
  @IsOptional()
  bellScheduleId?: string | null;
```

In `update-group.dto.ts` use `@ValidateIf((_, value) => value !== null)` before `@IsUUID('4')` instead of `@IsOptional()` placement so `null` passes (import `ValidateIf`), keeping `@IsOptional()` as well.

- [ ] **Step 2: Failing tests**

`src/timetable/directories.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DirectoriesService } from './directories.service';

const mockPrisma = {
  subject: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  room: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
};
const user = (role: Role) => ({ id: 'u1', role, login: 'x', mustChangePassword: false });
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('DirectoriesService', () => {
  let service: DirectoriesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [DirectoriesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(DirectoriesService);
  });

  it('lists only active subjects for teachers', async () => {
    mockPrisma.subject.findMany.mockResolvedValue([]);
    await service.listSubjects(user(Role.teacher));
    expect(firstArg<{ where: object }>(mockPrisma.subject.findMany).where).toEqual({ active: true });
  });

  it('rejects a duplicate subject and trims names', async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({ id: 's1', name: 'Математика' });
    await expect(service.createSubject({ name: ' Математика ' })).rejects.toThrow(new ConflictException('Subject already exists'));
    mockPrisma.subject.findUnique.mockResolvedValue(null);
    mockPrisma.subject.create.mockResolvedValue({ id: 's2' });
    await service.createSubject({ name: ' Читання ' });
    expect(firstArg<{ data: object }>(mockPrisma.subject.create).data).toEqual({ name: 'Читання' });
  });

  it('updates and deactivates rooms, 404 for missing', async () => {
    mockPrisma.room.findUnique.mockResolvedValueOnce(null);
    await expect(service.updateRoom('nope', { active: false })).rejects.toThrow(new NotFoundException('Room not found'));
    mockPrisma.room.findUnique.mockResolvedValueOnce({ id: 'r1', name: '101' });
    mockPrisma.room.update.mockResolvedValue({ id: 'r1' });
    await service.updateRoom('r1', { active: false });
    expect(firstArg<{ data: object }>(mockPrisma.room.update).data).toEqual({ name: undefined, active: false });
  });

  it('rejects a duplicate room name on rename', async () => {
    mockPrisma.room.findUnique
      .mockResolvedValueOnce({ id: 'r1', name: '101' })
      .mockResolvedValueOnce({ id: 'r2', name: '102' });
    await expect(service.updateRoom('r1', { name: '102' })).rejects.toThrow(new ConflictException('Room already exists'));
  });
});
```

`src/timetable/bell-schedules.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { BellSchedulesService } from './bell-schedules.service';

const mockPrisma = {
  bellSchedule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  bellPeriod: { deleteMany: jest.fn(), createMany: jest.fn() },
  timetableEntry: { findMany: jest.fn() },
  $transaction: jest.fn(),
};
const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
];
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('BellSchedulesService', () => {
  let service: BellSchedulesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [BellSchedulesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(BellSchedulesService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.timetableEntry.findMany.mockResolvedValue([]);
  });

  it('creates a schedule with its periods', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    mockPrisma.bellSchedule.create.mockResolvedValue({ id: 'b1' });
    await service.create({ name: ' 1–4 класи ', periods });
    expect(firstArg<{ data: object }>(mockPrisma.bellSchedule.create).data).toEqual({
      name: '1–4 класи',
      periods: { create: periods },
    });
  });

  it('rejects bad times, overlaps and duplicates', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(service.create({ name: 'x', periods: [{ number: 1, startTime: '09:00', endTime: '08:00' }] })).rejects.toThrow(
      new BadRequestException('Invalid bell time'),
    );
    await expect(
      service.create({ name: 'x', periods: [...periods, { number: 3, startTime: '10:00', endTime: '10:40' }] }),
    ).rejects.toThrow(new BadRequestException('Bell periods overlap'));
    mockPrisma.bellSchedule.findUnique.mockResolvedValue({ id: 'b0', name: 'x' });
    await expect(service.create({ name: 'x', periods })).rejects.toThrow(new ConflictException('Bell schedule already exists'));
  });

  it('refuses to drop a period used by a timetable', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue({ id: 'b1', name: 'x' });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 2 }]);
    await expect(service.update('b1', { periods: [periods[0]] })).rejects.toThrow(new BadRequestException('Bell period is in use'));
    expect(firstArg<{ where: object }>(mockPrisma.timetableEntry.findMany).where).toEqual({
      timetable: { group: { bellScheduleId: 'b1' } },
    });
  });

  it('replaces periods as a unit', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValueOnce({ id: 'b1', name: 'x' }).mockResolvedValueOnce({ id: 'b1', periods });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 1 }]);
    await service.update('b1', { periods });
    expect(mockPrisma.bellPeriod.deleteMany).toHaveBeenCalledWith({ where: { scheduleId: 'b1' } });
    expect(mockPrisma.bellPeriod.createMany).toHaveBeenCalledWith({ data: periods.map((p) => ({ ...p, scheduleId: 'b1' })) });
  });

  it('404 for a missing schedule', async () => {
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { active: false })).rejects.toThrow(new NotFoundException('Bell schedule not found'));
  });
});
```

`src/timetable/subgroups.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubgroupsService } from './subgroups.service';

const mockPrisma = {
  group: { findUnique: jest.fn() },
  child: { count: jest.fn() },
  subgroup: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  subgroupMember: { deleteMany: jest.fn(), createMany: jest.fn() },
  $transaction: jest.fn(),
};
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];
const row = { id: 'sg1', groupId: 'g1', name: 'Англ. 1', active: true, members: [{ child: { id: 'c1', firstName: 'А', lastName: 'Б' } }] };

describe('SubgroupsService', () => {
  let service: SubgroupsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SubgroupsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(SubgroupsService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', kind: GroupKind.school_class });
    mockPrisma.child.count.mockResolvedValue(1);
    mockPrisma.subgroup.findUnique.mockResolvedValue(null);
    mockPrisma.subgroup.create.mockResolvedValue(row);
  });

  it('creates a subgroup of class children', async () => {
    await expect(service.create('g1', { name: ' Англ. 1 ', childIds: ['c1'] })).resolves.toEqual({
      id: 'sg1',
      groupId: 'g1',
      name: 'Англ. 1',
      active: true,
      children: [{ id: 'c1', firstName: 'А', lastName: 'Б' }],
    });
    expect(firstArg<{ data: object }>(mockPrisma.subgroup.create).data).toEqual({
      groupId: 'g1',
      name: 'Англ. 1',
      members: { create: [{ childId: 'c1' }] },
    });
    expect(firstArg<{ where: object }>(mockPrisma.child.count).where).toEqual({ id: { in: ['c1'] }, groupId: 'g1' });
  });

  it('rejects children from other classes, kindergarten groups and duplicate names', async () => {
    mockPrisma.child.count.mockResolvedValue(0);
    await expect(service.create('g1', { name: 'x', childIds: ['c9'] })).rejects.toThrow(new BadRequestException('Child is not in this class'));
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', kind: GroupKind.kindergarten });
    await expect(service.create('g1', { name: 'x', childIds: [] })).rejects.toThrow(new BadRequestException('Not a school class'));
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', kind: GroupKind.school_class });
    mockPrisma.child.count.mockResolvedValue(0);
    mockPrisma.subgroup.findUnique.mockResolvedValue({ id: 'sg0' });
    await expect(service.create('g1', { name: 'x', childIds: [] })).rejects.toThrow(new ConflictException('Subgroup already exists'));
    mockPrisma.group.findUnique.mockResolvedValue(null);
    await expect(service.list('g9')).rejects.toThrow(new NotFoundException('Group not found'));
  });

  it('replaces members on update', async () => {
    mockPrisma.subgroup.findUnique.mockResolvedValueOnce({ id: 'sg1', groupId: 'g1', name: 'Англ. 1' }).mockResolvedValueOnce(row);
    await service.update('sg1', { childIds: ['c1'] });
    expect(mockPrisma.subgroupMember.deleteMany).toHaveBeenCalledWith({ where: { subgroupId: 'sg1' } });
    expect(mockPrisma.subgroupMember.createMany).toHaveBeenCalledWith({ data: [{ subgroupId: 'sg1', childId: 'c1' }] });
  });
});
```

Add to `src/groups/groups.service.spec.ts` (`mockPrisma`: `bellSchedule: { findUnique: jest.fn() }`, `timetableEntry: { findMany: jest.fn() }`, and `group.update` already exists):

```ts
  it('sets a bell schedule only on school classes and checks used periods', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', name: '1-А', kind: GroupKind.kindergarten });
    mockPrisma.bellSchedule.findUnique.mockResolvedValue({ id: 'b1', periods: [{ number: 1 }] });
    await expect(service.update('g1', { bellScheduleId: 'b1' })).rejects.toThrow(new BadRequestException('Not a school class'));
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', name: '1-А', kind: GroupKind.school_class });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 5 }]);
    await expect(service.update('g1', { bellScheduleId: 'b1' })).rejects.toThrow(new BadRequestException('Bell period is in use'));
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(service.update('g1', { bellScheduleId: 'b9' })).rejects.toThrow(new NotFoundException('Bell schedule not found'));
  });
```

(import `NotFoundException`, `GroupKind` where missing.)

- [ ] **Step 3: Run, verify failure**

Run: `npx jest src/timetable src/groups` → FAIL (modules missing / service lacks bell schedule logic).

- [ ] **Step 4: Implement services**

`src/timetable/directories.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { isAdmin } from './roles';
import { CreateNamedDto, UpdateNamedDto } from './dto/named.dto';

@Injectable()
export class DirectoriesService {
  constructor(private prisma: PrismaService) {}

  listSubjects(user: AuthenticatedUser) {
    return this.prisma.subject.findMany({
      where: isAdmin(user) ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSubject(dto: CreateNamedDto) {
    const name = dto.name.trim();
    if (await this.prisma.subject.findUnique({ where: { name } }))
      throw new ConflictException('Subject already exists');
    return this.prisma.subject.create({ data: { name } });
  }

  async updateSubject(id: string, dto: UpdateNamedDto) {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('Subject not found');
    const name = dto.name?.trim();
    if (name && name !== subject.name && (await this.prisma.subject.findUnique({ where: { name } })))
      throw new ConflictException('Subject already exists');
    return this.prisma.subject.update({ where: { id }, data: { name, active: dto.active } });
  }

  listRooms(user: AuthenticatedUser) {
    return this.prisma.room.findMany({
      where: isAdmin(user) ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createRoom(dto: CreateNamedDto) {
    const name = dto.name.trim();
    if (await this.prisma.room.findUnique({ where: { name } }))
      throw new ConflictException('Room already exists');
    return this.prisma.room.create({ data: { name } });
  }

  async updateRoom(id: string, dto: UpdateNamedDto) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    const name = dto.name?.trim();
    if (name && name !== room.name && (await this.prisma.room.findUnique({ where: { name } })))
      throw new ConflictException('Room already exists');
    return this.prisma.room.update({ where: { id }, data: { name, active: dto.active } });
  }
}
```

`src/timetable/bell-schedules.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { checkBellPeriods } from './schedule-calc';
import {
  BellPeriodDto,
  CreateBellScheduleDto,
  UpdateBellScheduleDto,
} from './dto/bell-schedule.dto';

const withPeriods = {
  periods: {
    select: { number: true, startTime: true, endTime: true },
    orderBy: { number: 'asc' },
  },
} as const;

@Injectable()
export class BellSchedulesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.bellSchedule.findMany({
      include: withPeriods,
      orderBy: { name: 'asc' },
    });
  }

  private assertPeriods(periods: BellPeriodDto[]) {
    const problem = checkBellPeriods(periods);
    if (problem) throw new BadRequestException(problem);
  }

  async create(dto: CreateBellScheduleDto) {
    const name = dto.name.trim();
    this.assertPeriods(dto.periods);
    if (await this.prisma.bellSchedule.findUnique({ where: { name } }))
      throw new ConflictException('Bell schedule already exists');
    return this.prisma.bellSchedule.create({
      data: { name, periods: { create: dto.periods } },
      include: withPeriods,
    });
  }

  async update(id: string, dto: UpdateBellScheduleDto) {
    const schedule = await this.prisma.bellSchedule.findUnique({ where: { id } });
    if (!schedule) throw new NotFoundException('Bell schedule not found');
    const name = dto.name?.trim();
    if (name && name !== schedule.name && (await this.prisma.bellSchedule.findUnique({ where: { name } })))
      throw new ConflictException('Bell schedule already exists');
    const periods = dto.periods;
    if (periods) {
      this.assertPeriods(periods);
      const used = await this.prisma.timetableEntry.findMany({
        where: { timetable: { group: { bellScheduleId: id } } },
        select: { period: true },
        distinct: ['period'],
      });
      const numbers = new Set(periods.map((p) => p.number));
      if (used.some((u) => !numbers.has(u.period)))
        throw new BadRequestException('Bell period is in use');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.bellSchedule.update({ where: { id }, data: { name, active: dto.active } });
      if (periods) {
        await tx.bellPeriod.deleteMany({ where: { scheduleId: id } });
        await tx.bellPeriod.createMany({ data: periods.map((p) => ({ ...p, scheduleId: id })) });
      }
      return tx.bellSchedule.findUnique({ where: { id }, include: withPeriods });
    });
  }
}
```

(The "rejects a duplicate" test calls `create` with a valid schedule and expects the conflict, so the name check must run after the period check, as written. `findMany` with `distinct` in the test is matched only on `where` via `firstArg`.)

`src/timetable/subgroups.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubgroupDto, UpdateSubgroupDto } from './dto/subgroup.dto';

const withMembers = {
  members: {
    select: { child: { select: { id: true, firstName: true, lastName: true } } },
  },
} as const;

type SubgroupRow = {
  id: string;
  groupId: string;
  name: string;
  active: boolean;
  members: { child: { id: string; firstName: string; lastName: string } }[];
};

const view = (row: SubgroupRow) => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  active: row.active,
  children: row.members.map((m) => m.child),
});

@Injectable()
export class SubgroupsService {
  constructor(private prisma: PrismaService) {}

  private async requireClass(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, kind: true },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.kind !== GroupKind.school_class)
      throw new BadRequestException('Not a school class');
    return group;
  }

  private async assertChildren(groupId: string, childIds: string[]) {
    const unique = [...new Set(childIds)];
    if (!unique.length) return unique;
    const count = await this.prisma.child.count({ where: { id: { in: unique }, groupId } });
    if (count !== unique.length) throw new BadRequestException('Child is not in this class');
    return unique;
  }

  async list(groupId: string) {
    await this.requireClass(groupId);
    const rows = await this.prisma.subgroup.findMany({
      where: { groupId },
      include: withMembers,
      orderBy: { name: 'asc' },
    });
    return rows.map(view);
  }

  async create(groupId: string, dto: CreateSubgroupDto) {
    await this.requireClass(groupId);
    const name = dto.name.trim();
    const childIds = await this.assertChildren(groupId, dto.childIds);
    if (await this.prisma.subgroup.findUnique({ where: { groupId_name: { groupId, name } } }))
      throw new ConflictException('Subgroup already exists');
    const row = await this.prisma.subgroup.create({
      data: { groupId, name, members: { create: childIds.map((childId) => ({ childId })) } },
      include: withMembers,
    });
    return view(row);
  }

  async update(id: string, dto: UpdateSubgroupDto) {
    const subgroup = await this.prisma.subgroup.findUnique({ where: { id } });
    if (!subgroup) throw new NotFoundException('Subgroup not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== subgroup.name &&
      (await this.prisma.subgroup.findUnique({
        where: { groupId_name: { groupId: subgroup.groupId, name } },
      }))
    )
      throw new ConflictException('Subgroup already exists');
    const childIds = dto.childIds
      ? await this.assertChildren(subgroup.groupId, dto.childIds)
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.subgroup.update({ where: { id }, data: { name, active: dto.active } });
      if (childIds) {
        await tx.subgroupMember.deleteMany({ where: { subgroupId: id } });
        await tx.subgroupMember.createMany({
          data: childIds.map((childId) => ({ subgroupId: id, childId })),
        });
      }
    });
    const row = await this.prisma.subgroup.findUnique({ where: { id }, include: withMembers });
    return row && view(row);
  }
}
```

(Add `Subgroup not found` to the spec error list; translated in Task 7.)

Group bell schedule — in `GroupsService` add a private helper and call it from `create` and `update` before writing, then pass `bellScheduleId: dto.bellScheduleId` into `data` in both:

```ts
  private async assertBellSchedule(
    groupId: string | null,
    kind: GroupKind,
    bellScheduleId: string | null | undefined,
  ) {
    if (!bellScheduleId) return;
    const schedule = await this.prisma.bellSchedule.findUnique({
      where: { id: bellScheduleId },
      select: { id: true, periods: { select: { number: true } } },
    });
    if (!schedule) throw new NotFoundException('Bell schedule not found');
    if (kind !== GroupKind.school_class)
      throw new BadRequestException('Not a school class');
    if (!groupId) return;
    const used = await this.prisma.timetableEntry.findMany({
      where: { timetable: { groupId } },
      select: { period: true },
      distinct: ['period'],
    });
    const numbers = new Set(schedule.periods.map((p) => p.number));
    if (used.some((u) => !numbers.has(u.period)))
      throw new BadRequestException('Bell period is in use');
  }
```

`create`: `await this.assertBellSchedule(null, dto.kind ?? GroupKind.kindergarten, dto.bellScheduleId);`. `update`: `await this.assertBellSchedule(id, dto.kind ?? group.kind, dto.bellScheduleId);`.

- [ ] **Step 5: Controllers and module**

`src/timetable/directories.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { DirectoriesService } from './directories.service';
import { CreateNamedDto, UpdateNamedDto } from './dto/named.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class DirectoriesController {
  constructor(private directories: DirectoriesService) {}

  @Get('subjects')
  @Roles(Role.root, Role.admin, Role.teacher)
  subjects(@CurrentUser() user: AuthenticatedUser) {
    return this.directories.listSubjects(user);
  }

  @Post('subjects')
  createSubject(@Body() dto: CreateNamedDto) {
    return this.directories.createSubject(dto);
  }

  @Patch('subjects/:id')
  updateSubject(@Param('id') id: string, @Body() dto: UpdateNamedDto) {
    return this.directories.updateSubject(id, dto);
  }

  @Get('rooms')
  @Roles(Role.root, Role.admin, Role.teacher)
  rooms(@CurrentUser() user: AuthenticatedUser) {
    return this.directories.listRooms(user);
  }

  @Post('rooms')
  createRoom(@Body() dto: CreateNamedDto) {
    return this.directories.createRoom(dto);
  }

  @Patch('rooms/:id')
  updateRoom(@Param('id') id: string, @Body() dto: UpdateNamedDto) {
    return this.directories.updateRoom(id, dto);
  }
}
```

`src/timetable/bell-schedules.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BellSchedulesService } from './bell-schedules.service';
import { CreateBellScheduleDto, UpdateBellScheduleDto } from './dto/bell-schedule.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('bell-schedules')
export class BellSchedulesController {
  constructor(private schedules: BellSchedulesService) {}

  @Get()
  @Roles(Role.root, Role.admin, Role.teacher)
  list() {
    return this.schedules.list();
  }

  @Post()
  create(@Body() dto: CreateBellScheduleDto) {
    return this.schedules.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBellScheduleDto) {
    return this.schedules.update(id, dto);
  }
}
```

`src/timetable/subgroups.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SubgroupsService } from './subgroups.service';
import { CreateSubgroupDto, UpdateSubgroupDto } from './dto/subgroup.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class SubgroupsController {
  constructor(private subgroups: SubgroupsService) {}

  @Get('groups/:id/subgroups')
  @Roles(Role.root, Role.admin, Role.teacher)
  list(@Param('id') id: string) {
    return this.subgroups.list(id);
  }

  @Post('groups/:id/subgroups')
  create(@Param('id') id: string, @Body() dto: CreateSubgroupDto) {
    return this.subgroups.create(id, dto);
  }

  @Patch('subgroups/:id')
  update(@Param('id') id: string, @Body() dto: UpdateSubgroupDto) {
    return this.subgroups.update(id, dto);
  }
}
```

`src/timetable/timetable.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BellSchedulesController } from './bell-schedules.controller';
import { BellSchedulesService } from './bell-schedules.service';
import { DirectoriesController } from './directories.controller';
import { DirectoriesService } from './directories.service';
import { SubgroupsController } from './subgroups.controller';
import { SubgroupsService } from './subgroups.service';

@Module({
  imports: [AttendanceModule],
  controllers: [DirectoriesController, BellSchedulesController, SubgroupsController],
  providers: [DirectoriesService, BellSchedulesService, SubgroupsService],
})
export class TimetableModule {}
```

Register `TimetableModule` in `src/app.module.ts` after `AttendanceModule`.

- [ ] **Step 6: Verify and commit**

Run: `npx jest src/timetable src/groups` → PASS; full `npx jest`; `npm run build`; eslint --fix on touched files.

```bash
git add src/timetable src/groups src/app.module.ts
git commit -m "feat: add subjects, rooms, bell schedules and subgroups"
```

---

### Task 4: Schedule assembly, timetable versions, per-date changes, conflicts

**Files:**
- Create: `src/timetable/schedule.service.ts`, `src/timetable/schedule.service.spec.ts`, `src/timetable/dto/timetable.dto.ts`, `src/timetable/dto/lesson-change.dto.ts`, `src/timetable/timetables.service.ts`, `src/timetable/timetables.service.spec.ts`, `src/timetable/timetables.controller.ts`, `src/timetable/lesson-changes.service.ts`, `src/timetable/lesson-changes.service.spec.ts`, `src/timetable/lesson-changes.controller.ts`
- Modify: `src/timetable/timetable.module.ts`

**Interfaces:**
- Consumes: `slotsForDay`, `versionOn`, `findConflicts`, `toMinutes`, `Slot`, `ChangeLike`, `PeriodLike`, `EntryLike`, `Conflict`, `ConflictItem` (Task 2); `CalendarService.entriesBetween`, `dayInfo`, `dayRange` (attendance); `isAdmin`; `ReasonDto` (`src/attendance/dto/reason.dto.ts`).
- Produces:
  - `subgroupKey(id: string | null): string` (`id ?? 'class'`) exported from `schedule.service.ts`.
  - `ScheduleService.requireClass(groupId): Promise<{ id: string; name: string; periods: PeriodLike[] }>` (404 `Group not found`, 400 `Not a school class`, 400 `Class has no bell schedule`).
  - `ScheduleService.build(from: Date, to: Date, groupIds?: string[], pending?: { groupId: string; change: ChangeLike & { date: Date } }): Promise<ClassSchedule[]>` where `ClassSchedule = { group: { id; name; periods: PeriodLike[] }; days: { date: Date; working: boolean; title: string | null; slots: Slot[] }[] }` (school classes only, ordered by name).
  - `ScheduleService.describe(slots: Slot[]): Promise<(slot: Slot) => { subjectName: string | null; teacherName: string | null; roomName: string | null; subgroupName: string | null }>`.
  - `ScheduleService.throwConflicts(conflicts: Conflict[], refs: Map<string, ConflictRef>): Promise<never>` with `ConflictRef = { groupName: string; weekday: number | null; date: string | null; period: number; subjectId: string; isNew: boolean }`.
  - Routes `GET/POST /groups/:id/timetables`, `PUT /timetables/:id/entries`, `GET /groups/:id/schedule?from&to`, `POST /groups/:id/lesson-changes`, `POST /lesson-changes/:id/void`.

- [ ] **Step 1: DTOs**

`src/timetable/dto/timetable.dto.ts`:

```ts
import { WeekParity } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class TimetableEntryDto {
  @IsInt()
  @Min(1)
  @Max(6)
  weekday: number;

  @IsInt()
  @Min(1)
  period: number;

  @IsEnum(WeekParity)
  @IsOptional()
  parity?: WeekParity;

  @IsUUID('4')
  subjectId: string;

  @IsUUID('4')
  teacherId: string;

  @IsUUID('4')
  @IsOptional()
  roomId?: string;

  @IsUUID('4')
  @IsOptional()
  subgroupId?: string;
}

export class TimetableEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimetableEntryDto)
  entries: TimetableEntryDto[];
}

export class CreateTimetableDto extends TimetableEntriesDto {
  @IsString()
  validFrom: string;
}
```

`src/timetable/dto/lesson-change.dto.ts`:

```ts
import { LessonChangeType } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateLessonChangeDto {
  @IsString()
  date: string;

  @IsInt()
  @Min(1)
  period: number;

  @IsUUID('4')
  @IsOptional()
  subgroupId?: string;

  @IsEnum(LessonChangeType)
  type: LessonChangeType;

  @IsUUID('4')
  @IsOptional()
  subjectId?: string;

  @IsUUID('4')
  @IsOptional()
  teacherId?: string;

  @IsUUID('4')
  @IsOptional()
  roomId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
```

- [ ] **Step 2: Failing tests**

`src/timetable/schedule.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CalendarDayType, CalendarScope, GroupKind, LessonChangeType, WeekParity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { ScheduleService } from './schedule.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const periods = [{ number: 1, startTime: '08:30', endTime: '09:15' }];
const entry = { id: 'e1', weekday: 1, period: 1, parity: WeekParity.every, subjectId: 's1', teacherId: 't1', roomId: null, subgroupId: null };

const mockPrisma = {
  group: { findMany: jest.fn(), findUnique: jest.fn() },
  subject: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  room: { findMany: jest.fn() },
  subgroup: { findMany: jest.fn() },
};
const mockCalendar = { entriesBetween: jest.fn() };

describe('ScheduleService', () => {
  let service: ScheduleService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScheduleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
      ],
    }).compile();
    service = moduleRef.get(ScheduleService);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockPrisma.group.findMany.mockResolvedValue([
      {
        id: 'g1',
        name: '1-А',
        kind: GroupKind.school_class,
        bellSchedule: { periods },
        timetables: [{ validFrom: day('2026-09-01'), validTo: null, entries: [entry] }],
        lessonChanges: [],
      },
    ]);
  });

  it('builds slots per day from the version, skipping weekends and holidays', async () => {
    mockCalendar.entriesBetween.mockResolvedValue([
      { startDate: day('2026-10-13'), endDate: day('2026-10-13'), type: CalendarDayType.non_working, scope: CalendarScope.school_class, groupId: null, title: 'Свято', voidedAt: null },
    ]);
    const [schedule] = await service.build(day('2026-10-12'), day('2026-10-19'));
    expect(schedule.days.map((d) => [d.date.toISOString().slice(0, 10), d.slots.length, d.title])).toEqual([
      ['2026-10-12', 1, null],
      ['2026-10-13', 0, 'Свято'],
      ['2026-10-14', 0, null],
      ['2026-10-15', 0, null],
      ['2026-10-16', 0, null],
      ['2026-10-17', 0, null],
      ['2026-10-18', 0, null],
      ['2026-10-19', 1, null],
    ]);
  });

  it('applies a pending change to its class only', async () => {
    const [schedule] = await service.build(day('2026-10-12'), day('2026-10-12'), ['g1'], {
      groupId: 'g1',
      change: { id: 'pending', date: day('2026-10-12'), period: 1, subgroupId: null, type: LessonChangeType.replace, subjectId: null, teacherId: 't2', roomId: null, voidedAt: null },
    });
    expect(schedule.days[0].slots[0]).toMatchObject({ teacherId: 't2', changeId: 'pending', source: 'replace' });
  });

  it('requires a school class with a bell schedule', async () => {
    mockPrisma.group.findUnique.mockResolvedValueOnce(null);
    await expect(service.requireClass('g9')).rejects.toThrow(new NotFoundException('Group not found'));
    mockPrisma.group.findUnique.mockResolvedValueOnce({ id: 'g1', name: 'x', kind: GroupKind.kindergarten, bellSchedule: null });
    await expect(service.requireClass('g1')).rejects.toThrow(new BadRequestException('Not a school class'));
    mockPrisma.group.findUnique.mockResolvedValueOnce({ id: 'g1', name: 'x', kind: GroupKind.school_class, bellSchedule: null });
    await expect(service.requireClass('g1')).rejects.toThrow(new BadRequestException('Class has no bell schedule'));
  });

  it('reports conflicts with the new item first and subject names', async () => {
    mockPrisma.subject.findMany.mockResolvedValue([{ id: 's1', name: 'Математика' }, { id: 's2', name: 'Читання' }]);
    const refs = new Map([
      ['a', { groupName: '1-Б', weekday: 1, date: null, period: 2, subjectId: 's2', isNew: false }],
      ['b', { groupName: '1-А', weekday: 1, date: null, period: 1, subjectId: 's1', isNew: true }],
    ]);
    await expect(service.throwConflicts([{ kind: 'teacher', a: 'a', b: 'b' }], refs)).rejects.toThrow(ConflictException);
    try {
      await service.throwConflicts([{ kind: 'teacher', a: 'a', b: 'b' }], refs);
    } catch (error) {
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        message: 'Schedule conflict',
        error: 'Conflict',
        conflicts: [
          {
            kind: 'teacher',
            weekday: 1,
            date: null,
            period: 1,
            groupName: '1-А',
            subjectName: 'Математика',
            other: { groupName: '1-Б', period: 2, subjectName: 'Читання' },
          },
        ],
      });
    }
  });
});
```

`src/timetable/timetables.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, WeekParity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from './schedule.service';
import { TimetablesService } from './timetables.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');
const admin = { id: 'a1', role: Role.admin, login: 'admin', mustChangePassword: false };
const teacher = { id: 't1', role: Role.teacher, login: 't', mustChangePassword: false };
const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
];
const cls = { id: 'g1', name: '1-А', periods };
const entryDto = { weekday: 1, period: 1, subjectId: 's1', teacherId: 't1' };

const mockPrisma = {
  timetable: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  timetableEntry: { deleteMany: jest.fn(), createMany: jest.fn() },
  subgroup: { count: jest.fn() },
  subgroupMember: { findMany: jest.fn() },
  subject: { count: jest.fn() },
  room: { count: jest.fn() },
  user: { count: jest.fn() },
  group: { findUnique: jest.fn() },
  schoolLesson: { findMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockSchedule = { requireClass: jest.fn(), build: jest.fn(), describe: jest.fn(), throwConflicts: jest.fn() };
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('TimetablesService', () => {
  let service: TimetablesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        TimetablesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
      ],
    }).compile();
    service = moduleRef.get(TimetablesService);
    mockSchedule.requireClass.mockResolvedValue(cls);
    mockSchedule.throwConflicts.mockRejectedValue(new ConflictException('Schedule conflict'));
    mockPrisma.subject.count.mockResolvedValue(1);
    mockPrisma.room.count.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.subgroup.count.mockResolvedValue(0);
    mockPrisma.subgroupMember.findMany.mockResolvedValue([]);
    mockPrisma.timetable.findMany.mockResolvedValue([]);
    mockPrisma.timetable.create.mockResolvedValue({ id: 'v2', entries: [] });
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
  });

  it('closes the current version the day before the new one', async () => {
    mockPrisma.timetable.findMany
      .mockResolvedValueOnce([{ id: 'v1', validFrom: day('2026-09-01'), validTo: null }])
      .mockResolvedValueOnce([]);
    await service.create('g1', { validFrom: '2026-11-02', entries: [entryDto] }, admin);
    expect(mockPrisma.timetable.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { validTo: day('2026-11-01') } });
    expect(firstArg<{ data: { validFrom: Date; entries: { create: object[] } } }>(mockPrisma.timetable.create).data).toMatchObject({
      groupId: 'g1',
      validFrom: day('2026-11-02'),
      createdById: 'a1',
      entries: { create: [{ weekday: 1, period: 1, parity: WeekParity.every, subjectId: 's1', teacherId: 't1', roomId: null, subgroupId: null }] },
    });
  });

  it('rejects a version starting on or before an existing one', async () => {
    mockPrisma.timetable.findMany.mockResolvedValueOnce([{ id: 'v1', validFrom: day('2026-11-02'), validTo: null }]);
    await expect(service.create('g1', { validFrom: '2026-11-02', entries: [] }, admin)).rejects.toThrow(
      new BadRequestException('Timetable periods overlap'),
    );
  });

  it('validates periods, subgroups, subjects, rooms and teachers', async () => {
    await expect(service.create('g1', { validFrom: '2026-11-02', entries: [{ ...entryDto, period: 7 }] }, admin)).rejects.toThrow(
      new BadRequestException('Bell period not found'),
    );
    await expect(service.create('g1', { validFrom: '2026-11-02', entries: [{ ...entryDto, subgroupId: 'sg9' }] }, admin)).rejects.toThrow(
      new BadRequestException('Subgroup does not belong to this class'),
    );
    mockPrisma.user.count.mockResolvedValue(0);
    await expect(service.create('g1', { validFrom: '2026-11-02', entries: [entryDto] }, admin)).rejects.toThrow(
      new BadRequestException('User is not a teacher'),
    );
  });

  it('checks conflicts against other classes in overlapping versions by real time', async () => {
    mockPrisma.timetable.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'o1',
        groupId: 'g2',
        validFrom: day('2026-09-01'),
        validTo: null,
        group: { name: '1-Б', bellSchedule: { periods: [{ number: 2, startTime: '08:50', endTime: '09:35' }] } },
        entries: [{ id: 'oe1', weekday: 1, period: 2, parity: WeekParity.every, subjectId: 's2', teacherId: 't1', roomId: null, subgroupId: null }],
      },
    ]);
    await expect(service.create('g1', { validFrom: '2026-11-02', entries: [entryDto] }, admin)).rejects.toThrow(ConflictException);
    const [conflicts, refs] = mockSchedule.throwConflicts.mock.calls[0] as [object[], Map<string, object>];
    expect(conflicts).toEqual([{ kind: 'teacher', a: 'new-0', b: 'oe1' }]);
    expect(refs.get('oe1')).toEqual({ groupName: '1-Б', weekday: 1, date: null, period: 2, subjectId: 's2', isNew: false });
    expect(mockPrisma.timetable.create).not.toHaveBeenCalled();
  });

  it('edits entries only before the version starts', async () => {
    mockPrisma.timetable.findUnique.mockResolvedValue({ id: 'v2', groupId: 'g1', validFrom: day('2026-10-14'), validTo: null });
    await expect(service.replaceEntries('v2', { entries: [] }, TODAY)).rejects.toThrow(new BadRequestException('Timetable already started'));
    mockPrisma.timetable.findUnique.mockResolvedValueOnce({ id: 'v2', groupId: 'g1', validFrom: day('2026-10-15'), validTo: null }).mockResolvedValueOnce({ id: 'v2', entries: [] });
    await service.replaceEntries('v2', { entries: [entryDto] }, TODAY);
    expect(mockPrisma.timetableEntry.deleteMany).toHaveBeenCalledWith({ where: { timetableId: 'v2' } });
  });

  it('lets a teacher view a class schedule only when involved', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', name: '1-А', kind: 'school_class', teachers: [] });
    mockSchedule.build.mockResolvedValue([{ group: cls, days: [{ date: day('2026-10-12'), working: true, title: null, slots: [{ period: 1, startTime: '08:30', endTime: '09:15', subgroupId: null, subjectId: 's1', teacherId: 't9', roomId: null, source: 'timetable', cancelled: false, changeId: null }] }] }]);
    mockSchedule.describe.mockResolvedValue(() => ({ subjectName: 'Математика', teacherName: 'X Y', roomName: null, subgroupName: null }));
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
    await expect(service.view('g1', '2026-10-12', '2026-10-12', teacher)).rejects.toThrow(new ForbiddenException('Not your group'));
    await expect(service.view('g1', '2026-10-12', '2026-11-30', admin)).rejects.toThrow(new BadRequestException('Invalid period'));
    const view = await service.view('g1', '2026-10-12', '2026-10-12', admin);
    expect(view.days[0].slots[0]).toMatchObject({ subjectName: 'Математика', lessonId: null });
  });
});
```

`src/timetable/lesson-changes.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LessonChangeType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from './schedule.service';
import { LessonChangesService } from './lesson-changes.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const admin = { id: 'a1', role: Role.admin, login: 'admin', mustChangePassword: false };
const periods = [{ number: 1, startTime: '08:30', endTime: '09:15' }, { number: 2, startTime: '09:25', endTime: '10:10' }];
const slot = (over: Record<string, unknown> = {}) => ({ period: 1, startTime: '08:30', endTime: '09:15', subgroupId: null, subjectId: 's1', teacherId: 't1', roomId: null, source: 'timetable', cancelled: false, changeId: null, ...over });
const schedule = (groupId: string, slots: object[], working = true) => ({ group: { id: groupId, name: groupId, periods }, days: [{ date: day('2026-10-12'), working, title: null, slots }] });
const base = { date: '2026-10-12', period: 1, reason: 'хворіє' };

const mockPrisma = {
  subject: { count: jest.fn() },
  room: { count: jest.fn() },
  user: { count: jest.fn() },
  subgroup: { count: jest.fn() },
  subgroupMember: { findMany: jest.fn() },
  schoolLesson: { findUnique: jest.fn() },
  lessonChange: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
};
const mockSchedule = { requireClass: jest.fn(), build: jest.fn(), throwConflicts: jest.fn() };
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('LessonChangesService', () => {
  let service: LessonChangesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [LessonChangesService, { provide: PrismaService, useValue: mockPrisma }, { provide: ScheduleService, useValue: mockSchedule }],
    }).compile();
    service = moduleRef.get(LessonChangesService);
    mockSchedule.requireClass.mockResolvedValue({ id: 'g1', name: '1-А', periods });
    mockSchedule.build.mockResolvedValue([schedule('g1', [slot()])]);
    mockSchedule.throwConflicts.mockRejectedValue(new ConflictException('Schedule conflict'));
    mockPrisma.subject.count.mockResolvedValue(1);
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.room.count.mockResolvedValue(1);
    mockPrisma.subgroupMember.findMany.mockResolvedValue([]);
    mockPrisma.schoolLesson.findUnique.mockResolvedValue(null);
    mockPrisma.lessonChange.create.mockResolvedValue({ id: 'ch1', date: day('2026-10-12') });
  });

  it('cancels an existing lesson that has no marks', async () => {
    await service.create('g1', { ...base, type: LessonChangeType.cancel }, admin);
    expect(firstArg<{ data: object }>(mockPrisma.lessonChange.create).data).toMatchObject({ groupId: 'g1', date: day('2026-10-12'), period: 1, type: LessonChangeType.cancel, createdById: 'a1', reason: 'хворіє' });
  });

  it('rejects cancelling a recorded lesson and missing lessons', async () => {
    mockPrisma.schoolLesson.findUnique.mockResolvedValueOnce({ _count: { marks: 2 } });
    await expect(service.create('g1', { ...base, type: LessonChangeType.cancel }, admin)).rejects.toThrow(new BadRequestException('Lesson already recorded'));
    await expect(service.create('g1', { ...base, period: 2, type: LessonChangeType.cancel }, admin)).rejects.toThrow(new NotFoundException('Lesson not found'));
  });

  it('validates replace and extra payloads and non-working days', async () => {
    await expect(service.create('g1', { ...base, type: LessonChangeType.replace }, admin)).rejects.toThrow(new BadRequestException('Nothing to replace'));
    await expect(service.create('g1', { ...base, period: 2, type: LessonChangeType.extra, subjectId: 's1' }, admin)).rejects.toThrow(
      new BadRequestException('Subject and teacher are required'),
    );
    mockSchedule.build.mockResolvedValue([schedule('g1', [], false)]);
    await expect(service.create('g1', { ...base, type: LessonChangeType.cancel }, admin)).rejects.toThrow(new BadRequestException('Not a working day'));
  });

  it('rejects a replacement teacher busy in another class at that time', async () => {
    mockSchedule.build.mockResolvedValue([
      schedule('g1', [slot({ teacherId: 't2', source: 'replace', changeId: 'pending' })]),
      schedule('g2', [slot({ startTime: '09:00', endTime: '09:45', teacherId: 't2', period: 2 })]),
    ]);
    await expect(service.create('g1', { ...base, type: LessonChangeType.replace, teacherId: 't2' }, admin)).rejects.toThrow(ConflictException);
    const pending = (mockSchedule.build.mock.calls[1] as unknown[])[3] as { groupId: string; change: { id: string } };
    expect(pending).toMatchObject({ groupId: 'g1', change: { id: 'pending', type: LessonChangeType.replace, teacherId: 't2' } });
    expect(mockPrisma.lessonChange.create).not.toHaveBeenCalled();
  });

  it('voids a change once', async () => {
    mockPrisma.lessonChange.findUnique.mockResolvedValueOnce(null);
    await expect(service.void('c9', 'x', admin)).rejects.toThrow(new NotFoundException('Lesson change not found'));
    mockPrisma.lessonChange.findUnique.mockResolvedValueOnce({ id: 'c1', voidedAt: new Date() });
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(new BadRequestException('Lesson change is voided'));
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `npx jest src/timetable` → FAIL (modules missing).

- [ ] **Step 4: Implement `src/timetable/schedule.service.ts`**

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { dayInfo, dayRange } from '../attendance/register-calc';
import {
  type ChangeLike,
  type Conflict,
  type PeriodLike,
  type Slot,
  slotsForDay,
  versionOn,
} from './schedule-calc';

export const subgroupKey = (id: string | null): string => id ?? 'class';

export interface ScheduleDay {
  date: Date;
  working: boolean;
  title: string | null;
  slots: Slot[];
}

export interface ClassSchedule {
  group: { id: string; name: string; periods: PeriodLike[] };
  days: ScheduleDay[];
}

export interface PendingChange {
  groupId: string;
  change: ChangeLike & { date: Date };
}

export interface ConflictRef {
  groupName: string;
  weekday: number | null;
  date: string | null;
  period: number;
  subjectId: string;
  isNew: boolean;
}

const periodSelect = {
  select: { number: true, startTime: true, endTime: true },
  orderBy: { number: 'asc' },
} as const;

@Injectable()
export class ScheduleService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  async requireClass(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, kind: true, bellSchedule: { select: { periods: periodSelect } } },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.kind !== GroupKind.school_class)
      throw new BadRequestException('Not a school class');
    if (!group.bellSchedule) throw new BadRequestException('Class has no bell schedule');
    return { id: group.id, name: group.name, periods: group.bellSchedule.periods };
  }

  async build(
    from: Date,
    to: Date,
    groupIds?: string[],
    pending?: PendingChange,
  ): Promise<ClassSchedule[]> {
    const [groups, calendarEntries] = await Promise.all([
      this.prisma.group.findMany({
        where: {
          kind: GroupKind.school_class,
          ...(groupIds ? { id: { in: groupIds } } : {}),
        },
        select: {
          id: true,
          name: true,
          kind: true,
          bellSchedule: { select: { periods: periodSelect } },
          timetables: {
            where: {
              validFrom: { lte: to },
              OR: [{ validTo: null }, { validTo: { gte: from } }],
            },
            include: { entries: true },
          },
          lessonChanges: {
            where: { date: { gte: from, lte: to }, voidedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.calendar.entriesBetween(from, to),
    ]);
    const days = dayRange(from, to);
    return groups.map((group) => {
      const periods = group.bellSchedule?.periods ?? [];
      const changes: (ChangeLike & { date: Date })[] = [
        ...group.lessonChanges,
        ...(pending && pending.groupId === group.id ? [pending.change] : []),
      ];
      return {
        group: { id: group.id, name: group.name, periods },
        days: days.map((date) => {
          const info = dayInfo(date, group, calendarEntries);
          const version = versionOn(group.timetables, date);
          return {
            date,
            working: info.working,
            title: info.title,
            slots: slotsForDay(date, {
              working: info.working,
              entries: version?.entries ?? [],
              changes: changes.filter((c) => c.date.getTime() === date.getTime()),
              periods,
            }),
          };
        }),
      };
    });
  }

  async describe(slots: Slot[]) {
    const ids = (pick: (slot: Slot) => string | null) => [
      ...new Set(slots.map(pick).filter((v): v is string => !!v)),
    ];
    const [subjects, teachers, rooms, subgroups] = await Promise.all([
      this.prisma.subject.findMany({ where: { id: { in: ids((s) => s.subjectId) } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: ids((s) => s.teacherId) } }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.room.findMany({ where: { id: { in: ids((s) => s.roomId) } }, select: { id: true, name: true } }),
      this.prisma.subgroup.findMany({ where: { id: { in: ids((s) => s.subgroupId) } }, select: { id: true, name: true } }),
    ]);
    const find = <T extends { id: string }>(list: T[], id: string | null) =>
      id ? (list.find((x) => x.id === id) ?? null) : null;
    return (slot: Slot) => {
      const teacher = find(teachers, slot.teacherId);
      return {
        subjectName: find(subjects, slot.subjectId)?.name ?? null,
        teacherName: teacher ? `${teacher.lastName} ${teacher.firstName}` : null,
        roomName: find(rooms, slot.roomId)?.name ?? null,
        subgroupName: find(subgroups, slot.subgroupId)?.name ?? null,
      };
    };
  }

  async throwConflicts(conflicts: Conflict[], refs: Map<string, ConflictRef>): Promise<never> {
    const subjectIds = [...new Set([...refs.values()].map((r) => r.subjectId))];
    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true },
    });
    const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;
    throw new ConflictException({
      statusCode: 409,
      message: 'Schedule conflict',
      error: 'Conflict',
      conflicts: conflicts.map((c) => {
        const first = refs.get(c.a) as ConflictRef;
        const second = refs.get(c.b) as ConflictRef;
        const [own, other] = first.isNew ? [first, second] : [second, first];
        return {
          kind: c.kind,
          weekday: own.weekday,
          date: own.date,
          period: own.period,
          groupName: own.groupName,
          subjectName: subjectName(own.subjectId),
          other: { groupName: other.groupName, period: other.period, subjectName: subjectName(other.subjectId) },
        };
      }),
    });
  }
}
```

- [ ] **Step 5: Implement `src/timetable/timetables.service.ts`**

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, WeekParity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { addDays, dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { isAdmin } from './roles';
import { type ConflictItem, type EntryLike, type PeriodLike, findConflicts, toMinutes } from './schedule-calc';
import { type ConflictRef, ScheduleService, subgroupKey } from './schedule.service';
import { CreateTimetableDto, TimetableEntriesDto, TimetableEntryDto } from './dto/timetable.dto';

type ClassInfo = { id: string; name: string; periods: PeriodLike[] };

const toEntry = (dto: TimetableEntryDto): EntryLike => ({
  weekday: dto.weekday,
  period: dto.period,
  parity: dto.parity ?? WeekParity.every,
  subjectId: dto.subjectId,
  teacherId: dto.teacherId,
  roomId: dto.roomId ?? null,
  subgroupId: dto.subgroupId ?? null,
});

const unique = (values: (string | null | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))];

@Injectable()
export class TimetablesService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
  ) {}

  async list(groupId: string) {
    await this.schedule.requireClass(groupId);
    const versions = await this.prisma.timetable.findMany({
      where: { groupId },
      include: { entries: { orderBy: [{ weekday: 'asc' }, { period: 'asc' }] } },
      orderBy: { validFrom: 'asc' },
    });
    return versions.map((v) => ({
      ...v,
      validFrom: isoDay(v.validFrom),
      validTo: v.validTo ? isoDay(v.validTo) : null,
    }));
  }

  private async validateEntries(group: ClassInfo, entries: TimetableEntryDto[]) {
    const numbers = new Set(group.periods.map((p) => p.number));
    if (entries.some((e) => !numbers.has(e.period)))
      throw new BadRequestException('Bell period not found');
    const subgroupIds = unique(entries.map((e) => e.subgroupId));
    if (subgroupIds.length) {
      const count = await this.prisma.subgroup.count({ where: { id: { in: subgroupIds }, groupId: group.id } });
      if (count !== subgroupIds.length)
        throw new BadRequestException('Subgroup does not belong to this class');
    }
    const subjectIds = unique(entries.map((e) => e.subjectId));
    if (subjectIds.length && (await this.prisma.subject.count({ where: { id: { in: subjectIds }, active: true } })) !== subjectIds.length)
      throw new NotFoundException('Subject not found');
    const roomIds = unique(entries.map((e) => e.roomId));
    if (roomIds.length && (await this.prisma.room.count({ where: { id: { in: roomIds }, active: true } })) !== roomIds.length)
      throw new NotFoundException('Room not found');
    const teacherIds = unique(entries.map((e) => e.teacherId));
    if (
      teacherIds.length &&
      (await this.prisma.user.count({ where: { id: { in: teacherIds }, role: Role.teacher, isActive: true } })) !== teacherIds.length
    )
      throw new BadRequestException('User is not a teacher');
  }

  private async assertNoConflicts(
    group: ClassInfo,
    entries: EntryLike[],
    start: Date,
    end: Date | null,
  ) {
    const [others, members] = await Promise.all([
      this.prisma.timetable.findMany({
        where: {
          groupId: { not: group.id },
          ...(end ? { validFrom: { lte: end } } : {}),
          OR: [{ validTo: null }, { validTo: { gte: start } }],
        },
        include: {
          entries: true,
          group: { select: { name: true, bellSchedule: { select: { periods: true } } } },
        },
      }),
      this.prisma.subgroupMember.findMany({
        where: { subgroup: { groupId: group.id } },
        select: { subgroupId: true, childId: true },
      }),
    ]);
    const items: ConflictItem[] = [];
    const refs = new Map<string, ConflictRef>();
    const add = (ref: string, groupId: string, groupName: string, periods: PeriodLike[], e: EntryLike, isNew: boolean) => {
      const bell = periods.find((p) => p.number === e.period);
      if (!bell) return;
      refs.set(ref, { groupName, weekday: e.weekday, date: null, period: e.period, subjectId: e.subjectId, isNew });
      items.push({
        ref,
        bucket: String(e.weekday),
        parity: e.parity,
        start: toMinutes(bell.startTime),
        end: toMinutes(bell.endTime),
        groupId,
        teacherId: e.teacherId,
        roomId: e.roomId,
        subgroupId: e.subgroupId,
        memberIds:
          groupId === group.id && e.subgroupId
            ? members.filter((m) => m.subgroupId === e.subgroupId).map((m) => m.childId)
            : [],
        isNew,
      });
    };
    entries.forEach((e, i) => add(`new-${i}`, group.id, group.name, group.periods, e, true));
    for (const other of others) {
      for (const e of other.entries)
        add(e.id, other.groupId, other.group.name, other.group.bellSchedule?.periods ?? [], e, false);
    }
    const conflicts = findConflicts(items);
    if (conflicts.length) await this.schedule.throwConflicts(conflicts, refs);
  }

  async create(groupId: string, dto: CreateTimetableDto, user: AuthenticatedUser) {
    const group = await this.schedule.requireClass(groupId);
    const validFrom = parseDay(dto.validFrom);
    await this.validateEntries(group, dto.entries);
    const versions = await this.prisma.timetable.findMany({
      where: { groupId },
      orderBy: { validFrom: 'asc' },
    });
    if (versions.some((v) => v.validFrom.getTime() >= validFrom.getTime()))
      throw new BadRequestException('Timetable periods overlap');
    const entries = dto.entries.map(toEntry);
    await this.assertNoConflicts(group, entries, validFrom, null);
    const previous = versions[versions.length - 1];
    return this.prisma.$transaction(async (tx) => {
      if (previous && (previous.validTo === null || previous.validTo.getTime() >= validFrom.getTime())) {
        await tx.timetable.update({ where: { id: previous.id }, data: { validTo: addDays(validFrom, -1) } });
      }
      return tx.timetable.create({
        data: { groupId, validFrom, createdById: user.id, entries: { create: entries } },
        include: { entries: true },
      });
    });
  }

  async replaceEntries(id: string, dto: TimetableEntriesDto, today: Date = kyivToday()) {
    const version = await this.prisma.timetable.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Timetable not found');
    if (version.validFrom.getTime() <= today.getTime())
      throw new BadRequestException('Timetable already started');
    const group = await this.schedule.requireClass(version.groupId);
    await this.validateEntries(group, dto.entries);
    const entries = dto.entries.map(toEntry);
    await this.assertNoConflicts(group, entries, version.validFrom, version.validTo);
    return this.prisma.$transaction(async (tx) => {
      await tx.timetableEntry.deleteMany({ where: { timetableId: id } });
      await tx.timetableEntry.createMany({ data: entries.map((e) => ({ ...e, timetableId: id })) });
      return tx.timetable.findUnique({ where: { id }, include: { entries: true } });
    });
  }

  async view(groupId: string, fromValue: string, toValue: string, user: AuthenticatedUser) {
    const from = parseDay(fromValue);
    const to = parseDay(toValue);
    if (to.getTime() < from.getTime() || dayCount(from, to) > 31)
      throw new BadRequestException('Invalid period');
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, kind: true, teachers: { select: { id: true } } },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.kind !== 'school_class') throw new BadRequestException('Not a school class');
    const [schedule] = await this.schedule.build(from, to, [groupId]);
    const slots = schedule.days.flatMap((d) => d.slots);
    if (
      !isAdmin(user) &&
      !group.teachers.some((t) => t.id === user.id) &&
      !slots.some((s) => s.teacherId === user.id)
    )
      throw new ForbiddenException('Not your group');
    const [lessons, names] = await Promise.all([
      this.prisma.schoolLesson.findMany({
        where: { groupId, date: { gte: from, lte: to } },
        select: { id: true, date: true, period: true, subgroupKey: true },
      }),
      this.schedule.describe(slots),
    ]);
    return {
      group: { id: group.id, name: group.name },
      periods: schedule.group.periods,
      days: schedule.days.map((d) => ({
        date: isoDay(d.date),
        working: d.working,
        title: d.title,
        slots: d.slots.map((s) => ({
          ...s,
          ...names(s),
          lessonId:
            lessons.find(
              (l) =>
                l.date.getTime() === d.date.getTime() &&
                l.period === s.period &&
                l.subgroupKey === subgroupKey(s.subgroupId),
            )?.id ?? null,
        })),
      })),
    };
  }
}
```

(`Timetable not found` joins the spec error list. The test for "Invalid period" uses a 50-day range; for `Not your group` the teacher is neither class teacher nor teaching a slot.)

- [ ] **Step 6: Implement `src/timetable/lesson-changes.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LessonChangeType, Role, WeekParity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { isoDay } from '../tariffs/dates';
import { type ChangeLike, type ConflictItem, findConflicts, toMinutes } from './schedule-calc';
import { type ConflictRef, ScheduleService, subgroupKey } from './schedule.service';
import { CreateLessonChangeDto } from './dto/lesson-change.dto';

@Injectable()
export class LessonChangesService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
  ) {}

  private async validateRefs(groupId: string, dto: CreateLessonChangeDto) {
    if (dto.subgroupId && (await this.prisma.subgroup.count({ where: { id: dto.subgroupId, groupId } })) !== 1)
      throw new BadRequestException('Subgroup does not belong to this class');
    if (dto.subjectId && (await this.prisma.subject.count({ where: { id: dto.subjectId, active: true } })) !== 1)
      throw new NotFoundException('Subject not found');
    if (dto.roomId && (await this.prisma.room.count({ where: { id: dto.roomId, active: true } })) !== 1)
      throw new NotFoundException('Room not found');
    if (dto.teacherId && (await this.prisma.user.count({ where: { id: dto.teacherId, role: Role.teacher, isActive: true } })) !== 1)
      throw new BadRequestException('User is not a teacher');
  }

  async create(groupId: string, dto: CreateLessonChangeDto, user: AuthenticatedUser) {
    const group = await this.schedule.requireClass(groupId);
    const date = parseDay(dto.date);
    if (!group.periods.some((p) => p.number === dto.period))
      throw new BadRequestException('Bell period not found');
    await this.validateRefs(groupId, dto);
    if (dto.type === LessonChangeType.replace && !dto.subjectId && !dto.teacherId && !dto.roomId)
      throw new BadRequestException('Nothing to replace');
    if (dto.type === LessonChangeType.extra && (!dto.subjectId || !dto.teacherId))
      throw new BadRequestException('Subject and teacher are required');
    const [schedule] = await this.schedule.build(date, date, [groupId]);
    const day = schedule.days[0];
    if (!day.working) throw new BadRequestException('Not a working day');
    const subgroupId = dto.subgroupId ?? null;
    const target = day.slots.find((s) => !s.cancelled && s.period === dto.period && s.subgroupId === subgroupId);
    if (dto.type !== LessonChangeType.extra && !target) throw new NotFoundException('Lesson not found');
    const change: ChangeLike = {
      id: 'pending',
      period: dto.period,
      subgroupId,
      type: dto.type,
      subjectId: dto.subjectId ?? null,
      teacherId: dto.teacherId ?? null,
      roomId: dto.roomId ?? null,
      voidedAt: null,
    };
    if (dto.type === LessonChangeType.cancel) {
      const recorded = await this.prisma.schoolLesson.findUnique({
        where: { groupId_date_period_subgroupKey: { groupId, date, period: dto.period, subgroupKey: subgroupKey(subgroupId) } },
        select: { _count: { select: { marks: { where: { voidedAt: null } } } } },
      });
      if (recorded && recorded._count.marks > 0) throw new BadRequestException('Lesson already recorded');
    } else {
      await this.assertNoConflicts(group.id, date, change);
    }
    const created = await this.prisma.lessonChange.create({
      data: {
        groupId,
        date,
        period: dto.period,
        subgroupId,
        type: dto.type,
        subjectId: change.subjectId,
        teacherId: change.teacherId,
        roomId: change.roomId,
        reason: dto.reason.trim(),
        createdById: user.id,
      },
    });
    return { ...created, date: isoDay(created.date) };
  }

  private async assertNoConflicts(groupId: string, date: Date, change: ChangeLike) {
    const [schedules, members] = await Promise.all([
      this.schedule.build(date, date, undefined, { groupId, change: { ...change, date } }),
      this.prisma.subgroupMember.findMany({
        where: { subgroup: { groupId } },
        select: { subgroupId: true, childId: true },
      }),
    ]);
    const items: ConflictItem[] = [];
    const refs = new Map<string, ConflictRef>();
    for (const schedule of schedules) {
      schedule.days[0].slots.forEach((slot, i) => {
        if (slot.cancelled || !slot.startTime) return;
        const ref = `${schedule.group.id}:${i}`;
        const isNew = schedule.group.id === groupId && slot.changeId === 'pending';
        refs.set(ref, { groupName: schedule.group.name, weekday: null, date: isoDay(date), period: slot.period, subjectId: slot.subjectId, isNew });
        items.push({
          ref,
          bucket: 'day',
          parity: WeekParity.every,
          start: toMinutes(slot.startTime),
          end: toMinutes(slot.endTime),
          groupId: schedule.group.id,
          teacherId: slot.teacherId,
          roomId: slot.roomId,
          subgroupId: slot.subgroupId,
          memberIds:
            schedule.group.id === groupId && slot.subgroupId
              ? members.filter((m) => m.subgroupId === slot.subgroupId).map((m) => m.childId)
              : [],
          isNew,
        });
      });
    }
    const conflicts = findConflicts(items);
    if (conflicts.length) await this.schedule.throwConflicts(conflicts, refs);
  }

  async void(id: string, reason: string, user: AuthenticatedUser) {
    const change = await this.prisma.lessonChange.findUnique({ where: { id } });
    if (!change) throw new NotFoundException('Lesson change not found');
    if (change.voidedAt) throw new BadRequestException('Lesson change is voided');
    const updated = await this.prisma.lessonChange.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason.trim() },
    });
    return { ...updated, date: isoDay(updated.date) };
  }
}
```

- [ ] **Step 7: Controllers and module**

`src/timetable/timetables.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { TimetablesService } from './timetables.service';
import { CreateTimetableDto, TimetableEntriesDto } from './dto/timetable.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class TimetablesController {
  constructor(private timetables: TimetablesService) {}

  @Get('groups/:id/timetables')
  list(@Param('id') id: string) {
    return this.timetables.list(id);
  }

  @Post('groups/:id/timetables')
  create(@Param('id') id: string, @Body() dto: CreateTimetableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetables.create(id, dto, user);
  }

  @Put('timetables/:id/entries')
  replace(@Param('id') id: string, @Body() dto: TimetableEntriesDto) {
    return this.timetables.replaceEntries(id, dto);
  }

  @Get('groups/:id/schedule')
  @Roles(Role.root, Role.admin, Role.teacher)
  view(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetables.view(id, from, to, user);
  }
}
```

`src/timetable/lesson-changes.controller.ts`:

```ts
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ReasonDto } from '../attendance/dto/reason.dto';
import { LessonChangesService } from './lesson-changes.service';
import { CreateLessonChangeDto } from './dto/lesson-change.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class LessonChangesController {
  constructor(private changes: LessonChangesService) {}

  @Post('groups/:id/lesson-changes')
  create(@Param('id') id: string, @Body() dto: CreateLessonChangeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.changes.create(id, dto, user);
  }

  @Post('lesson-changes/:id/void')
  void(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.changes.void(id, dto.reason, user);
  }
}
```

Module: add `TimetablesController`, `LessonChangesController` to controllers and `ScheduleService`, `TimetablesService`, `LessonChangesService` to providers.

- [ ] **Step 8: Verify and commit**

Run: `npx jest src/timetable` → PASS; full `npx jest`; `npm run build`; eslint --fix on touched files.

```bash
git add src/timetable
git commit -m "feat: add timetable versions, lesson changes and conflict checks"
```

---

### Task 5: Lessons — my lessons, lesson view, lesson save

**Files:**
- Create: `src/timetable/dto/save-lesson.dto.ts`, `src/timetable/lessons.service.ts`, `src/timetable/lessons.service.spec.ts`, `src/timetable/lessons.controller.ts`
- Modify: `src/timetable/timetable.module.ts`

**Interfaces:**
- Consumes: `ScheduleService.build/describe`, `subgroupKey` (Task 4); `pupilState` (Task 2); `RegisterService.childDays(childIds, from, to)` (returns `{ childId, days: { date, state, reasonId, ... }[] }[]`) and `RegisterService.getEditDays()` (attendance); `isAdmin`.
- Produces: routes `GET /me/lessons?date&teacherId`, `GET/PUT /groups/:id/lessons/:date/:period?subgroupId=`. Lesson view shape: `{ group: { id, name }, date, slot: Slot & names, lesson: { id, topic, homework } | null, canEdit, needsReason, pupils: { child: { id, firstName, lastName, middleName }, state: PupilState, mark: { id, status, reasonId, level, comment } | null, dayState, dayReasonId }[] }`.

- [ ] **Step 1: DTO `src/timetable/dto/save-lesson.dto.ts`**

```ts
import { LessonStatus, NushLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class LessonMarkDto {
  @IsUUID('4')
  childId: string;

  @IsEnum(LessonStatus)
  status: LessonStatus;

  @IsUUID('4')
  @IsOptional()
  reasonId?: string;

  @IsEnum(NushLevel)
  @IsOptional()
  level?: NushLevel;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  comment?: string;
}

export class SaveLessonDto {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  topic?: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  homework?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LessonMarkDto)
  marks: LessonMarkDto[];
}
```

- [ ] **Step 2: Failing tests `src/timetable/lessons.service.spec.ts`**

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LessonStatus, NushLevel, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterService } from '../attendance/register.service';
import { ScheduleService } from './schedule.service';
import { LessonsService } from './lessons.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');
const admin = { id: 'a1', role: Role.admin, login: 'admin', mustChangePassword: false };
const teacher = { id: 't1', role: Role.teacher, login: 't1', mustChangePassword: false };
const substitute = { id: 't2', role: Role.teacher, login: 't2', mustChangePassword: false };
const slot = (over: Record<string, unknown> = {}) => ({ period: 1, startTime: '08:30', endTime: '09:15', subgroupId: null, subjectId: 's1', teacherId: 't1', roomId: null, source: 'timetable', cancelled: false, changeId: null, ...over });
const schedule = (slots: object[], date = day('2026-10-14')) => [{ group: { id: 'g1', name: '1-А', periods: [] }, days: [{ date, working: true, title: null, slots }] }];
const kid = (id: string) => ({ id, firstName: id, lastName: id, middleName: null });
const dayRow = (childId: string, state: string, reasonId: string | null = null) => ({ childId, days: [{ date: TODAY, state, reasonId }] });

const mockPrisma = {
  child: { findMany: jest.fn() },
  subgroupMember: { findMany: jest.fn() },
  schoolLesson: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  lessonMark: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  absenceReason: { count: jest.fn() },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockSchedule = { build: jest.fn(), describe: jest.fn() };
const mockRegister = { childDays: jest.fn(), getEditDays: jest.fn() };
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('LessonsService', () => {
  let service: LessonsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
        { provide: RegisterService, useValue: mockRegister },
      ],
    }).compile();
    service = moduleRef.get(LessonsService);
    mockSchedule.build.mockResolvedValue(schedule([slot()]));
    mockSchedule.describe.mockResolvedValue(() => ({ subjectName: 'Математика', teacherName: 'Коваль Олена', roomName: null, subgroupName: null }));
    mockPrisma.child.findMany.mockImplementation((args: { where: { id?: object } }) =>
      Promise.resolve(args.where.id ? [kid('c1'), kid('c2')] : [{ id: 'c1' }, { id: 'c2' }]),
    );
    mockPrisma.subgroupMember.findMany.mockResolvedValue([]);
    mockPrisma.schoolLesson.findUnique.mockResolvedValue(null);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
    mockPrisma.lessonMark.findMany.mockResolvedValue([]);
    mockPrisma.absenceReason.count.mockResolvedValue(1);
    mockRegister.childDays.mockResolvedValue([dayRow('c1', 'absent', 'sick'), dayRow('c2', 'present')]);
    mockRegister.getEditDays.mockResolvedValue(3);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'L1' }]);
  });

  it('lists my lessons including replacements and skipping cancelled ones', async () => {
    mockSchedule.build.mockResolvedValue([
      { group: { id: 'g1', name: '1-А', periods: [] }, days: [{ date: TODAY, working: true, title: null, slots: [slot(), slot({ period: 2, cancelled: true })] }] },
      { group: { id: 'g2', name: '1-Б', periods: [] }, days: [{ date: TODAY, working: true, title: null, slots: [slot({ period: 3, teacherId: 't1', source: 'replace' }), slot({ period: 4, teacherId: 't9' })] }] },
    ]);
    const view = await service.myLessons(teacher, '2026-10-14');
    expect(view.lessons.map((l) => [l.group.name, l.period, l.source])).toEqual([
      ['1-А', 1, 'timetable'],
      ['1-Б', 3, 'replace'],
    ]);
  });

  it('lets only the effective teacher open a lesson', async () => {
    mockSchedule.build.mockResolvedValue(schedule([slot({ teacherId: 't2', source: 'replace' })]));
    await expect(service.view('g1', '2026-10-14', 1, null, teacher, TODAY)).rejects.toThrow(new ForbiddenException('Not your lesson'));
    await expect(service.view('g1', '2026-10-14', 1, null, substitute, TODAY)).resolves.toBeDefined();
    await expect(service.view('g1', '2026-10-14', 2, null, admin, TODAY)).rejects.toThrow(new NotFoundException('Lesson not found'));
  });

  it('shows register absences on the lesson and lets a lesson mark win', async () => {
    mockPrisma.schoolLesson.findUnique.mockResolvedValue({
      id: 'L1',
      topic: 'Додавання',
      homework: null,
      marks: [{ id: 'm1', childId: 'c2', status: LessonStatus.late, reasonId: null, level: NushLevel.with_help, comment: 'молодець', voidedAt: null }],
    });
    const view = await service.view('g1', '2026-10-14', 1, null, teacher, TODAY);
    expect(view.lesson).toEqual({ id: 'L1', topic: 'Додавання', homework: null });
    expect(view.pupils[0]).toMatchObject({ child: { id: 'c1' }, state: { status: LessonStatus.absent, reasonId: 'sick', source: 'register' }, mark: null });
    expect(view.pupils[1]).toMatchObject({ state: { status: LessonStatus.late, source: 'mark' }, mark: { level: NushLevel.with_help, comment: 'молодець' } });
    expect(view).toMatchObject({ canEdit: true, needsReason: false });
  });

  it('uses subgroup members still in the class for a subgroup lesson', async () => {
    mockSchedule.build.mockResolvedValue(schedule([slot({ subgroupId: 'sg1' })]));
    mockPrisma.subgroupMember.findMany.mockResolvedValue([{ childId: 'c2' }]);
    await service.view('g1', '2026-10-14', 1, 'sg1', teacher, TODAY);
    expect(firstArg<{ where: object }>(mockPrisma.subgroupMember.findMany).where).toEqual({ subgroupId: 'sg1', child: { groupId: 'g1' } });
    expect(mockRegister.childDays).toHaveBeenCalledWith(['c2'], day('2026-10-14'), day('2026-10-14'));
  });

  describe('save', () => {
    beforeEach(() => {
      jest.spyOn(service, 'view').mockResolvedValue({} as Awaited<ReturnType<LessonsService['view']>>);
    });

    it('rejects future lessons, closed windows and missing reasons', async () => {
      mockSchedule.build.mockResolvedValue(schedule([slot()], day('2026-10-15')));
      await expect(service.save('g1', '2026-10-15', 1, null, { marks: [] }, teacher, TODAY)).rejects.toThrow(new BadRequestException('Cannot mark future days'));
      mockSchedule.build.mockResolvedValue(schedule([slot()], day('2026-10-09')));
      await expect(service.save('g1', '2026-10-09', 1, null, { marks: [] }, teacher, TODAY)).rejects.toThrow(new ForbiddenException('Edit window has passed'));
      await expect(service.save('g1', '2026-10-09', 1, null, { marks: [] }, admin, TODAY)).rejects.toThrow(new BadRequestException('Reason is required'));
    });

    it('validates marks', async () => {
      await expect(service.save('g1', '2026-10-14', 1, null, { marks: [{ childId: 'c1', status: LessonStatus.present, reasonId: 'sick' }] }, teacher, TODAY)).rejects.toThrow(
        new BadRequestException('Reason is only allowed for absences'),
      );
      await expect(service.save('g1', '2026-10-14', 1, null, { marks: [{ childId: 'c1', status: LessonStatus.absent, level: NushLevel.independent }] }, teacher, TODAY)).rejects.toThrow(
        new BadRequestException('Level is only allowed for present students'),
      );
      await expect(service.save('g1', '2026-10-14', 1, null, { marks: [{ childId: 'c9', status: LessonStatus.present }] }, teacher, TODAY)).rejects.toThrow(
        new BadRequestException('Child is not in this subgroup'),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the lesson, locks pupils, skips unchanged marks and voids changed ones', async () => {
      mockPrisma.lessonMark.findMany.mockResolvedValue([
        { id: 'm1', childId: 'c1', status: LessonStatus.present, reasonId: null, level: null, comment: null, voidedAt: null },
        { id: 'm2', childId: 'c2', status: LessonStatus.present, reasonId: null, level: null, comment: null, voidedAt: null },
      ]);
      await service.save(
        'g1',
        '2026-10-14',
        1,
        null,
        { topic: ' Додавання ', marks: [{ childId: 'c1', status: LessonStatus.present }, { childId: 'c2', status: LessonStatus.present, level: NushLevel.independent, comment: ' добре ' }] },
        teacher,
        TODAY,
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.schoolLesson.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { topic: 'Додавання', homework: undefined } });
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(mockPrisma.lessonMark.findMany.mock.invocationCallOrder[0]);
      expect(mockPrisma.lessonMark.update).toHaveBeenCalledTimes(1);
      expect(firstArg<{ where: { id: string }; data: { voidReason: string } }>(mockPrisma.lessonMark.update)).toMatchObject({ where: { id: 'm2' }, data: { voidReason: 'Corrected' } });
      expect(firstArg<{ data: object }>(mockPrisma.lessonMark.create).data).toEqual({
        lessonId: 'L1',
        childId: 'c2',
        status: LessonStatus.present,
        reasonId: null,
        level: NushLevel.independent,
        comment: 'добре',
        markedById: 't1',
      });
    });
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `npx jest src/timetable/lessons.service.spec.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `src/timetable/lessons.service.ts`**

```ts
import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LessonStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { RegisterService } from '../attendance/register.service';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { isAdmin } from './roles';
import { type Slot, pupilState } from './schedule-calc';
import { ScheduleService, subgroupKey } from './schedule.service';
import { SaveLessonDto } from './dto/save-lesson.dto';

const time = (day: Date) => day.getTime();

@Injectable()
export class LessonsService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
    private register: RegisterService,
  ) {}

  async myLessons(user: AuthenticatedUser, dateValue: string, teacherId?: string) {
    const date = parseDay(dateValue);
    const target = isAdmin(user) && teacherId ? teacherId : user.id;
    const schedules = await this.schedule.build(date, date);
    const rows = schedules.flatMap((s) =>
      s.days[0].slots
        .filter((slot) => !slot.cancelled && slot.teacherId === target)
        .map((slot) => ({ group: { id: s.group.id, name: s.group.name }, slot })),
    );
    const [names, lessons] = await Promise.all([
      this.schedule.describe(rows.map((r) => r.slot)),
      this.prisma.schoolLesson.findMany({
        where: { date, groupId: { in: rows.map((r) => r.group.id) } },
        select: { id: true, groupId: true, period: true, subgroupKey: true },
      }),
    ]);
    return {
      date: isoDay(date),
      lessons: rows
        .sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime) || a.group.name.localeCompare(b.group.name))
        .map((r) => ({
          group: r.group,
          ...r.slot,
          ...names(r.slot),
          lessonId:
            lessons.find(
              (l) => l.groupId === r.group.id && l.period === r.slot.period && l.subgroupKey === subgroupKey(r.slot.subgroupId),
            )?.id ?? null,
        })),
    };
  }

  private async locate(groupId: string, dateValue: string, period: number, subgroupId: string | null, user: AuthenticatedUser) {
    const date = parseDay(dateValue);
    const [schedule] = await this.schedule.build(date, date, [groupId]);
    const slot = schedule?.days[0].slots.find(
      (s) => !s.cancelled && s.period === period && s.subgroupId === subgroupId,
    );
    if (!schedule || !slot) throw new NotFoundException('Lesson not found');
    if (!isAdmin(user) && slot.teacherId !== user.id) throw new ForbiddenException('Not your lesson');
    return { date, slot, group: schedule.group };
  }

  private async pupilIds(groupId: string, slot: Slot, lessonId: string | null) {
    const base = slot.subgroupId
      ? (
          await this.prisma.subgroupMember.findMany({
            where: { subgroupId: slot.subgroupId, child: { groupId } },
            select: { childId: true },
          })
        ).map((m) => m.childId)
      : (await this.prisma.child.findMany({ where: { groupId }, select: { id: true } })).map((c) => c.id);
    const marked = lessonId
      ? (
          await this.prisma.lessonMark.findMany({
            where: { lessonId, voidedAt: null },
            select: { childId: true },
          })
        ).map((m) => m.childId)
      : [];
    return [...new Set([...base, ...marked])];
  }

  private lessonKey(groupId: string, date: Date, period: number, slot: Slot) {
    return { groupId_date_period_subgroupKey: { groupId, date, period, subgroupKey: subgroupKey(slot.subgroupId) } };
  }

  async view(
    groupId: string,
    dateValue: string,
    period: number,
    subgroupId: string | null,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const { date, slot, group } = await this.locate(groupId, dateValue, period, subgroupId, user);
    const lesson = await this.prisma.schoolLesson.findUnique({
      where: this.lessonKey(groupId, date, period, slot),
      include: { marks: { where: { voidedAt: null } } },
    });
    const ids = await this.pupilIds(groupId, slot, lesson?.id ?? null);
    const [children, dayRows, editDays, names] = await Promise.all([
      this.prisma.child.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true, middleName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.register.childDays(ids, date, date),
      this.register.getEditDays(),
      this.schedule.describe([slot]),
    ]);
    const inWindow = time(date) >= time(addDays(today, -editDays));
    return {
      group: { id: group.id, name: group.name },
      date: isoDay(date),
      slot: { ...slot, ...names(slot) },
      lesson: lesson && { id: lesson.id, topic: lesson.topic, homework: lesson.homework },
      canEdit: time(date) <= time(today) && (isAdmin(user) || inWindow),
      needsReason: isAdmin(user) && !inWindow,
      pupils: children.map((child) => {
        const dayState = dayRows.find((r) => r.childId === child.id)?.days[0] ?? null;
        const mark = lesson?.marks.find((m) => m.childId === child.id) ?? null;
        return {
          child,
          state: pupilState(dayState?.state ?? null, dayState?.reasonId ?? null, mark),
          mark: mark && { id: mark.id, status: mark.status, reasonId: mark.reasonId, level: mark.level, comment: mark.comment },
          dayState: dayState?.state ?? null,
          dayReasonId: dayState?.reasonId ?? null,
        };
      }),
    };
  }

  async save(
    groupId: string,
    dateValue: string,
    period: number,
    subgroupId: string | null,
    dto: SaveLessonDto,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const { date, slot } = await this.locate(groupId, dateValue, period, subgroupId, user);
    if (time(date) > time(today)) throw new BadRequestException('Cannot mark future days');
    const editDays = await this.register.getEditDays();
    const reason = dto.reason?.trim() || null;
    if (time(date) < time(addDays(today, -editDays))) {
      if (!isAdmin(user)) throw new ForbiddenException('Edit window has passed');
      if (!reason) throw new BadRequestException('Reason is required');
    }
    const ids = dto.marks.map((m) => m.childId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate child in marks');
    for (const m of dto.marks) {
      if (m.status !== LessonStatus.absent && m.reasonId)
        throw new BadRequestException('Reason is only allowed for absences');
      if (m.status === LessonStatus.absent && m.level)
        throw new BadRequestException('Level is only allowed for present students');
    }
    const existing = await this.prisma.schoolLesson.findUnique({
      where: this.lessonKey(groupId, date, period, slot),
      include: { marks: { where: { voidedAt: null } } },
    });
    const allowed = new Set(await this.pupilIds(groupId, slot, existing?.id ?? null));
    if (ids.some((id) => !allowed.has(id))) throw new BadRequestException('Child is not in this subgroup');
    const kept = new Set(
      dto.marks
        .filter((m) => m.reasonId && existing?.marks.some((e) => e.childId === m.childId && e.reasonId === m.reasonId))
        .map((m) => m.reasonId as string),
    );
    const fresh = [...new Set(dto.marks.flatMap((m) => (m.reasonId && !kept.has(m.reasonId) ? [m.reasonId] : [])))];
    if (fresh.length) {
      const found = await this.prisma.absenceReason.count({ where: { id: { in: fresh }, active: true } });
      if (found !== fresh.length) throw new BadRequestException('Absence reason not found');
    }
    const key = subgroupKey(slot.subgroupId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "SchoolLesson" ("id", "groupId", "date", "period", "subgroupKey", "subgroupId", "subjectId", "teacherId", "roomId", "conductedById", "updatedAt") VALUES (${randomUUID()}, ${groupId}, ${date}::date, ${period}, ${key}, ${slot.subgroupId}, ${slot.subjectId}, ${slot.teacherId}, ${slot.roomId}, ${user.id}, NOW()) ON CONFLICT ("groupId", "date", "period", "subgroupKey") DO NOTHING`;
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SchoolLesson" WHERE "groupId" = ${groupId} AND "date" = ${date}::date AND "period" = ${period} AND "subgroupKey" = ${key} FOR UPDATE`;
      const lessonId = locked[0].id;
      if (dto.topic !== undefined || dto.homework !== undefined) {
        await tx.schoolLesson.update({
          where: { id: lessonId },
          data: {
            topic: dto.topic === undefined ? undefined : dto.topic.trim() || null,
            homework: dto.homework === undefined ? undefined : dto.homework.trim() || null,
          },
        });
      }
      if (!ids.length) return;
      await tx.$queryRaw`SELECT id FROM "Child" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const active = await tx.lessonMark.findMany({ where: { lessonId, childId: { in: ids }, voidedAt: null } });
      const now = new Date();
      for (const m of dto.marks) {
        const next = {
          status: m.status,
          reasonId: m.reasonId ?? null,
          level: m.level ?? null,
          comment: m.comment?.trim() || null,
        };
        const current = active.find((a) => a.childId === m.childId);
        if (
          current &&
          current.status === next.status &&
          current.reasonId === next.reasonId &&
          current.level === next.level &&
          current.comment === next.comment
        )
          continue;
        if (current) {
          await tx.lessonMark.update({
            where: { id: current.id },
            data: { voidedAt: now, voidedById: user.id, voidReason: reason ?? 'Corrected' },
          });
        }
        await tx.lessonMark.create({ data: { lessonId, childId: m.childId, ...next, markedById: user.id } });
      }
    });
    return this.view(groupId, dateValue, period, slot.subgroupId, user, today);
  }
}
```

(In the save test the first `$queryRaw` call is the lesson lock and the second is the children lock, so `invocationCallOrder[1]` is compared with the marks read.)

- [ ] **Step 5: Controller `src/timetable/lessons.controller.ts`**

```ts
import { Body, Controller, Get, Param, ParseIntPipe, Put, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { LessonsService } from './lessons.service';
import { SaveLessonDto } from './dto/save-lesson.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller()
export class LessonsController {
  constructor(private lessons: LessonsService) {}

  @Get('me/lessons')
  my(
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return this.lessons.myLessons(user, date, teacherId);
  }

  @Get('groups/:id/lessons/:date/:period')
  view(
    @Param('id') id: string,
    @Param('date') date: string,
    @Param('period', ParseIntPipe) period: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query('subgroupId') subgroupId?: string,
  ) {
    return this.lessons.view(id, date, period, subgroupId ?? null, user);
  }

  @Put('groups/:id/lessons/:date/:period')
  save(
    @Param('id') id: string,
    @Param('date') date: string,
    @Param('period', ParseIntPipe) period: number,
    @Body() dto: SaveLessonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('subgroupId') subgroupId?: string,
  ) {
    return this.lessons.save(id, date, period, subgroupId ?? null, dto, user);
  }
}
```

Add `LessonsController` and `LessonsService` to the module.

- [ ] **Step 6: Verify and commit**

Run: `npx jest src/timetable` → PASS; full `npx jest`; `npm run build`; eslint --fix on touched files.

```bash
git add src/timetable
git commit -m "feat: add school lessons with attendance, topics and NUSH levels"
```

---

### Task 6: Parent views, delete guards, docs and live check

**Files:**
- Create: `src/timetable/parent-timetable.service.ts`, `src/timetable/parent-timetable.service.spec.ts`, `src/timetable/parent-timetable.controller.ts`
- Modify: `src/timetable/timetable.module.ts`, `src/groups/groups.service.ts`, `src/groups/groups.service.spec.ts`, `src/children/children.service.ts`, `src/children/children.service.spec.ts`, `src/users/users.service.ts`, `src/users/users.service.spec.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `ScheduleService.build/describe`, `subgroupKey`, `pupilState`, `RegisterService.childDays`, `assertOwnChild` (`src/common/ownership.ts`), `parseMonth`, `parseDay`, `kyivToday`.
- Produces: `GET /me/children/:id/schedule?from&to` → `{ days: { date, working, title, slots: { period, startTime, endTime, subjectName, teacherName, roomName, subgroupName, cancelled, replaced, extra, topic, homework }[] }[] }`; `GET /me/children/:id/lessons?month=` → `{ month, lessons: { date, period, subjectName, status, reasonName, level, comment, source }[], summary: { missed, missedExcused, bySubject: { subjectName, levels: Record<NushLevel, number> }[] } }`.

- [ ] **Step 1: Failing tests `src/timetable/parent-timetable.service.spec.ts`**

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind, LessonStatus, NushLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterService } from '../attendance/register.service';
import { ScheduleService } from './schedule.service';
import { ParentTimetableService } from './parent-timetable.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const slot = (over: Record<string, unknown> = {}) => ({ period: 1, startTime: '08:30', endTime: '09:15', subgroupId: null, subjectId: 's1', teacherId: 't1', roomId: null, source: 'timetable', cancelled: false, changeId: null, ...over });

const mockPrisma = {
  child: { findFirst: jest.fn(), findUnique: jest.fn() },
  schoolLesson: { findMany: jest.fn() },
  absenceReason: { findMany: jest.fn() },
  subject: { findMany: jest.fn() },
};
const mockSchedule = { build: jest.fn(), describe: jest.fn() };
const mockRegister = { childDays: jest.fn() };

describe('ParentTimetableService', () => {
  let service: ParentTimetableService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ParentTimetableService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ScheduleService, useValue: mockSchedule },
        { provide: RegisterService, useValue: mockRegister },
      ],
    }).compile();
    service = moduleRef.get(ParentTimetableService);
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.child.findUnique.mockResolvedValue({ groupId: 'g1', group: { kind: GroupKind.school_class }, subgroupMemberships: [{ subgroupId: 'sg1' }] });
    mockSchedule.describe.mockResolvedValue((s: { subjectId: string }) => ({ subjectName: s.subjectId, teacherName: 'Коваль Олена', roomName: null, subgroupName: null }));
    mockPrisma.schoolLesson.findMany.mockResolvedValue([]);
  });

  it('hides a foreign child', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(service.schedule('p1', 'c9', '2026-10-12', '2026-10-18')).rejects.toThrow(new NotFoundException('Child not found'));
    await expect(service.lessons('p1', 'c9', '2026-10')).rejects.toThrow(new NotFoundException('Child not found'));
  });

  it('shows only the whole class and own subgroups with homework', async () => {
    mockSchedule.build.mockResolvedValue([
      { group: { id: 'g1', name: '1-А', periods: [] }, days: [{ date: day('2026-10-12'), working: true, title: null, slots: [slot(), slot({ period: 2, subgroupId: 'sg1', subjectId: 'eng' }), slot({ period: 2, subgroupId: 'sg2', subjectId: 'eng2' }), slot({ period: 3, cancelled: true })] }] },
    ]);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([{ date: day('2026-10-12'), period: 1, subgroupKey: 'class', topic: 'Додавання', homework: 'с. 12' }]);
    const view = await service.schedule('p1', 'c1', '2026-10-12', '2026-10-12');
    expect(view.days[0].slots.map((s) => [s.period, s.subjectName, s.cancelled, s.homework])).toEqual([
      [1, 's1', false, 'с. 12'],
      [2, 'eng', false, null],
      [3, 's1', true, null],
    ]);
  });

  it('returns an empty schedule for a kindergarten child', async () => {
    mockPrisma.child.findUnique.mockResolvedValue({ groupId: 'g5', group: { kind: GroupKind.kindergarten }, subgroupMemberships: [] });
    await expect(service.schedule('p1', 'c1', '2026-10-12', '2026-10-18')).resolves.toEqual({ days: [] });
  });

  it('lists lesson attendance up to today with register absences and levels by subject', async () => {
    mockSchedule.build.mockResolvedValue([
      { group: { id: 'g1', name: '1-А', periods: [] }, days: [
        { date: day('2026-10-12'), working: true, title: null, slots: [slot(), slot({ period: 2, subjectId: 's2' })] },
        { date: day('2026-10-13'), working: true, title: null, slots: [slot()] },
      ] },
    ]);
    mockPrisma.schoolLesson.findMany.mockResolvedValue([
      { date: day('2026-10-12'), period: 1, subgroupKey: 'class', subjectId: 's1', marks: [{ status: LessonStatus.present, reasonId: null, level: NushLevel.independent, comment: 'молодець', voidedAt: null }] },
    ]);
    mockRegister.childDays.mockResolvedValue([{ childId: 'c1', days: [
      { date: day('2026-10-12'), state: 'present', reasonId: null },
      { date: day('2026-10-13'), state: 'absent', reasonId: 'sick' },
    ] }]);
    mockPrisma.absenceReason.findMany.mockResolvedValue([{ id: 'sick', name: 'Хвороба', excused: true }]);
    mockPrisma.subject.findMany.mockResolvedValue([{ id: 's1', name: 'Математика' }, { id: 's2', name: 'Читання' }]);
    const view = await service.lessons('p1', 'c1', '2026-10', day('2026-10-13'));
    expect(mockSchedule.build).toHaveBeenCalledWith(day('2026-10-01'), day('2026-10-13'), ['g1']);
    expect(view.lessons).toEqual([
      { date: '2026-10-12', period: 1, subjectName: 'Математика', status: LessonStatus.present, reasonName: null, level: NushLevel.independent, comment: 'молодець', source: 'mark' },
      { date: '2026-10-13', period: 1, subjectName: 'Математика', status: LessonStatus.absent, reasonName: 'Хвороба', level: null, comment: null, source: 'register' },
    ]);
    expect(view.summary).toEqual({
      missed: 1,
      missedExcused: 1,
      bySubject: [{ subjectName: 'Математика', levels: { needs_support: 0, progressing: 0, with_help: 0, independent: 1 } }],
    });
  });
});
```

Delete-guard tests — add to the existing delete tests (mocks default 0) and one new test each:
- `groups.service.spec.ts`: `mockPrisma` gains `timetable: { count }`, `lessonChange: { count }`, `schoolLesson: { count }`, `subgroup: { count }`; new test: `schoolLesson.count` = 1 → 400 `Cannot delete: group has attendance records`.
- `children.service.spec.ts`: `subgroupMember: { count }`, `lessonMark: { count }`; new test: `lessonMark.count` = 1 → 400 `Cannot delete: child has financial records`.
- `users.service.spec.ts`: `timetable: { count }`, `timetableEntry: { count }`, `lessonChange: { count }`, `schoolLesson: { count }`, `lessonMark: { count }`; new test: `timetableEntry.count` = 1 → 400 `Cannot delete: user has financial records, deactivate instead`, and assert `timetableEntry.count` was called with `{ where: { teacherId: 'u1' } }`.

Write each new test in the style of the neighbouring delete test of the same file (arrange all count mocks to 0 in that file's existing way, set the one count to 1, assert the exact message and that `delete` was not called).

- [ ] **Step 2: Run, verify failure**

Run: `npx jest src/timetable/parent-timetable.service.spec.ts src/groups src/children src/users` → FAIL.

- [ ] **Step 3: Implement `src/timetable/parent-timetable.service.ts`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { GroupKind, LessonStatus, NushLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnChild } from '../common/ownership';
import { parseDay } from '../classes/access';
import { RegisterService } from '../attendance/register.service';
import { parseMonth } from '../attendance/register-calc';
import { dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { type Slot, pupilState } from './schedule-calc';
import { ScheduleService, subgroupKey } from './schedule.service';

const emptyLevels = (): Record<NushLevel, number> => ({
  needs_support: 0,
  progressing: 0,
  with_help: 0,
  independent: 0,
});

@Injectable()
export class ParentTimetableService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
    private register: RegisterService,
  ) {}

  private async childClass(parentId: string, childId: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { groupId: true, group: { select: { kind: true } }, subgroupMemberships: { select: { subgroupId: true } } },
    });
    const groupId = child?.group?.kind === GroupKind.school_class ? child.groupId : null;
    const subgroups = new Set(child?.subgroupMemberships.map((m) => m.subgroupId) ?? []);
    return { groupId, applies: (slot: Slot) => slot.subgroupId === null || subgroups.has(slot.subgroupId) };
  }

  async schedule(parentId: string, childId: string, fromValue: string, toValue: string) {
    const from = parseDay(fromValue);
    const to = parseDay(toValue);
    if (to.getTime() < from.getTime() || dayCount(from, to) > 31)
      throw new BadRequestException('Invalid period');
    const { groupId, applies } = await this.childClass(parentId, childId);
    if (!groupId) return { days: [] };
    const [schedule] = await this.schedule.build(from, to, [groupId]);
    const lessons = await this.prisma.schoolLesson.findMany({
      where: { groupId, date: { gte: from, lte: to } },
      select: { date: true, period: true, subgroupKey: true, topic: true, homework: true },
    });
    const names = await this.schedule.describe(schedule.days.flatMap((d) => d.slots.filter(applies)));
    return {
      days: schedule.days.map((d) => ({
        date: isoDay(d.date),
        working: d.working,
        title: d.title,
        slots: d.slots.filter(applies).map((s) => {
          const lesson = lessons.find(
            (l) => l.date.getTime() === d.date.getTime() && l.period === s.period && l.subgroupKey === subgroupKey(s.subgroupId),
          );
          const { subjectName, teacherName, roomName, subgroupName } = names(s);
          return {
            period: s.period,
            startTime: s.startTime,
            endTime: s.endTime,
            subjectName,
            teacherName,
            roomName,
            subgroupName,
            cancelled: s.cancelled,
            replaced: s.source === 'replace',
            extra: s.source === 'extra',
            topic: lesson?.topic ?? null,
            homework: lesson?.homework ?? null,
          };
        }),
      })),
    };
  }

  async lessons(parentId: string, childId: string, monthValue: string, today: Date = kyivToday()) {
    const { from, to } = parseMonth(monthValue);
    const { groupId, applies } = await this.childClass(parentId, childId);
    const empty = { month: monthValue, lessons: [], summary: { missed: 0, missedExcused: 0, bySubject: [] } };
    const end = to.getTime() < today.getTime() ? to : today;
    if (!groupId || end.getTime() < from.getTime()) return empty;
    const [schedule] = await this.schedule.build(from, end, [groupId]);
    const [recorded, dayRows, reasons, subjects] = await Promise.all([
      this.prisma.schoolLesson.findMany({
        where: { groupId, date: { gte: from, lte: end } },
        select: {
          date: true,
          period: true,
          subgroupKey: true,
          subjectId: true,
          marks: { where: { childId, voidedAt: null }, select: { status: true, reasonId: true, level: true, comment: true, voidedAt: true } },
        },
      }),
      this.register.childDays([childId], from, end),
      this.prisma.absenceReason.findMany({ select: { id: true, name: true, excused: true } }),
      this.prisma.subject.findMany({ select: { id: true, name: true } }),
    ]);
    const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? null;
    const days = dayRows[0]?.days ?? [];
    const lessons = schedule.days.flatMap((d) => {
      const registerDay = days.find((r) => r.date.getTime() === d.date.getTime()) ?? null;
      return d.slots
        .filter((s) => !s.cancelled && applies(s))
        .flatMap((s) => {
          const lesson = recorded.find(
            (l) => l.date.getTime() === d.date.getTime() && l.period === s.period && l.subgroupKey === subgroupKey(s.subgroupId),
          );
          const mark = lesson?.marks[0] ?? null;
          const state = pupilState(registerDay?.state ?? null, registerDay?.reasonId ?? null, mark);
          if (state.status === null) return [];
          return [{
            date: isoDay(d.date),
            period: s.period,
            subjectName: subjectName(lesson?.subjectId ?? s.subjectId),
            status: state.status,
            reasonName: state.reasonId ? (reasons.find((r) => r.id === state.reasonId)?.name ?? null) : null,
            level: mark?.level ?? null,
            comment: mark?.comment ?? null,
            source: state.source,
          }];
        });
    });
    const missedRows = lessons.filter((l) => l.status === LessonStatus.absent);
    const excusedNames = new Set(reasons.filter((r) => r.excused).map((r) => r.name));
    const bySubject = new Map<string, Record<NushLevel, number>>();
    for (const l of lessons) {
      if (!l.level || !l.subjectName) continue;
      const levels = bySubject.get(l.subjectName) ?? emptyLevels();
      levels[l.level] += 1;
      bySubject.set(l.subjectName, levels);
    }
    return {
      month: monthValue,
      lessons,
      summary: {
        missed: missedRows.length,
        missedExcused: missedRows.filter((l) => l.reasonName !== null && excusedNames.has(l.reasonName)).length,
        bySubject: [...bySubject.entries()].map(([name, levels]) => ({ subjectName: name, levels })),
      },
    };
  }
}
```

- [ ] **Step 4: Controller `src/timetable/parent-timetable.controller.ts`**

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ParentTimetableService } from './parent-timetable.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me/children')
export class ParentTimetableController {
  constructor(private parent: ParentTimetableService) {}

  @Get(':id/schedule')
  schedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.parent.schedule(user.id, id, from, to);
  }

  @Get(':id/lessons')
  lessons(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query('month') month: string) {
    return this.parent.lessons(user.id, id, month);
  }
}
```

Add both to the module.

- [ ] **Step 5: Delete guards**

`GroupsService.delete` — replace the counts with:

```ts
    const counts = await Promise.all([
      this.prisma.dailyAttendance.count({ where: { groupId: id } }),
      this.prisma.calendarDay.count({ where: { groupId: id } }),
      this.prisma.timetable.count({ where: { groupId: id } }),
      this.prisma.lessonChange.count({ where: { groupId: id } }),
      this.prisma.schoolLesson.count({ where: { groupId: id } }),
      this.prisma.subgroup.count({ where: { groupId: id } }),
    ]);
    if (counts.some((count) => count > 0)) {
```

`ChildrenService.delete` counts add `this.prisma.subgroupMember.count({ where: { childId: id } })`, `this.prisma.lessonMark.count({ where: { childId: id } })`.

`UsersService.delete` counts add:

```ts
      this.prisma.timetable.count({ where: { createdById: id } }),
      this.prisma.timetableEntry.count({ where: { teacherId: id } }),
      this.prisma.lessonChange.count({
        where: { OR: [{ createdById: id }, { voidedById: id }, { teacherId: id }] },
      }),
      this.prisma.schoolLesson.count({
        where: { OR: [{ teacherId: id }, { conductedById: id }] },
      }),
      this.prisma.lessonMark.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
```

- [ ] **Step 6: CLAUDE.md**

Add after "### Domain: attendance register":

```markdown
### Domain: school timetable

Spec: `docs/superpowers/specs/2026-10-12-school-timetable-design.md`. Code in `src/timetable/`:

- Directories: `Subject`, `Room`, `BellSchedule` (numbered periods with `HH:MM` times), `Subgroup` (children of one class). Deactivated, never deleted. A school class (`Group.kind = school_class`) links one bell schedule.
- `Timetable` versions per class (`validFrom`/`validTo`, never overlapping; a new version closes the previous one; started versions are never edited) with `TimetableEntry` (weekday 1–6, period, `every`/`odd`/`even` ISO week, subject, teacher, room, subgroup).
- Lessons on a date are computed by `ScheduleService.build` from the version, the attendance calendar and `LessonChange`s (`cancel`, `replace`, `extra`; voided, never edited). Pure rules live in `schedule-calc.ts`; keep them there and test without mocks.
- Saving a timetable or a change rejects real-time conflicts (teacher, room, class vs subgroup, intersecting subgroups) with 409 `Schedule conflict` and a `conflicts` list.
- `SchoolLesson` is created on first save and snapshots subject/teacher/room; `LessonMark` = one active mark per pupil (children rows locked before reading marks; corrections void). Only the effective teacher (after replacement) or admins record lessons, within `attendanceEditDays`. Daily-register absences show on lessons; lesson marks never change the register.
- НУШ levels (`needs_support`, `progressing`, `with_help`, `independent`) only; comments are visible to parents. Parent routes `/me/children/:id/schedule` and `/me/children/:id/lessons` use `assertOwnChild`.
```

- [ ] **Step 7: Verify**

Run: `npx jest`, `npm run build`, `npx eslint "src/timetable/**/*.ts" src/groups src/children/children.service.ts src/users/users.service.ts`. Expected: pass; exit 0; only baseline lint errors.

- [ ] **Step 8: Live check on PORT=3100**

Start your own `PORT=3100 npm run start:dev` (Node 22; never touch 3000). Root login from `.env` (never print the password). Cookie jars and UTF-8 JSON bodies in the scratchpad. Test data prefix «Тест Р». D = Kyiv today if a weekday, else the previous Friday; WD = ISO weekday of D.

1. `POST /bell-schedules` «Тест Р 1–4» (periods 1 08:30–09:15, 2 09:25–10:10, 3 10:30–11:15) and «Тест Р інший» (period 1 08:50–09:35). Overlapping periods → 400 `Bell periods overlap`.
2. `POST /subjects` «Тест Р Математика», «Тест Р Англійська»; `POST /rooms` «Тест Р 101». Create teachers T1, T2, T3, T4 (role teacher).
3. Create classes «Тест Р 1-А» (`kind: school_class`, `bellScheduleId` 1–4) and «Тест Р 1-Б» (`school_class`, «інший»); children A, B in 1-А, C in 1-Б; parent P linked to A (change P's password first).
4. `POST /groups/1-А/subgroups` «Англ. 1» with A, «Англ. 2» with B.
5. `POST /groups/1-А/timetables` `validFrom` = D minus 7 days with entries: WD/1 Математика T1 room 101; WD/2 Англійська T1 subgroup «Англ. 1» parity `every`; WD/2 Англійська T2 subgroup «Англ. 2». → 201.
6. `POST /groups/1-Б/timetables` same `validFrom`, entry WD/1 Математика T1 → 409 `Schedule conflict` (T1 08:30–09:15 vs 08:50–09:35) with a `conflicts` list; with T3 → 201.
7. `POST /groups/1-А/lesson-changes` `{ date: D, period: 1, type: "replace", teacherId: T3, reason: "Тест Р" }` → 409 (T3 busy in 1-Б at 08:50); `replace` with T4 → 201.
8. Root marks A absent (reason «Хвороба») in the daily register for D (`PUT /groups/1-А/register`).
9. As T1: `GET /me/lessons?date=D` → only the English lesson (period 2, «Англ. 1»); `GET /groups/1-А/lessons/D/1` → 403 `Not your lesson`; as T4 → 200, A shown `absent` source `register`.
10. As T4: `PUT /groups/1-А/lessons/D/1` `{ topic: "Тест Р додавання", homework: "с. 5", marks: [{ childId: B, status: "present", level: "independent", comment: "Тест Р" }, { childId: A, status: "absent", level: "with_help" }] }` → 400 `Level is only allowed for present students`; without A's level → 200, lesson shows topic and marks. Repeat the same body → no new marks (unchanged skipped). Date tomorrow → 400 `Cannot mark future days`.
11. As P: `GET /me/children/A/schedule?from=D&to=D` → period 1 (replaced, homework «с. 5») and period 2 «Англ. 1» only; `GET /me/children/A/lessons?month=<YYYY-MM>` → A absent on period 1 (source register, «Хвороба»); `GET /me/children/C/schedule` → 404 `Child not found`.
12. `POST /groups/1-А/lesson-changes` cancel period 1 on D → 400 `Lesson already recorded`. `DELETE /groups/1-А` → 400 `Cannot delete: group has attendance records`.

Stop only your 3100 server. Record requests and abbreviated responses in the report.

- [ ] **Step 9: Commit**

```bash
git add src/timetable src/groups src/children src/users CLAUDE.md
git commit -m "feat: add parent timetable views and timetable delete guards"
```

---

### Task 7: Frontend API, directories page, group bell schedule

Work in `D:\IT\EduNest`. Read its `CLAUDE.md` first.

**Files:**
- Create: `src/shared/api/timetable.ts`, `src/pages/scheduleSetup/index.ts`, `src/pages/scheduleSetup/model/scheduleSetupStore.ts`, `src/pages/scheduleSetup/ui/ScheduleSetupPage.tsx`, `src/pages/scheduleSetup/ui/NamedTab.tsx`, `src/pages/scheduleSetup/ui/NameDialog.tsx`, `src/pages/scheduleSetup/ui/BellSchedulesTab.tsx`, `src/pages/scheduleSetup/ui/BellScheduleModal.tsx`, `src/pages/scheduleSetup/ui/SubgroupsTab.tsx`, `src/pages/scheduleSetup/ui/SubgroupModal.tsx`
- Modify: `src/shared/api/index.ts`, `src/shared/api/parentCabinet.ts`, `src/shared/api/groups.ts`, `src/shared/api/errorMessages.ts`, `src/pages/groups/model/groupsStore.ts`, `src/pages/groups/ui/CreateGroupModal.tsx`, `src/pages/groups/ui/EditGroupModal.tsx`, `src/widgets/sidebar/model/nav-items.ts`, `src/widgets/header/ui/Header.tsx`, `src/app/router/index.tsx`

**Interfaces:**
- Consumes: backend routes of Tasks 3–6.
- Produces (exported from `shared/api`): `timetableApi`; types `WeekParity`, `LessonChangeType`, `LessonStatus`, `NushLevel`, `NamedItem`, `BellPeriod`, `BellSchedule`, `BellScheduleDto`, `Subgroup`, `SubgroupDto`, `TimetableEntry`, `TimetableVersion`, `ScheduleSlot`, `ClassSchedule`, `ScheduleConflict`, `LessonChangeDto`, `MyLesson`, `MyLessons`, `LessonPupil`, `LessonView`, `LessonMarkDto`, `SaveLessonDto`, `ParentScheduleSlot`, `ParentSchedule`, `ParentLessonRow`, `ParentLessons`; labels `weekParityLabels`, `weekParities`, `lessonStatusLabels`, `lessonStatuses`, `nushLevelLabels`, `nushLevels`, `weekdayLabels`; helpers `weekStart(iso)`, `addDaysIso(iso, n)`, `conflictText(c)`; `parentCabinetApi.getSchedule/getLessons`.

- [ ] **Step 1: Branch and baseline**

```bash
git checkout main && git pull --ff-only && git checkout -b feature/school-timetable
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" > <scratchpad>/fe-tsc-baseline-timetable.txt
```

- [ ] **Step 2: `src/shared/api/timetable.ts`**

```ts
import { axiosInstance } from './axiosInstance';

export type WeekParity = 'every' | 'odd' | 'even';
export const weekParityLabels: Record<WeekParity, string> = {
  every: 'Щотижня',
  odd: 'Непарні тижні',
  even: 'Парні тижні',
};
export const weekParities = Object.keys(weekParityLabels) as WeekParity[];

export type LessonChangeType = 'cancel' | 'replace' | 'extra';

export type LessonStatus = 'present' | 'late' | 'absent';
export const lessonStatusLabels: Record<LessonStatus, string> = {
  present: 'Присутній',
  late: 'Запізнився',
  absent: 'Відсутній',
};
export const lessonStatuses = Object.keys(lessonStatusLabels) as LessonStatus[];

export type NushLevel = 'needs_support' | 'progressing' | 'with_help' | 'independent';
export const nushLevelLabels: Record<NushLevel, string> = {
  needs_support: 'Потребує значної підтримки',
  progressing: 'Демонструє помітний прогрес',
  with_help: 'Досягає результату з допомогою вчителя',
  independent: 'Демонструє результат самостійно',
};
export const nushLevels = Object.keys(nushLevelLabels) as NushLevel[];

export const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export interface NamedItem {
  id: string;
  name: string;
  active: boolean;
}

export interface BellPeriod {
  number: number;
  startTime: string;
  endTime: string;
}

export interface BellSchedule {
  id: string;
  name: string;
  active: boolean;
  periods: BellPeriod[];
}

export interface BellScheduleDto {
  name?: string;
  active?: boolean;
  periods?: BellPeriod[];
}

export interface Subgroup {
  id: string;
  groupId: string;
  name: string;
  active: boolean;
  children: { id: string; firstName: string; lastName: string }[];
}

export interface SubgroupDto {
  name?: string;
  active?: boolean;
  childIds?: string[];
}

export interface TimetableEntry {
  weekday: number;
  period: number;
  parity: WeekParity;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  subgroupId: string | null;
}

export interface TimetableVersion {
  id: string;
  groupId: string;
  validFrom: string;
  validTo: string | null;
  entries: TimetableEntry[];
}

export interface ScheduleSlot {
  period: number;
  startTime: string;
  endTime: string;
  subgroupId: string | null;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  source: 'timetable' | 'replace' | 'extra';
  cancelled: boolean;
  changeId: string | null;
  subjectName: string | null;
  teacherName: string | null;
  roomName: string | null;
  subgroupName: string | null;
  lessonId?: string | null;
}

export interface ClassSchedule {
  group: { id: string; name: string };
  periods: BellPeriod[];
  days: { date: string; working: boolean; title: string | null; slots: ScheduleSlot[] }[];
}

export interface ScheduleConflict {
  kind: 'teacher' | 'room' | 'class' | 'subgroup';
  weekday: number | null;
  date: string | null;
  period: number;
  groupName: string;
  subjectName: string | null;
  other: { groupName: string; period: number; subjectName: string | null };
}

export interface LessonChangeDto {
  date: string;
  period: number;
  subgroupId?: string;
  type: LessonChangeType;
  subjectId?: string;
  teacherId?: string;
  roomId?: string;
  reason: string;
}

export interface MyLesson extends ScheduleSlot {
  group: { id: string; name: string };
}

export interface MyLessons {
  date: string;
  lessons: MyLesson[];
}

export interface LessonPupil {
  child: { id: string; firstName: string; lastName: string; middleName: string | null };
  state: { status: LessonStatus | null; reasonId: string | null; source: 'mark' | 'register' | 'none' };
  mark: { id: string; status: LessonStatus; reasonId: string | null; level: NushLevel | null; comment: string | null } | null;
  dayState: string | null;
  dayReasonId: string | null;
}

export interface LessonView {
  group: { id: string; name: string };
  date: string;
  slot: ScheduleSlot;
  lesson: { id: string; topic: string | null; homework: string | null } | null;
  canEdit: boolean;
  needsReason: boolean;
  pupils: LessonPupil[];
}

export interface LessonMarkDto {
  childId: string;
  status: LessonStatus;
  reasonId?: string;
  level?: NushLevel;
  comment?: string;
}

export interface SaveLessonDto {
  topic?: string;
  homework?: string;
  reason?: string;
  marks: LessonMarkDto[];
}

export interface ParentScheduleSlot {
  period: number;
  startTime: string;
  endTime: string;
  subjectName: string | null;
  teacherName: string | null;
  roomName: string | null;
  subgroupName: string | null;
  cancelled: boolean;
  replaced: boolean;
  extra: boolean;
  topic: string | null;
  homework: string | null;
}

export interface ParentSchedule {
  days: { date: string; working: boolean; title: string | null; slots: ParentScheduleSlot[] }[];
}

export interface ParentLessonRow {
  date: string;
  period: number;
  subjectName: string | null;
  status: LessonStatus;
  reasonName: string | null;
  level: NushLevel | null;
  comment: string | null;
  source: 'mark' | 'register' | 'none';
}

export interface ParentLessons {
  month: string;
  lessons: ParentLessonRow[];
  summary: {
    missed: number;
    missedExcused: number;
    bySubject: { subjectName: string; levels: Record<NushLevel, number> }[];
  };
}

export const addDaysIso = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const weekStart = (iso: string) => {
  const weekday = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -weekday);
};

const conflictKindLabels: Record<ScheduleConflict['kind'], string> = {
  teacher: 'вчитель зайнятий',
  room: 'кабінет зайнятий',
  class: 'клас уже має урок',
  subgroup: 'підгрупи мають спільних дітей',
};

export const conflictText = (c: ScheduleConflict) =>
  `${c.groupName}, ${c.weekday ? weekdayLabels[c.weekday - 1] : c.date}, ${c.period}-й урок (${c.subjectName ?? '—'}): ${conflictKindLabels[c.kind]} — ${c.other.groupName}, ${c.other.period}-й урок (${c.other.subjectName ?? '—'})`;

const lessonPath = (groupId: string, date: string, period: number) => `/groups/${groupId}/lessons/${date}/${period}`;

export const timetableApi = {
  getSubjects: () => axiosInstance.get<NamedItem[]>('/subjects'),
  createSubject: (name: string) => axiosInstance.post<NamedItem>('/subjects', { name }),
  updateSubject: (id: string, dto: Partial<Pick<NamedItem, 'name' | 'active'>>) => axiosInstance.patch<NamedItem>(`/subjects/${id}`, dto),
  getRooms: () => axiosInstance.get<NamedItem[]>('/rooms'),
  createRoom: (name: string) => axiosInstance.post<NamedItem>('/rooms', { name }),
  updateRoom: (id: string, dto: Partial<Pick<NamedItem, 'name' | 'active'>>) => axiosInstance.patch<NamedItem>(`/rooms/${id}`, dto),
  getBellSchedules: () => axiosInstance.get<BellSchedule[]>('/bell-schedules'),
  createBellSchedule: (dto: Required<Pick<BellScheduleDto, 'name' | 'periods'>>) => axiosInstance.post<BellSchedule>('/bell-schedules', dto),
  updateBellSchedule: (id: string, dto: BellScheduleDto) => axiosInstance.patch<BellSchedule>(`/bell-schedules/${id}`, dto),
  getSubgroups: (groupId: string) => axiosInstance.get<Subgroup[]>(`/groups/${groupId}/subgroups`),
  createSubgroup: (groupId: string, dto: Required<Pick<SubgroupDto, 'name' | 'childIds'>>) => axiosInstance.post<Subgroup>(`/groups/${groupId}/subgroups`, dto),
  updateSubgroup: (id: string, dto: SubgroupDto) => axiosInstance.patch<Subgroup>(`/subgroups/${id}`, dto),
  getTimetables: (groupId: string) => axiosInstance.get<TimetableVersion[]>(`/groups/${groupId}/timetables`),
  createTimetable: (groupId: string, validFrom: string, entries: TimetableEntry[]) =>
    axiosInstance.post<TimetableVersion>(`/groups/${groupId}/timetables`, { validFrom, entries: entries.map(toEntryDto) }),
  replaceEntries: (id: string, entries: TimetableEntry[]) =>
    axiosInstance.put<TimetableVersion>(`/timetables/${id}/entries`, { entries: entries.map(toEntryDto) }),
  getSchedule: (groupId: string, from: string, to: string) =>
    axiosInstance.get<ClassSchedule>(`/groups/${groupId}/schedule`, { params: { from, to } }),
  createChange: (groupId: string, dto: LessonChangeDto) => axiosInstance.post(`/groups/${groupId}/lesson-changes`, dto),
  voidChange: (id: string, reason: string) => axiosInstance.post(`/lesson-changes/${id}/void`, { reason }),
  getMyLessons: (date: string) => axiosInstance.get<MyLessons>('/me/lessons', { params: { date } }),
  getLesson: (groupId: string, date: string, period: number, subgroupId?: string) =>
    axiosInstance.get<LessonView>(lessonPath(groupId, date, period), { params: { subgroupId } }),
  saveLesson: (groupId: string, date: string, period: number, subgroupId: string | undefined, dto: SaveLessonDto) =>
    axiosInstance.put<LessonView>(lessonPath(groupId, date, period), dto, { params: { subgroupId } }),
};

function toEntryDto(e: TimetableEntry) {
  return {
    weekday: e.weekday,
    period: e.period,
    parity: e.parity,
    subjectId: e.subjectId,
    teacherId: e.teacherId,
    roomId: e.roomId ?? undefined,
    subgroupId: e.subgroupId ?? undefined,
  };
}
```

`src/shared/api/parentCabinet.ts`: `import type { ParentLessons, ParentSchedule } from './timetable';` and add to `parentCabinetApi`:

```ts
  getSchedule: (id: string, from: string, to: string) =>
    axiosInstance.get<ParentSchedule>(`/me/children/${id}/schedule`, { params: { from, to } }),
  getLessons: (id: string, month: string) =>
    axiosInstance.get<ParentLessons>(`/me/children/${id}/lessons`, { params: { month } }),
```

`src/shared/api/index.ts`: export the values (`timetableApi`, `weekParityLabels`, `weekParities`, `lessonStatusLabels`, `lessonStatuses`, `nushLevelLabels`, `nushLevels`, `weekdayLabels`, `weekStart`, `addDaysIso`, `conflictText`) and every type listed in Interfaces with `export type`.

`src/shared/api/groups.ts`: `Group` gains `bellScheduleId: string | null;`, both DTOs gain `bellScheduleId?: string | null;`.

- [ ] **Step 3: Translations (`errorMessages.ts`; skip keys that already exist)**

```ts
  'Schedule conflict': 'Конфлікт розкладу',
  'Timetable periods overlap': 'Нова версія розкладу має починатися пізніше за попередню',
  'Timetable already started': 'Розклад уже діє, створіть нову версію',
  'Timetable not found': 'Розклад не знайдено',
  'Bell period not found': 'Такого уроку немає в розкладі дзвінків',
  'Bell periods overlap': 'Уроки в розкладі дзвінків перетинаються',
  'Invalid bell time': 'Початок уроку має бути раніше за кінець',
  'Bell period is in use': 'Цей урок використовується в розкладі',
  'Bell schedule not found': 'Розклад дзвінків не знайдено',
  'Bell schedule already exists': 'Такий розклад дзвінків уже існує',
  'Not a school class': 'Це не шкільний клас',
  'Class has no bell schedule': 'Спочатку оберіть класу розклад дзвінків',
  'User is not a teacher': 'Обраний користувач не вчитель',
  'Lesson not found': 'Урок не знайдено',
  'Not your lesson': 'Це не ваш урок',
  'Lesson already recorded': 'Урок уже проведено, скасувати не можна',
  'Lesson change not found': 'Зміну не знайдено',
  'Lesson change is voided': 'Зміну вже скасовано',
  'Nothing to replace': 'Оберіть, що замінити',
  'Subject and teacher are required': 'Оберіть предмет і вчителя',
  'Subgroup does not belong to this class': 'Підгрупа з іншого класу',
  'Subgroup not found': 'Підгрупу не знайдено',
  'Subgroup already exists': 'Така підгрупа вже існує',
  'Child is not in this class': 'Дитина не з цього класу',
  'Child is not in this subgroup': 'Дитина не з цієї підгрупи',
  'Level is only allowed for present students': 'Рівень ставиться лише присутнім',
  'Subject not found': 'Предмет не знайдено',
  'Room not found': 'Кабінет не знайдено',
  'Subject already exists': 'Такий предмет уже існує',
  'Room already exists': 'Такий кабінет уже існує',
```

- [ ] **Step 4: Store `src/pages/scheduleSetup/model/scheduleSetupStore.ts`**

```ts
import { create } from 'zustand';
import {
  childrenApi,
  groupsApi,
  timetableApi,
  type BellSchedule,
  type BellScheduleDto,
  type Child,
  type Group,
  type NamedItem,
  type Subgroup,
  type SubgroupDto,
} from '../../../shared/api';

export type NamedKind = 'subject' | 'room';

interface ScheduleSetupState {
  subjects: NamedItem[];
  rooms: NamedItem[];
  bellSchedules: BellSchedule[];
  classes: Group[];
  children: Child[];
  classId: string | null;
  subgroups: Subgroup[];
  loadFailed: boolean;
  isSaving: boolean;
  load: () => Promise<void>;
  createNamed: (kind: NamedKind, name: string) => Promise<void>;
  updateNamed: (kind: NamedKind, id: string, patch: Partial<Pick<NamedItem, 'name' | 'active'>>) => Promise<void>;
  saveBellSchedule: (id: string | null, dto: Required<Pick<BellScheduleDto, 'name' | 'periods'>>) => Promise<void>;
  setBellActive: (id: string, active: boolean) => Promise<void>;
  selectClass: (classId: string) => Promise<void>;
  saveSubgroup: (id: string | null, dto: Required<Pick<SubgroupDto, 'name' | 'childIds'>>) => Promise<void>;
  setSubgroupActive: (id: string, active: boolean) => Promise<void>;
}

const replace = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

export const useScheduleSetupStore = create<ScheduleSetupState>((set, get) => {
  const saving = async (fn: () => Promise<void>) => {
    set({ isSaving: true });
    try {
      await fn();
    } finally {
      set({ isSaving: false });
    }
  };
  return {
    subjects: [],
    rooms: [],
    bellSchedules: [],
    classes: [],
    children: [],
    classId: null,
    subgroups: [],
    loadFailed: false,
    isSaving: false,
    load: async () => {
      set({ loadFailed: false });
      try {
        const [subjects, rooms, bells, groups, children] = await Promise.all([
          timetableApi.getSubjects(),
          timetableApi.getRooms(),
          timetableApi.getBellSchedules(),
          groupsApi.getList(),
          childrenApi.getList(),
        ]);
        set({
          subjects: subjects.data,
          rooms: rooms.data,
          bellSchedules: bells.data,
          classes: groups.data.filter((g) => g.kind === 'school_class'),
          children: children.data,
        });
      } catch (error) {
        set({ loadFailed: true });
        throw error;
      }
    },
    createNamed: (kind, name) =>
      saving(async () => {
        if (kind === 'subject') {
          const { data } = await timetableApi.createSubject(name);
          set((s) => ({ subjects: replace(s.subjects, data) }));
        } else {
          const { data } = await timetableApi.createRoom(name);
          set((s) => ({ rooms: replace(s.rooms, data) }));
        }
      }),
    updateNamed: (kind, id, patch) =>
      saving(async () => {
        if (kind === 'subject') {
          const { data } = await timetableApi.updateSubject(id, patch);
          set((s) => ({ subjects: replace(s.subjects, data) }));
        } else {
          const { data } = await timetableApi.updateRoom(id, patch);
          set((s) => ({ rooms: replace(s.rooms, data) }));
        }
      }),
    saveBellSchedule: (id, dto) =>
      saving(async () => {
        const { data } = id ? await timetableApi.updateBellSchedule(id, dto) : await timetableApi.createBellSchedule(dto);
        set((s) => ({ bellSchedules: replace(s.bellSchedules, data) }));
      }),
    setBellActive: (id, active) =>
      saving(async () => {
        const { data } = await timetableApi.updateBellSchedule(id, { active });
        set((s) => ({ bellSchedules: replace(s.bellSchedules, data) }));
      }),
    selectClass: async (classId) => {
      set({ classId, subgroups: [] });
      const { data } = await timetableApi.getSubgroups(classId);
      if (get().classId === classId) set({ subgroups: data });
    },
    saveSubgroup: (id, dto) =>
      saving(async () => {
        const classId = get().classId;
        if (!classId) return;
        const { data } = id ? await timetableApi.updateSubgroup(id, dto) : await timetableApi.createSubgroup(classId, dto);
        if (get().classId === classId) set((s) => ({ subgroups: replace(s.subgroups, data) }));
      }),
    setSubgroupActive: (id, active) =>
      saving(async () => {
        const { data } = await timetableApi.updateSubgroup(id, { active });
        set((s) => ({ subgroups: replace(s.subgroups, data) }));
      }),
  };
});
```

(Check that `childrenApi`, `groupsApi`, `Child`, `Group` are exported from `shared/api/index.ts`; they are used by existing pages.)

- [ ] **Step 5: Name dialog and named tab**

`src/pages/scheduleSetup/ui/NameDialog.tsx`:

```tsx
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, TextField } from '@mui/material'

const schema = yup.object({
  name: yup.string().trim().required("Обов'язкове поле").max(100, 'Максимум 100 символів'),
})

type FormValues = yup.InferType<typeof schema>

interface NameDialogProps {
  open: boolean
  title: string
  initial: string
  isSaving: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}

export const NameDialog = ({ open, title, initial, isSaving, onClose, onSubmit }: NameDialogProps) => {
  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { name: initial },
    resolver: yupResolver(schema),
  })

  useEffect(() => {
    if (open) reset({ name: initial })
  }, [open, initial, reset])

  const submit = async (values: FormValues) => {
    await onSubmit(values.name.trim())
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Назва" autoFocus error={!!error} helperText={error?.message} />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={onClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit((v) => submit(v).catch(() => undefined))} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Зберегти
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/scheduleSetup/ui/NamedTab.tsx`:

```tsx
import { useState } from 'react'
import { Box, Button, IconButton, Paper, Switch, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useScheduleSetupStore, type NamedKind } from '../model/scheduleSetupStore'
import { NameDialog } from './NameDialog'
import type { NamedItem } from '../../../shared/api'

const titles: Record<NamedKind, { add: string; edit: string; empty: string }> = {
  subject: { add: 'Додати предмет', edit: 'Предмет', empty: 'Предметів ще немає.' },
  room: { add: 'Додати кабінет', edit: 'Кабінет', empty: 'Кабінетів ще немає.' },
}

export const NamedTab = ({ kind }: { kind: NamedKind }) => {
  const subjects = useScheduleSetupStore((s) => s.subjects)
  const rooms = useScheduleSetupStore((s) => s.rooms)
  const isSaving = useScheduleSetupStore((s) => s.isSaving)
  const createNamed = useScheduleSetupStore((s) => s.createNamed)
  const updateNamed = useScheduleSetupStore((s) => s.updateNamed)
  const [editing, setEditing] = useState<NamedItem | 'new' | null>(null)
  const items = kind === 'subject' ? subjects : rooms

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>{titles[kind].add}</Button>
      </Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Назва</TableCell>
              <TableCell>Активний</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={3} sx={{ color: 'text.secondary' }}>{titles[kind].empty}</TableCell></TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id} sx={{ opacity: item.active ? 1 : 0.5 }}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>
                    <Switch checked={item.active} onChange={(e) => updateNamed(kind, item.id, { active: e.target.checked }).catch(() => undefined)} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setEditing(item)}><EditOutlinedIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
      <NameDialog
        open={editing !== null}
        title={titles[kind].edit}
        initial={editing && editing !== 'new' ? editing.name : ''}
        isSaving={isSaving}
        onClose={() => setEditing(null)}
        onSubmit={(name) => (editing && editing !== 'new' ? updateNamed(kind, editing.id, { name }) : createNamed(kind, name))}
      />
    </Box>
  )
}
```

- [ ] **Step 6: Bell schedules**

`src/pages/scheduleSetup/ui/BellScheduleModal.tsx`:

```tsx
import { useEffect } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, IconButton, TextField, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useScheduleSetupStore } from '../model/scheduleSetupStore'
import type { BellSchedule } from '../../../shared/api'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const schema = yup.object({
  name: yup.string().trim().required("Обов'язкове поле").max(100, 'Максимум 100 символів'),
  periods: yup
    .array()
    .of(
      yup.object({
        startTime: yup.string().matches(TIME, 'Формат ГГ:ХХ').required("Обов'язкове поле"),
        endTime: yup
          .string()
          .matches(TIME, 'Формат ГГ:ХХ')
          .required("Обов'язкове поле")
          .test('after', 'Кінець раніше за початок', function (v) {
            return !v || !this.parent.startTime || v > this.parent.startTime
          }),
      }),
    )
    .min(1, 'Додайте хоча б один урок')
    .required(),
})

type FormValues = yup.InferType<typeof schema>

const empty: FormValues = { name: '', periods: [{ startTime: '08:30', endTime: '09:15' }] }

export const BellScheduleModal = ({ open, schedule, onClose }: { open: boolean; schedule: BellSchedule | null; onClose: () => void }) => {
  const saveBellSchedule = useScheduleSetupStore((s) => s.saveBellSchedule)
  const isSaving = useScheduleSetupStore((s) => s.isSaving)
  const { control, handleSubmit, reset } = useForm<FormValues>({ mode: 'all', defaultValues: empty, resolver: yupResolver(schema) })
  const { fields, append, remove } = useFieldArray({ control, name: 'periods' })

  useEffect(() => {
    if (!open) return
    reset(schedule ? { name: schedule.name, periods: schedule.periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime })) } : empty)
  }, [open, schedule, reset])

  const submit = async (values: FormValues) => {
    await saveBellSchedule(schedule?.id ?? null, {
      name: values.name.trim(),
      periods: values.periods.map((p, i) => ({ number: i + 1, startTime: p.startTime, endTime: p.endTime })),
    })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{schedule ? 'Розклад дзвінків' : 'Новий розклад дзвінків'}</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState: { error } }) => <TextField {...field} label="Назва" error={!!error} helperText={error?.message} />}
        />
        {fields.map((f, i) => (
          <Box key={f.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Typography sx={{ width: 64 }}>{i + 1}-й</Typography>
            <Controller
              name={`periods.${i}.startTime`}
              control={control}
              render={({ field, fieldState: { error } }) => (
                <TextField {...field} type="time" size="small" label="Початок" slotProps={{ inputLabel: { shrink: true } }} error={!!error} helperText={error?.message} />
              )}
            />
            <Controller
              name={`periods.${i}.endTime`}
              control={control}
              render={({ field, fieldState: { error } }) => (
                <TextField {...field} type="time" size="small" label="Кінець" slotProps={{ inputLabel: { shrink: true } }} error={!!error} helperText={error?.message} />
              )}
            />
            <IconButton size="small" disabled={fields.length === 1} onClick={() => remove(i)}><DeleteOutlineIcon fontSize="small" /></IconButton>
          </Box>
        ))}
        <Button onClick={() => append({ startTime: '', endTime: '' })}>Додати урок</Button>
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={onClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit((v) => submit(v).catch(() => undefined))} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Зберегти
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/scheduleSetup/ui/BellSchedulesTab.tsx`:

```tsx
import { useState } from 'react'
import { Box, Button, Card, CardContent, Grid, IconButton, Switch, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useScheduleSetupStore } from '../model/scheduleSetupStore'
import { BellScheduleModal } from './BellScheduleModal'
import type { BellSchedule } from '../../../shared/api'

export const BellSchedulesTab = () => {
  const bellSchedules = useScheduleSetupStore((s) => s.bellSchedules)
  const setBellActive = useScheduleSetupStore((s) => s.setBellActive)
  const [editing, setEditing] = useState<BellSchedule | 'new' | null>(null)

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>Додати розклад дзвінків</Button>
      </Box>
      {bellSchedules.length === 0 && <Typography color="text.secondary">Розкладів дзвінків ще немає.</Typography>}
      <Grid container spacing={2}>
        {bellSchedules.map((b) => (
          <Grid key={b.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, opacity: b.active ? 1 : 0.5 }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Typography sx={{ fontWeight: 700, mr: 'auto' }}>{b.name}</Typography>
                  <Switch size="small" checked={b.active} onChange={(e) => setBellActive(b.id, e.target.checked).catch(() => undefined)} />
                  <IconButton size="small" onClick={() => setEditing(b)}><EditOutlinedIcon fontSize="small" /></IconButton>
                </Box>
                {b.periods.map((p) => (
                  <Typography key={p.number} variant="body2">{p.number}-й урок: {p.startTime}–{p.endTime}</Typography>
                ))}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      <BellScheduleModal open={editing !== null} schedule={editing && editing !== 'new' ? editing : null} onClose={() => setEditing(null)} />
    </Box>
  )
}
```

- [ ] **Step 7: Subgroups**

`src/pages/scheduleSetup/ui/SubgroupModal.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Autocomplete, Box, Button, Dialog, DialogTitle, TextField } from '@mui/material'
import { useScheduleSetupStore } from '../model/scheduleSetupStore'
import type { Subgroup } from '../../../shared/api'

const schema = yup.object({
  name: yup.string().trim().required("Обов'язкове поле").max(100, 'Максимум 100 символів'),
  childIds: yup.array().of(yup.string().required()).default([]),
})

type FormValues = yup.InferType<typeof schema>

export const SubgroupModal = ({ open, subgroup, onClose }: { open: boolean; subgroup: Subgroup | null; onClose: () => void }) => {
  const children = useScheduleSetupStore((s) => s.children)
  const classId = useScheduleSetupStore((s) => s.classId)
  const saveSubgroup = useScheduleSetupStore((s) => s.saveSubgroup)
  const isSaving = useScheduleSetupStore((s) => s.isSaving)
  const classChildren = useMemo(() => children.filter((c) => c.group?.id === classId), [children, classId])
  const { control, handleSubmit, reset } = useForm<FormValues>({ mode: 'all', defaultValues: { name: '', childIds: [] }, resolver: yupResolver(schema) })

  useEffect(() => {
    if (open) reset(subgroup ? { name: subgroup.name, childIds: subgroup.children.map((c) => c.id) } : { name: '', childIds: [] })
  }, [open, subgroup, reset])

  const submit = async (values: FormValues) => {
    await saveSubgroup(subgroup?.id ?? null, { name: values.name.trim(), childIds: values.childIds ?? [] })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{subgroup ? 'Підгрупа' : 'Нова підгрупа'}</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState: { error } }) => <TextField {...field} label="Назва" placeholder="Англійська 1" error={!!error} helperText={error?.message} />}
        />
        <Controller
          name="childIds"
          control={control}
          render={({ field }) => (
            <Autocomplete
              multiple
              options={classChildren}
              getOptionLabel={(c) => `${c.lastName} ${c.firstName}`}
              value={classChildren.filter((c) => field.value?.includes(c.id))}
              onChange={(_, selected) => field.onChange(selected.map((c) => c.id))}
              renderInput={(params) => <TextField {...params} label="Діти" />}
            />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={onClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit((v) => submit(v).catch(() => undefined))} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Зберегти
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/scheduleSetup/ui/SubgroupsTab.tsx`:

```tsx
import { useState } from 'react'
import { Box, Button, Chip, IconButton, MenuItem, Paper, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useScheduleSetupStore } from '../model/scheduleSetupStore'
import { SubgroupModal } from './SubgroupModal'
import type { Subgroup } from '../../../shared/api'

export const SubgroupsTab = () => {
  const classes = useScheduleSetupStore((s) => s.classes)
  const classId = useScheduleSetupStore((s) => s.classId)
  const subgroups = useScheduleSetupStore((s) => s.subgroups)
  const selectClass = useScheduleSetupStore((s) => s.selectClass)
  const setSubgroupActive = useScheduleSetupStore((s) => s.setSubgroupActive)
  const [editing, setEditing] = useState<Subgroup | 'new' | null>(null)

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        <TextField select size="small" label="Клас" value={classId ?? ''} onChange={(e) => selectClass(e.target.value).catch(() => undefined)} sx={{ minWidth: 200 }}>
          {classes.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
        </TextField>
        <Button variant="contained" startIcon={<AddIcon />} disabled={!classId} onClick={() => setEditing('new')} sx={{ ml: 'auto' }}>
          Додати підгрупу
        </Button>
      </Box>
      {classes.length === 0 && <Typography color="text.secondary">Немає класів. Поставте групі тип «Клас».</Typography>}
      {classId && subgroups.length === 0 && <Typography color="text.secondary">Підгруп ще немає.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {subgroups.map((sg) => (
          <Paper key={sg.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, opacity: sg.active ? 1 : 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Typography sx={{ fontWeight: 600, mr: 'auto' }}>{sg.name}</Typography>
              <Switch size="small" checked={sg.active} onChange={(e) => setSubgroupActive(sg.id, e.target.checked).catch(() => undefined)} />
              <IconButton size="small" onClick={() => setEditing(sg)}><EditOutlinedIcon fontSize="small" /></IconButton>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {sg.children.map((c) => <Chip key={c.id} size="small" label={`${c.lastName} ${c.firstName}`} />)}
            </Box>
          </Paper>
        ))}
      </Box>
      <SubgroupModal open={editing !== null} subgroup={editing && editing !== 'new' ? editing : null} onClose={() => setEditing(null)} />
    </Box>
  )
}
```

- [ ] **Step 8: Page `src/pages/scheduleSetup/ui/ScheduleSetupPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Alert, Box, Button, Tab, Tabs } from '@mui/material'
import { useScheduleSetupStore } from '../model/scheduleSetupStore'
import { NamedTab } from './NamedTab'
import { BellSchedulesTab } from './BellSchedulesTab'
import { SubgroupsTab } from './SubgroupsTab'

export const ScheduleSetupPage = () => {
  const load = useScheduleSetupStore((s) => s.load)
  const loadFailed = useScheduleSetupStore((s) => s.loadFailed)
  const [tab, setTab] = useState(0)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  if (loadFailed) {
    return (
      <Alert severity="error" action={<Button onClick={() => load().catch(() => undefined)}>Спробувати ще</Button>}>
        Не вдалося завантажити дані.
      </Alert>
    )
  }

  return (
    <Box>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        <Tab label="Предмети" />
        <Tab label="Кабінети" />
        <Tab label="Дзвінки" />
        <Tab label="Підгрупи" />
      </Tabs>
      {tab === 0 && <NamedTab kind="subject" />}
      {tab === 1 && <NamedTab kind="room" />}
      {tab === 2 && <BellSchedulesTab />}
      {tab === 3 && <SubgroupsTab />}
    </Box>
  )
}
```

`src/pages/scheduleSetup/index.ts`: `export { ScheduleSetupPage } from './ui/ScheduleSetupPage'`

- [ ] **Step 9: Group bell schedule**

`groupsStore.ts`: add `bellSchedules: BellSchedule[]` (initial `[]`) and `fetchBellSchedules: async () => { const { data } = await timetableApi.getBellSchedules(); set({ bellSchedules: data.filter((b) => b.active) }) }` (import `timetableApi`, `type BellSchedule` from `shared/api`). `GroupsPage` calls `fetchBellSchedules()` next to `fetchGroups()`.

Both group modals: schema `bellScheduleId: yup.string().default('')`; default `''` (edit: `group.bellScheduleId ?? ''`); read `kind` with `useWatch({ control, name: 'kind' })`; when `kind === 'school_class'` render:

```tsx
        <Controller
          name="bellScheduleId"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Розклад дзвінків" fullWidth>
              <MenuItem value="">Не обрано</MenuItem>
              {bellSchedules.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
            </TextField>
          )}
        />
```

Submit: create sends `bellScheduleId: values.kind === 'school_class' && values.bellScheduleId ? values.bellScheduleId : undefined`; edit sends `bellScheduleId: values.kind === 'school_class' && values.bellScheduleId ? values.bellScheduleId : null`.

- [ ] **Step 10: Menu and route**

`nav-items.ts`: import `TuneIcon from '@mui/icons-material/Tune'`; add `{ path: '/schedule-setup', label: 'Довідники розкладу', icon: TuneIcon, roles: ADMIN }` after «Календар». Router: `{ path: 'schedule-setup', element: <ScheduleSetupPage /> },`. Header `pageTitles`: `'/schedule-setup': 'Довідники розкладу'`.

- [ ] **Step 11: Verify and commit**

tsc vs baseline (no new errors), eslint on touched files 0 errors.

```bash
git add src/shared/api src/pages/scheduleSetup src/pages/groups src/widgets/sidebar/model/nav-items.ts src/widgets/header/ui/Header.tsx src/app/router/index.tsx
git status --short
git commit -m "feat: add timetable directories and class bell schedule"
```

(Unstage `children 2.ts` / `children 3.ts` if `git add src/shared/api` picked them up.)

---

### Task 8: Timetable page (grid and week)

**Files:**
- Create: `src/pages/schedule/index.ts`, `src/pages/schedule/model/scheduleStore.ts`, `src/pages/schedule/ui/SchedulePage.tsx`, `src/pages/schedule/ui/TimetableTab.tsx`, `src/pages/schedule/ui/EntryModal.tsx`, `src/pages/schedule/ui/WeekTab.tsx`, `src/pages/schedule/ui/ChangeDialog.tsx`
- Modify: `src/widgets/sidebar/model/nav-items.ts`, `src/app/router/index.tsx`, `src/widgets/header/ui/Header.tsx`

**Interfaces:**
- Consumes: `timetableApi`, types and helpers from Task 7 (`TimetableEntry`, `TimetableVersion`, `ClassSchedule`, `ScheduleConflict`, `ScheduleSlot`, `LessonChangeDto`, `weekdayLabels`, `weekParityLabels`, `weekParities`, `weekStart`, `addDaysIso`, `conflictText`), `groupsApi`, `usersApi`, `localToday`, `formatDay`, `ReasonDialog`.
- Produces: route `/schedule` (root/admin) replacing the `EmptyPage` stub; navigation to `/lessons/:groupId/:date/:period?subgroupId=` (page added in Task 9).

- [ ] **Step 1: Store `src/pages/schedule/model/scheduleStore.ts`**

```ts
import { create } from 'zustand';
import {
  groupsApi,
  localToday,
  timetableApi,
  usersApi,
  weekStart,
  addDaysIso,
  type BellSchedule,
  type ClassSchedule,
  type Group,
  type LessonChangeDto,
  type NamedItem,
  type ScheduleConflict,
  type Subgroup,
  type TimetableEntry,
  type TimetableVersion,
  type User,
} from '../../../shared/api';

interface ScheduleState {
  classes: Group[];
  subjects: NamedItem[];
  rooms: NamedItem[];
  teachers: User[];
  bellSchedules: BellSchedule[];
  metaFailed: boolean;
  classId: string | null;
  classKey: string | null;
  classFailed: boolean;
  subgroups: Subgroup[];
  versions: TimetableVersion[];
  versionId: string | 'new' | null;
  draft: TimetableEntry[];
  newValidFrom: string;
  conflicts: ScheduleConflict[];
  week: string;
  weekData: ClassSchedule | null;
  weekKey: string | null;
  weekFailed: boolean;
  isSaving: boolean;
  loadMeta: () => Promise<void>;
  setClassId: (classId: string) => void;
  selectClass: (classId: string) => Promise<void>;
  selectVersion: (versionId: string) => void;
  startNewVersion: (validFrom: string) => void;
  setDraft: (entries: TimetableEntry[]) => void;
  saveVersion: () => Promise<void>;
  setWeek: (week: string) => void;
  loadWeek: () => Promise<void>;
  createChange: (dto: LessonChangeDto) => Promise<void>;
  voidChange: (id: string, reason: string) => Promise<void>;
}

const currentVersion = (versions: TimetableVersion[]) => {
  const today = localToday();
  return versions.find((v) => v.validFrom <= today && (!v.validTo || v.validTo >= today)) ?? versions[versions.length - 1] ?? null;
};

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  classes: [],
  subjects: [],
  rooms: [],
  teachers: [],
  bellSchedules: [],
  metaFailed: false,
  classId: null,
  classKey: null,
  classFailed: false,
  subgroups: [],
  versions: [],
  versionId: null,
  draft: [],
  newValidFrom: localToday(),
  conflicts: [],
  week: weekStart(localToday()),
  weekData: null,
  weekKey: null,
  weekFailed: false,
  isSaving: false,
  loadMeta: async () => {
    set({ metaFailed: false });
    try {
      const [groups, subjects, rooms, users, bells] = await Promise.all([
        groupsApi.getList(),
        timetableApi.getSubjects(),
        timetableApi.getRooms(),
        usersApi.getList(),
        timetableApi.getBellSchedules(),
      ]);
      const classes = groups.data.filter((g) => g.kind === 'school_class');
      set((state) => ({
        classes,
        subjects: subjects.data,
        rooms: rooms.data,
        teachers: users.data.filter((u) => u.role === 'teacher'),
        bellSchedules: bells.data,
        classId: classes.some((c) => c.id === state.classId) ? state.classId : (classes[0]?.id ?? null),
      }));
    } catch (error) {
      set({ metaFailed: true });
      throw error;
    }
  },
  setClassId: (classId) => set({ classId }),
  selectClass: async (classId) => {
    const key = `${classId}/${Date.now()}`;
    set({ classId, classKey: key, classFailed: false, versions: [], subgroups: [], versionId: null, draft: [], conflicts: [], weekData: null, weekKey: null });
    try {
      const [versions, subgroups] = await Promise.all([timetableApi.getTimetables(classId), timetableApi.getSubgroups(classId)]);
      if (get().classKey !== key) return;
      const current = currentVersion(versions.data);
      set({ versions: versions.data, subgroups: subgroups.data, versionId: current?.id ?? null, draft: current?.entries ?? [] });
    } catch (error) {
      if (get().classKey === key) set({ classFailed: true });
      throw error;
    }
  },
  selectVersion: (versionId) => {
    const version = get().versions.find((v) => v.id === versionId);
    set({ versionId, draft: version?.entries ?? [], conflicts: [] });
  },
  startNewVersion: (validFrom) => {
    const base = currentVersion(get().versions);
    set({ versionId: 'new', newValidFrom: validFrom, draft: base?.entries.map((e) => ({ ...e })) ?? [], conflicts: [] });
  },
  setDraft: (entries) => set({ draft: entries, conflicts: [] }),
  saveVersion: async () => {
    const { classId, versionId, draft, newValidFrom } = get();
    if (!classId || !versionId) return;
    set({ isSaving: true, conflicts: [] });
    try {
      const { data } =
        versionId === 'new'
          ? await timetableApi.createTimetable(classId, newValidFrom, draft)
          : await timetableApi.replaceEntries(versionId, draft);
      const versions = await timetableApi.getTimetables(classId);
      if (get().classId === classId) {
        const saved = versions.data.find((v) => v.id === data.id);
        set({ versions: versions.data, versionId: data.id, draft: saved?.entries ?? [] });
      }
    } catch (error) {
      const conflicts = (error as { conflicts?: ScheduleConflict[] } | null)?.conflicts;
      if (conflicts) set({ conflicts });
      throw error;
    } finally {
      set({ isSaving: false });
    }
  },
  setWeek: (week) => set({ week }),
  loadWeek: async () => {
    const { classId, week } = get();
    if (!classId) return;
    const key = `${classId}/${week}`;
    set({ weekKey: key, weekData: null, weekFailed: false });
    try {
      const { data } = await timetableApi.getSchedule(classId, week, addDaysIso(week, 5));
      if (get().weekKey === key) set({ weekData: data });
    } catch (error) {
      if (get().weekKey === key) set({ weekFailed: true });
      throw error;
    }
  },
  createChange: async (dto) => {
    const { classId } = get();
    if (!classId) return;
    set({ isSaving: true });
    try {
      await timetableApi.createChange(classId, dto);
      await get().loadWeek();
    } finally {
      set({ isSaving: false });
    }
  },
  voidChange: async (id, reason) => {
    set({ isSaving: true });
    try {
      await timetableApi.voidChange(id, reason);
      await get().loadWeek();
    } finally {
      set({ isSaving: false });
    }
  },
}));

export const isEditableVersion = (versionId: string | 'new' | null, versions: TimetableVersion[]) =>
  versionId === 'new' || (versions.find((v) => v.id === versionId)?.validFrom ?? '') > localToday();
```

(Check `User` and `usersApi` exports in `shared/api/index.ts`; `User` comes from `entities/user` — import it from there if `shared/api` does not re-export it.)

- [ ] **Step 2: Entry modal `src/pages/schedule/ui/EntryModal.tsx`**

```tsx
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, MenuItem, TextField } from '@mui/material'
import { useScheduleStore } from '../model/scheduleStore'
import { weekParities, weekParityLabels, weekdayLabels, type TimetableEntry, type WeekParity } from '../../../shared/api'

const schema = yup.object({
  parity: yup.mixed<WeekParity>().oneOf(weekParities).required(),
  subjectId: yup.string().required('Оберіть предмет'),
  teacherId: yup.string().required('Оберіть вчителя'),
  roomId: yup.string().default(''),
  subgroupId: yup.string().default(''),
})

type FormValues = yup.InferType<typeof schema>

interface EntryModalProps {
  open: boolean
  weekday: number
  period: number
  entry: TimetableEntry | null
  onClose: () => void
  onSave: (entry: TimetableEntry) => void
  onDelete: () => void
}

export const EntryModal = ({ open, weekday, period, entry, onClose, onSave, onDelete }: EntryModalProps) => {
  const subjects = useScheduleStore((s) => s.subjects)
  const rooms = useScheduleStore((s) => s.rooms)
  const teachers = useScheduleStore((s) => s.teachers)
  const subgroups = useScheduleStore((s) => s.subgroups)
  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { parity: 'every', subjectId: '', teacherId: '', roomId: '', subgroupId: '' },
    resolver: yupResolver(schema),
  })

  useEffect(() => {
    if (!open) return
    reset({
      parity: entry?.parity ?? 'every',
      subjectId: entry?.subjectId ?? '',
      teacherId: entry?.teacherId ?? '',
      roomId: entry?.roomId ?? '',
      subgroupId: entry?.subgroupId ?? '',
    })
  }, [open, entry, reset])

  const submit = (values: FormValues) => {
    onSave({
      weekday,
      period,
      parity: values.parity,
      subjectId: values.subjectId,
      teacherId: values.teacherId,
      roomId: values.roomId || null,
      subgroupId: values.subgroupId || null,
    })
    onClose()
  }

  const select = (name: keyof FormValues, label: string, options: { id: string; label: string }[], optional = false) => (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <TextField {...field} select label={label} error={!!error} helperText={error?.message}>
          {optional && <MenuItem value="">Не вказано</MenuItem>}
          {options.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
        </TextField>
      )}
    />
  )

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{weekdayLabels[weekday - 1]}, {period}-й урок</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        {select('subjectId', 'Предмет', subjects.filter((s) => s.active || s.id === entry?.subjectId).map((s) => ({ id: s.id, label: s.name })))}
        {select('teacherId', 'Вчитель', teachers.map((t) => ({ id: t.id, label: `${t.lastName} ${t.firstName}` })))}
        {select('roomId', 'Кабінет', rooms.filter((r) => r.active || r.id === entry?.roomId).map((r) => ({ id: r.id, label: r.name })), true)}
        {select('subgroupId', 'Підгрупа', subgroups.filter((g) => g.active || g.id === entry?.subgroupId).map((g) => ({ id: g.id, label: g.name })), true)}
        {select('parity', 'Тижні', weekParities.map((p) => ({ id: p, label: weekParityLabels[p] })))}
        <Box sx={{ display: 'flex', gap: '10px' }}>
          {entry && (
            <Button color="error" onClick={() => { onDelete(); onClose() }} sx={{ width: '100%' }}>Видалити</Button>
          )}
          <Button onClick={onClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit(submit)} variant="contained" sx={{ width: '100%' }}>Готово</Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 3: Timetable tab `src/pages/schedule/ui/TimetableTab.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, MenuItem, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useScheduleStore, isEditableVersion } from '../model/scheduleStore'
import { EntryModal } from './EntryModal'
import { conflictText, formatDay, localToday, weekParityLabels, weekdayLabels, type TimetableEntry } from '../../../shared/api'

const WEEKDAYS = [1, 2, 3, 4, 5, 6]

export const TimetableTab = () => {
  const classes = useScheduleStore((s) => s.classes)
  const classId = useScheduleStore((s) => s.classId)
  const bellSchedules = useScheduleStore((s) => s.bellSchedules)
  const versions = useScheduleStore((s) => s.versions)
  const versionId = useScheduleStore((s) => s.versionId)
  const draft = useScheduleStore((s) => s.draft)
  const conflicts = useScheduleStore((s) => s.conflicts)
  const subjects = useScheduleStore((s) => s.subjects)
  const teachers = useScheduleStore((s) => s.teachers)
  const rooms = useScheduleStore((s) => s.rooms)
  const subgroups = useScheduleStore((s) => s.subgroups)
  const newValidFrom = useScheduleStore((s) => s.newValidFrom)
  const isSaving = useScheduleStore((s) => s.isSaving)
  const selectVersion = useScheduleStore((s) => s.selectVersion)
  const startNewVersion = useScheduleStore((s) => s.startNewVersion)
  const setDraft = useScheduleStore((s) => s.setDraft)
  const saveVersion = useScheduleStore((s) => s.saveVersion)
  const [cell, setCell] = useState<{ weekday: number; period: number; index: number | null } | null>(null)
  const [validFrom, setValidFrom] = useState(localToday())

  const cls = classes.find((c) => c.id === classId)
  const periods = useMemo(
    () => bellSchedules.find((b) => b.id === cls?.bellScheduleId)?.periods ?? [],
    [bellSchedules, cls?.bellScheduleId],
  )
  const editable = isEditableVersion(versionId, versions)
  const name = (list: { id: string; name: string }[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? '') : '')
  const teacherName = (id: string) => {
    const t = teachers.find((x) => x.id === id)
    return t ? `${t.lastName} ${t.firstName[0]}.` : ''
  }
  const conflicted = (weekday: number, period: number) =>
    conflicts.some((c) => c.weekday === weekday && c.period === period && c.groupName === cls?.name)

  if (!cls) return null
  if (!cls.bellScheduleId) return <Alert severity="info">Спочатку оберіть класу розклад дзвінків (Групи → редагувати клас).</Alert>

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <TextField select size="small" label="Версія" value={versionId ?? ''} onChange={(e) => selectVersion(e.target.value)} sx={{ minWidth: 240 }}>
          {versions.map((v) => (
            <MenuItem key={v.id} value={v.id}>з {formatDay(v.validFrom)}{v.validTo ? ` по ${formatDay(v.validTo)}` : ''}</MenuItem>
          ))}
          {versionId === 'new' && <MenuItem value="new">Нова з {formatDay(newValidFrom)}</MenuItem>}
        </TextField>
        <TextField size="small" type="date" label="Нова версія з" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <Button variant="outlined" disabled={!validFrom} onClick={() => startNewVersion(validFrom)}>Нова версія</Button>
        {editable && (
          <Button variant="contained" disabled={isSaving} onClick={() => saveVersion().catch(() => undefined)} sx={{ ml: 'auto' }}>Зберегти</Button>
        )}
      </Box>
      {!editable && versionId && <Alert severity="info" sx={{ mb: 2 }}>Ця версія вже діє. Щоб змінити розклад, створіть нову версію з потрібної дати.</Alert>}
      {versions.length === 0 && versionId === null && <Typography color="text.secondary" sx={{ mb: 2 }}>Розкладу ще немає. Створіть першу версію.</Typography>}
      {conflicts.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {conflicts.map((c, i) => <div key={i}>{conflictText(c)}</div>)}
        </Alert>
      )}
      {versionId && (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>Урок</TableCell>
                {WEEKDAYS.map((d) => <TableCell key={d}>{weekdayLabels[d - 1]}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {periods.map((p) => (
                <TableRow key={p.number}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{p.number}<Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{p.startTime}–{p.endTime}</Typography></TableCell>
                  {WEEKDAYS.map((d) => {
                    const items = draft.map((e, index) => ({ e, index })).filter(({ e }) => e.weekday === d && e.period === p.number)
                    return (
                      <TableCell
                        key={d}
                        onClick={() => editable && setCell({ weekday: d, period: p.number, index: null })}
                        sx={{ verticalAlign: 'top', minWidth: 140, cursor: editable ? 'pointer' : 'default', bgcolor: conflicted(d, p.number) ? 'rgba(211, 47, 47, 0.12)' : undefined }}
                      >
                        {items.map(({ e, index }) => (
                          <Box
                            key={index}
                            onClick={(ev) => { ev.stopPropagation(); if (editable) setCell({ weekday: d, period: p.number, index }) }}
                            sx={{ mb: 0.5, p: 0.5, borderRadius: 1, bgcolor: 'grey.50' }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{name(subjects, e.subjectId)}</Typography>
                            <Typography variant="caption" sx={{ display: 'block' }}>{teacherName(e.teacherId)}{e.roomId ? `, ${name(rooms, e.roomId)}` : ''}</Typography>
                            {e.subgroupId && <Chip size="small" label={name(subgroups, e.subgroupId)} sx={{ mr: 0.5 }} />}
                            {e.parity !== 'every' && <Chip size="small" variant="outlined" label={weekParityLabels[e.parity]} />}
                          </Box>
                        ))}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {cell && (
        <EntryModal
          open
          weekday={cell.weekday}
          period={cell.period}
          entry={cell.index === null ? null : draft[cell.index]}
          onClose={() => setCell(null)}
          onSave={(entry: TimetableEntry) =>
            setDraft(cell.index === null ? [...draft, entry] : draft.map((e, i) => (i === cell.index ? entry : e)))
          }
          onDelete={() => setDraft(draft.filter((_, i) => i !== cell.index))}
        />
      )}
    </Box>
  )
}
```

- [ ] **Step 4: Change dialog `src/pages/schedule/ui/ChangeDialog.tsx`**

```tsx
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, MenuItem, TextField } from '@mui/material'
import { useScheduleStore } from '../model/scheduleStore'
import { formatDay, type LessonChangeDto, type ScheduleSlot } from '../../../shared/api'

const schema = yup.object({
  period: yup.string().default(''),
  subgroupId: yup.string().default(''),
  subjectId: yup.string().default(''),
  teacherId: yup.string().default(''),
  roomId: yup.string().default(''),
  reason: yup.string().trim().required('Вкажіть причину').max(500, 'Максимум 500 символів'),
})

type FormValues = yup.InferType<typeof schema>

interface ChangeDialogProps {
  mode: 'replace' | 'extra'
  date: string
  slot: ScheduleSlot | null
  onClose: () => void
}

export const ChangeDialog = ({ mode, date, slot, onClose }: ChangeDialogProps) => {
  const subjects = useScheduleStore((s) => s.subjects)
  const teachers = useScheduleStore((s) => s.teachers)
  const rooms = useScheduleStore((s) => s.rooms)
  const subgroups = useScheduleStore((s) => s.subgroups)
  const periods = useScheduleStore((s) => s.weekData?.periods ?? null)
  const isSaving = useScheduleStore((s) => s.isSaving)
  const createChange = useScheduleStore((s) => s.createChange)
  const { control, handleSubmit, reset } = useForm<FormValues>({ mode: 'all', resolver: yupResolver(schema) })

  useEffect(() => {
    reset({ period: slot ? String(slot.period) : '', subgroupId: '', subjectId: '', teacherId: '', roomId: '', reason: '' })
  }, [slot, reset])

  const submit = async (values: FormValues) => {
    const dto: LessonChangeDto = {
      date,
      period: slot ? slot.period : Number(values.period),
      subgroupId: slot ? (slot.subgroupId ?? undefined) : values.subgroupId || undefined,
      type: mode,
      subjectId: values.subjectId || undefined,
      teacherId: values.teacherId || undefined,
      roomId: values.roomId || undefined,
      reason: values.reason.trim(),
    }
    await createChange(dto)
    onClose()
  }

  const select = (name: keyof FormValues, label: string, options: { id: string; label: string }[]) => (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <TextField {...field} select label={label} error={!!error} helperText={error?.message}>
          <MenuItem value="">{mode === 'replace' ? 'Без змін' : 'Не вказано'}</MenuItem>
          {options.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
        </TextField>
      )}
    />
  )

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>
        {mode === 'replace' ? `Заміна: ${formatDay(date)}, ${slot?.period}-й урок` : `Додатковий урок: ${formatDay(date)}`}
      </DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        {mode === 'extra' && select('period', 'Урок', (periods ?? []).map((p) => ({ id: String(p.number), label: `${p.number}-й (${p.startTime}–${p.endTime})` })))}
        {mode === 'extra' && select('subgroupId', 'Підгрупа', subgroups.filter((g) => g.active).map((g) => ({ id: g.id, label: g.name })))}
        {select('subjectId', 'Предмет', subjects.filter((s) => s.active).map((s) => ({ id: s.id, label: s.name })))}
        {select('teacherId', 'Вчитель', teachers.map((t) => ({ id: t.id, label: `${t.lastName} ${t.firstName}` })))}
        {select('roomId', 'Кабінет', rooms.filter((r) => r.active).map((r) => ({ id: r.id, label: r.name })))}
        <Controller
          name="reason"
          control={control}
          render={({ field, fieldState: { error } }) => <TextField {...field} label="Причина" error={!!error} helperText={error?.message} />}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={onClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit((v) => submit(v).catch(() => undefined))} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>Зберегти</Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 5: Week tab `src/pages/schedule/ui/WeekTab.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Chip, IconButton, Paper, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useScheduleStore } from '../model/scheduleStore'
import { ChangeDialog } from './ChangeDialog'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import { addDaysIso, formatDay, weekdayLabels, type ScheduleSlot } from '../../../shared/api'

type Action =
  | { kind: 'cancel' | 'replace'; date: string; slot: ScheduleSlot }
  | { kind: 'void'; date: string; slot: ScheduleSlot }
  | { kind: 'extra'; date: string }

export const WeekTab = () => {
  const navigate = useNavigate()
  const classId = useScheduleStore((s) => s.classId)
  const week = useScheduleStore((s) => s.week)
  const weekData = useScheduleStore((s) => s.weekData)
  const weekFailed = useScheduleStore((s) => s.weekFailed)
  const isSaving = useScheduleStore((s) => s.isSaving)
  const setWeek = useScheduleStore((s) => s.setWeek)
  const loadWeek = useScheduleStore((s) => s.loadWeek)
  const createChange = useScheduleStore((s) => s.createChange)
  const voidChange = useScheduleStore((s) => s.voidChange)
  const [action, setAction] = useState<Action | null>(null)

  useEffect(() => {
    if (classId) loadWeek().catch(() => undefined)
  }, [classId, week, loadWeek])

  const openLesson = (date: string, slot: ScheduleSlot) =>
    navigate(`/lessons/${classId}/${date}/${slot.period}${slot.subgroupId ? `?subgroupId=${slot.subgroupId}` : ''}`)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => setWeek(addDaysIso(week, -7))}><ChevronLeftIcon /></IconButton>
        <Typography sx={{ minWidth: 200, textAlign: 'center' }}>{formatDay(week)} – {formatDay(addDaysIso(week, 5))}</Typography>
        <IconButton onClick={() => setWeek(addDaysIso(week, 7))}><ChevronRightIcon /></IconButton>
      </Box>
      {weekFailed ? (
        <Alert severity="error" action={<Button onClick={() => loadWeek().catch(() => undefined)}>Спробувати ще</Button>}>Не вдалося завантажити дані.</Alert>
      ) : !weekData ? (
        <Typography color="text.secondary">Завантаження…</Typography>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1.5 }}>
          {weekData.days.map((d, i) => (
            <Paper key={d.date} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
              <Typography sx={{ fontWeight: 700 }}>{weekdayLabels[i]} {formatDay(d.date)}</Typography>
              {!d.working && <Typography variant="body2" color="text.secondary">Неробочий день{d.title ? `: ${d.title}` : ''}</Typography>}
              {d.slots.map((s, j) => (
                <Box key={j} sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', opacity: s.cancelled ? 0.6 : 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: s.cancelled ? 'line-through' : 'none', cursor: s.cancelled ? 'default' : 'pointer' }} onClick={() => !s.cancelled && openLesson(d.date, s)}>
                    {s.period}. {s.subjectName}{s.subgroupName ? ` (${s.subgroupName})` : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block' }}>{s.startTime}–{s.endTime}, {s.teacherName}{s.roomName ? `, ${s.roomName}` : ''}</Typography>
                  {s.source === 'replace' && <Chip size="small" color="warning" label="Заміна" sx={{ mr: 0.5 }} />}
                  {s.source === 'extra' && <Chip size="small" color="info" label="Додатковий" sx={{ mr: 0.5 }} />}
                  {s.lessonId && <Chip size="small" color="success" variant="outlined" label="Проведено" />}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {!s.cancelled && <Button size="small" onClick={() => setAction({ kind: 'replace', date: d.date, slot: s })}>Заміна</Button>}
                    {!s.cancelled && s.source === 'timetable' && <Button size="small" color="error" onClick={() => setAction({ kind: 'cancel', date: d.date, slot: s })}>Скасувати</Button>}
                    {s.changeId && <Button size="small" onClick={() => setAction({ kind: 'void', date: d.date, slot: s })}>Відмінити зміну</Button>}
                  </Box>
                </Box>
              ))}
              {d.working && <Button size="small" sx={{ mt: 1 }} onClick={() => setAction({ kind: 'extra', date: d.date })}>Додатковий урок</Button>}
            </Paper>
          ))}
        </Box>
      )}
      {action && (action.kind === 'replace' || action.kind === 'extra') && (
        <ChangeDialog mode={action.kind} date={action.date} slot={action.kind === 'replace' ? action.slot : null} onClose={() => setAction(null)} />
      )}
      <ReasonDialog
        open={action?.kind === 'cancel' || action?.kind === 'void'}
        title={action?.kind === 'void' ? 'Відмінити зміну' : 'Скасувати урок'}
        subtitle={action && action.kind !== 'extra' ? `${formatDay(action.date)}, ${action.slot.period}-й урок` : undefined}
        confirmLabel="Підтвердити"
        isSaving={isSaving}
        onClose={() => setAction(null)}
        onSubmit={async (reason) => {
          if (!action || action.kind === 'extra' || action.kind === 'replace') return
          if (action.kind === 'void' && action.slot.changeId) await voidChange(action.slot.changeId, reason)
          if (action.kind === 'cancel') {
            await createChange({ date: action.date, period: action.slot.period, subgroupId: action.slot.subgroupId ?? undefined, type: 'cancel', reason })
          }
          setAction(null)
        }}
      />
    </Box>
  )
}
```

- [ ] **Step 6: Page `src/pages/schedule/ui/SchedulePage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Alert, Box, Button, MenuItem, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useScheduleStore } from '../model/scheduleStore'
import { TimetableTab } from './TimetableTab'
import { WeekTab } from './WeekTab'

export const SchedulePage = () => {
  const classes = useScheduleStore((s) => s.classes)
  const classId = useScheduleStore((s) => s.classId)
  const metaFailed = useScheduleStore((s) => s.metaFailed)
  const classFailed = useScheduleStore((s) => s.classFailed)
  const loadMeta = useScheduleStore((s) => s.loadMeta)
  const selectClass = useScheduleStore((s) => s.selectClass)
  const setClassId = useScheduleStore((s) => s.setClassId)
  const [tab, setTab] = useState(0)

  useEffect(() => {
    loadMeta().catch(() => undefined)
  }, [loadMeta])

  useEffect(() => {
    if (classId) selectClass(classId).catch(() => undefined)
  }, [classId, selectClass])

  if (metaFailed) {
    return <Alert severity="error" action={<Button onClick={() => loadMeta().catch(() => undefined)}>Спробувати ще</Button>}>Не вдалося завантажити дані.</Alert>
  }
  if (classes.length === 0) return <Typography color="text.secondary">Немає шкільних класів. Поставте групі тип «Клас».</Typography>

  return (
    <Box>
      <TextField select size="small" label="Клас" value={classId ?? ''} onChange={(e) => setClassId(e.target.value)} sx={{ minWidth: 200, mb: 2 }}>
        {classes.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
      </TextField>
      {classFailed && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => classId && selectClass(classId).catch(() => undefined)}>Спробувати ще</Button>}>
          Не вдалося завантажити дані.
        </Alert>
      )}
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Розклад" />
        <Tab label="Тиждень" />
      </Tabs>
      {tab === 0 && <TimetableTab />}
      {tab === 1 && <WeekTab />}
    </Box>
  )
}
```

(The class is loaded only by the `classId` effect; the select just sets `classId`.)

`src/pages/schedule/index.ts`: `export { SchedulePage } from './ui/SchedulePage'`

- [ ] **Step 7: Menu and route**

`nav-items.ts`: import `ViewWeekIcon from '@mui/icons-material/ViewWeek'`; add `{ path: '/schedule', label: 'Розклад', icon: ViewWeekIcon, roles: ADMIN }` after «Журнал». Router: replace `{ path: 'schedule', element: <EmptyPage title="Розклад" /> }` with `<SchedulePage />`. Header `pageTitles` already has `'/schedule': 'Розклад'`.

- [ ] **Step 8: Verify and commit**

tsc vs baseline, eslint on touched files.

```bash
git add src/pages/schedule src/widgets/sidebar/model/nav-items.ts src/app/router/index.tsx src/widgets/header/ui/Header.tsx
git commit -m "feat: add timetable grid and weekly schedule changes"
```

---

### Task 9: Teacher lessons, lesson page, parent tabs, docs

**Files:**
- Create: `src/pages/myLessons/index.ts`, `src/pages/myLessons/model/myLessonsStore.ts`, `src/pages/myLessons/ui/MyLessonsPage.tsx`, `src/pages/lesson/index.ts`, `src/pages/lesson/model/lessonStore.ts`, `src/pages/lesson/ui/LessonPage.tsx`, `src/pages/familyChild/model/childScheduleStore.ts`, `src/pages/familyChild/ui/ScheduleTab.tsx`, `src/pages/familyChild/ui/LessonsBlock.tsx`
- Modify: `src/pages/familyChild/model/childAttendanceStore.ts`, `src/pages/familyChild/ui/AttendanceTab.tsx`, `src/pages/familyChild/ui/FamilyChildPage.tsx`, `src/widgets/sidebar/model/nav-items.ts`, `src/app/router/index.tsx`, `src/widgets/header/ui/Header.tsx`, `CLAUDE.md`

**Interfaces:**
- Consumes: `timetableApi.getMyLessons/getLesson/saveLesson`, `parentCabinetApi.getSchedule/getLessons`, `registerApi.getReasons`, types and labels from Task 7, `ReasonDialog`, `useAuthStore`.
- Produces: routes `/my-lessons` (teacher), `/lessons/:groupId/:date/:period` (root/admin/teacher); parent tab «Розклад»; «Уроки» block in «Відвідування».

- [ ] **Step 1: My lessons**

`src/pages/myLessons/model/myLessonsStore.ts`:

```ts
import { create } from 'zustand';
import { localToday, timetableApi, type MyLessons } from '../../../shared/api';

interface MyLessonsState {
  date: string;
  data: MyLessons | null;
  loadFailed: boolean;
  setDate: (date: string) => void;
  load: () => Promise<void>;
}

export const useMyLessonsStore = create<MyLessonsState>((set, get) => ({
  date: localToday(),
  data: null,
  loadFailed: false,
  setDate: (date) => set({ date }),
  load: async () => {
    const date = get().date;
    set({ data: null, loadFailed: false });
    try {
      const { data } = await timetableApi.getMyLessons(date);
      if (get().date === date) set({ data });
    } catch (error) {
      if (get().date === date) set({ loadFailed: true });
      throw error;
    }
  },
}));
```

`src/pages/myLessons/ui/MyLessonsPage.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Chip, Paper, TextField, Typography } from '@mui/material'
import { useMyLessonsStore } from '../model/myLessonsStore'

export const MyLessonsPage = () => {
  const navigate = useNavigate()
  const date = useMyLessonsStore((s) => s.date)
  const data = useMyLessonsStore((s) => s.data)
  const loadFailed = useMyLessonsStore((s) => s.loadFailed)
  const setDate = useMyLessonsStore((s) => s.setDate)
  const load = useMyLessonsStore((s) => s.load)

  useEffect(() => {
    load().catch(() => undefined)
  }, [date, load])

  return (
    <Box>
      <TextField size="small" type="date" label="Дата" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ mb: 2 }} />
      {loadFailed ? (
        <Alert severity="error" action={<Button onClick={() => load().catch(() => undefined)}>Спробувати ще</Button>}>Не вдалося завантажити дані.</Alert>
      ) : !data || data.date !== date ? (
        <Typography color="text.secondary">Завантаження…</Typography>
      ) : data.lessons.length === 0 ? (
        <Typography color="text.secondary">Уроків на цей день немає.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {data.lessons.map((l) => (
            <Paper
              key={`${l.group.id}-${l.period}-${l.subgroupId ?? 'class'}`}
              elevation={0}
              onClick={() => navigate(`/lessons/${l.group.id}/${date}/${l.period}${l.subgroupId ? `?subgroupId=${l.subgroupId}` : ''}`)}
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, cursor: 'pointer' }}
            >
              <Typography sx={{ fontWeight: 600 }}>{l.startTime}–{l.endTime} · {l.subjectName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {l.group.name}{l.subgroupName ? `, ${l.subgroupName}` : ''}{l.roomName ? `, каб. ${l.roomName}` : ''}
              </Typography>
              {l.source === 'replace' && <Chip size="small" color="warning" label="Заміна" sx={{ mr: 0.5, mt: 0.5 }} />}
              {l.source === 'extra' && <Chip size="small" color="info" label="Додатковий" sx={{ mr: 0.5, mt: 0.5 }} />}
              {l.lessonId && <Chip size="small" color="success" variant="outlined" label="Проведено" sx={{ mt: 0.5 }} />}
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  )
}
```

`src/pages/myLessons/index.ts`: `export { MyLessonsPage } from './ui/MyLessonsPage'`

- [ ] **Step 2: Lesson store `src/pages/lesson/model/lessonStore.ts`**

```ts
import { create } from 'zustand';
import {
  registerApi,
  timetableApi,
  type AbsenceReason,
  type LessonMarkDto,
  type LessonPupil,
  type LessonStatus,
  type LessonView,
  type NushLevel,
} from '../../../shared/api';

export interface PupilDraft {
  status: LessonStatus | null;
  reasonId: string | null;
  level: NushLevel | null;
  comment: string;
}

export const pupilBaseline = (p: LessonPupil): PupilDraft => {
  if (p.mark) return { status: p.mark.status, reasonId: p.mark.reasonId, level: p.mark.level, comment: p.mark.comment ?? '' };
  if (p.state.source === 'register') return { status: 'absent', reasonId: p.state.reasonId, level: null, comment: '' };
  return { status: null, reasonId: null, level: null, comment: '' };
};

export const sameDraft = (a: PupilDraft, b: PupilDraft) =>
  a.status === b.status && a.reasonId === b.reasonId && a.level === b.level && a.comment.trim() === b.comment.trim();

interface LessonRef {
  groupId: string;
  date: string;
  period: number;
  subgroupId?: string;
}

interface LessonState {
  key: string | null;
  ref: LessonRef | null;
  view: LessonView | null;
  reasons: AbsenceReason[];
  draft: Record<string, PupilDraft>;
  topic: string;
  homework: string;
  loadFailed: boolean;
  isSaving: boolean;
  load: (ref: LessonRef) => Promise<void>;
  setPupil: (childId: string, patch: Partial<PupilDraft>) => void;
  setTopic: (topic: string) => void;
  setHomework: (homework: string) => void;
  markAllPresent: () => void;
  save: (reason?: string) => Promise<void>;
}

const keyOf = (r: LessonRef) => `${r.groupId}/${r.date}/${r.period}/${r.subgroupId ?? 'class'}`;

const fromView = (view: LessonView) => ({
  view,
  draft: Object.fromEntries(view.pupils.map((p) => [p.child.id, pupilBaseline(p)])),
  topic: view.lesson?.topic ?? '',
  homework: view.lesson?.homework ?? '',
});

export const useLessonStore = create<LessonState>((set, get) => ({
  key: null,
  ref: null,
  view: null,
  reasons: [],
  draft: {},
  topic: '',
  homework: '',
  loadFailed: false,
  isSaving: false,
  load: async (ref) => {
    const key = keyOf(ref);
    set({ key, ref, view: null, draft: {}, loadFailed: false });
    try {
      const [{ data }, { data: reasons }] = await Promise.all([
        timetableApi.getLesson(ref.groupId, ref.date, ref.period, ref.subgroupId),
        registerApi.getReasons(),
      ]);
      if (get().key === key) set({ ...fromView(data), reasons });
    } catch (error) {
      if (get().key === key) set({ loadFailed: true });
      throw error;
    }
  },
  setPupil: (childId, patch) =>
    set((state) => {
      const next = { ...state.draft[childId], ...patch };
      if (next.status !== 'absent') next.reasonId = null;
      if (next.status === 'absent') next.level = null;
      return { draft: { ...state.draft, [childId]: next } };
    }),
  setTopic: (topic) => set({ topic }),
  setHomework: (homework) => set({ homework }),
  markAllPresent: () =>
    set((state) => ({
      draft: Object.fromEntries(
        Object.entries(state.draft).map(([id, d]) => [id, d.status ? d : { ...d, status: 'present' as const }]),
      ),
    })),
  save: async (reason) => {
    const { ref, view, draft, topic, homework, key } = get();
    if (!ref || !view) return;
    const marks: LessonMarkDto[] = view.pupils.flatMap((p) => {
      const d = draft[p.child.id];
      if (!d?.status || sameDraft(d, pupilBaseline(p))) return [];
      return [{
        childId: p.child.id,
        status: d.status,
        reasonId: d.status === 'absent' && d.reasonId ? d.reasonId : undefined,
        level: d.status !== 'absent' && d.level ? d.level : undefined,
        comment: d.comment.trim() || undefined,
      }];
    });
    const topicChanged = topic.trim() !== (view.lesson?.topic ?? '');
    const homeworkChanged = homework.trim() !== (view.lesson?.homework ?? '');
    if (!marks.length && !topicChanged && !homeworkChanged) return;
    set({ isSaving: true });
    try {
      const { data } = await timetableApi.saveLesson(ref.groupId, ref.date, ref.period, ref.subgroupId, {
        topic: topicChanged ? topic.trim() : undefined,
        homework: homeworkChanged ? homework.trim() : undefined,
        reason,
        marks,
      });
      if (get().key === key) set(fromView(data));
    } finally {
      set({ isSaving: false });
    }
  },
}));
```

- [ ] **Step 3: Lesson page `src/pages/lesson/ui/LessonPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, IconButton, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useLessonStore, pupilBaseline, sameDraft } from '../model/lessonStore'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import { formatDay, lessonStatusLabels, lessonStatuses, nushLevelLabels, nushLevels, type LessonStatus, type NushLevel } from '../../../shared/api'

export const LessonPage = () => {
  const { groupId = '', date = '', period = '' } = useParams<{ groupId: string; date: string; period: string }>()
  const [search] = useSearchParams()
  const subgroupId = search.get('subgroupId') ?? undefined
  const navigate = useNavigate()
  const view = useLessonStore((s) => s.view)
  const key = useLessonStore((s) => s.key)
  const draft = useLessonStore((s) => s.draft)
  const reasons = useLessonStore((s) => s.reasons)
  const topic = useLessonStore((s) => s.topic)
  const homework = useLessonStore((s) => s.homework)
  const loadFailed = useLessonStore((s) => s.loadFailed)
  const isSaving = useLessonStore((s) => s.isSaving)
  const load = useLessonStore((s) => s.load)
  const setPupil = useLessonStore((s) => s.setPupil)
  const setTopic = useLessonStore((s) => s.setTopic)
  const setHomework = useLessonStore((s) => s.setHomework)
  const markAllPresent = useLessonStore((s) => s.markAllPresent)
  const save = useLessonStore((s) => s.save)
  const [reasonOpen, setReasonOpen] = useState(false)
  const ref = { groupId, date, period: Number(period), subgroupId }
  const expectedKey = `${groupId}/${date}/${period}/${subgroupId ?? 'class'}`

  useEffect(() => {
    load({ groupId, date, period: Number(period), subgroupId }).catch(() => undefined)
  }, [groupId, date, period, subgroupId, load])

  if (loadFailed && key === expectedKey) {
    return <Alert severity="error" action={<Button onClick={() => load(ref).catch(() => undefined)}>Спробувати ще</Button>}>Не вдалося завантажити дані.</Alert>
  }
  if (!view || key !== expectedKey) return <Typography color="text.secondary">Завантаження…</Typography>

  const dirty =
    view.pupils.some((p) => draft[p.child.id] && !sameDraft(draft[p.child.id], pupilBaseline(p))) ||
    topic.trim() !== (view.lesson?.topic ?? '') ||
    homework.trim() !== (view.lesson?.homework ?? '')
  const reasonOptions = (current: string | null) => reasons.filter((r) => r.active || r.id === current)

  const handleSave = () => {
    if (view.needsReason) {
      setReasonOpen(true)
      return
    }
    save().catch(() => undefined)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
        <Box sx={{ mr: 'auto' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{view.slot.subjectName}, {view.group.name}{view.slot.subgroupName ? ` (${view.slot.subgroupName})` : ''}</Typography>
          <Typography variant="body2" color="text.secondary">{formatDay(view.date)}, {view.slot.period}-й урок, {view.slot.startTime}–{view.slot.endTime}</Typography>
        </Box>
        {view.canEdit && <Button variant="outlined" onClick={markAllPresent}>Усі присутні</Button>}
        {view.canEdit && <Button variant="contained" disabled={isSaving || !dirty} onClick={handleSave}>Зберегти</Button>}
      </Box>
      {!view.canEdit && <Alert severity="warning" sx={{ mb: 2 }}>Редагування цього уроку закрите.</Alert>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
        <TextField label="Тема уроку" value={topic} disabled={!view.canEdit} onChange={(e) => setTopic(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
        <TextField label="Домашнє завдання" value={homework} disabled={!view.canEdit} multiline minRows={2} onChange={(e) => setHomework(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {view.pupils.map((p) => {
          const d = draft[p.child.id] ?? pupilBaseline(p)
          const changed = !sameDraft(d, pupilBaseline(p))
          return (
            <Paper key={p.child.id} elevation={0} sx={{ border: '1px solid', borderColor: changed ? 'warning.main' : 'divider', borderRadius: 2, p: 1.5, opacity: p.state.source === 'register' && !changed ? 0.7 : 1 }}>
              <Typography sx={{ fontWeight: 600, mb: 1 }}>
                {p.child.lastName} {p.child.firstName}
                {p.state.source === 'register' && <Typography component="span" variant="caption" color="text.secondary"> · відсутній за журналом</Typography>}
              </Typography>
              <ToggleButtonGroup size="small" exclusive disabled={!view.canEdit} value={d.status} onChange={(_, v: LessonStatus | null) => v && setPupil(p.child.id, { status: v })} sx={{ flexWrap: 'wrap' }}>
                {lessonStatuses.map((s) => <ToggleButton key={s} value={s}>{lessonStatusLabels[s]}</ToggleButton>)}
              </ToggleButtonGroup>
              {d.status === 'absent' && (
                <TextField select size="small" label="Причина" disabled={!view.canEdit} value={d.reasonId ?? ''} onChange={(e) => setPupil(p.child.id, { reasonId: e.target.value || null })} sx={{ mt: 1.5, minWidth: 220, display: 'flex' }}>
                  <MenuItem value="">Не вказано</MenuItem>
                  {reasonOptions(d.reasonId).map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
                </TextField>
              )}
              {d.status && d.status !== 'absent' && (
                <ToggleButtonGroup size="small" exclusive disabled={!view.canEdit} value={d.level} onChange={(_, v: NushLevel | null) => setPupil(p.child.id, { level: v })} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                  {nushLevels.map((l) => <ToggleButton key={l} value={l} sx={{ textTransform: 'none' }}>{nushLevelLabels[l]}</ToggleButton>)}
                </ToggleButtonGroup>
              )}
              <TextField size="small" fullWidth label="Коментар (бачать батьки)" disabled={!view.canEdit} value={d.comment} onChange={(e) => setPupil(p.child.id, { comment: e.target.value })} sx={{ mt: 1.5 }} slotProps={{ htmlInput: { maxLength: 500 } }} />
            </Paper>
          )
        })}
      </Box>
      <ReasonDialog
        open={reasonOpen}
        title="Виправлення уроку"
        subtitle="Термін виправлення для вчителя минув. Вкажіть причину."
        confirmLabel="Зберегти"
        isSaving={isSaving}
        onClose={() => setReasonOpen(false)}
        onSubmit={async (reason) => {
          await save(reason)
          setReasonOpen(false)
        }}
      />
    </Box>
  )
}
```

`src/pages/lesson/index.ts`: `export { LessonPage } from './ui/LessonPage'`

- [ ] **Step 4: Parent schedule tab**

`src/pages/familyChild/model/childScheduleStore.ts`:

```ts
import { create } from 'zustand';
import { addDaysIso, localToday, parentCabinetApi, weekStart, type ParentSchedule } from '../../../shared/api';

interface ChildScheduleState {
  childId: string | null;
  week: string;
  key: string | null;
  data: ParentSchedule | null;
  loadFailed: boolean;
  load: (childId: string, week?: string) => Promise<void>;
}

export const useChildScheduleStore = create<ChildScheduleState>((set, get) => ({
  childId: null,
  week: weekStart(localToday()),
  key: null,
  data: null,
  loadFailed: false,
  load: async (childId, week = get().week) => {
    const key = `${childId}/${week}`;
    set({ childId, week, key, data: null, loadFailed: false });
    try {
      const { data } = await parentCabinetApi.getSchedule(childId, week, addDaysIso(week, 5));
      if (get().key === key) set({ data });
    } catch (error) {
      if (get().key === key) set({ loadFailed: true });
      throw error;
    }
  },
}));
```

`src/pages/familyChild/ui/ScheduleTab.tsx`:

```tsx
import { useEffect } from 'react'
import { Alert, Box, Button, Chip, IconButton, Paper, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useChildScheduleStore } from '../model/childScheduleStore'
import { addDaysIso, formatDay, weekdayLabels } from '../../../shared/api'

export const ScheduleTab = ({ childId }: { childId: string }) => {
  const week = useChildScheduleStore((s) => s.week)
  const key = useChildScheduleStore((s) => s.key)
  const data = useChildScheduleStore((s) => s.data)
  const loadFailed = useChildScheduleStore((s) => s.loadFailed)
  const load = useChildScheduleStore((s) => s.load)

  useEffect(() => {
    load(childId).catch(() => undefined)
  }, [childId, load])

  const ready = key === `${childId}/${week}` && data !== null

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => load(childId, addDaysIso(week, -7)).catch(() => undefined)}><ChevronLeftIcon /></IconButton>
        <Typography sx={{ minWidth: 200, textAlign: 'center' }}>{formatDay(week)} – {formatDay(addDaysIso(week, 5))}</Typography>
        <IconButton onClick={() => load(childId, addDaysIso(week, 7)).catch(() => undefined)}><ChevronRightIcon /></IconButton>
      </Box>
      {loadFailed && key === `${childId}/${week}` ? (
        <Alert severity="error" action={<Button onClick={() => load(childId).catch(() => undefined)}>Спробувати ще</Button>}>Не вдалося завантажити дані.</Alert>
      ) : !ready ? (
        <Typography color="text.secondary">Завантаження…</Typography>
      ) : data.days.length === 0 ? (
        <Typography color="text.secondary">Розкладу немає.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {data.days.map((d, i) => (
            <Paper key={d.date} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
              <Typography sx={{ fontWeight: 700 }}>{weekdayLabels[i]} {formatDay(d.date)}</Typography>
              {!d.working && <Typography variant="body2" color="text.secondary">Неробочий день{d.title ? `: ${d.title}` : ''}</Typography>}
              {d.working && d.slots.length === 0 && <Typography variant="body2" color="text.secondary">Уроків немає.</Typography>}
              {d.slots.map((s, j) => (
                <Box key={j} sx={{ mt: 1, opacity: s.cancelled ? 0.6 : 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: s.cancelled ? 'line-through' : 'none' }}>
                    {s.startTime} {s.subjectName}{s.subgroupName ? ` (${s.subgroupName})` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{s.teacherName}{s.roomName ? `, каб. ${s.roomName}` : ''}</Typography>
                  {s.replaced && <Chip size="small" color="warning" label="Заміна" sx={{ ml: 1 }} />}
                  {s.cancelled && <Chip size="small" label="Скасовано" sx={{ ml: 1 }} />}
                  {s.topic && <Typography variant="body2">Тема: {s.topic}</Typography>}
                  {s.homework && <Typography variant="body2">Домашнє завдання: {s.homework}</Typography>}
                </Box>
              ))}
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 5: Lessons block in «Відвідування»**

`childAttendanceStore.ts`: add `lessons: ParentLessons | null` (initial `null`; import `type ParentLessons`); in `setMonth` load both:

```ts
      const [{ data }, { data: lessons }] = await Promise.all([
        parentCabinetApi.getRegister(childId, month),
        parentCabinetApi.getLessons(childId, month),
      ]);
      if (get().registerKey === key) set({ register: data, lessons });
```

and reset `lessons: null` wherever `register: null` is reset.

`src/pages/familyChild/ui/LessonsBlock.tsx`:

```tsx
import { Box, Chip, Paper, Typography } from '@mui/material'
import { formatDay, lessonStatusLabels, nushLevelLabels, nushLevels, type ParentLessons } from '../../../shared/api'

export const LessonsBlock = ({ lessons }: { lessons: ParentLessons }) => {
  const missed = lessons.lessons.filter((l) => l.status === 'absent')
  const levels = lessons.lessons.filter((l) => l.level)
  if (lessons.lessons.length === 0) return null
  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Typography sx={{ fontWeight: 600, mb: 1 }}>Уроки</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Chip variant="outlined" color="error" label={`Пропущено уроків: ${lessons.summary.missed}`} />
        <Chip variant="outlined" color="warning" label={`З поважної причини: ${lessons.summary.missedExcused}`} />
      </Box>
      {missed.map((l) => (
        <Typography key={`${l.date}-${l.period}`} variant="body2">
          {formatDay(l.date)}, {l.period}-й урок, {l.subjectName}: {lessonStatusLabels[l.status]}{l.reasonName ? `, ${l.reasonName}` : ''}
        </Typography>
      ))}
      {lessons.summary.bySubject.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Оцінювання (НУШ)</Typography>
          {lessons.summary.bySubject.map((s) => (
            <Typography key={s.subjectName} variant="body2">
              {s.subjectName}: {nushLevels.filter((l) => s.levels[l] > 0).map((l) => `${nushLevelLabels[l]} — ${s.levels[l]}`).join('; ')}
            </Typography>
          ))}
        </Box>
      )}
      {levels.filter((l) => l.comment).map((l) => (
        <Typography key={`c-${l.date}-${l.period}`} variant="body2" color="text.secondary">
          {formatDay(l.date)}, {l.subjectName}: {l.comment}
        </Typography>
      ))}
    </Paper>
  )
}
```

In `AttendanceTab.tsx` read `const lessons = useChildAttendanceStore((s) => s.lessons)` and render `{ready && lessons && <LessonsBlock lessons={lessons} />}` after the month grid.

`FamilyChildPage.tsx`: add `<Tab label="Розклад" />` after «Картка» and shift indexes: 0 Картка, 1 Розклад (`<ScheduleTab childId={card.id} />`), 2 Відвідування, 3 Фінанси.

- [ ] **Step 6: Menu, routes, titles**

`nav-items.ts`: `{ path: '/my-lessons', label: 'Мої уроки', icon: MenuBookIcon, roles: ['teacher'] }` (import `MenuBookIcon from '@mui/icons-material/MenuBook'`; keep the existing «Мої заняття» item for class groups). Router (AdminLayout children): `{ path: 'my-lessons', element: <MyLessonsPage /> }`, `{ path: 'lessons/:groupId/:date/:period', element: <LessonPage /> }`. Header `pageTitles`: `'/my-lessons': 'Мої уроки'`.

(Check `nav-items.ts` `/my-classes` label «Мої заняття» stays; the new item is «Мої уроки».)

- [ ] **Step 7: Frontend CLAUDE.md**

Add after the attendance register paragraph:

```markdown
School timetable: `pages/scheduleSetup` (subjects, rooms, bell schedules, subgroups), `pages/schedule` (timetable versions grid + week with cancel/replace/extra changes; 409 `Schedule conflict` lists `conflicts`), `pages/myLessons` and `pages/lesson` (teacher records attendance, topic, homework, НУШ levels; only changed rows are sent), parent tabs «Розклад» and the «Уроки» block in «Відвідування». API in `shared/api/timetable.ts`. Lesson slots and pupil states come from the backend; never compute them on the frontend.
```

- [ ] **Step 8: Verify and commit**

tsc vs baseline (no new errors), eslint on touched files 0 errors. Manual checks for the report: admin builds a timetable and sees a conflict list; week tab cancel/replace/extra; teacher opens «Мої уроки», records a lesson (register-absent pupil greyed, levels only for present); parent sees «Розклад» with homework and «Уроки» block.

```bash
git add src/pages/myLessons src/pages/lesson src/pages/familyChild src/widgets/sidebar/model/nav-items.ts src/app/router/index.tsx src/widgets/header/ui/Header.tsx CLAUDE.md
git commit -m "feat: add teacher lessons and parent schedule views"
```
