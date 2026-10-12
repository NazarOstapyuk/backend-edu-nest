# Daily Attendance Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff keep a daily attendance register for kindergarten groups and school classes, admins manage absence reasons, a working-day calendar and parent absence notices, and parents see their child's days and notify about absences.

**Architecture:** New backend module `src/attendance/` with a pure `register-calc.ts` (working day, day state, summary) and services for reasons, calendar, register and notices; day states are computed from marks + approved notices, never stored. Frontend adds `shared/api/register.ts`, admin pages (register with month grid, notices, calendar, reasons), group kind in group modals and a reworked parent «Відвідування» tab.

**Tech Stack:** NestJS 11, Prisma 7, class-validator/class-transformer, Jest. Frontend: React 19, MUI 9, Zustand 5, react-hook-form 7 + yup, axios.

**Spec:** `docs/superpowers/specs/2026-10-12-attendance-register-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest` branch `feature/attendance-register` (checked out, spec committed), Tasks 1–6. Frontend `D:\IT\EduNest`: create branch `feature/attendance-register` from `main` at the start of Task 7, Tasks 7–9.

## Global Constraints

- Node 22 on PATH for Prisma/Jest: in Git Bash `export PATH="/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH"` (default node is v20.18, too old). Prisma 7: check generated types in `node_modules/.prisma/client/index.d.ts` instead of guessing.
- Business dates are UTC-midnight `Date`s (`@db.Date`); "today" = `kyivToday()` from `src/tariffs/dates.ts`; date params parsed with `parseDay` from `src/classes/access.ts` (`Invalid date`).
- New error messages exactly as in the spec "Errors" section (English); every one gets a Ukrainian translation in the frontend `errorMessages.ts`.
- The register never creates charges or changes money.
- Parent views never contain staff notes (`note`) or staff names (`markedBy`, `createdBy`, `decidedBy`).
- Don't change cookie options, JWT config, CORS or the global ValidationPipe. Don't edit applied migrations. Never reset or drop data.
- No new dependencies. No code comments.
- Backend: `npx eslint --fix <touched files>` before each commit; no new lint errors (baseline: errors in `src/users/users.service.ts` `_p`/`_r`, `src/auth/guards/roles.guard.ts`, one `no-unsafe-assignment` in `src/children/children.service.spec.ts`). Jest mocks typed `as unknown as X`, never `as any`. `jest.spyOn` on namespace imports fails in this repo; use mock objects.
- Frontend: before Task 7 save `npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx"` to `<scratchpad>/fe-tsc-baseline-attendance.txt`; tasks add no lines; `npx eslint` on touched files 0 errors. Never touch untracked `src/shared/api/children 2.ts` / `children 3.ts`; never `git add -A`.
- Frontend stores: one selector per field, selectors return primitives or stored references; stale async results ignored when the key (group/date/month/child) changed.
- Commits: Conventional Commits, one task = one commit unless stated, with the committing model's attribution trailer. Never push.
- The user's dev servers own ports 3000 and 5173; never stop them; live checks use PORT=3100 and stop only your own process.

## Review Focus

1. A teacher saves the register of a group they don't teach, or a day older than the edit window → 403 (`Not your group` / `Edit window has passed`), nothing written. Pinned in Task 4.
2. Two saves of the same child and day race → exactly one active mark remains (children rows locked before reading marks). Pinned in Task 4 (lock order test) and Task 6 live check.
3. A holiday entry for "all" plus a working-day transfer for one group on the same date → the group works, other groups don't. Pinned in Task 2.
4. A parent submits a notice that overlaps an existing pending/approved one, starts yesterday, or lasts 61 days → 400, nothing created. Pinned in Task 5.
5. A teacher marks a child "present" on a day covered by an approved notice → the mark wins in the day view, the month grid and `expectedPresence`. Pinned in Task 2 and Task 4.

---

## File Map

Backend:

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, migration `add_attendance_register` | Enums, models, relations, seed reasons |
| `src/attendance/register-calc.ts` | Pure: `dayInfo`, `resolveDay`, `summarizeDays`, `dayRange`, `parseMonth` |
| `src/attendance/absence-reasons.*` | Reasons directory |
| `src/attendance/calendar.*` | Working-day calendar |
| `src/attendance/register.*` | Day view, save, month grid, groups, settings, `childDays`, `expectedPresence` |
| `src/attendance/notices.*`, `absence-notices.controller.ts` | Admin notices |
| `src/attendance/parent-attendance.*` | Parent notices + month view |
| `src/attendance/attendance.module.ts` | Module wiring |
| `src/common/ownership.ts` | `findOwnChild` shared by parent cabinet and attendance |
| `src/groups/*`, `src/children/children.service.ts`, `src/users/users.service.ts` | Group kind, delete guards |

Frontend:

| File | Responsibility |
|---|---|
| `src/shared/api/register.ts` | Types, labels, `registerApi` |
| `src/shared/api/parentCabinet.ts` | Parent register + notices calls |
| `src/pages/groups/*`, `src/shared/api/groups.ts` | Group kind |
| `src/pages/absenceReasons/`, `src/pages/calendar/` | Reasons and calendar pages |
| `src/pages/register/` | Register (day) and month grid |
| `src/pages/absenceNotices/`, `src/shared/model/pendingNoticesStore.ts` | Admin notices + menu badge |
| `src/pages/familyChild/*` | Parent «Відвідування» tab |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_attendance_register/migration.sql`

**Interfaces:**
- Produces: enums `GroupKind`, `DailyStatus`, `CalendarDayType`, `CalendarScope`, `NoticeStatus`; models `AbsenceReason`, `CalendarDay`, `DailyAttendance`, `AbsenceNotice`; `Group.kind`; Prisma delegates `absenceReason`, `calendarDay`, `dailyAttendance`, `absenceNotice`.

- [ ] **Step 1: Enums and models**

Append to `prisma/schema.prisma`:

```prisma
enum GroupKind {
  kindergarten
  school_class
}

