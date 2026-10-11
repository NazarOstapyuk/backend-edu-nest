# Finance Module (Part 1 of 7) — Design Spec

**Date:** 2026-10-11
**Project:** Private School/Kindergarten Management System (NestJS + PostgreSQL + Prisma, React admin panel `frontend-edu-nest`)

---

## Overview

A per-child finance ledger: charges (what the child owes), payments (money received) and allocations (which part of which payment covers which charge). Debt, prepayment and unallocated money are always computed from these records. Nothing is edited or deleted; mistakes are reversed ("voided") with a mandatory reason, so every balance can be explained.

This is the foundation for the whole billing rework. Later parts create charges automatically; in Part 1 charges are created manually by an admin.

---

## Overall Roadmap

Each part gets its own spec → plan → implementation cycle.

| # | Part | Effort (dev-days) |
|---|---|---|
| 1 | **Finance** (this spec): charges, cash/bank payments, allocation, prepayment, debt, voiding | 6–8 |
| 2 | Monthly subscriptions: kindergarten full day (15 500 UAH), kindergarten half day (11 000 UAH), school (16 000 UAH); per-child start date, automatic monthly charges, tariff history | 4–5 |
| 3 | Adaptation: hourly attendance (date, hours, hourly rate), charges | 2 |
| 4 | Extra classes: directions (sport, piano, drawing, LEGO, Minecraft, custom), individual/group, single/4-pack, teacher records date + participants, purchased/used/remaining; migration of current subscriptions with reconciliation | 5–7 |
| 5 | Meals | 2–4 |
| 6 | Parent cabinet (mandatory): parents see only their own children's data | 5–7 |
| 7 | Online payment (provider TBD) | 3–5 |
| | **Total** | **~27–38** |

Estimates are rough and will be refined after each part's spec. Parts 5 and 7 have the largest uncertainty (meal rules and payment provider not yet defined). Rules for charging missed classes will be agreed separately (Part 4).

---

## Decisions Made

| Topic | Decision |
|---|---|
| Balance model | One overall balance per child, broken down by category: `tuition`, `adaptation`, `extra_classes`, `meals` |
| Category isolation | Money paid for one category never automatically covers another category |
| Targeted payment | Payment for a specific charge (month, package, invoice) is allocated to exactly that charge |
| Category-only payment | System suggests allocation to the oldest open charges of that category; admin reviews/edits and confirms |
| Leftover | Becomes prepayment of the same category; payment with no category stays unallocated until assigned |
| Before confirmation | A recorded payment is visible as unallocated until its allocation is confirmed |
| Payment methods (Part 1) | `cash`, `bank_transfer`, entered manually by admin; `online` reserved for Part 7 |
| Payment proof | Reference (receipt number / transfer ID or purpose), received date, who recorded it. File attachments deferred |
| Corrections | No editing or deleting. Void with mandatory reason; voided records stay visible but are excluded from all sums |
| Reallocation history | Changing an allocation = void old allocation (with reason) + create new; history is preserved automatically |
| Access | root + admin: full access. teacher: none. parent: Part 6 (own children only) |
| Architecture | Separate `Charge` / `Payment` / `Allocation` tables; balances computed by aggregation, never stored |
| Migrated subscriptions (Part 4) | Marked "needs reconciliation", no charges and nothing shown to parents until admin confirms paid fully / partially / not paid. Then only an `opening_balance` charge for the confirmed unpaid amount is created, with a reconciliation note. No fabricated payments; the paid part is never recorded as income |

---

## Prisma Schema

