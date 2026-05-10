# Design: Auth + Users — Educational Platform Backend

**Date:** 2026-05-04  
**Stack:** NestJS 11, PostgreSQL, Prisma, JWT (HTTP-only cookies)

---

## Overview

Backend for an educational platform with role-based access control. No public registration — users are created by admins. Authentication via login/password with JWT access + refresh tokens stored as HTTP-only cookies.

---

## Roles

| Role | Created by | Can create |
|---|---|---|
| `root` | Seed on app start | all roles |
| `admin` | root or admin | admin, teacher, parent |
| `teacher` | root or admin | — |
| `parent` | root or admin | — |

---

## Project Structure

```
src/
├── prisma/
│   └── prisma.service.ts
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts       # POST /auth/login, /auth/refresh, /auth/logout
│   ├── auth.service.ts
│   ├── strategies/
│   │   └── jwt.strategy.ts
│   └── guards/
│       ├── jwt-auth.guard.ts
│       └── roles.guard.ts
├── users/
│   ├── users.module.ts
│   ├── users.controller.ts      # POST /users, GET /users, PATCH /users/:id
│   └── users.service.ts
├── seed/
│   ├── seed.module.ts
│   └── seed.service.ts          # OnApplicationBootstrap → creates root if missing
├── common/
│   └── decorators/
│       └── roles.decorator.ts
└── app.module.ts
```

---

## Database Schema

```prisma
model User {
  id           String   @id @default(uuid())
  login        String   @unique
  password     String   // bcrypt hash
  role         Role
  refreshToken String?  // bcrypt hash; null = logged out
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

enum Role {
  root
  admin
  teacher
  parent
}
```

**Key decisions:**
- UUID primary key — safer for public APIs than sequential int
- `refreshToken` stored as bcrypt hash — useless if DB is leaked
- `refreshToken: null` signals logged-out state
- `isActive: false` blocks login without deleting the record (preserves history)

---

## Environment Variables

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/edu_db"

JWT_SECRET=super_secret_key_change_me
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

ROOT_LOGIN=root
ROOT_PASSWORD=Root123!
```

---

## API Endpoints

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/auth/login` | public | Login, sets tokens as HTTP-only cookies |
| `POST` | `/auth/refresh` | authenticated | Rotates token pair |
| `POST` | `/auth/logout` | authenticated | Clears refreshToken in DB and cookies |
| `POST` | `/users` | root, admin | Create user |
| `GET` | `/users` | root, admin | List users |
| `PATCH` | `/users/:id` | root, admin | Update user (incl. isActive) |

---

## Auth Flow

### Login (`POST /auth/login`)
1. Find user by `login`
2. Check `isActive === true`
3. Compare password via `bcrypt.compare`
4. Generate `accessToken` (15m) and `refreshToken` (30d)
5. Store `bcrypt.hash(refreshToken)` in DB
6. Set both as HTTP-only cookies

### Refresh (`POST /auth/refresh`)
1. Read `refreshToken` from cookie
2. Find user by `id` from token payload
3. Compare token against DB hash via `bcrypt.compare`
4. Generate new token pair (rotation — old token is invalidated)
5. Update hash in DB, return new cookies

### Logout (`POST /auth/logout`)
1. Read `accessToken` from cookie (JWT guard)
2. Set `refreshToken = null` in DB
3. Clear both cookies

### Guards
- `JwtAuthGuard` — validates access token from cookie
- `RolesGuard` — checks role from JWT payload against `@Roles()` decorator

---

## Role Enforcement on User Creation

- `root` can create any role
- `admin` can create `admin`, `teacher`, `parent` — **not** `root`
- Violation returns `403 Forbidden`

---

## Error Handling

| Situation | HTTP | Message |
|---|---|---|
| Wrong login or password | `401` | `Invalid credentials` |
| User blocked (`isActive: false`) | `401` | `Account is disabled` |
| Missing or invalid access token | `401` | (NestJS JWT guard default) |
| Invalid or mismatched refresh token | `401` | `Invalid refresh token` |
| Insufficient role | `403` | `Forbidden` |
| Admin tries to create `root` | `403` | `Forbidden` |
| Login already exists | `409` | `Login already taken` |

All errors via standard NestJS `HttpException`. No custom exception filter at this stage.

---

## Seed

`SeedService` implements `OnApplicationBootstrap`. On every app start it checks whether a user with `login = ROOT_LOGIN` exists. If not, creates one with `role: root` using credentials from `.env`.

---

## Infrastructure

PostgreSQL runs in Docker. A `docker-compose.yml` will be added to the project for local development.
