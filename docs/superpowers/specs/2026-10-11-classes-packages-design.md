# Classes and Packages (Part 4 of 7) — Design Spec

**Date:** 2026-10-11
**Project:** Private School/Kindergarten Management System (NestJS + PostgreSQL + Prisma, React admin panel `frontend-edu-nest`)
**Depends on:** Part 1 Finance (`2026-10-11-finance-design.md`), Part 2 Tariffs (`2026-10-11-tariffs-design.md`) — both merged into `main`.

---

## Overview

Extra classes (sport, piano, drawing, LEGO, Minecraft, custom directions): admins define directions with a missed-lesson rule and class groups (individual or group) with fixed members, teachers and tariffs. Children buy session packages (charged into the Part 1 ledger); a teacher marks each lesson (present / excused absence / unexcused absence) for the group members plus guests, and the system consumes a session from the oldest valid package or, if none, charges a single lesson. Corrections reverse the consumption. Current subscriptions are migrated into packages marked "needs reconciliation".

The frontend part also delivers the shared server-error display (frontend Roadmap step 1) and a role-filtered menu.

---

## Decisions Made

| Topic | Decision |
|---|---|
| Missed-lesson rule | Configured per direction: `no_charge` (default), `always`, `unexcused_only` |
| Lesson participants | Fixed group members (membership with start/end dates) + guests added per lesson |
| Payment for a lesson | Consume a session from the oldest valid package of the direction; if none, create a single-lesson charge at the group's single-lesson tariff price on the lesson date |
| Package validity | `validityDays` on the tariff (null = no expiry); admin can extend a specific package with a reason (history kept) |
| Teacher access | Own groups only (assigned teacher): view, mark lessons, add guests; may correct marks only on the lesson day; admin corrects any time |
| Architecture | New entities on top of Part 2 tariffs; remaining sessions computed from usage records (no counters) |
| Old subscriptions | Migrated once into packages with `needsReconciliation`; sessions usable immediately; money appears after reconciliation as an `opening_balance` charge (no fabricated payments); old pages removed from the menu; old attendance rows kept read-only |
| Shared error display | Axios response interceptor shows a translated snackbar for every non-401 error and still rejects; translation map in one place; unknown → «Сталася помилка. Спробуйте ще раз.» |
| Role menu | Nav items declare allowed roles; teacher sees «Мої заняття» (and «Учні»), admin/root see everything |

---

## Prisma Schema

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

`ChargeSource` gets a new value `extra_session`. `Tariff` gets `validityDays Int?`.

