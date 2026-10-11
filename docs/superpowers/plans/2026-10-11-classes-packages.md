# Classes and Packages (Part 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Directions with a missed-lesson rule, class groups with members/teachers/tariffs, session packages charged into the finance ledger, lesson marking that consumes package sessions or charges single lessons, legacy subscription migration with reconciliation, plus frontend: shared error display, role menu, Гуртки, lesson marking, Мої заняття and the Пакети tab.

**Architecture:** New `src/classes/` module on top of Part 2 tariffs and Part 1 finance. A pure `consumption.ts` decides whether a mark consumes and which package to use; remaining sessions are computed from `SessionUsage` rows (no counters). Marking runs in one transaction with row locks on the lesson and the child's packages; corrections void the old usage (and its single-lesson charge through `voidChargeInTx`).

**Tech Stack:** NestJS 11, Prisma 7, class-validator, Jest. Frontend: React 19, MUI 9, Zustand 5, react-hook-form 7 + yup, axios.

**Spec:** `docs/superpowers/specs/2026-10-11-classes-packages-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest` branch `feature/classes` (already checked out, from `main`), Tasks 1–8. Frontend `D:\IT\EduNest`: Task 9 creates `feature/classes` from `main`, Tasks 9–13.

## Global Constraints

- Node 22; Prisma 7 — check generated types in `node_modules/.prisma/client/index.d.ts` instead of guessing.
- Money: `Prisma.Decimal` only; API money = 2-decimal strings; request money pattern `AMOUNT_PATTERN` from `src/finance/finance-calc.ts`.
- Business dates are `@db.Date` UTC-midnight `Date`s; "today" = `kyivToday()` from `src/tariffs/dates.ts`.
- Admin routes `@Roles(Role.root, Role.admin)`; teacher-accessible routes `@Roles(Role.root, Role.admin, Role.teacher)` with the ownership check in the service. Guards at class level: `@UseGuards(JwtAuthGuard, RolesGuard)`.
- Money-relevant records are voided with a reason, never edited or deleted.
- All foreign keys RESTRICT; optional relations need explicit `onDelete: Restrict`.
- Error messages English, exactly as in the spec plus `Invalid teachers` and `Invalid date`.
- No new dependencies. No code comments.
- Backend: run `npx eslint --fix <touched files>` before each commit; add no new lint errors or warnings (type jest mocks with `as unknown as X`, never `as any`; use a typed `firstArg` helper for `mock.calls[0][0]`).
- Frontend: before Task 9 save `npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx"` to the baseline file; tasks add no lines to it; `npx eslint` on touched files 0 errors.
- Frontend stores: selectors return existing references; after a successful mutation the follow-up refresh is best-effort (`.catch(() => undefined)`); stale async results are ignored when the selected entity changed.
- Commits: Conventional Commits, one task = one commit unless stated; trailer = the committing model's attribution line. Never push.

## Review Focus

1. Two admins (or double click) marking the same lesson at once → one attendance per child and no double consumption. Pinned in Task 5 (lock-order test).
2. A child with two valid packages in the direction → the one expiring first is consumed; a package extended after expiry becomes usable again. Pinned in Task 2.
3. Correcting "present" to "excused" under `unexcused_only` → the session returns to the package and no new usage is created. Pinned in Task 5.
4. Teacher correcting yesterday's lesson → 403; admin correcting yesterday's lesson without a reason → 400. Pinned in Task 5.
5. Running the legacy migration twice → no duplicate packages or directions. Pinned in Task 6.

---

## File Map

Backend `src/classes/`:

| File | Responsibility |
|---|---|
| `consumption.ts` | Pure: consume rule, package validity/expiry, remaining, pick, state |
| `class-views.ts` | Prisma include shapes, person/tariff selects, view mappers |
| `access.ts` | `assertGroupAccess` (teacher ownership) and `parseDay` (YYYY-MM-DD) |
| `directions.service.ts` | Directions CRUD |
| `class-groups.service.ts` | Groups CRUD, members, group detail, my groups |
| `packages.service.ts` | Purchase, extend, void, list, reconcile, reconciliation list |
| `legacy.service.ts` | One-time migration of subscriptions to packages |
| `lessons.service.ts` | Roster and marking/correction |
| `*.controller.ts`, `classes.module.ts`, `dto/*.ts` | HTTP layer |

Frontend:

| File | Responsibility |
|---|---|
| `src/shared/api/errorMessages.ts` | Backend message → Ukrainian map, `translateError` |
| `src/shared/model/notifyStore.ts`, `src/shared/ui/Notifier.tsx` | Snackbar queue |
| `src/shared/api/classes.ts` | Types, labels, API clients for Part 4 |
| `src/pages/classes/` | Гуртки page (directions, groups, migration, reconciliation) |
| `src/pages/classGroup/` | Group page and mark lesson page |
| `src/pages/myClasses/` | Teacher's groups |
| `src/pages/finance/model/packagesStore.ts`, `ui/PackagesTab.tsx` + modals | Пакети tab |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_classes/migration.sql` (generated)

**Interfaces:**
- Produces Prisma enums `MissedLessonRule`, `ClassFormat`, `AttendanceStatus`; `ChargeSource.extra_session`; `Tariff.validityDays`; models `Direction`, `ClassGroup`, `ClassGroupMember`, `Package`, `PackageExtension`, `Lesson` (`@@unique([classGroupId, date])` → accessor `classGroupId_date`), `LessonAttendance`, `SessionUsage`.

- [ ] **Step 1: Enums and Tariff/ChargeSource changes**

Add to `enum ChargeSource` the value `extra_session` (after `extra_package`). Add to `model Tariff` after `billingMode`:

```prisma
  validityDays     Int?
```

and after `adaptationVisits`:

```prisma
  singleGroups     ClassGroup[]      @relation("GroupSingleTariff")
  packageGroups    ClassGroup[]      @relation("GroupPackageTariff")
  packages         Package[]
```

Append the enums:

```prisma
enum MissedLessonRule {
  no_charge
  always
  unexcused_only
}

enum ClassFormat {
  individual
  group
}

enum AttendanceStatus {
  present
  absent_excused
  absent_unexcused
}
```

- [ ] **Step 2: Models**

Append exactly the models from the spec section "Prisma Schema" (`Direction`, `ClassGroup`, `ClassGroupMember`, `Package`, `PackageExtension`, `Lesson`, `LessonAttendance`, `SessionUsage`), copied verbatim from `docs/superpowers/specs/2026-10-11-classes-packages-design.md`.

- [ ] **Step 3: Back-relations**

In `model User` add:

```prisma
  classGroupsTeaching ClassGroup[]       @relation("ClassGroupTeachers")
  membersCreated      ClassGroupMember[] @relation("MemberCreatedBy")
  packagesCreated     Package[]          @relation("PackageCreatedBy")
  packagesVoided      Package[]          @relation("PackageVoidedBy")
  packagesReconciled  Package[]          @relation("PackageReconciledBy")
  extensionsCreated   PackageExtension[] @relation("ExtensionCreatedBy")
  lessonsConducted    Lesson[]           @relation("LessonConductedBy")
  attendancesMarked   LessonAttendance[] @relation("AttendanceMarkedBy")
  attendancesVoided   LessonAttendance[] @relation("AttendanceVoidedBy")
  usagesVoided        SessionUsage[]     @relation("UsageVoidedBy")
```

In `model Child` add:

```prisma
  classMemberships  ClassGroupMember[]
  lessonAttendances LessonAttendance[]
  packages          Package[]
```

In `model Charge` add:

```prisma
  package         Package?        @relation("PackageCharge")
  sessionUsage    SessionUsage?   @relation("SessionCharge")
```

In `model Subscription` add:

```prisma
  package            Package?
```

- [ ] **Step 4: Migrate**

Run: `npx prisma migrate dev --name add_classes` then `npx prisma generate`.
Expected: new migration folder; `migration.sql` contains only `CREATE TYPE`, `ALTER TYPE "ChargeSource" ADD VALUE 'extra_session'`, `ALTER TABLE "Tariff" ADD COLUMN "validityDays" INTEGER`, `CREATE TABLE` (including the implicit `_ClassGroupTeachers`), `CREATE (UNIQUE) INDEX`, `ADD CONSTRAINT`. No DROP. If Prisma asks to reset or reports drift, STOP and report BLOCKED.

- [ ] **Step 5: Build and commit**

Run: `npm run build` — exit 0; `npx jest` — all existing tests pass.

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add classes and packages schema"
```

---

### Task 2: Consumption logic

**Files:**
- Create: `src/classes/consumption.ts`
- Test: `src/classes/consumption.spec.ts`

**Interfaces:**
- Consumes: `addDays` from `src/tariffs/dates.ts`.
- Produces:
  - `interface PackageLike { id: string; sessionsTotal: number; usedBefore: number; purchaseDate: Date; expiresAt: Date | null; createdAt: Date; voidedAt: Date | null; needsReconciliation: boolean; extensions: { newExpiresAt: Date; createdAt: Date }[]; usages: { voidedAt: Date | null }[] }`
  - `type PackageState = 'voided' | 'needs_reconciliation' | 'exhausted' | 'expired' | 'active'`
  - `shouldConsume(rule: MissedLessonRule, status: AttendanceStatus): boolean`
  - `expiresAtFor(purchaseDate: Date, validityDays: number | null): Date | null`
  - `effectiveExpiry(p: PackageLike): Date | null`
  - `packageRemaining(p: PackageLike): number`
  - `isValidOn(p: PackageLike, day: Date): boolean`
  - `pickPackage<T extends PackageLike>(packages: T[], day: Date): T | null`
  - `packageState(p: PackageLike, today: Date): PackageState`

- [ ] **Step 1: Write the failing tests**

Create `src/classes/consumption.spec.ts`:

```ts
import { AttendanceStatus, MissedLessonRule } from '@prisma/client';
import {
  PackageLike,
  effectiveExpiry,
  expiresAtFor,
  isValidOn,
  packageRemaining,
  packageState,
  pickPackage,
  shouldConsume,
} from './consumption';
import { isoDay } from '../tariffs/dates';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const pkg = (over: Partial<PackageLike> = {}): PackageLike => ({
  id: 'p1',
  sessionsTotal: 4,
  usedBefore: 0,
  purchaseDate: day('2026-10-01'),
  expiresAt: day('2026-10-30'),
  createdAt: new Date('2026-10-01T10:00:00Z'),
  voidedAt: null,
  needsReconciliation: false,
  extensions: [],
  usages: [],
  ...over,
});

describe('shouldConsume', () => {
  const cases: [MissedLessonRule, AttendanceStatus, boolean][] = [
    [MissedLessonRule.no_charge, AttendanceStatus.present, true],
    [MissedLessonRule.no_charge, AttendanceStatus.absent_excused, false],
    [MissedLessonRule.no_charge, AttendanceStatus.absent_unexcused, false],
    [MissedLessonRule.always, AttendanceStatus.present, true],
    [MissedLessonRule.always, AttendanceStatus.absent_excused, true],
    [MissedLessonRule.always, AttendanceStatus.absent_unexcused, true],
    [MissedLessonRule.unexcused_only, AttendanceStatus.present, true],
    [MissedLessonRule.unexcused_only, AttendanceStatus.absent_excused, false],
    [MissedLessonRule.unexcused_only, AttendanceStatus.absent_unexcused, true],
  ];

  it.each(cases)('%s + %s → %s', (rule, status, expected) => {
    expect(shouldConsume(rule, status)).toBe(expected);
  });
});

describe('expiry', () => {
  it('computes the last valid day from validity days', () => {
    expect(isoDay(expiresAtFor(day('2026-10-01'), 30)!)).toBe('2026-10-30');
    expect(expiresAtFor(day('2026-10-01'), null)).toBeNull();
  });

  it('uses the latest extension', () => {
    const p = pkg({
      extensions: [
        { newExpiresAt: day('2026-11-30'), createdAt: new Date('2026-11-02T10:00:00Z') },
        { newExpiresAt: day('2026-11-15'), createdAt: new Date('2026-11-01T10:00:00Z') },
      ],
    });
    expect(isoDay(effectiveExpiry(p)!)).toBe('2026-11-30');
  });
});

describe('packageRemaining', () => {
  it('subtracts earlier usage and active usages only', () => {
    const p = pkg({ usedBefore: 1, usages: [{ voidedAt: null }, { voidedAt: new Date() }] });
    expect(packageRemaining(p)).toBe(2);
  });
});

describe('isValidOn', () => {
  it('checks purchase date, expiry, extension and voiding', () => {
    expect(isValidOn(pkg(), day('2026-09-30'))).toBe(false);
    expect(isValidOn(pkg(), day('2026-10-30'))).toBe(true);
    expect(isValidOn(pkg(), day('2026-10-31'))).toBe(false);
    expect(isValidOn(pkg({ voidedAt: new Date() }), day('2026-10-10'))).toBe(false);
    expect(
      isValidOn(
        pkg({ extensions: [{ newExpiresAt: day('2026-11-15'), createdAt: new Date() }] }),
        day('2026-11-10'),
      ),
    ).toBe(true);
    expect(isValidOn(pkg({ expiresAt: null }), day('2030-01-01'))).toBe(true);
  });
});

describe('pickPackage', () => {
  it('takes the valid package expiring first', () => {
    const late = pkg({ id: 'late', expiresAt: day('2026-10-30') });
    const early = pkg({ id: 'early', expiresAt: day('2026-10-20') });
    expect(pickPackage([late, early], day('2026-10-10'))?.id).toBe('early');
  });

  it('skips exhausted packages and puts packages without expiry last', () => {
    const exhausted = pkg({ id: 'ex', expiresAt: day('2026-10-20'), usedBefore: 4 });
    const open = pkg({ id: 'open', expiresAt: null });
    const dated = pkg({ id: 'dated', expiresAt: day('2026-12-31') });
    expect(pickPackage([open, exhausted, dated], day('2026-10-10'))?.id).toBe('dated');
    expect(pickPackage([open, exhausted], day('2026-10-10'))?.id).toBe('open');
  });

  it('returns null when nothing is usable', () => {
    expect(pickPackage([pkg({ voidedAt: new Date() })], day('2026-10-10'))).toBeNull();
    expect(pickPackage([], day('2026-10-10'))).toBeNull();
  });
});

describe('packageState', () => {
  it('orders voided, reconciliation, exhausted, expired, active', () => {
    const today = day('2026-10-10');
    expect(packageState(pkg({ voidedAt: new Date(), needsReconciliation: true }), today)).toBe('voided');
    expect(packageState(pkg({ needsReconciliation: true, usedBefore: 4 }), today)).toBe(
      'needs_reconciliation',
    );
    expect(packageState(pkg({ usedBefore: 4 }), today)).toBe('exhausted');
    expect(packageState(pkg(), day('2026-11-01'))).toBe('expired');
    expect(packageState(pkg(), today)).toBe('active');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/classes/consumption.spec.ts`
Expected: FAIL — `Cannot find module './consumption'`.

- [ ] **Step 3: Implement `src/classes/consumption.ts`**

```ts
import { AttendanceStatus, MissedLessonRule } from '@prisma/client';
import { addDays } from '../tariffs/dates';

export interface PackageLike {
  id: string;
  sessionsTotal: number;
  usedBefore: number;
  purchaseDate: Date;
  expiresAt: Date | null;
  createdAt: Date;
  voidedAt: Date | null;
  needsReconciliation: boolean;
  extensions: { newExpiresAt: Date; createdAt: Date }[];
  usages: { voidedAt: Date | null }[];
}

export type PackageState = 'voided' | 'needs_reconciliation' | 'exhausted' | 'expired' | 'active';

const time = (day: Date) => day.getTime();

export function shouldConsume(rule: MissedLessonRule, status: AttendanceStatus): boolean {
  if (status === AttendanceStatus.present) return true;
  if (rule === MissedLessonRule.always) return true;
  return rule === MissedLessonRule.unexcused_only && status === AttendanceStatus.absent_unexcused;
}

export const expiresAtFor = (purchaseDate: Date, validityDays: number | null): Date | null =>
  validityDays === null ? null : addDays(purchaseDate, validityDays - 1);

export function effectiveExpiry(p: PackageLike): Date | null {
  if (p.extensions.length === 0) return p.expiresAt;
  const latest = [...p.extensions].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  return latest.newExpiresAt;
}

export const packageRemaining = (p: PackageLike): number =>
  p.sessionsTotal - p.usedBefore - p.usages.filter((u) => !u.voidedAt).length;

export function isValidOn(p: PackageLike, day: Date): boolean {
  if (p.voidedAt) return false;
  if (time(p.purchaseDate) > time(day)) return false;
  const expiry = effectiveExpiry(p);
  return expiry === null || time(day) <= time(expiry);
}

export function pickPackage<T extends PackageLike>(packages: T[], day: Date): T | null {
  const usable = packages
    .filter((p) => isValidOn(p, day) && packageRemaining(p) > 0)
    .sort((a, b) => {
      const ea = effectiveExpiry(a);
      const eb = effectiveExpiry(b);
      if (ea === null && eb !== null) return 1;
      if (ea !== null && eb === null) return -1;
      if (ea !== null && eb !== null && time(ea) !== time(eb)) return time(ea) - time(eb);
      if (time(a.purchaseDate) !== time(b.purchaseDate)) return time(a.purchaseDate) - time(b.purchaseDate);
      return time(a.createdAt) - time(b.createdAt);
    });
  return usable[0] ?? null;
}

export function packageState(p: PackageLike, today: Date): PackageState {
  if (p.voidedAt) return 'voided';
  if (p.needsReconciliation) return 'needs_reconciliation';
  if (packageRemaining(p) <= 0) return 'exhausted';
  const expiry = effectiveExpiry(p);
  if (expiry !== null && time(today) > time(expiry)) return 'expired';
  return 'active';
}
```

- [ ] **Step 4: Run tests and build**

Run: `npx jest src/classes/consumption.spec.ts` then `npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 5: Commit**

```bash
npx eslint --fix src/classes/consumption.ts src/classes/consumption.spec.ts
git add src/classes
git commit -m "feat: add lesson consumption rules"
```

---

### Task 3: Directions, class groups and members

**Files:**
- Create: `src/classes/access.ts`, `src/classes/class-views.ts`
- Create: `src/classes/dto/create-direction.dto.ts`, `update-direction.dto.ts`, `create-class-group.dto.ts`, `update-class-group.dto.ts`, `add-member.dto.ts`, `end-member.dto.ts`
- Create: `src/classes/directions.service.ts`, `src/classes/class-groups.service.ts`
- Test: `src/classes/directions.service.spec.ts`, `src/classes/class-groups.service.spec.ts`

**Interfaces:**
- Consumes: `kyivToday`, `toDay`, `overlaps` (dates.ts); `AuthenticatedUser` type.
- Produces:
  - `access.ts`: `assertGroupAccess(group: { teachers: { id: string }[] }, user: AuthenticatedUser): void` (throws `ForbiddenException('Not your class group')` for a teacher not in `teachers`); `parseDay(value: string): Date` (throws `BadRequestException('Invalid date')` unless `/^\d{4}-\d{2}-\d{2}$/` and a real date).
  - `class-views.ts`: `personSelect`, `tariffRefSelect`, `groupSummaryInclude`, `directionInclude`, `groupDetailInclude`, `toGroupSummary(g, today)`, `toDirectionView(d, today)`, `toGroupDetail(g, today)`.
  - `DirectionsService.list(today?)`, `create(dto)`, `update(id, dto)`, `delete(id)`.
  - `ClassGroupsService.create(dto)`, `update(id, dto)`, `delete(id)`, `get(id, user, today?)`, `myGroups(user, today?)`, `addMember(groupId, dto, userId)`, `endMember(memberId, dto)`.

View shapes (frontend mirrors them in Task 10):
- `ClassGroupSummary = { id, name, format, isActive, teachers: PersonRef[], singleTariff: { id, name } | null, packageTariff: { id, name } | null, activeMembers: number }`
- `DirectionView = { id, name, missedRule, isActive, groups: ClassGroupSummary[] }`
- `ClassGroupDetail = ClassGroupSummary & { direction: { id, name, missedRule }, members: { id, child: PersonRef, startDate, endDate }[], lessons: { id, date, conductedBy: PersonRef, attendances: { childId, childName, status, isGuest }[] }[] }`

- [ ] **Step 1: `access.ts` and `class-views.ts`**

`src/classes/access.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { isoDay, toDay } from '../tariffs/dates';

export function assertGroupAccess(group: { teachers: { id: string }[] }, user: AuthenticatedUser) {
  if (user.role === Role.teacher && !group.teachers.some((t) => t.id === user.id)) {
    throw new ForbiddenException('Not your class group');
  }
}

export function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Invalid date');
  const day = toDay(value);
  if (Number.isNaN(day.getTime()) || isoDay(day) !== value) throw new BadRequestException('Invalid date');
  return day;
}
```

`src/classes/class-views.ts`:

```ts
import { Prisma } from '@prisma/client';

export const personSelect = { select: { id: true, firstName: true, lastName: true } } as const;
export const tariffRefSelect = { select: { id: true, name: true } } as const;

const isActiveMember = (m: { startDate: Date; endDate: Date | null }, today: Date) =>
  m.startDate.getTime() <= today.getTime() && (m.endDate === null || m.endDate.getTime() >= today.getTime());

export const groupSummaryInclude = {
  teachers: personSelect,
  singleTariff: tariffRefSelect,
  packageTariff: tariffRefSelect,
  members: { select: { startDate: true, endDate: true } },
} satisfies Prisma.ClassGroupInclude;

export const directionInclude = {
  groups: { include: groupSummaryInclude, orderBy: { name: 'asc' } },
} satisfies Prisma.DirectionInclude;