enum DailyStatus {
  present
  late
  left_early
  absent
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

enum NoticeStatus {
  pending
  approved
  rejected
  cancelled
}

model AbsenceReason {
  id               String            @id @default(uuid())
  name             String            @unique
  excused          Boolean
  requiresDocument Boolean           @default(false)
  active           Boolean           @default(true)
  sortOrder        Int               @default(0)
  attendances      DailyAttendance[]
  notices          AbsenceNotice[]
}

model CalendarDay {
  id          String          @id @default(uuid())
  startDate   DateTime        @db.Date
  endDate     DateTime        @db.Date
  type        CalendarDayType
  scope       CalendarScope
  groupId     String?
  group       Group?          @relation(fields: [groupId], references: [id], onDelete: Restrict)
  title       String
  createdById String
  createdBy   User            @relation("CalendarCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime        @default(now())
  voidedAt    DateTime?
  voidedById  String?
  voidedBy    User?           @relation("CalendarVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason  String?

  @@index([startDate, endDate])
}

model DailyAttendance {
  id               String         @id @default(uuid())
  childId          String
  child            Child          @relation(fields: [childId], references: [id])
  groupId          String
  group            Group          @relation(fields: [groupId], references: [id])
  date             DateTime       @db.Date
  status           DailyStatus
  reasonId         String?
  reason           AbsenceReason? @relation(fields: [reasonId], references: [id], onDelete: Restrict)
  note             String?
  documentProvided Boolean        @default(false)
  markedById       String
  markedBy         User           @relation("DailyMarkedBy", fields: [markedById], references: [id])
  createdAt        DateTime       @default(now())
  voidedAt         DateTime?
  voidedById       String?
  voidedBy         User?          @relation("DailyVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason       String?

  @@index([groupId, date])
  @@index([childId, date])
}

model AbsenceNotice {
  id             String        @id @default(uuid())
  childId        String
  child          Child         @relation(fields: [childId], references: [id])
  startDate      DateTime      @db.Date
  endDate        DateTime      @db.Date
  reasonId       String
  reason         AbsenceReason @relation(fields: [reasonId], references: [id])
  comment        String?
  status         NoticeStatus  @default(pending)
  createdById    String
  createdBy      User          @relation("NoticeCreatedBy", fields: [createdById], references: [id])
  decidedById    String?
  decidedBy      User?         @relation("NoticeDecidedBy", fields: [decidedById], references: [id], onDelete: Restrict)
  decidedAt      DateTime?
  decisionReason String?
  createdAt      DateTime      @default(now())

  @@index([childId, startDate])
}
```

- [ ] **Step 2: Back-relations**

In `model Group` after `children  Child[]` add:

```prisma
  kind             GroupKind         @default(kindergarten)
  dailyAttendances DailyAttendance[]
  calendarDays     CalendarDay[]
```

In `model Child` after `packages          Package[]` add:

```prisma
  dailyAttendances  DailyAttendance[]
  absenceNotices    AbsenceNotice[]
```

In `model User` after `usagesVoided        SessionUsage[]     @relation("UsageVoidedBy")` add:

```prisma
  dailyMarked         DailyAttendance[]  @relation("DailyMarkedBy")
  dailyVoided         DailyAttendance[]  @relation("DailyVoidedBy")
  calendarCreated     CalendarDay[]      @relation("CalendarCreatedBy")
  calendarVoided      CalendarDay[]      @relation("CalendarVoidedBy")
  noticesCreated      AbsenceNotice[]    @relation("NoticeCreatedBy")
  noticesDecided      AbsenceNotice[]    @relation("NoticeDecidedBy")
```

- [ ] **Step 3: Create the migration without applying**

Run (Node 22 on PATH): `npx prisma migrate dev --create-only --name add_attendance_register`
Expected: a new folder whose `migration.sql` only creates the 5 enums, 4 tables, indexes, FKs and adds `Group.kind`. If Prisma reports drift or asks to reset, STOP and report BLOCKED.

- [ ] **Step 4: Append the seed**

Append to the generated `migration.sql`:

```sql
INSERT INTO "AbsenceReason" ("id", "name", "excused", "requiresDocument", "active", "sortOrder") VALUES
  (gen_random_uuid()::text, 'Хвороба', true, true, true, 1),
  (gen_random_uuid()::text, 'Сімейні обставини', true, false, true, 2),
  (gen_random_uuid()::text, 'Відпустка', true, false, true, 3),
  (gen_random_uuid()::text, 'Без причини', false, false, true, 4);
```

The file must be saved as UTF-8 (use the Write/Edit tool).

- [ ] **Step 5: Apply, generate, verify**

Run: `npx prisma migrate dev`, `npx prisma generate`, `npm run build`, `npx jest`.
Expected: migration applied; `SELECT name FROM "AbsenceReason"` (via `npx prisma db execute --stdin` or psql) shows the 4 Ukrainian names correctly; build exit 0; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add attendance register schema"
```

---

### Task 2: Pure register calculations

**Files:**
- Create: `src/attendance/register-calc.ts`, `src/attendance/register-calc.spec.ts`

**Interfaces:**
- Consumes: Prisma enums from Task 1; `addDays`, `dayCount`, `daysInMonth` from `src/tariffs/dates.ts`.
- Produces:
  - `type DayState = 'present' | 'absent' | 'expected_absent' | 'unmarked' | 'non_working'`
  - `interface CalendarEntryLike { startDate: Date; endDate: Date; type: CalendarDayType; scope: CalendarScope; groupId: string | null; title: string; voidedAt: Date | null }`
  - `interface GroupLike { id: string; kind: GroupKind }`
  - `interface MarkLike { date: Date; status: DailyStatus; reasonId: string | null; voidedAt: Date | null }`
  - `interface NoticeLike { startDate: Date; endDate: Date; reasonId: string; status: NoticeStatus }`
  - `interface ResolvedDay { working: boolean; state: DayState; status: DailyStatus | null; reasonId: string | null; source: 'mark' | 'notice' | 'none' }`
  - `interface DaySummary { workingDays: number; present: number; absentExcused: number; absentUnexcused: number; expectedAbsent: number; unmarked: number }`
  - `dayInfo(day: Date, group: GroupLike | null, entries: CalendarEntryLike[]): { working: boolean; title: string | null }`
  - `resolveDay(day: Date, working: boolean, marks: MarkLike[], notices: NoticeLike[]): ResolvedDay`
  - `summarizeDays(days: ResolvedDay[], excusedReasonIds: ReadonlySet<string>): DaySummary`
  - `dayRange(from: Date, to: Date): Date[]`
  - `parseMonth(value: string): { from: Date; to: Date; days: Date[] }` (400 `Invalid month`)

- [ ] **Step 1: Failing tests `src/attendance/register-calc.spec.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import {
  CalendarDayType,
  CalendarScope,
  DailyStatus,
  GroupKind,
  NoticeStatus,
} from '@prisma/client';
import {
  type CalendarEntryLike,
  dayInfo,
  dayRange,
  parseMonth,
  resolveDay,
  summarizeDays,
} from './register-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const kg = { id: 'g1', kind: GroupKind.kindergarten };
const school = { id: 'g2', kind: GroupKind.school_class };

const entry = (over: Partial<CalendarEntryLike>): CalendarEntryLike => ({
  startDate: day('2026-10-14'),
  endDate: day('2026-10-14'),
  type: CalendarDayType.non_working,
  scope: CalendarScope.all,
  groupId: null,
  title: 'Свято',
  voidedAt: null,
  ...over,
});

describe('dayInfo', () => {
  it('treats Monday to Friday as working and weekends as not', () => {
    expect(dayInfo(day('2026-10-12'), kg, [])).toEqual({ working: true, title: null });
    expect(dayInfo(day('2026-10-17'), kg, [])).toEqual({ working: false, title: null });
    expect(dayInfo(day('2026-10-18'), kg, [])).toEqual({ working: false, title: null });
  });

  it('applies a non-working period for everyone', () => {
    const holiday = entry({ startDate: day('2026-10-13'), endDate: day('2026-10-15') });
    expect(dayInfo(day('2026-10-14'), kg, [holiday])).toEqual({ working: false, title: 'Свято' });
    expect(dayInfo(day('2026-10-16'), kg, [holiday]).working).toBe(true);
  });

  it('ignores voided entries', () => {
    expect(dayInfo(day('2026-10-14'), kg, [entry({ voidedAt: new Date() })]).working).toBe(true);
  });

  it('applies a group-kind entry only to that kind', () => {
    const vacation = entry({ scope: CalendarScope.school_class, title: 'Канікули' });
    expect(dayInfo(day('2026-10-14'), school, [vacation]).working).toBe(false);
    expect(dayInfo(day('2026-10-14'), kg, [vacation]).working).toBe(true);
  });

  it('lets a group entry override a kind entry and a kind entry override an all entry', () => {
    const all = entry({ title: 'Свято' });
    const kindWorking = entry({ type: CalendarDayType.working, scope: CalendarScope.kindergarten, title: 'Чергова група' });
    const groupOff = entry({ scope: CalendarScope.group, groupId: 'g1', title: 'Карантин' });
    expect(dayInfo(day('2026-10-14'), kg, [all, kindWorking])).toEqual({ working: true, title: 'Чергова група' });
    expect(dayInfo(day('2026-10-14'), kg, [all, kindWorking, groupOff])).toEqual({ working: false, title: 'Карантин' });
    expect(dayInfo(day('2026-10-14'), school, [all, kindWorking]).working).toBe(false);
  });

  it('makes a weekend working by a transfer for one group only', () => {
    const transfer = entry({ startDate: day('2026-10-17'), endDate: day('2026-10-17'), type: CalendarDayType.working, scope: CalendarScope.group, groupId: 'g1', title: 'Робоча субота' });
    expect(dayInfo(day('2026-10-17'), kg, [transfer])).toEqual({ working: true, title: 'Робоча субота' });
    expect(dayInfo(day('2026-10-17'), school, [transfer]).working).toBe(false);
  });

  it('prefers non-working when both types exist on the same level', () => {
    const working = entry({ type: CalendarDayType.working, title: 'Робочий' });
    const off = entry({ title: 'Вихідний' });
    expect(dayInfo(day('2026-10-14'), kg, [working, off])).toEqual({ working: false, title: 'Вихідний' });
    expect(dayInfo(day('2026-10-14'), kg, [off, working])).toEqual({ working: false, title: 'Вихідний' });
  });

  it('applies only all-scope entries when the child has no group', () => {
    const kindOff = entry({ scope: CalendarScope.kindergarten });
    expect(dayInfo(day('2026-10-14'), null, [kindOff]).working).toBe(true);
    expect(dayInfo(day('2026-10-14'), null, [entry({})]).working).toBe(false);
  });
});

describe('resolveDay', () => {
  const d = day('2026-10-14');
  const approved = { startDate: day('2026-10-13'), endDate: day('2026-10-15'), reasonId: 'sick', status: NoticeStatus.approved };

  it('returns unmarked for a working day without data', () => {
    expect(resolveDay(d, true, [], [])).toEqual({ working: true, state: 'unmarked', status: null, reasonId: null, source: 'none' });
  });

  it('returns non_working for a day off without a mark', () => {
    expect(resolveDay(d, false, [], [approved]).state).toBe('non_working');
  });

  it('uses an approved notice as expected absence', () => {
    expect(resolveDay(d, true, [], [approved])).toEqual({ working: true, state: 'expected_absent', status: null, reasonId: 'sick', source: 'notice' });
  });

  it('ignores pending, rejected and cancelled notices', () => {
    const others = [NoticeStatus.pending, NoticeStatus.rejected, NoticeStatus.cancelled].map((status) => ({ ...approved, status }));
    expect(resolveDay(d, true, [], others).state).toBe('unmarked');
  });

  it('lets a mark win over an approved notice', () => {
    const mark = { date: d, status: DailyStatus.present, reasonId: null, voidedAt: null };
    expect(resolveDay(d, true, [mark], [approved])).toEqual({ working: true, state: 'present', status: DailyStatus.present, reasonId: null, source: 'mark' });
  });

  it('counts late and left early as present and keeps the absence reason', () => {
    expect(resolveDay(d, true, [{ date: d, status: DailyStatus.late, reasonId: null, voidedAt: null }], []).state).toBe('present');
    expect(resolveDay(d, true, [{ date: d, status: DailyStatus.left_early, reasonId: null, voidedAt: null }], []).state).toBe('present');
    expect(resolveDay(d, true, [{ date: d, status: DailyStatus.absent, reasonId: 'sick', voidedAt: null }], [])).toMatchObject({ state: 'absent', reasonId: 'sick' });
  });

  it('ignores voided marks and marks of other days', () => {
    const voided = { date: d, status: DailyStatus.present, reasonId: null, voidedAt: new Date() };
    const otherDay = { date: day('2026-10-13'), status: DailyStatus.present, reasonId: null, voidedAt: null };
    expect(resolveDay(d, true, [voided, otherDay], []).state).toBe('unmarked');
  });

  it('keeps a mark on a day that became non-working', () => {
    const mark = { date: d, status: DailyStatus.present, reasonId: null, voidedAt: null };
    expect(resolveDay(d, false, [mark], [])).toEqual({ working: false, state: 'present', status: DailyStatus.present, reasonId: null, source: 'mark' });
  });
});

describe('summarizeDays', () => {
  it('counts each state, splitting absences by excused reasons', () => {
    const base = { status: null, source: 'none' as const };
    const days = [
      { ...base, working: true, state: 'present' as const, reasonId: null },
      { ...base, working: true, state: 'absent' as const, reasonId: 'sick' },
      { ...base, working: true, state: 'absent' as const, reasonId: 'none' },
      { ...base, working: true, state: 'absent' as const, reasonId: null },
      { ...base, working: true, state: 'expected_absent' as const, reasonId: 'sick' },
      { ...base, working: true, state: 'unmarked' as const, reasonId: null },
      { ...base, working: false, state: 'non_working' as const, reasonId: null },
    ];
    expect(summarizeDays(days, new Set(['sick']))).toEqual({
      workingDays: 6,
      present: 1,
      absentExcused: 1,
      absentUnexcused: 2,
      expectedAbsent: 1,
      unmarked: 1,
    });
  });
});

describe('dayRange and parseMonth', () => {
  it('lists every day inclusive', () => {
    expect(dayRange(day('2026-10-30'), day('2026-11-02')).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
  });

  it('parses a month into its days', () => {
    const feb = parseMonth('2028-02');
    expect(feb.from).toEqual(day('2028-02-01'));
    expect(feb.to).toEqual(day('2028-02-29'));
    expect(feb.days).toHaveLength(29);
  });

  it('rejects malformed months', () => {
    for (const value of ['2026-13', '2026-1', 'abc', '']) {
      expect(() => parseMonth(value)).toThrow(new BadRequestException('Invalid month'));
    }
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx jest src/attendance/register-calc.spec.ts`
Expected: FAIL, cannot find module `./register-calc`.

- [ ] **Step 3: Implement `src/attendance/register-calc.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import {
  CalendarDayType,
  CalendarScope,
  DailyStatus,
  GroupKind,
  NoticeStatus,
} from '@prisma/client';
import { addDays, dayCount, daysInMonth } from '../tariffs/dates';

export type DayState =
  | 'present'
  | 'absent'
  | 'expected_absent'
  | 'unmarked'
  | 'non_working';

export interface CalendarEntryLike {
  startDate: Date;
  endDate: Date;
  type: CalendarDayType;
  scope: CalendarScope;
  groupId: string | null;
  title: string;
  voidedAt: Date | null;
}

export interface GroupLike {
  id: string;
  kind: GroupKind;
}

export interface MarkLike {
  date: Date;
  status: DailyStatus;
  reasonId: string | null;
  voidedAt: Date | null;
}

export interface NoticeLike {
  startDate: Date;
  endDate: Date;
  reasonId: string;
  status: NoticeStatus;
}

export interface ResolvedDay {
  working: boolean;
  state: DayState;
  status: DailyStatus | null;
  reasonId: string | null;
  source: 'mark' | 'notice' | 'none';
}

export interface DaySummary {
  workingDays: number;
  present: number;
  absentExcused: number;
  absentUnexcused: number;
  expectedAbsent: number;
  unmarked: number;
}

const time = (day: Date) => day.getTime();

const covers = (start: Date, end: Date, day: Date) =>
  time(start) <= time(day) && time(day) <= time(end);

const level = (
  entry: CalendarEntryLike,
  group: GroupLike | null,
): number | null => {
  if (entry.scope === CalendarScope.all) return 1;
  if (!group) return null;
  if (entry.scope === CalendarScope.group)
    return entry.groupId === group.id ? 3 : null;
  return String(entry.scope) === String(group.kind) ? 2 : null;
};

export function dayInfo(
  day: Date,
  group: GroupLike | null,
  entries: CalendarEntryLike[],
): { working: boolean; title: string | null } {
  let best: CalendarEntryLike | null = null;
  let bestLevel = 0;
  for (const entry of entries) {
    if (entry.voidedAt || !covers(entry.startDate, entry.endDate, day)) continue;
    const entryLevel = level(entry, group);
    if (entryLevel === null) continue;
    const winsTie =
      entryLevel === bestLevel &&
      entry.type === CalendarDayType.non_working &&
      best?.type === CalendarDayType.working;
    if (entryLevel > bestLevel || winsTie) {
      best = entry;
      bestLevel = entryLevel;
    }
  }
  if (best)
    return { working: best.type === CalendarDayType.working, title: best.title };
  const weekday = day.getUTCDay();
  return { working: weekday !== 0 && weekday !== 6, title: null };
}

export function resolveDay(
  day: Date,
  working: boolean,
  marks: MarkLike[],
  notices: NoticeLike[],
): ResolvedDay {
  const mark = marks.find((m) => !m.voidedAt && time(m.date) === time(day));
  if (mark) {
    return {
      working,
      state: mark.status === DailyStatus.absent ? 'absent' : 'present',
      status: mark.status,
      reasonId: mark.reasonId,
      source: 'mark',
    };
  }
  if (!working)
    return { working, state: 'non_working', status: null, reasonId: null, source: 'none' };
  const notice = notices.find(
    (n) =>
      n.status === NoticeStatus.approved && covers(n.startDate, n.endDate, day),
  );
  if (notice) {
    return {
      working,
      state: 'expected_absent',
      status: null,
      reasonId: notice.reasonId,
      source: 'notice',
    };
  }
  return { working, state: 'unmarked', status: null, reasonId: null, source: 'none' };
}

export function summarizeDays(
  days: ResolvedDay[],
  excusedReasonIds: ReadonlySet<string>,
): DaySummary {
  const count = (fn: (day: ResolvedDay) => boolean) => days.filter(fn).length;
  const excused = (day: ResolvedDay) =>
    day.reasonId !== null && excusedReasonIds.has(day.reasonId);
  return {
    workingDays: count((d) => d.working),
    present: count((d) => d.state === 'present'),
    absentExcused: count((d) => d.state === 'absent' && excused(d)),
    absentUnexcused: count((d) => d.state === 'absent' && !excused(d)),
    expectedAbsent: count((d) => d.state === 'expected_absent'),
    unmarked: count((d) => d.state === 'unmarked'),
  };
}

export const dayRange = (from: Date, to: Date): Date[] =>
  Array.from({ length: dayCount(from, to) }, (_, i) => addDays(from, i));

export function parseMonth(value: string): {
  from: Date;
  to: Date;
  days: Date[];
} {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12)
    throw new BadRequestException('Invalid month');
  const year = Number(match[1]);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month - 1, daysInMonth(year, month - 1)));
  return { from, to, days: dayRange(from, to) };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest src/attendance/register-calc.spec.ts` → PASS. Then `npx eslint --fix src/attendance/register-calc.ts src/attendance/register-calc.spec.ts`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/attendance/register-calc.ts src/attendance/register-calc.spec.ts
git commit -m "feat: add pure attendance register calculations"
```

---

### Task 3: Absence reasons, calendar, group kind and delete guards

**Files:**
- Create: `src/attendance/dto/create-absence-reason.dto.ts`, `src/attendance/dto/update-absence-reason.dto.ts`, `src/attendance/dto/create-calendar-day.dto.ts`, `src/attendance/dto/reason.dto.ts`, `src/attendance/absence-reasons.service.ts`, `src/attendance/absence-reasons.service.spec.ts`, `src/attendance/absence-reasons.controller.ts`, `src/attendance/calendar.service.ts`, `src/attendance/calendar.service.spec.ts`, `src/attendance/calendar.controller.ts`, `src/attendance/attendance.module.ts`, `src/groups/groups.service.spec.ts`
- Modify: `src/app.module.ts`, `src/groups/dto/create-group.dto.ts`, `src/groups/dto/update-group.dto.ts`, `src/groups/groups.service.ts`, `src/children/children.service.ts`, `src/children/children.service.spec.ts`, `src/users/users.service.ts`, `src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 models; `parseDay` (`src/classes/access.ts`); `AuthenticatedUser`.
- Produces:
  - `ReasonDto { reason: string }` (`src/attendance/dto/reason.dto.ts`), reused by later tasks.
  - `CalendarService.entriesBetween(from: Date, to: Date): Promise<CalendarDay[]>` (non-voided entries overlapping the range, all scopes).
  - `AttendanceModule` exporting `CalendarService`; later tasks add controllers/providers to it.
  - Routes: `GET/POST /absence-reasons`, `PATCH /absence-reasons/:id`, `GET/POST /calendar`, `POST /calendar/:id/void`.
  - `Group.kind` accepted by `POST/PATCH /groups`.

- [ ] **Step 1: DTOs**

`src/attendance/dto/reason.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
```

`src/attendance/dto/create-absence-reason.dto.ts`:

```ts
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAbsenceReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsBoolean()
  excused: boolean;

  @IsBoolean()
  @IsOptional()
  requiresDocument?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
```

`src/attendance/dto/update-absence-reason.dto.ts`:

```ts
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateAbsenceReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  excused?: boolean;

  @IsBoolean()
  @IsOptional()
  requiresDocument?: boolean;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
```

`src/attendance/dto/create-calendar-day.dto.ts`:

```ts
import { CalendarDayType, CalendarScope } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateCalendarDayDto {
  @IsString()
  startDate: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsEnum(CalendarDayType)
  type: CalendarDayType;

  @IsEnum(CalendarScope)
  scope: CalendarScope;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;
}
```

- [ ] **Step 2: Failing tests**

`src/attendance/absence-reasons.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AbsenceReasonsService } from './absence-reasons.service';

const mockPrisma = {
  absenceReason: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const user = (role: Role) => ({ id: 'u1', role, login: 'x', mustChangePassword: false });
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('AbsenceReasonsService', () => {
  let service: AbsenceReasonsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AbsenceReasonsService,
        { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService },
      ],
    }).compile();
    service = moduleRef.get(AbsenceReasonsService);
  });

  it('lists all reasons for admins and only active ones for others', async () => {
    mockPrisma.absenceReason.findMany.mockResolvedValue([]);
    await service.list(user(Role.admin));
    await service.list(user(Role.teacher));
    expect(firstArg<{ where: object }>(mockPrisma.absenceReason.findMany).where).toEqual({});
    expect((mockPrisma.absenceReason.findMany.mock.calls[1] as [{ where: object }])[0].where).toEqual({ active: true });
  });

  it('rejects a duplicate name on create', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue({ id: 'r1', name: 'Хвороба' });
    await expect(service.create({ name: ' Хвороба ', excused: true })).rejects.toThrow(
      new ConflictException('Absence reason already exists'),
    );
    expect(mockPrisma.absenceReason.create).not.toHaveBeenCalled();
  });

  it('creates with trimmed name and defaults', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue(null);
    mockPrisma.absenceReason.create.mockResolvedValue({ id: 'r9' });
    await service.create({ name: ' Карантин ', excused: true });
    expect(firstArg<{ data: object }>(mockPrisma.absenceReason.create).data).toEqual({
      name: 'Карантин',
      excused: true,
      requiresDocument: false,
      sortOrder: 0,
    });
  });

  it('updates an existing reason and rejects a taken name', async () => {
    mockPrisma.absenceReason.findUnique
      .mockResolvedValueOnce({ id: 'r1', name: 'Хвороба' })
      .mockResolvedValueOnce({ id: 'r2', name: 'Відпустка' });
    await expect(service.update('r1', { name: 'Відпустка' })).rejects.toThrow(
      new ConflictException('Absence reason already exists'),
    );
  });

  it('deactivates a reason', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue({ id: 'r1', name: 'Хвороба' });
    mockPrisma.absenceReason.update.mockResolvedValue({ id: 'r1', active: false });
    await service.update('r1', { active: false });
    expect(firstArg<{ data: { active: boolean } }>(mockPrisma.absenceReason.update).data.active).toBe(false);
  });

  it('throws when the reason is missing', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { active: false })).rejects.toThrow(
      new NotFoundException('Absence reason not found'),
    );
  });
});
```

`src/attendance/calendar.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CalendarDayType, CalendarScope, GroupKind, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from './calendar.service';

const mockPrisma = {
  calendarDay: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  group: { findUnique: jest.fn() },
};

const admin = { id: 'a1', role: Role.admin, login: 'admin', mustChangePassword: false };
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarService,
        { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService },
      ],
    }).compile();
    service = moduleRef.get(CalendarService);
  });

  it('creates a single-day entry for everyone', async () => {
    mockPrisma.calendarDay.create.mockResolvedValue({ id: 'c1' });
    await service.create(
      { startDate: '2026-10-14', type: CalendarDayType.non_working, scope: CalendarScope.all, title: ' Свято ' },
      admin,
    );
    expect(firstArg<{ data: object }>(mockPrisma.calendarDay.create).data).toEqual({
      startDate: day('2026-10-14'),
      endDate: day('2026-10-14'),
      type: CalendarDayType.non_working,
      scope: CalendarScope.all,
      groupId: null,
      title: 'Свято',
      createdById: 'a1',
    });
  });

  it('rejects an inverted period', async () => {
    await expect(
      service.create(
        { startDate: '2026-10-14', endDate: '2026-10-13', type: CalendarDayType.non_working, scope: CalendarScope.all, title: 'x' },
        admin,
      ),
    ).rejects.toThrow(new BadRequestException('Invalid period'));
  });

  it('requires a group exactly for group scope', async () => {
    await expect(
      service.create({ startDate: '2026-10-14', type: CalendarDayType.non_working, scope: CalendarScope.group, title: 'x' }, admin),
    ).rejects.toThrow(new BadRequestException('Group is required for group scope'));
    await expect(
      service.create(
        { startDate: '2026-10-14', type: CalendarDayType.non_working, scope: CalendarScope.all, groupId: 'g1', title: 'x' },
        admin,
      ),
    ).rejects.toThrow(new BadRequestException('Group is required for group scope'));
  });

  it('rejects an unknown group', async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        { startDate: '2026-10-14', type: CalendarDayType.non_working, scope: CalendarScope.group, groupId: 'g1', title: 'x' },
        admin,
      ),
    ).rejects.toThrow(new NotFoundException('Group not found'));
  });

  it('filters the list by the group kind when a group is given', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1', kind: GroupKind.school_class });
    mockPrisma.calendarDay.findMany.mockResolvedValue([]);
    await service.list('2026-10-01', '2026-10-31', 'g1');
    const where = firstArg<{ where: { OR: object[] } }>(mockPrisma.calendarDay.findMany).where;
    expect(where.OR).toEqual([
      { scope: CalendarScope.all },
      { scope: CalendarScope.school_class },
      { scope: CalendarScope.group, groupId: 'g1' },
    ]);
  });

  it('voids an entry once', async () => {
    mockPrisma.calendarDay.findUnique.mockResolvedValueOnce({ id: 'c1', voidedAt: null });
    mockPrisma.calendarDay.update.mockResolvedValue({ id: 'c1' });
    await service.void('c1', ' помилка ', admin);
    expect(firstArg<{ data: { voidedById: string; voidReason: string } }>(mockPrisma.calendarDay.update).data).toMatchObject({
      voidedById: 'a1',
      voidReason: 'помилка',
    });
    mockPrisma.calendarDay.findUnique.mockResolvedValueOnce({ id: 'c1', voidedAt: new Date() });
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(new BadRequestException('Calendar entry is voided'));
    mockPrisma.calendarDay.findUnique.mockResolvedValueOnce(null);
    await expect(service.void('c2', 'x', admin)).rejects.toThrow(new NotFoundException('Calendar entry not found'));
  });
});
```

`src/groups/groups.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from './groups.service';

const mockPrisma = {
  group: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  user: { findMany: jest.fn() },
  dailyAttendance: { count: jest.fn() },
  calendarDay: { count: jest.fn() },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('GroupsService', () => {
  let service: GroupsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [GroupsService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = moduleRef.get(GroupsService);
  });

  it('stores the group kind', async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null);
    mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
    await service.create({ name: '1-А', kind: GroupKind.school_class });
    expect(firstArg<{ data: { kind: GroupKind } }>(mockPrisma.group.create).data.kind).toBe(GroupKind.school_class);
  });

  it('refuses to delete a group with attendance records', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(1);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    await expect(service.delete('g1')).rejects.toThrow(
      new BadRequestException('Cannot delete: group has attendance records'),
    );
    expect(mockPrisma.group.delete).not.toHaveBeenCalled();
  });

  it('deletes a group without attendance records', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(0);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    await expect(service.delete('g1')).resolves.toEqual({ message: 'Group deleted' });
  });
});
```

`src/children/children.service.spec.ts`: add to `mockPrisma`:

```ts
  dailyAttendance: { count: jest.fn() },
  absenceNotice: { count: jest.fn() },
```

In `describe('delete')` add `mockPrisma.dailyAttendance.count.mockResolvedValue(0);` and `mockPrisma.absenceNotice.count.mockResolvedValue(0);` next to the other `count` mocks of both existing tests, and add:

```ts
    it('refuses to delete a child with register marks', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.dailyAttendance.count.mockResolvedValue(1);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);

      await expect(service.delete('child-1')).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });
```

`src/users/users.service.spec.ts`: add to `mockPrisma`:

```ts
  dailyAttendance: { count: jest.fn() },
  calendarDay: { count: jest.fn() },
  absenceNotice: { count: jest.fn() },
```

In the `describe('delete')` `beforeEach` add the three `.count.mockResolvedValue(0)` lines, and add:

```ts
    it('throws BadRequestException when user decided absence notices', async () => {
      mockPrisma.absenceNotice.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.absenceNotice.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { decidedById: 'u1' }] },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
```

- [ ] **Step 3: Run, verify failure**

Run: `npx jest src/attendance src/groups src/children src/users`
Expected: FAIL (missing services/modules, guards not counting new tables).

- [ ] **Step 4: Implement services**

`src/attendance/absence-reasons.service.ts`:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateAbsenceReasonDto } from './dto/create-absence-reason.dto';
import { UpdateAbsenceReasonDto } from './dto/update-absence-reason.dto';

@Injectable()
export class AbsenceReasonsService {
  constructor(private prisma: PrismaService) {}

  list(user: AuthenticatedUser) {
    const admin = user.role === Role.root || user.role === Role.admin;
    return this.prisma.absenceReason.findMany({
      where: admin ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateAbsenceReasonDto) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    return this.prisma.absenceReason.create({
      data: {
        name,
        excused: dto.excused,
        requiresDocument: dto.requiresDocument ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateAbsenceReasonDto) {
    const reason = await this.prisma.absenceReason.findUnique({ where: { id } });
    if (!reason) throw new NotFoundException('Absence reason not found');
    const name = dto.name?.trim();
    if (name && name !== reason.name) await this.assertNameFree(name);
    return this.prisma.absenceReason.update({
      where: { id },
      data: {
        name,
        excused: dto.excused,
        requiresDocument: dto.requiresDocument,
        active: dto.active,
        sortOrder: dto.sortOrder,
      },
    });
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.absenceReason.findUnique({
      where: { name },
    });
    if (existing) throw new ConflictException('Absence reason already exists');
  }
}
```

`src/attendance/calendar.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CalendarScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { CreateCalendarDayDto } from './dto/create-calendar-day.dto';

const withGroup = { group: { select: { id: true, name: true } } } as const;

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  entriesBetween(from: Date, to: Date) {
    return this.prisma.calendarDay.findMany({
      where: { voidedAt: null, startDate: { lte: to }, endDate: { gte: from } },
    });
  }

  async list(fromValue: string, toValue: string, groupId?: string) {
    const from = parseDay(fromValue);
    const to = parseDay(toValue);
    if (to.getTime() < from.getTime())
      throw new BadRequestException('Invalid period');
    let scopeFilter = {};
    if (groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, kind: true },
      });
      if (!group) throw new NotFoundException('Group not found');
      scopeFilter = {
        OR: [
          { scope: CalendarScope.all },
          { scope: CalendarScope[group.kind] },
          { scope: CalendarScope.group, groupId },
        ],
      };
    }
    return this.prisma.calendarDay.findMany({
      where: {
        voidedAt: null,
        startDate: { lte: to },
        endDate: { gte: from },
        ...scopeFilter,
      },
      include: withGroup,
      orderBy: { startDate: 'asc' },
    });
  }

  async create(dto: CreateCalendarDayDto, user: AuthenticatedUser) {
    const startDate = parseDay(dto.startDate);
    const endDate = dto.endDate ? parseDay(dto.endDate) : startDate;
    if (endDate.getTime() < startDate.getTime())
      throw new BadRequestException('Invalid period');
    const isGroup = dto.scope === CalendarScope.group;
    if (isGroup !== Boolean(dto.groupId))
      throw new BadRequestException('Group is required for group scope');
    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: dto.groupId },
        select: { id: true },
      });
      if (!group) throw new NotFoundException('Group not found');
    }
    return this.prisma.calendarDay.create({
      data: {
        startDate,
        endDate,
        type: dto.type,
        scope: dto.scope,
        groupId: dto.groupId ?? null,
        title: dto.title.trim(),
        createdById: user.id,
      },
      include: withGroup,
    });
  }

  async void(id: string, reason: string, user: AuthenticatedUser) {
    const entry = await this.prisma.calendarDay.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Calendar entry not found');
    if (entry.voidedAt) throw new BadRequestException('Calendar entry is voided');
    return this.prisma.calendarDay.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason.trim() },
      include: withGroup,
    });
  }
}
```

(The `create` test asserts `data` with `toEqual`; Prisma receives `include` separately, so the assertion is on `data` only.)

- [ ] **Step 5: Controllers and module**

`src/attendance/absence-reasons.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AbsenceReasonsService } from './absence-reasons.service';
import { CreateAbsenceReasonDto } from './dto/create-absence-reason.dto';
import { UpdateAbsenceReasonDto } from './dto/update-absence-reason.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('absence-reasons')
export class AbsenceReasonsController {
  constructor(private reasons: AbsenceReasonsService) {}

