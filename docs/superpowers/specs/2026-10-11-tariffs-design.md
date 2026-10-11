# Tariffs, Monthly Enrollments and Adaptation (Part 2 of 7) — Design Spec

**Date:** 2026-10-11
**Project:** Private School/Kindergarten Management System (NestJS + PostgreSQL + Prisma, React admin panel `frontend-edu-nest`)
**Depends on:** Part 1 Finance (`docs/superpowers/specs/2026-10-11-finance-design.md`), branch `feature/finance`

---

## Overview

A configurable tariff system. Admins create tariffs (kindergarten full/half day, school, adaptation, later classes and packages) without code changes, keep a dated price history, enroll children on monthly tariffs with per-child conditions (own price, discounts, pauses), and the system automatically creates monthly charges in the Part 1 finance ledger. Adaptation is recorded per visit (date, hours, hourly rate) and charged immediately.

Payments, allocation, debt and prepayment are unchanged and handled by Part 1. The payment method (cash / bank transfer) is recorded for accounting only and does not affect prices.

---

## Updated Roadmap

| # | Part | Effort (dev-days) |
|---|---|---|
| 1 | Finance (done, `feature/finance`) | — |
| 2 | **Tariffs + monthly enrollments + adaptation** (this spec) | 6–8 |
| 3 | ~~Adaptation~~ merged into Part 2 | — |
| 4 | Classes and packages on the same tariffs: directions, teacher marks lessons with participants, purchased/used/remaining, migration of current subscriptions with reconciliation, missed-lesson rules | 5–7 |
| 5 | Meals | 2–4 |
| 6 | Parent cabinet | 5–7 |
| 7 | Online payment | 3–5 |

---

## Decisions Made

| Topic | Decision |
|---|---|
| Flexibility level | Tariff constructor + per-child conditions (own price, % discount, amount discount, pause). No automatic discount rules (sibling etc.) in this part; model allows adding them later |
| Tariff units | `month`, `hour`, `session`, `package` (with `packageSize`). Part 2 implements behaviour for `month` (enrollments) and `hour` (adaptation); `session`/`package` tariffs can be created but are used in Part 4 |
| Billing period mode | Configurable: `anniversary` (from start date, e.g. every 15th), `calendar_prorated` (calendar months, first partial month prorated by days), `calendar_full` (calendar months, first partial month charged in full). Set on the tariff as default, overridable per enrollment |
| Price changes | Dated price history on the tariff; a period uses the price effective on its start date; past charges never change |
| Per-child own price | Enrollment condition `custom_price` with dates; overrides the tariff price while active |
| Discounts | Manual only: `discount_percent` or `discount_amount`, with dates and reason |
| Pause | Condition `pause` with dates; no charge for paused days; partially paused period prorated by days |
| Charge timing | Charges are created N days before a period starts; N is one global setting (default 5) |
| Charge trigger | Daily job at 03:00 Europe/Kyiv via `@nestjs/schedule` (dependency approved) + manual "Нарахувати зараз" (all or one enrollment). Idempotent: one charge per period |
| Retroactive changes | Already billed periods are never changed automatically; admin uses "Перерахувати" (void old charge with reason + create new) |
| Corrections | Conditions and adaptation visits are not edited; they are voided with a reason (same rule as Part 1) |
| Adaptation | Admin records date, hours, hourly rate (prefilled from tariff price on that date, editable), note; charge created immediately; voiding the visit voids its charge |
| Access | root + admin only; teacher has no access in this part; parents in Part 6 |
| Time zone | All "today" and month-boundary logic uses Europe/Kyiv |
| Existing subscriptions module | Untouched in this part; replaced in Part 4 |

---

## Prisma Schema