export const groupDetailInclude = {
  direction: { select: { id: true, name: true, missedRule: true } },
  teachers: personSelect,
  singleTariff: tariffRefSelect,
  packageTariff: tariffRefSelect,
  members: { include: { child: personSelect }, orderBy: { startDate: 'asc' } },
  lessons: {
    orderBy: { date: 'desc' },
    take: 50,
    include: {
      conductedBy: personSelect,
      attendances: { where: { voidedAt: null }, include: { child: personSelect } },
    },
  },
} satisfies Prisma.ClassGroupInclude;

type SummaryGroup = Prisma.ClassGroupGetPayload<{ include: typeof groupSummaryInclude }>;
type DirectionWithGroups = Prisma.DirectionGetPayload<{ include: typeof directionInclude }>;
export type DetailGroup = Prisma.ClassGroupGetPayload<{ include: typeof groupDetailInclude }>;

export const toGroupSummary = (g: SummaryGroup | DetailGroup, today: Date) => ({
  id: g.id,
  name: g.name,
  format: g.format,
  isActive: g.isActive,
  teachers: g.teachers,
  singleTariff: g.singleTariff,
  packageTariff: g.packageTariff,
  activeMembers: g.members.filter((m) => isActiveMember(m, today)).length,
});

export const toDirectionView = (d: DirectionWithGroups, today: Date) => ({
  id: d.id,
  name: d.name,
  missedRule: d.missedRule,
  isActive: d.isActive,
  groups: d.groups.map((g) => toGroupSummary(g, today)),
});

export const toGroupDetail = (g: DetailGroup, today: Date) => ({
  ...toGroupSummary(g, today),
  direction: g.direction,
  members: g.members.map((m) => ({ id: m.id, child: m.child, startDate: m.startDate, endDate: m.endDate })),
  lessons: g.lessons.map((l) => ({
    id: l.id,
    date: l.date,
    conductedBy: l.conductedBy,
    attendances: l.attendances.map((a) => ({
      childId: a.childId,
      childName: `${a.child.lastName} ${a.child.firstName}`,
      status: a.status,
      isGuest: a.isGuest,
    })),
  })),
});
```

- [ ] **Step 2: DTOs**

`create-direction.dto.ts`:

```ts
import { MissedLessonRule } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateDirectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsEnum(MissedLessonRule)
  missedRule: MissedLessonRule;
}
```

`update-direction.dto.ts`:

```ts
import { MissedLessonRule } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateDirectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsEnum(MissedLessonRule)
  @IsOptional()
  missedRule?: MissedLessonRule;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

`create-class-group.dto.ts`:

```ts
import { ClassFormat } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateClassGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  name: string;

  @IsUUID('4')
  directionId: string;

  @IsEnum(ClassFormat)
  format: ClassFormat;

  @IsArray()
  @IsUUID('4', { each: true })
  teacherIds: string[];

  @IsUUID('4')
  @IsOptional()
  singleTariffId?: string | null;

  @IsUUID('4')
  @IsOptional()
  packageTariffId?: string | null;
}
```

`update-class-group.dto.ts`:

```ts
import { ClassFormat } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateClassGroupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(/\S/)
  @IsOptional()
  name?: string;

  @IsEnum(ClassFormat)
  @IsOptional()
  format?: ClassFormat;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teacherIds?: string[];

  @IsUUID('4')
  @IsOptional()
  singleTariffId?: string | null;

  @IsUUID('4')
  @IsOptional()
  packageTariffId?: string | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

`add-member.dto.ts`:

```ts
import { IsDateString, IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID('4')
  childId: string;

  @IsDateString()
  startDate: string;
}
```

`end-member.dto.ts`:

```ts
import { IsDateString } from 'class-validator';

export class EndMemberDto {
  @IsDateString()
  endDate: string;
}
```

- [ ] **Step 3: Write the failing tests**

`src/classes/directions.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { MissedLessonRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DirectionsService } from './directions.service';

const mockPrisma = {
  direction: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  classGroup: { count: jest.fn() },
  package: { count: jest.fn() },
};

describe('DirectionsService', () => {
  let service: DirectionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.direction.findMany.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [DirectionsService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(DirectionsService);
  });

  it('rejects a duplicate name', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });

    await expect(service.create({ name: 'LEGO', missedRule: MissedLessonRule.no_charge })).rejects.toThrow(
      'Direction with this name already exists',
    );
  });

  it('creates a direction', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue(null);

    await service.create({ name: 'LEGO', missedRule: MissedLessonRule.unexcused_only });

    expect(mockPrisma.direction.create).toHaveBeenCalledWith({
      data: { name: 'LEGO', missedRule: MissedLessonRule.unexcused_only },
    });
  });

  it('refuses to delete a direction in use', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });
    mockPrisma.classGroup.count.mockResolvedValue(1);
    mockPrisma.package.count.mockResolvedValue(0);

    await expect(service.delete('d1')).rejects.toThrow('Cannot delete: direction is in use');
    expect(mockPrisma.direction.delete).not.toHaveBeenCalled();
  });

  it('throws for an unknown direction', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'X' })).rejects.toThrow('Direction not found');
  });
});
```

`src/classes/class-groups.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ClassFormat, Role, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClassGroupsService } from './class-groups.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const mockPrisma = {
  direction: { findUnique: jest.fn() },
  classGroup: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  classGroupMember: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  user: { findMany: jest.fn() },
  tariff: { findUnique: jest.fn() },
  child: { findUnique: jest.fn() },
  lesson: { count: jest.fn() },
  $transaction: jest.fn(),
};

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'LEGO 1',
  format: ClassFormat.group,
  isActive: true,
  directionId: 'd1',
  direction: { id: 'd1', name: 'LEGO', missedRule: 'no_charge' },
  teachers: [{ id: 't1', firstName: 'Olha', lastName: 'Teacher' }],
  singleTariff: null,
  packageTariff: null,
  members: [],
  lessons: [],
  ...over,
});

const dto = { name: 'LEGO 1', directionId: 'd1', format: ClassFormat.group, teacherIds: ['t1'] };

describe('ClassGroupsService', () => {
  let service: ClassGroupsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });
    mockPrisma.classGroup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 't1', role: Role.teacher }]);
    mockPrisma.classGroup.findUnique.mockResolvedValue(detail());
    mockPrisma.classGroup.create.mockResolvedValue({ id: 'g1' });
    const module = await Test.createTestingModule({
      providers: [ClassGroupsService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(ClassGroupsService);
  });

  describe('create', () => {
    it('creates a group with teachers', async () => {
      await service.create(dto);

      expect(mockPrisma.classGroup.create).toHaveBeenCalledWith({
        data: {
          name: 'LEGO 1',
          directionId: 'd1',
          format: ClassFormat.group,
          singleTariffId: null,
          packageTariffId: null,
          teachers: { connect: [{ id: 't1' }] },
        },
      });
    });

    it('rejects users who are not teachers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 't1', role: Role.parent }]);

      await expect(service.create(dto)).rejects.toThrow('Invalid teachers');
    });

    it('rejects a duplicate name in the direction', async () => {
      mockPrisma.classGroup.findFirst.mockResolvedValue({ id: 'other' });

      await expect(service.create(dto)).rejects.toThrow(
        'Class group with this name already exists in the direction',
      );
    });

    it('checks tariff units', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue({ id: 'x', unit: TariffUnit.month });

      await expect(service.create({ ...dto, singleTariffId: '00000000-0000-4000-8000-000000000001' })).rejects.toThrow(
        'Tariff unit must be session',
      );
      await expect(service.create({ ...dto, packageTariffId: '00000000-0000-4000-8000-000000000002' })).rejects.toThrow(
        'Tariff unit must be package',
      );
    });
  });

  describe('members', () => {
    it('rejects an overlapping membership', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.classGroupMember.findMany.mockResolvedValue([{ startDate: day('2026-09-01'), endDate: null }]);

      await expect(service.addMember('g1', { childId: 'c1', startDate: '2026-10-01' }, 'u1')).rejects.toThrow(
        'Child is already a member of this group',
      );
    });

    it('adds a member', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.classGroupMember.findMany.mockResolvedValue([]);

      await service.addMember('g1', { childId: 'c1', startDate: '2026-10-01' }, 'u1');

      expect(mockPrisma.classGroupMember.create).toHaveBeenCalledWith({
        data: { classGroupId: 'g1', childId: 'c1', startDate: day('2026-10-01'), createdById: 'u1' },
      });
    });

    it('rejects an end date before the start', async () => {
      mockPrisma.classGroupMember.findUnique.mockResolvedValue({ id: 'm1', classGroupId: 'g1', startDate: day('2026-10-01') });

      await expect(service.endMember('m1', { endDate: '2026-09-30' })).rejects.toThrow(
        'End date must not be before start date',
      );
    });
  });

  it('forbids a teacher from another group', async () => {
    await expect(service.get('g1', { id: 't2', role: Role.teacher, login: 't2' })).rejects.toThrow(
      'Not your class group',
    );
  });

  it('refuses to delete a group with lessons', async () => {
    mockPrisma.lesson.count.mockResolvedValue(3);

    await expect(service.delete('g1')).rejects.toThrow('Cannot delete: group is in use');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest src/classes/directions.service.spec.ts src/classes/class-groups.service.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement `src/classes/directions.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { kyivToday } from '../tariffs/dates';
import { directionInclude, toDirectionView } from './class-views';
import { CreateDirectionDto } from './dto/create-direction.dto';
import { UpdateDirectionDto } from './dto/update-direction.dto';

@Injectable()
export class DirectionsService {
  constructor(private prisma: PrismaService) {}

  async list(today: Date = kyivToday()) {
    const directions = await this.prisma.direction.findMany({ include: directionInclude, orderBy: { name: 'asc' } });
    return directions.map((d) => toDirectionView(d, today));
  }

  private async get(id: string) {
    const direction = await this.prisma.direction.findUnique({ where: { id } });
    if (!direction) throw new NotFoundException('Direction not found');
    return direction;
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.direction.findUnique({ where: { name } });
    if (existing) throw new BadRequestException('Direction with this name already exists');
  }

  async create(dto: CreateDirectionDto) {
    await this.assertNameFree(dto.name);
    await this.prisma.direction.create({ data: { name: dto.name, missedRule: dto.missedRule } });
    return this.list();
  }

  async update(id: string, dto: UpdateDirectionDto) {
    const direction = await this.get(id);
    if (dto.name !== undefined && dto.name !== direction.name) await this.assertNameFree(dto.name);
    await this.prisma.direction.update({
      where: { id },
      data: { name: dto.name, missedRule: dto.missedRule, isActive: dto.isActive },
    });
    return this.list();
  }

  async delete(id: string) {
    await this.get(id);
    const [groups, packages] = await Promise.all([
      this.prisma.classGroup.count({ where: { directionId: id } }),
      this.prisma.package.count({ where: { directionId: id } }),
    ]);
    if (groups + packages > 0) throw new BadRequestException('Cannot delete: direction is in use');
    await this.prisma.direction.delete({ where: { id } });
    return this.list();
  }
}
```

- [ ] **Step 6: Implement `src/classes/class-groups.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { kyivToday, overlaps, toDay } from '../tariffs/dates';
import { assertGroupAccess } from './access';
import { groupDetailInclude, groupSummaryInclude, toGroupDetail, toGroupSummary } from './class-views';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateClassGroupDto } from './dto/create-class-group.dto';
import { EndMemberDto } from './dto/end-member.dto';
import { UpdateClassGroupDto } from './dto/update-class-group.dto';

@Injectable()
export class ClassGroupsService {
  constructor(private prisma: PrismaService) {}

  private async assertTeachers(ids: string[]) {
    if (ids.length === 0) return;
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } });
    if (users.length !== new Set(ids).size || users.some((u) => u.role !== Role.teacher)) {
      throw new BadRequestException('Invalid teachers');
    }
  }

  private async assertTariff(id: string | null | undefined, unit: TariffUnit, message: string) {
    if (!id) return;
    const tariff = await this.prisma.tariff.findUnique({ where: { id } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.unit !== unit) throw new BadRequestException(message);
  }

  private async assertNameFree(directionId: string, name: string, exceptId?: string) {
    const existing = await this.prisma.classGroup.findFirst({
      where: { directionId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (existing) throw new BadRequestException('Class group with this name already exists in the direction');
  }

  private async load(id: string) {
    const group = await this.prisma.classGroup.findUnique({ where: { id }, include: groupDetailInclude });
    if (!group) throw new NotFoundException('Class group not found');
    return group;
  }

  async create(dto: CreateClassGroupDto) {
    const direction = await this.prisma.direction.findUnique({ where: { id: dto.directionId } });
    if (!direction) throw new NotFoundException('Direction not found');
    await this.assertNameFree(dto.directionId, dto.name);
    await this.assertTeachers(dto.teacherIds);
    await this.assertTariff(dto.singleTariffId, TariffUnit.session, 'Tariff unit must be session');
    await this.assertTariff(dto.packageTariffId, TariffUnit.package, 'Tariff unit must be package');

    const group = await this.prisma.classGroup.create({
      data: {
        name: dto.name,
        directionId: dto.directionId,
        format: dto.format,
        singleTariffId: dto.singleTariffId ?? null,
        packageTariffId: dto.packageTariffId ?? null,
        teachers: { connect: dto.teacherIds.map((id) => ({ id })) },
      },
    });
    return toGroupDetail(await this.load(group.id), kyivToday());
  }

  async update(id: string, dto: UpdateClassGroupDto) {
    const group = await this.load(id);
    if (dto.name !== undefined && dto.name !== group.name) await this.assertNameFree(group.directionId, dto.name, id);
    if (dto.teacherIds) await this.assertTeachers(dto.teacherIds);
    await this.assertTariff(dto.singleTariffId, TariffUnit.session, 'Tariff unit must be session');
    await this.assertTariff(dto.packageTariffId, TariffUnit.package, 'Tariff unit must be package');

    await this.prisma.classGroup.update({
      where: { id },
      data: {
        name: dto.name,
        format: dto.format,
        isActive: dto.isActive,
        singleTariffId: dto.singleTariffId,
        packageTariffId: dto.packageTariffId,
        teachers: dto.teacherIds ? { set: dto.teacherIds.map((tid) => ({ id: tid })) } : undefined,
      },
    });
    return toGroupDetail(await this.load(id), kyivToday());
  }

  async delete(id: string) {
    await this.load(id);
    const lessons = await this.prisma.lesson.count({ where: { classGroupId: id } });
    if (lessons > 0) throw new BadRequestException('Cannot delete: group is in use');
    await this.prisma.$transaction([
      this.prisma.classGroupMember.deleteMany({ where: { classGroupId: id } }),
      this.prisma.classGroup.delete({ where: { id } }),
    ]);
    return { message: 'Class group deleted' };
  }

  async get(id: string, user: AuthenticatedUser, today: Date = kyivToday()) {
    const group = await this.load(id);
    assertGroupAccess(group, user);
    return toGroupDetail(group, today);
  }

  async myGroups(user: AuthenticatedUser, today: Date = kyivToday()) {
    const groups = await this.prisma.classGroup.findMany({
      where: { isActive: true, teachers: { some: { id: user.id } } },
      include: { ...groupSummaryInclude, direction: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => ({ ...toGroupSummary(g, today), direction: g.direction }));
  }

  async addMember(groupId: string, dto: AddMemberDto, userId: string) {
    await this.load(groupId);
    const child = await this.prisma.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw new NotFoundException('Child not found');
    const startDate = toDay(dto.startDate);
    const existing = await this.prisma.classGroupMember.findMany({ where: { classGroupId: groupId, childId: dto.childId } });
    if (existing.some((m) => overlaps(startDate, null, m.startDate, m.endDate))) {
      throw new BadRequestException('Child is already a member of this group');
    }
    await this.prisma.classGroupMember.create({
      data: { classGroupId: groupId, childId: dto.childId, startDate, createdById: userId },
    });
    return toGroupDetail(await this.load(groupId), kyivToday());
  }

  async endMember(memberId: string, dto: EndMemberDto) {
    const member = await this.prisma.classGroupMember.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member not found');
    const endDate = toDay(dto.endDate);
    if (endDate.getTime() < member.startDate.getTime()) {
      throw new BadRequestException('End date must not be before start date');
    }
    await this.prisma.classGroupMember.update({ where: { id: memberId }, data: { endDate } });
    return toGroupDetail(await this.load(member.classGroupId), kyivToday());
  }
}
```

- [ ] **Step 7: Run tests and build**

Run: `npx jest src/classes` then `npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 8: Commit**

```bash
npx eslint --fix src/classes
git add src/classes
git commit -m "feat: add directions and class groups"
```

---

### Task 4: Packages (purchase, extend, void) and tariff validity days

**Files:**
- Create: `src/classes/dto/purchase-package.dto.ts`, `extend-package.dto.ts`
- Create: `src/classes/packages.service.ts`
- Test: `src/classes/packages.service.spec.ts`
- Modify: `src/tariffs/dto/create-tariff.dto.ts`, `src/tariffs/dto/update-tariff.dto.ts`, `src/tariffs/tariffs.service.ts`, `src/tariffs/tariffs.service.spec.ts`

**Interfaces:**
- Consumes: consumption (Task 2); `priceOn` (`src/tariffs/billing-engine.ts`); `voidChargeInTx` (`src/finance/void-charge.ts`); `formatMoney` (finance-calc); `kyivToday`, `toDay`, `uaDay`.
- Produces:
  - `packageInclude`, `toPackageView(p, today)` exported from `packages.service.ts`.
  - `PackageView = { id, direction: { id, name }, tariff: { id, name } | null, sessionsTotal, used, remaining, purchaseDate, expiresAt, state, chargeId, needsReconciliation, reconciledAt, reconciliationNote, legacyTotalPrice: string | null, voidedAt, voidReason, extensions: { id, previousExpiresAt, newExpiresAt, reason, createdAt }[], usages: { id, date, groupName, status, voidedAt }[], legacyAttendances: { id, date, note }[] }`
  - `PackagesService.listForChild(childId, today?)`, `purchase(childId, dto, userId)`, `extend(id, dto, userId)`, `void(id, reason, userId)` — each returns `PackageView[]` for the child.
  - Tariff view gains `validityDays: number | null`; `CreateTariffDto.validityDays?: number`, `UpdateTariffDto.validityDays?: number | null`.

- [ ] **Step 1: Tariff validity days**

In `CreateTariffDto` add:

```ts
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  validityDays?: number;
```

In `UpdateTariffDto` add (import `IsInt, Max, Min`):

```ts
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  validityDays?: number | null;
```

In `tariffs.service.ts`: in `toTariffView` add `validityDays: tariff.validityDays,` after `packageSize`; in `create` data add `validityDays: dto.unit === TariffUnit.package ? (dto.validityDays ?? null) : null,` after `packageSize`; in `update` data add `validityDays: dto.validityDays,`; in `delete` extend the counts:

```ts
    const [enrollments, visits, packages, groups] = await Promise.all([
      this.prisma.enrollment.count({ where: { tariffId: id } }),
      this.prisma.adaptationVisit.count({ where: { tariffId: id } }),
      this.prisma.package.count({ where: { tariffId: id } }),
      this.prisma.classGroup.count({ where: { OR: [{ singleTariffId: id }, { packageTariffId: id }] } }),
    ]);
    if (enrollments + visits + packages + groups > 0)
      throw new BadRequestException('Cannot delete: tariff is in use');
```

In `tariffs.service.spec.ts`: add `validityDays: null` to the `tariff()` fixture; in the "creates a tariff" expectation add `validityDays: null,` after `packageSize: null,`; add `package: { count: jest.fn() }` and `classGroup: { count: jest.fn() }` to `mockPrisma`; in both delete tests add `mockPrisma.package.count.mockResolvedValue(0); mockPrisma.classGroup.count.mockResolvedValue(0);` before the call. Run `npx jest src/tariffs` — PASS.

- [ ] **Step 2: DTOs**

`purchase-package.dto.ts`:

```ts
import { IsDateString, IsUUID } from 'class-validator';

export class PurchasePackageDto {
  @IsUUID('4')
  directionId: string;

  @IsUUID('4')
  tariffId: string;

  @IsDateString()
  purchaseDate: string;
}
```

`extend-package.dto.ts`:

```ts
import { IsDateString, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class ExtendPackageDto {
  @IsDateString()
  newExpiresAt: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
```

- [ ] **Step 3: Write the failing tests**

`src/classes/packages.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ChargeSource, FinanceCategory, Prisma, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PackagesService } from './packages.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  child: { findUnique: jest.fn() },
  direction: { findUnique: jest.fn() },
  tariff: { findUnique: jest.fn() },
  package: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  packageExtension: { create: jest.fn() },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

const tariff = (over: Record<string, unknown> = {}) => ({
  id: 'tp',
  name: 'LEGO пакет 4',
  category: FinanceCategory.extra_classes,
  unit: TariffUnit.package,
  packageSize: 4,
  validityDays: 30,
  isActive: true,
  prices: [{ price: d('1000'), effectiveFrom: day('2026-01-01') }],
  ...over,
});

const pkgRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  childId: 'child-1',
  chargeId: 'c1',
  expiresAt: day('2026-10-30'),
  voidedAt: null,
  extensions: [],
  usages: [],
  ...over,
});

describe('PackagesService', () => {
  let service: PackagesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1', name: 'LEGO' });
    mockPrisma.package.findMany.mockResolvedValue([]);
    mockPrisma.charge.create.mockResolvedValue({ id: 'c-new' });
    const module = await Test.createTestingModule({
      providers: [PackagesService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(PackagesService);
  });

  describe('purchase', () => {
    const dto = { directionId: 'd1', tariffId: 'tp', purchaseDate: '2026-10-01' };

    it('creates a charge and a package with expiry', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

      await service.purchase('child-1', dto, 'u1');

      const charge = firstArg<{ data: Record<string, unknown> & { amount: Prisma.Decimal } }>(mockPrisma.charge.create);
      expect(charge.data).toMatchObject({
        childId: 'child-1',
        category: FinanceCategory.extra_classes,
        description: 'LEGO пакет 4 (LEGO), 01.10.2026',
        sourceType: ChargeSource.extra_package,
        createdById: 'u1',
      });
      expect(charge.data.amount.toFixed(2)).toBe('1000.00');
      const created = firstArg<{ data: Record<string, unknown> }>(mockPrisma.package.create);
      expect(created.data).toMatchObject({
        childId: 'child-1',
        directionId: 'd1',
        tariffId: 'tp',
        sessionsTotal: 4,
        purchaseDate: day('2026-10-01'),
        expiresAt: day('2026-10-30'),
        chargeId: 'c-new',
        createdById: 'u1',
        id: charge.data.sourceId,
      });
    });

    it.each([
      [{ unit: TariffUnit.session }, 'Tariff unit must be package'],
      [{ isActive: false }, 'Tariff is not active'],
      [{ prices: [] }, 'No price for this date'],
    ] as [Record<string, unknown>, string][])('rejects tariff %p', async (over, message) => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff(over));

      await expect(service.purchase('child-1', dto, 'u1')).rejects.toThrow(message);
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    });
  });

  describe('extend', () => {
    it('rejects a date that is not after the current expiry', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow());

      await expect(service.extend('p1', { newExpiresAt: '2026-10-30', reason: 'sick' }, 'u1')).rejects.toThrow(
        'New expiry must be after the current expiry',
      );
    });

    it('records the previous expiry', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow());

      await service.extend('p1', { newExpiresAt: '2026-11-15', reason: 'sick' }, 'u1');

      expect(mockPrisma.packageExtension.create).toHaveBeenCalledWith({
        data: {
          packageId: 'p1',
          previousExpiresAt: day('2026-10-30'),
          newExpiresAt: day('2026-11-15'),
          reason: 'sick',
          createdById: 'u1',
        },
      });
    });
  });

  describe('void', () => {
    it('refuses to void a package with used sessions', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow({ usages: [{ voidedAt: null }] }));

      await expect(service.void('p1', 'mistake', 'u1')).rejects.toThrow('Package has used sessions');
    });

    it('voids the package and its charge', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow({ usages: [{ voidedAt: new Date() }] }));
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'c1', voidedAt: null });

      await service.void('p1', 'mistake', 'u1');

      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { voidedAt: expect.any(Date) as Date, voidedById: 'u1', voidReason: 'mistake' },
      });
      expect(mockPrisma.package.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { voidedAt: expect.any(Date) as Date, voidedById: 'u1', voidReason: 'mistake' },
      });
    });

    it('rejects voiding twice', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(pkgRow({ voidedAt: new Date() }));

      await expect(service.void('p1', 'x', 'u1')).rejects.toThrow('Package is voided');
    });
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest src/classes/packages.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `src/classes/packages.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeSource, Prisma, TariffUnit } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { formatMoney } from '../finance/finance-calc';
import { voidChargeInTx } from '../finance/void-charge';
import { priceOn } from '../tariffs/billing-engine';
import { kyivToday, toDay, uaDay } from '../tariffs/dates';
import { effectiveExpiry, expiresAtFor, packageRemaining, packageState } from './consumption';
import { ExtendPackageDto } from './dto/extend-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';

export const packageInclude = {
  direction: { select: { id: true, name: true } },
  tariff: { select: { id: true, name: true } },
  extensions: { orderBy: { createdAt: 'asc' } },
  usages: {
    include: { attendance: { include: { lesson: { include: { classGroup: { select: { name: true } } } } } } },
    orderBy: { createdAt: 'desc' },
  },
  legacySubscription: { select: { totalPrice: true, attendances: { orderBy: { date: 'desc' } } } },
} satisfies Prisma.PackageInclude;

type LoadedPackage = Prisma.PackageGetPayload<{ include: typeof packageInclude }>;

export const toPackageView = (p: LoadedPackage, today: Date) => {
  const remaining = packageRemaining(p);
  return {
    id: p.id,
    direction: p.direction,
    tariff: p.tariff,
    sessionsTotal: p.sessionsTotal,
    used: p.sessionsTotal - remaining,
    remaining,
    purchaseDate: p.purchaseDate,
    expiresAt: effectiveExpiry(p),
    state: packageState(p, today),
    chargeId: p.chargeId,
    needsReconciliation: p.needsReconciliation,
    reconciledAt: p.reconciledAt,
    reconciliationNote: p.reconciliationNote,
    legacyTotalPrice: p.legacySubscription ? formatMoney(p.legacySubscription.totalPrice) : null,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    extensions: p.extensions.map((e) => ({
      id: e.id,
      previousExpiresAt: e.previousExpiresAt,
      newExpiresAt: e.newExpiresAt,
      reason: e.reason,
      createdAt: e.createdAt,
    })),
    usages: p.usages.map((u) => ({
      id: u.id,
      date: u.attendance.lesson.date,
      groupName: u.attendance.lesson.classGroup.name,
      status: u.attendance.status,
      voidedAt: u.voidedAt,
    })),
    legacyAttendances: (p.legacySubscription?.attendances ?? []).map((a) => ({ id: a.id, date: a.date, note: a.note })),
  };
};

@Injectable()
export class PackagesService {
  constructor(private prisma: PrismaService) {}

  async listForChild(childId: string, today: Date = kyivToday()) {
    const child = await this.prisma.child.findUnique({ where: { id: childId } });
    if (!child) throw new NotFoundException('Child not found');
    const packages = await this.prisma.package.findMany({
      where: { childId },
      include: packageInclude,
      orderBy: { purchaseDate: 'desc' },
    });
    return packages.map((p) => toPackageView(p, today));
  }

  async purchase(childId: string, dto: PurchasePackageDto, userId: string) {
    const child = await this.prisma.child.findUnique({ where: { id: childId } });
    if (!child) throw new NotFoundException('Child not found');
    const direction = await this.prisma.direction.findUnique({ where: { id: dto.directionId } });
    if (!direction) throw new NotFoundException('Direction not found');
    const tariff = await this.prisma.tariff.findUnique({ where: { id: dto.tariffId }, include: { prices: true } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.unit !== TariffUnit.package) throw new BadRequestException('Tariff unit must be package');
    if (!tariff.isActive) throw new BadRequestException('Tariff is not active');

    const purchaseDate = toDay(dto.purchaseDate);
    const price = priceOn(tariff.prices, purchaseDate);
    if (!price) throw new BadRequestException('No price for this date');

    const packageId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const charge = await tx.charge.create({
        data: {
          childId,
          category: tariff.category,
          amount: price,
          description: `${tariff.name} (${direction.name}), ${uaDay(purchaseDate)}`,
          periodStart: purchaseDate,
          periodEnd: purchaseDate,
          sourceType: ChargeSource.extra_package,
          sourceId: packageId,
          createdById: userId,
        },
      });
      await tx.package.create({
        data: {
          id: packageId,
          childId,
          directionId: direction.id,
          tariffId: tariff.id,
          sessionsTotal: tariff.packageSize ?? 1,
          purchaseDate,
          expiresAt: expiresAtFor(purchaseDate, tariff.validityDays),
          chargeId: charge.id,
          createdById: userId,
        },
      });
    });
    return this.listForChild(childId);
  }

  async extend(id: string, dto: ExtendPackageDto, userId: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id }, include: { extensions: true, usages: true } });
    if (!pkg) throw new NotFoundException('Package not found');
    if (pkg.voidedAt) throw new BadRequestException('Package is voided');

    const current = effectiveExpiry(pkg);
    const newExpiresAt = toDay(dto.newExpiresAt);
    if (current && newExpiresAt.getTime() <= current.getTime()) {
      throw new BadRequestException('New expiry must be after the current expiry');
    }
    await this.prisma.packageExtension.create({
      data: { packageId: id, previousExpiresAt: current, newExpiresAt, reason: dto.reason, createdById: userId },
    });
    return this.listForChild(pkg.childId);
  }

  async void(id: string, reason: string, userId: string) {
    const childId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${id} FOR UPDATE`;
      const pkg = await tx.package.findUnique({ where: { id }, include: { usages: true } });
      if (!pkg) throw new NotFoundException('Package not found');
      if (pkg.voidedAt) throw new BadRequestException('Package is voided');
      if (pkg.usages.some((u) => !u.voidedAt)) throw new BadRequestException('Package has used sessions');

      if (pkg.chargeId) {
        const charge = await tx.charge.findUnique({ where: { id: pkg.chargeId } });
        if (charge && !charge.voidedAt) await voidChargeInTx(tx, pkg.chargeId, reason, userId);
      }
      await tx.package.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
      });
      return pkg.childId;
    });
    return this.listForChild(childId);
  }
}
```

Note: `extend` loads `extensions` and `usages` without a `select`, so the objects carry all fields; `effectiveExpiry` only reads `newExpiresAt`/`createdAt`/`expiresAt`. If `PackageLike` typing complains about missing fields, pass the loaded object — it has all scalar fields of `Package`.

- [ ] **Step 6: Run tests and build**

Run: `npx jest src/classes src/tariffs` then `npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 7: Commit**

