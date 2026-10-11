# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

NestJS 11 + Prisma 7 (PostgreSQL) backend for an education center: users with roles, groups, children, subscription types, subscriptions (session packs) and attendance tracking. Frontend is expected at `http://localhost:5173` (CORS with credentials is hardcoded in `src/main.ts`).

## Commands

```bash
docker compose up -d            # Postgres 16 on :5432 (user/pass postgres, db edu_db)
npm run start:dev               # watch mode, port from PORT or 3000
npm run build                   # nest build -> dist/
npm run lint                    # eslint WITH --fix: rewrites files, check git diff after
npm run format                  # prettier (singleQuote, trailingComma all)

npm test                        # unit tests (*.spec.ts under src/)
npx jest src/users/users.service.spec.ts   # single file
npx jest -t "throws when user not found"   # single test by name
npm run test:e2e                # test/jest-e2e.json

npx prisma migrate dev --name <name>   # create + apply migration
npx prisma generate                    # regenerate client after schema change
```

Verification before claiming done: `npm run lint` + `npm run build` + `npm test`, all clean.

## Stack versions

NestJS 11 and **Prisma 7** are newer than most of the model's training data. Prisma 7 differs from older versions: config in `prisma.config.ts` (datasource URL from `DATABASE_URL` via dotenv, not in `schema.prisma`), driver adapter `@prisma/adapter-pg` passed to `PrismaClient`. The `generator` in `schema.prisma` is `prisma-client-js` with no `output`, so the client is generated into `node_modules/.prisma/client` and imported from `@prisma/client` (if `output` is ever set, the client moves there). Check those generated types and `prisma.config.ts` instead of relying on memory.

## Environment