```prisma
enum TariffUnit {
  month
  hour
  session
  package
}

enum BillingMode {
  anniversary
  calendar_prorated
  calendar_full
}

enum AdjustmentType {
  custom_price
  discount_percent
  discount_amount
  pause
}

model Tariff {
  id               String            @id @default(uuid())
  name             String            @unique
  category         FinanceCategory
  unit             TariffUnit
  packageSize      Int?
  billingMode      BillingMode       @default(calendar_full)
  isActive         Boolean           @default(true)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  prices           TariffPrice[]
  enrollments      Enrollment[]
  adaptationVisits AdaptationVisit[]
}

model TariffPrice {
  id            String   @id @default(uuid())
  tariffId      String
  tariff        Tariff   @relation(fields: [tariffId], references: [id])
  price         Decimal  @db.Decimal(10, 2)
  effectiveFrom DateTime @db.Date
  createdById   String
  createdBy     User     @relation("TariffPriceCreatedBy", fields: [createdById], references: [id])
  createdAt     DateTime @default(now())

  @@unique([tariffId, effectiveFrom])
}

model Enrollment {
  id            String                 @id @default(uuid())
  childId       String
  child         Child                  @relation(fields: [childId], references: [id])
  tariffId      String
  tariff        Tariff                 @relation(fields: [tariffId], references: [id])
  startDate     DateTime               @db.Date
  endDate       DateTime?              @db.Date
  billingMode   BillingMode?
  note          String?
  createdById   String
  createdBy     User                   @relation("EnrollmentCreatedBy", fields: [createdById], references: [id])
  createdAt     DateTime               @default(now())
  updatedAt     DateTime               @updatedAt

  adjustments   EnrollmentAdjustment[]
  billedPeriods BilledPeriod[]

  @@index([childId])
}

model EnrollmentAdjustment {
  id           String         @id @default(uuid())
  enrollmentId String
  enrollment   Enrollment     @relation(fields: [enrollmentId], references: [id])
  type         AdjustmentType
  value        Decimal?       @db.Decimal(10, 2)
  startDate    DateTime       @db.Date
  endDate      DateTime?      @db.Date
  reason       String
  createdById  String
  createdBy    User           @relation("AdjustmentCreatedBy", fields: [createdById], references: [id])
  createdAt    DateTime       @default(now())

  voidedAt     DateTime?
  voidedById   String?
  voidedBy     User?          @relation("AdjustmentVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason   String?

  @@index([enrollmentId])
}

model BilledPeriod {
  id           String     @id @default(uuid())
  enrollmentId String
  enrollment   Enrollment @relation(fields: [enrollmentId], references: [id])
  periodStart  DateTime   @db.Date
  periodEnd    DateTime   @db.Date
  amount       Decimal    @db.Decimal(10, 2)
  chargeId     String?    @unique
  charge       Charge?    @relation(fields: [chargeId], references: [id])
  note         String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@unique([enrollmentId, periodStart])
}

model AdaptationVisit {
  id          String    @id @default(uuid())
  childId     String
  child       Child     @relation(fields: [childId], references: [id])
  tariffId    String
  tariff      Tariff    @relation(fields: [tariffId], references: [id])
  date        DateTime  @db.Date
  hours       Decimal   @db.Decimal(5, 2)
  ratePerHour Decimal   @db.Decimal(10, 2)
  amount      Decimal   @db.Decimal(10, 2)
  note        String?
  chargeId    String    @unique
  charge      Charge    @relation(fields: [chargeId], references: [id])
  createdById String
  createdBy   User      @relation("AdaptationCreatedBy", fields: [createdById], references: [id])
  createdAt   DateTime  @default(now())

  voidedAt    DateTime?
  voidedById  String?
  voidedBy    User?     @relation("AdaptationVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)
  voidReason  String?

  @@index([childId])
}

model AppSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

Notes:
- `Child`, `User`, `Charge` get the matching back-relations. All foreign keys are `RESTRICT` (Part 1 rule).
- `AppSetting` key `chargeLeadDays` (integer as string, default `5` when absent, allowed range 0–60).
- Charges created by this part use the Part 1 `Charge` table: `sourceType = monthly` with `sourceId = enrollmentId` for monthly periods, `sourceType = adaptation` with `sourceId = adaptationVisitId` for visits. `createdById` is the user who triggered the run; the daily job uses the root user (looked up by `ROOT_LOGIN`).
- Migration only adds enums/tables/columns; existing tables and data are untouched.

---

## Billing Engine (pure functions, `src/tariffs/billing-engine.ts`)

Input: enrollment (startDate, endDate, effective billing mode = enrollment.billingMode ?? tariff.billingMode), tariff prices, active (non-voided) adjustments, already billed period starts, `today` (Kyiv date), `leadDays`.
Output: list of due periods with `{ periodStart, periodEnd, fullDays, billableDays, basePrice, amount, description }` or a problem `{ periodStart, reason: 'no_price' }`.

### Periods

- `anniversary`: anchor day `d` = day of `startDate`. Period k starts on month `startMonth + k`, day `min(d, daysInMonth)`. A period ends the day before the next period start. Example: start 31.01 → 31.01–27.02, 28.02–30.03, 31.03–29.04.
- `calendar_prorated` / `calendar_full`: first period `startDate` … last day of that month; then whole calendar months.
- `fullDays`: number of days of the untruncated period. For the first calendar period this is the number of days in that month; for anniversary periods the period's own length.
- If `endDate` falls inside a period, the period is truncated to `endDate`. Periods starting after `endDate` do not exist.

### Which periods are due

A period is due when `periodStart <= today + leadDays`, it is not in the billed list, and it starts on/after `startDate` and on/before `endDate` (if set). All overdue unbilled periods (e.g. enrollment created with a past start date) are due at once.

### Amount for one period

1. **Base price:** if a `custom_price` adjustment is active on `periodStart`, its value; otherwise the tariff price with the latest `effectiveFrom <= periodStart`. No price → problem `no_price`, period skipped.
2. **Discounts active on `periodStart`:** apply `discount_percent` first (`base × (1 − p/100)`), then `discount_amount` (`− value`); floor at 0.
3. **Billable days:** days of the (possibly truncated) period minus days covered by active `pause` adjustments.
   - Exception, `calendar_full` first period: it is treated as covering the whole month, so `billableDays = fullDays − paused days − days after endDate` (days before `startDate` are not subtracted).
   - Proration factor = `billableDays / fullDays`.
4. `amount = round(discountedPrice × factor, 2)` (half-up), using `Prisma.Decimal`.
5. `description`, e.g. `Садочок повний день, 15.10.2026–14.11.2026: 15500.00 − 10%, 17/31 дн.` Only the parts that apply are included.

An adjustment is "active on date X" when `startDate <= X` and (`endDate` is null or `endDate >= X`) and not voided. Pause days are counted by intersecting `[startDate, endDate ?? periodEnd]` with the period.

### Zero amount

If `amount = 0` (100% discount or fully paused), a `BilledPeriod` is stored with `chargeId = null` and `note` (`pause` / `zero amount`); no charge is created.

---

## Integrity Rules

1. One `BilledPeriod` per `(enrollmentId, periodStart)` (unique). A concurrent duplicate insert is caught and treated as "already billed" (no error to the user, no second charge).
2. Charge creation and `BilledPeriod` insert happen in one `$transaction`.
3. Enrollment requires: tariff `unit = month`, tariff active, a price with `effectiveFrom <= startDate`, no other enrollment of the same child on the same tariff with overlapping `[startDate, endDate]`.
4. `endDate >= startDate` for enrollments and adjustments.
5. Adjustments of the same type on one enrollment must not overlap in time (non-voided).
6. Values: `custom_price` > 0; `discount_percent` in (0, 100]; `discount_amount` > 0; `pause` has no value. Money with at most 2 decimals.
7. Voiding an adjustment does not change billed periods; admin recalculates if needed.
8. Recalculate: in one transaction void the period's charge (if any, reason required) and store the new computed amount/charge on the same `BilledPeriod` row. If the period now lies after the enrollment `endDate`, the new amount is 0.
9. Adaptation: tariff `unit = hour`; `hours` > 0 and ≤ 24 with at most 2 decimals; rate = request value or tariff price on `date` (no price and no rate → 400); `amount = round(hours × rate, 2)`; charge + visit in one transaction.
10. Voiding an adaptation visit voids its charge (via Part 1 charge void, which voids allocations) in the same transaction.
11. A tariff can be deleted only when it has no enrollments and no adaptation visits (its prices are deleted with it); otherwise 400 (deactivate instead).

---

## API

All routes `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Role.root, Role.admin)`. Money as 2-decimal strings.

### Tariffs

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/tariffs` | List with `currentPrice` (price effective today), price history |
| POST | `/tariffs` | `{ name, category, unit, packageSize?, billingMode, price, effectiveFrom }` (`packageSize` required iff `unit = package`) |
| PATCH | `/tariffs/:id` | `{ name?, billingMode?, isActive? }` |
| POST | `/tariffs/:id/prices` | `{ price, effectiveFrom }`; duplicate date → 400 |
| DELETE | `/tariffs/:id` | Only unused tariffs |

