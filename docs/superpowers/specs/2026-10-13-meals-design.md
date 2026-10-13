# Meals Design

Date: 2026-10-13. Repos: backend `backend-edu-nest`, frontend `frontend-edu-nest` (`D:\IT\EduNest`).

## Goal

Admins plan menus (separately for kindergarten and school) from reusable cyclic templates, set complex prices per price category, and publish menus. Parents order a complex per day or for several days, choosing dishes where the menu offers alternatives, before a daily deadline. Every order is charged immediately in the Part 1 ledger under category `meals`, so meals stay a separate payment from tuition and extra classes. Reference: the TODDLER Telegram bot (`D:\IT\toddler-telegram-bot`), which had a 4-week cyclic menu, three complexes priced per age group, a side-dish choice and a 10:00 deadline. Online payment is out of scope (Part 7).

## Decisions

| Topic | Decision |
|---|---|
| Who decides | Parents order in the cabinet (per day or several days at once). Admins can order for any child. |
| Pricing | Complexes (e.g. full / incomplete / small) made of courses; price per complex per price category, dated history. |
| Price category | Linked to the group (`Group.mealPriceCategoryId`); a child uses the category of their group. |
| Menus | One menu per date and group kind (`kindergarten`, `school_class`). Built from cyclic templates applied to a period, then edited per date. Template changes never touch existing days. |
| Choice | A course with several dishes on a day = the parent picks one; a course with one dish is included automatically. |
| Deadline | `AppSetting` `mealOrderDeadline`, default `10:00` Europe/Kyiv on the meal day. Parents order and cancel only before it. |
| After deadline | Order is fixed and charged even if the child is absent. Only admins can order or cancel after the deadline; cancelling needs a reason. |
| Absence notices | Approving a notice cancels orders for its days whose deadline had not passed when the notice was submitted. |
| Charging | One order = one `Charge` (`category = meals`, `sourceType = meals`, `sourceId = order id`), created with the order; debt allowed. Cancelling voids the charge. |
| Visibility | Admins see all orders with portion totals; teachers see today's orders of their own groups; parents see their own children. |

## Data Model

Migration `add_meals`:

```prisma
model MealCourse {
  id        String  @id @default(uuid())
  name      String  @unique
  sortOrder Int     @default(0)
  active    Boolean @default(true)
}

model Dish {
  id          String     @id @default(uuid())
  name        String
  courseId    String
  course      MealCourse @relation(fields: [courseId], references: [id], onDelete: Restrict)
  description String?
  active      Boolean    @default(true)

  @@unique([courseId, name])
}

model MealPriceCategory {
  id        String  @id @default(uuid())
  name      String  @unique
  sortOrder Int     @default(0)
  active    Boolean @default(true)
}

model Group {
  mealPriceCategoryId String?
  mealPriceCategory   MealPriceCategory? @relation(fields: [mealPriceCategoryId], references: [id], onDelete: Restrict)
}

model MealComplex {
  id          String  @id @default(uuid())
  name        String  @unique
  description String?
  sortOrder   Int     @default(0)
  active      Boolean @default(true)
}

model MealComplexCourse {
  complexId String
  courseId  String

  @@id([complexId, courseId])
}

model MealComplexPrice {
  id              String   @id @default(uuid())
  complexId       String
  priceCategoryId String
  price           Decimal  @db.Decimal(10, 2)
  validFrom       DateTime @db.Date
  createdAt       DateTime @default(now())

  @@unique([complexId, priceCategoryId, validFrom])
}

enum MenuStatus {
  draft
  published
}

model MenuDay {
  id          String     @id @default(uuid())
  date        DateTime   @db.Date
  kind        GroupKind
  status      MenuStatus @default(draft)
  publishedAt DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  @@unique([date, kind])
}

model MenuDayItem {
  menuDayId String
  dishId    String

  @@id([menuDayId, dishId])
}

model MenuTemplate {
  id     String  @id @default(uuid())
  name   String  @unique
  weeks  Int
  active Boolean @default(true)
}

model MenuTemplateItem {
  templateId String
  week       Int
  weekday    Int
  dishId     String

  @@id([templateId, week, weekday, dishId])
}

model MealOrder {
  id              String    @id @default(uuid())
  childId         String
  date            DateTime  @db.Date
  menuDayId       String
  complexId       String
  priceCategoryId String
  price           Decimal   @db.Decimal(10, 2)
  chargeId        String    @unique
  createdById     String
  createdAt       DateTime  @default(now())
  cancelledAt     DateTime?
  cancelledById   String?
  cancelReason    String?

  @@index([date, childId])
}

model MealOrderItem {
  orderId  String
  courseId String
  dishId   String

  @@id([orderId, courseId])
}
```