  @Get()
  @Roles(Role.root, Role.admin, Role.teacher, Role.parent)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.reasons.list(user);
  }

  @Post()
  create(@Body() dto: CreateAbsenceReasonDto) {
    return this.reasons.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAbsenceReasonDto) {
    return this.reasons.update(id, dto);
  }
}
```

`src/attendance/calendar.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CalendarService } from './calendar.service';
import { CreateCalendarDayDto } from './dto/create-calendar-day.dto';
import { ReasonDto } from './dto/reason.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('calendar')
export class CalendarController {
  constructor(private calendar: CalendarService) {}

  @Get()
  @Roles(Role.root, Role.admin, Role.teacher)
  list(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.calendar.list(from, to, groupId);
  }

  @Post()
  create(@Body() dto: CreateCalendarDayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.calendar.create(dto, user);
  }

  @Post(':id/void')
  void(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendar.void(id, dto.reason, user);
  }
}
```

`src/attendance/attendance.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AbsenceReasonsController } from './absence-reasons.controller';
import { AbsenceReasonsService } from './absence-reasons.service';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  controllers: [AbsenceReasonsController, CalendarController],
  providers: [AbsenceReasonsService, CalendarService],
  exports: [CalendarService],
})
export class AttendanceModule {}
```

Register `AttendanceModule` in `src/app.module.ts` imports after `ParentCabinetModule`.

- [ ] **Step 6: Group kind and delete guards**

In both group DTOs add (with imports `IsEnum` from class-validator, `GroupKind` from `@prisma/client`):

```ts
  @IsEnum(GroupKind)
  @IsOptional()
  kind?: GroupKind;
```

In `GroupsService.create` data add `kind: dto.kind,`; in `update` data add `kind: dto.kind,`. Replace `delete`:

```ts
  async delete(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');
    const [marks, calendarDays] = await Promise.all([
      this.prisma.dailyAttendance.count({ where: { groupId: id } }),
      this.prisma.calendarDay.count({ where: { groupId: id } }),
    ]);
    if (marks > 0 || calendarDays > 0) {
      throw new BadRequestException(
        'Cannot delete: group has attendance records',
      );
    }
    await this.prisma.group.delete({ where: { id } });
    return { message: 'Group deleted' };
  }
```

In `ChildrenService.delete` counts add:

```ts
      this.prisma.dailyAttendance.count({ where: { childId: id } }),
      this.prisma.absenceNotice.count({ where: { childId: id } }),
```

In `UsersService.delete` counts add:

```ts
      this.prisma.dailyAttendance.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
      this.prisma.calendarDay.count({ where: author }),
      this.prisma.absenceNotice.count({
        where: { OR: [{ createdById: id }, { decidedById: id }] },
      }),
```

- [ ] **Step 7: Verify**

Run: `npx jest src/attendance src/groups src/children src/users` → PASS; full `npx jest`; `npm run build`; `npx eslint --fix` on touched files.

- [ ] **Step 8: Commit**

```bash
git add src/attendance src/groups src/children src/users src/app.module.ts
git commit -m "feat: add absence reasons, calendar and group kind"
```

---

### Task 4: Register (day, save, month, groups, settings, expected presence)

**Files:**
- Create: `src/attendance/dto/save-register.dto.ts`, `src/attendance/dto/update-register-settings.dto.ts`, `src/attendance/register.service.ts`, `src/attendance/register.service.spec.ts`, `src/attendance/register.controller.ts`
- Modify: `src/attendance/attendance.module.ts`

**Interfaces:**
- Consumes: `dayInfo`, `resolveDay`, `summarizeDays`, `dayRange`, `parseMonth`, `ResolvedDay` (Task 2); `CalendarService.entriesBetween` (Task 3); `parseDay`; `kyivToday`, `addDays`, `isoDay`.
- Produces:
  - `RegisterService.getEditDays(): Promise<number>`, `setEditDays(value: number): Promise<{ editDays: number }>`
  - `RegisterService.groupsFor(user)`, `day(groupId, date: string, user, today?)`, `save(groupId, dto: SaveRegisterDto, user, today?)`, `month(groupId, month: string, user)`
  - `RegisterService.childDays(childIds: string[], from: Date, to: Date): Promise<{ childId: string; days: (ResolvedDay & { date: Date; title: string | null; hasGroup: boolean })[] }[]>`
  - `RegisterService.expectedPresence(childIds: string[], from: Date, to: Date): Promise<{ childId: string; date: Date }[]>`
  - `AttendanceModule` exports `RegisterService` too.
  - Routes: `GET /register/groups`, `GET/PATCH /register/settings`, `GET /groups/:id/register?date=`, `PUT /groups/:id/register`, `GET /groups/:id/register/month?month=`.

- [ ] **Step 1: DTOs**

`src/attendance/dto/save-register.dto.ts`:

```ts
import { DailyStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RegisterMarkDto {
  @IsUUID('4')
  childId: string;

  @IsEnum(DailyStatus)
  status: DailyStatus;

  @IsUUID('4')
  @IsOptional()
  reasonId?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;

  @IsBoolean()
  @IsOptional()
  documentProvided?: boolean;
}

export class SaveRegisterDto {
  @IsString()
  date: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterMarkDto)
  marks: RegisterMarkDto[];
}
```

`src/attendance/dto/update-register-settings.dto.ts`:

```ts
import { IsInt } from 'class-validator';

export class UpdateRegisterSettingsDto {
  @IsInt()
  editDays: number;
}
```

- [ ] **Step 2: Failing tests `src/attendance/register.service.spec.ts`**

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DailyStatus, GroupKind, NoticeStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from './calendar.service';
import { RegisterService } from './register.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');

const admin = { id: 'a1', role: Role.admin, login: 'admin', mustChangePassword: false };
const teacher = { id: 't1', role: Role.teacher, login: 'teacher', mustChangePassword: false };

const mockPrisma = {
  group: { findUnique: jest.fn(), findMany: jest.fn() },
  child: { findMany: jest.fn() },
  dailyAttendance: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  absenceNotice: { findMany: jest.fn() },
  absenceReason: { findMany: jest.fn(), count: jest.fn() },
  appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockCalendar = { entriesBetween: jest.fn() };

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];
const group = { id: 'g1', name: 'Сонечко', kind: GroupKind.kindergarten, teachers: [{ id: 't1' }] };
const kid = (id: string) => ({ id, firstName: id, lastName: id, middleName: null });
const mark = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  childId: 'c1',
  groupId: 'g1',
  date: day('2026-10-14'),
  status: DailyStatus.present,
  reasonId: null,
  note: null,
  documentProvided: false,
  voidedAt: null,
  createdAt: new Date('2026-10-14T08:00:00Z'),
  markedBy: { id: 't1', firstName: 'Олена', lastName: 'Коваль' },
  ...over,
});

describe('RegisterService', () => {
  let service: RegisterService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RegisterService,
        { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService },
        { provide: CalendarService, useValue: mockCalendar as unknown as CalendarService },
      ],
    }).compile();
    service = moduleRef.get(RegisterService);
    mockPrisma.group.findUnique.mockResolvedValue(group);
    mockPrisma.child.findMany.mockResolvedValue([kid('c1'), kid('c2')]);
    mockPrisma.dailyAttendance.findMany.mockResolvedValue([]);
    mockPrisma.absenceNotice.findMany.mockResolvedValue([]);
    mockPrisma.absenceReason.findMany.mockResolvedValue([{ id: 'sick', requiresDocument: true, excused: true, name: 'Хвороба' }]);
    mockPrisma.absenceReason.count.mockResolvedValue(1);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  describe('access', () => {
    it('rejects a teacher of another group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({ ...group, teachers: [{ id: 'other' }] });
      await expect(service.day('g1', '2026-10-14', teacher, TODAY)).rejects.toThrow(new ForbiddenException('Not your group'));
      await expect(
        service.save('g1', { date: '2026-10-14', marks: [] }, teacher, TODAY),
      ).rejects.toThrow(new ForbiddenException('Not your group'));
    });

    it('returns 404 for an unknown group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      await expect(service.day('nope', '2026-10-14', admin, TODAY)).rejects.toThrow(new NotFoundException('Group not found'));
    });

    it('lists only own groups for a teacher', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.groupsFor(teacher);
      expect(firstArg<{ where: object }>(mockPrisma.group.findMany).where).toEqual({ teachers: { some: { id: 't1' } } });
    });
  });

  describe('day', () => {
    it('shows an approved notice as expected absence and a mark as present', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([mark({ childId: 'c2' })]);
      mockPrisma.absenceNotice.findMany.mockResolvedValue([
        { id: 'n1', childId: 'c1', startDate: day('2026-10-13'), endDate: day('2026-10-15'), reasonId: 'sick', comment: null, status: NoticeStatus.approved },
        { id: 'n2', childId: 'c2', startDate: day('2026-10-14'), endDate: day('2026-10-14'), reasonId: 'sick', comment: null, status: NoticeStatus.approved },
      ]);
      const view = await service.day('g1', '2026-10-14', teacher, TODAY);
      expect(view.working).toBe(true);
      expect(view.canEdit).toBe(true);
      expect(view.children[0]).toMatchObject({ state: 'expected_absent', documentRequired: true, notice: { id: 'n1', startDate: '2026-10-13', endDate: '2026-10-15' } });
      expect(view.children[1]).toMatchObject({ state: 'present', mark: { id: 'm1', status: DailyStatus.present } });
    });

    it('marks a weekend as not working and not editable', async () => {
      const view = await service.day('g1', '2026-10-17', admin, day('2026-10-19'));
      expect(view).toMatchObject({ working: false, canEdit: false });
    });

    it('closes editing for a teacher outside the window and asks admins for a reason', async () => {
      const forTeacher = await service.day('g1', '2026-10-09', teacher, TODAY);
      expect(forTeacher).toMatchObject({ canEdit: false, needsReason: false });
      const forAdmin = await service.day('g1', '2026-10-09', admin, TODAY);
      expect(forAdmin).toMatchObject({ canEdit: true, needsReason: true });
    });
  });

  describe('save', () => {
    const present = (childId: string) => ({ childId, status: DailyStatus.present });

    beforeEach(() => {
      jest.spyOn(service, 'day').mockResolvedValue({} as Awaited<ReturnType<RegisterService['day']>>);
    });

    it('rejects future days', async () => {
      await expect(service.save('g1', { date: '2026-10-15', marks: [present('c1')] }, admin, TODAY)).rejects.toThrow(
        new BadRequestException('Cannot mark future days'),
      );
    });

    it('rejects non-working days', async () => {
      await expect(service.save('g1', { date: '2026-10-11', marks: [present('c1')] }, admin, TODAY)).rejects.toThrow(
        new BadRequestException('Not a working day'),
      );
    });

    it('enforces the edit window for teachers and the reason for admins', async () => {
      await expect(service.save('g1', { date: '2026-10-09', marks: [present('c1')] }, teacher, TODAY)).rejects.toThrow(
        new ForbiddenException('Edit window has passed'),
      );
      await expect(service.save('g1', { date: '2026-10-09', marks: [present('c1')] }, admin, TODAY)).rejects.toThrow(
        new BadRequestException('Reason is required'),
      );
      await expect(service.save('g1', { date: '2026-10-12', marks: [present('c1')] }, teacher, TODAY)).resolves.toBeDefined();
    });

    it('uses the configured window', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ key: 'attendanceEditDays', value: '0' });
      await expect(service.save('g1', { date: '2026-10-13', marks: [present('c1')] }, teacher, TODAY)).rejects.toThrow(
        new ForbiddenException('Edit window has passed'),
      );
    });

    it('validates marks', async () => {
      await expect(
        service.save('g1', { date: '2026-10-14', marks: [present('c1'), present('c1')] }, admin, TODAY),
      ).rejects.toThrow(new BadRequestException('Duplicate child in marks'));
      await expect(
        service.save('g1', { date: '2026-10-14', marks: [{ childId: 'c1', status: DailyStatus.late, reasonId: 'sick' }] }, admin, TODAY),
      ).rejects.toThrow(new BadRequestException('Reason is only allowed for absences'));
      mockPrisma.absenceReason.count.mockResolvedValue(0);
      await expect(
        service.save('g1', { date: '2026-10-14', marks: [{ childId: 'c1', status: DailyStatus.absent, reasonId: 'gone' }] }, admin, TODAY),
      ).rejects.toThrow(new BadRequestException('Absence reason not found'));
      await expect(service.save('g1', { date: '2026-10-14', marks: [present('stranger')] }, admin, TODAY)).rejects.toThrow(
        new BadRequestException('Child is not in this group'),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('locks children before reading marks, skips unchanged and voids changed ones', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ id: 'm1', childId: 'c1' }),
        mark({ id: 'm2', childId: 'c2' }),
      ]);
      await service.save(
        'g1',
        { date: '2026-10-14', marks: [present('c1'), { childId: 'c2', status: DailyStatus.absent, reasonId: 'sick', note: ' кашель ' }] },
        teacher,
        TODAY,
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.dailyAttendance.findMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.dailyAttendance.update).toHaveBeenCalledTimes(1);
      expect(firstArg<{ where: { id: string }; data: { voidReason: string; voidedById: string } }>(mockPrisma.dailyAttendance.update)).toMatchObject({
        where: { id: 'm2' },
        data: { voidReason: 'Corrected', voidedById: 't1' },
      });
      expect(firstArg<{ data: object }>(mockPrisma.dailyAttendance.create).data).toEqual({
        childId: 'c2',
        groupId: 'g1',
        date: day('2026-10-14'),
        status: DailyStatus.absent,
        reasonId: 'sick',
        note: 'кашель',
        documentProvided: false,
        markedById: 't1',
      });
    });

    it('stores the admin reason as the void reason outside the window', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([mark({ id: 'm1', childId: 'c1', date: day('2026-10-09') })]);
      await service.save('g1', { date: '2026-10-09', reason: ' довідка ', marks: [{ childId: 'c1', status: DailyStatus.absent, reasonId: 'sick', documentProvided: true }] }, admin, TODAY);
      expect(firstArg<{ data: { voidReason: string } }>(mockPrisma.dailyAttendance.update).data.voidReason).toBe('довідка');
    });
  });

  describe('month', () => {
    it('summarizes each child', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ childId: 'c1', date: day('2026-10-01'), status: DailyStatus.absent, reasonId: 'sick' }),
        mark({ childId: 'c1', date: day('2026-10-02') }),
      ]);
      const view = await service.month('g1', '2026-10', admin);
      expect(view.days).toHaveLength(31);
      expect(view.children[0].summary).toEqual({
        workingDays: 22,
        present: 1,
        absentExcused: 1,
        absentUnexcused: 0,
        expectedAbsent: 0,
        unmarked: 20,
      });
    });
  });

  describe('expectedPresence', () => {
    it('includes present and unmarked working days only', async () => {
      mockPrisma.child.findMany.mockResolvedValue([
        { id: 'c1', group: { id: 'g1', kind: GroupKind.kindergarten } },
        { id: 'c2', group: null },
      ]);
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        { childId: 'c1', date: day('2026-10-12'), status: DailyStatus.absent, reasonId: null, voidedAt: null, group: { id: 'g1', kind: GroupKind.kindergarten } },
      ]);
      mockPrisma.absenceNotice.findMany.mockResolvedValue([
        { childId: 'c1', startDate: day('2026-10-13'), endDate: day('2026-10-13'), reasonId: 'sick', status: NoticeStatus.approved },
      ]);
      const rows = await service.expectedPresence(['c1', 'c2'], day('2026-10-12'), day('2026-10-18'));
      expect(rows.map((r) => `${r.childId} ${r.date.toISOString().slice(0, 10)}`)).toEqual([
        'c1 2026-10-14',
        'c1 2026-10-15',
        'c1 2026-10-16',
      ]);
    });
  });

  describe('settings', () => {
    it('defaults to 3 and validates the range', async () => {
      await expect(service.getEditDays()).resolves.toBe(3);
      await expect(service.setEditDays(31)).rejects.toThrow(new BadRequestException('Edit days must be between 0 and 30'));
      mockPrisma.appSetting.upsert.mockResolvedValue({});
      await expect(service.setEditDays(5)).resolves.toEqual({ editDays: 5 });
    });
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `npx jest src/attendance/register.service.spec.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/attendance/register.service.ts`**

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DailyStatus, NoticeStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { CalendarService } from './calendar.service';
import {
  dayInfo,
  dayRange,
  parseMonth,
  resolveDay,
  summarizeDays,
} from './register-calc';
import { SaveRegisterDto } from './dto/save-register.dto';

const EDIT_KEY = 'attendanceEditDays';
const DEFAULT_EDIT_DAYS = 3;

const childSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
} as const;

const time = (day: Date) => day.getTime();

const isAdmin = (user: AuthenticatedUser) =>
  user.role === Role.root || user.role === Role.admin;

@Injectable()
export class RegisterService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  async getEditDays(): Promise<number> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: EDIT_KEY },
    });
    return setting ? Number(setting.value) : DEFAULT_EDIT_DAYS;
  }

  async setEditDays(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 30) {
      throw new BadRequestException('Edit days must be between 0 and 30');
    }
    await this.prisma.appSetting.upsert({
      where: { key: EDIT_KEY },
      create: { key: EDIT_KEY, value: String(value) },
      update: { value: String(value) },
    });
    return { editDays: value };
  }

  groupsFor(user: AuthenticatedUser) {
    return this.prisma.group.findMany({
      where: isAdmin(user) ? {} : { teachers: { some: { id: user.id } } },
      select: { id: true, name: true, kind: true },
      orderBy: { name: 'asc' },
    });
  }

  private async loadGroup(groupId: string, user: AuthenticatedUser) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        kind: true,
        teachers: { select: { id: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (!isAdmin(user) && !group.teachers.some((t) => t.id === user.id)) {
      throw new ForbiddenException('Not your group');
    }
    return group;
  }

  private childrenOf(groupId: string, from: Date, to: Date) {
    return this.prisma.child.findMany({
      where: {
        OR: [
          { groupId },
          {
            dailyAttendances: {
              some: { groupId, voidedAt: null, date: { gte: from, lte: to } },
            },
          },
        ],
      },
      select: childSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  private inWindow(date: Date, today: Date, editDays: number) {
    return time(date) >= time(addDays(today, -editDays));
  }

  async day(
    groupId: string,
    dateValue: string,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.loadGroup(groupId, user);
    const date = parseDay(dateValue);
    const [entries, editDays, children, reasons] = await Promise.all([
      this.calendar.entriesBetween(date, date),
      this.getEditDays(),
      this.childrenOf(groupId, date, date),
      this.prisma.absenceReason.findMany({
        select: { id: true, requiresDocument: true },
      }),
    ]);
    const ids = children.map((c) => c.id);
    const [marks, notices] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: { childId: { in: ids }, date, voidedAt: null },
        include: {
          markedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.absenceNotice.findMany({
        where: {
          childId: { in: ids },
          status: NoticeStatus.approved,
          startDate: { lte: date },
          endDate: { gte: date },
        },
      }),
    ]);
    const info = dayInfo(date, group, entries);
    const window = this.inWindow(date, today, editDays);
    const notFuture = time(date) <= time(today);
    const requiresDocument = new Set(
      reasons.filter((r) => r.requiresDocument).map((r) => r.id),
    );
    return {
      date: isoDay(date),
      working: info.working,
      calendarTitle: info.title,
      canEdit: info.working && notFuture && (isAdmin(user) || window),
      needsReason: isAdmin(user) && !window,
      children: children.map((child) => {
        const own = marks.filter((m) => m.childId === child.id);
        const ownNotices = notices.filter((n) => n.childId === child.id);
        const resolved = resolveDay(date, info.working, own, ownNotices);
        const mark = own[0] ?? null;
        const notice = ownNotices[0] ?? null;
        return {
          child,
          state: resolved.state,
          mark: mark && {
            id: mark.id,
            status: mark.status,
            reasonId: mark.reasonId,
            note: mark.note,
            documentProvided: mark.documentProvided,
            markedBy: mark.markedBy,
            createdAt: mark.createdAt,
          },
          notice: notice && {
            id: notice.id,
            startDate: isoDay(notice.startDate),
            endDate: isoDay(notice.endDate),
            reasonId: notice.reasonId,
            comment: notice.comment,
          },
          documentRequired:
            resolved.reasonId !== null &&
            requiresDocument.has(resolved.reasonId),
        };
      }),
    };
  }

  async save(
    groupId: string,
    dto: SaveRegisterDto,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.loadGroup(groupId, user);
    const date = parseDay(dto.date);
    if (time(date) > time(today))
      throw new BadRequestException('Cannot mark future days');
    const [entries, editDays] = await Promise.all([
      this.calendar.entriesBetween(date, date),
      this.getEditDays(),
    ]);
    if (!dayInfo(date, group, entries).working)
      throw new BadRequestException('Not a working day');
    const reason = dto.reason?.trim() || null;
    if (!this.inWindow(date, today, editDays)) {
      if (!isAdmin(user)) throw new ForbiddenException('Edit window has passed');
      if (!reason) throw new BadRequestException('Reason is required');
    }
    const ids = dto.marks.map((m) => m.childId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Duplicate child in marks');
    for (const m of dto.marks) {
      if (m.status !== DailyStatus.absent && (m.reasonId || m.documentProvided))
        throw new BadRequestException('Reason is only allowed for absences');
    }
    const reasonIds = [
      ...new Set(dto.marks.flatMap((m) => (m.reasonId ? [m.reasonId] : []))),
    ];
    if (reasonIds.length) {
      const found = await this.prisma.absenceReason.count({
        where: { id: { in: reasonIds }, active: true },
      });
      if (found !== reasonIds.length)
        throw new BadRequestException('Absence reason not found');
    }
    const allowed = new Set(
      (await this.childrenOf(groupId, date, date)).map((c) => c.id),
    );
    if (ids.some((id) => !allowed.has(id)))
      throw new BadRequestException('Child is not in this group');

    if (ids.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Child" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
        const active = await tx.dailyAttendance.findMany({
          where: { childId: { in: ids }, date, voidedAt: null },
        });
        const now = new Date();
        for (const m of dto.marks) {
          const next = {
            status: m.status,
            reasonId: m.reasonId ?? null,
            note: m.note?.trim() || null,
            documentProvided: m.documentProvided ?? false,
          };
          const existing = active.find((a) => a.childId === m.childId);
          if (
            existing &&
            existing.groupId === groupId &&
            existing.status === next.status &&
            existing.reasonId === next.reasonId &&
            existing.note === next.note &&
            existing.documentProvided === next.documentProvided
          )
            continue;
          if (existing) {
            await tx.dailyAttendance.update({
              where: { id: existing.id },
              data: {
                voidedAt: now,
                voidedById: user.id,
                voidReason: reason ?? 'Corrected',
              },
            });
          }
          await tx.dailyAttendance.create({
            data: {
              childId: m.childId,
              groupId,
              date,
              ...next,
              markedById: user.id,
            },
          });
        }
      });
    }
    return this.day(groupId, dto.date, user, today);
  }

  async month(groupId: string, monthValue: string, user: AuthenticatedUser) {
    const group = await this.loadGroup(groupId, user);
    const { from, to, days } = parseMonth(monthValue);
    const [entries, children, reasons] = await Promise.all([
      this.calendar.entriesBetween(from, to),
      this.childrenOf(groupId, from, to),
      this.prisma.absenceReason.findMany({ select: { id: true, excused: true } }),
    ]);
    const ids = children.map((c) => c.id);
    const [marks, notices] = await Promise.all([
      this.prisma.dailyAttendance.findMany({
        where: {
          childId: { in: ids },
          date: { gte: from, lte: to },
          voidedAt: null,
        },
      }),
      this.prisma.absenceNotice.findMany({
        where: {
          childId: { in: ids },
          status: NoticeStatus.approved,
          startDate: { lte: to },
          endDate: { gte: from },
        },
      }),
    ]);
    const excused = new Set(reasons.filter((r) => r.excused).map((r) => r.id));
    const infos = days.map((d) => dayInfo(d, group, entries));
    return {
      month: monthValue,
      days: days.map((d, i) => ({
        date: isoDay(d),
        working: infos[i].working,
        title: infos[i].title,
      })),
      children: children.map((child) => {
        const own = marks.filter((m) => m.childId === child.id);
        const ownNotices = notices.filter((n) => n.childId === child.id);
        const resolved = days.map((d, i) =>
          resolveDay(d, infos[i].working, own, ownNotices),
        );
        return {
          child,
          days: resolved.map((r, i) => ({
            date: isoDay(days[i]),
            state: r.state,
            status: r.status,
            reasonId: r.reasonId,
          })),
          summary: summarizeDays(resolved, excused),
        };
      }),
    };
  }

  async childDays(childIds: string[], from: Date, to: Date) {
    const days = dayRange(from, to);
    const groupSelect = { select: { id: true, kind: true } } as const;
    const [children, entries, marks, notices] = await Promise.all([
      this.prisma.child.findMany({
        where: { id: { in: childIds } },
        select: { id: true, group: groupSelect },
      }),
      this.calendar.entriesBetween(from, to),
      this.prisma.dailyAttendance.findMany({
        where: {
          childId: { in: childIds },
          date: { gte: from, lte: to },
          voidedAt: null,
        },
        select: {
          childId: true,
          date: true,
          status: true,
          reasonId: true,
          voidedAt: true,
          group: groupSelect,
        },
      }),
      this.prisma.absenceNotice.findMany({
        where: {
          childId: { in: childIds },
          status: NoticeStatus.approved,
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: {
          childId: true,
          startDate: true,
          endDate: true,
          reasonId: true,
          status: true,
        },
      }),
    ]);
    return children.map((child) => {
      const own = marks.filter((m) => m.childId === child.id);
      const ownNotices = notices.filter((n) => n.childId === child.id);
      return {
        childId: child.id,
        days: days.map((date) => {
          const mark = own.find((m) => time(m.date) === time(date));
          const group = mark?.group ?? child.group;
          const info = dayInfo(date, group, entries);
          return {
            date,
            title: info.title,
            hasGroup: group !== null,
            ...resolveDay(date, info.working, own, ownNotices),
          };
        }),
      };
    });
  }

  async expectedPresence(childIds: string[], from: Date, to: Date) {
    const rows = await this.childDays(childIds, from, to);
    return rows.flatMap((row) =>
      row.days
        .filter(
          (d) =>
            d.hasGroup && (d.state === 'present' || d.state === 'unmarked'),
        )
        .map((d) => ({ childId: row.childId, date: d.date })),
    );
  }
}
```