```bash
npx eslint --fix src/classes src/tariffs
git add src/classes src/tariffs
git commit -m "feat: add session packages and tariff validity days"
```

---

### Task 5: Lesson roster, marking and corrections

**Files:**
- Create: `src/classes/dto/mark-lesson.dto.ts`
- Create: `src/classes/lessons.service.ts`
- Test: `src/classes/lessons.service.spec.ts`

**Interfaces:**
- Consumes: `shouldConsume`, `pickPackage`, `packageRemaining`, `effectiveExpiry` (Task 2); `assertGroupAccess`, `parseDay` (Task 3); `personSelect`; `priceOn`; `voidChargeInTx`; `kyivToday`, `uaDay`.
- Produces:
  - `MarkLessonDto { marks: MarkItemDto[]; reason?: string }`, `MarkItemDto { childId: string; status: AttendanceStatus; isGuest?: boolean }`
  - `LessonsService.getRoster(groupId: string, date: string, user: AuthenticatedUser): Promise<LessonRoster>`
  - `LessonsService.mark(groupId: string, date: string, dto: MarkLessonDto, user: AuthenticatedUser, today?: Date): Promise<{ lessonId: string }>`
  - `LessonRoster = { group: { id, name, direction: { id, name, missedRule } }, date, lessonId: string | null, conductedBy: PersonRef | null, rows: { child: PersonRef, isMember: boolean, attendance: { id, status, isGuest } | null, packageInfo: { packageId, remaining, total, expiresAt } | null }[] }`

- [ ] **Step 1: DTO**

`src/classes/dto/mark-lesson.dto.ts`:

```ts
import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MarkItemDto {
  @IsUUID('4')
  childId: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsBoolean()
  @IsOptional()
  isGuest?: boolean;
}

export class MarkLessonDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarkItemDto)
  marks: MarkItemDto[];

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}
```

- [ ] **Step 2: Write the failing tests**

`src/classes/lessons.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import {
  AttendanceStatus,
  ChargeSource,
  FinanceCategory,
  MissedLessonRule,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LessonsService } from './lessons.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);
const TODAY = day('2026-10-11');

const admin = { id: 'u1', role: Role.admin, login: 'admin' };
const teacher = { id: 't1', role: Role.teacher, login: 'teacher' };

const mockPrisma = {
  classGroup: { findUnique: jest.fn() },
  lesson: { upsert: jest.fn(), findUnique: jest.fn() },
  lessonAttendance: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  classGroupMember: { findMany: jest.fn() },
  package: { findMany: jest.fn() },
  sessionUsage: { create: jest.fn(), update: jest.fn() },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'LEGO 1',
  directionId: 'd1',
  direction: { id: 'd1', name: 'LEGO', missedRule: MissedLessonRule.unexcused_only },
  teachers: [{ id: 't1' }],
  singleTariff: {
    id: 'ts',
    name: 'LEGO разове',
    category: FinanceCategory.extra_classes,
    prices: [{ price: d('300'), effectiveFrom: day('2026-01-01') }],
  },
  ...over,
});

const packageRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  sessionsTotal: 4,
  usedBefore: 0,
  purchaseDate: day('2026-10-01'),
  expiresAt: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  voidedAt: null,
  needsReconciliation: false,
  extensions: [],
  usages: [],
  ...over,
});

const mark = (status: AttendanceStatus, childId = 'c1') => ({ marks: [{ childId, status }] });

describe('LessonsService.mark', () => {
  let service: LessonsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
    mockPrisma.classGroup.findUnique.mockResolvedValue(group());
    mockPrisma.lesson.upsert.mockResolvedValue({ id: 'l1' });
    mockPrisma.lessonAttendance.findMany.mockResolvedValue([]);
    mockPrisma.lessonAttendance.create.mockResolvedValue({ id: 'a-new' });
    mockPrisma.classGroupMember.findMany.mockResolvedValue([{ childId: 'c1' }]);
    mockPrisma.package.findMany.mockResolvedValue([packageRow()]);
    mockPrisma.charge.create.mockResolvedValue({ id: 'ch-new' });
    const module = await Test.createTestingModule({
      providers: [LessonsService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(LessonsService);
  });

  it('forbids a teacher of another group', async () => {
    await expect(
      service.mark('g1', '2026-10-11', mark(AttendanceStatus.present), { ...teacher, id: 't2' }, TODAY),
    ).rejects.toThrow('Not your class group');
  });

  it('rejects a future date and an invalid date', async () => {
    await expect(service.mark('g1', '2026-10-12', mark(AttendanceStatus.present), admin, TODAY)).rejects.toThrow(
      'Lesson date must not be in the future',
    );
    await expect(service.mark('g1', '2026-13-01', mark(AttendanceStatus.present), admin, TODAY)).rejects.toThrow(
      'Invalid date',
    );
  });

  it('rejects duplicate children', async () => {
    const dto = { marks: [{ childId: 'c1', status: AttendanceStatus.present }, { childId: 'c1', status: AttendanceStatus.present }] };

    await expect(service.mark('g1', '2026-10-11', dto, admin, TODAY)).rejects.toThrow('Duplicate child in marks');
  });

  it('rejects a non-member who is not marked as guest', async () => {
    await expect(
      service.mark('g1', '2026-10-11', mark(AttendanceStatus.present, 'c9'), admin, TODAY),
    ).rejects.toThrow('Child is not a member of this group on this date');
  });

  it('consumes a package session for a present member after locking', async () => {
    await service.mark('g1', '2026-10-11', mark(AttendanceStatus.present), teacher, TODAY);

    expect(firstArg<{ data: Record<string, unknown> }>(mockPrisma.lessonAttendance.create).data).toMatchObject({
      lessonId: 'l1',
      childId: 'c1',
      status: AttendanceStatus.present,
      isGuest: false,
      markedById: 't1',
    });
    expect(mockPrisma.sessionUsage.create).toHaveBeenCalledWith({ data: { attendanceId: 'a-new', packageId: 'p1' } });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.lessonAttendance.findMany.mock.invocationCallOrder[0],
    );
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      mockPrisma.package.findMany.mock.invocationCallOrder[0],
    );
  });

  it('charges a single lesson when no package is usable', async () => {
    mockPrisma.package.findMany.mockResolvedValue([]);

    await service.mark('g1', '2026-10-11', mark(AttendanceStatus.present), admin, TODAY);

    const charge = firstArg<{ data: Record<string, unknown> & { amount: Prisma.Decimal } }>(mockPrisma.charge.create);
    expect(charge.data).toMatchObject({
      childId: 'c1',
      category: FinanceCategory.extra_classes,
      description: 'LEGO 1, 11.10.2026: разове заняття',
      periodStart: TODAY,
      periodEnd: TODAY,
      sourceType: ChargeSource.extra_session,
      sourceId: 'a-new',
      createdById: 'u1',
    });
    expect(charge.data.amount.toFixed(2)).toBe('300.00');
    expect(mockPrisma.sessionUsage.create).toHaveBeenCalledWith({ data: { attendanceId: 'a-new', chargeId: 'ch-new' } });
  });

  it('does not consume an excused absence under unexcused_only', async () => {
    await service.mark('g1', '2026-10-11', mark(AttendanceStatus.absent_excused), admin, TODAY);

    expect(mockPrisma.lessonAttendance.create).toHaveBeenCalled();
    expect(mockPrisma.sessionUsage.create).not.toHaveBeenCalled();
  });

  it('fails without a single-lesson price', async () => {
    mockPrisma.package.findMany.mockResolvedValue([]);
    mockPrisma.classGroup.findUnique.mockResolvedValue(group({ singleTariff: null }));

    await expect(service.mark('g1', '2026-10-11', mark(AttendanceStatus.present), admin, TODAY)).rejects.toThrow(
      'No price for this date',
    );
  });

  describe('corrections', () => {
    const existing = (over: Record<string, unknown> = {}) => ({
      id: 'a-old',
      childId: 'c1',
      status: AttendanceStatus.present,
      isGuest: false,
      usage: { id: 'u-old', packageId: 'p1', chargeId: null, voidedAt: null },
      ...over,
    });

    it('skips an unchanged status', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await service.mark('g1', '2026-10-11', mark(AttendanceStatus.present), admin, TODAY);

      expect(mockPrisma.lessonAttendance.create).not.toHaveBeenCalled();
    });

    it('returns the session to the package when corrected to excused', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await service.mark('g1', '2026-10-11', mark(AttendanceStatus.absent_excused), teacher, TODAY);

      const voided = { voidedAt: expect.any(Date) as Date, voidedById: 't1', voidReason: 'Виправлення відмітки' };
      expect(mockPrisma.sessionUsage.update).toHaveBeenCalledWith({ where: { id: 'u-old' }, data: voided });
      expect(mockPrisma.lessonAttendance.update).toHaveBeenCalledWith({ where: { id: 'a-old' }, data: voided });
      expect(mockPrisma.sessionUsage.create).not.toHaveBeenCalled();
    });

    it('voids a single-lesson charge on correction', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([
        existing({ usage: { id: 'u-old', packageId: null, chargeId: 'ch-old', voidedAt: null } }),
      ]);
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'ch-old', voidedAt: null });

      await service.mark('g1', '2026-10-11', mark(AttendanceStatus.absent_excused), admin, TODAY);

      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'ch-old' },
        data: { voidedAt: expect.any(Date) as Date, voidedById: 'u1', voidReason: 'Виправлення відмітки' },
      });
    });

    it('forbids a teacher from correcting a past lesson', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await expect(
        service.mark('g1', '2026-10-10', mark(AttendanceStatus.absent_excused), teacher, TODAY),
      ).rejects.toThrow('Only the lesson day can be corrected by a teacher');
    });

    it('requires a reason for a late admin correction', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await expect(
        service.mark('g1', '2026-10-10', mark(AttendanceStatus.absent_excused), admin, TODAY),
      ).rejects.toThrow('Reason is required for a late correction');
      await expect(
        service.mark('g1', '2026-10-10', { ...mark(AttendanceStatus.absent_excused), reason: 'mistake' }, admin, TODAY),
      ).resolves.toEqual({ lessonId: 'l1' });
    });
  });
});

describe('LessonsService.getRoster', () => {
  let service: LessonsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [LessonsService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(LessonsService);
  });

  it('lists members and guests with package info', async () => {
    mockPrisma.classGroup.findUnique.mockResolvedValue({
      id: 'g1',
      name: 'LEGO 1',
      directionId: 'd1',
      direction: { id: 'd1', name: 'LEGO', missedRule: MissedLessonRule.no_charge },
      teachers: [{ id: 't1' }],
    });
    mockPrisma.lesson.findUnique.mockResolvedValue({
      id: 'l1',
      conductedBy: { id: 't1', firstName: 'Olha', lastName: 'Teacher' },
      attendances: [
        { id: 'a2', childId: 'c2', status: AttendanceStatus.present, isGuest: true, child: { id: 'c2', firstName: 'Bob', lastName: 'Bee' } },
      ],
    });
    mockPrisma.classGroupMember.findMany.mockResolvedValue([
      { childId: 'c1', child: { id: 'c1', firstName: 'Ann', lastName: 'Ant' } },
    ]);
    mockPrisma.package.findMany.mockResolvedValue([{ ...packageRow(), childId: 'c1', usages: [{ voidedAt: null }] }]);

    const roster = await service.getRoster('g1', '2026-10-11', admin);

    expect(roster.lessonId).toBe('l1');
    expect(roster.rows).toEqual([
      {
        child: { id: 'c1', firstName: 'Ann', lastName: 'Ant' },
        isMember: true,
        attendance: null,
        packageInfo: { packageId: 'p1', remaining: 3, total: 4, expiresAt: null },
      },
      {
        child: { id: 'c2', firstName: 'Bob', lastName: 'Bee' },
        isMember: false,
        attendance: { id: 'a2', status: AttendanceStatus.present, isGuest: true },
        packageInfo: null,
      },
    ]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest src/classes/lessons.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/classes/lessons.service.ts`**