```prisma
model Direction {
  id         String           @id @default(uuid())
  name       String           @unique
  missedRule MissedLessonRule @default(no_charge)
  isActive   Boolean          @default(true)
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt

  groups     ClassGroup[]
  packages   Package[]
}

model ClassGroup {
  id              String             @id @default(uuid())
  name            String
  directionId     String
  direction       Direction          @relation(fields: [directionId], references: [id])
  format          ClassFormat
  singleTariffId  String?
  singleTariff    Tariff?            @relation("GroupSingleTariff", fields: [singleTariffId], references: [id], onDelete: Restrict)
  packageTariffId String?
  packageTariff   Tariff?            @relation("GroupPackageTariff", fields: [packageTariffId], references: [id], onDelete: Restrict)
  isActive        Boolean            @default(true)
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  teachers        User[]             @relation("ClassGroupTeachers")
  members         ClassGroupMember[]
  lessons         Lesson[]

  @@unique([directionId, name])
}

model ClassGroupMember {
  id           String     @id @default(uuid())
  classGroupId String
  classGroup   ClassGroup @relation(fields: [classGroupId], references: [id])
  childId      String
  child        Child      @relation(fields: [childId], references: [id])
  startDate    DateTime   @db.Date
  endDate      DateTime?  @db.Date
  createdById  String
  createdBy    User       @relation("MemberCreatedBy", fields: [createdById], references: [id])
  createdAt    DateTime   @default(now())

  @@index([classGroupId])
  @@index([childId])
}

model Package {
  id                   String             @id @default(uuid())
  childId              String
  child                Child              @relation(fields: [childId], references: [id])
  directionId          String
  direction            Direction          @relation(fields: [directionId], references: [id])
  tariffId             String?
  tariff               Tariff?            @relation(fields: [tariffId], references: [id], onDelete: Restrict)
  sessionsTotal        Int
  usedBefore           Int                @default(0)
  purchaseDate         DateTime           @db.Date
  expiresAt            DateTime?          @db.Date
  chargeId             String?            @unique
  charge               Charge?            @relation("PackageCharge", fields: [chargeId], references: [id], onDelete: Restrict)
  legacySubscriptionId String?            @unique
  legacySubscription   Subscription?      @relation(fields: [legacySubscriptionId], references: [id], onDelete: Restrict)
  needsReconciliation  Boolean            @default(false)
  reconciledAt         DateTime?
  reconciledById       String?
  reconciledBy         User?              @relation("PackageReconciledBy", fields: [reconciledById], references: [id], onDelete: Restrict)
  reconciliationNote   String?
  createdById          String?
  createdBy            User?              @relation("PackageCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  createdAt            DateTime           @default(now())

  voidedAt             DateTime?
  voidedById           String?
  voidedBy             User?              @relation("PackageVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason           String?

  extensions           PackageExtension[]
  usages               SessionUsage[]

  @@index([childId, directionId])
}

model PackageExtension {
  id                String    @id @default(uuid())
  packageId         String
  package           Package   @relation(fields: [packageId], references: [id])
  previousExpiresAt DateTime? @db.Date
  newExpiresAt      DateTime  @db.Date
  reason            String
  createdById       String
  createdBy         User      @relation("ExtensionCreatedBy", fields: [createdById], references: [id])
  createdAt         DateTime  @default(now())
}

model Lesson {
  id            String             @id @default(uuid())
  classGroupId  String
  classGroup    ClassGroup         @relation(fields: [classGroupId], references: [id])
  date          DateTime           @db.Date
  conductedById String
  conductedBy   User               @relation("LessonConductedBy", fields: [conductedById], references: [id])
  createdAt     DateTime           @default(now())

  attendances   LessonAttendance[]

  @@unique([classGroupId, date])
}

model LessonAttendance {
  id         String           @id @default(uuid())
  lessonId   String
  lesson     Lesson           @relation(fields: [lessonId], references: [id])
  childId    String
  child      Child            @relation(fields: [childId], references: [id])
  status     AttendanceStatus
  isGuest    Boolean          @default(false)
  markedById String
  markedBy   User             @relation("AttendanceMarkedBy", fields: [markedById], references: [id])
  markedAt   DateTime         @default(now())

  voidedAt   DateTime?
  voidedById String?
  voidedBy   User?            @relation("AttendanceVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason String?

  usage      SessionUsage?

  @@index([lessonId])
  @@index([childId])
}

model SessionUsage {
  id           String           @id @default(uuid())
  attendanceId String           @unique
  attendance   LessonAttendance @relation(fields: [attendanceId], references: [id])
  packageId    String?
  package      Package?         @relation(fields: [packageId], references: [id], onDelete: Restrict)
  chargeId     String?          @unique
  charge       Charge?          @relation("SessionCharge", fields: [chargeId], references: [id], onDelete: Restrict)
  createdAt    DateTime         @default(now())

  voidedAt     DateTime?
  voidedById   String?
  voidedBy     User?            @relation("UsageVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason   String?

  @@index([packageId])
}
```

Notes:
- Back-relations are added to `User`, `Child`, `Tariff`, `Charge` and `Subscription`. All FKs RESTRICT.
- The migration only adds enums, enum values, tables and the nullable `Tariff.validityDays` column.
- Exactly one of `SessionUsage.packageId` / `chargeId` is set (service-enforced).
- "One active attendance per (lesson, child)" is service-enforced under a row lock on the `Lesson` (Prisma has no partial unique indexes).

---

## Consumption Logic (pure, `src/classes/consumption.ts`)

- `shouldConsume(rule, status)`: `present` → true; `absent_excused` → `rule = always`; `absent_unexcused` → `rule ∈ {always, unexcused_only}`.
- Package validity on `date`: not voided, `purchaseDate <= date`, and `effectiveExpiry` is null or `date <= effectiveExpiry`, where `effectiveExpiry` = latest extension `newExpiresAt`, else `expiresAt`.
- `expiresAt` at purchase = `purchaseDate + validityDays − 1` (last valid day), null when `validityDays` is null.
- Remaining = `sessionsTotal − usedBefore − active usages`.
- `pickPackage(packages, date)`: valid packages with remaining > 0, ordered by `effectiveExpiry` ascending (null last), then `purchaseDate`, then `createdAt`; take the first.
- Package state for views: `voided` → `needs_reconciliation` → `exhausted` (remaining 0) → `expired` (today after effectiveExpiry) → `active`.