```prisma
enum FinanceCategory {
  tuition
  adaptation
  extra_classes
  meals
}

enum ChargeSource {
  manual
  opening_balance
  monthly
  adaptation
  extra_package
  meals
}

enum PaymentMethod {
  cash
  bank_transfer
  online
}

enum PaymentStatus {
  pending
  confirmed
  failed
}

model Charge {
  id           String          @id @default(uuid())
  childId      String
  child        Child           @relation(fields: [childId], references: [id])
  category     FinanceCategory
  amount       Decimal         @db.Decimal(10, 2)
  description  String
  periodStart  DateTime?       @db.Date
  periodEnd    DateTime?       @db.Date
  sourceType   ChargeSource    @default(manual)
  sourceId     String?

  createdById  String
  createdBy    User            @relation("ChargeCreatedBy", fields: [createdById], references: [id])
  createdAt    DateTime        @default(now())

  voidedAt     DateTime?
  voidedById   String?
  voidedBy     User?           @relation("ChargeVoidedBy", fields: [voidedById], references: [id])
  voidReason   String?

  allocations  Allocation[]

  @@index([childId, category])
  @@index([sourceType, sourceId])
}

model Payment {
  id           String           @id @default(uuid())
  childId      String
  child        Child            @relation(fields: [childId], references: [id])
  amount       Decimal          @db.Decimal(10, 2)
  category     FinanceCategory?
  method       PaymentMethod
  status       PaymentStatus    @default(confirmed)
  reference    String
  receivedAt   DateTime
  note         String?
  externalId   String?          @unique

  createdById  String?
  createdBy    User?            @relation("PaymentCreatedBy", fields: [createdById], references: [id])
  createdAt    DateTime         @default(now())

  voidedAt     DateTime?
  voidedById   String?
  voidedBy     User?            @relation("PaymentVoidedBy", fields: [voidedById], references: [id])
  voidReason   String?

  allocations  Allocation[]

  @@index([childId])
}

model Allocation {
  id           String    @id @default(uuid())
  paymentId    String
  payment      Payment   @relation(fields: [paymentId], references: [id])
  chargeId     String
  charge       Charge    @relation(fields: [chargeId], references: [id])
  amount       Decimal   @db.Decimal(10, 2)

  createdById  String
  createdBy    User      @relation("AllocationCreatedBy", fields: [createdById], references: [id])
  createdAt    DateTime  @default(now())

  voidedAt     DateTime?
  voidedById   String?
  voidedBy     User?     @relation("AllocationVoidedBy", fields: [voidedById], references: [id])
  voidReason   String?

  @@index([paymentId])
  @@index([chargeId])
}
```

Notes:
- `Child` gets `charges Charge[]` and `payments Payment[]`; `User` gets the matching back-relations.
- `Payment.createdById` is nullable because Part 7 online payments are created by the payment provider callback, not a user. In Part 1 it is always set.
- `Payment.status`: manual payments are created `confirmed`. Only `confirmed` payments count in any sum. `pending` / `failed` are reserved for Part 7.
- All foreign keys are `RESTRICT` (Prisma default). The migration only adds tables and enums; existing tables and data are untouched.

---

## Integrity Rules

Enforced by the service; violations return `400 Bad Request` unless stated otherwise.

1. An allocation links a payment and a charge of the **same child**.
2. If the payment has a category, the charge must have the **same category**. A payment without a category may cover any charge.
3. Sum of active allocations of a payment ≤ payment amount.
4. Sum of active allocations of a charge ≤ charge amount.
5. Cannot allocate from or to a voided record, or from a non-`confirmed` payment.
6. All amounts > 0, at most 2 decimal places.
7. Voiding a payment or charge automatically voids all its active allocations with the same reason, in the same transaction.
8. Voiding an already voided record returns `400`.
9. Allocation and voiding run inside a Prisma `$transaction`; limit checks (rules 3–4) are performed inside the transaction so concurrent requests cannot exceed limits.
10. Money arithmetic uses `Prisma.Decimal`, never JS `number`.

---

## Computed Values

Only non-voided records count; for payments only `status = confirmed`.

| Value | Formula |
|---|---|
| Charge paid | Σ active allocations of the charge |
| Charge state | `unpaid` (paid = 0) / `partial` / `paid` (paid = amount) |
| Debt (category) | Σ (charge.amount − charge paid) over the category's charges |
| Prepayment (category) | Σ (payment.amount − allocated) over payments with that category |
| Unallocated | Σ (payment.amount − allocated) over payments without category |
| Total due | Σ debt − Σ prepayment − unallocated (negative = overall credit) |