(In the `month` test, October 2026 has 22 weekdays: 2 marked + 20 unmarked.)

- [ ] **Step 5: Controller and module**

`src/attendance/register.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { RegisterService } from './register.service';
import { SaveRegisterDto } from './dto/save-register.dto';
import { UpdateRegisterSettingsDto } from './dto/update-register-settings.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller()
export class RegisterController {
  constructor(private register: RegisterService) {}

  @Get('register/groups')
  groups(@CurrentUser() user: AuthenticatedUser) {
    return this.register.groupsFor(user);
  }

  @Get('register/settings')
  async settings() {
    return { editDays: await this.register.getEditDays() };
  }

  @Patch('register/settings')
  @Roles(Role.root, Role.admin)
  updateSettings(@Body() dto: UpdateRegisterSettingsDto) {
    return this.register.setEditDays(dto.editDays);
  }

  @Get('groups/:id/register')
  day(
    @Param('id') id: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.day(id, date, user);
  }

  @Put('groups/:id/register')
  save(
    @Param('id') id: string,
    @Body() dto: SaveRegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.save(id, dto, user);
  }

  @Get('groups/:id/register/month')
  month(
    @Param('id') id: string,
    @Query('month') month: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.register.month(id, month, user);
  }
}
```

In `attendance.module.ts` add `RegisterController` to `controllers`, `RegisterService` to `providers` and `exports`.

- [ ] **Step 6: Verify**

Run: `npx jest src/attendance` → PASS; full `npx jest`; `npm run build`; `npx eslint --fix` on touched files.

- [ ] **Step 7: Commit**

```bash
git add src/attendance
git commit -m "feat: add daily attendance register"
```

---

### Task 5: Absence notices, parent endpoints and shared ownership check

**Files:**
- Create: `src/common/ownership.ts`, `src/attendance/dto/create-notice.dto.ts`, `src/attendance/dto/list-notices-query.dto.ts`, `src/attendance/notices.service.ts`, `src/attendance/notices.service.spec.ts`, `src/attendance/absence-notices.controller.ts`, `src/attendance/parent-attendance.service.ts`, `src/attendance/parent-attendance.service.spec.ts`, `src/attendance/parent-attendance.controller.ts`
- Modify: `src/attendance/attendance.module.ts`, `src/parent-cabinet/parent-cabinet.service.ts`

**Interfaces:**
- Consumes: `RegisterService.childDays`, `summarizeDays`, `parseMonth` (Tasks 2, 4); `ReasonDto` (Task 3); `parseDay`; `kyivToday`, `dayCount`, `isoDay`.
- Produces:
  - `assertOwnChild(prisma: PrismaService, parentId: string, childId: string): Promise<void>` (404 `Child not found`) in `src/common/ownership.ts`.
  - Admin routes `GET /absence-notices?status=&groupId=`, `POST /absence-notices/:id/approve|reject|cancel`.
  - Parent routes `POST/GET /me/children/:id/absence-notices`, `POST /me/children/:id/absence-notices/:noticeId/cancel`, `GET /me/children/:id/register?month=`.
  - Shapes: admin notice `{ id, startDate, endDate, comment, status, decisionReason, decidedAt, createdAt, reason: { id, name }, child: { id, firstName, lastName, middleName, group: { id, name } | null }, createdBy: { id, firstName, lastName }, decidedBy: { id, firstName, lastName } | null }`; parent notice `{ id, startDate, endDate, comment, status, decisionReason, createdAt, reason: { id, name } }`; parent month `{ month, days: [{ date, state, status, reasonName, title }], summary }`.

- [ ] **Step 1: Shared ownership**

`src/common/ownership.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function assertOwnChild(
  prisma: PrismaService,
  parentId: string,
  childId: string,
): Promise<void> {
  const child = await prisma.child.findFirst({
    where: { id: childId, parents: { some: { id: parentId } } },
    select: { id: true },
  });
  if (!child) throw new NotFoundException('Child not found');
}
```

In `ParentCabinetService` replace the body of the private `assertOwnChild` with `return assertOwnChild(this.prisma, parentId, childId);` (import it from `../common/ownership`; remove the now unused `NotFoundException` import if eslint reports it). Existing parent-cabinet tests must stay green unchanged.

- [ ] **Step 2: DTOs**

`src/attendance/dto/create-notice.dto.ts`:

```ts
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateNoticeDto {
  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsUUID('4')
  reasonId: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  comment?: string;
}
```

`src/attendance/dto/list-notices-query.dto.ts`:

```ts
import { NoticeStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class ListNoticesQueryDto {
  @IsEnum(NoticeStatus)
  @IsOptional()
  status?: NoticeStatus;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;
}
```

- [ ] **Step 3: Failing tests**

`src/attendance/notices.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NoticeStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NoticesService } from './notices.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');
const admin = { id: 'a1', role: Role.admin, login: 'admin', mustChangePassword: false };

const notice = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  startDate: day('2026-10-15'),
  endDate: day('2026-10-16'),
  comment: null,
  status: NoticeStatus.pending,
  decisionReason: null,
  createdAt: new Date('2026-10-14T07:00:00Z'),
  reason: { id: 'sick', name: 'Хвороба' },
  ...over,
});

const mockPrisma = {
  child: { findFirst: jest.fn() },
  absenceReason: { findFirst: jest.fn() },
  absenceNotice: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('NoticesService', () => {
  let service: NoticesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [NoticesService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = moduleRef.get(NoticesService);
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.absenceReason.findFirst.mockResolvedValue({ id: 'sick' });
    mockPrisma.absenceNotice.findFirst.mockResolvedValue(null);
    mockPrisma.absenceNotice.create.mockResolvedValue(notice());
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  describe('admin decisions', () => {
    it('approves a pending notice', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(notice({ status: NoticeStatus.approved }));
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      await service.approve('n1', admin);
      expect(firstArg<{ where: object; data: object }>(mockPrisma.absenceNotice.updateMany)).toMatchObject({
        where: { id: 'n1', status: NoticeStatus.pending },
        data: { status: NoticeStatus.approved, decidedById: 'a1', decisionReason: null },
      });
    });

    it('refuses to decide twice and reports missing notices', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(notice({ status: NoticeStatus.approved }));
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject('n1', 'ні', admin)).rejects.toThrow(new BadRequestException('Notice already decided'));
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(null);
      await expect(service.approve('n9', admin)).rejects.toThrow(new NotFoundException('Notice not found'));
    });

    it('stores the trimmed reject reason and cancels only approved notices', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(notice());
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      await service.reject('n1', ' немає довідки ', admin);
      expect(firstArg<{ data: { decisionReason: string } }>(mockPrisma.absenceNotice.updateMany).data.decisionReason).toBe('немає довідки');
      await service.cancel('n1', 'помилка', admin);
      expect((mockPrisma.absenceNotice.updateMany.mock.calls[1] as [{ where: object; data: object }])[0]).toMatchObject({
        where: { id: 'n1', status: NoticeStatus.approved },
        data: { status: NoticeStatus.cancelled },
      });
    });
  });

  describe('parent notices', () => {
    const dto = { startDate: '2026-10-15', endDate: '2026-10-16', reasonId: 'sick', comment: ' температура ' };

    it('hides a foreign child', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(service.createForParent('p1', 'c1', dto, TODAY)).rejects.toThrow(new NotFoundException('Child not found'));
      await expect(service.listForParent('p1', 'c1')).rejects.toThrow(new NotFoundException('Child not found'));
    });

    it('rejects past starts, inverted and too long periods', async () => {
      await expect(service.createForParent('p1', 'c1', { ...dto, startDate: '2026-10-13' }, TODAY)).rejects.toThrow(new BadRequestException('Invalid period'));
      await expect(service.createForParent('p1', 'c1', { ...dto, endDate: '2026-10-14' }, TODAY)).rejects.toThrow(new BadRequestException('Invalid period'));
      await expect(service.createForParent('p1', 'c1', { ...dto, startDate: '2026-10-14', endDate: '2026-12-13' }, TODAY)).rejects.toThrow(
        new BadRequestException('Notice period is too long'),
      );
      await expect(service.createForParent('p1', 'c1', { ...dto, startDate: '2026-10-14', endDate: '2026-12-12' }, TODAY)).resolves.toBeDefined();
    });

    it('rejects an inactive reason', async () => {
      mockPrisma.absenceReason.findFirst.mockResolvedValue(null);
      await expect(service.createForParent('p1', 'c1', dto, TODAY)).rejects.toThrow(new BadRequestException('Absence reason not found'));
    });

    it('locks the child before checking overlaps and rejects an overlap', async () => {
      mockPrisma.absenceNotice.findFirst.mockResolvedValue(notice());
      await expect(service.createForParent('p1', 'c1', dto, TODAY)).rejects.toThrow(new BadRequestException('Notice overlaps an existing notice'));
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.absenceNotice.findFirst.mock.invocationCallOrder[0]);
      expect(firstArg<{ where: object }>(mockPrisma.absenceNotice.findFirst).where).toEqual({
        childId: 'c1',
        status: { in: [NoticeStatus.pending, NoticeStatus.approved] },
        startDate: { lte: day('2026-10-16') },
        endDate: { gte: day('2026-10-15') },
      });
      expect(mockPrisma.absenceNotice.create).not.toHaveBeenCalled();
    });

    it('creates a pending notice and returns the parent view', async () => {
      const view = await service.createForParent('p1', 'c1', dto, TODAY);
      expect(firstArg<{ data: object }>(mockPrisma.absenceNotice.create).data).toEqual({
        childId: 'c1',
        startDate: day('2026-10-15'),
        endDate: day('2026-10-16'),
        reasonId: 'sick',
        comment: 'температура',
        createdById: 'p1',
      });
      expect(view).toEqual({
        id: 'n1',
        startDate: '2026-10-15',
        endDate: '2026-10-16',
        comment: null,
        status: NoticeStatus.pending,
        decisionReason: null,
        createdAt: new Date('2026-10-14T07:00:00Z'),
        reason: { id: 'sick', name: 'Хвороба' },
      });
    });

    it('lets a parent cancel only a pending notice of their child', async () => {
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(notice({ status: NoticeStatus.cancelled }));
      await service.cancelForParent('p1', 'c1', 'n1');
      expect(firstArg<{ where: object }>(mockPrisma.absenceNotice.updateMany).where).toEqual({ id: 'n1', childId: 'c1', status: NoticeStatus.pending });
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.absenceNotice.findFirst.mockResolvedValue(notice({ status: NoticeStatus.approved }));
      await expect(service.cancelForParent('p1', 'c1', 'n1')).rejects.toThrow(new BadRequestException('Notice already decided'));
      mockPrisma.absenceNotice.findFirst.mockResolvedValue(null);
      await expect(service.cancelForParent('p1', 'c1', 'n2')).rejects.toThrow(new NotFoundException('Notice not found'));
    });
  });
});
```

`src/attendance/parent-attendance.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DailyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ParentAttendanceService } from './parent-attendance.service';
import { RegisterService } from './register.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const mockPrisma = {
  child: { findFirst: jest.fn() },
  absenceReason: { findMany: jest.fn() },
};
const mockRegister = { childDays: jest.fn() };

describe('ParentAttendanceService', () => {
  let service: ParentAttendanceService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ParentAttendanceService,
        { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService },
        { provide: RegisterService, useValue: mockRegister as unknown as RegisterService },
      ],
    }).compile();
    service = moduleRef.get(ParentAttendanceService);
  });

  it('hides a foreign child', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(service.month('p1', 'c9', '2026-10')).rejects.toThrow(new NotFoundException('Child not found'));
    expect(mockRegister.childDays).not.toHaveBeenCalled();
  });

  it('returns days with reason names and a summary, without staff data', async () => {
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.absenceReason.findMany.mockResolvedValue([{ id: 'sick', name: 'Хвороба', excused: true }]);
    mockRegister.childDays.mockResolvedValue([
      {
        childId: 'c1',
        days: [
          { date: day('2026-10-01'), title: null, hasGroup: true, working: true, state: 'absent', status: DailyStatus.absent, reasonId: 'sick', source: 'mark' },
          { date: day('2026-10-04'), title: null, hasGroup: true, working: false, state: 'non_working', status: null, reasonId: null, source: 'none' },
        ],
      },
    ]);
    const view = await service.month('p1', 'c1', '2026-10');
    expect(mockRegister.childDays).toHaveBeenCalledWith(['c1'], day('2026-10-01'), day('2026-10-31'));
    expect(view).toEqual({
      month: '2026-10',
      days: [
        { date: '2026-10-01', state: 'absent', status: DailyStatus.absent, reasonName: 'Хвороба', title: null },
        { date: '2026-10-04', state: 'non_working', status: null, reasonName: null, title: null },
      ],
      summary: { workingDays: 1, present: 0, absentExcused: 1, absentUnexcused: 0, expectedAbsent: 0, unmarked: 0 },
    });
  });
});
```

- [ ] **Step 4: Run, verify failure**

Run: `npx jest src/attendance/notices.service.spec.ts src/attendance/parent-attendance.service.spec.ts` → FAIL (modules missing).

- [ ] **Step 5: Implement `src/attendance/notices.service.ts`**

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NoticeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { assertOwnChild } from '../common/ownership';
import { parseDay } from '../classes/access';
import { dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { ListNoticesQueryDto } from './dto/list-notices-query.dto';

const MAX_NOTICE_DAYS = 60;
const person = { select: { id: true, firstName: true, lastName: true } } as const;

const parentSelect = {
  id: true,
  startDate: true,
  endDate: true,
  comment: true,
  status: true,
  decisionReason: true,
  createdAt: true,
  reason: { select: { id: true, name: true } },
} as const;

const adminSelect = {
  ...parentSelect,
  decidedAt: true,
  child: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      group: { select: { id: true, name: true } },
    },
  },
  createdBy: person,
  decidedBy: person,
} as const;

const withDays = <T extends { startDate: Date; endDate: Date }>(notice: T) => ({
  ...notice,
  startDate: isoDay(notice.startDate),
  endDate: isoDay(notice.endDate),
});

@Injectable()
export class NoticesService {
  constructor(private prisma: PrismaService) {}

