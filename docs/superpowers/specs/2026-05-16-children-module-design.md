# Children Module — Design Spec
**Date:** 2026-05-16

## Overview

A new `children` module for managing child records in an educational system. Children have required personal fields, an optional group assignment (one group per child), and an optional list of parents (users with `role=parent`).

The `Group` model is updated to expose its children, and the `User` model gains a back-relation to children via parents.

---

## 1. Database Schema

### New enum

```prisma
enum Gender {
  male
  female
}
```

### New model `Child`

```prisma
model Child {
  id        String   @id @default(uuid())
  firstName String
  lastName  String
  birthDate DateTime
  gender    Gender

  groupId   String?
  group     Group?   @relation(fields: [groupId], references: [id])

  parents   User[]   @relation("ChildParents")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Updated `Group` model

Add `children Child[]` relation field.

### Updated `User` model

Add `children Child[] @relation("ChildParents")` back-relation field.

---

## 2. API

Base path: `/children`  
All endpoints require `JwtAuthGuard` + `RolesGuard` with roles: `root`, `admin`, `teacher`.

| Method   | URL              | Description          |
|----------|------------------|----------------------|
| `POST`   | `/children`      | Create a child       |
| `GET`    | `/children`      | Get all children     |
| `PATCH`  | `/children/:id`  | Update a child       |
| `DELETE` | `/children/:id`  | Delete a child       |

All responses include `group` and `parents` (parents omit `password` and `refreshToken`).

---

## 3. DTOs

### `CreateChildDto`

| Field       | Type       | Required | Validation                        |
|-------------|------------|----------|-----------------------------------|
| `firstName` | `string`   | yes      | `@IsString @IsNotEmpty`           |
| `lastName`  | `string`   | yes      | `@IsString @IsNotEmpty`           |
| `birthDate` | `string`   | yes      | `@IsDateString`                   |
| `gender`    | `Gender`   | yes      | `@IsEnum(Gender)`                 |
| `groupId`   | `string`   | no       | `@IsUUID @IsOptional`             |
| `parentIds` | `string[]` | no       | `@IsArray @IsUUID each @IsOptional` |

### `UpdateChildDto`

All fields from `CreateChildDto` made optional (same pattern as `UpdateGroupDto`).

---

## 4. Service Logic

### `validateParents(ids: string[])`

Mirror of `validateTeachers` in `GroupsService`:
- Query all users by IDs → throw `NotFoundException` for any missing IDs
- Check each user has `role === parent` → throw `BadRequestException` for non-parents

### `create(dto)`

1. If `groupId` provided → verify group exists (`NotFoundException`)
2. If `parentIds` provided → `validateParents`
3. Create with Prisma `connect` for both `group` and `parents`

### `findAll()`

Return all children with `include: { group: true, parents: { omit: { password, refreshToken } } }`.

### `update(id, dto)`

1. Verify child exists (`NotFoundException`)
2. If `groupId` changes → verify new group exists
3. If `parentIds` provided → `validateParents` → use `set` to replace the full parents array
4. If `groupId: null` → disconnect from group (`{ disconnect: true }` or `set: null`)

### `delete(id)`

1. Verify child exists (`NotFoundException`)
2. Delete

---

## 5. Module Structure

```
src/children/
  children.module.ts
  children.controller.ts
  children.service.ts
  dto/
    create-child.dto.ts
    update-child.dto.ts
```

`ChildrenModule` imports `PrismaModule` and is registered in `AppModule`.

---

## 6. Testing

Unit tests in `children.service.spec.ts` with a mocked `PrismaService`:

- `create`: success, `NotFoundException` for missing group, `BadRequestException` for non-parent user
- `findAll`: returns list with include
- `update`: success, `NotFoundException` for missing child
- `delete`: success, `NotFoundException` for missing child

No integration tests — consistent with the rest of the project.