Per category the response also returns `charged` (Σ amounts) and `paid` (Σ allocations to that category's charges).

---

## API

All routes: `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles(Role.root, Role.admin)`. Every route that returns finance data is scoped by `childId` (directly or via the record's child), so Part 6 adds parent access by one "is this my child" check, as in `SubscriptionsService.findByChild`.

Money fields in requests and responses are strings with 2 decimals (`"15500.00"`).

### Charges

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/children/:childId/charges` | `{ category, amount, description, periodStart?, periodEnd? }` | Creates `sourceType = manual` |
| POST | `/charges/:id/void` | `{ reason }` | Also voids its allocations |

### Payments

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/children/:childId/payments` | `{ amount, method, reference, receivedAt, category?, note?, allocations?: [{ chargeId, amount }] }` | `method` ∈ `cash`, `bank_transfer`. Payment and given allocations are created in one transaction; anything not allocated stays prepayment/unallocated |
| POST | `/payments/:id/void` | `{ reason }` | Also voids its allocations |

### Allocation

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/children/:childId/allocation-suggestion` | `{ amount, category? }` | Read-only. Returns open charges (of the category if given) sorted oldest first (`periodStart` ?? `createdAt`) with `suggestedAmount` filled greedily until `amount` is used up. Used by the payment form before saving and by the allocate form |
| POST | `/payments/:id/allocations` | `{ allocations: [{ chargeId, amount }] }` | Allocates the payment's free amount |
| POST | `/allocations/:id/void` | `{ reason }` | Money returns to the payment's free amount |

### Views

| Method | Path | Returns |
|---|---|---|
| GET | `/children/:childId/finance` | `{ totals: { totalDue, unallocated }, categories: [{ category, charged, paid, debt, prepayment }], charges: [... + paid, state], payments: [... + allocated, allocations[]] }`. Voided records included with void fields |
| GET | `/children/:childId/finance/history` | Chronological events derived from records: charge created/voided, payment recorded/voided, allocation created/voided, each with author, timestamp, amount, reason |
| GET | `/finance/balances?category=&hasDebt=&hasUnallocated=` | Per child: `childId`, name, `totalDue`, `debt`, `prepayment`, `unallocated` (filtered by category if given) |

History is derived from `createdAt/createdBy` and `voidedAt/voidedBy/voidReason` of the three tables; no separate audit table.

### Error messages (English, stable; frontend translates)

- `Child not found`, `Charge not found`, `Payment not found`, `Allocation not found`
- `Charge is voided`, `Payment is voided`, `Allocation is voided`, `Payment is not confirmed`
- `Charge belongs to another child`
- `Charge category does not match payment category`
- `Allocation exceeds payment free amount`
- `Allocation exceeds charge remaining amount`

---

## Changes to Existing Modules

- `ChildrenService.delete`: if the child has charges or payments, throw `400 Cannot delete: child has financial records` instead of a FK error (500).
- `UsersService.delete`: if the user authored or voided finance records, throw `400 Cannot delete: user has financial records, deactivate instead`.
- `AppModule`: register `FinanceModule`.
- Backend `CLAUDE.md`: add the finance domain rules; update the outdated subscriptions section.

---

## Frontend (frontend-edu-nest)

Follows the frontend `CLAUDE.md` conventions (reference: `pages/children`).

- `shared/api/finance.ts`: types (`Charge`, `Payment`, `Allocation`, `ChildFinance`, `FinanceBalance`, DTOs), `financeCategoryLabels`, `paymentMethodLabels`, `chargeStateLabels`; `financeApi`.
- **Menu "Фінанси" → list page:** table of children with Разом до сплати / Борг / Передоплата / Нерозподілено; filters: category, "лише з боргом", "є нерозподілені оплати". Row click opens the child card.
- **Child finance page** (`/finance/:childId`; link from the Children page):
  - Header: total due + one tile per category (нараховано, сплачено, борг/передоплата).
  - Tabs: Нарахування (period, category, description, amount, paid, state), Оплати (date, method, reference, category, amount, allocated, author; expandable allocations), Історія.
  - Voided records shown struck through, reason in a tooltip.
  - Buttons: Додати нарахування, Внести оплату.
- **Modals:**
  - Додати нарахування.
  - Внести оплату: fields + when a category is chosen, a table of open charges prefilled from `allocation-suggestion`, editable amounts, counter "розподілено X з Y, решта — передоплата".
  - Розподілити: same table for an existing payment's free amount.
  - Сторнувати / Зняти розподіл: mandatory reason.
- **Dependency:** shared API error display (frontend Roadmap step 1) should be done before this part; finance relies on showing server rejections to the user.
- Error message translations for the strings listed above.

---

## Testing

Unit tests (services, Prisma mocked; `$transaction` mock invokes the callback with the mock client):

- Suggestion: oldest first, same category only, stops at amount, leftover reported.
- Allocation rejections: exceeds payment free amount, exceeds charge remaining, category mismatch, other child, voided charge/payment, non-confirmed payment.
- Payment creation with allocations creates both in one transaction; invalid allocation rolls back the payment.
- Voiding payment/charge voids its allocations; voiding twice → 400.
- Summary: debt, prepayment, unallocated, total due; voided records excluded.
- Children/users delete guards.

Verification: backend `npm run lint` + `npm run build` + `npm test`; frontend `npm run build` + `npm run lint`; manual walkthrough of the scenarios on the running app.

---

## Out of Scope (Part 1)

- Automatic charges (Parts 2–5)
- Parent cabinet (Part 6), online payment (Part 7)
- Proof file attachments
- Exports and period reports
- Refunds to parents (prepayment stays until allocated; to be discussed separately)
- Migration of current subscriptions (Part 4)

---

## Commit Order

1. Schema + migration
2. Charges service + tests
3. Payments + allocation service + tests
4. Summary, balances, history + tests
5. Controllers + module, children/users delete guards
6. Frontend: API client → balances page → child finance page → modals