  async list(query: ListNoticesQueryDto) {
    const notices = await this.prisma.absenceNotice.findMany({
      where: {
        status: query.status,
        child: query.groupId ? { groupId: query.groupId } : undefined,
      },
      select: adminSelect,
      orderBy: { createdAt: 'desc' },
    });
    return notices.map(withDays);
  }

  approve(id: string, user: AuthenticatedUser) {
    return this.decide(id, NoticeStatus.pending, NoticeStatus.approved, user, null);
  }

  reject(id: string, reason: string, user: AuthenticatedUser) {
    return this.decide(id, NoticeStatus.pending, NoticeStatus.rejected, user, reason.trim());
  }

  cancel(id: string, reason: string, user: AuthenticatedUser) {
    return this.decide(id, NoticeStatus.approved, NoticeStatus.cancelled, user, reason.trim());
  }

  private async decide(
    id: string,
    from: NoticeStatus,
    to: NoticeStatus,
    user: AuthenticatedUser,
    reason: string | null,
  ) {
    const exists = await this.prisma.absenceNotice.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Notice not found');
    const { count } = await this.prisma.absenceNotice.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        decidedById: user.id,
        decidedAt: new Date(),
        decisionReason: reason,
      },
    });
    if (count === 0) throw new BadRequestException('Notice already decided');
    const notice = await this.prisma.absenceNotice.findUnique({
      where: { id },
      select: adminSelect,
    });
    return notice && withDays(notice);
  }

  async listForParent(parentId: string, childId: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const notices = await this.prisma.absenceNotice.findMany({
      where: { childId },
      select: parentSelect,
      orderBy: { createdAt: 'desc' },
    });
    return notices.map(withDays);
  }

  async createForParent(
    parentId: string,
    childId: string,
    dto: CreateNoticeDto,
    today: Date = kyivToday(),
  ) {
    await assertOwnChild(this.prisma, parentId, childId);
    const startDate = parseDay(dto.startDate);
    const endDate = parseDay(dto.endDate);
    if (
      startDate.getTime() < today.getTime() ||
      endDate.getTime() < startDate.getTime()
    )
      throw new BadRequestException('Invalid period');
    if (dayCount(startDate, endDate) > MAX_NOTICE_DAYS)
      throw new BadRequestException('Notice period is too long');
    const reason = await this.prisma.absenceReason.findFirst({
      where: { id: dto.reasonId, active: true },
      select: { id: true },
    });
    if (!reason) throw new BadRequestException('Absence reason not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${childId} FOR UPDATE`;
      const overlap = await tx.absenceNotice.findFirst({
        where: {
          childId,
          status: { in: [NoticeStatus.pending, NoticeStatus.approved] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });
      if (overlap)
        throw new BadRequestException('Notice overlaps an existing notice');
      const notice = await tx.absenceNotice.create({
        data: {
          childId,
          startDate,
          endDate,
          reasonId: dto.reasonId,
          comment: dto.comment?.trim() || null,
          createdById: parentId,
        },
        select: parentSelect,
      });
      return withDays(notice);
    });
  }

  async cancelForParent(parentId: string, childId: string, noticeId: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const { count } = await this.prisma.absenceNotice.updateMany({
      where: { id: noticeId, childId, status: NoticeStatus.pending },
      data: {
        status: NoticeStatus.cancelled,
        decidedById: parentId,
        decidedAt: new Date(),
      },
    });
    if (count === 0) {
      const exists = await this.prisma.absenceNotice.findFirst({
        where: { id: noticeId, childId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notice not found');
      throw new BadRequestException('Notice already decided');
    }
    const notice = await this.prisma.absenceNotice.findUnique({
      where: { id: noticeId },
      select: parentSelect,
    });
    return notice && withDays(notice);
  }
}
```

(The 61-day test: `2026-10-14..2026-12-13` is 61 days → too long; `..2026-12-12` is 60 days → allowed.)

- [ ] **Step 6: Implement `src/attendance/parent-attendance.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertOwnChild } from '../common/ownership';
import { isoDay } from '../tariffs/dates';
import { parseMonth, summarizeDays } from './register-calc';
import { RegisterService } from './register.service';

@Injectable()
export class ParentAttendanceService {
  constructor(
    private prisma: PrismaService,
    private register: RegisterService,
  ) {}

  async month(parentId: string, childId: string, monthValue: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const { from, to } = parseMonth(monthValue);
    const [rows, reasons] = await Promise.all([
      this.register.childDays([childId], from, to),
      this.prisma.absenceReason.findMany({
        select: { id: true, name: true, excused: true },
      }),
    ]);
    const names = new Map(reasons.map((r) => [r.id, r.name]));
    const excused = new Set(reasons.filter((r) => r.excused).map((r) => r.id));
    const days = rows[0]?.days ?? [];
    return {
      month: monthValue,
      days: days.map((d) => ({
        date: isoDay(d.date),
        state: d.state,
        status: d.status,
        reasonName: d.reasonId ? (names.get(d.reasonId) ?? null) : null,
        title: d.title,
      })),
      summary: summarizeDays(days, excused),
    };
  }
}
```

- [ ] **Step 7: Controllers and module**

`src/attendance/absence-notices.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { NoticesService } from './notices.service';
import { ListNoticesQueryDto } from './dto/list-notices-query.dto';
import { ReasonDto } from './dto/reason.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('absence-notices')
export class AbsenceNoticesController {
  constructor(private notices: NoticesService) {}

  @Get()
  list(@Query() query: ListNoticesQueryDto) {
    return this.notices.list(query);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notices.approve(id, user);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notices.reject(id, dto.reason, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notices.cancel(id, dto.reason, user);
  }
}
```

`src/attendance/parent-attendance.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { NoticesService } from './notices.service';
import { ParentAttendanceService } from './parent-attendance.service';
import { CreateNoticeDto } from './dto/create-notice.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me/children')
export class ParentAttendanceController {
  constructor(
    private notices: NoticesService,
    private attendance: ParentAttendanceService,
  ) {}

  @Get(':id/absence-notices')
  list(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notices.listForParent(user.id, id);
  }

  @Post(':id/absence-notices')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateNoticeDto,
  ) {
    return this.notices.createForParent(user.id, id, dto);
  }

  @Post(':id/absence-notices/:noticeId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('noticeId') noticeId: string,
  ) {
    return this.notices.cancelForParent(user.id, id, noticeId);
  }

  @Get(':id/register')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('month') month: string,
  ) {
    return this.attendance.month(user.id, id, month);
  }
}
```

Add both controllers and `NoticesService`, `ParentAttendanceService` to `AttendanceModule`.

- [ ] **Step 8: Verify**

Run: `npx jest src/attendance src/parent-cabinet` → PASS; full `npx jest`; `npm run build`; `npx eslint --fix` on touched files.

- [ ] **Step 9: Commit**

```bash
git add src/common/ownership.ts src/attendance src/parent-cabinet/parent-cabinet.service.ts
git commit -m "feat: add absence notices and parent attendance views"
```

---

### Task 6: Backend docs and live check

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md**

Add after "### Domain: parent cabinet":

```markdown
### Domain: attendance register

Spec: `docs/superpowers/specs/2026-10-12-attendance-register-design.md`. Code in `src/attendance/`:

- `Group.kind` is `kindergarten` or `school_class`. `AbsenceReason` is an admin directory (`excused`, `requiresDocument`, deactivated, never deleted).
- `CalendarDay` entries (void, never edit) make periods non-working or a weekend working; precedence group > group kind > all, `non_working` wins a tie. Default: Mon–Fri working.
- `DailyAttendance` = one active mark per child and day (`present`, `late`, `left_early`, `absent` + reason). Saving locks the children rows (`ORDER BY id FOR UPDATE`) before reading marks; corrections void the old mark. Teachers: own groups, `today − attendanceEditDays` (AppSetting, default 3) to today; admins any past day, with a reason outside the window. No future days, no non-working days.
- `AbsenceNotice`: parents submit (today or later, ≤ 60 days, no overlap with pending/approved), admins approve/reject/cancel. Notices are never copied into marks: `register-calc.ts` resolves a day as mark → approved notice → unmarked. Keep day logic there and test it without mocks.
- The register never touches money. Meals (Part 5) will use `RegisterService.expectedPresence`.
- Parent routes (`/me/children/:id/register`, `/me/children/:id/absence-notices`) check ownership with `assertOwnChild` (`src/common/ownership.ts`) and never return staff notes or staff names.
```

- [ ] **Step 2: Verify**

Run: `npx jest`, `npm run build`, `npx eslint "src/attendance/**/*.ts" src/common/ownership.ts src/groups src/children/children.service.ts src/users/users.service.ts src/parent-cabinet/parent-cabinet.service.ts`. Expected: pass; exit 0; only baseline lint errors.

- [ ] **Step 3: Live check on PORT=3100**

Start your own `PORT=3100 npm run start:dev` (Node 22 on PATH; never touch 3000). Root login from `.env` (never print the password). Cookie jars and UTF-8 JSON bodies in the scratchpad (Write tool). Test data prefix «Тест Ж». Use the next weekday on or before Kyiv today as D (if today is a weekend, use the previous Friday).

1. `POST /groups` `{ name: "Тест Ж 1-А", kind: "school_class" }` → 201 with `kind`. Create a teacher T (phone not required), assign T to the group (`PATCH /groups/:id { teacherIds }`), create children A and B in the group, a parent P (phone `+380671112233`) linked to A; log in as P and change the password (`POST /me/password`).
2. `GET /absence-reasons` as root → 4 seeded reasons; note the id of «Хвороба».
3. `POST /calendar` `{ startDate: <D+7 or next weekday>, type: "non_working", scope: "school_class", title: "Тест Ж канікули" }` → 201. `GET /groups/:id/register?date=<that day>` → `working: false`, `calendarTitle`.
4. As P: `POST /me/children/A/absence-notices` with start = D (today) and end = D+1, reason «Хвороба» → 201 `pending`. Again with overlapping dates → 400 `Notice overlaps an existing notice`. With start yesterday → 400 `Invalid period`.
5. As root: `GET /absence-notices?status=pending` lists it with child and group; `POST /absence-notices/:id/approve` → `approved`; approve again → 400 `Notice already decided`.
6. As T: `GET /groups/:id/register?date=<D>` → A `expected_absent` with `documentRequired: true`, B `unmarked`, `canEdit: true`.
7. As T: `PUT /groups/:id/register` `{ date: D, marks: [{ childId: A, status: "present" }, { childId: B, status: "absent", reasonId: <sick>, note: "Тест Ж" }] }` → A `present` (mark wins), B `absent`. Repeat with B `late` + reasonId → 400 `Reason is only allowed for absences`. Date tomorrow → 400 `Cannot mark future days`.
8. As T: date 10 days ago (a weekday) → 403 `Edit window has passed`. As root same date without reason → 400 `Reason is required`; with `reason` → 200.
9. `GET /groups/:id/register/month?month=<YYYY-MM of D>` → A and B rows with summaries consistent with steps 7–8.
10. As P: `GET /me/children/A/register?month=<YYYY-MM>` → D `present`, no `note`/staff fields; `GET /me/children/B/register` → 404 `Child not found`.
11. Fire two parallel `PUT` saves for A on D with different statuses (two curl processes started together); afterwards the day view shows exactly one mark for A, and `GET .../month` agrees.
12. `DELETE /groups/:id` → 400 `Cannot delete: group has attendance records`.

Stop only your 3100 server. Record requests and abbreviated responses in the report.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document attendance register in CLAUDE.md"
```

---

### Task 7: Frontend API, group kind, absence reasons and calendar pages

Work in `D:\IT\EduNest`. Read its `CLAUDE.md` first.

**Files:**
- Create: `src/shared/api/register.ts`, `src/pages/absenceReasons/index.ts`, `src/pages/absenceReasons/model/absenceReasonsStore.ts`, `src/pages/absenceReasons/ui/AbsenceReasonsPage.tsx`, `src/pages/absenceReasons/ui/AbsenceReasonModal.tsx`, `src/pages/calendar/index.ts`, `src/pages/calendar/model/calendarStore.ts`, `src/pages/calendar/ui/CalendarPage.tsx`, `src/pages/calendar/ui/CalendarDayModal.tsx`
- Modify: `src/shared/api/index.ts`, `src/shared/api/parentCabinet.ts`, `src/shared/api/groups.ts`, `src/shared/api/errorMessages.ts`, `src/pages/groups/ui/CreateGroupModal.tsx`, `src/pages/groups/ui/EditGroupModal.tsx`, `src/pages/groups/ui/GroupsPage.tsx`, `src/widgets/sidebar/model/nav-items.ts`, `src/app/router/index.tsx`

**Interfaces:**
- Consumes: backend routes from Tasks 3–5.
- Produces (exported from `shared/api`): `registerApi`; types `GroupKind`, `DailyStatus`, `DayState`, `CalendarDayType`, `CalendarScope`, `NoticeStatus`, `AbsenceReason`, `AbsenceReasonDto`, `UpdateAbsenceReasonDto`, `CalendarEntry`, `CreateCalendarDayDto`, `RegisterGroup`, `RegisterRow`, `RegisterDay`, `RegisterMarkDto`, `SaveRegisterDto`, `DaySummary`, `MonthCell`, `RegisterMonth`, `AdminNotice`, `ParentNotice`, `CreateNoticeDto`, `ChildRegisterMonth`; labels `groupKindLabels`, `groupKinds`, `dailyStatusLabels`, `dailyStatuses`, `dayStateLabels`, `calendarDayTypeLabels`, `calendarScopeLabels`, `noticeStatusLabels`; helpers `shiftMonth`, `monthLabel`; `parentCabinetApi.getRegister/getNotices/createNotice/cancelNotice`.

- [ ] **Step 1: Branch and baseline**

```bash
git checkout main && git pull --ff-only && git checkout -b feature/attendance-register
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" > <scratchpad>/fe-tsc-baseline-attendance.txt
```

- [ ] **Step 2: `src/shared/api/register.ts`**

```ts
import { axiosInstance } from './axiosInstance';

export type GroupKind = 'kindergarten' | 'school_class';
export const groupKindLabels: Record<GroupKind, string> = {
  kindergarten: 'Садок',
  school_class: 'Клас',
};
export const groupKinds = Object.keys(groupKindLabels) as GroupKind[];

export type DailyStatus = 'present' | 'late' | 'left_early' | 'absent';
export const dailyStatusLabels: Record<DailyStatus, string> = {
  present: 'Присутній',
  late: 'Запізнився',
  left_early: 'Пішов раніше',
  absent: 'Відсутній',
};
export const dailyStatuses = Object.keys(dailyStatusLabels) as DailyStatus[];

export type DayState = 'present' | 'absent' | 'expected_absent' | 'unmarked' | 'non_working';
export const dayStateLabels: Record<DayState, string> = {
  present: 'Присутній',
  absent: 'Відсутній',
  expected_absent: 'Очікується відсутність',
  unmarked: 'Не відмічено',
  non_working: 'Неробочий день',
};

export type CalendarDayType = 'non_working' | 'working';
export const calendarDayTypeLabels: Record<CalendarDayType, string> = {
  non_working: 'Неробочий',
  working: 'Робочий',
};

export type CalendarScope = 'all' | 'kindergarten' | 'school_class' | 'group';
export const calendarScopeLabels: Record<CalendarScope, string> = {
  all: 'Усі',
  kindergarten: 'Садок',
  school_class: 'Школа',
  group: 'Одна група',
};

export type NoticeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export const noticeStatusLabels: Record<NoticeStatus, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
};

export interface AbsenceReason {
  id: string;
  name: string;
  excused: boolean;
  requiresDocument: boolean;
  active: boolean;
  sortOrder: number;
}

export interface AbsenceReasonDto {
  name: string;
  excused: boolean;
  requiresDocument: boolean;
  sortOrder: number;
}

export interface UpdateAbsenceReasonDto extends Partial<AbsenceReasonDto> {
  active?: boolean;
}

export interface CalendarEntry {
  id: string;
  startDate: string;
  endDate: string;
  type: CalendarDayType;
  scope: CalendarScope;
  groupId: string | null;
  group: { id: string; name: string } | null;
  title: string;
  createdAt: string;
}

export interface CreateCalendarDayDto {
  startDate: string;
  endDate?: string;
  type: CalendarDayType;
  scope: CalendarScope;
  groupId?: string;
  title: string;
}

export interface RegisterGroup {
  id: string;
  name: string;
  kind: GroupKind;
}

interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

interface ChildRef extends PersonRef {
  middleName: string | null;
}

export interface RegisterRow {
  child: ChildRef;
  state: DayState;
  mark: {
    id: string;
    status: DailyStatus;
    reasonId: string | null;
    note: string | null;
    documentProvided: boolean;
    markedBy: PersonRef;
    createdAt: string;
  } | null;
  notice: { id: string; startDate: string; endDate: string; reasonId: string; comment: string | null } | null;
  documentRequired: boolean;
}

export interface RegisterDay {
  date: string;
  working: boolean;
  calendarTitle: string | null;
  canEdit: boolean;
  needsReason: boolean;
  children: RegisterRow[];
}

export interface RegisterMarkDto {
  childId: string;
  status: DailyStatus;
  reasonId?: string;
  note?: string;
  documentProvided?: boolean;
}

export interface SaveRegisterDto {
  date: string;
  reason?: string;
  marks: RegisterMarkDto[];
}

export interface DaySummary {
  workingDays: number;
  present: number;
  absentExcused: number;
  absentUnexcused: number;
  expectedAbsent: number;
  unmarked: number;
}

export interface MonthCell {
  date: string;
  state: DayState;
  status: DailyStatus | null;
  reasonId: string | null;
}

export interface RegisterMonth {
  month: string;
  days: { date: string; working: boolean; title: string | null }[];
  children: { child: ChildRef; days: MonthCell[]; summary: DaySummary }[];
}

export interface ParentNotice {
  id: string;
  startDate: string;
  endDate: string;
  comment: string | null;
  status: NoticeStatus;
  decisionReason: string | null;
  createdAt: string;
  reason: { id: string; name: string };
}

export interface AdminNotice extends ParentNotice {
  decidedAt: string | null;
  child: ChildRef & { group: { id: string; name: string } | null };
  createdBy: PersonRef;
  decidedBy: PersonRef | null;
}

export interface CreateNoticeDto {
  startDate: string;
  endDate: string;
  reasonId: string;
  comment?: string;
}

export interface ChildRegisterMonth {
  month: string;
  days: { date: string; state: DayState; status: DailyStatus | null; reasonName: string | null; title: string | null }[];
  summary: DaySummary;
}

export const shiftMonth = (month: string, delta: number) => {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const registerApi = {
  getReasons: () => axiosInstance.get<AbsenceReason[]>('/absence-reasons'),
  createReason: (dto: AbsenceReasonDto) => axiosInstance.post<AbsenceReason>('/absence-reasons', dto),
  updateReason: (id: string, dto: UpdateAbsenceReasonDto) =>
    axiosInstance.patch<AbsenceReason>(`/absence-reasons/${id}`, dto),
  getCalendar: (from: string, to: string, groupId?: string) =>
    axiosInstance.get<CalendarEntry[]>('/calendar', { params: { from, to, groupId } }),
  createCalendarDay: (dto: CreateCalendarDayDto) => axiosInstance.post<CalendarEntry>('/calendar', dto),
  voidCalendarDay: (id: string, reason: string) =>
    axiosInstance.post<CalendarEntry>(`/calendar/${id}/void`, { reason }),
  getGroups: () => axiosInstance.get<RegisterGroup[]>('/register/groups'),
  getSettings: () => axiosInstance.get<{ editDays: number }>('/register/settings'),
  updateSettings: (editDays: number) =>
    axiosInstance.patch<{ editDays: number }>('/register/settings', { editDays }),
  getDay: (groupId: string, date: string) =>
    axiosInstance.get<RegisterDay>(`/groups/${groupId}/register`, { params: { date } }),
  saveDay: (groupId: string, dto: SaveRegisterDto) =>
    axiosInstance.put<RegisterDay>(`/groups/${groupId}/register`, dto),
  getMonth: (groupId: string, month: string) =>
    axiosInstance.get<RegisterMonth>(`/groups/${groupId}/register/month`, { params: { month } }),
  getNotices: (status?: NoticeStatus) =>
    axiosInstance.get<AdminNotice[]>('/absence-notices', { params: { status } }),
  approveNotice: (id: string) => axiosInstance.post<AdminNotice>(`/absence-notices/${id}/approve`),
  rejectNotice: (id: string, reason: string) =>
    axiosInstance.post<AdminNotice>(`/absence-notices/${id}/reject`, { reason }),
  cancelNotice: (id: string, reason: string) =>
    axiosInstance.post<AdminNotice>(`/absence-notices/${id}/cancel`, { reason }),
};
```