```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeSource, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { voidChargeInTx } from '../finance/void-charge';
import { priceOn } from '../tariffs/billing-engine';
import { kyivToday, uaDay } from '../tariffs/dates';
import { assertGroupAccess, parseDay } from './access';
import { personSelect } from './class-views';
import { effectiveExpiry, packageRemaining, pickPackage, shouldConsume } from './consumption';
import { MarkLessonDto } from './dto/mark-lesson.dto';

const packageConsumeInclude = {
  extensions: { select: { newExpiresAt: true, createdAt: true } },
  usages: { select: { voidedAt: true } },
} satisfies Prisma.PackageInclude;

const markGroupInclude = {
  direction: true,
  teachers: { select: { id: true } },
  singleTariff: { include: { prices: true } },
} satisfies Prisma.ClassGroupInclude;

type MarkGroup = Prisma.ClassGroupGetPayload<{ include: typeof markGroupInclude }>;
type ActiveAttendance = Prisma.LessonAttendanceGetPayload<{ include: { usage: true } }>;

const memberOnDate = (classGroupId: string, date: Date) => ({
  classGroupId,
  startDate: { lte: date },
  OR: [{ endDate: null }, { endDate: { gte: date } }],
});

@Injectable()
export class LessonsService {
  constructor(private prisma: PrismaService) {}

  async getRoster(groupId: string, dateValue: string, user: AuthenticatedUser) {
    const group = await this.prisma.classGroup.findUnique({
      where: { id: groupId },
      include: { direction: true, teachers: { select: { id: true } } },
    });
    if (!group) throw new NotFoundException('Class group not found');
    assertGroupAccess(group, user);
    const date = parseDay(dateValue);

    const lesson = await this.prisma.lesson.findUnique({
      where: { classGroupId_date: { classGroupId: groupId, date } },
      include: {
        conductedBy: personSelect,
        attendances: { where: { voidedAt: null }, include: { child: personSelect } },
      },
    });
    const members = await this.prisma.classGroupMember.findMany({
      where: memberOnDate(groupId, date),
      include: { child: personSelect },
    });

    const children = new Map<string, { id: string; firstName: string; lastName: string }>();
    members.forEach((m) => children.set(m.childId, m.child));
    lesson?.attendances.forEach((a) => children.set(a.childId, a.child));
    const memberIds = new Set(members.map((m) => m.childId));

    const packages = await this.prisma.package.findMany({
      where: { childId: { in: [...children.keys()] }, directionId: group.directionId },
      include: packageConsumeInclude,
    });

    const rows = [...children.values()]
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'uk'))
      .map((child) => {
        const attendance = lesson?.attendances.find((a) => a.childId === child.id) ?? null;
        const pkg = pickPackage(packages.filter((p) => p.childId === child.id), date);
        return {
          child,
          isMember: memberIds.has(child.id),
          attendance: attendance ? { id: attendance.id, status: attendance.status, isGuest: attendance.isGuest } : null,
          packageInfo: pkg
            ? { packageId: pkg.id, remaining: packageRemaining(pkg), total: pkg.sessionsTotal, expiresAt: effectiveExpiry(pkg) }
            : null,
        };
      });

    return {
      group: { id: group.id, name: group.name, direction: { id: group.direction.id, name: group.direction.name, missedRule: group.direction.missedRule } },
      date,
      lessonId: lesson?.id ?? null,
      conductedBy: lesson?.conductedBy ?? null,
      rows,
    };
  }

  async mark(
    groupId: string,
    dateValue: string,
    dto: MarkLessonDto,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.prisma.classGroup.findUnique({ where: { id: groupId }, include: markGroupInclude });
    if (!group) throw new NotFoundException('Class group not found');
    assertGroupAccess(group, user);
    const date = parseDay(dateValue);
    if (date.getTime() > today.getTime()) throw new BadRequestException('Lesson date must not be in the future');
    const ids = dto.marks.map((m) => m.childId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate child in marks');

    const isTeacher = user.role === Role.teacher;
    const isLate = date.getTime() < today.getTime();
    const reason = dto.reason?.trim() ?? '';

    return this.prisma.$transaction(async (tx) => {
      const lesson = await tx.lesson.upsert({
        where: { classGroupId_date: { classGroupId: groupId, date } },
        create: { classGroupId: groupId, date, conductedById: user.id },
        update: {},
      });
      await tx.$queryRaw`SELECT id FROM "Lesson" WHERE id = ${lesson.id} FOR UPDATE`;
      const active = await tx.lessonAttendance.findMany({
        where: { lessonId: lesson.id, voidedAt: null },
        include: { usage: true },
      });
      const members = await tx.classGroupMember.findMany({ where: memberOnDate(groupId, date) });
      const memberIds = new Set(members.map((m) => m.childId));

      for (const item of dto.marks) {
        const existing = active.find((a) => a.childId === item.childId);
        if (existing && existing.status === item.status) continue;
        const isMember = memberIds.has(item.childId);
        if (!existing && !isMember && !item.isGuest) {
          throw new BadRequestException('Child is not a member of this group on this date');
        }
        if (existing) {
          if (isTeacher && isLate) throw new ForbiddenException('Only the lesson day can be corrected by a teacher');
          if (!isTeacher && isLate && !reason) throw new BadRequestException('Reason is required for a late correction');
          await this.reverse(tx, existing, reason || 'Виправлення відмітки', user.id);
        }
        const attendance = await tx.lessonAttendance.create({
          data: {
            lessonId: lesson.id,
            childId: item.childId,
            status: item.status,
            isGuest: existing ? existing.isGuest : !isMember,
            markedById: user.id,
          },
        });
        if (shouldConsume(group.direction.missedRule, item.status)) {
          await this.consume(tx, group, attendance.id, item.childId, date, user.id);
        }
      }
      return { lessonId: lesson.id };
    });
  }

  private async reverse(tx: Prisma.TransactionClient, attendance: ActiveAttendance, reason: string, userId: string) {
    const data = { voidedAt: new Date(), voidedById: userId, voidReason: reason };
    if (attendance.usage && !attendance.usage.voidedAt) {
      if (attendance.usage.chargeId) {
        const charge = await tx.charge.findUnique({ where: { id: attendance.usage.chargeId } });
        if (charge && !charge.voidedAt) await voidChargeInTx(tx, attendance.usage.chargeId, reason, userId);
      }
      await tx.sessionUsage.update({ where: { id: attendance.usage.id }, data });
    }
    await tx.lessonAttendance.update({ where: { id: attendance.id }, data });
  }

  private async consume(
    tx: Prisma.TransactionClient,
    group: MarkGroup,
    attendanceId: string,
    childId: string,
    date: Date,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "Package" WHERE "childId" = ${childId} AND "directionId" = ${group.directionId} ORDER BY id FOR UPDATE`;
    const packages = await tx.package.findMany({
      where: { childId, directionId: group.directionId },
      include: packageConsumeInclude,
    });
    const pkg = pickPackage(packages, date);
    if (pkg) {
      await tx.sessionUsage.create({ data: { attendanceId, packageId: pkg.id } });
      return;
    }

    const price = group.singleTariff ? priceOn(group.singleTariff.prices, date) : null;
    if (!group.singleTariff || !price) throw new BadRequestException('No price for this date');
    const charge = await tx.charge.create({
      data: {
        childId,
        category: group.singleTariff.category,
        amount: price,
        description: `${group.name}, ${uaDay(date)}: разове заняття`,
        periodStart: date,
        periodEnd: date,
        sourceType: ChargeSource.extra_session,
        sourceId: attendanceId,
        createdById: userId,
      },
    });
    await tx.sessionUsage.create({ data: { attendanceId, chargeId: charge.id } });
  }
}
```

In the getRoster test the packages mock lacks `childId` on `packageRow()` by default; the test adds `childId: 'c1'`. The filter `p.childId === child.id` requires `childId` in the package rows — `findMany` without `select` returns all scalars, so this holds in production.

- [ ] **Step 5: Run tests and build**

Run: `npx jest src/classes/lessons.service.spec.ts` then `npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 6: Commit**

```bash
npx eslint --fix src/classes
git add src/classes
git commit -m "feat: add lesson marking with package consumption"
```

---

### Task 6: Legacy migration and reconciliation

**Files:**
- Create: `src/classes/dto/reconcile-package.dto.ts`
- Create: `src/classes/legacy.service.ts`
- Modify: `src/classes/packages.service.ts` (add `reconcile`, `reconciliationList`)
- Test: `src/classes/legacy.service.spec.ts`, extend `src/classes/packages.service.spec.ts`

**Interfaces:**
- Consumes: `money`, `formatMoney`, `AMOUNT_PATTERN`; `toDay`; `packageRemaining` (Task 2).
- Produces:
  - `LegacyService.migrate(userId: string): Promise<{ directions: number; packages: number; skipped: number }>`
  - `PackagesService.reconcile(id, dto: ReconcilePackageDto, userId): Promise<PackageView[]>`
  - `PackagesService.reconciliationList(): Promise<{ id, child: PersonRef, directionName, sessionsTotal, remaining, totalPrice: string }[]>`
  - `ReconcilePackageDto { outcome: 'paid_full' | 'paid_partial' | 'not_paid'; paidAmount?: string; note?: string }`

- [ ] **Step 1: DTO**

`src/classes/dto/reconcile-package.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AMOUNT_PATTERN } from '../../finance/finance-calc';

export const RECONCILE_OUTCOMES = ['paid_full', 'paid_partial', 'not_paid'] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export class ReconcilePackageDto {
  @IsIn(RECONCILE_OUTCOMES)
  outcome: ReconcileOutcome;

  @IsString()
  @Matches(AMOUNT_PATTERN)
  @IsOptional()
  paidAmount?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}
```

- [ ] **Step 2: Write the failing tests**

`src/classes/legacy.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { MissedLessonRule, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyService } from './legacy.service';

const mockPrisma = {
  subscription: { findMany: jest.fn() },
  direction: { findUnique: jest.fn(), create: jest.fn() },
  package: { create: jest.fn() },
};

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  childId: 'c1',
  totalSessions: 8,
  remainingSessions: 5,
  status: SubscriptionStatus.active,
  createdAt: new Date('2026-05-20T09:00:00Z'),
  subscriptionType: { name: 'Футбол' },
  package: null,
  ...over,
});

describe('LegacyService', () => {
  let service: LegacyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.direction.findUnique.mockResolvedValue(null);
    mockPrisma.direction.create.mockResolvedValue({ id: 'd-new' });
    const module = await Test.createTestingModule({
      providers: [LegacyService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(LegacyService);
  });

  it('maps subscriptions to packages needing reconciliation', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([sub()]);

    const result = await service.migrate('u1');

    expect(result).toEqual({ directions: 1, packages: 1, skipped: 0 });
    expect(mockPrisma.direction.create).toHaveBeenCalledWith({
      data: { name: 'Футбол', missedRule: MissedLessonRule.no_charge },
    });
    expect(mockPrisma.package.create).toHaveBeenCalledWith({
      data: {
        childId: 'c1',
        directionId: 'd-new',
        tariffId: null,
        sessionsTotal: 8,
        usedBefore: 3,
        purchaseDate: new Date('2026-05-20T00:00:00.000Z'),
        expiresAt: null,
        legacySubscriptionId: 's1',
        needsReconciliation: true,
        createdById: 'u1',
        voidedAt: null,
        voidedById: null,
        voidReason: null,
      },
    });
  });

  it('migrates cancelled subscriptions as voided packages without reconciliation', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([sub({ status: SubscriptionStatus.cancelled })]);

    await service.migrate('u1');

    const data = (mockPrisma.package.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({
      needsReconciliation: false,
      voidedById: 'u1',
      voidReason: 'Скасовано до перенесення',
    });
    expect(data.voidedAt).toBeInstanceOf(Date);
  });

  it('is idempotent and reuses existing directions', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([sub({ package: { id: 'p-existing' } }), sub({ id: 's2' })]);
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd-old' });

    const result = await service.migrate('u1');

    expect(result).toEqual({ directions: 0, packages: 1, skipped: 1 });
    expect(mockPrisma.direction.create).not.toHaveBeenCalled();
    expect(mockPrisma.package.create).toHaveBeenCalledTimes(1);
  });
});
```

Append to `src/classes/packages.service.spec.ts` (inside the top-level `describe`, after `describe('void')`; add `ChargeSource` and `FinanceCategory` are already imported):

```ts
  describe('reconcile', () => {
    const legacy = (over: Record<string, unknown> = {}) => ({
      id: 'p1',
      childId: 'child-1',
      needsReconciliation: true,
      direction: { name: 'Футбол' },
      legacySubscription: { totalPrice: d('1000') },
      ...over,
    });

    beforeEach(() => {
      mockPrisma.package.updateMany.mockResolvedValue({ count: 1 });
    });

    it('creates no charge for paid_full', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await service.reconcile('p1', { outcome: 'paid_full' }, 'u1');

      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
      expect(firstArg<{ where: Record<string, unknown> }>(mockPrisma.package.updateMany).where).toEqual({
        id: 'p1',
        needsReconciliation: true,
      });
    });

    it('charges the unpaid rest for paid_partial', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await service.reconcile('p1', { outcome: 'paid_partial', paidAmount: '400', note: 'зошит' }, 'u1');

      const charge = firstArg<{ data: Record<string, unknown> & { amount: Prisma.Decimal } }>(mockPrisma.charge.create);
      expect(charge.data).toMatchObject({
        childId: 'child-1',
        category: FinanceCategory.extra_classes,
        description: 'Початковий залишок (звірка): Футбол',
        sourceType: ChargeSource.opening_balance,
        sourceId: 'p1',
        createdById: 'u1',
      });
      expect(charge.data.amount.toFixed(2)).toBe('600.00');
    });

    it('charges the full price for not_paid', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await service.reconcile('p1', { outcome: 'not_paid' }, 'u1');

      const charge = firstArg<{ data: { amount: Prisma.Decimal } }>(mockPrisma.charge.create);
      expect(charge.data.amount.toFixed(2)).toBe('1000.00');
    });

    it.each(['0', '1000', undefined])('rejects paid amount %p', async (paidAmount) => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());

      await expect(service.reconcile('p1', { outcome: 'paid_partial', paidAmount }, 'u1')).rejects.toThrow(
        'Invalid paid amount',
      );
    });

    it('rejects a package that does not need reconciliation', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy({ needsReconciliation: false }));

      await expect(service.reconcile('p1', { outcome: 'paid_full' }, 'u1')).rejects.toThrow(
        'Package does not need reconciliation',
      );
    });

    it('rejects a concurrent second reconciliation', async () => {
      mockPrisma.package.findUnique.mockResolvedValue(legacy());
      mockPrisma.package.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.reconcile('p1', { outcome: 'not_paid' }, 'u1')).rejects.toThrow(
        'Package does not need reconciliation',
      );
    });
  });
```

The last test relies on the transaction rolling back the charge in production; in the mock the charge creation order is irrelevant because `updateMany` runs first (see implementation).

- [ ] **Step 3: Run to verify failure**

Run: `npx jest src/classes/legacy.service.spec.ts src/classes/packages.service.spec.ts`
Expected: FAIL — `legacy.service` missing, `reconcile` not a function.

- [ ] **Step 4: Implement `src/classes/legacy.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { MissedLessonRule, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toDay } from '../tariffs/dates';

@Injectable()
export class LegacyService {
  constructor(private prisma: PrismaService) {}

  async migrate(userId: string) {
    const subscriptions = await this.prisma.subscription.findMany({
      include: { subscriptionType: true, package: { select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const directionIds = new Map<string, string>();
    let directions = 0;
    let packages = 0;
    let skipped = 0;

    for (const sub of subscriptions) {
      if (sub.package) {
        skipped += 1;
        continue;
      }
      const name = sub.subscriptionType.name;
      let directionId = directionIds.get(name);
      if (!directionId) {
        const existing = await this.prisma.direction.findUnique({ where: { name } });
        if (existing) {
          directionId = existing.id;
        } else {
          const created = await this.prisma.direction.create({ data: { name, missedRule: MissedLessonRule.no_charge } });
          directionId = created.id;
          directions += 1;
        }
        directionIds.set(name, directionId);
      }

      const cancelled = sub.status === SubscriptionStatus.cancelled;
      await this.prisma.package.create({
        data: {
          childId: sub.childId,
          directionId,
          tariffId: null,
          sessionsTotal: sub.totalSessions,
          usedBefore: sub.totalSessions - sub.remainingSessions,
          purchaseDate: toDay(sub.createdAt),
          expiresAt: null,
          legacySubscriptionId: sub.id,
          needsReconciliation: !cancelled,
          createdById: userId,
          voidedAt: cancelled ? new Date() : null,
          voidedById: cancelled ? userId : null,
          voidReason: cancelled ? 'Скасовано до перенесення' : null,
        },
      });
      packages += 1;
    }

    return { directions, packages, skipped };
  }
}
```

- [ ] **Step 5: Add `reconcile` and `reconciliationList` to `PackagesService`**

Add imports `ChargeSource` (already), `FinanceCategory` from `@prisma/client`, `money` from `../finance/finance-calc`, `ReconcilePackageDto` from `./dto/reconcile-package.dto`. Add methods:

```ts
  async reconcile(id: string, dto: ReconcilePackageDto, userId: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
      include: { direction: { select: { name: true } }, legacySubscription: { select: { totalPrice: true } } },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    if (!pkg.needsReconciliation || !pkg.legacySubscription) {
      throw new BadRequestException('Package does not need reconciliation');
    }

    const total = pkg.legacySubscription.totalPrice;
    let due = new Prisma.Decimal(0);
    if (dto.outcome === 'not_paid') due = new Prisma.Decimal(total);
    if (dto.outcome === 'paid_partial') {
      const paid = dto.paidAmount ? money(dto.paidAmount) : null;
      if (!paid || paid.lte(0) || paid.gte(total)) throw new BadRequestException('Invalid paid amount');
      due = new Prisma.Decimal(total).minus(paid);
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.package.updateMany({
        where: { id, needsReconciliation: true },
        data: {
          needsReconciliation: false,
          reconciledAt: new Date(),
          reconciledById: userId,
          reconciliationNote: dto.note?.trim() || null,
        },
      });
      if (count === 0) throw new BadRequestException('Package does not need reconciliation');
      if (due.gt(0)) {
        await tx.charge.create({
          data: {
            childId: pkg.childId,
            category: FinanceCategory.extra_classes,
            amount: due,
            description: `Початковий залишок (звірка): ${pkg.direction.name}`,
            sourceType: ChargeSource.opening_balance,
            sourceId: pkg.id,
            createdById: userId,
          },
        });
      }
    });
    return this.listForChild(pkg.childId);
  }

  async reconciliationList() {
    const packages = await this.prisma.package.findMany({
      where: { needsReconciliation: true, voidedAt: null },
      include: {
        child: { select: { id: true, firstName: true, lastName: true } },
        direction: { select: { name: true } },
        legacySubscription: { select: { totalPrice: true } },
        extensions: { select: { newExpiresAt: true, createdAt: true } },
        usages: { select: { voidedAt: true } },
      },
      orderBy: { purchaseDate: 'asc' },
    });
    return packages.map((p) => ({
      id: p.id,
      child: p.child,
      directionName: p.direction.name,
      sessionsTotal: p.sessionsTotal,
      remaining: packageRemaining(p),
      totalPrice: formatMoney(p.legacySubscription?.totalPrice ?? 0),
    }));
  }
```

- [ ] **Step 6: Run tests and build**

Run: `npx jest src/classes` then `npm run build`
Expected: PASS; build exit 0.

- [ ] **Step 7: Commit**

```bash
npx eslint --fix src/classes
git add src/classes
git commit -m "feat: migrate legacy subscriptions and reconcile packages"
```

---

### Task 7: Controllers, module, delete guards, smoke

**Files:**
- Create: `src/classes/directions.controller.ts`, `class-groups.controller.ts`, `packages.controller.ts`, `classes.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/children/children.service.ts` + spec, `src/users/users.service.ts` + spec
- Test: `src/classes/classes.controllers.spec.ts`

**Interfaces:**
- Consumes all services from Tasks 3–6; `VoidDto` from `src/finance/dto/void.dto.ts`.
- Produces routes from the spec API table.

- [ ] **Step 1: Failing metadata test**

`src/classes/classes.controllers.spec.ts`:

```ts
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ClassGroupsController } from './class-groups.controller';
import { DirectionsController } from './directions.controller';
import { PackagesController } from './packages.controller';

const handlerRoles = (controller: { prototype: object }, method: string) =>
  Reflect.getMetadata(ROLES_KEY, (controller.prototype as Record<string, unknown>)[method] as object) as Role[] | undefined;

describe('classes controllers', () => {
  it('restricts directions and packages to root and admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DirectionsController)).toEqual([Role.root, Role.admin]);
    expect(Reflect.getMetadata(ROLES_KEY, PackagesController)).toEqual([Role.root, Role.admin]);
  });

  it('opens class groups to teachers but keeps admin actions admin-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClassGroupsController)).toEqual([Role.root, Role.admin, Role.teacher]);
    for (const method of ['create', 'update', 'delete', 'addMember', 'endMember']) {
      expect(handlerRoles(ClassGroupsController, method)).toEqual([Role.root, Role.admin]);
    }
    for (const method of ['get', 'my', 'roster', 'mark']) {
      expect(handlerRoles(ClassGroupsController, method)).toBeUndefined();
    }
  });
});
```

Run: `npx jest src/classes/classes.controllers.spec.ts` — FAIL (modules missing).

- [ ] **Step 2: Controllers and module**

`src/classes/directions.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DirectionsService } from './directions.service';
import { CreateDirectionDto } from './dto/create-direction.dto';
import { UpdateDirectionDto } from './dto/update-direction.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('directions')
export class DirectionsController {
  constructor(private directions: DirectionsService) {}

  @Get()
  list() {
    return this.directions.list();
  }

  @Post()
  create(@Body() dto: CreateDirectionDto) {
    return this.directions.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDirectionDto) {
    return this.directions.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.directions.delete(id);
  }
}
```