### Enrollments

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/children/:childId/enrollments` | Enrollments with tariff, effective mode, active and voided adjustments, billed periods (with charge state from Part 1), `nextPeriod` preview (start, end, amount or problem) |
| POST | `/children/:childId/enrollments` | `{ tariffId, startDate, endDate?, billingMode?, note? }` |
| PATCH | `/enrollments/:id/end` | `{ endDate }`; response flags billed periods after `endDate` as needing recalculation |
| POST | `/enrollments/:id/adjustments` | `{ type, value?, startDate, endDate?, reason }` |
| POST | `/adjustments/:id/void` | `{ reason }` |
| POST | `/enrollments/:id/bill` | Bill due periods of this enrollment now |
| POST | `/billed-periods/:id/recalculate` | `{ reason }` |

### Billing

| Method | Path | Notes |
|---|---|---|
| POST | `/billing/run` | Bill all enrollments now; returns `{ created, skippedZero, problems[] }` |
| GET | `/billing/problems` | Live list: enrollment, child, period start, reason (`no_price`) |
| GET | `/settings/billing` | `{ chargeLeadDays }` |
| PATCH | `/settings/billing` | `{ chargeLeadDays }` (0–60) |

### Adaptation

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/children/:childId/adaptation-visits` | Visits with charge state |
| POST | `/children/:childId/adaptation-visits` | `{ tariffId, date, hours, ratePerHour?, note? }` |
| POST | `/adaptation-visits/:id/void` | `{ reason }` |