Append to `src/shared/api/parentCabinet.ts` (add `import type { ChildRegisterMonth, CreateNoticeDto, ParentNotice } from './register';` at the top) inside `parentCabinetApi`:

```ts
  getRegister: (id: string, month: string) =>
    axiosInstance.get<ChildRegisterMonth>(`/me/children/${id}/register`, { params: { month } }),
  getNotices: (id: string) => axiosInstance.get<ParentNotice[]>(`/me/children/${id}/absence-notices`),
  createNotice: (id: string, dto: CreateNoticeDto) =>
    axiosInstance.post<ParentNotice>(`/me/children/${id}/absence-notices`, dto),
  cancelNotice: (id: string, noticeId: string) =>
    axiosInstance.post<ParentNotice>(`/me/children/${id}/absence-notices/${noticeId}/cancel`),
```

In `src/shared/api/index.ts` add:

```ts
export {
  registerApi,
  groupKindLabels,
  groupKinds,
  dailyStatusLabels,
  dailyStatuses,
  dayStateLabels,
  calendarDayTypeLabels,
  calendarScopeLabels,
  noticeStatusLabels,
  shiftMonth,
  monthLabel,
} from './register';
export type {
  GroupKind,
  DailyStatus,
  DayState,
  CalendarDayType,
  CalendarScope,
  NoticeStatus,
  AbsenceReason,
  AbsenceReasonDto,
  UpdateAbsenceReasonDto,
  CalendarEntry,
  CreateCalendarDayDto,
  RegisterGroup,
  RegisterRow,
  RegisterDay,
  RegisterMarkDto,
  SaveRegisterDto,
  DaySummary,
  MonthCell,
  RegisterMonth,
  AdminNotice,
  ParentNotice,
  CreateNoticeDto,
  ChildRegisterMonth,
} from './register';
```

- [ ] **Step 3: Group kind**

`src/shared/api/groups.ts`: add `import type { GroupKind } from './register';`, `kind: GroupKind;` to `Group`, and `kind: GroupKind;` to both `CreateGroupDto` and `UpdateGroupDto`.

`CreateGroupModal.tsx` and `EditGroupModal.tsx`: add to the schema `kind: yup.mixed<GroupKind>().oneOf(groupKinds).required("Обов'язкове поле"),`; default `kind: 'kindergarten'` (edit: `kind: group.kind` in `reset`); add the field after «Назва»:

```tsx
        <Controller
          name="kind"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} select label="Тип" fullWidth error={!!error} helperText={error?.message}>
              {groupKinds.map((kind) => (
                <MenuItem key={kind} value={kind}>{groupKindLabels[kind]}</MenuItem>
              ))}
            </TextField>
          )}
        />
```

and pass `kind: values.kind` in `createGroup` / `updateGroup` (imports: `MenuItem` from MUI; `groupKinds`, `groupKindLabels`, `type GroupKind` from `../../../shared/api`).

`GroupsPage.tsx`: under the group name add `<Chip size="small" label={groupKindLabels[group.kind]} sx={{ mb: 1 }} />`.

- [ ] **Step 4: Translations**

Add to `errorMessages` (skip keys that already exist — `Invalid date` and `Group not found` do):

```ts
  'Not a working day': 'Цей день неробочий',
  'Cannot mark future days': 'Не можна відмічати майбутні дні',
  'Edit window has passed': 'Термін виправлення минув, зверніться до адміністратора',
  'Reason is required': 'Вкажіть причину виправлення',
  'Reason is only allowed for absences': 'Причину можна вказати лише для відсутності',
  'Absence reason not found': 'Причину відсутності не знайдено',
  'Absence reason already exists': 'Така причина вже існує',
  'Child is not in this group': 'Дитина не належить до цієї групи',
  'Invalid period': 'Неправильний період',
  'Group is required for group scope': 'Групу вказують лише для запису «Одна група»',
  'Notice overlaps an existing notice': 'На ці дні вже є повідомлення',
  'Notice period is too long': 'Період не може перевищувати 60 днів',
  'Notice already decided': 'Повідомлення вже розглянуто',
  'Notice not found': 'Повідомлення не знайдено',
  'Not your group': 'Це не ваша група',
  'Invalid month': 'Неправильний місяць',
  'Duplicate child in marks': 'Дитина повторюється у відмітках',
  'Calendar entry not found': 'Запис календаря не знайдено',
  'Calendar entry is voided': 'Запис календаря вже скасовано',
  'Edit days must be between 0 and 30': 'Кількість днів має бути від 0 до 30',
  'Cannot delete: group has attendance records': 'Не можна видалити: у групи є записи журналу',
```

- [ ] **Step 5: Absence reasons page**

`src/pages/absenceReasons/model/absenceReasonsStore.ts`:

```ts
import { create } from 'zustand';
import {
  registerApi,
  type AbsenceReason,
  type AbsenceReasonDto,
  type UpdateAbsenceReasonDto,
} from '../../../shared/api';

interface ReasonModal {
  isOpen: boolean;
  reason: AbsenceReason | null;
}

interface AbsenceReasonsState {
  reasons: AbsenceReason[];
  isLoading: boolean;
  isSaving: boolean;
  modal: ReasonModal;
  setModal: (value: Partial<ReasonModal>) => void;
  fetchReasons: () => Promise<void>;
  createReason: (dto: AbsenceReasonDto) => Promise<void>;
  updateReason: (id: string, dto: UpdateAbsenceReasonDto) => Promise<void>;
}

export const useAbsenceReasonsStore = create<AbsenceReasonsState>((set) => ({
  reasons: [],
  isLoading: false,
  isSaving: false,
  modal: { isOpen: false, reason: null },
  setModal: (value) => set((state) => ({ modal: { ...state.modal, ...value } })),
  fetchReasons: async () => {
    set({ isLoading: true });
    try {
      const { data } = await registerApi.getReasons();
      set({ reasons: data });
    } finally {
      set({ isLoading: false });
    }
  },
  createReason: async (dto) => {
    set({ isSaving: true });
    try {
      const { data } = await registerApi.createReason(dto);
      set((state) => ({ reasons: [...state.reasons, data] }));
    } finally {
      set({ isSaving: false });
    }
  },
  updateReason: async (id, dto) => {
    set({ isSaving: true });
    try {
      const { data } = await registerApi.updateReason(id, dto);
      set((state) => ({ reasons: state.reasons.map((r) => (r.id === id ? data : r)) }));
    } finally {
      set({ isSaving: false });
    }
  },
}));
```

`src/pages/absenceReasons/ui/AbsenceReasonModal.tsx`:

```tsx
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Checkbox, Dialog, DialogTitle, FormControlLabel, TextField } from '@mui/material'
import { useAbsenceReasonsStore } from '../model/absenceReasonsStore'

const schema = yup.object({
  name: yup.string().trim().required("Обов'язкове поле").max(100, 'Максимум 100 символів'),
  excused: yup.boolean().required(),
  requiresDocument: yup.boolean().required(),
  sortOrder: yup.number().typeError('Вкажіть число').integer('Ціле число').min(0, 'Не менше 0').required("Обов'язкове поле"),
})

type FormValues = yup.InferType<typeof schema>

const empty: FormValues = { name: '', excused: true, requiresDocument: false, sortOrder: 0 }

export const AbsenceReasonModal = () => {
  const modal = useAbsenceReasonsStore((s) => s.modal)
  const setModal = useAbsenceReasonsStore((s) => s.setModal)
  const createReason = useAbsenceReasonsStore((s) => s.createReason)
  const updateReason = useAbsenceReasonsStore((s) => s.updateReason)
  const isSaving = useAbsenceReasonsStore((s) => s.isSaving)

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: empty,
    resolver: yupResolver(schema),
  })

  useEffect(() => {
    if (!modal.isOpen) return
    reset(
      modal.reason
        ? {
            name: modal.reason.name,
            excused: modal.reason.excused,
            requiresDocument: modal.reason.requiresDocument,
            sortOrder: modal.reason.sortOrder,
          }
        : empty,
    )
  }, [modal.isOpen, modal.reason, reset])

  const handleClose = () => {
    reset(empty)
    setModal({ isOpen: false, reason: null })
  }

  const onSubmit = async (values: FormValues) => {
    const dto = { ...values, name: values.name.trim() }
    if (modal.reason) await updateReason(modal.reason.id, dto)
    else await createReason(dto)
    handleClose()
  }

  return (
    <Dialog open={modal.isOpen} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{modal.reason ? 'Редагувати причину' : 'Нова причина'}</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Назва" fullWidth error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="excused"
          control={control}
          render={({ field }) => (
            <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Поважна причина" />
          )}
        />
        <Controller
          name="requiresDocument"
          control={control}
          render={({ field }) => (
            <FormControlLabel control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Потрібна довідка" />
          )}
        />
        <Controller
          name="sortOrder"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} type="number" label="Порядок" fullWidth error={!!error} helperText={error?.message} />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>Зберегти</Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/absenceReasons/ui/AbsenceReasonsPage.tsx`:

```tsx
import { useEffect } from 'react'
import { Box, Button, IconButton, Paper, Switch, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useAbsenceReasonsStore } from '../model/absenceReasonsStore'
import { AbsenceReasonModal } from './AbsenceReasonModal'

export const AbsenceReasonsPage = () => {
  const reasons = useAbsenceReasonsStore((s) => s.reasons)
  const fetchReasons = useAbsenceReasonsStore((s) => s.fetchReasons)
  const updateReason = useAbsenceReasonsStore((s) => s.updateReason)
  const setModal = useAbsenceReasonsStore((s) => s.setModal)

  useEffect(() => {
    fetchReasons().catch(() => undefined)
  }, [fetchReasons])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="body2" color="text.secondary">Всього причин: {reasons.length}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setModal({ isOpen: true, reason: null })}>
          Додати причину
        </Button>
      </Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Назва</TableCell>
              <TableCell>Поважна</TableCell>
              <TableCell>Потрібна довідка</TableCell>
              <TableCell>Порядок</TableCell>
              <TableCell>Активна</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {reasons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>Причин ще немає.</TableCell>
              </TableRow>
            ) : (
              reasons.map((reason) => (
                <TableRow key={reason.id} sx={{ opacity: reason.active ? 1 : 0.5 }}>
                  <TableCell>{reason.name}</TableCell>
                  <TableCell>{reason.excused ? 'Так' : 'Ні'}</TableCell>
                  <TableCell>{reason.requiresDocument ? 'Так' : 'Ні'}</TableCell>
                  <TableCell>{reason.sortOrder}</TableCell>
                  <TableCell>
                    <Switch
                      checked={reason.active}
                      onChange={(e) => updateReason(reason.id, { active: e.target.checked }).catch(() => undefined)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => setModal({ isOpen: true, reason })}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
      <AbsenceReasonModal />
    </Box>
  )
}
```

`src/pages/absenceReasons/index.ts`: `export { AbsenceReasonsPage } from './ui/AbsenceReasonsPage'`

- [ ] **Step 6: Calendar page**

`src/pages/calendar/model/calendarStore.ts`:

```ts
import { create } from 'zustand';
import {
  registerApi,
  type CalendarEntry,
  type CreateCalendarDayDto,
  type RegisterGroup,
} from '../../../shared/api';

interface CalendarState {
  year: number;
  entries: CalendarEntry[];
  groups: RegisterGroup[];
  editDays: number | null;
  isLoading: boolean;
  isSaving: boolean;
  isModalOpen: boolean;
  setModalOpen: (isOpen: boolean) => void;
  setYear: (year: number) => Promise<void>;
  loadMeta: () => Promise<void>;
  createEntry: (dto: CreateCalendarDayDto) => Promise<void>;
  voidEntry: (id: string, reason: string) => Promise<void>;
  saveEditDays: (editDays: number) => Promise<void>;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  year: new Date().getFullYear(),
  entries: [],
  groups: [],
  editDays: null,
  isLoading: false,
  isSaving: false,
  isModalOpen: false,
  setModalOpen: (isOpen) => set({ isModalOpen: isOpen }),
  setYear: async (year) => {
    set({ year, isLoading: true });
    try {
      const { data } = await registerApi.getCalendar(`${year}-01-01`, `${year}-12-31`);
      if (get().year === year) set({ entries: data });
    } finally {
      if (get().year === year) set({ isLoading: false });
    }
  },
  loadMeta: async () => {
    const [{ data: groups }, { data: settings }] = await Promise.all([
      registerApi.getGroups(),
      registerApi.getSettings(),
    ]);
    set({ groups, editDays: settings.editDays });
  },
  createEntry: async (dto) => {
    set({ isSaving: true });
    try {
      const { data } = await registerApi.createCalendarDay(dto);
      set((state) => ({
        entries: [...state.entries, data].sort((a, b) => a.startDate.localeCompare(b.startDate)),
      }));
    } finally {
      set({ isSaving: false });
    }
  },
  voidEntry: async (id, reason) => {
    set({ isSaving: true });
    try {
      await registerApi.voidCalendarDay(id, reason);
      set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
    } finally {
      set({ isSaving: false });
    }
  },
  saveEditDays: async (editDays) => {
    set({ isSaving: true });
    try {
      const { data } = await registerApi.updateSettings(editDays);
      set({ editDays: data.editDays });
    } finally {
      set({ isSaving: false });
    }
  },
}));
```

`src/pages/calendar/ui/CalendarDayModal.tsx`:

```tsx
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, MenuItem, TextField } from '@mui/material'
import { useCalendarStore } from '../model/calendarStore'
import {
  calendarDayTypeLabels,
  calendarScopeLabels,
  type CalendarDayType,
  type CalendarScope,
} from '../../../shared/api'

const types = Object.keys(calendarDayTypeLabels) as CalendarDayType[]
const scopes = Object.keys(calendarScopeLabels) as CalendarScope[]

const schema = yup.object({
  startDate: yup.string().required("Обов'язкове поле"),
  endDate: yup
    .string()
    .default('')
    .test('after', 'Кінець раніше за початок', function (value) {
      return !value || value >= this.parent.startDate
    }),
  type: yup.mixed<CalendarDayType>().oneOf(types).required(),
  scope: yup.mixed<CalendarScope>().oneOf(scopes).required(),
  groupId: yup
    .string()
    .default('')
    .when('scope', { is: 'group', then: (s) => s.required('Оберіть групу') }),
  title: yup.string().trim().required("Обов'язкове поле").max(200, 'Максимум 200 символів'),
})

type FormValues = yup.InferType<typeof schema>

const empty: FormValues = { startDate: '', endDate: '', type: 'non_working', scope: 'all', groupId: '', title: '' }

export const CalendarDayModal = () => {
  const isOpen = useCalendarStore((s) => s.isModalOpen)
  const setModalOpen = useCalendarStore((s) => s.setModalOpen)
  const createEntry = useCalendarStore((s) => s.createEntry)
  const groups = useCalendarStore((s) => s.groups)
  const isSaving = useCalendarStore((s) => s.isSaving)

  const { control, handleSubmit, reset, watch } = useForm<FormValues>({
    mode: 'all',
    defaultValues: empty,
    resolver: yupResolver(schema),
  })
  const scope = watch('scope')

  const handleClose = () => {
    reset(empty)
    setModalOpen(false)
  }

  const onSubmit = async (values: FormValues) => {
    await createEntry({
      startDate: values.startDate,
      endDate: values.endDate || undefined,
      type: values.type,
      scope: values.scope,
      groupId: values.scope === 'group' ? values.groupId : undefined,
      title: values.title.trim(),
    })
    handleClose()
  }

  return (
    <Dialog open={isOpen} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Новий запис календаря</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        <Controller
          name="startDate"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} type="date" label="З дати" slotProps={{ inputLabel: { shrink: true } }} error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="endDate"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} type="date" label="По дату (необов'язково)" slotProps={{ inputLabel: { shrink: true } }} error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Тип">
              {types.map((t) => <MenuItem key={t} value={t}>{calendarDayTypeLabels[t]}</MenuItem>)}
            </TextField>
          )}
        />
        <Controller
          name="scope"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Для кого">
              {scopes.map((s) => <MenuItem key={s} value={s}>{calendarScopeLabels[s]}</MenuItem>)}
            </TextField>
          )}
        />
        {scope === 'group' && (
          <Controller
            name="groupId"
            control={control}
            render={({ field, fieldState: { error } }) => (
              <TextField {...field} select label="Група" error={!!error} helperText={error?.message}>
                {groups.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
              </TextField>
            )}
          />
        )}
        <Controller
          name="title"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Назва" placeholder="Наприклад, Осінні канікули" error={!!error} helperText={error?.message} />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>Зберегти</Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/calendar/ui/CalendarPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Box, Button, IconButton, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useCalendarStore } from '../model/calendarStore'
import { CalendarDayModal } from './CalendarDayModal'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import { calendarDayTypeLabels, calendarScopeLabels, formatDay, type CalendarEntry } from '../../../shared/api'

const period = (e: CalendarEntry) =>
  e.startDate === e.endDate ? formatDay(e.startDate) : `${formatDay(e.startDate)} – ${formatDay(e.endDate)}`

export const CalendarPage = () => {
  const year = useCalendarStore((s) => s.year)
  const entries = useCalendarStore((s) => s.entries)
  const editDays = useCalendarStore((s) => s.editDays)
  const isSaving = useCalendarStore((s) => s.isSaving)
  const setYear = useCalendarStore((s) => s.setYear)
  const loadMeta = useCalendarStore((s) => s.loadMeta)
  const setModalOpen = useCalendarStore((s) => s.setModalOpen)
  const voidEntry = useCalendarStore((s) => s.voidEntry)
  const saveEditDays = useCalendarStore((s) => s.saveEditDays)
  const [voiding, setVoiding] = useState<CalendarEntry | null>(null)
  const [daysInput, setDaysInput] = useState('')

  useEffect(() => {
    setYear(useCalendarStore.getState().year).catch(() => undefined)
    loadMeta().catch(() => undefined)
  }, [setYear, loadMeta])

  useEffect(() => {
    if (editDays !== null) setDaysInput(String(editDays))
  }, [editDays])

  const daysValue = Number(daysInput)
  const daysValid = daysInput !== '' && Number.isInteger(daysValue) && daysValue >= 0 && daysValue <= 30

  return (
    <Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mb: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ mr: 'auto' }}>Скільки днів назад вчитель може виправляти журнал</Typography>
        <TextField
          size="small"
          type="number"
          value={daysInput}
          onChange={(e) => setDaysInput(e.target.value)}
          error={daysInput !== '' && !daysValid}
          helperText={daysInput !== '' && !daysValid ? 'Від 0 до 30' : undefined}
          sx={{ width: 120 }}
        />
        <Button variant="outlined" disabled={!daysValid || isSaving || daysValue === editDays} onClick={() => saveEditDays(daysValue).catch(() => undefined)}>
          Зберегти
        </Button>
      </Paper>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton onClick={() => setYear(year - 1).catch(() => undefined)}><ChevronLeftIcon /></IconButton>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{year}</Typography>
        <IconButton onClick={() => setYear(year + 1).catch(() => undefined)}><ChevronRightIcon /></IconButton>
        <Button variant="contained" startIcon={<AddIcon />} sx={{ ml: 'auto' }} onClick={() => setModalOpen(true)}>
          Додати
        </Button>
      </Box>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Період</TableCell>
              <TableCell>Тип</TableCell>
              <TableCell>Для кого</TableCell>
              <TableCell>Назва</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                  Записів немає. Будні дні робочі, вихідні неробочі.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{period(e)}</TableCell>
                  <TableCell>{calendarDayTypeLabels[e.type]}</TableCell>
                  <TableCell>{e.scope === 'group' ? e.group?.name : calendarScopeLabels[e.scope]}</TableCell>
                  <TableCell>{e.title}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" color="error" onClick={() => setVoiding(e)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <CalendarDayModal />
      <ReasonDialog
        open={voiding !== null}
        title="Скасувати запис календаря"
        subtitle={voiding ? `${voiding.title}, ${period(voiding)}` : undefined}
        confirmLabel="Скасувати запис"
        isSaving={isSaving}
        onClose={() => setVoiding(null)}
        onSubmit={async (reason) => {
          if (voiding) await voidEntry(voiding.id, reason)
          setVoiding(null)
        }}
      />
    </Box>
  )
}
```