`src/classes/class-groups.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ClassGroupsService } from './class-groups.service';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateClassGroupDto } from './dto/create-class-group.dto';
import { EndMemberDto } from './dto/end-member.dto';
import { MarkLessonDto } from './dto/mark-lesson.dto';
import { UpdateClassGroupDto } from './dto/update-class-group.dto';
import { LessonsService } from './lessons.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller()
export class ClassGroupsController {
  constructor(
    private groups: ClassGroupsService,
    private lessons: LessonsService,
  ) {}

  @Roles(Role.root, Role.admin)
  @Post('class-groups')
  create(@Body() dto: CreateClassGroupDto) {
    return this.groups.create(dto);
  }

  @Roles(Role.root, Role.admin)
  @Patch('class-groups/:id')
  update(@Param('id') id: string, @Body() dto: UpdateClassGroupDto) {
    return this.groups.update(id, dto);
  }

  @Roles(Role.root, Role.admin)
  @Delete('class-groups/:id')
  delete(@Param('id') id: string) {
    return this.groups.delete(id);
  }

  @Get('class-groups/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.get(id, user);
  }

  @Get('my/class-groups')
  my(@CurrentUser() user: AuthenticatedUser) {
    return this.groups.myGroups(user);
  }

  @Roles(Role.root, Role.admin)
  @Post('class-groups/:id/members')
  addMember(@Param('id') id: string, @Body() dto: AddMemberDto, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.addMember(id, dto, user.id);
  }

  @Roles(Role.root, Role.admin)
  @Patch('class-group-members/:id/end')
  endMember(@Param('id') id: string, @Body() dto: EndMemberDto) {
    return this.groups.endMember(id, dto);
  }

  @Get('class-groups/:id/lessons/:date')
  roster(@Param('id') id: string, @Param('date') date: string, @CurrentUser() user: AuthenticatedUser) {
    return this.lessons.getRoster(id, date, user);
  }

  @Put('class-groups/:id/lessons/:date')
  async mark(
    @Param('id') id: string,
    @Param('date') date: string,
    @Body() dto: MarkLessonDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.lessons.mark(id, date, dto, user);
    return this.lessons.getRoster(id, date, user);
  }
}
```

`src/classes/packages.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { VoidDto } from '../finance/dto/void.dto';
import { ExtendPackageDto } from './dto/extend-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import { ReconcilePackageDto } from './dto/reconcile-package.dto';
import { LegacyService } from './legacy.service';
import { PackagesService } from './packages.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller()
export class PackagesController {
  constructor(
    private packages: PackagesService,
    private legacy: LegacyService,
  ) {}

  @Get('children/:childId/packages')
  list(@Param('childId') childId: string) {
    return this.packages.listForChild(childId);
  }

  @Post('children/:childId/packages')
  purchase(@Param('childId') childId: string, @Body() dto: PurchasePackageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.packages.purchase(childId, dto, user.id);
  }

  @Post('packages/:id/extend')
  extend(@Param('id') id: string, @Body() dto: ExtendPackageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.packages.extend(id, dto, user.id);
  }

  @Post('packages/:id/void')
  void(@Param('id') id: string, @Body() dto: VoidDto, @CurrentUser() user: AuthenticatedUser) {
    return this.packages.void(id, dto.reason, user.id);
  }

  @Post('packages/:id/reconcile')
  reconcile(@Param('id') id: string, @Body() dto: ReconcilePackageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.packages.reconcile(id, dto, user.id);
  }

  @Get('packages/reconciliation')
  reconciliation() {
    return this.packages.reconciliationList();
  }

  @Post('legacy/subscriptions/migrate')
  @HttpCode(200)
  migrate(@CurrentUser() user: AuthenticatedUser) {
    return this.legacy.migrate(user.id);
  }
}
```

`src/classes/classes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ClassGroupsController } from './class-groups.controller';
import { ClassGroupsService } from './class-groups.service';
import { DirectionsController } from './directions.controller';
import { DirectionsService } from './directions.service';
import { LegacyService } from './legacy.service';
import { LessonsService } from './lessons.service';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  controllers: [DirectionsController, ClassGroupsController, PackagesController],
  providers: [DirectionsService, ClassGroupsService, LessonsService, PackagesService, LegacyService],
})
export class ClassesModule {}
```

In `src/app.module.ts` import `ClassesModule` from `./classes/classes.module` and add it after `TariffsModule`.

- [ ] **Step 3: Delete guards (tests first)**

`children.service.spec.ts`: add `classGroupMember: { count: jest.fn() }, lessonAttendance: { count: jest.fn() }, package: { count: jest.fn() }` to `mockPrisma`; in every existing delete test that reaches the counts set these to `mockResolvedValue(0)`; add:

```ts
    it('throws BadRequestException when child has class records', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(1);

      await expect(service.delete('child-1')).rejects.toThrow('Cannot delete: child has financial records');
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });
```

`users.service.spec.ts`: add `classGroupMember`, `package`, `packageExtension`, `lesson`, `lessonAttendance`, `sessionUsage` each `{ count: jest.fn() }`; set them to 0 in the delete `beforeEach`; add:

```ts
    it('throws BadRequestException when user marked lessons', async () => {
      mockPrisma.lessonAttendance.count.mockResolvedValue(2);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
```

Run `npx jest src/children src/users` — the new tests FAIL.

Implement: in `ChildrenService.delete` add to the counts array:

```ts
      this.prisma.classGroupMember.count({ where: { childId: id } }),
      this.prisma.lessonAttendance.count({ where: { childId: id } }),
      this.prisma.package.count({ where: { childId: id } }),
```

In `UsersService.delete` add:

```ts
      this.prisma.classGroupMember.count({ where: { createdById: id } }),
      this.prisma.package.count({ where: { OR: [{ createdById: id }, { voidedById: id }, { reconciledById: id }] } }),
      this.prisma.packageExtension.count({ where: { createdById: id } }),
      this.prisma.lesson.count({ where: { conductedById: id } }),
      this.prisma.lessonAttendance.count({ where: { OR: [{ markedById: id }, { voidedById: id }] } }),
      this.prisma.sessionUsage.count({ where: { voidedById: id } }),
```

- [ ] **Step 4: Run all tests and build**

Run: `npx jest` then `npm run build`
Expected: all PASS; build exit 0.

- [ ] **Step 5: Smoke test**

Start your own server: `PORT=3100 npm run start:dev` in the background (port 3000 belongs to the user — never touch it). Login as root (`ROOT_LOGIN`/`ROOT_PASSWORD` from `.env`, never print the password), cookie jar and UTF-8 JSON bodies in the scratchpad, `curl --data-binary @file -H 'Content-Type: application/json; charset=utf-8'`. Kyiv today `T=$(TZ=Europe/Kyiv date +%F)`.

1. Create tariffs via `POST /tariffs`: `{"name":"Смоук LEGO разове","category":"extra_classes","unit":"session","billingMode":"calendar_full","price":"300.00","effectiveFrom":"2026-01-01"}` and `{"name":"Смоук LEGO пакет","category":"extra_classes","unit":"package","packageSize":4,"validityDays":30,"billingMode":"calendar_full","price":"1000.00","effectiveFrom":"2026-01-01"}` (add a suffix if names exist).
2. `POST /directions` `{"name":"Смоук LEGO","missedRule":"unexcused_only"}`.
3. Create two children via `POST /children` (check the DTO; create a kindergarten group via `POST /groups` if required). `POST /class-groups` with the direction, `format: "group"`, `teacherIds: []`, both tariffs. Add both children as members from `T`.
4. `POST /children/<A>/packages` `{"directionId":…,"tariffId":<package>,"purchaseDate":T}` → package remaining 4; A's finance shows a 1000.00 extra_classes charge.
5. `PUT /class-groups/<g>/lessons/T` `{"marks":[{"childId":A,"status":"present"},{"childId":B,"status":"present"}]}` → roster: A `packageInfo.remaining` 3; B has no package; B's finance shows a 300.00 charge with description `…: разове заняття`.
6. `PUT` same date `{"marks":[{"childId":A,"status":"absent_excused"}]}` → A remaining back to 4.
7. `GET /packages/reconciliation` → 200 array. `POST /legacy/subscriptions/migrate` twice → second call `packages: 0`.
8. `DELETE /directions/<d>` → 400 `Cannot delete: direction is in use`.

Stop only your 3100 server. Record requests and abbreviated responses.

- [ ] **Step 6: Commit**

```bash
npx eslint --fix src/classes src/app.module.ts src/children/children.service.ts src/children/children.service.spec.ts src/users/users.service.ts src/users/users.service.spec.ts
git add src/classes src/app.module.ts src/children src/users
git commit -m "feat: wire classes module, controllers and delete guards"
```

---

### Task 8: Backend CLAUDE.md and verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a section after "### Domain: tariffs and billing"**

```markdown
### Domain: classes and packages

Spec: `docs/superpowers/specs/2026-10-11-classes-packages-design.md`. Code in `src/classes/`:

- `Direction` has a missed-lesson rule (`no_charge`, `always`, `unexcused_only`); `ClassGroup` has teachers, members (`ClassGroupMember` with start/end dates), a single-lesson tariff (unit `session`) and a package tariff (unit `package`).
- `Package` = sessions bought for a direction (charge `sourceType = extra_package`); remaining = `sessionsTotal − usedBefore − active SessionUsage`, never stored. Validity from `Tariff.validityDays`; extensions are separate rows.
- `consumption.ts` is pure: whether a mark consumes, which package (expiring first), package state. Keep rules there and test without mocks.
- Marking (`LessonsService.mark`) runs in one transaction: lock the `Lesson` row, then the child's `Package` rows (`ORDER BY id FOR UPDATE`). No usable package → single-lesson charge (`sourceType = extra_session`).
- Corrections void the old attendance + usage (+ single charge via `voidChargeInTx`). Teachers: own groups only (`assertGroupAccess`), corrections only on the lesson day; admins need a reason after the lesson day.
- Legacy `Subscription`s are migrated once (`POST /legacy/subscriptions/migrate`, idempotent) into packages with `needsReconciliation`; reconciliation creates an `opening_balance` charge for the unpaid part. The old subscriptions module is read-only legacy.
```

- [ ] **Step 2: Verify**

Run: `npm test`, `npm run build`, `npx eslint "src/classes/**/*.ts" src/tariffs/tariffs.service.ts src/tariffs/dto src/app.module.ts src/children/children.service.ts src/users/users.service.ts`
Expected: all tests pass; build exit 0; eslint shows only the baseline `_p`/`_r` errors in `users.service.ts` and no warnings in `src/classes`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document classes and packages in CLAUDE.md"
```

---

### Task 9: Frontend error display and role menu

Work in `D:\IT\EduNest`. Read its `CLAUDE.md` first.

**Files:**
- Create: `src/shared/api/errorMessages.ts`, `src/shared/model/notifyStore.ts`, `src/shared/ui/Notifier.tsx`
- Modify: `src/shared/api/axiosInstance.ts`, `src/app/layouts/AdminLayout.tsx`
- Modify: `src/entities/user/model/types.ts`, `src/entities/user/index.ts`
- Modify: `src/widgets/sidebar/model/nav-items.ts`, `src/widgets/sidebar/ui/Sidebar.tsx`
- Modify: `CLAUDE.md` (frontend)

**Interfaces:**
- Produces: `translateError(error: unknown): string`; `useNotifyStore` with `push(message: string, severity?: 'error' | 'success')` and `dismiss(id: number)`; `Notifier`; `type SessionRole = 'root' | 'admin' | 'teacher' | 'parent'`; `NavItem.roles?: SessionRole[]`.

- [ ] **Step 1: Branch and baseline**

```bash
git checkout main
git checkout -b feature/classes
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" > <scratchpad>/fe-tsc-baseline-part4.txt
```

- [ ] **Step 2: `src/shared/api/errorMessages.ts`**

```ts
export const GENERIC_ERROR = 'Сталася помилка. Спробуйте ще раз.';

export const errorMessages: Record<string, string> = {
  'Forbidden resource': 'Недостатньо прав для цієї дії',
  'Child not found': 'Дитину не знайдено',
  'Charge not found': 'Нарахування не знайдено',
  'Payment not found': 'Оплату не знайдено',
  'Allocation not found': 'Розподіл не знайдено',
  'Charge is voided': 'Нарахування вже сторновано',
  'Payment is voided': 'Оплату вже сторновано',
  'Allocation is voided': 'Розподіл уже знято',
  'Payment is not confirmed': 'Оплата не підтверджена',
  'Charge belongs to another child': 'Нарахування належить іншій дитині',
  'Charge category does not match payment category': 'Категорія нарахування не збігається з призначенням оплати',
  'Allocation exceeds payment free amount': 'Сума перевищує вільний залишок оплати',
  'Allocation exceeds charge remaining amount': 'Сума перевищує залишок нарахування',
  'Amount must be greater than 0': 'Сума має бути більшою за 0',
  'Duplicate charge in allocations': 'Нарахування повторюється в розподілі',
  'Period end must not be before period start': 'Кінець періоду раніше за початок',
  'Cannot delete: child has financial records': 'Не можна видалити: у дитини є фінансові записи',
  'Cannot delete: user has financial records, deactivate instead':
    'Не можна видалити: у користувача є записи. Деактивуйте його.',
  'Tariff not found': 'Тариф не знайдено',
  'Tariff with this name already exists': 'Тариф з такою назвою вже існує',
  'Tariff is not active': 'Тариф неактивний',
  'Tariff unit must be month': 'Потрібен тариф з одиницею «місяць»',
  'Tariff unit must be hour': 'Потрібен тариф з одиницею «година»',
  'Tariff unit must be session': 'Потрібен тариф з одиницею «заняття»',
  'Tariff unit must be package': 'Потрібен тариф з одиницею «пакет»',
  'Package size is required for package tariffs': 'Вкажіть кількість занять у пакеті',
  'Price for this date already exists': 'Ціна на цю дату вже є',
  'No price for this date': 'Немає ціни на цю дату',
  'Cannot delete: tariff is in use': 'Не можна видалити: тариф використовується',
  'Enrollment not found': 'Запис не знайдено',
  'Enrollment overlaps an existing enrollment on this tariff': 'Запис перетинається з іншим записом на цей тариф',
  'End date must not be before start date': 'Дата завершення раніше за дату початку',
  'Adjustment not found': 'Умову не знайдено',
  'Adjustment overlaps an existing adjustment of the same type': 'Умова перетинається з іншою умовою того ж типу',
  'Invalid adjustment value': 'Невірне значення умови',
  'Adjustment is voided': 'Умову вже сторновано',
  'Billed period not found': 'Нарахований період не знайдено',
  'Adaptation visit not found': 'Відвідування не знайдено',
  'Adaptation visit is voided': 'Відвідування вже сторновано',
  'Invalid hours': 'Невірна кількість годин',
  'Lead days must be between 0 and 60': 'Кількість днів має бути від 0 до 60',
  'Cannot change billing mode: tariff has enrollments': 'Не можна змінити режим: на тарифі є записи',
  'Billed period no longer matches the enrollment schedule': 'Період не відповідає поточному графіку запису',
  'Direction not found': 'Напрям не знайдено',
  'Direction with this name already exists': 'Напрям з такою назвою вже існує',
  'Cannot delete: direction is in use': 'Не можна видалити: напрям використовується',
  'Class group not found': 'Групу не знайдено',
  'Class group with this name already exists in the direction': 'Група з такою назвою вже є в напрямі',
  'Cannot delete: group is in use': 'Не можна видалити: у групи є заняття',
  'Invalid teachers': 'Обрані користувачі не є педагогами',
  'Member not found': 'Учасника не знайдено',
  'Child is already a member of this group': 'Дитина вже в цій групі',
  'Invalid date': 'Невірна дата',
  'Lesson date must not be in the future': 'Дата заняття не може бути в майбутньому',
  'Child is not a member of this group on this date': 'Дитина не в складі групи на цю дату',
  'Duplicate child in marks': 'Дитина відмічена двічі',
  'Only the lesson day can be corrected by a teacher': 'Педагог може виправити відмітку лише в день заняття',
  'Reason is required for a late correction': 'Вкажіть причину виправлення',
  'Not your class group': 'Це не ваша група',
  'Package not found': 'Пакет не знайдено',
  'Package is voided': 'Пакет сторновано',
  'Package has used sessions': 'З пакета вже списано заняття',
  'New expiry must be after the current expiry': 'Новий термін має бути пізніше поточного',
  'Package does not need reconciliation': 'Пакет не потребує звірки',
  'Invalid paid amount': 'Невірна сума оплати',
  'Login already taken': 'Логін уже зайнятий',
};

export const translateError = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown };
    if (typeof message === 'string') return errorMessages[message] ?? GENERIC_ERROR;
  }
  return GENERIC_ERROR;
};
```

- [ ] **Step 3: Notifier store and component**

`src/shared/model/notifyStore.ts`:

```ts
import { create } from 'zustand';

export type NoticeSeverity = 'error' | 'success';

export interface Notice {
  id: number;
  message: string;
  severity: NoticeSeverity;
}