### Error messages (English, stable; frontend translates)

`Tariff not found`, `Tariff with this name already exists`, `Tariff is not active`, `Tariff unit must be month`, `Tariff unit must be hour`, `Package size is required for package tariffs`, `Price for this date already exists`, `No price for this date`, `Cannot delete: tariff is in use`, `Enrollment not found`, `Enrollment overlaps an existing enrollment on this tariff`, `End date must not be before start date`, `Adjustment not found`, `Adjustment overlaps an existing adjustment of the same type`, `Invalid adjustment value`, `Adjustment is voided`, `Billed period not found`, `Adaptation visit not found`, `Adaptation visit is voided`, `Invalid hours`, `Lead days must be between 0 and 60`, plus Part 1 messages (`Child not found`, `Amount must be greater than 0`, ...).

---

## Daily Job

`@nestjs/schedule`: `ScheduleModule.forRoot()` in `AppModule`; `@Cron('0 3 * * *', { timeZone: 'Europe/Kyiv' })` in `BillingScheduler` calls the same service method as `POST /billing/run`, logs `created/skippedZero/problems` via Nest `Logger`. Errors for one enrollment are logged and do not stop the run.

---

## Frontend (frontend-edu-nest)

Follows the frontend `CLAUDE.md` (reference `pages/children`, finance pages from Part 1).

- `shared/api/tariffs.ts`, `shared/api/enrollments.ts`, `shared/api/adaptation.ts`, `shared/api/billing.ts` with labels: `tariffUnitLabels`, `billingModeLabels`, `adjustmentTypeLabels`.
- **Menu "Тарифи" → `pages/tariffs`:** table (name, category, unit, default mode, current price, active); header with "Нараховувати за N днів" (editable) and "Нарахувати зараз"; "Проблеми нарахування" block when non-empty. Modals: Створити тариф; Тариф (price history, Нова ціна, active toggle, name/mode edit).
- **Child finance card (`/finance/:childId`)** gets tabs **Абонементи** and **Адаптація** (order: Нарахування · Оплати · Абонементи · Адаптація · Історія):
  - Абонементи: enrollments list (tariff, dates, mode, next period amount, condition chips); actions Записати на тариф, Завершити, Додати умову, Нарахувати зараз; expandable billed periods with Перерахувати (reason) and condition void (reason).
  - Адаптація: visits list; Додати відвідування (tariff of unit hour, date, hours, prefilled rate, note); Сторнувати (reason).
- After any mutation the card refetches finance + the affected tab.
- Old "Абонементи" / "Типи абонементів" menu items stay until Part 4.

---

## Testing

Billing engine unit tests (pure, no mocks):
- each mode; month lengths (31st anchor, February, leap year);
- price change mid-enrollment; custom price with dates;
- % discount, amount discount, both, discount larger than price (0);
- pause: whole period, partial, spanning two periods;
- end date mid-period; open-ended enrollment;
- lead days boundary; overdue catch-up of several periods; no-price problem.

Service tests (Prisma mocked): idempotency (existing billed period skipped, unique-violation treated as billed), transaction of charge + billed period, recalculation voids old charge, overlap/validation rejections, adaptation amount and void cascade, settings range, teacher 403 via role metadata.

Verification: backend `npm test` + `npm run build` + lint on touched files; frontend `tsc -b` no new errors vs baseline + eslint; API walkthrough: tariff 15 500 → enrollment from the 15th (anniversary) → charge appears with lead days → −10% discount → pause → recalculate → adaptation 3 h × 200 → payment via Part 1.

---

## Out of Scope (Part 2)

- Classes/packages behaviour, teacher lesson marks, directions, migration of current subscriptions, missed-lesson rules (Part 4)
- Automatic discount rules (siblings etc.)
- Per-tariff lead days
- Meals (Part 5), parent cabinet (Part 6), online payment (Part 7)

---

## Commit Order

1. Schema + migration, `@nestjs/schedule` dependency
2. Billing engine + tests
3. Tariffs + prices service/controller + tests
4. Enrollments + adjustments + tests
5. Billing run, manual bill, recalculation, settings, scheduler + tests
6. Adaptation + tests
7. Module wiring, backend `CLAUDE.md`
8. Frontend: API clients → Тарифи page → Абонементи tab → Адаптація tab