`.env` keys: `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `ROOT_LOGIN`, `ROOT_PASSWORD`. Optional: `PORT`, `NODE_ENV` (`production` enables `secure` cookies).

## Architecture

- **PrismaModule** is `@Global`; `PrismaService` extends `PrismaClient` using the `@prisma/adapter-pg` driver adapter. Services inject `PrismaService` directly; there is no repository layer.
- **SeedService** runs on `onApplicationBootstrap` and creates the `root` user from `ROOT_LOGIN`/`ROOT_PASSWORD` if it does not exist.
- **Global `ValidationPipe({ whitelist: true })`**: unknown DTO fields are stripped silently. DTOs use class-validator.

### Auth

- JWT stored in **httpOnly cookies** (`accessToken`, `refreshToken`), not Authorization headers. `JwtStrategy` reads from `req.cookies.accessToken`; `cookie-parser` is required.
- Both tokens are signed with the same `JWT_SECRET`. The refresh token is bcrypt-hashed and stored in `User.refreshToken`; `/auth/refresh` rotates it, `/auth/logout` nulls it.
- Cookie `maxAge` values in `AuthService.setCookies` are hardcoded (15m / 30d) and must be kept in sync with `JWT_ACCESS_EXPIRES` / `JWT_REFRESH_EXPIRES`.
- `JwtStrategy.validate` re-fetches the user on every request and rejects inactive users; `req.user` is `AuthenticatedUser` (`{ id, role, login }`), accessed via `@CurrentUser()`.

### Authorization pattern

Controllers use `@UseGuards(JwtAuthGuard, RolesGuard)` plus `@Roles(...)` at class or method level (method overrides class via `getAllAndOverride`). `RolesGuard` allows everything when no `@Roles` is set, so always declare roles on protected routes.

Roles (`Role` enum): `root`, `admin`, `teacher`, `parent`. Rules enforced in services, not guards:
- `admin` cannot create/update a user into `root`; `root` user cannot be deleted and is hidden from `GET /users`.
- `parent` can only read subscriptions of their own children (`SubscriptionsService.findByChild`).
- User responses must strip `password` and `refreshToken` (destructuring in UsersService, `omit` in Prisma includes elsewhere).

### Domain: subscriptions

- `Subscription` snapshots `pricePerSession` from its `SubscriptionType` at creation; `totalPrice = pricePerSession * totalSessions`. Changing a type's price does not affect existing subscriptions.
- `SubscriptionsModule` hosts three controllers: `/subscriptions`, nested `/subscriptions/:subscriptionId/attendances`, and `/children/:childId/subscriptions` (route shared with `ChildrenController` prefix).
- Creating an attendance decrements `remainingSessions` in a `$transaction`; hitting 0 sets status `finished`. Deleting an attendance increments it back and reverts `finished` to `active`. Only `active` subscriptions accept attendance; only `active` ones can be cancelled.

## Module conventions

**Reference module: `src/children/`** (module + controller + service + `dto/` + `service.spec.ts`). For transactions and nested routes see `src/subscriptions/`. Copy these patterns, don't invent new ones.

- Folder `src/<module>/`: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `<module>.service.spec.ts`, `dto/create-<x>.dto.ts`, `dto/update-<x>.dto.ts`. Register the module in `AppModule`.
- DTOs: `CreateXDto` / `UpdateXDto` with class-validator decorators. `UpdateXDto` is written by hand with `@IsOptional()` on every field (no `PartialType`). IDs validated with `@IsUUID('4')`, dates as `@IsDateString()` strings converted with `new Date()` in the service.
- Controllers are thin: guards + roles + delegate to the service. Existence checks, role rules and business rules live in services.
- Errors: throw Nest built-ins: `NotFoundException` (missing entity), `ConflictException` (unique clash), `ForbiddenException` (role/ownership), `BadRequestException` (invalid state or relation), `UnauthorizedException` (auth only).
- **Error messages are in English** (`'Child not found'`). The frontend translates them to Ukrainian, so keep existing message strings stable; changing one is an API change (see Frontend). Response shape is Nest default `{ statusCode, message, error }`; for ValidationPipe errors `message` is an array of strings.
- Mutations with no meaningful result respond `{ message: '...' }` (e.g. delete).

## Testing conventions

New or changed service methods need unit tests. Unit tests cover services only, using `Test.createTestingModule` with `PrismaService` replaced by a plain object of `jest.fn()` mocks (see `src/auth/auth.service.spec.ts`). For code using `$transaction(async tx => ...)`, mock `$transaction` to invoke the callback with the mock client. No test DB is used.

## Frontend

Frontend repo: `frontend-edu-nest` (https://github.com/NazarOstapyuk/frontend-edu-nest, React, has its own CLAUDE.md). Each backend module has a client in `src/shared/api/<module>.ts` there with mirrored DTO interfaces.

- Changing an endpoint path, method, request DTO, response shape, status code or error message breaks the frontend. List all API changes in the final summary so the frontend can be updated.
- Don't edit the frontend repo from this session unless asked. If asked, read its CLAUDE.md first.
- `POST /auth/refresh` (used by the frontend's planned refresh-in-interceptor):
  - Success: `201` (Nest default for POST), body `{ message: 'Token refreshed' }`, new `accessToken` + `refreshToken` cookies set (refresh token rotated).
  - Missing, invalid, expired or already-rotated refresh cookie, or inactive user: `401` `{ statusCode: 401, message: 'Invalid refresh token', error: 'Unauthorized' }`. Cookies are not cleared. The client must not retry refresh on this 401.
- Any guarded route with an expired or missing access cookie returns `401` `{ statusCode: 401, message: 'Unauthorized' }`.

## Workflow (superpowers)

Design specs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. Check the relevant spec before changing a module's behavior.

For new modules and features:

1. `superpowers:brainstorming` → spec `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`, commit `docs: add <feature> design spec`.
2. `superpowers:writing-plans` → plan `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, commit `docs: add <feature> implementation plan`.
3. `superpowers:subagent-driven-development` or `superpowers:executing-plans` → one plan task = one commit (schema first, then service + tests, then controller + module).
4. `superpowers:verification-before-completion` → lint + build + test.

Full cycle example: `docs/superpowers/specs/2026-05-16-subscriptions-design.md` → `docs/superpowers/plans/2026-05-16-subscriptions.md`.

Bug fixes and changes touching one or two files: no brainstorming or plan, implement directly + verify.

## Comments

Don't write code comments. Exceptions: lint directives required by the codebase, and a one-line comment only when the code would otherwise look like a bug (a deliberate workaround, e.g. the `groupId: null` note in `UpdateChildDto`). Don't delete or rewrite existing comments.

## Git

- Single branch `main`. No CI yet.
- Don't push without an explicit request.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`), one logical change per commit.

## Don'ts

- Never run `prisma migrate reset`, `prisma db push --force-reset`, `docker compose down -v` or otherwise drop data without an explicit request.
- Don't edit migrations that are already applied; create a new one with `prisma migrate dev --name <name>`.
- Don't change CORS in `main.ts`, the global `ValidationPipe`, cookie options or JWT config without an explicit request.
- Don't add dependencies without approval.
- Don't commit `.env` or secrets.
- Don't touch `README.md` (Nest boilerplate) without a request.