interface NotifyState {
  notices: Notice[];
  push: (message: string, severity?: NoticeSeverity) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useNotifyStore = create<NotifyState>((set) => ({
  notices: [],
  push: (message, severity = 'error') =>
    set((state) => ({ notices: [...state.notices, { id: nextId++, message, severity }] })),
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
}));
```

`src/shared/ui/Notifier.tsx`:

```tsx
import { Alert, Snackbar } from '@mui/material'
import { useNotifyStore } from '../model/notifyStore'

export const Notifier = () => {
  const notices = useNotifyStore((s) => s.notices)
  const dismiss = useNotifyStore((s) => s.dismiss)
  const current = notices[0]

  return (
    <Snackbar
      key={current?.id}
      open={Boolean(current)}
      autoHideDuration={5000}
      onClose={(_, reason) => {
        if (reason !== 'clickaway' && current) dismiss(current.id)
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {current ? (
        <Alert severity={current.severity} variant="filled" onClose={() => dismiss(current.id)} sx={{ width: '100%' }}>
          {current.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  )
}
```

If MUI 9 types reject `undefined` as Snackbar child, render `<span />` instead and keep `open` false.

- [ ] **Step 4: Interceptor and layout**

`src/shared/api/axiosInstance.ts` — replace the response interceptor:

```ts
import axios from 'axios';
import { useNotifyStore } from '../model/notifyStore';
import { translateError } from './errorMessages';

export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error.response?.data ?? error;
    if (error.response?.status !== 401) {
      useNotifyStore.getState().push(translateError(data));
    }
    return Promise.reject(data);
  }
);
```

(Keep the file's existing first-line BOM state as is; do not reformat other lines.)

`AdminLayout.tsx`: import `Notifier` from `../../shared/ui/Notifier` and render `<Notifier />` as the last child of the outer `Box`.

- [ ] **Step 5: Roles and menu**

`src/entities/user/model/types.ts` — add:

```ts
export type SessionRole = 'root' | 'admin' | 'teacher' | 'parent'
```

`src/entities/user/index.ts` — export it: `export type { User, UserRole, SessionRole } from './model/types'`.

`nav-items.ts`: import `type { SessionRole } from '../../../entities/user'`, `CastleIcon` from `@mui/icons-material/Castle` for «Гуртки» and `EventAvailableIcon` from `@mui/icons-material/EventAvailable` for «Мої заняття` (verify both files exist in `node_modules/@mui/icons-material`; otherwise use `Interests` / `Today`). Add `roles?: SessionRole[]` to `NavItem` and replace `navItems` with:

```ts
const ADMIN: SessionRole[] = ['root', 'admin']

export const navItems: NavItem[] = [
  { path: '/',                    label: 'Дашборд',           icon: DashboardIcon },
  { path: '/users',               label: 'Користувачі',       icon: ManageAccountsIcon, roles: ADMIN },
  { path: '/groups',              label: 'Групи',             icon: GroupsIcon,         roles: ADMIN },
  { path: '/students',            label: 'Учні',              icon: PeopleIcon,         roles: ADMIN },
  { path: '/subscriptions',       label: 'Абонементи',        icon: CardMembershipIcon, roles: ADMIN },
  { path: '/subscription-types',  label: 'Типи абонементів',  icon: StyleIcon,          roles: ADMIN },
  { path: '/finance',             label: 'Фінанси',           icon: AccountBalanceWalletIcon, roles: ADMIN },
  { path: '/tariffs',             label: 'Тарифи',            icon: PriceChangeIcon,    roles: ADMIN },
  { path: '/classes',             label: 'Гуртки',            icon: CastleIcon,         roles: ADMIN },
  { path: '/my-classes',          label: 'Мої заняття',       icon: EventAvailableIcon, roles: ['teacher'] },
]
```

`bottomNavItems` settings item gets `roles: ADMIN`.

`Sidebar.tsx`: import `useAuthStore` and `type SessionRole` from `../../../entities/user`; inside `Sidebar`:

```tsx
  const role = useAuthStore((s) => s.profile?.role) as SessionRole | undefined
  const visible = (item: NavItem) => !item.roles || (role !== undefined && item.roles.includes(role))
```

and render `navItems.filter(visible)` / `bottomNavItems.filter(visible)`.

Ruling: the spec's teacher menu said «Мої заняття» (and possibly «Учні»); «Учні» stays admin-only because the page loads `/users`, which teachers cannot read.

- [ ] **Step 6: Frontend CLAUDE.md**

Replace the "### API errors" section body with:

```markdown
Server errors are shown centrally: the axios response interceptor (`shared/api/axiosInstance.ts`) pushes a snackbar with `translateError(data)` for every non-401 error and still rejects with `error.response.data`. Translations live in `shared/api/errorMessages.ts` (backend English `message` → Ukrainian; unknown messages and `ValidationPipe` arrays → «Сталася помилка. Спробуйте ще раз.»). When the backend adds a message, add its translation there. Stores and components do not show server errors themselves; they only keep modals open on failure.
```

Remove Roadmap item 1 and renumber; keep the backend error contract bullets.

- [ ] **Step 7: Verify and commit**

tsc diff vs `fe-tsc-baseline-part4.txt` empty; `npx eslint src/shared src/widgets/sidebar src/app/layouts src/entities/user` 0 errors.

```bash
git add src CLAUDE.md
git commit -m "feat: show translated server errors and filter menu by role"
```

---

### Task 10: Classes API client and Гуртки page

**Files:**
- Create: `src/shared/api/classes.ts`; modify `src/shared/api/index.ts`
- Create: `src/pages/classes/model/classesStore.ts`, `src/pages/classes/ui/ClassesPage.tsx`, `DirectionModal.tsx`, `GroupModal.tsx`, `ReconciliationDialog.tsx`, `src/pages/classes/index.ts`
- Modify: `src/app/router/index.tsx`

**Interfaces:**
- Produces types/labels/clients used by Tasks 11–12 (exact names below).

- [ ] **Step 1: `src/shared/api/classes.ts`**

```ts
import { axiosInstance } from './axiosInstance';
import type { PersonRef } from './finance';

export type MissedLessonRule = 'no_charge' | 'always' | 'unexcused_only';
export type ClassFormat = 'individual' | 'group';
export type AttendanceStatus = 'present' | 'absent_excused' | 'absent_unexcused';
export type PackageState = 'active' | 'exhausted' | 'expired' | 'voided' | 'needs_reconciliation';
export type ReconcileOutcome = 'paid_full' | 'paid_partial' | 'not_paid';

export const missedRuleLabels: Record<MissedLessonRule, string> = {
  no_charge: 'Пропуски не списуються',
  always: 'Списувати завжди',
  unexcused_only: 'Списувати лише неповажні',
};

export const classFormatLabels: Record<ClassFormat, string> = {
  individual: 'Індивідуальне',
  group: 'Групове',
};

export const attendanceStatusLabels: Record<AttendanceStatus, string> = {
  present: 'Присутній',
  absent_excused: 'Поважний пропуск',
  absent_unexcused: 'Неповажний пропуск',
};

export const packageStateLabels: Record<PackageState, string> = {
  active: 'Активний',
  exhausted: 'Вичерпаний',
  expired: 'Прострочений',
  voided: 'Сторнований',
  needs_reconciliation: 'Потребує звірки',
};

export const reconcileOutcomeLabels: Record<ReconcileOutcome, string> = {
  paid_full: 'Оплачено повністю',
  paid_partial: 'Оплачено частково',
  not_paid: 'Не оплачено',
};

export const missedRules = Object.keys(missedRuleLabels) as MissedLessonRule[];
export const classFormats = Object.keys(classFormatLabels) as ClassFormat[];
export const attendanceStatuses = Object.keys(attendanceStatusLabels) as AttendanceStatus[];

export interface TariffRef {
  id: string;
  name: string;
}

export interface ClassGroupSummary {
  id: string;
  name: string;
  format: ClassFormat;
  isActive: boolean;
  teachers: PersonRef[];
  singleTariff: TariffRef | null;
  packageTariff: TariffRef | null;
  activeMembers: number;
}

export interface Direction {
  id: string;
  name: string;
  missedRule: MissedLessonRule;
  isActive: boolean;
  groups: ClassGroupSummary[];
}

export interface ClassGroupMember {
  id: string;
  child: PersonRef;
  startDate: string;
  endDate: string | null;
}

export interface LessonSummary {
  id: string;
  date: string;
  conductedBy: PersonRef;
  attendances: { childId: string; childName: string; status: AttendanceStatus; isGuest: boolean }[];
}

export interface ClassGroupDetail extends ClassGroupSummary {
  direction: { id: string; name: string; missedRule: MissedLessonRule };
  members: ClassGroupMember[];
  lessons: LessonSummary[];
}

export interface MyClassGroup extends ClassGroupSummary {
  direction: { id: string; name: string };
}

export interface RosterRow {
  child: PersonRef;
  isMember: boolean;
  attendance: { id: string; status: AttendanceStatus; isGuest: boolean } | null;
  packageInfo: { packageId: string; remaining: number; total: number; expiresAt: string | null } | null;
}

export interface LessonRoster {
  group: { id: string; name: string; direction: { id: string; name: string; missedRule: MissedLessonRule } };
  date: string;
  lessonId: string | null;
  conductedBy: PersonRef | null;
  rows: RosterRow[];
}

export interface ChildPackage {
  id: string;
  direction: { id: string; name: string };
  tariff: TariffRef | null;
  sessionsTotal: number;
  used: number;
  remaining: number;
  purchaseDate: string;
  expiresAt: string | null;
  state: PackageState;
  chargeId: string | null;
  needsReconciliation: boolean;
  reconciledAt: string | null;
  reconciliationNote: string | null;
  legacyTotalPrice: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  extensions: { id: string; previousExpiresAt: string | null; newExpiresAt: string; reason: string; createdAt: string }[];
  usages: { id: string; date: string; groupName: string; status: AttendanceStatus; voidedAt: string | null }[];
  legacyAttendances: { id: string; date: string; note: string | null }[];
}

export interface ReconciliationItem {
  id: string;
  child: PersonRef;
  directionName: string;
  sessionsTotal: number;
  remaining: number;
  totalPrice: string;
}

export interface DirectionDto {
  name: string;
  missedRule: MissedLessonRule;
  isActive?: boolean;
}

export interface ClassGroupDto {
  name: string;
  directionId: string;
  format: ClassFormat;
  teacherIds: string[];
  singleTariffId: string | null;
  packageTariffId: string | null;
  isActive?: boolean;
}

export interface MarkLessonDto {
  marks: { childId: string; status: AttendanceStatus; isGuest?: boolean }[];
  reason?: string;
}

export interface PurchasePackageDto {
  directionId: string;
  tariffId: string;
  purchaseDate: string;
}

export interface ReconcileDto {
  outcome: ReconcileOutcome;
  paidAmount?: string;
  note?: string;
}

export const directionsApi = {
  getList: () => axiosInstance.get<Direction[]>('/directions'),
  create: (dto: DirectionDto) => axiosInstance.post<Direction[]>('/directions', dto),
  update: (id: string, dto: Partial<DirectionDto>) => axiosInstance.patch<Direction[]>(`/directions/${id}`, dto),
  delete: (id: string) => axiosInstance.delete<Direction[]>(`/directions/${id}`),
};

export const classGroupsApi = {
  get: (id: string) => axiosInstance.get<ClassGroupDetail>(`/class-groups/${id}`),
  getMine: () => axiosInstance.get<MyClassGroup[]>('/my/class-groups'),
  create: (dto: ClassGroupDto) => axiosInstance.post<ClassGroupDetail>('/class-groups', dto),
  update: (id: string, dto: Partial<ClassGroupDto>) => axiosInstance.patch<ClassGroupDetail>(`/class-groups/${id}`, dto),
  delete: (id: string) => axiosInstance.delete(`/class-groups/${id}`),
  addMember: (id: string, dto: { childId: string; startDate: string }) =>
    axiosInstance.post<ClassGroupDetail>(`/class-groups/${id}/members`, dto),
  endMember: (memberId: string, endDate: string) =>
    axiosInstance.patch<ClassGroupDetail>(`/class-group-members/${memberId}/end`, { endDate }),
  getRoster: (id: string, date: string) => axiosInstance.get<LessonRoster>(`/class-groups/${id}/lessons/${date}`),
  mark: (id: string, date: string, dto: MarkLessonDto) =>
    axiosInstance.put<LessonRoster>(`/class-groups/${id}/lessons/${date}`, dto),
};

export const packagesApi = {
  getByChild: (childId: string) => axiosInstance.get<ChildPackage[]>(`/children/${childId}/packages`),
  purchase: (childId: string, dto: PurchasePackageDto) =>
    axiosInstance.post<ChildPackage[]>(`/children/${childId}/packages`, dto),
  extend: (id: string, dto: { newExpiresAt: string; reason: string }) =>
    axiosInstance.post<ChildPackage[]>(`/packages/${id}/extend`, dto),
  void: (id: string, reason: string) => axiosInstance.post<ChildPackage[]>(`/packages/${id}/void`, { reason }),
  reconcile: (id: string, dto: ReconcileDto) => axiosInstance.post<ChildPackage[]>(`/packages/${id}/reconcile`, dto),
  getReconciliation: () => axiosInstance.get<ReconciliationItem[]>('/packages/reconciliation'),
  migrateLegacy: () =>
    axiosInstance.post<{ directions: number; packages: number; skipped: number }>('/legacy/subscriptions/migrate'),
};

export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const formatDay = (value: string) => new Date(value).toLocaleDateString('uk-UA', { timeZone: 'UTC' });
```

Note: `DirectionsService.delete` returns the list in the backend (Task 3), so `directionsApi.delete` is typed `Direction[]`.

Append to `src/shared/api/index.ts`:

```ts
export {
  directionsApi,
  classGroupsApi,
  packagesApi,
  missedRuleLabels,
  classFormatLabels,
  attendanceStatusLabels,
  packageStateLabels,
  reconcileOutcomeLabels,
  missedRules,
  classFormats,
  attendanceStatuses,
  localToday,
  formatDay,
} from './classes';
export type {
  MissedLessonRule,
  ClassFormat,
  AttendanceStatus,
  PackageState,
  ReconcileOutcome,
  TariffRef,
  ClassGroupSummary,
  Direction,
  ClassGroupMember,
  LessonSummary,
  ClassGroupDetail,
  MyClassGroup,
  RosterRow,
  LessonRoster,
  ChildPackage,
  ReconciliationItem,
  DirectionDto,
  ClassGroupDto,
  MarkLessonDto,
  PurchasePackageDto,
  ReconcileDto,
} from './classes';
export { translateError } from './errorMessages';
```

- [ ] **Step 2: Store `src/pages/classes/model/classesStore.ts`**

```ts
import { create } from 'zustand';
import {
  classGroupsApi,
  directionsApi,
  packagesApi,
  tariffsApi,
  usersApi,
  type ClassGroupDto,
  type ClassGroupSummary,
  type Direction,
  type DirectionDto,
  type ReconciliationItem,
  type Tariff,
} from '../../../shared/api';
import type { User } from '../../../entities/user';

interface ClassesState {
  directions: Direction[];
  tariffs: Tariff[];
  teachers: User[];
  reconciliation: ReconciliationItem[];
  isLoading: boolean;
  isSaving: boolean;
  directionModal: { isOpen: boolean; direction: Direction | null };
  groupModal: { isOpen: boolean; directionId: string | null; group: ClassGroupSummary | null };
  reconciliationOpen: boolean;
  setDirectionModal: (value: Partial<{ isOpen: boolean; direction: Direction | null }>) => void;
  setGroupModal: (value: Partial<{ isOpen: boolean; directionId: string | null; group: ClassGroupSummary | null }>) => void;
  setReconciliationOpen: (open: boolean) => void;
  fetchAll: () => Promise<void>;
  saveDirection: (dto: DirectionDto, id?: string) => Promise<void>;
  saveGroup: (dto: ClassGroupDto, id?: string) => Promise<void>;
  migrateLegacy: () => Promise<void>;
}

export const useClassesStore = create<ClassesState>((set, get) => {
  const refreshDirections = async () => {
    const [{ data: directions }, { data: reconciliation }] = await Promise.all([
      directionsApi.getList(),
      packagesApi.getReconciliation(),
    ]);
    set({ directions, reconciliation });
  };

  return {
    directions: [],
    tariffs: [],
    teachers: [],
    reconciliation: [],
    isLoading: false,
    isSaving: false,
    directionModal: { isOpen: false, direction: null },
    groupModal: { isOpen: false, directionId: null, group: null },
    reconciliationOpen: false,

    setDirectionModal: (value) => set((state) => ({ directionModal: { ...state.directionModal, ...value } })),
    setGroupModal: (value) => set((state) => ({ groupModal: { ...state.groupModal, ...value } })),
    setReconciliationOpen: (open) => set({ reconciliationOpen: open }),

    fetchAll: async () => {
      set({ isLoading: true });
      try {
        const [{ data: tariffs }, { data: users }] = await Promise.all([tariffsApi.getList(), usersApi.getList()]);
        set({ tariffs, teachers: users.filter((u) => u.role === 'teacher') });
        await refreshDirections();
      } finally {
        set({ isLoading: false });
      }
    },

    saveDirection: async (dto, id) => {
      set({ isSaving: true });
      try {
        const { data } = id ? await directionsApi.update(id, dto) : await directionsApi.create(dto);
        set({ directions: data });
      } finally {
        set({ isSaving: false });
      }
    },

    saveGroup: async (dto, id) => {
      set({ isSaving: true });
      try {
        if (id) await classGroupsApi.update(id, dto);
        else await classGroupsApi.create(dto);
        await refreshDirections().catch(() => undefined);
      } finally {
        set({ isSaving: false });
      }
    },

    migrateLegacy: async () => {
      set({ isSaving: true });
      try {
        await packagesApi.migrateLegacy();
        await refreshDirections().catch(() => undefined);
        set({ reconciliationOpen: get().reconciliation.length > 0 });
      } finally {
        set({ isSaving: false });
      }
    },
  };
});
```

- [ ] **Step 3: Modals**

`src/pages/classes/ui/DirectionModal.tsx`:

```tsx
import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, FormControlLabel, MenuItem, Switch, TextField } from '@mui/material'
import { useClassesStore } from '../model/classesStore'
import { missedRuleLabels, missedRules, type MissedLessonRule } from '../../../shared/api'

const schema = yup.object({
  name: yup.string().trim().required("Обов'язкове поле").min(2, 'Мінімум 2 символи').max(100, 'Максимум 100 символів'),
  missedRule: yup.mixed<MissedLessonRule>().oneOf(missedRules).required("Обов'язкове поле"),
  isActive: yup.boolean().default(true),
})

type FormValues = yup.InferType<typeof schema>

const defaults: FormValues = { name: '', missedRule: 'no_charge', isActive: true }

export const DirectionModal = () => {
  const { isOpen, direction } = useClassesStore((s) => s.directionModal)
  const setDirectionModal = useClassesStore((s) => s.setDirectionModal)
  const saveDirection = useClassesStore((s) => s.saveDirection)
  const isSaving = useClassesStore((s) => s.isSaving)

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: defaults,
    resolver: yupResolver(schema),
  })

  useEffect(() => {
    if (isOpen) {
      reset(direction ? { name: direction.name, missedRule: direction.missedRule, isActive: direction.isActive } : defaults)
    }
  }, [isOpen, direction, reset])

  const handleClose = () => {
    reset(defaults)
    setDirectionModal({ isOpen: false, direction: null })
  }

  const onSubmit = async (values: FormValues) => {
    await saveDirection(
      { name: values.name.trim(), missedRule: values.missedRule, isActive: values.isActive },
      direction?.id,
    )
    handleClose()
  }

  return (
    <Dialog open={isOpen} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{direction ? 'Редагувати напрям' : 'Новий напрям'}</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: '20px' }}>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Назва" fullWidth error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="missedRule"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} select label="Правило пропусків" fullWidth error={!!error} helperText={error?.message}>
              {missedRules.map((key) => (
                <MenuItem key={key} value={key}>{missedRuleLabels[key]}</MenuItem>
              ))}
            </TextField>
          )}
        />
        {direction && (
          <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label="Активний"
              />
            )}
          />
        )}
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Зберегти
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/classes/ui/GroupModal.tsx`:

```tsx
import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Autocomplete, Box, Button, Dialog, DialogTitle, FormControlLabel, MenuItem, Switch, TextField } from '@mui/material'
import { useClassesStore } from '../model/classesStore'
import { classFormatLabels, classFormats, type ClassFormat } from '../../../shared/api'

const schema = yup.object({
  name: yup.string().trim().required("Обов'язкове поле").min(2, 'Мінімум 2 символи').max(100, 'Максимум 100 символів'),
  format: yup.mixed<ClassFormat>().oneOf(classFormats).required("Обов'язкове поле"),
  teacherIds: yup.array().of(yup.string().required()).default([]),
  singleTariffId: yup.string().default(''),
  packageTariffId: yup.string().default(''),
  isActive: yup.boolean().default(true),
})

type FormValues = yup.InferType<typeof schema>

const defaults: FormValues = { name: '', format: 'group', teacherIds: [], singleTariffId: '', packageTariffId: '', isActive: true }

export const GroupModal = () => {
  const { isOpen, directionId, group } = useClassesStore((s) => s.groupModal)
  const setGroupModal = useClassesStore((s) => s.setGroupModal)
  const saveGroup = useClassesStore((s) => s.saveGroup)
  const tariffs = useClassesStore((s) => s.tariffs)
  const teachers = useClassesStore((s) => s.teachers)
  const isSaving = useClassesStore((s) => s.isSaving)
  const sessionTariffs = tariffs.filter((t) => t.unit === 'session')
  const packageTariffs = tariffs.filter((t) => t.unit === 'package')

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: defaults,
    resolver: yupResolver(schema),
  })

  useEffect(() => {
    if (!isOpen) return
    reset(
      group
        ? {
            name: group.name,
            format: group.format,
            teacherIds: group.teachers.map((t) => t.id),
            singleTariffId: group.singleTariff?.id ?? '',
            packageTariffId: group.packageTariff?.id ?? '',
            isActive: group.isActive,
          }
        : defaults,
    )
  }, [isOpen, group, reset])

  const handleClose = () => {
    reset(defaults)
    setGroupModal({ isOpen: false, directionId: null, group: null })
  }

  const onSubmit = async (values: FormValues) => {
    if (!directionId) return
    await saveGroup(
      {
        name: values.name.trim(),
        directionId,
        format: values.format,
        teacherIds: values.teacherIds,
        singleTariffId: values.singleTariffId || null,
        packageTariffId: values.packageTariffId || null,
        isActive: values.isActive,
      },
      group?.id,
    )
    handleClose()
  }

  return (
    <Dialog open={isOpen} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>{group ? 'Редагувати групу' : 'Нова група'}</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: '20px' }}>
        <Controller
          name="name"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Назва" fullWidth error={!!error} helperText={error?.message} />
          )}
        />
        <Controller
          name="format"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} select label="Формат" fullWidth error={!!error} helperText={error?.message}>
              {classFormats.map((key) => (
                <MenuItem key={key} value={key}>{classFormatLabels[key]}</MenuItem>
              ))}
            </TextField>
          )}
        />
        <Controller
          name="teacherIds"
          control={control}
          render={({ field }) => (
            <Autocomplete
              multiple
              options={teachers}
              getOptionLabel={(t) => `${t.lastName} ${t.firstName}`}
              value={teachers.filter((t) => field.value.includes(t.id))}
              onChange={(_, selected) => field.onChange(selected.map((t) => t.id))}
              renderInput={(params) => <TextField {...params} label="Педагоги" />}
            />
          )}
        />
        <Controller
          name="singleTariffId"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Тариф разового заняття" fullWidth>
              <MenuItem value="">Немає</MenuItem>
              {sessionTariffs.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
              ))}
            </TextField>
          )}
        />
        <Controller
          name="packageTariffId"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Тариф пакета" fullWidth>
              <MenuItem value="">Немає</MenuItem>
              {packageTariffs.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
              ))}
            </TextField>
          )}
        />
        {group && (
          <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label="Активна"
              />
            )}
          />
        )}
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Зберегти
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

`src/pages/classes/ui/ReconciliationDialog.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { Button, Dialog, DialogTitle, Table, TableBody, TableCell, TableHead, TableRow, Box } from '@mui/material'
import { useClassesStore } from '../model/classesStore'
import { formatMoney } from '../../../shared/api'

export const ReconciliationDialog = () => {
  const open = useClassesStore((s) => s.reconciliationOpen)
  const setOpen = useClassesStore((s) => s.setReconciliationOpen)
  const items = useClassesStore((s) => s.reconciliation)
  const navigate = useNavigate()

  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>Потребує звірки</DialogTitle>
      <Box sx={{ p: '20px' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Учень</TableCell>
              <TableCell>Напрям</TableCell>
              <TableCell align="right">Залишок</TableCell>
              <TableCell align="right">Повна ціна</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.child.lastName} {item.child.firstName}</TableCell>
                <TableCell>{item.directionName}</TableCell>
                <TableCell align="right">{item.remaining} з {item.sessionsTotal}</TableCell>
                <TableCell align="right">{formatMoney(item.totalPrice)}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => navigate(`/finance/${item.child.id}`)}>
                    Відкрити
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 4: Page `src/pages/classes/ui/ClassesPage.tsx`**

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useClassesStore } from '../model/classesStore'
import { classFormatLabels, missedRuleLabels } from '../../../shared/api'
import { DirectionModal } from './DirectionModal'
import { GroupModal } from './GroupModal'
import { ReconciliationDialog } from './ReconciliationDialog'

export const ClassesPage = () => {
  const directions = useClassesStore((s) => s.directions)
  const reconciliation = useClassesStore((s) => s.reconciliation)
  const isSaving = useClassesStore((s) => s.isSaving)
  const fetchAll = useClassesStore((s) => s.fetchAll)
  const setDirectionModal = useClassesStore((s) => s.setDirectionModal)
  const setGroupModal = useClassesStore((s) => s.setGroupModal)
  const setReconciliationOpen = useClassesStore((s) => s.setReconciliationOpen)
  const migrateLegacy = useClassesStore((s) => s.migrateLegacy)
  const navigate = useNavigate()

  useEffect(() => {
    fetchAll().catch(() => undefined)
  }, [fetchAll])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>
          Напрямів: {directions.length}
        </Typography>
        {reconciliation.length > 0 && (
          <Button color="warning" variant="outlined" onClick={() => setReconciliationOpen(true)}>
            Потребує звірки: {reconciliation.length}
          </Button>
        )}
        <Button variant="outlined" disabled={isSaving} onClick={() => migrateLegacy().catch(() => undefined)}>
          Перенести старі абонементи
        </Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDirectionModal({ isOpen: true, direction: null })}>
          Створити напрям
        </Button>
      </Box>

      {directions.length === 0 && (
        <Typography color="text.secondary">Напрямів ще немає. Натисніть «Створити напрям».</Typography>
      )}

      {directions.map((direction) => (
        <Paper key={direction.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>{direction.name}</Typography>
            <Chip size="small" variant="outlined" label={missedRuleLabels[direction.missedRule]} />
            {!direction.isActive && <Chip size="small" label="Неактивний" />}
            <Tooltip title="Редагувати напрям">
              <IconButton size="small" onClick={() => setDirectionModal({ isOpen: true, direction })}>
                <EditOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              startIcon={<AddIcon />}
              sx={{ ml: 'auto' }}
              onClick={() => setGroupModal({ isOpen: true, directionId: direction.id, group: null })}
            >
              Створити групу
            </Button>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>Група</TableCell>
                <TableCell>Формат</TableCell>
                <TableCell>Педагоги</TableCell>
                <TableCell align="right">Дітей</TableCell>
                <TableCell>Тарифи</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {direction.groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>Груп ще немає.</TableCell>
                </TableRow>
              ) : (
                direction.groups.map((group) => (
                  <TableRow key={group.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/classes/${group.id}`)}>
                    <TableCell sx={{ fontWeight: 500 }}>
                      {group.name}
                      {!group.isActive && ' (неактивна)'}
                    </TableCell>
                    <TableCell>{classFormatLabels[group.format]}</TableCell>
                    <TableCell>{group.teachers.map((t) => `${t.lastName} ${t.firstName}`).join(', ') || '—'}</TableCell>
                    <TableCell align="right">{group.activeMembers}</TableCell>
                    <TableCell>
                      {[group.singleTariff?.name, group.packageTariff?.name].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Редагувати групу">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation()
                            setGroupModal({ isOpen: true, directionId: direction.id, group })
                          }}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Paper>
      ))}

      <DirectionModal />
      <GroupModal />
      <ReconciliationDialog />
    </Box>
  )
}
```

`src/pages/classes/index.ts`:

```ts
export { ClassesPage } from './ui/ClassesPage'
```

Router: import `ClassesPage` and replace `{ path: 'classes', element: <EmptyPage title="Класи" /> }` with `{ path: 'classes', element: <ClassesPage /> }`.

- [ ] **Step 5: Verify and commit**

tsc diff vs baseline empty; `npx eslint src/shared/api src/pages/classes src/app/router/index.tsx` 0 errors.

```bash
git add src/shared/api src/pages/classes src/app/router/index.tsx
git commit -m "feat: add classes API client and directions page"
```

---

### Task 11: Group page, lesson marking and Мої заняття

**Files:**
- Create: `src/pages/classGroup/model/classGroupStore.ts`, `src/pages/classGroup/model/markLessonStore.ts`
- Create: `src/pages/classGroup/ui/ClassGroupPage.tsx`, `AddMemberModal.tsx`, `MarkLessonPage.tsx`, `src/pages/classGroup/index.ts`
- Create: `src/pages/myClasses/ui/MyClassesPage.tsx`, `src/pages/myClasses/index.ts`
- Modify: `src/app/router/index.tsx`

**Interfaces:**
- Consumes: `classGroupsApi`, `childrenApi`, `attendanceStatusLabels`, `attendanceStatuses`, `formatDay`, `localToday`, `ReasonDialog`, `useAuthStore`, `SessionRole`.
- Produces routes `/classes/:groupId`, `/classes/:groupId/lessons/:date`, `/my-classes`.

- [ ] **Step 1: Group store `src/pages/classGroup/model/classGroupStore.ts`**

```ts
import { create } from 'zustand';
import { childrenApi, classGroupsApi, type Child, type ClassGroupDetail } from '../../../shared/api';

interface ClassGroupState {
  groupId: string | null;
  group: ClassGroupDetail | null;
  children: Child[];
  isLoading: boolean;
  isSaving: boolean;
  addMemberOpen: boolean;
  setAddMemberOpen: (open: boolean) => void;
  fetchGroup: (groupId: string, withChildren: boolean) => Promise<void>;
  addMember: (childId: string, startDate: string) => Promise<void>;
  endMember: (memberId: string, endDate: string) => Promise<void>;
}

export const useClassGroupStore = create<ClassGroupState>((set, get) => {
  const apply = async (groupId: string, request: () => Promise<{ data: ClassGroupDetail }>) => {
    set({ isSaving: true });
    try {
      const { data } = await request();
      if (get().groupId === groupId) set({ group: data });
    } finally {
      set({ isSaving: false });
    }
  };

  return {
    groupId: null,
    group: null,
    children: [],
    isLoading: false,
    isSaving: false,
    addMemberOpen: false,

    setAddMemberOpen: (open) => set({ addMemberOpen: open }),

    fetchGroup: async (groupId, withChildren) => {
      set({ isLoading: true, groupId, group: null });
      try {
        const [{ data: group }, children] = await Promise.all([
          classGroupsApi.get(groupId),
          withChildren ? childrenApi.getList().then((r) => r.data) : Promise.resolve([] as Child[]),
        ]);
        if (get().groupId === groupId) set({ group, children });
      } finally {
        set({ isLoading: false });
      }
    },

    addMember: async (childId, startDate) => {
      const { groupId } = get();
      if (!groupId) return;
      await apply(groupId, () => classGroupsApi.addMember(groupId, { childId, startDate }));
    },

    endMember: async (memberId, endDate) => {
      const { groupId } = get();
      if (!groupId) return;
      await apply(groupId, () => classGroupsApi.endMember(memberId, endDate));
    },
  };
});
```

- [ ] **Step 2: `AddMemberModal.tsx`**

```tsx
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Autocomplete, Box, Button, Dialog, DialogTitle, TextField } from '@mui/material'
import { useClassGroupStore } from '../model/classGroupStore'
import { localToday } from '../../../shared/api'

const schema = yup.object({
  childId: yup.string().required("Обов'язкове поле"),
  startDate: yup.string().required("Обов'язкове поле"),
})

type FormValues = yup.InferType<typeof schema>

export const AddMemberModal = () => {
  const open = useClassGroupStore((s) => s.addMemberOpen)
  const setOpen = useClassGroupStore((s) => s.setAddMemberOpen)
  const children = useClassGroupStore((s) => s.children)
  const addMember = useClassGroupStore((s) => s.addMember)
  const isSaving = useClassGroupStore((s) => s.isSaving)

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { childId: '', startDate: localToday() },
    resolver: yupResolver(schema),
  })

  const handleClose = () => {
    reset({ childId: '', startDate: localToday() })
    setOpen(false)
  }

  const onSubmit = async (values: FormValues) => {
    await addMember(values.childId, values.startDate)
    handleClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Додати дитину</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: '20px' }}>
        <Controller
          name="childId"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <Autocomplete
              options={children}
              getOptionLabel={(c) => `${c.lastName} ${c.firstName}`}
              value={children.find((c) => c.id === field.value) ?? null}
              onChange={(_, selected) => field.onChange(selected?.id ?? '')}
              renderInput={(params) => (
                <TextField {...params} label="Дитина" error={!!error} helperText={error?.message} />
              )}
            />
          )}
        />
        <Controller
          name="startDate"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField
              {...field}
              label="Дата входу"
              type="date"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!error}
              helperText={error?.message}
            />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Додати
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 3: `ClassGroupPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import { useClassGroupStore } from '../model/classGroupStore'
import { useAuthStore, type SessionRole } from '../../../entities/user'
import { attendanceStatusLabels, classFormatLabels, formatDay, localToday, missedRuleLabels } from '../../../shared/api'
import { AddMemberModal } from './AddMemberModal'

export const ClassGroupPage = () => {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role) as SessionRole | undefined
  const isAdmin = role === 'root' || role === 'admin'
  const group = useClassGroupStore((s) => s.group)
  const storeGroupId = useClassGroupStore((s) => s.groupId)
  const fetchGroup = useClassGroupStore((s) => s.fetchGroup)
  const setAddMemberOpen = useClassGroupStore((s) => s.setAddMemberOpen)
  const endMember = useClassGroupStore((s) => s.endMember)
  const isSaving = useClassGroupStore((s) => s.isSaving)
  const [lessonDate, setLessonDate] = useState(localToday())

  useEffect(() => {
    if (groupId) fetchGroup(groupId, isAdmin).catch(() => undefined)
  }, [groupId, isAdmin, fetchGroup])

  if (!group || storeGroupId !== groupId) {
    return <Typography color="text.secondary">Завантаження…</Typography>
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate(isAdmin ? '/classes' : '/my-classes')}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ mr: 'auto' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{group.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {group.direction.name} · {classFormatLabels[group.format]} · {missedRuleLabels[group.direction.missedRule]}
          </Typography>
        </Box>
        <TextField
          size="small"
          type="date"
          label="Дата заняття"
          value={lessonDate}
          onChange={(e) => setLessonDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: localToday() } }}
        />
        <Button
          variant="contained"
          startIcon={<EventAvailableIcon />}
          disabled={!lessonDate}
          onClick={() => navigate(`/classes/${group.id}/lessons/${lessonDate}`)}
        >
          Відмітити заняття
        </Button>
      </Box>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', p: 2 }}>
          <Typography sx={{ fontWeight: 700, mr: 'auto' }}>Склад ({group.activeMembers})</Typography>
          {isAdmin && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setAddMemberOpen(true)}>
              Додати дитину
            </Button>
          )}
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Дитина</TableCell>
              <TableCell>З</TableCell>
              <TableCell>По</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {group.members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} sx={{ color: 'text.secondary' }}>Дітей ще немає.</TableCell>
              </TableRow>
            ) : (
              group.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.child.lastName} {m.child.firstName}</TableCell>
                  <TableCell>{formatDay(m.startDate)}</TableCell>
                  <TableCell>{m.endDate ? formatDay(m.endDate) : '—'}</TableCell>
                  <TableCell align="right">
                    {isAdmin && !m.endDate && (
                      <Button
                        size="small"
                        color="error"
                        disabled={isSaving}
                        onClick={() => endMember(m.id, localToday()).catch(() => undefined)}
                      >
                        Вивести сьогодні
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Typography sx={{ fontWeight: 700, p: 2 }}>Заняття</Typography>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Дата</TableCell>
              <TableCell>Провів</TableCell>
              <TableCell>Відмітки</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {group.lessons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>Занять ще не було.</TableCell>
              </TableRow>
            ) : (
              group.lessons.map((l) => (
                <TableRow
                  key={l.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/classes/${group.id}/lessons/${l.date.slice(0, 10)}`)}
                >
                  <TableCell>{formatDay(l.date)}</TableCell>
                  <TableCell>{l.conductedBy.lastName} {l.conductedBy.firstName}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {l.attendances.map((a) => (
                        <Chip
                          key={a.childId}
                          size="small"
                          variant="outlined"
                          color={a.status === 'present' ? 'success' : 'default'}
                          label={`${a.childName}: ${attendanceStatusLabels[a.status]}${a.isGuest ? ' (разово)' : ''}`}
                        />
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      {isAdmin && <AddMemberModal />}
    </Box>
  )
}
```

- [ ] **Step 4: Mark lesson store `src/pages/classGroup/model/markLessonStore.ts`**

```ts
import { create } from 'zustand';
import { childrenApi, classGroupsApi, type AttendanceStatus, type Child, type LessonRoster } from '../../../shared/api';

interface MarkLessonState {
  key: string | null;
  roster: LessonRoster | null;
  draft: Record<string, AttendanceStatus>;
  guests: Child[];
  allChildren: Child[];
  isLoading: boolean;
  isSaving: boolean;
  load: (groupId: string, date: string, withChildren: boolean) => Promise<void>;
  setStatus: (childId: string, status: AttendanceStatus) => void;
  addGuest: (child: Child) => void;
  save: (reason?: string) => Promise<void>;
}

const draftFrom = (roster: LessonRoster) =>
  Object.fromEntries(
    roster.rows.filter((r) => r.attendance).map((r) => [r.child.id, (r.attendance as { status: AttendanceStatus }).status]),
  ) as Record<string, AttendanceStatus>;

export const useMarkLessonStore = create<MarkLessonState>((set, get) => ({
  key: null,
  roster: null,
  draft: {},
  guests: [],
  allChildren: [],
  isLoading: false,
  isSaving: false,

  load: async (groupId, date, withChildren) => {
    const key = `${groupId}/${date}`;
    set({ key, roster: null, draft: {}, guests: [], isLoading: true });
    try {
      const [{ data: roster }, allChildren] = await Promise.all([
        classGroupsApi.getRoster(groupId, date),
        withChildren ? childrenApi.getList().then((r) => r.data) : Promise.resolve([] as Child[]),
      ]);
      if (get().key === key) set({ roster, draft: draftFrom(roster), allChildren });
    } finally {
      set({ isLoading: false });
    }
  },

  setStatus: (childId, status) => set((state) => ({ draft: { ...state.draft, [childId]: status } })),

  addGuest: (child) =>
    set((state) =>
      state.guests.some((g) => g.id === child.id) || state.roster?.rows.some((r) => r.child.id === child.id)
        ? state
        : { guests: [...state.guests, child] },
    ),

  save: async (reason) => {
    const { roster, draft, guests, key } = get();
    if (!roster || !key) return;
    const memberIds = new Set(roster.rows.filter((r) => r.isMember).map((r) => r.child.id));
    const guestIds = new Set([
      ...guests.map((g) => g.id),
      ...roster.rows.filter((r) => r.attendance?.isGuest).map((r) => r.child.id),
    ]);
    const marks = Object.entries(draft).map(([childId, status]) => ({
      childId,
      status,
      isGuest: !memberIds.has(childId) && guestIds.has(childId) ? true : undefined,
    }));
    if (marks.length === 0) return;
    set({ isSaving: true });
    try {
      const { data } = await classGroupsApi.mark(roster.group.id, key.split('/')[1], {
        marks,
        reason: reason || undefined,
      });
      if (get().key === key) set({ roster: data, draft: draftFrom(data), guests: [] });
    } finally {
      set({ isSaving: false });
    }
  },
}));
```

- [ ] **Step 5: `MarkLessonPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useMarkLessonStore } from '../model/markLessonStore'
import { useAuthStore, type SessionRole } from '../../../entities/user'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import {
  attendanceStatusLabels,
  attendanceStatuses,
  formatDay,
  localToday,
  type AttendanceStatus,
  type Child,
} from '../../../shared/api'

export const MarkLessonPage = () => {
  const { groupId, date } = useParams<{ groupId: string; date: string }>()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role) as SessionRole | undefined
  const isAdmin = role === 'root' || role === 'admin'
  const roster = useMarkLessonStore((s) => s.roster)
  const storeKey = useMarkLessonStore((s) => s.key)
  const draft = useMarkLessonStore((s) => s.draft)
  const guests = useMarkLessonStore((s) => s.guests)
  const allChildren = useMarkLessonStore((s) => s.allChildren)
  const isSaving = useMarkLessonStore((s) => s.isSaving)
  const load = useMarkLessonStore((s) => s.load)
  const setStatus = useMarkLessonStore((s) => s.setStatus)
  const addGuest = useMarkLessonStore((s) => s.addGuest)
  const save = useMarkLessonStore((s) => s.save)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [guest, setGuest] = useState<Child | null>(null)

  useEffect(() => {
    if (groupId && date) load(groupId, date, true).catch(() => undefined)
  }, [groupId, date, load])

  if (!roster || storeKey !== `${groupId}/${date}`) {
    return <Typography color="text.secondary">Завантаження…</Typography>
  }

  const isLate = (date ?? '') < localToday()
  const hasCorrections = roster.rows.some((r) => r.attendance && draft[r.child.id] && draft[r.child.id] !== r.attendance.status)
  const rows = [
    ...roster.rows,
    ...guests.map((g) => ({
      child: { id: g.id, firstName: g.firstName, lastName: g.lastName },
      isMember: false,
      attendance: null,
      packageInfo: null,
    })),
  ]

  const handleSave = () => {
    if (isAdmin && isLate && hasCorrections) {
      setReasonOpen(true)
      return
    }
    save().catch(() => undefined)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate(`/classes/${roster.group.id}`)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ mr: 'auto' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{roster.group.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDay(roster.date)}
            {roster.conductedBy ? ` · провів ${roster.conductedBy.lastName} ${roster.conductedBy.firstName}` : ''}
          </Typography>
        </Box>
        <Button variant="contained" disabled={isSaving} onClick={handleSave}>
          Зберегти
        </Button>
      </Box>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell>Дитина</TableCell>
              <TableCell>Пакет</TableCell>
              <TableCell>Статус</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>У групі немає дітей на цю дату.</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.child.id}>
                  <TableCell>
                    {row.child.lastName} {row.child.firstName}
                    {!row.isMember && <Chip size="small" label="Разово" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>
                    {row.packageInfo ? (
                      <Chip
                        size="small"
                        color="success"
                        variant="outlined"
                        label={`Пакет: ${row.packageInfo.remaining} з ${row.packageInfo.total}${
                          row.packageInfo.expiresAt ? `, до ${formatDay(row.packageInfo.expiresAt)}` : ''
                        }`}
                      />
                    ) : (
                      <Chip size="small" color="warning" variant="outlined" label="Без пакета — разове заняття" />
                    )}
                  </TableCell>
                  <TableCell>
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={draft[row.child.id] ?? null}
                      onChange={(_, value: AttendanceStatus | null) => {
                        if (value) setStatus(row.child.id, value)
                      }}
                    >
                      {attendanceStatuses.map((s) => (
                        <ToggleButton key={s} value={s}>
                          {attendanceStatusLabels[s]}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Autocomplete
            sx={{ minWidth: 320 }}
            options={allChildren}
            getOptionLabel={(c) => `${c.lastName} ${c.firstName}`}
            value={guest}
            onChange={(_, selected) => setGuest(selected)}
            renderInput={(params) => <TextField {...params} size="small" label="Разовий учасник" />}
          />
          <Button
            disabled={!guest}
            onClick={() => {
              if (guest) addGuest(guest)
              setGuest(null)
            }}
          >
            Додати
          </Button>
        </Box>

      <ReasonDialog
        open={reasonOpen}
        title="Виправлення відмітки"
        subtitle="Заняття вже минуло. Вкажіть причину виправлення."
        confirmLabel="Зберегти"
        isSaving={isSaving}
        onClose={() => setReasonOpen(false)}
        onSubmit={(reason) => save(reason)}
      />
    </Box>
  )
}
```

`GET /children` allows teachers (`@Roles(root, admin, teacher)` in `children.controller.ts`), so the guest picker is shown to every role, matching the spec (teacher may add guests).

`src/pages/classGroup/index.ts`:

```ts
export { ClassGroupPage } from './ui/ClassGroupPage'
export { MarkLessonPage } from './ui/MarkLessonPage'
```

- [ ] **Step 6: Мої заняття `src/pages/myClasses/ui/MyClassesPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Card, CardActions, CardContent, Typography } from '@mui/material'
import { classFormatLabels, classGroupsApi, localToday, type MyClassGroup } from '../../../shared/api'

export const MyClassesPage = () => {
  const [groups, setGroups] = useState<MyClassGroup[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    classGroupsApi
      .getMine()
      .then(({ data }) => {
        if (active) setGroups(data)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  if (!groups) return <Typography color="text.secondary">Завантаження…</Typography>
  if (groups.length === 0) return <Typography color="text.secondary">Вам ще не призначено груп.</Typography>

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
      {groups.map((g) => (
        <Card key={g.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <CardContent>
            <Typography sx={{ fontWeight: 700 }}>{g.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {g.direction.name} · {classFormatLabels[g.format]} · дітей: {g.activeMembers}
            </Typography>
          </CardContent>
          <CardActions>
            <Button size="small" variant="contained" onClick={() => navigate(`/classes/${g.id}/lessons/${localToday()}`)}>
              Відмітити сьогодні
            </Button>
            <Button size="small" onClick={() => navigate(`/classes/${g.id}`)}>
              Історія
            </Button>
          </CardActions>
        </Card>
      ))}
    </Box>
  )
}
```

The local `useState` here (instead of a store) is deliberate: the page is read-only with no modals; if the reviewer insists on a store per conventions, move it into `src/pages/myClasses/model/myClassesStore.ts` with the same fetch.

`src/pages/myClasses/index.ts`:

```ts
export { MyClassesPage } from './ui/MyClassesPage'
```

- [ ] **Step 7: Routes**

In the router add imports and routes after `classes`:

```tsx
          { path: 'classes/:groupId',               element: <ClassGroupPage /> },
          { path: 'classes/:groupId/lessons/:date', element: <MarkLessonPage /> },
          { path: 'my-classes',                     element: <MyClassesPage /> },
```

- [ ] **Step 8: Verify and commit**

tsc diff vs baseline empty; `npx eslint src/pages/classGroup src/pages/myClasses src/app/router/index.tsx` 0 errors.

```bash
git add src/pages/classGroup src/pages/myClasses src/app/router/index.tsx
git commit -m "feat: add class group page, lesson marking and teacher view"
```

---

### Task 12: Пакети tab and tariff validity days

**Files:**
- Create: `src/pages/finance/model/packagesStore.ts`
- Create: `src/pages/finance/ui/PackagesTab.tsx`, `BuyPackageModal.tsx`, `ExtendPackageModal.tsx`, `ReconcileModal.tsx`
- Modify: `src/pages/finance/ui/ChildFinancePage.tsx`
- Modify: `src/shared/api/tariffs.ts`, `src/pages/tariffs/ui/CreateTariffModal.tsx`, `src/pages/tariffs/ui/TariffModal.tsx`

**Interfaces:**
- Consumes: `packagesApi`, `directionsApi`, `tariffsApi`, labels, `ReasonDialog`, `useChildFinanceStore.fetchFinance`, `normalizeAmount`, `toKopecks`, `formatMoney`, `formatDay`, `localToday`.

- [ ] **Step 1: Tariff validity days on the frontend**

`src/shared/api/tariffs.ts`: add `validityDays: number | null;` to `Tariff`, `validityDays?: number;` to `CreateTariffDto`, `validityDays?: number | null;` to `UpdateTariffDto`.

`CreateTariffModal.tsx`: add to the schema

```ts
  validityDays: yup.string().default('').test('validity', 'Від 1 до 3650 днів або порожньо', (value) => {
    if (!value) return true
    const days = Number(value)
    return Number.isInteger(days) && days >= 1 && days <= 3650
  }),
```

add `validityDays: ''` to `defaults`; next to the `packageSize` field (shown only for `unit === 'package'`) render:

```tsx
            <Controller
              name="validityDays"
              control={control}
              render={({ field, fieldState: { error } }) => (
                <TextField {...field} label="Діє днів (порожньо — без терміну)" fullWidth error={!!error} helperText={error?.message} />
              )}
            />
```

and in `onSubmit` add `validityDays: values.unit === 'package' && values.validityDays ? Number(values.validityDays) : undefined,`.

`TariffModal.tsx`: after the category/unit line add, when `tariff.unit === 'package'`, `<Typography variant="body2" color="text.secondary">Термін дії: {tariff.validityDays ? `${tariff.validityDays} дн.` : 'без терміну'}</Typography>`.

- [ ] **Step 2: Store `src/pages/finance/model/packagesStore.ts`**

```ts
import { create } from 'zustand';
import {
  directionsApi,
  packagesApi,
  tariffsApi,
  type ChildPackage,
  type Direction,
  type PurchasePackageDto,
  type ReconcileDto,
  type Tariff,
} from '../../../shared/api';
import { useChildFinanceStore } from './childFinanceStore';

export type PackageReasonTarget = { kind: 'void'; pkg: ChildPackage } | null;

interface PackagesState {
  childId: string | null;
  packages: ChildPackage[];
  directions: Direction[];
  tariffs: Tariff[];
  isLoading: boolean;
  isSaving: boolean;
  buyOpen: boolean;
  extendTarget: ChildPackage | null;
  reconcileTarget: ChildPackage | null;
  voidTarget: ChildPackage | null;
  setBuyOpen: (open: boolean) => void;
  setExtendTarget: (pkg: ChildPackage | null) => void;
  setReconcileTarget: (pkg: ChildPackage | null) => void;
  setVoidTarget: (pkg: ChildPackage | null) => void;
  fetchPackages: (childId: string) => Promise<void>;
  purchase: (dto: PurchasePackageDto) => Promise<void>;
  extend: (id: string, newExpiresAt: string, reason: string) => Promise<void>;
  voidPackage: (reason: string) => Promise<void>;
  reconcile: (id: string, dto: ReconcileDto) => Promise<void>;
}

export const usePackagesStore = create<PackagesState>((set, get) => {
  const mutate = async (request: () => Promise<{ data: ChildPackage[] }>) => {
    const childId = get().childId;
    set({ isSaving: true });
    try {
      const { data } = await request();
      if (get().childId === childId) {
        set({ packages: data });
        if (childId) await useChildFinanceStore.getState().fetchFinance(childId).catch(() => undefined);
      }
    } finally {
      set({ isSaving: false });
    }
  };

  return {
    childId: null,
    packages: [],
    directions: [],
    tariffs: [],
    isLoading: false,
    isSaving: false,
    buyOpen: false,
    extendTarget: null,
    reconcileTarget: null,
    voidTarget: null,

    setBuyOpen: (open) => set({ buyOpen: open }),
    setExtendTarget: (pkg) => set({ extendTarget: pkg }),
    setReconcileTarget: (pkg) => set({ reconcileTarget: pkg }),
    setVoidTarget: (pkg) => set({ voidTarget: pkg }),

    fetchPackages: async (childId) => {
      set({ isLoading: true, childId, packages: [] });
      try {
        const [{ data: packages }, { data: directions }, { data: tariffs }] = await Promise.all([
          packagesApi.getByChild(childId),
          directionsApi.getList(),
          tariffsApi.getList(),
        ]);
        if (get().childId === childId) set({ packages, directions, tariffs });
      } finally {
        set({ isLoading: false });
      }
    },

    purchase: (dto) =>
      mutate(() => {
        const childId = get().childId;
        if (!childId) throw new Error('Child is not selected');
        return packagesApi.purchase(childId, dto);
      }),

    extend: (id, newExpiresAt, reason) => mutate(() => packagesApi.extend(id, { newExpiresAt, reason })),

    voidPackage: async (reason) => {
      const target = get().voidTarget;
      if (!target) return;
      await mutate(() => packagesApi.void(target.id, reason));
    },

    reconcile: (id, dto) => mutate(() => packagesApi.reconcile(id, dto)),
  };
});
```

Remove the unused `PackageReasonTarget` export if eslint flags it.

- [ ] **Step 3: `BuyPackageModal.tsx`**

```tsx
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, MenuItem, TextField } from '@mui/material'
import { usePackagesStore } from '../model/packagesStore'
import { formatMoney, localToday } from '../../../shared/api'

const schema = yup.object({
  directionId: yup.string().required("Обов'язкове поле"),
  tariffId: yup.string().required("Обов'язкове поле"),
  purchaseDate: yup.string().required("Обов'язкове поле"),
})

type FormValues = yup.InferType<typeof schema>

export const BuyPackageModal = () => {
  const open = usePackagesStore((s) => s.buyOpen)
  const setOpen = usePackagesStore((s) => s.setBuyOpen)
  const directions = usePackagesStore((s) => s.directions)
  const tariffs = usePackagesStore((s) => s.tariffs)
  const purchase = usePackagesStore((s) => s.purchase)
  const isSaving = usePackagesStore((s) => s.isSaving)
  const packageTariffs = tariffs.filter((t) => t.unit === 'package' && t.isActive)
  const activeDirections = directions.filter((d) => d.isActive)

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { directionId: '', tariffId: '', purchaseDate: localToday() },
    resolver: yupResolver(schema),
  })

  const handleClose = () => {
    reset({ directionId: '', tariffId: '', purchaseDate: localToday() })
    setOpen(false)
  }

  const onSubmit = async (values: FormValues) => {
    await purchase(values)
    handleClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Купити пакет</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: '20px' }}>
        <Controller
          name="directionId"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} select label="Напрям" fullWidth error={!!error} helperText={error?.message}>
              {activeDirections.map((d) => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </TextField>
          )}
        />
        <Controller
          name="tariffId"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} select label="Тариф пакета" fullWidth error={!!error} helperText={error?.message}>
              {packageTariffs.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                  {t.currentPrice ? ` — ${formatMoney(t.currentPrice)}` : ''}
                  {t.packageSize ? `, ${t.packageSize} зан.` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
        <Controller
          name="purchaseDate"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField
              {...field}
              label="Дата купівлі"
              type="date"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!error}
              helperText={error?.message}
            />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Купити
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 4: `ExtendPackageModal.tsx`**

```tsx
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, TextField, Typography } from '@mui/material'
import { usePackagesStore } from '../model/packagesStore'
import { formatDay } from '../../../shared/api'

const schema = yup.object({
  newExpiresAt: yup.string().required("Обов'язкове поле"),
  reason: yup.string().trim().required('Вкажіть причину').max(500, 'Максимум 500 символів'),
})

type FormValues = yup.InferType<typeof schema>

export const ExtendPackageModal = () => {
  const target = usePackagesStore((s) => s.extendTarget)
  const setTarget = usePackagesStore((s) => s.setExtendTarget)
  const extend = usePackagesStore((s) => s.extend)
  const isSaving = usePackagesStore((s) => s.isSaving)

  const { control, handleSubmit, reset } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { newExpiresAt: '', reason: '' },
    resolver: yupResolver(schema),
  })

  const handleClose = () => {
    reset({ newExpiresAt: '', reason: '' })
    setTarget(null)
  }

  const onSubmit = async (values: FormValues) => {
    if (!target) return
    await extend(target.id, values.newExpiresAt, values.reason.trim())
    handleClose()
  }

  return (
    <Dialog open={target !== null} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Продовжити пакет</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: '20px' }}>
        <Typography variant="body2" color="text.secondary">
          {target?.direction.name}. Поточний термін: {target?.expiresAt ? formatDay(target.expiresAt) : 'без терміну'}
        </Typography>
        <Controller
          name="newExpiresAt"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField
              {...field}
              label="Новий термін"
              type="date"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              error={!!error}
              helperText={error?.message}
            />
          )}
        />
        <Controller
          name="reason"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Причина" fullWidth multiline error={!!error} helperText={error?.message} />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Зберегти
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 5: `ReconcileModal.tsx`**

```tsx
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Dialog, DialogTitle, MenuItem, TextField, Typography } from '@mui/material'
import { usePackagesStore } from '../model/packagesStore'
import {
  formatMoney,
  normalizeAmount,
  reconcileOutcomeLabels,
  toKopecks,
  type ReconcileOutcome,
} from '../../../shared/api'

const outcomes = Object.keys(reconcileOutcomeLabels) as ReconcileOutcome[]
const amountPattern = /^\d{1,8}([.,]\d{1,2})?$/

const schema = yup.object({
  outcome: yup.mixed<ReconcileOutcome>().oneOf(outcomes).required("Обов'язкове поле"),
  paidAmount: yup.string().trim().default(''),
  note: yup.string().default('').max(500, 'Максимум 500 символів'),
})

type FormValues = yup.InferType<typeof schema>

const defaults: FormValues = { outcome: 'paid_full', paidAmount: '', note: '' }

export const ReconcileModal = () => {
  const target = usePackagesStore((s) => s.reconcileTarget)
  const setTarget = usePackagesStore((s) => s.setReconcileTarget)
  const reconcile = usePackagesStore((s) => s.reconcile)
  const isSaving = usePackagesStore((s) => s.isSaving)

  const { control, handleSubmit, reset, watch, setError } = useForm<FormValues>({
    mode: 'all',
    defaultValues: defaults,
    resolver: yupResolver(schema),
  })
  const outcome = watch('outcome')
  const total = toKopecks(target?.legacyTotalPrice ?? '0')

  const handleClose = () => {
    reset(defaults)
    setTarget(null)
  }

  const onSubmit = async (values: FormValues) => {
    if (!target) return
    if (values.outcome === 'paid_partial') {
      const paid = toKopecks(values.paidAmount)
      if (!amountPattern.test(values.paidAmount) || paid <= 0 || paid >= total) {
        setError('paidAmount', { message: 'Сума має бути більшою за 0 і меншою за повну ціну' })
        return
      }
    }
    await reconcile(target.id, {
      outcome: values.outcome,
      paidAmount: values.outcome === 'paid_partial' ? normalizeAmount(values.paidAmount) : undefined,
      note: values.note.trim() || undefined,
    })
    handleClose()
  }

  return (
    <Dialog open={target !== null} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>Звірка пакета</DialogTitle>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: '20px' }}>
        <Typography variant="body2" color="text.secondary">
          {target?.direction.name}: {target?.sessionsTotal} занять, повна ціна{' '}
          {formatMoney(target?.legacyTotalPrice ?? '0')}. Неоплачена частина стане боргом у фінансах.
        </Typography>
        <Controller
          name="outcome"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Результат звірки" fullWidth>
              {outcomes.map((key) => (
                <MenuItem key={key} value={key}>{reconcileOutcomeLabels[key]}</MenuItem>
              ))}
            </TextField>
          )}
        />
        {outcome === 'paid_partial' && (
          <Controller
            name="paidAmount"
            control={control}
            render={({ field, fieldState: { error } }) => (
              <TextField {...field} label="Сплачено, грн" fullWidth error={!!error} helperText={error?.message} />
            )}
          />
        )}
        <Controller
          name="note"
          control={control}
          render={({ field, fieldState: { error } }) => (
            <TextField {...field} label="Примітка" fullWidth multiline error={!!error} helperText={error?.message} />
          )}
        />
        <Box sx={{ display: 'flex', gap: '10px' }}>
          <Button onClick={handleClose} color="inherit" sx={{ width: '100%' }}>
            Скасувати
          </Button>
          <Button onClick={handleSubmit(onSubmit)} variant="contained" disabled={isSaving} sx={{ width: '100%' }}>
            Підтвердити
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 6: `PackagesTab.tsx`**

```tsx
import { Fragment, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { usePackagesStore } from '../model/packagesStore'
import { ReasonDialog } from '../../../shared/ui/ReasonDialog'
import {
  attendanceStatusLabels,
  formatDay,
  packageStateLabels,
  type ChildPackage,
  type PackageState,
} from '../../../shared/api'
import { BuyPackageModal } from './BuyPackageModal'
import { ExtendPackageModal } from './ExtendPackageModal'
import { ReconcileModal } from './ReconcileModal'

const stateColors: Record<PackageState, 'success' | 'default' | 'warning' | 'error'> = {
  active: 'success',
  exhausted: 'default',
  expired: 'warning',
  voided: 'default',
  needs_reconciliation: 'error',
}

const PackageRow = ({ pkg }: { pkg: ChildPackage }) => {
  const [open, setOpen] = useState(false)
  const setExtendTarget = usePackagesStore((s) => s.setExtendTarget)
  const setReconcileTarget = usePackagesStore((s) => s.setReconcileTarget)
  const setVoidTarget = usePackagesStore((s) => s.setVoidTarget)
  const voided = pkg.state === 'voided'

  return (
    <Fragment>
      <TableRow sx={voided ? { '& td': { color: 'text.disabled', textDecoration: 'line-through' } } : undefined}>
        <TableCell sx={{ width: 40 }}>
          <IconButton size="small" aria-label="Деталі пакета" onClick={() => setOpen(!open)}>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ fontWeight: 500 }}>{pkg.direction.name}</TableCell>
        <TableCell>{pkg.tariff?.name ?? 'Перенесений абонемент'}</TableCell>
        <TableCell align="right">{pkg.used} / {pkg.sessionsTotal}</TableCell>
        <TableCell align="right">{pkg.remaining}</TableCell>
        <TableCell>{formatDay(pkg.purchaseDate)}</TableCell>
        <TableCell>{pkg.expiresAt ? formatDay(pkg.expiresAt) : '—'}</TableCell>
        <TableCell>
          <Chip size="small" variant="outlined" color={stateColors[pkg.state]} label={packageStateLabels[pkg.state]} />
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          {pkg.needsReconciliation && !voided && (
            <Button size="small" color="error" onClick={() => setReconcileTarget(pkg)}>
              Звірити
            </Button>
          )}
          {!voided && (
            <Button size="small" onClick={() => setExtendTarget(pkg)}>
              Продовжити
            </Button>
          )}
          {!voided && pkg.used === 0 && !pkg.needsReconciliation && (
            <Button size="small" color="error" onClick={() => setVoidTarget(pkg)}>
              Сторнувати
            </Button>
          )}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={9} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {pkg.voidReason && <Typography variant="body2">Причина сторно: {pkg.voidReason}</Typography>}
              {pkg.reconciliationNote && <Typography variant="body2">Звірка: {pkg.reconciliationNote}</Typography>}
              {pkg.extensions.map((e) => (
                <Typography key={e.id} variant="body2" color="text.secondary">
                  Продовжено до {formatDay(e.newExpiresAt)}: {e.reason}
                </Typography>
              ))}
              {pkg.usages.length === 0 && pkg.legacyAttendances.length === 0 ? (
                <Typography variant="body2" color="text.secondary">Списань ще не було.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Дата</TableCell>
                      <TableCell>Група</TableCell>
                      <TableCell>Статус</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pkg.usages.map((u) => (
                      <TableRow key={u.id} sx={u.voidedAt ? { '& td': { color: 'text.disabled', textDecoration: 'line-through' } } : undefined}>
                        <TableCell>{formatDay(u.date)}</TableCell>
                        <TableCell>{u.groupName}</TableCell>
                        <TableCell>{attendanceStatusLabels[u.status]}</TableCell>
                      </TableRow>
                    ))}
                    {pkg.legacyAttendances.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{formatDay(a.date)}</TableCell>
                        <TableCell>Старий абонемент</TableCell>
                        <TableCell>{a.note ?? 'Відвідування'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  )
}

interface PackagesTabProps {
  childId: string
}

export const PackagesTab = ({ childId }: PackagesTabProps) => {
  const packages = usePackagesStore((s) => s.packages)
  const storeChildId = usePackagesStore((s) => s.childId)
  const fetchPackages = usePackagesStore((s) => s.fetchPackages)
  const setBuyOpen = usePackagesStore((s) => s.setBuyOpen)
  const voidTarget = usePackagesStore((s) => s.voidTarget)
  const setVoidTarget = usePackagesStore((s) => s.setVoidTarget)
  const voidPackage = usePackagesStore((s) => s.voidPackage)
  const isSaving = usePackagesStore((s) => s.isSaving)

  useEffect(() => {
    fetchPackages(childId).catch(() => undefined)
  }, [childId, fetchPackages])

  const rows = storeChildId === childId ? packages : []

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setBuyOpen(true)}>
          Купити пакет
        </Button>
      </Box>
      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Table>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
              <TableCell />
              <TableCell>Напрям</TableCell>
              <TableCell>Тариф</TableCell>
              <TableCell align="right">Використано</TableCell>
              <TableCell align="right">Залишок</TableCell>
              <TableCell>Куплено</TableCell>
              <TableCell>Діє до</TableCell>
              <TableCell>Стан</TableCell>
              <TableCell align="right">Дії</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  Пакетів ще немає.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => <PackageRow key={p.id} pkg={p} />)
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <BuyPackageModal />
      <ExtendPackageModal />
      <ReconcileModal />
      <ReasonDialog
        open={voidTarget !== null}
        title="Сторнувати пакет"
        subtitle="Пакет і його нарахування буде сторновано."
        isSaving={isSaving}
        onClose={() => setVoidTarget(null)}
        onSubmit={voidPackage}
      />
    </Box>
  )
}
```

- [ ] **Step 7: Mount the tab**

In `ChildFinancePage.tsx` import `PackagesTab` and change the tabs to:

```tsx
        <Tab label={`Нарахування (${finance.charges.length})`} />
        <Tab label={`Оплати (${finance.payments.length})`} />
        <Tab label="Абонементи" />
        <Tab label="Пакети" />
        <Tab label="Адаптація" />
        <Tab label="Історія" />
```

and the panels to:

```tsx
      {tab === 0 && <ChargesTable charges={finance.charges} />}
      {tab === 1 && <PaymentsTable payments={finance.payments} />}
      {tab === 2 && <EnrollmentsTab childId={finance.child.id} />}
      {tab === 3 && <PackagesTab childId={finance.child.id} />}
      {tab === 4 && <AdaptationTab childId={finance.child.id} />}
      {tab === 5 && <HistoryTable events={history} />}
```

- [ ] **Step 8: Verify and commit**

tsc diff vs baseline empty; `npx eslint src/pages/finance src/pages/tariffs src/shared/api` 0 errors.

```bash
git add src/pages/finance src/pages/tariffs src/shared/api
git commit -m "feat: add packages tab and tariff validity days"
```

---

### Task 13: Remove old pages, docs, walkthrough

**Files:**
- Modify: `src/widgets/sidebar/model/nav-items.ts`, `src/app/router/index.tsx`
- Modify: `D:\IT\EduNest\CLAUDE.md`

- [ ] **Step 1: Remove old menu items and routes**

Remove the `/subscriptions` and `/subscription-types` items from `navItems` (and their now-unused icon imports) and the two routes plus their page imports from the router. Keep the page folders on disk (legacy, unused).

- [ ] **Step 2: Frontend CLAUDE.md**

Add a short paragraph under "Structure": `pages/classes` (Гуртки), `pages/classGroup` (group + mark lesson), `pages/myClasses` (teacher), `shared/model` (notify store); and that nav items declare `roles`.

- [ ] **Step 3: Verify and commit**

tsc diff vs baseline empty (the removed imports may *remove* lines from baseline output only if they were in it — any reduction is fine, additions are not); `npx eslint src/widgets/sidebar src/app/router` 0 errors.

```bash
git add src/widgets/sidebar src/app/router CLAUDE.md
git commit -m "chore: remove old subscriptions pages from navigation"
```

- [ ] **Step 4: API walkthrough (backend on port 3100)**

Run the spec "Testing → Verification" walkthrough against your own backend (`PORT=3100 npm run start:dev` in `D:\IT\backend-edu-nest`; port 3000 belongs to the user). Root login from `.env`; a teacher user created via `POST /users` (`role: "teacher"`) and logged in with a second cookie jar. Today `T` (Kyiv). Fresh children via `POST /children`. Expected:

1. Direction «Тест LEGO» (`unexcused_only`), tariffs session 300 and package 4 × 1000 with 30 days; group with the teacher and both children from `T`.
2. Package for A → A finance extra_classes charged 1000.00; remaining 4.
3. Teacher `PUT …/lessons/T` A present, B present → A remaining 3; B finance charged 300.00.
4. Second lesson on `T−1` by admin: A excused, B unexcused → A remaining 3 (no usage); B charged 600.00 total.
5. Admin corrects `T−1` B to excused with reason → B back to 300.00; without reason → 400 `Reason is required for a late correction`.
6. Teacher `PUT` on `T−1` with a change → 403 `Only the lesson day can be corrected by a teacher`; teacher on a group not theirs → 403 `Not your class group`.
7. `POST /legacy/subscriptions/migrate` twice → second `packages: 0`; reconcile one legacy package `paid_partial` → charge = total − paid.

Record each request with expected vs actual; stop at the first mismatch; stop only your 3100 server.