All foreign keys `Restrict` except join rows owned by their parent (`MealComplexCourse`, `MenuDayItem`, `MenuTemplateItem`, `MealOrderItem` cascade from the parent). Relations are added on `Child`, `User` (`createdBy`, `cancelledBy`), `Charge` as needed.

Directories (`MealCourse`, `Dish`, `MealPriceCategory`, `MealComplex`, `MenuTemplate`) are deactivated, never deleted. Inactive entries cannot be added to new menus, templates, complexes or groups; existing references keep working.

There is no partial unique index for "one active order per child and day" (Prisma would drop an unknown index); uniqueness is enforced by locking the child row (see Orders).

## Pure Rules (`src/meals/meals-calc.ts`)

Tested without mocks:

- `deadlineFor(date, 'HH:MM')` → the instant of the deadline in Europe/Kyiv (DST-aware) on that date; `isBeforeDeadline(date, deadline, now)`.
- `priceOn(prices, complexId, categoryId, date)` → the price with the latest `validFrom ≤ date`, or null.
- `resolveChoices(complexCourseIds, menuDishes, pickedDishIds)` → `{ items: {courseId, dishId}[] }` or an error code: `course_missing` (a course of the complex has no dish on that day), `choice_required` (several dishes and none picked), `invalid_choice` (a picked dish is not on the day's menu, belongs to a course outside the complex, or two picks for one course).
- `templateWeek(from, startWeek, weeks, day)` → the template week for `day`: `startWeek` for the ISO week containing `from`, +1 per ISO week, cycling `1..weeks`.
- `copyTarget(fromStart, toStart, day)` → `toStart + (day − fromStart)`.

## Menus

Admin (`root`, `admin`):

- `GET /menu-days?kind&from&to` → days with status, dishes grouped by course, active order count. Period ≤ 62 days.
- `PUT /menu-days/:date/:kind` `{ dishIds }` creates or replaces the day's dishes. A draft is replaced freely. A published day may change too, but removing a dish used by an active order → 400 `Dish is ordered`. Inactive dish → 400 `Dish is inactive`. Non-working day for that kind (calendar `all` + kind level, `dayInfo`) → 400 `Day is not a working day`.
- `POST /menu-days/publish` `{ kind, from, to }` publishes all drafts in the period that have dishes; returns the count.
- `POST /menu-days/unpublish` `{ kind, from, to }` returns days to draft; any active order in the period → 400 `Menu has orders` (nothing changes).
- `POST /menu-days/copy` `{ kind, fromStart, fromEnd, toStart, overwrite }` copies dishes into drafts at `copyTarget`. Target days that are non-working are skipped; existing target days are skipped unless `overwrite` and the day is a draft without orders. Returns `{ created, overwritten, skipped }`.
- `DELETE /menu-days/:date/:kind` deletes a draft day only (published → 400 `Menu is published`).

Templates:

- `GET/POST /menu-templates`, `PATCH /menu-templates/:id` (name, weeks, active), `PUT /menu-templates/:id/items` `{ items: [{ week, weekday, dishId }] }` (week ≤ weeks, weekday 1–7).
- `POST /menu-templates/:id/apply` `{ kind, from, to, startWeek, overwrite }` creates drafts for every working day of the kind in the period that has template dishes for its `(templateWeek, weekday)`, with the same skip/overwrite rules as copy. Period ≤ 92 days.

## Orders

`POST /meal-orders` (admin) and `POST /me/children/:id/meal-orders` (parent) take `{ childId?, days: [{ date, complexId, dishIds }] }` (1–31 days, unique dates). One transaction for all days; any failure rolls everything back and the error names the date (`message` like `2026-10-14: Menu is not published`).

Per day:

1. Lock the child row (`SELECT ... FOR UPDATE`), then check there is no active order for the child and date → 400 `Order already exists`.
2. Child must have a group → 400 `Child has no group`; the group needs an active price category → 400 `Group has no meal price category`.
3. Day must be working for the child's group (`dayInfo` with group level) → 400 `Day is not a working day`.
4. `MenuDay` for the group kind must be published → 400 `Menu is not published`.
5. Parent: `isBeforeDeadline` → otherwise 400 `Order deadline has passed`. Admin may order after the deadline (and for past days).
6. Complex active → 400 `Complex is inactive`; `resolveChoices` errors → 400 `Complex is not available on this day` / `Dish choice is required` / `Invalid dish choice`.
7. `priceOn` → 400 `Complex has no price` when null.
8. Create the `Charge` (`category meals`, `sourceType meals`, `amount = price`, `periodStart = periodEnd = date`, description `Харчування DD.MM.YYYY: <complex name>`), then `MealOrder` with snapshots and `MealOrderItem`s (`Charge.sourceId` = order id).

Changing an order = cancel + new order.

Cancelling: `POST /meal-orders/:id/cancel` `{ reason? }` (admin) and `POST /me/children/:id/meal-orders/:orderId/cancel` (parent). Parent: own child, before the deadline only (400 `Order deadline has passed`). Admin: any time; after the deadline `reason` is required (400 `Reason is required`). Already cancelled → 400 `Order is cancelled`. Cancelling sets `cancelledAt/ById/Reason` and voids the charge with `voidChargeInTx` in the same transaction. If the charge was voided in finance directly, the order is still cancelled normally.

Absence notices: `NoticesService.decide` currently updates without a transaction; for `approve` it is wrapped in `$transaction` and calls `cancelOrdersForNoticeInTx(tx, notice, userId)` (a plain function in `src/meals/`, no module import cycle) after the status update. Each affected order is cancelled with the same child-row lock as order creation. It cancels active orders of the child for notice days where `notice.createdAt` is before that day's deadline, reason `Відсутність`. Rejecting or later cancelling a notice does not restore orders.

## Views

- `GET /meal-orders?date&kind&groupId` (admin) → `{ orders: [{ id, child, group, complex, items, price, createdBy, cancelled… }], summary: { complexes: [{ complexId, name, count }], dishes: [{ dishId, name, count }] } }`; summary counts active orders only.
- `GET /meal-orders/today?groupId` (teacher of the group or admin; others 403 via `assertGroupAccess`-style check) → active orders for Kyiv today: child name, complex, dishes.
- `GET /me/children/:id/menu?from&to` (parent, `assertOwnChild`, ≤ 31 days) → per published day of the child's kind: dishes by course, complexes with the child's price (only those with a price and available on that day), the child's active order, `deadline` instant and `canOrder` / `canCancel`. Drafts are never shown.
- `GET /meals/settings` / `PATCH /meals/settings` `{ mealOrderDeadline: 'HH:MM' }` (admin).

Charges appear in the existing finance views and parent cabinet under `meals` with no extra work.

## Directories API (admin)

`/meal-courses`, `/dishes` (`?courseId&active`), `/meal-price-categories`, `/meal-complexes` (with `courseIds`), `GET/POST /meal-complexes/:id/prices`, `DELETE /meal-complexes/:id/prices/:priceId` (only when `validFrom` > Kyiv today, else 400 `Price is already in effect`). Price must be > 0. `PATCH /groups/:id` accepts `mealPriceCategoryId` (uuid or null).

## Frontend

- Admin section «Харчування»: tabs «Меню» (week/month grid, kindergarten/school switch, edit day dishes by course, publish/unpublish, copy, apply template), «Шаблони» (cycle weeks × weekdays grid), «Довідники» (courses, dishes, price categories, complexes with prices), «Замовлення» (date + kind + group filter, list with cancel and portion summary), deadline setting.
- Group form: price category select.
- Teacher: «Харчування сьогодні» block on the group register page.
- Parent child page: tab «Харчування» with the week menu, complex + dish choice per day, «Замовити» for one day or the selected days, cancel before the deadline, order status.
- Error message translations for every new message above.

## Testing

- `meals-calc.spec.ts`: deadline in summer/winter time, price history, choice resolution cases, template week cycling, copy offsets.
- Service specs with mocked Prisma: menu edit/publish/unpublish/copy/apply rules, order creation per check (one test per error), atomic multi-day failure, cancel rules for parent/admin, notice auto-cancel boundary (submitted before vs after the deadline), teacher access.

## Out of Scope

Online payment, requiring prepayment before ordering, kitchen printouts and Excel export (reports part), allergens, per-child price category override, automatic daily meals by attendance.