(Check `ReasonDialog` props in `src/shared/ui/ReasonDialog.tsx`: `open`, `title`, `subtitle?`, `confirmLabel?`, `isSaving`, `onClose`, `onSubmit(reason): Promise<void>`; it must keep the dialog open when `onSubmit` rejects — verify and adapt if its behaviour differs.)

`src/pages/calendar/index.ts`: `export { CalendarPage } from './ui/CalendarPage'`

- [ ] **Step 7: Menu and routes**

`nav-items.ts`: import `CalendarMonthIcon from '@mui/icons-material/CalendarMonth'` and `PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'`, and append to `navItems`:

```ts
  { path: '/calendar',            label: 'Календар',          icon: CalendarMonthIcon,  roles: ADMIN },
  { path: '/absence-reasons',     label: 'Причини відсутності', icon: PlaylistAddCheckIcon, roles: ADMIN },
```

Router: import `AbsenceReasonsPage`, `CalendarPage` and add inside the `AdminLayout` children (before `'*'`):

```tsx
                  { path: 'calendar',        element: <CalendarPage /> },
                  { path: 'absence-reasons', element: <AbsenceReasonsPage /> },
```

Add `'/calendar': 'Календар'` and `'/absence-reasons': 'Причини відсутності'` to `pageTitles` in `src/widgets/header/ui/Header.tsx`.

- [ ] **Step 8: Verify**

Run: `npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx"` and diff against the baseline (no new lines); `npx eslint` on every touched file → 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/shared/api src/pages/groups src/pages/absenceReasons src/pages/calendar src/widgets/sidebar/model/nav-items.ts src/widgets/header/ui/Header.tsx src/app/router/index.tsx
git status --short
git commit -m "feat: add group kind, absence reasons and calendar pages"
```

(Before committing check `git status --short` shows no `children 2.ts` / `children 3.ts` staged; if `git add src/shared/api` staged them, `git restore --staged "src/shared/api/children 2.ts" "src/shared/api/children 3.ts"`.)

---

### Task 8: Register page (day and month grid)

**Files:**
- Create: `src/pages/register/index.ts`, `src/pages/register/model/registerStore.ts`, `src/pages/register/ui/RegisterPage.tsx`, `src/pages/register/ui/RegisterDayTab.tsx`, `src/pages/register/ui/RegisterMonthTab.tsx`, `src/pages/register/ui/monthCodes.ts`
- Modify: `src/widgets/sidebar/model/nav-items.ts`, `src/app/router/index.tsx`, `src/widgets/header/ui/Header.tsx`

**Interfaces:**
- Consumes: `registerApi`, `RegisterDay`, `RegisterRow`, `RegisterMonth`, `AbsenceReason`, `DailyStatus`, `dailyStatuses`, `dailyStatusLabels`, `dayStateLabels`, `shiftMonth`, `monthLabel`, `localToday`, `formatDay`, `ReasonDialog`, `useAuthStore`.
- Produces: route `/register` (root/admin/teacher).

- [ ] **Step 1: Store `src/pages/register/model/registerStore.ts`**

```ts
import { create } from 'zustand';
import {
  localToday,
  registerApi,
  type AbsenceReason,
  type DailyStatus,
  type RegisterDay,
  type RegisterGroup,
  type RegisterMarkDto,
  type RegisterMonth,
  type RegisterRow,
} from '../../../shared/api';

export interface RowDraft {
  status: DailyStatus | null;
  reasonId: string | null;
  note: string;
  documentProvided: boolean;
}

export const rowDraft = (row: RegisterRow): RowDraft => {
  if (row.mark) {
    return {
      status: row.mark.status,
      reasonId: row.mark.reasonId,
      note: row.mark.note ?? '',
      documentProvided: row.mark.documentProvided,
    };
  }
  if (row.notice) return { status: 'absent', reasonId: row.notice.reasonId, note: '', documentProvided: false };
  return { status: null, reasonId: null, note: '', documentProvided: false };
};

export const sameDraft = (a: RowDraft, b: RowDraft) =>
  a.status === b.status && a.reasonId === b.reasonId && a.note.trim() === b.note.trim() && a.documentProvided === b.documentProvided;

const draftsOf = (day: RegisterDay) =>
  Object.fromEntries(day.children.map((row) => [row.child.id, rowDraft(row)]));

interface RegisterState {
  groups: RegisterGroup[];
  reasons: AbsenceReason[];
  groupId: string | null;
  date: string;
  month: string;
  day: RegisterDay | null;
  dayKey: string | null;
  draft: Record<string, RowDraft>;
  monthData: RegisterMonth | null;
  monthKey: string | null;
  isSaving: boolean;
  loadMeta: () => Promise<void>;
  selectGroup: (groupId: string) => void;
  setDate: (date: string) => void;
  setMonth: (month: string) => void;
  loadDay: () => Promise<void>;
  loadMonth: () => Promise<void>;
  setDraft: (childId: string, patch: Partial<RowDraft>) => void;
  markAllPresent: () => void;
  save: (reason?: string) => Promise<void>;
}

export const useRegisterStore = create<RegisterState>((set, get) => ({
  groups: [],
  reasons: [],
  groupId: null,
  date: localToday(),
  month: localToday().slice(0, 7),
  day: null,
  dayKey: null,
  draft: {},
  monthData: null,
  monthKey: null,
  isSaving: false,
  loadMeta: async () => {
    const [{ data: groups }, { data: reasons }] = await Promise.all([
      registerApi.getGroups(),
      registerApi.getReasons(),
    ]);
    set((state) => ({
      groups,
      reasons: reasons.filter((r) => r.active),
      groupId: state.groupId ?? groups[0]?.id ?? null,
    }));
  },
  selectGroup: (groupId) => set({ groupId }),
  setDate: (date) => set({ date, month: date.slice(0, 7) }),
  setMonth: (month) => set({ month }),
  loadDay: async () => {
    const { groupId, date } = get();
    if (!groupId) return;
    const key = `${groupId}/${date}`;
    set({ dayKey: key, day: null, draft: {} });
    const { data } = await registerApi.getDay(groupId, date);
    if (get().dayKey === key) set({ day: data, draft: draftsOf(data) });
  },
  loadMonth: async () => {
    const { groupId, month } = get();
    if (!groupId) return;
    const key = `${groupId}/${month}`;
    set({ monthKey: key, monthData: null });
    const { data } = await registerApi.getMonth(groupId, month);
    if (get().monthKey === key) set({ monthData: data });
  },
  setDraft: (childId, patch) =>
    set((state) => {
      const next = { ...state.draft[childId], ...patch };
      if (next.status !== 'absent') {
        next.reasonId = null;
        next.documentProvided = false;
      }
      return { draft: { ...state.draft, [childId]: next } };
    }),
  markAllPresent: () =>
    set((state) => ({
      draft: Object.fromEntries(
        Object.entries(state.draft).map(([id, d]) => [id, d.status ? d : { ...d, status: 'present' as const }]),
      ),
    })),
  save: async (reason) => {
    const { groupId, day, draft, dayKey } = get();
    if (!groupId || !day) return;
    const marks: RegisterMarkDto[] = day.children.flatMap((row) => {
      const d = draft[row.child.id];
      if (!d?.status) return [];
      const absent = d.status === 'absent';
      return [{
        childId: row.child.id,
        status: d.status,
        reasonId: absent && d.reasonId ? d.reasonId : undefined,
        note: d.note.trim() || undefined,
        documentProvided: absent ? d.documentProvided : undefined,
      }];
    });
    set({ isSaving: true });
    try {
      const { data } = await registerApi.saveDay(groupId, { date: day.date, reason, marks });
      if (get().dayKey === dayKey) set({ day: data, draft: draftsOf(data) });
      set({ monthKey: null, monthData: null });
    } finally {
      set({ isSaving: false });
    }
  },
}));
```

(Check that `localToday` is exported from `shared/api/index.ts`; it is defined in `classes.ts`.)

- [ ] **Step 2: Month codes `src/pages/register/ui/monthCodes.ts`**

```ts
import type { AbsenceReason, MonthCell } from '../../../shared/api'

export interface CellView {
  code: string
  color: string
  bg: string
}

export const cellView = (cell: MonthCell, reasons: Map<string, AbsenceReason>): CellView => {
  if (cell.state === 'non_working') return { code: '—', color: 'text.disabled', bg: 'grey.100' }
  if (cell.state === 'unmarked') return { code: '?', color: 'text.secondary', bg: 'transparent' }
  if (cell.state === 'expected_absent') return { code: '(В)', color: 'warning.dark', bg: 'transparent' }
  if (cell.state === 'absent') {
    const excused = cell.reasonId !== null && reasons.get(cell.reasonId)?.excused === true
    return excused ? { code: 'В', color: 'warning.dark', bg: 'rgba(237, 108, 2, 0.12)' } : { code: 'В*', color: 'error.main', bg: 'rgba(211, 47, 47, 0.12)' }
  }
  if (cell.status === 'late') return { code: 'З', color: 'success.dark', bg: 'rgba(46, 125, 50, 0.12)' }
  if (cell.status === 'left_early') return { code: 'Р', color: 'success.dark', bg: 'rgba(46, 125, 50, 0.12)' }
  return { code: 'П', color: 'success.dark', bg: 'rgba(46, 125, 50, 0.12)' }
}

export const legend = 'П присутній · З запізнився · Р пішов раніше · В поважна відсутність · В* без поважної причини · (В) повідомили батьки · ? не відмічено · — неробочий'
```

- [ ] **Step 3: Day tab `src/pages/register/ui/RegisterDayTab.tsx`**

```tsx
import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useRegisterStore, rowDraft, sameDraft } from '../model/registerStore'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import { dailyStatusLabels, dailyStatuses, formatDay, type DailyStatus } from '../../../shared/api'