---

## Integrity Rules

1. Marking a lesson runs in one `$transaction`: lock the `Lesson` row (create-or-get by `(classGroupId, date)`), lock candidate `Package` rows of the child's direction `ORDER BY id FOR UPDATE`, then read remaining counts.
2. A child has at most one active attendance per lesson; marking an already-marked child is a correction, not a second mark.
3. Correction voids the old attendance and its usage (and the usage's single-lesson charge via Part 1 `voidChargeInTx`) with a reason, then applies the new status.
4. Teacher: only groups where they are an assigned teacher; corrections only when `lesson.date == kyivToday()`. Admin/root: any group, any day; a correction after the lesson day requires a reason.
5. Lesson date must not be in the future (Kyiv).
6. Members are children whose membership covers the lesson date; guests can be any child.
7. Single-lesson charge: the group's `singleTariffId` must exist and have a price on the lesson date, else 400 `No price for this date`. Charge: category from tariff, `sourceType = extra_session`, `sourceId = attendanceId`, description `<group name>, <DD.MM.YYYY>: разове заняття`.
8. Package purchase: tariff `unit = package`, active, with a price on `purchaseDate`; `sessionsTotal = tariff.packageSize`; charge category from tariff, `sourceType = extra_package`, `sourceId = packageId`.
9. A package with active usages cannot be voided (400). Voiding voids its charge (if any) in the same transaction.
10. Extension: `newExpiresAt` must be after the current effective expiry (or any date if none) and reason is required.
11. Legacy migration is idempotent (`legacySubscriptionId` unique). Mapping:
    - each `SubscriptionType` → `Direction` with the same name (reuse if a direction with that name exists), rule `no_charge`;
    - each `Subscription` → `Package`: `sessionsTotal = totalSessions`, `usedBefore = totalSessions − remainingSessions`, `purchaseDate = createdAt` date, `tariffId = null`, `expiresAt = null`;
    - `cancelled` subscriptions → voided packages (reason `Скасовано до перенесення`), not reconciled;
    - others → `needsReconciliation = true`.
12. Reconciliation (admin): `paid_full` → no charge; `paid_partial` with `paidAmount` (0 < paid < total) → `opening_balance` charge for `totalPrice − paidAmount`; `not_paid` → charge for `totalPrice`. Category `extra_classes`, `sourceId = packageId`, description `Початковий залишок (звірка): <direction name>`. Sets `reconciledAt/By/Note`, clears `needsReconciliation`. Reconciling twice → 400.
13. Deleting a direction/group with lessons or packages, a child with memberships/attendances/packages, or a user referenced by these tables → 400 (existing messages for child/user; `Cannot delete: direction is in use`, `Cannot delete: group is in use`).

---

## API

Admin routes: `@Roles(root, admin)`. Teacher-accessible routes: `@Roles(root, admin, teacher)` with the ownership check in the service. Money as 2-decimal strings.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/directions` | admin | With groups (teachers, member count, tariffs) |
| POST/PATCH | `/directions`, `/directions/:id` | admin | `{ name, missedRule, isActive? }` |
| DELETE | `/directions/:id` | admin | Unused only |
| POST/PATCH | `/class-groups`, `/class-groups/:id` | admin | `{ name, directionId, format, teacherIds[], singleTariffId?, packageTariffId?, isActive? }` |
| GET | `/class-groups/:id` | admin, teacher(own) | Group, members, lessons with attendances |
| GET | `/my/class-groups` | teacher | Own groups |
| POST | `/class-groups/:id/members` | admin | `{ childId, startDate }` |
| PATCH | `/class-group-members/:id/end` | admin | `{ endDate }` |
| GET | `/class-groups/:id/lessons/:date` | admin, teacher(own) | Roster for the date: members + guests, current status, package state per child (`Пакет 3 з 4` / no package / expires) |
| PUT | `/class-groups/:id/lessons/:date` | admin, teacher(own) | `{ marks: [{ childId, status, isGuest? }], reason? }` — creates/corrects marks in one transaction |
| GET | `/children/:childId/packages` | admin | Packages with remaining, state, extensions, usages, legacy attendances |
| POST | `/children/:childId/packages` | admin | `{ directionId, tariffId, purchaseDate }` |
| POST | `/packages/:id/extend` | admin | `{ newExpiresAt, reason }` |
| POST | `/packages/:id/void` | admin | `{ reason }` |
| POST | `/packages/:id/reconcile` | admin | `{ outcome: 'paid_full'|'paid_partial'|'not_paid', paidAmount?, note? }` |
| POST | `/legacy/subscriptions/migrate` | admin | Returns `{ directions, packages, skipped }` |
| GET | `/packages/reconciliation` | admin | Packages needing reconciliation |

### Error messages (English, stable; frontend translates)

`Direction not found`, `Direction with this name already exists`, `Cannot delete: direction is in use`, `Class group not found`, `Class group with this name already exists in the direction`, `Cannot delete: group is in use`, `Tariff unit must be session`, `Tariff unit must be package`, `Member not found`, `Child is already a member of this group`, `Lesson date must not be in the future`, `Child is not a member of this group on this date`, `Duplicate child in marks`, `Only the lesson day can be corrected by a teacher`, `Reason is required for a late correction`, `Not your class group`, `Package not found`, `Package is voided`, `Package has used sessions`, `New expiry must be after the current expiry`, `Package does not need reconciliation`, `Invalid paid amount`, plus existing ones (`Child not found`, `Tariff not found`, `Tariff is not active`, `No price for this date`, `Amount must be greater than 0`).

---

## Frontend (frontend-edu-nest)

- **Shared error display:** `shared/api/errorMessages.ts` with `translateError(error)` (map of every backend message from Parts 1, 2, 4 → Ukrainian; array messages and unknown → generic). The axios response interceptor pushes a snackbar (`shared/ui/Notifier` + small Zustand store in `shared/model`) for every non-401 error and still rejects. Frontend `CLAUDE.md` "API errors" section is rewritten to describe this.
- **Role menu:** `NavItem.roles?: UserRole[]`; Sidebar filters by the current user's role. Teacher: «Мої заняття», «Учні». Admin/root: everything except «Мої заняття».
- **Гуртки** (`pages/classes`): directions with nested groups; create/edit direction and group modals; «Перенести старі абонементи» and «Потребує звірки: N».
- **Group page** (`/classes/:groupId`): members (add/end), tariffs, lesson history, «Відмітити заняття».
- **Mark lesson** (`/classes/:groupId/lessons/:date`, shared by teacher and admin): roster with three status buttons, package chip, add guest, save; correction reason dialog for admin after the lesson day.
- **Мої заняття** (`pages/myClasses`): teacher's group cards.
- **Child finance card:** new tab **Пакети** (Нарахування · Оплати · Абонементи · Пакети · Адаптація · Історія): list, Купити пакет, Продовжити, Сторнувати, Звірити; expandable usages and legacy attendances.
- Old «Абонементи» / «Типи абонементів» menu items and routes removed.

---

## Testing

- Consumption unit tests: rule × status matrix; package validity (expiry, extension, voided, not yet purchased); `pickPackage` ordering; remaining with `usedBefore`.
- Service tests (Prisma mocked): marking (transaction, locks, package vs single charge, no price, duplicate), correction (void usage/charge, teacher same-day rule, admin reason), teacher ownership 403, package purchase/void/extend, migration idempotency and mapping, reconciliation outcomes, delete guards.
- Verification: backend tests/build/lint; frontend tsc vs baseline + eslint; API walkthrough: LEGO direction (`unexcused_only`) → group with 2 children → package 4 for child A → lesson 1: A present (3 of 4), B present without package → single charge → lesson 2: A excused (no usage), B unexcused (single charge) → admin correction returns the session → teacher on another group → 403 → migrate legacy subscriptions → reconcile one as `paid_partial`.

---

## Out of Scope (Part 4)

Timetable (days/times), teacher payroll, automatic package renewal, meals (Part 5), parent cabinet and session refresh (Part 6), online payment (Part 7).

---

## Commit Order

1. Schema + migration
2. Consumption logic + tests
3. Directions and class groups (+ members)
4. Packages (purchase, extend, void)
5. Lessons: marking and correction
6. Legacy migration and reconciliation
7. Controllers, teacher access, delete guards, backend `CLAUDE.md`
8. Frontend: error display + translations → role menu → Гуртки + group page → mark lesson + Мої заняття → Пакети tab → remove old pages
