# Subscriptions Module — Design Spec

**Date:** 2026-05-16
**Project:** Private School/Kindergarten Management System (NestJS + PostgreSQL + Prisma)

---

## Overview

A subscription module that allows admins to purchase session packages for children across different activity types (Football, Dance, Speech Therapy, etc.). Teachers mark attendance, which decrements the session counter. When sessions run out, the subscription is automatically marked as finished.

---

## Decisions Made

| Topic | Decision |
|---|---|
| Attendance tracking | Separate `Attendance` entity — full history |
| Notifications | Not implemented in this iteration |
| Price on type change | Existing subscriptions keep their creation-time price |
| Subscription statuses | `active`, `finished`, `cancelled` |
| Access control | root + admin have full access; teacher marks attendance only |
| Architecture | Two modules: `SubscriptionTypes` + `Subscriptions` (Attendance lives inside Subscriptions) |

---

## Prisma Schema

```prisma
enum SubscriptionStatus {
  active
  finished
  cancelled
}

model SubscriptionType {
  id              String         @id @default(uuid())
  name            String         @unique
  pricePerSession Decimal        @db.Decimal(10, 2)
  isActive        Boolean        @default(true)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  subscriptions   Subscription[]
}

model Subscription {
  id                 String             @id @default(uuid())
  childId            String
  child              Child              @relation(fields: [childId], references: [id])

  subscriptionTypeId String
  subscriptionType   SubscriptionType   @relation(fields: [subscriptionTypeId], references: [id])

  totalSessions      Int
  remainingSessions  Int
  pricePerSession    Decimal            @db.Decimal(10, 2)
  totalPrice         Decimal            @db.Decimal(10, 2)

  status             SubscriptionStatus @default(active)

  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  attendances        Attendance[]
}

model Attendance {
  id             String       @id @default(uuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id])

  date           DateTime     @default(now())
  note           String?

  createdAt      DateTime     @default(now())
}
```

### Model Relationships

| From | To | Type | Note |
|---|---|---|---|
| `SubscriptionType` | `Subscription` | one-to-many | One type, many subscriptions |
| `Child` | `Subscription` | one-to-many | One child, many subscriptions (concurrent allowed) |
| `Subscription` | `Attendance` | one-to-many | One subscription, many attendance records |

---

## REST API Endpoints

### Module: `SubscriptionTypes` — base path `/subscription-types`

| Method | URL | Roles | Description |
|---|---|---|---|
| `POST` | `/subscription-types` | root, admin | Create activity type |
| `GET` | `/subscription-types` | root, admin, teacher | List all types |
| `GET` | `/subscription-types/:id` | root, admin, teacher | Get type details |
| `PATCH` | `/subscription-types/:id` | root, admin | Update name / price / isActive |
| `DELETE` | `/subscription-types/:id` | root, admin | Delete only if no linked subscriptions exist |

### Module: `Subscriptions` — base path `/subscriptions`

| Method | URL | Roles | Description |
|---|---|---|---|
| `POST` | `/subscriptions` | root, admin | Create subscription for a child |
| `GET` | `/subscriptions` | root, admin | List all subscriptions (filter by `childId`, `status`) |
| `GET` | `/subscriptions/:id` | root, admin, teacher | Subscription details with attendances |
| `GET` | `/children/:childId/subscriptions` | root, admin, teacher, parent | All subscriptions for a specific child |
| `PATCH` | `/subscriptions/:id/cancel` | root, admin | Cancel subscription |

### Attendance — base path `/subscriptions/:subscriptionId/attendances`

| Method | URL | Roles | Description |
|---|---|---|---|
| `POST` | `/subscriptions/:subscriptionId/attendances` | root, admin, teacher | Mark attendance (decrements `remainingSessions`) |
| `GET` | `/subscriptions/:subscriptionId/attendances` | root, admin, teacher | List attendances for subscription |
| `DELETE` | `/subscriptions/:subscriptionId/attendances/:id` | root, admin | Undo attendance (restores `remainingSessions`) |

---

## NestJS Service Logic

### `SubscriptionTypesService`

| Method | Logic |
|---|---|
| `create(dto)` | Validate unique `name`, create record |
| `findAll()` | Return all types including inactive |
| `findOne(id)` | Find or throw `NotFoundException` |
| `update(id, dto)` | Update fields; changing `pricePerSession` does NOT affect existing subscriptions |
| `delete(id)` | Check no linked `Subscription` records exist → if any, throw `BadRequestException`; otherwise delete |

### `SubscriptionsService`

| Method | Logic |
|---|---|
| `create(dto)` | 1. Find `Child` and `SubscriptionType` (or `NotFoundException`) 2. Copy `pricePerSession` from type 3. Calculate `totalPrice = pricePerSession × totalSessions` 4. Set `remainingSessions = totalSessions` 5. Save with `status: active` |
| `findAll(filters)` | List with optional `childId` and `status` filters, include `subscriptionType` and `child` |
| `findOne(id)` | Details with `include: { attendances, subscriptionType, child }` |
| `findByChild(childId)` | All subscriptions for child, sorted by `createdAt desc` |
| `cancel(id)` | Find subscription → verify `status === active` → update to `cancelled` |

### `AttendancesService`

| Method | Logic |
|---|---|
| `create(subscriptionId, dto)` | 1. Find `Subscription` or `NotFoundException` 2. Verify `status === active` or throw `ForbiddenException` 3. In one **transaction**: create `Attendance` + decrement `remainingSessions` by 1 4. If `remainingSessions` becomes 0 → set `status` to `finished` |
| `findBySubscription(subscriptionId)` | List attendances sorted by `date desc` |
| `delete(subscriptionId, attendanceId)` | 1. Find `Attendance` 2. Verify it belongs to this `subscriptionId` 3. In **transaction**: delete record + increment `remainingSessions` by 1 4. If status was `finished` → revert to `active` |

---

## Module Structure

```
src/
  subscription-types/
    dto/
      create-subscription-type.dto.ts
      update-subscription-type.dto.ts
    subscription-types.controller.ts
    subscription-types.service.ts
    subscription-types.module.ts
  subscriptions/
    dto/
      create-subscription.dto.ts
      create-attendance.dto.ts
    subscriptions.controller.ts
    subscriptions.service.ts
    attendances.controller.ts
    attendances.service.ts
    subscriptions.module.ts
```

---

## Key Invariants

1. `remainingSessions` and `Attendance` records are always mutually consistent — enforced by Prisma transactions.
2. Attendance cannot be marked on a `cancelled` or `finished` subscription.
3. Deleting an attendance on a `finished` subscription reverts it to `active`.
4. Price on `SubscriptionType` changes never affect existing `Subscription` records.
5. A `SubscriptionType` cannot be deleted if it has linked subscriptions.
6. A child can have multiple concurrent `active` subscriptions of different types.
7. When a `parent` calls `GET /children/:childId/subscriptions`, the service verifies that the child belongs to that parent — otherwise throws `ForbiddenException`.