export const RegisterDayTab = () => {
  const day = useRegisterStore((s) => s.day)
  const draft = useRegisterStore((s) => s.draft)
  const reasons = useRegisterStore((s) => s.reasons)
  const isSaving = useRegisterStore((s) => s.isSaving)
  const setDraft = useRegisterStore((s) => s.setDraft)
  const markAllPresent = useRegisterStore((s) => s.markAllPresent)
  const save = useRegisterStore((s) => s.save)
  const [reasonOpen, setReasonOpen] = useState(false)

  if (!day) return <Typography color="text.secondary">Завантаження…</Typography>

  if (!day.working) {
    return <Alert severity="info">Неробочий день{day.calendarTitle ? `: ${day.calendarTitle}` : ''}.</Alert>
  }

  const dirty = day.children.some((row) => draft[row.child.id] && !sameDraft(draft[row.child.id], rowDraft(row)))
  const reasonName = (id: string | null) => reasons.find((r) => r.id === id)?.name ?? ''
  const requiresDocument = (id: string | null) => reasons.find((r) => r.id === id)?.requiresDocument ?? false

  const handleSave = () => {
    if (day.needsReason) {
      setReasonOpen(true)
      return
    }
    save().catch(() => undefined)
  }

  return (
    <Box>
      {!day.canEdit && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Редагування цього дня закрите. Для виправлення зверніться до адміністратора.
        </Alert>
      )}
      {day.canEdit && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={markAllPresent}>Усі присутні</Button>
          <Button variant="contained" disabled={isSaving || !dirty} onClick={handleSave} sx={{ ml: 'auto' }}>
            Зберегти
          </Button>
        </Box>
      )}
      {day.children.length === 0 && <Typography color="text.secondary">У групі немає дітей.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {day.children.map((row) => {
          const d = draft[row.child.id] ?? rowDraft(row)
          const changed = !sameDraft(d, rowDraft(row))
          return (
            <Paper
              key={row.child.id}
              elevation={0}
              sx={{ border: '1px solid', borderColor: changed ? 'warning.main' : 'divider', borderRadius: 2, p: 1.5 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography sx={{ fontWeight: 600, mr: 'auto' }}>
                  {[row.child.lastName, row.child.firstName].join(' ')}
                </Typography>
                {row.notice && (
                  <Chip
                    size="small"
                    color="info"
                    variant="outlined"
                    label={`Повідомили батьки: ${reasonName(row.notice.reasonId) || 'відсутність'}, ${formatDay(row.notice.startDate)}–${formatDay(row.notice.endDate)}`}
                  />
                )}
                {row.mark && (
                  <Typography variant="caption" color="text.secondary">
                    {row.mark.markedBy.lastName} {row.mark.markedBy.firstName}
                  </Typography>
                )}
              </Box>
              <ToggleButtonGroup
                size="small"
                exclusive
                disabled={!day.canEdit}
                value={d.status}
                onChange={(_, value: DailyStatus | null) => {
                  if (value) setDraft(row.child.id, { status: value })
                }}
                sx={{ flexWrap: 'wrap' }}
              >
                {dailyStatuses.map((s) => (
                  <ToggleButton key={s} value={s}>{dailyStatusLabels[s]}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              {d.status === 'absent' && (
                <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <TextField
                    select
                    size="small"
                    label="Причина"
                    disabled={!day.canEdit}
                    value={d.reasonId ?? ''}
                    onChange={(e) => setDraft(row.child.id, { reasonId: e.target.value || null, documentProvided: false })}
                    sx={{ minWidth: 200 }}
                  >
                    <MenuItem value="">Не вказано</MenuItem>
                    {reasons.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
                  </TextField>
                  {requiresDocument(d.reasonId) && (
                    <FormControlLabel
                      disabled={!day.canEdit}
                      control={<Checkbox checked={d.documentProvided} onChange={(e) => setDraft(row.child.id, { documentProvided: e.target.checked })} />}
                      label="Довідку надано"
                    />
                  )}
                </Box>
              )}
              <TextField
                size="small"
                fullWidth
                label="Нотатка"
                disabled={!day.canEdit}
                value={d.note}
                onChange={(e) => setDraft(row.child.id, { note: e.target.value })}
                sx={{ mt: 1.5 }}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Paper>
          )
        })}
      </Box>
      <ReasonDialog
        open={reasonOpen}
        title="Виправлення журналу"
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

- [ ] **Step 4: Month tab `src/pages/register/ui/RegisterMonthTab.tsx`**

```tsx
import { useMemo } from 'react'
import { Box, Paper, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import { useRegisterStore } from '../model/registerStore'
import { cellView, legend } from './monthCodes'
import { dayStateLabels } from '../../../shared/api'

export const RegisterMonthTab = ({ onOpenDay }: { onOpenDay: (date: string) => void }) => {
  const monthData = useRegisterStore((s) => s.monthData)
  const reasons = useRegisterStore((s) => s.reasons)
  const reasonMap = useMemo(() => new Map(reasons.map((r) => [r.id, r])), [reasons])

  if (!monthData) return <Typography color="text.secondary">Завантаження…</Typography>

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{legend}</Typography>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Table size="small" sx={{ '& td, & th': { px: 0.5, textAlign: 'center' } }}>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'grey.50', textAlign: 'left !important', minWidth: 160 }}>Дитина</TableCell>
              {monthData.days.map((d) => (
                <TableCell key={d.date} sx={{ color: d.working ? 'text.primary' : 'text.disabled', minWidth: 30 }}>
                  <Tooltip title={d.title ?? ''}><span>{Number(d.date.slice(8))}</span></Tooltip>
                </TableCell>
              ))}
              <TableCell>Присут.</TableCell>
              <TableCell>Пов.</TableCell>
              <TableCell>Без пр.</TableCell>
              <TableCell>Не відм.</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {monthData.children.length === 0 ? (
              <TableRow>
                <TableCell colSpan={monthData.days.length + 5} sx={{ color: 'text.secondary' }}>У групі немає дітей.</TableCell>
              </TableRow>
            ) : (
              monthData.children.map((row) => (
                <TableRow key={row.child.id}>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', textAlign: 'left !important', whiteSpace: 'nowrap' }}>
                    {row.child.lastName} {row.child.firstName}
                  </TableCell>
                  {row.days.map((cell) => {
                    const view = cellView(cell, reasonMap)
                    const reason = cell.reasonId ? reasonMap.get(cell.reasonId)?.name : undefined
                    return (
                      <TableCell
                        key={cell.date}
                        onClick={() => onOpenDay(cell.date)}
                        sx={{ cursor: 'pointer', color: view.color, bgcolor: view.bg, fontWeight: 600 }}
                      >
                        <Tooltip title={`${dayStateLabels[cell.state]}${reason ? `: ${reason}` : ''}`}>
                          <span>{view.code}</span>
                        </Tooltip>
                      </TableCell>
                    )
                  })}
                  <TableCell>{row.summary.present}</TableCell>
                  <TableCell>{row.summary.absentExcused}</TableCell>
                  <TableCell>{row.summary.absentUnexcused}</TableCell>
                  <TableCell>{row.summary.unmarked}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
```

- [ ] **Step 5: Page `src/pages/register/ui/RegisterPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Box, IconButton, MenuItem, Tab, Tabs, TextField, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useRegisterStore } from '../model/registerStore'
import { RegisterDayTab } from './RegisterDayTab'
import { RegisterMonthTab } from './RegisterMonthTab'
import { groupKindLabels, localToday, monthLabel, shiftMonth } from '../../../shared/api'

export const RegisterPage = () => {
  const groups = useRegisterStore((s) => s.groups)
  const groupId = useRegisterStore((s) => s.groupId)
  const date = useRegisterStore((s) => s.date)
  const month = useRegisterStore((s) => s.month)
  const loadMeta = useRegisterStore((s) => s.loadMeta)
  const selectGroup = useRegisterStore((s) => s.selectGroup)
  const setDate = useRegisterStore((s) => s.setDate)
  const setMonth = useRegisterStore((s) => s.setMonth)
  const loadDay = useRegisterStore((s) => s.loadDay)
  const loadMonth = useRegisterStore((s) => s.loadMonth)
  const [tab, setTab] = useState(0)

  useEffect(() => {
    loadMeta().catch(() => undefined)
  }, [loadMeta])

  useEffect(() => {
    if (groupId && tab === 0) loadDay().catch(() => undefined)
  }, [groupId, date, tab, loadDay])

  useEffect(() => {
    if (groupId && tab === 1) loadMonth().catch(() => undefined)
  }, [groupId, month, tab, loadMonth])

  if (groups.length === 0) {
    return <Typography color="text.secondary">Немає груп, доступних для журналу.</Typography>
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <TextField select size="small" label="Група" value={groupId ?? ''} onChange={(e) => selectGroup(e.target.value)} sx={{ minWidth: 220 }}>
          {groups.map((g) => (
            <MenuItem key={g.id} value={g.id}>{g.name} · {groupKindLabels[g.kind]}</MenuItem>
          ))}
        </TextField>
        {tab === 0 ? (
          <TextField
            size="small"
            type="date"
            label="Дата"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: localToday() } }}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeftIcon /></IconButton>
            <Typography sx={{ minWidth: 140, textAlign: 'center' }}>{monthLabel(month)}</Typography>
            <IconButton onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRightIcon /></IconButton>
          </Box>
        )}
      </Box>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="День" />
        <Tab label="Табель" />
      </Tabs>
      {tab === 0 && <RegisterDayTab />}
      {tab === 1 && (
        <RegisterMonthTab
          onOpenDay={(day) => {
            setDate(day)
            setTab(0)
          }}
        />
      )}
    </Box>
  )
}
```

`src/pages/register/index.ts`: `export { RegisterPage } from './ui/RegisterPage'`

- [ ] **Step 6: Menu and route**

`nav-items.ts`: import `FactCheckIcon from '@mui/icons-material/FactCheck'`; insert after the Дашборд item:

```ts
  { path: '/register',            label: 'Журнал',            icon: FactCheckIcon,      roles: ['root', 'admin', 'teacher'] },
```

Router: `{ path: 'register', element: <RegisterPage /> },` in the AdminLayout children; Header `pageTitles`: `'/register': 'Журнал'`.

- [ ] **Step 7: Verify**

tsc diff vs baseline (no new lines); eslint on touched files 0 errors.

Manual check list for the report (the user runs it in the browser): teacher sees only own groups; weekend shows the info banner; «Усі присутні» fills only empty rows; changed rows get an orange border and «Зберегти» enables; a day older than the window is read-only for a teacher; admin gets the reason dialog; month grid opens a day on click.

- [ ] **Step 8: Commit**

```bash
git add src/pages/register src/widgets/sidebar/model/nav-items.ts src/widgets/header/ui/Header.tsx src/app/router/index.tsx
git commit -m "feat: add daily register and month grid"
```

---

### Task 9: Admin notices, parent attendance tab, docs

**Files:**
- Create: `src/shared/model/pendingNoticesStore.ts`, `src/pages/absenceNotices/index.ts`, `src/pages/absenceNotices/model/absenceNoticesStore.ts`, `src/pages/absenceNotices/ui/AbsenceNoticesPage.tsx`, `src/pages/familyChild/model/childAttendanceStore.ts`, `src/pages/familyChild/ui/AttendanceTab.tsx`, `src/pages/familyChild/ui/NoticeDialog.tsx`
- Modify: `src/widgets/sidebar/model/nav-items.ts`, `src/widgets/sidebar/ui/Sidebar.tsx`, `src/app/router/index.tsx`, `src/widgets/header/ui/Header.tsx`, `src/pages/familyChild/ui/FamilyChildPage.tsx`, `CLAUDE.md`

**Interfaces:**
- Consumes: `registerApi.getNotices/approveNotice/rejectNotice/cancelNotice/getReasons`, `parentCabinetApi.getRegister/getNotices/createNotice/cancelNotice`, `VisitsTab`, `ReasonDialog`.
- Produces: route `/absence-notices`; `usePendingNoticesStore` (`count`, `refresh()`); parent tab «Відвідування» = `AttendanceTab`.

- [ ] **Step 1: Pending count store `src/shared/model/pendingNoticesStore.ts`**

```ts
import { create } from 'zustand';
import { registerApi } from '../api';

interface PendingNoticesState {
  count: number;
  refresh: () => Promise<void>;
}

export const usePendingNoticesStore = create<PendingNoticesState>((set) => ({
  count: 0,
  refresh: async () => {
    const { data } = await registerApi.getNotices('pending');
    set({ count: data.length });
  },
}));
```

- [ ] **Step 2: Menu badge**

`nav-items.ts`: add `badge?: 'pendingNotices'` to `NavItem`; import `MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread'` and add after «Журнал»:

```ts
  { path: '/absence-notices',     label: 'Повідомлення',      icon: MarkEmailUnreadIcon, roles: ADMIN, badge: 'pendingNotices' },
```

`Sidebar.tsx`: import `Badge` from MUI, `useEffect` from react and `usePendingNoticesStore` from `../../../shared/model/pendingNoticesStore`. In `NavButton` read `const pending = usePendingNoticesStore((s) => s.count)` and render the icon as:

```tsx
          {item.badge === 'pendingNotices' && pending > 0 ? (
            <Badge badgeContent={pending} color="error"><item.icon fontSize="small" /></Badge>
          ) : (
            <item.icon fontSize="small" />
          )}
```

In `Sidebar` add:

```tsx
  const refreshPending = usePendingNoticesStore((s) => s.refresh)
  useEffect(() => {
    if (role === 'root' || role === 'admin') refreshPending().catch(() => undefined)
  }, [role, refreshPending])
```

- [ ] **Step 3: Notices store and page**

`src/pages/absenceNotices/model/absenceNoticesStore.ts`:

```ts
import { create } from 'zustand';
import { registerApi, type AdminNotice, type NoticeStatus } from '../../../shared/api';
import { usePendingNoticesStore } from '../../../shared/model/pendingNoticesStore';

interface AbsenceNoticesState {
  status: NoticeStatus;
  notices: AdminNotice[];
  isLoading: boolean;
  isSaving: boolean;
  setStatus: (status: NoticeStatus) => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string, reason: string) => Promise<void>;
  cancel: (id: string, reason: string) => Promise<void>;
}

export const useAbsenceNoticesStore = create<AbsenceNoticesState>((set, get) => {
  const decide = async (request: () => Promise<unknown>, id: string) => {
    set({ isSaving: true });
    try {
      await request();
      set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }));
      usePendingNoticesStore.getState().refresh().catch(() => undefined);
    } finally {
      set({ isSaving: false });
    }
  };
  return {
    status: 'pending',
    notices: [],
    isLoading: false,
    isSaving: false,
    setStatus: async (status) => {
      set({ status, notices: [], isLoading: true });
      try {
        const { data } = await registerApi.getNotices(status);
        if (get().status === status) set({ notices: data });
      } finally {
        if (get().status === status) set({ isLoading: false });
      }
    },
    approve: (id) => decide(() => registerApi.approveNotice(id), id),
    reject: (id, reason) => decide(() => registerApi.rejectNotice(id, reason), id),
    cancel: (id, reason) => decide(() => registerApi.cancelNotice(id, reason), id),
  };
});
```

`src/pages/absenceNotices/ui/AbsenceNoticesPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Box, Button, Paper, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material'
import { useAbsenceNoticesStore } from '../model/absenceNoticesStore'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import { formatDay, type AdminNotice, type NoticeStatus } from '../../../shared/api'

const tabs: { status: NoticeStatus; label: string }[] = [
  { status: 'pending', label: 'Очікують' },
  { status: 'approved', label: 'Підтверджені' },
  { status: 'rejected', label: 'Відхилені' },
  { status: 'cancelled', label: 'Скасовані' },
]

export const AbsenceNoticesPage = () => {
  const status = useAbsenceNoticesStore((s) => s.status)
  const notices = useAbsenceNoticesStore((s) => s.notices)
  const isLoading = useAbsenceNoticesStore((s) => s.isLoading)
  const isSaving = useAbsenceNoticesStore((s) => s.isSaving)
  const setStatus = useAbsenceNoticesStore((s) => s.setStatus)
  const approve = useAbsenceNoticesStore((s) => s.approve)
  const reject = useAbsenceNoticesStore((s) => s.reject)
  const cancel = useAbsenceNoticesStore((s) => s.cancel)
  const [dialog, setDialog] = useState<{ notice: AdminNotice; action: 'reject' | 'cancel' } | null>(null)

  useEffect(() => {
    setStatus(useAbsenceNoticesStore.getState().status).catch(() => undefined)
  }, [setStatus])

  return (
    <Box>
      <Tabs value={status} onChange={(_, v: NoticeStatus) => setStatus(v).catch(() => undefined)} variant="scrollable" sx={{ mb: 2 }}>
        {tabs.map((t) => <Tab key={t.status} value={t.status} label={t.label} />)}
      </Tabs>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Дитина</TableCell>
              <TableCell>Група</TableCell>
              <TableCell>Період</TableCell>
              <TableCell>Причина</TableCell>
              <TableCell>Коментар</TableCell>
              <TableCell>Подав</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {notices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>{isLoading ? 'Завантаження…' : 'Повідомлень немає.'}</TableCell>
              </TableRow>
            ) : (
              notices.map((n) => (
                <TableRow key={n.id}>
                  <TableCell>{n.child.lastName} {n.child.firstName}</TableCell>
                  <TableCell>{n.child.group?.name ?? '—'}</TableCell>
                  <TableCell>{formatDay(n.startDate)} – {formatDay(n.endDate)}</TableCell>
                  <TableCell>{n.reason.name}</TableCell>
                  <TableCell>
                    {n.comment ?? '—'}
                    {n.decisionReason && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Рішення: {n.decisionReason}</Typography>}
                  </TableCell>
                  <TableCell>{n.createdBy.lastName} {n.createdBy.firstName}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {n.status === 'pending' && (
                      <>
                        <Button size="small" disabled={isSaving} onClick={() => approve(n.id).catch(() => undefined)}>Підтвердити</Button>
                        <Button size="small" color="error" disabled={isSaving} onClick={() => setDialog({ notice: n, action: 'reject' })}>Відхилити</Button>
                      </>
                    )}
                    {n.status === 'approved' && (
                      <Button size="small" color="error" disabled={isSaving} onClick={() => setDialog({ notice: n, action: 'cancel' })}>Скасувати</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>
      <ReasonDialog
        open={dialog !== null}
        title={dialog?.action === 'cancel' ? 'Скасувати підтверджене повідомлення' : 'Відхилити повідомлення'}
        subtitle={dialog ? `${dialog.notice.child.lastName} ${dialog.notice.child.firstName}, ${formatDay(dialog.notice.startDate)} – ${formatDay(dialog.notice.endDate)}` : undefined}
        confirmLabel={dialog?.action === 'cancel' ? 'Скасувати' : 'Відхилити'}
        isSaving={isSaving}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          if (!dialog) return
          if (dialog.action === 'cancel') await cancel(dialog.notice.id, reason)
          else await reject(dialog.notice.id, reason)
          setDialog(null)
        }}
      />
    </Box>
  )
}
```

`src/pages/absenceNotices/index.ts`: `export { AbsenceNoticesPage } from './ui/AbsenceNoticesPage'`. Router: `{ path: 'absence-notices', element: <AbsenceNoticesPage /> },`; Header `pageTitles`: `'/absence-notices': 'Повідомлення про відсутність'`.

- [ ] **Step 4: Parent attendance store `src/pages/familyChild/model/childAttendanceStore.ts`**

```ts
import { create } from 'zustand';
import {
  localToday,
  parentCabinetApi,
  registerApi,
  type AbsenceReason,
  type ChildRegisterMonth,
  type CreateNoticeDto,
  type ParentNotice,
} from '../../../shared/api';

interface ChildAttendanceState {
  childId: string | null;
  month: string;
  register: ChildRegisterMonth | null;
  registerKey: string | null;
  notices: ParentNotice[];
  reasons: AbsenceReason[];
  isSaving: boolean;
  open: (childId: string) => Promise<void>;
  setMonth: (month: string) => Promise<void>;
  createNotice: (dto: CreateNoticeDto) => Promise<void>;
  cancelNotice: (noticeId: string) => Promise<void>;
}

export const useChildAttendanceStore = create<ChildAttendanceState>((set, get) => ({
  childId: null,
  month: localToday().slice(0, 7),
  register: null,
  registerKey: null,
  notices: [],
  reasons: [],
  isSaving: false,
  open: async (childId) => {
    set({ childId, notices: [], register: null, registerKey: null });
    await get().setMonth(get().month);
    const [{ data: notices }, { data: reasons }] = await Promise.all([
      parentCabinetApi.getNotices(childId),
      registerApi.getReasons(),
    ]);
    if (get().childId === childId) set({ notices, reasons });
  },
  setMonth: async (month) => {
    const { childId } = get();
    if (!childId) return;
    const key = `${childId}/${month}`;
    set({ month, registerKey: key, register: null });
    const { data } = await parentCabinetApi.getRegister(childId, month);
    if (get().registerKey === key) set({ register: data });
  },
  createNotice: async (dto) => {
    const { childId } = get();
    if (!childId) return;
    set({ isSaving: true });
    try {
      const { data } = await parentCabinetApi.createNotice(childId, dto);
      if (get().childId === childId) set((state) => ({ notices: [data, ...state.notices] }));
    } finally {
      set({ isSaving: false });
    }
  },
  cancelNotice: async (noticeId) => {
    const { childId } = get();
    if (!childId) return;
    set({ isSaving: true });
    try {
      const { data } = await parentCabinetApi.cancelNotice(childId, noticeId);
      if (get().childId === childId) {
        set((state) => ({ notices: state.notices.map((n) => (n.id === noticeId ? data : n)) }));
      }
    } finally {
      set({ isSaving: false });
    }
  },
}));
```

- [ ] **Step 5: Notice dialog `src/pages/familyChild/ui/NoticeDialog.tsx`**

```tsx
import { Controller, useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, MenuItem, TextField } from '@mui/material'
import { useChildAttendanceStore } from '../model/childAttendanceStore'
import { localToday } from '../../../shared/api'

const DAY_MS = 24 * 60 * 60 * 1000
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1

const schema = yup.object({
  startDate: yup.string().required("Обов'язкове поле").test('future', 'Не раніше сьогодні', (v) => !!v && v >= localToday()),
  endDate: yup
    .string()
    .required("Обов'язкове поле")
    .test('after', 'Кінець раніше за початок', function (v) {
      return !!v && v >= this.parent.startDate
    })
    .test('length', 'Не більше 60 днів', function (v) {
      return !v || !this.parent.startDate || span(this.parent.startDate, v) <= 60
    }),
  reasonId: yup.string().required('Оберіть причину'),
  comment: yup.string().default('').max(500, 'Максимум 500 символів'),
})

type FormValues = yup.InferType<typeof schema>

export const NoticeDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const reasons = useChildAttendanceStore((s) => s.reasons)
  const isSaving = useChildAttendanceStore((s) => s.isSaving)
  const createNotice = useChildAttendanceStore((s) => s.createNotice)
  const empty: FormValues = { startDate: localToday(), endDate: localToday(), reasonId: '', comment: '' }

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: empty,
    resolver: yupResolver(schema),
  })

  const handleClose = () => {
    reset(empty)
    onClose()
  }

  const onSubmit = async (values: FormValues) => {
    await createNotice({
      startDate: values.startDate,
      endDate: values.endDate,
      reasonId: values.reasonId,
      comment: values.comment.trim() || undefined,
    })
    handleClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Повідомити про відсутність</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: '20px' }}>
        <Controller
          name="startDate"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} type="date" label="З дати" slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: localToday() } }} error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="endDate"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} type="date" label="По дату" slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: localToday() } }} error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="reasonId"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} select label="Причина" error={!!error} helperText={error?.message}>
              {reasons.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
            </TextField>
          )}
        />
        <Controller
          name="comment"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Коментар" multiline minRows={2} error={!!error} helperText={error?.message} />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>Скасувати</Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>Надіслати</Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 6: Attendance tab `src/pages/familyChild/ui/AttendanceTab.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Box, Button, Chip, IconButton, Paper, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useChildAttendanceStore } from '../model/childAttendanceStore'
import { NoticeDialog } from './NoticeDialog'
import { VisitsTab } from './VisitsTab'
import {
  dailyStatusLabels,
  dayStateLabels,
  formatDay,
  monthLabel,
  noticeStatusLabels,
  shiftMonth,
  type ChildRegisterMonth,
  type DayState,
  type Visit,
} from '../../../shared/api'

const stateColor: Record<DayState, string> = {
  present: 'success.light',
  absent: 'error.light',
  expected_absent: 'warning.light',
  unmarked: 'grey.200',
  non_working: 'grey.100',
}

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']

const MonthGrid = ({ register }: { register: ChildRegisterMonth }) => {
  const offset = (new Date(`${register.days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
      {weekdays.map((w) => (
        <Typography key={w} variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>{w}</Typography>
      ))}
      {Array.from({ length: offset }, (_, i) => <Box key={`pad-${i}`} />)}
      {register.days.map((d) => (
        <Box
          key={d.date}
          title={`${dayStateLabels[d.state]}${d.reasonName ? `: ${d.reasonName}` : ''}${d.title ? ` (${d.title})` : ''}`}
          sx={{ bgcolor: stateColor[d.state], borderRadius: 1, py: 1, textAlign: 'center', fontSize: 14 }}
        >
          {Number(d.date.slice(8))}
        </Box>
      ))}
    </Box>
  )
}

export const AttendanceTab = ({ childId, visits }: { childId: string; visits: Visit[] }) => {
  const storeChildId = useChildAttendanceStore((s) => s.childId)
  const month = useChildAttendanceStore((s) => s.month)
  const register = useChildAttendanceStore((s) => s.register)
  const notices = useChildAttendanceStore((s) => s.notices)
  const isSaving = useChildAttendanceStore((s) => s.isSaving)
  const open = useChildAttendanceStore((s) => s.open)
  const setMonth = useChildAttendanceStore((s) => s.setMonth)
  const cancelNotice = useChildAttendanceStore((s) => s.cancelNotice)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    open(childId).catch(() => undefined)
  }, [childId, open])

  const ready = storeChildId === childId && register !== null
  const monthVisits = visits.filter((v) => v.date.slice(0, 7) === month)
  const absences = ready ? register.days.filter((d) => d.state === 'absent' || d.state === 'expected_absent') : []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <IconButton onClick={() => setMonth(shiftMonth(month, -1)).catch(() => undefined)}><ChevronLeftIcon /></IconButton>
        <Typography sx={{ minWidth: 140, textAlign: 'center', fontWeight: 600 }}>{monthLabel(month)}</Typography>
        <IconButton onClick={() => setMonth(shiftMonth(month, 1)).catch(() => undefined)}><ChevronRightIcon /></IconButton>
        <Button variant="contained" sx={{ ml: 'auto' }} onClick={() => setDialogOpen(true)}>Повідомити про відсутність</Button>
      </Box>

      {!ready ? (
        <Typography color="text.secondary">Завантаження…</Typography>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip color="success" variant="outlined" label={`Присутній: ${register.summary.present} з ${register.summary.workingDays}`} />
            <Chip color="warning" variant="outlined" label={`Поважні пропуски: ${register.summary.absentExcused}`} />
            <Chip color="error" variant="outlined" label={`Без поважної причини: ${register.summary.absentUnexcused}`} />
            {register.summary.expectedAbsent > 0 && <Chip variant="outlined" label={`Очікується відсутність: ${register.summary.expectedAbsent}`} />}
          </Box>
          <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
            <MonthGrid register={register} />
          </Paper>
          {absences.length > 0 && (
            <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
              <Typography sx={{ fontWeight: 600, mb: 1 }}>Пропуски</Typography>
              {absences.map((d) => (
                <Typography key={d.date} variant="body2">
                  {formatDay(d.date)}: {d.state === 'expected_absent' ? 'очікується відсутність' : d.status ? dailyStatusLabels[d.status] : ''}{d.reasonName ? `, ${d.reasonName}` : ''}
                </Typography>
              ))}
            </Paper>
          )}
        </>
      )}

      <Typography sx={{ fontWeight: 600 }}>Заняття та адаптація</Typography>
      <VisitsTab visits={monthVisits} />

      <Typography sx={{ fontWeight: 600 }}>Повідомлення про відсутність</Typography>
      {notices.length === 0 ? (
        <Typography color="text.secondary">Повідомлень ще немає.</Typography>
      ) : (
        notices.map((n) => (
          <Paper key={n.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ mr: 'auto' }}>
              <Typography>{formatDay(n.startDate)} – {formatDay(n.endDate)}, {n.reason.name}</Typography>
              {n.comment && <Typography variant="body2" color="text.secondary">{n.comment}</Typography>}
              {n.decisionReason && <Typography variant="body2" color="text.secondary">Причина рішення: {n.decisionReason}</Typography>}
            </Box>
            <Chip size="small" label={noticeStatusLabels[n.status]} color={n.status === 'approved' ? 'success' : n.status === 'rejected' ? 'error' : 'default'} />
            {n.status === 'pending' && (
              <Button size="small" color="error" disabled={isSaving} onClick={() => cancelNotice(n.id).catch(() => undefined)}>Скасувати</Button>
            )}
          </Paper>
        ))
      )}

      <NoticeDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  )
}
```

In `FamilyChildPage.tsx` replace `{tab === 1 && <VisitsTab visits={card.visits} />}` with `{tab === 1 && <AttendanceTab childId={card.id} visits={card.visits} />}` (import `AttendanceTab`, drop the unused `VisitsTab` import). In `VisitsTab` change the empty text to «Немає записів за цей місяць.».

- [ ] **Step 7: Frontend CLAUDE.md**

In the Structure section after the parent cabinet paragraph add:

```markdown
Attendance register: `pages/register` (day register + month grid, staff), `pages/absenceNotices` (admin approval, menu badge via `shared/model/pendingNoticesStore`), `pages/calendar` (working-day calendar + teacher edit window), `pages/absenceReasons`; parent tab «Відвідування» is `pages/familyChild/ui/AttendanceTab.tsx`. API in `shared/api/register.ts`. Day states come from the backend; never compute them on the frontend.
```

- [ ] **Step 8: Verify**

tsc diff vs baseline (no new lines); eslint on touched files 0 errors. Manual browser checks for the report: badge count drops after approve/reject; parent creates a notice (dates before today blocked), sees it «Очікує», cancels it; after admin approval the month grid shows the day orange; a teacher's «present» mark turns it green.

- [ ] **Step 9: Commit**

```bash
git add src/shared/model/pendingNoticesStore.ts src/pages/absenceNotices src/pages/familyChild src/widgets/sidebar src/widgets/header/ui/Header.tsx src/app/router/index.tsx CLAUDE.md
git commit -m "feat: add absence notices and parent attendance tab"
```
