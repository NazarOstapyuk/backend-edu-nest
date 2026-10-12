# Parent Cabinet and Session Refresh (Part 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parents log in, change their password on first login, and see all their children with card, visits and money (charged, period, paid, remaining, overdue, prepayment); staff get contacts/middle names; the frontend refreshes the session on 401.

**Architecture:** Backend adds contact fields and a `mustChangePassword` gate enforced in `JwtAuthGuard`, `/me/password` and `/me/contacts` in the auth module, and a separate `src/parent-cabinet/` module with parent-safe views built on the existing `finance-calc.ts`. Frontend adds a refresh-on-401 interceptor, role-based routing with a `ParentLayout`, parent pages, a profile page and admin form fields.

**Tech Stack:** NestJS 11, Prisma 7, class-validator, Jest. Frontend: React 19, MUI 9, Zustand 5, react-hook-form 7 + yup, axios.

**Spec:** `docs/superpowers/specs/2026-10-12-parent-cabinet-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest` branch `feature/parent-cabinet` (checked out, spec committed), Tasks 1–5. Frontend `D:\IT\EduNest` branch `feature/parent-cabinet` (created from `main`, checked out), Tasks 6–9.

## Global Constraints

- Node 22; Prisma 7 — check generated types in `node_modules/.prisma/client/index.d.ts` instead of guessing.
- Money: `Prisma.Decimal` in code, 2-decimal strings in the API, computed only with `src/finance/finance-calc.ts` helpers.
- Business dates are UTC-midnight `Date`s; "today" = `kyivToday()` from `src/tariffs/dates.ts`.
- Phone format `/^\+380\d{9}$/`; new password min 8 characters.
- New error messages exactly: `Password change required` (403), `Invalid current password` (400), `New password must differ from the current one` (400), `Phone is required for parents` (400). Foreign/missing child in the cabinet: `Child not found` (404).
- Cabinet views never contain voided records, unconfirmed payments, `note`, `reference`, `createdBy`/`voidedBy`, void reasons.
- Don't change cookie options, JWT config, CORS or the global ValidationPipe.
- No new dependencies. No code comments.
- Backend: `npx eslint --fix <touched files>` before each commit; no new lint errors/warnings (baseline: 4 errors `_p`/`_r` in `src/users/users.service.ts`, 1 `no-unsafe-assignment` in `src/children/children.service.spec.ts`). Jest mocks typed with `as unknown as X`, never `as any` in new code.
- Frontend: before Task 6 save `npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx"` to `<scratchpad>/fe-tsc-baseline-part6.txt`; tasks add no lines; `npx eslint` on touched files 0 errors. Never touch the user's untracked `src/shared/api/children 2.ts` / `children 3.ts`; never `git add -A`.
- Frontend stores: selectors return existing references; stale async results ignored when the selected child changed.
- Commits: Conventional Commits, one task = one commit unless stated, with the committing model's attribution trailer. Never push.
- The user's dev servers own ports 3000 and 5173 — never stop them; use PORT=3100 for live checks and stop only your own process.

## Review Focus

1. A parent requests another family's child id → 404 `Child not found`, never data. Pinned in Task 4.
2. A parent still on the generated password calls any data endpoint → 403 `Password change required`; `GET /auth/me`, logout and `POST /me/password` still work. Pinned in Task 3.
3. A charge with no period created late yesterday Kyiv time is overdue today; one with `periodEnd` = today is not. Pinned in Task 4.
4. Several requests fail with 401 at once → one `/auth/refresh`, then all retried; a failed refresh logs out with one notice. Pinned in Task 6 (manual check list).
5. Admin resets a parent's password → the parent is forced to change it and old sessions stop refreshing. Pinned in Task 2.

---

## File Map

Backend:

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, migration `add_parent_cabinet` | New fields + parent flag data update |
| `src/users/*`, `src/children/*` | Contact fields, middle name, phone rule, admin reset flag |
| `src/finance/finance.service.ts` | Child finance view adds `parents` with contacts |
| `src/common/decorators/allow-without-password-change.decorator.ts` | Handler marker |
| `src/auth/password-gate.ts` | Pure gate check |
| `src/auth/guards/jwt-auth.guard.ts`, `strategies/jwt.strategy.ts` | Enforce gate, expose flag |
| `src/auth/auth.service.ts`, `me.controller.ts`, `dto/*` | Profile, password change, contacts |
| `src/parent-cabinet/cabinet-calc.ts` | Pure: overdue, per-child money |
| `src/parent-cabinet/parent-cabinet.service.ts`, `.controller.ts`, `.module.ts` | Family, card, finance |

Frontend:

| File | Responsibility |
|---|---|
| `src/shared/api/axiosInstance.ts` | Refresh on 401, password-change redirect, toasts |
| `src/shared/lib/phone.ts` | Phone normalization/validation |
| `src/entities/user/*`, `src/shared/api/auth.ts` | Session profile, auth actions |
| `src/app/router/*`, `src/app/layouts/ParentLayout.tsx` | Role routing |
| `src/widgets/header/ui/Header.tsx` | Staff header with name, profile, logout |
| `src/pages/profile/`, `src/pages/changePassword/` | Profile and forced password change |
| `src/shared/api/parentCabinet.ts`, `src/pages/family/`, `src/pages/familyChild/` | Parent pages |
| Users/children modals, finance header, `errorMessages.ts`, `CLAUDE.md` | Admin fields, translations, docs |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_parent_cabinet/migration.sql`

**Interfaces:**
- Produces: `User.middleName String?`, `User.phone String?`, `User.email String?`, `User.mustChangePassword Boolean @default(false)`, `Child.middleName String?`.

- [ ] **Step 1: Schema**

In `model User` after `lastName` add:

```prisma
  middleName         String?
  phone              String?
  email              String?
  mustChangePassword Boolean  @default(false)
```

In `model Child` after `lastName` add:

```prisma
  middleName    String?
```

- [ ] **Step 2: Create the migration without applying**

Run: `npx prisma migrate dev --create-only --name add_parent_cabinet`
Expected: new folder with `migration.sql` containing only `ALTER TABLE "User" ADD COLUMN ...` (4 columns) and `ALTER TABLE "Child" ADD COLUMN "middleName" TEXT`. If Prisma reports drift or asks to reset, STOP and report BLOCKED.

- [ ] **Step 3: Append the data update**

Append to the generated `migration.sql`:

```sql
UPDATE "User" SET "mustChangePassword" = true WHERE "role" = 'parent';
```

- [ ] **Step 4: Apply, generate, verify**

Run: `npx prisma migrate dev` then `npx prisma generate`, `npm run build`, `npx jest`.
Expected: migration applied; build exit 0; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add contact fields and password change flag"
```

---

### Task 2: Users, children and finance contacts

**Files:**
- Modify: `src/users/dto/create-user.dto.ts`, `src/users/dto/update-user.dto.ts`, `src/users/users.service.ts`, `src/users/users.service.spec.ts`
- Modify: `src/children/dto/create-child.dto.ts`, `src/children/dto/update-child.dto.ts`, `src/children/children.service.ts`, `src/children/children.service.spec.ts`
- Modify: `src/finance/finance.service.ts`, `src/finance/finance.service.spec.ts`
- Create: `src/common/validation/contacts.ts`

**Interfaces:**
- Produces: `PHONE_PATTERN` (`/^\+380\d{9}$/`) exported from `src/common/validation/contacts.ts`; user responses include `middleName`, `phone`, `email`, `mustChangePassword`; `GET /children/:childId/finance` response gains `parents: { id, firstName, lastName, middleName, phone, email }[]`.

- [ ] **Step 1: Shared pattern**

`src/common/validation/contacts.ts`:

```ts
export const PHONE_PATTERN = /^\+380\d{9}$/;
```

- [ ] **Step 2: DTOs**

`CreateUserDto` — add (import `IsEmail, IsOptional, Matches, MaxLength`):

```ts
  @IsString()
  @MaxLength(100)
  @IsOptional()
  middleName?: string;

  @Matches(PHONE_PATTERN)
  @IsOptional()
  phone?: string;

  @IsEmail()
  @MaxLength(200)
  @IsOptional()
  email?: string;
```

`UpdateUserDto` — add (import `IsEmail, Matches, MaxLength, ValidateIf`):

```ts
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  middleName?: string | null;

  @ValidateIf((_, value) => value !== null)
  @Matches(PHONE_PATTERN)
  @IsOptional()
  phone?: string | null;

  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @MaxLength(200)
  @IsOptional()
  email?: string | null;
```

`CreateChildDto` — add `@IsString() @MaxLength(100) @IsOptional() middleName?: string;`. `UpdateChildDto` — add `@ValidateIf((_, value) => value !== null) @IsString() @MaxLength(100) @IsOptional() middleName?: string | null;`.

- [ ] **Step 3: Write the failing tests**

Add to `src/users/users.service.spec.ts` inside `describe('create')`:

```ts
    it('requires a phone for parents', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { login: 'mom', password: 'pass123', role: Role.parent, firstName: 'Olena', lastName: 'Koval' },
          Role.admin,
        ),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('creates a parent who must change the password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'p1', password: 'h', refreshToken: null });

      await service.create(
        {
          login: 'mom',
          password: 'pass123',
          role: Role.parent,
          firstName: 'Olena',
          lastName: 'Koval',
          middleName: 'Ivanivna',
          phone: '+380671234567',
          email: 'mom@example.com',
        },
        Role.admin,
      );

      const data = (mockPrisma.user.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(data).toMatchObject({
        role: Role.parent,
        middleName: 'Ivanivna',
        phone: '+380671234567',
        email: 'mom@example.com',
        mustChangePassword: true,
      });
    });
```

Add a new `describe('update')` block:

```ts
  describe('update', () => {
    const parent = { id: 'p1', login: 'mom', role: Role.parent, phone: '+380671234567' };

    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue({ id: 'p1', password: 'h', refreshToken: null });
    });

    it('forces a password change and drops sessions on admin reset', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);

      await service.update('p1', { password: 'newpass1' }, Role.admin);

      const data = (mockPrisma.user.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(data).toMatchObject({ mustChangePassword: true, refreshToken: null });
      expect(typeof data.password).toBe('string');
    });

    it('refuses to clear the phone of a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);

      await expect(service.update('p1', { phone: null }, Role.admin)).rejects.toThrow(
        'Phone is required for parents',
      );
    });

    it('keeps a legacy parent without phone editable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...parent, phone: null });

      await service.update('p1', { firstName: 'Olena' }, Role.admin);

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('requires a phone when turning a user into a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...parent, role: Role.teacher, phone: null });

      await expect(service.update('p1', { role: Role.parent }, Role.admin)).rejects.toThrow(
        'Phone is required for parents',
      );
    });
  });
```

In `src/finance/finance.service.spec.ts` add `user: { findMany: jest.fn() }` to `mockPrisma` (if `user` exists, add `findMany`), set `mockPrisma.user.findMany.mockResolvedValue([])` in `beforeEach`, and add to `describe('getChildFinance')`:

```ts
    it('includes parents with contacts', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(child);
      const parents = [{ id: 'p1', firstName: 'Olena', lastName: 'Koval', middleName: null, phone: '+380671234567', email: null }];
      mockPrisma.user.findMany.mockResolvedValue(parents);

      const result = await service.getChildFinance('child-1');

      expect(result.parents).toEqual(parents);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { children: { some: { id: 'child-1' } } },
        select: { id: true, firstName: true, lastName: true, middleName: true, phone: true, email: true },
        orderBy: { lastName: 'asc' },
      });
    });
```

In `src/children/children.service.spec.ts` add a test that `create` passes `middleName` into `child.create` data (assert with `expect.objectContaining({ data: expect.objectContaining({ middleName: 'Petrivna' }) })`) — use the existing create test's setup as the template inside the same describe.

Run: `npx jest src/users src/children src/finance/finance.service.spec.ts` — the new tests FAIL.

- [ ] **Step 4: Implement**

`UsersService.create` — after the login check:

```ts
    if (dto.role === Role.parent && !dto.phone) {
      throw new BadRequestException('Phone is required for parents');
    }
```

and create data adds:

```ts
        middleName: dto.middleName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        mustChangePassword: dto.role === Role.parent,
```

`UsersService.update` — after loading `user`:

```ts
    const nextRole = dto.role ?? user.role;
    const clearsPhone = dto.phone === null;
    const becomesParent = dto.role === Role.parent && user.role !== Role.parent;
    const nextPhone = dto.phone !== undefined ? dto.phone : user.phone;
    if (nextRole === Role.parent && !nextPhone && (clearsPhone || becomesParent)) {
      throw new BadRequestException('Phone is required for parents');
    }
```

Extend the `data` type with `middleName?: string | null; phone?: string | null; email?: string | null; mustChangePassword?: boolean; refreshToken?: null;` and add:

```ts
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
      data.mustChangePassword = true;
      data.refreshToken = null;
    }
    if (dto.middleName !== undefined) data.middleName = dto.middleName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
```

(replace the existing `if (dto.password) data.password = ...` line).

`UsersService.findAll` select adds `middleName: true, phone: true, email: true, mustChangePassword: true`.

`ChildrenService.create` data adds `middleName: dto.middleName ?? null`; `update` data adds `middleName: dto.middleName`.

`FinanceService.getChildFinance`:

```ts
  async getChildFinance(childId: string) {
    const child = await this.findChild(childId);
    const [charges, payments] = await this.loadRecords(childId);
    const parents = await this.prisma.user.findMany({
      where: { children: { some: { id: childId } } },
      select: { id: true, firstName: true, lastName: true, middleName: true, phone: true, email: true },
      orderBy: { lastName: 'asc' },
    });
    return { ...buildChildFinance(child, charges, payments), parents };
  }
```

- [ ] **Step 5: Run tests and build**

Run: `npx jest` then `npm run build`. Expected: all pass; exit 0.

- [ ] **Step 6: Commit**

```bash
npx eslint --fix src/common/validation src/users src/children src/finance/finance.service.ts src/finance/finance.service.spec.ts
git add src/common/validation src/users src/children src/finance/finance.service.ts src/finance/finance.service.spec.ts
git commit -m "feat: add contacts, middle names and forced password change for parents"
```

---

### Task 3: Password-change gate, profile, password and contacts endpoints

**Files:**
- Create: `src/common/decorators/allow-without-password-change.decorator.ts`, `src/auth/password-gate.ts`, `src/auth/password-gate.spec.ts`, `src/auth/me.controller.ts`, `src/auth/dto/change-password.dto.ts`, `src/auth/dto/update-contacts.dto.ts`, `src/auth/auth.controllers.spec.ts`
- Modify: `src/common/types/authenticated-user.type.ts`, `src/auth/strategies/jwt.strategy.ts`, `src/auth/guards/jwt-auth.guard.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `PHONE_PATTERN` (Task 2).
- Produces:
  - `AuthenticatedUser = { id; role; login; mustChangePassword: boolean }`.
  - `ALLOW_WITHOUT_PASSWORD_CHANGE` key and `AllowWithoutPasswordChange()` decorator.
  - `assertPasswordChanged(user: { mustChangePassword: boolean } | undefined, allowed: boolean): void`.
  - `AuthService.getProfile(userId): Promise<Profile>`, `changePassword(userId, dto, res)`, `updateContacts(userId, dto): Promise<Profile>`.
  - `Profile = { id, login, role, firstName, lastName, middleName, phone, email, mustChangePassword }` (superset of the spec's `/auth/me` shape: phone and email added so the profile page needs one call).
  - Routes: `GET /auth/me` → Profile; `POST /me/password` → `{ message: 'Password changed' }`; `PATCH /me/contacts` → Profile.

- [ ] **Step 1: Pure gate, decorator, failing tests**

`src/common/decorators/allow-without-password-change.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_PASSWORD_CHANGE = 'allowWithoutPasswordChange';
export const AllowWithoutPasswordChange = () => SetMetadata(ALLOW_WITHOUT_PASSWORD_CHANGE, true);
```

`src/auth/password-gate.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { assertPasswordChanged } from './password-gate';

describe('assertPasswordChanged', () => {
  it('blocks a user who must change the password', () => {
    expect(() => assertPasswordChanged({ mustChangePassword: true }, false)).toThrow(
      new ForbiddenException('Password change required'),
    );
  });

  it('lets allowed handlers through', () => {
    expect(() => assertPasswordChanged({ mustChangePassword: true }, true)).not.toThrow();
  });

  it('lets users without the flag through', () => {
    expect(() => assertPasswordChanged({ mustChangePassword: false }, false)).not.toThrow();
    expect(() => assertPasswordChanged(undefined, false)).not.toThrow();
  });
});
```

`src/auth/auth.controllers.spec.ts`:

```ts
import { ALLOW_WITHOUT_PASSWORD_CHANGE } from '../common/decorators/allow-without-password-change.decorator';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';

const allowed = (controller: { prototype: object }, method: string) =>
  Reflect.getMetadata(
    ALLOW_WITHOUT_PASSWORD_CHANGE,
    (controller.prototype as Record<string, unknown>)[method] as object,
  ) as boolean | undefined;

describe('password change gate markers', () => {
  it('marks only me, logout and password change', () => {
    expect(allowed(AuthController, 'me')).toBe(true);
    expect(allowed(AuthController, 'logout')).toBe(true);
    expect(allowed(MeController, 'changePassword')).toBe(true);
    expect(allowed(MeController, 'updateContacts')).toBeUndefined();
  });
});
```

Add to `src/auth/auth.service.spec.ts` (add `user.findUnique`/`update` mocks already exist; mock `bcrypt` via `jest.spyOn`):

```ts
  describe('changePassword', () => {
    const stored = { id: 'u1', role: 'parent', password: 'hash-old', mustChangePassword: true };

    it('rejects a wrong current password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);
      jest.spyOn(bcrypt, 'compare').mockResolvedValueOnce(false as never);

      await expect(
        service.changePassword('u1', { currentPassword: 'x', newPassword: 'newpass12' }, mockRes as unknown as Response),
      ).rejects.toThrow('Invalid current password');
    });

    it('rejects the same password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);
      jest.spyOn(bcrypt, 'compare').mockResolvedValueOnce(true as never);

      await expect(
        service.changePassword('u1', { currentPassword: 'samepass1', newPassword: 'samepass1' }, mockRes as unknown as Response),
      ).rejects.toThrow('New password must differ from the current one');
    });

    it('stores the new password, clears the flag and issues fresh cookies', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(stored);
      jest.spyOn(bcrypt, 'compare').mockResolvedValueOnce(true as never);

      const result = await service.changePassword(
        'u1',
        { currentPassword: 'oldpass1', newPassword: 'newpass12' },
        mockRes as unknown as Response,
      );

      expect(result).toEqual({ message: 'Password changed' });
      const firstUpdate = (mockPrisma.user.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
      expect(firstUpdate).toMatchObject({ mustChangePassword: false, refreshToken: null });
      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateContacts', () => {
    it('refuses to clear a parent phone', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'parent', phone: '+380671234567' });

      await expect(service.updateContacts('u1', { phone: null as unknown as string })).rejects.toThrow(
        'Phone is required for parents',
      );
    });

    it('updates phone and email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', role: 'parent', phone: '+380671234567' });
      mockPrisma.user.update.mockResolvedValue({});

      await service.updateContacts('u1', { phone: '+380501112233', email: null });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { phone: '+380501112233', email: null },
      });
    });
  });
```

Add `import type { Response } from 'express';` to the spec if missing.

Run: `npx jest src/auth` — FAIL (missing modules/methods).

- [ ] **Step 2: Implement the gate**

`src/auth/password-gate.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';

export function assertPasswordChanged(user: { mustChangePassword: boolean } | undefined, allowed: boolean) {
  if (user?.mustChangePassword && !allowed) {
    throw new ForbiddenException('Password change required');
  }
}
```

`src/common/types/authenticated-user.type.ts`:

```ts
import { Role } from '@prisma/client';

export type AuthenticatedUser = {
  id: string;
  role: Role;
  login: string;
  mustChangePassword: boolean;
};
```

`JwtStrategy.validate` returns `{ id: user.id, role: user.role, login: user.login, mustChangePassword: user.mustChangePassword }`.

`src/auth/guards/jwt-auth.guard.ts`:

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_WITHOUT_PASSWORD_CHANGE } from '../../common/decorators/allow-without-password-change.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.type';
import { assertPasswordChanged } from '../password-gate';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const allowed =
      this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_PASSWORD_CHANGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    assertPasswordChanged(user, allowed);
    return true;
  }
}
```

- [ ] **Step 3: DTOs and service**

`src/auth/dto/change-password.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}
```

`src/auth/dto/update-contacts.dto.ts`:

```ts
import { IsEmail, IsOptional, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PHONE_PATTERN } from '../../common/validation/contacts';

export class UpdateContactsDto {
  @ValidateIf((_, value) => value !== null)
  @Matches(PHONE_PATTERN)
  @IsOptional()
  phone?: string;

  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @MaxLength(200)
  @IsOptional()
  email?: string | null;
}
```

In `AuthService` add (imports `BadRequestException, NotFoundException`, `Role`, DTOs):

```ts
  private readonly profileSelect = {
    id: true,
    login: true,
    role: true,
    firstName: true,
    lastName: true,
    middleName: true,
    phone: true,
    email: true,
    mustChangePassword: true,
  } as const;

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: this.profileSelect });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async changePassword(userId: string, dto: ChangePasswordDto, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const match = await bcrypt.compare(dto.currentPassword, user.password);
    if (!match) throw new BadRequestException('Invalid current password');
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must differ from the current one');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, 10), mustChangePassword: false, refreshToken: null },
    });
    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
    return { message: 'Password changed' };
  }

  async updateContacts(userId: string, dto: UpdateContactsDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.parent && dto.phone === null) {
      throw new BadRequestException('Phone is required for parents');
    }
    const data: { phone?: string; email?: string | null } = {};
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getProfile(userId);
  }
```

(Calling `getProfile` after the update uses `findUnique`; in the `updateContacts` test the second `findUnique` returns the same mock — fine.)

- [ ] **Step 4: Controllers and module**

`AuthController`: import `AllowWithoutPasswordChange`; `me` becomes:

```ts
  @UseGuards(JwtAuthGuard)
  @AllowWithoutPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }
```

and add `@AllowWithoutPasswordChange()` to `logout`.

`src/auth/me.controller.ts`:

```ts
import { Body, Controller, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AllowWithoutPasswordChange } from '../common/decorators/allow-without-password-change.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateContactsDto } from './dto/update-contacts.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private authService: AuthService) {}

  @AllowWithoutPasswordChange()
  @Post('password')
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.changePassword(user.id, dto, res);
  }

  @Patch('contacts')
  updateContacts(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateContactsDto) {
    return this.authService.updateContacts(user.id, dto);
  }
}
```

`AuthModule.controllers`: `[AuthController, MeController]`. `@HttpCode(200)` is not added (POST returns 201, consistent with `/auth/*`).

Note: other modules use `JwtAuthGuard` via `@UseGuards(JwtAuthGuard, ...)`; Nest resolves `Reflector` for it automatically. Run `npm run build` and grep for `new JwtAuthGuard(` — there must be none.

- [ ] **Step 5: Run tests and build**

Run: `npx jest` then `npm run build`. Expected: all pass (existing specs that build `AuthenticatedUser` literals may need `mustChangePassword: false` added — add it), exit 0.

- [ ] **Step 6: Commit**

```bash
npx eslint --fix src/auth src/common
git add src/auth src/common
git commit -m "feat: gate access until password change and add profile endpoints"
```

---

### Task 4: Parent cabinet module

**Files:**
- Create: `src/parent-cabinet/cabinet-calc.ts`, `cabinet-calc.spec.ts`, `parent-cabinet.service.ts`, `parent-cabinet.service.spec.ts`, `parent-cabinet.controller.ts`, `parent-cabinet.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `finance-calc.ts` (`activeAllocated`, `chargeRemaining`, `chargeState`, `formatMoney`, `isCountedPayment`, `paymentFree`, `sumMoney`, `money`), `kyivToday`, `effectiveExpiry`, `packageRemaining`, `packageState` (`src/classes/consumption.ts`).
- Produces routes `GET /me/family`, `GET /me/children/:id`, `GET /me/children/:id/finance` with shapes from the spec.
  - `chargeLastDay(c: { periodStart: Date | null; periodEnd: Date | null; createdAt: Date }): Date`
  - `isOverdue(c: ChargeMoneyLike, today: Date): boolean`
  - `childMoney(charges: ChargeMoneyLike[], payments: PaymentMoneyLike[], today: Date): ChildMoney`
  - `ChildMoney = { due: string; overdue: string; prepayment: string; unallocated: string; categories: { category: FinanceCategory; due: string; overdue: string; prepayment: string }[] }`

- [ ] **Step 1: Pure calc tests**

`src/parent-cabinet/cabinet-calc.spec.ts`:

```ts
import { FinanceCategory, PaymentStatus, Prisma } from '@prisma/client';
import { chargeLastDay, childMoney, isOverdue } from './cabinet-calc';

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const d = (v: string) => new Prisma.Decimal(v);
const TODAY = day('2026-10-12');

const charge = (over: Record<string, unknown> = {}) => ({
  category: FinanceCategory.tuition,
  amount: d('1000'),
  periodStart: day('2026-09-01'),
  periodEnd: day('2026-09-30'),
  createdAt: new Date('2026-08-27T10:00:00Z'),
  voidedAt: null,
  allocations: [] as { amount: Prisma.Decimal; voidedAt: Date | null }[],
  ...over,
});

describe('chargeLastDay', () => {
  it('uses periodEnd, then periodStart, then the Kyiv day of createdAt', () => {
    expect(chargeLastDay(charge())).toEqual(day('2026-09-30'));
    expect(chargeLastDay(charge({ periodEnd: null }))).toEqual(day('2026-09-01'));
    expect(
      chargeLastDay(charge({ periodEnd: null, periodStart: null, createdAt: new Date('2026-10-11T22:30:00Z') })),
    ).toEqual(day('2026-10-12'));
  });
});

describe('isOverdue', () => {
  it('is overdue only after the last day with money left', () => {
    expect(isOverdue(charge(), TODAY)).toBe(true);
    expect(isOverdue(charge({ periodEnd: TODAY }), TODAY)).toBe(false);
    expect(isOverdue(charge({ allocations: [{ amount: d('1000'), voidedAt: null }] }), TODAY)).toBe(false);
    expect(
      isOverdue(charge({ periodEnd: null, periodStart: null, createdAt: new Date('2026-10-11T20:00:00Z') }), TODAY),
    ).toBe(true);
  });
});

describe('childMoney', () => {
  it('sums due, overdue and prepayment per category and overall', () => {
    const charges = [
      charge({ allocations: [{ amount: d('400'), voidedAt: null }] }),
      charge({ periodStart: day('2026-10-01'), periodEnd: day('2026-10-31') }),
      charge({ category: FinanceCategory.extra_classes, amount: d('300'), voidedAt: new Date() }),
    ];
    const payments = [
      { amount: d('500'), category: FinanceCategory.extra_classes, status: PaymentStatus.confirmed, voidedAt: null, allocations: [] },
      { amount: d('200'), category: null, status: PaymentStatus.confirmed, voidedAt: null, allocations: [] },
      { amount: d('900'), category: null, status: PaymentStatus.pending, voidedAt: null, allocations: [] },
    ];

    const money = childMoney(charges, payments, TODAY);

    expect(money).toMatchObject({ due: '1600.00', overdue: '600.00', prepayment: '700.00', unallocated: '200.00' });
    expect(money.categories.find((c) => c.category === FinanceCategory.tuition)).toEqual({
      category: FinanceCategory.tuition,
      due: '1600.00',
      overdue: '600.00',
      prepayment: '0.00',
    });
    expect(money.categories.find((c) => c.category === FinanceCategory.extra_classes)).toEqual({
      category: FinanceCategory.extra_classes,
      due: '0.00',
      overdue: '0.00',
      prepayment: '500.00',
    });
  });
});
```


Run: `npx jest src/parent-cabinet` — FAIL.

- [ ] **Step 2: Implement `cabinet-calc.ts`**

```ts
import { FinanceCategory } from '@prisma/client';
import {
  AllocationLike,
  Money,
  PaymentLike,
  activeAllocated,
  formatMoney,
  isCountedPayment,
  paymentFree,
  sumMoney,
} from '../finance/finance-calc';
import { kyivToday } from '../tariffs/dates';

export interface ChargeMoneyLike {
  category: FinanceCategory;
  amount: Money;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  voidedAt: Date | null;
  allocations: AllocationLike[];
}

export interface ChildMoney {
  due: string;
  overdue: string;
  prepayment: string;
  unallocated: string;
  categories: { category: FinanceCategory; due: string; overdue: string; prepayment: string }[];
}

export const chargeLastDay = (c: { periodStart: Date | null; periodEnd: Date | null; createdAt: Date }): Date =>
  c.periodEnd ?? c.periodStart ?? kyivToday(c.createdAt);

const remaining = (c: ChargeMoneyLike): Money => c.amount.minus(activeAllocated(c.allocations));

export const isOverdue = (c: ChargeMoneyLike, today: Date): boolean =>
  remaining(c).gt(0) && chargeLastDay(c).getTime() < today.getTime();

export function childMoney(charges: ChargeMoneyLike[], payments: PaymentLike[], today: Date): ChildMoney {
  const active = charges.filter((c) => !c.voidedAt);
  const counted = payments.filter(isCountedPayment);
  const categories = Object.values(FinanceCategory).map((category) => {
    const own = active.filter((c) => c.category === category);
    return {
      category,
      due: sumMoney(own.map(remaining)),
      overdue: sumMoney(own.filter((c) => isOverdue(c, today)).map(remaining)),
      prepayment: sumMoney(counted.filter((p) => p.category === category).map(paymentFree)),
    };
  });
  const unallocated = sumMoney(counted.filter((p) => p.category === null).map(paymentFree));
  return {
    due: formatMoney(sumMoney(categories.map((c) => c.due))),
    overdue: formatMoney(sumMoney(categories.map((c) => c.overdue))),
    prepayment: formatMoney(sumMoney(categories.map((c) => c.prepayment)).plus(unallocated)),
    unallocated: formatMoney(unallocated),
    categories: categories.map((c) => ({
      category: c.category,
      due: formatMoney(c.due),
      overdue: formatMoney(c.overdue),
      prepayment: formatMoney(c.prepayment),
    })),
  };
}
```

Run: `npx jest src/parent-cabinet/cabinet-calc.spec.ts` — PASS.

- [ ] **Step 3: Service tests**

`src/parent-cabinet/parent-cabinet.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AttendanceStatus, FinanceCategory, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ParentCabinetService } from './parent-cabinet.service';

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const d = (v: string) => new Prisma.Decimal(v);
const TODAY = day('2026-10-12');

const mockPrisma = {
  child: { findFirst: jest.fn(), findMany: jest.fn() },
  charge: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

const moneyChild = (id: string, chargeAmount: string) => ({
  id,
  firstName: 'Ann',
  lastName: id,
  middleName: null,
  group: null,
  charges: [
    {
      category: FinanceCategory.tuition,
      amount: d(chargeAmount),
      periodStart: day('2026-09-01'),
      periodEnd: day('2026-09-30'),
      createdAt: new Date('2026-08-27T10:00:00Z'),
      voidedAt: null,
      allocations: [],
    },
  ],
  payments: [],
});

describe('ParentCabinetService', () => {
  let service: ParentCabinetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ParentCabinetService, { provide: PrismaService, useValue: mockPrisma as unknown as PrismaService }],
    }).compile();
    service = module.get(ParentCabinetService);
  });

  it('returns the family with totals for the parent only', async () => {
    mockPrisma.child.findMany.mockResolvedValue([moneyChild('A', '1000'), moneyChild('B', '500')]);

    const family = await service.family('parent-1', TODAY);

    expect(firstArg<{ where: unknown }>(mockPrisma.child.findMany).where).toEqual({
      parents: { some: { id: 'parent-1' } },
    });
    expect(family.totals).toEqual({ due: '1500.00', overdue: '1500.00', prepayment: '0.00' });
    expect(family.children.map((c) => c.due)).toEqual(['1000.00', '500.00']);
  });

  it('hides a child of another family', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);

    await expect(service.finance('parent-1', 'foreign', TODAY)).rejects.toThrow('Child not found');
    expect(firstArg<{ where: unknown }>(mockPrisma.child.findFirst).where).toEqual({
      id: 'foreign',
      parents: { some: { id: 'parent-1' } },
    });
  });

  it('builds the finance view without voided or unconfirmed records and internal fields', async () => {
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'A' });
    mockPrisma.charge.findMany.mockResolvedValue([
      {
        id: 'c1',
        category: FinanceCategory.tuition,
        description: 'Садочок, вересень',
        amount: d('1000'),
        periodStart: day('2026-09-01'),
        periodEnd: day('2026-09-30'),
        createdAt: new Date('2026-08-27T10:00:00Z'),
        voidedAt: null,
        allocations: [{ amount: d('400'), voidedAt: null }],
      },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      {
        id: 'p1',
        amount: d('400'),
        category: FinanceCategory.tuition,
        method: PaymentMethod.cash,
        status: PaymentStatus.confirmed,
        receivedAt: new Date('2026-09-05T10:00:00Z'),
        voidedAt: null,
        allocations: [{ amount: d('400'), voidedAt: null, chargeId: 'c1', charge: { description: 'Садочок, вересень' } }],
      },
    ]);

    const view = await service.finance('parent-1', 'A', TODAY);

    expect(firstArg<{ where: unknown }>(mockPrisma.charge.findMany).where).toEqual({ childId: 'A', voidedAt: null });
    expect(firstArg<{ where: unknown }>(mockPrisma.payment.findMany).where).toEqual({
      childId: 'A',
      voidedAt: null,
      status: PaymentStatus.confirmed,
    });
    expect(view.charges[0]).toEqual({
      id: 'c1',
      category: FinanceCategory.tuition,
      description: 'Садочок, вересень',
      periodStart: day('2026-09-01'),
      periodEnd: day('2026-09-30'),
      amount: '1000.00',
      paid: '400.00',
      remaining: '600.00',
      state: 'partial',
      overdue: true,
      createdAt: new Date('2026-08-27T10:00:00Z'),
    });
    expect(view.payments[0]).toEqual({
      id: 'p1',
      receivedAt: new Date('2026-09-05T10:00:00Z'),
      amount: '400.00',
      method: PaymentMethod.cash,
      category: FinanceCategory.tuition,
      allocated: '400.00',
      free: '0.00',
      allocations: [{ chargeId: 'c1', description: 'Садочок, вересень', amount: '400.00' }],
    });
    expect(view.unallocated).toBe('0.00');
  });

  it('merges visits newest first', async () => {
    mockPrisma.child.findFirst
      .mockResolvedValueOnce({ id: 'A' })
      .mockResolvedValueOnce({
        id: 'A',
        firstName: 'Ann',
        lastName: 'Ant',
        middleName: null,
        birthDate: day('2021-03-01'),
        group: { id: 'g1', name: 'Сонечко' },
        parents: [],
        enrollments: [],
        packages: [],
        lessonAttendances: [
          {
            status: AttendanceStatus.present,
            isGuest: false,
            lesson: { date: day('2026-10-10'), classGroup: { name: 'LEGO 1', direction: { name: 'LEGO' } } },
          },
        ],
        adaptationVisits: [{ date: day('2026-10-11'), hours: d('2.5') }],
        subscriptions: [
          { subscriptionType: { name: 'Футбол' }, attendances: [{ date: new Date('2026-05-03T09:00:00Z'), note: null }] },
        ],
      });

    const card = await service.card('parent-1', 'A', TODAY);

    expect(card.visits).toEqual([
      { type: 'adaptation', date: day('2026-10-11'), hours: '2.50' },
      { type: 'lesson', date: day('2026-10-10'), groupName: 'LEGO 1', directionName: 'LEGO', status: AttendanceStatus.present, isGuest: false },
      { type: 'legacy', date: day('2026-05-03'), note: null, directionName: 'Футбол' },
    ]);
  });
});
```

Run: `npx jest src/parent-cabinet` — FAIL.

- [ ] **Step 4: Implement the service**

`src/parent-cabinet/parent-cabinet.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { AdjustmentType, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { activeAllocated, chargeState, formatMoney, paymentFree, sumMoney } from '../finance/finance-calc';
import { effectiveExpiry, packageRemaining, packageState } from '../classes/consumption';
import { kyivToday } from '../tariffs/dates';
import { childMoney, isOverdue } from './cabinet-calc';

const moneyCharge = {
  select: {
    category: true,
    amount: true,
    periodStart: true,
    periodEnd: true,
    createdAt: true,
    voidedAt: true,
    allocations: { select: { amount: true, voidedAt: true } },
  },
} as const;

const moneyPayment = {
  select: {
    amount: true,
    category: true,
    status: true,
    voidedAt: true,
    allocations: { select: { amount: true, voidedAt: true } },
  },
} as const;

const visitOrder = { adaptation: 0, lesson: 1, legacy: 2 } as const;

@Injectable()
export class ParentCabinetService {
  constructor(private prisma: PrismaService) {}

  private async assertOwnChild(parentId: string, childId: string) {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, parents: { some: { id: parentId } } },
      select: { id: true },
    });
    if (!child) throw new NotFoundException('Child not found');
  }

  async family(parentId: string, today: Date = kyivToday()) {
    const children = await this.prisma.child.findMany({
      where: { parents: { some: { id: parentId } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        group: { select: { id: true, name: true } },
        charges: moneyCharge,
        payments: moneyPayment,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const rows = children.map((c) => {
      const money = childMoney(c.charges, c.payments, today);
      return {
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        middleName: c.middleName,
        group: c.group,
        due: money.due,
        overdue: money.overdue,
        prepayment: money.prepayment,
      };
    });
    const total = (key: 'due' | 'overdue' | 'prepayment') => formatMoney(sumMoney(rows.map((r) => r[key])));
    return { children: rows, totals: { due: total('due'), overdue: total('overdue'), prepayment: total('prepayment') } };
  }
```

Continue the class:

```ts
  async card(parentId: string, childId: string, today: Date = kyivToday()) {
    await this.assertOwnChild(parentId, childId);
    const child = await this.prisma.child.findFirst({
      where: { id: childId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        birthDate: true,
        group: { select: { id: true, name: true } },
        parents: {
          select: { id: true, firstName: true, lastName: true, middleName: true, phone: true, email: true },
          orderBy: { lastName: 'asc' },
        },
        enrollments: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            tariff: { select: { name: true } },
            adjustments: {
              where: { type: AdjustmentType.pause, voidedAt: null },
              select: { startDate: true, endDate: true },
              orderBy: { startDate: 'asc' },
            },
          },
          orderBy: { startDate: 'desc' },
        },
        packages: {
          where: { voidedAt: null },
          include: {
            direction: { select: { name: true } },
            extensions: { select: { newExpiresAt: true, createdAt: true } },
            usages: { select: { voidedAt: true } },
          },
          orderBy: { purchaseDate: 'desc' },
        },
        lessonAttendances: {
          where: { voidedAt: null },
          select: {
            status: true,
            isGuest: true,
            lesson: {
              select: { date: true, classGroup: { select: { name: true, direction: { select: { name: true } } } } },
            },
          },
        },
        adaptationVisits: { where: { voidedAt: null }, select: { date: true, hours: true } },
        subscriptions: {
          select: { subscriptionType: { select: { name: true } }, attendances: { select: { date: true, note: true } } },
        },
      },
    });
    if (!child) throw new NotFoundException('Child not found');

    const visits = [
      ...child.lessonAttendances.map((a) => ({
        type: 'lesson' as const,
        date: a.lesson.date,
        groupName: a.lesson.classGroup.name,
        directionName: a.lesson.classGroup.direction.name,
        status: a.status,
        isGuest: a.isGuest,
      })),
      ...child.adaptationVisits.map((v) => ({ type: 'adaptation' as const, date: v.date, hours: formatMoney(v.hours) })),
      ...child.subscriptions.flatMap((s) =>
        s.attendances.map((a) => ({
          type: 'legacy' as const,
          date: kyivToday(a.date),
          note: a.note,
          directionName: s.subscriptionType.name,
        })),
      ),
    ].sort((a, b) => b.date.getTime() - a.date.getTime() || visitOrder[a.type] - visitOrder[b.type]);

    return {
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      middleName: child.middleName,
      birthDate: child.birthDate,
      group: child.group,
      parents: child.parents,
      enrollments: child.enrollments.map((e) => ({
        id: e.id,
        tariffName: e.tariff.name,
        startDate: e.startDate,
        endDate: e.endDate,
        pauses: e.adjustments,
      })),
      packages: child.packages.map((p) => {
        const remaining = packageRemaining(p);
        return {
          id: p.id,
          directionName: p.direction.name,
          sessionsTotal: p.sessionsTotal,
          used: p.sessionsTotal - remaining,
          remaining,
          expiresAt: effectiveExpiry(p),
          state: packageState(p, today),
        };
      }),
      visits,
    };
  }

  async finance(parentId: string, childId: string, today: Date = kyivToday()) {
    await this.assertOwnChild(parentId, childId);
    const [charges, payments] = await Promise.all([
      this.prisma.charge.findMany({
        where: { childId, voidedAt: null },
        select: {
          id: true,
          category: true,
          description: true,
          amount: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          voidedAt: true,
          allocations: { select: { amount: true, voidedAt: true } },
        },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.payment.findMany({
        where: { childId, voidedAt: null, status: PaymentStatus.confirmed },
        select: {
          id: true,
          amount: true,
          category: true,
          method: true,
          status: true,
          receivedAt: true,
          voidedAt: true,
          allocations: {
            select: { amount: true, voidedAt: true, chargeId: true, charge: { select: { description: true } } },
          },
        },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);
    const money = childMoney(charges, payments, today);
    return {
      summary: money.categories,
      unallocated: money.unallocated,
      charges: charges.map((c) => {
        const paid = activeAllocated(c.allocations);
        return {
          id: c.id,
          category: c.category,
          description: c.description,
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
          amount: formatMoney(c.amount),
          paid: formatMoney(paid),
          remaining: formatMoney(c.amount.minus(paid)),
          state: chargeState(c.amount, paid),
          overdue: isOverdue(c, today),
          createdAt: c.createdAt,
        };
      }),
      payments: payments.map((p) => ({
        id: p.id,
        receivedAt: p.receivedAt,
        amount: formatMoney(p.amount),
        method: p.method,
        category: p.category,
        allocated: formatMoney(activeAllocated(p.allocations)),
        free: formatMoney(paymentFree(p)),
        allocations: p.allocations
          .filter((a) => !a.voidedAt)
          .map((a) => ({ chargeId: a.chargeId, description: a.charge.description, amount: formatMoney(a.amount) })),
      })),
    };
  }
}
```

Note: Prisma orders `periodStart: 'desc'` with nulls first by default in Postgres; that keeps undated manual charges at the top, which is acceptable ("newest first" for dated ones). In the card test the first `findFirst` is the ownership check and the second the card load — keep that call order.

- [ ] **Step 5: Controller, module, registration**

`src/parent-cabinet/parent-cabinet.controller.ts`:

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ParentCabinetService } from './parent-cabinet.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.parent)
@Controller('me')
export class ParentCabinetController {
  constructor(private cabinet: ParentCabinetService) {}

  @Get('family')
  family(@CurrentUser() user: AuthenticatedUser) {
    return this.cabinet.family(user.id);
  }

  @Get('children/:id')
  card(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cabinet.card(user.id, id);
  }

  @Get('children/:id/finance')
  finance(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cabinet.finance(user.id, id);
  }
}
```

`src/parent-cabinet/parent-cabinet.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ParentCabinetController } from './parent-cabinet.controller';
import { ParentCabinetService } from './parent-cabinet.service';

@Module({
  controllers: [ParentCabinetController],
  providers: [ParentCabinetService],
})
export class ParentCabinetModule {}
```

Register `ParentCabinetModule` in `src/app.module.ts` after `ClassesModule`.

- [ ] **Step 6: Run tests and build**

Run: `npx jest` then `npm run build`. Expected: all pass; exit 0.

- [ ] **Step 7: Commit**

```bash
npx eslint --fix src/parent-cabinet src/app.module.ts
git add src/parent-cabinet src/app.module.ts
git commit -m "feat: add parent cabinet family, card and finance views"
```

---

### Task 5: Backend docs and live check

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md**

Add after "### Domain: classes and packages":

```markdown
### Domain: parent cabinet

Spec: `docs/superpowers/specs/2026-10-12-parent-cabinet-design.md`.

- Parents are created by admins (phone required, `mustChangePassword = true`); an admin password reset (`PATCH /users/:id` with `password`) sets the flag again and drops the refresh token.
- `JwtAuthGuard` rejects every request with 403 `Password change required` while `mustChangePassword` is true, except handlers marked `@AllowWithoutPasswordChange()` (`GET /auth/me`, `POST /auth/logout`, `POST /me/password`). Mark new handlers only if a user must reach them before changing the password.
- `GET /auth/me` returns the profile (names, phone, email, `mustChangePassword`); `POST /me/password` and `PATCH /me/contacts` work for every role.
- `src/parent-cabinet/` serves `/me/family`, `/me/children/:id`, `/me/children/:id/finance` for role `parent` only. Every child id is checked against the parent's children (404 `Child not found` otherwise). Views exclude voided records, unconfirmed payments and internal fields; money comes from `finance-calc.ts`, overdue rules from `cabinet-calc.ts`.
```

In the "Authorization pattern" section change "`parent` can only read subscriptions of their own children" bullet to also mention "and the parent cabinet views (`src/parent-cabinet/`)". In "Frontend" auth contracts, update `/auth/me` if it is described.

- [ ] **Step 2: Verify**

Run: `npm test`, `npm run build`, `npx eslint "src/parent-cabinet/**/*.ts" "src/auth/**/*.ts" src/users src/children src/finance/finance.service.ts src/common`. Expected: pass; exit 0; only baseline lint errors.

- [ ] **Step 3: Live check on PORT=3100**

Start your own `PORT=3100 npm run start:dev` (never touch 3000). Root login from `.env` (never print the password). Cookie jars and UTF-8 JSON bodies in the scratchpad (use the Write tool for bodies). Test data prefix «Тест Ч6».

1. Create parent P via `POST /users` without phone → 400 `Phone is required for parents`; with `phone: "+380671234567"` → 201, `mustChangePassword: true`.
2. Create children A and B (`POST /children`, `parentIds: [P]`; create a group if needed) and child C without P.
3. Root: create a charge for A (`POST /children/A/charges`, category tuition, amount 1000, period last month) and a confirmed cash payment of 400 allocated to it (check the finance DTOs for exact fields).
4. Login as P → `GET /me/family` → 403 `Password change required`; `GET /auth/me` → 200 with `mustChangePassword: true`.
5. `POST /me/password` wrong current → 400 `Invalid current password`; correct → 201 `{ message: 'Password changed' }`.
6. `GET /me/family` → A and B, totals `due: "600.00"`, `overdue: "600.00"`.
7. `GET /me/children/A/finance` → charge `remaining "600.00"`, `state "partial"`, `overdue true`; payment with allocation.
8. `GET /me/children/C` → 404 `Child not found`.
9. Root voids the charge → `GET /me/children/A/finance` no longer lists it.
10. Root resets P's password via `PATCH /users/P` → P's next `POST /auth/refresh` → 401; P logs in with the new password → `mustChangePassword: true`.
11. `PATCH /me/contacts` as P `{ "phone": null }` → 400 `Phone is required for parents`.

Stop only your 3100 server. Record requests and abbreviated responses in the report.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document parent cabinet in CLAUDE.md"
```

---

### Task 6: Frontend session refresh and session profile

Work in `D:\IT\EduNest` on `feature/parent-cabinet`. Read its `CLAUDE.md` first.

**Files:**
- Modify: `src/shared/api/axiosInstance.ts`, `src/shared/api/auth.ts`, `src/shared/api/errorMessages.ts`, `src/shared/api/index.ts`
- Modify: `src/entities/user/model/types.ts`, `src/entities/user/model/authStore.ts`, `src/entities/user/index.ts`
- Modify: `src/pages/login/ui/LoginPage.tsx`
- Create: `src/shared/lib/phone.ts`

**Interfaces:**
- Produces:
  - `SessionProfile = { id; login; role: SessionRole; firstName; lastName; middleName: string | null; phone: string | null; email: string | null; mustChangePassword: boolean }`
  - `homePath(profile: SessionProfile): string`
  - `useAuthStore`: `profile: SessionProfile | null`, `login`, `logout`, `fetchMe`, `changePassword(currentPassword, newPassword)`, `updateContacts({ phone?, email? })`, `markPasswordChangeRequired()`, `expireSession()`
  - `setSessionHandlers({ onExpired: () => void; onPasswordChangeRequired: () => void })` in `axiosInstance.ts`
  - `normalizePhone(input: string): string`, `isValidPhone(value: string): boolean`, `PHONE_PATTERN`

- [ ] **Step 1: Baseline**

```bash
npx tsc -b 2>&1 | grep -v "nav-items.ts\|Sidebar.tsx" > <scratchpad>/fe-tsc-baseline-part6.txt
```

- [ ] **Step 2: Phone helpers `src/shared/lib/phone.ts`**

```ts
export const PHONE_PATTERN = /^\+380\d{9}$/

export const normalizePhone = (input: string): string => {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('380')) return `+${digits}`
  if (digits.length === 10 && digits.startsWith('0')) return `+38${digits}`
  if (digits.length === 9) return `+380${digits}`
  return input.trim()
}

export const isValidPhone = (value: string) => PHONE_PATTERN.test(value)
```

- [ ] **Step 3: Types and auth API**

`src/entities/user/model/types.ts` add:

```ts
export interface SessionProfile {
  id: string
  login: string
  role: SessionRole
  firstName: string
  lastName: string
  middleName: string | null
  phone: string | null
  email: string | null
  mustChangePassword: boolean
}

export const homePath = (profile: SessionProfile) => {
  if (profile.mustChangePassword) return '/change-password'
  return profile.role === 'parent' ? '/family' : '/'
}
```

Add `middleName?: string | null; phone?: string | null; email?: string | null; mustChangePassword?: boolean` to `User`. Export `SessionProfile` and `homePath` from `src/entities/user/index.ts`.

`src/shared/api/auth.ts`:

```ts
import { axiosInstance } from './axiosInstance';
import type { SessionProfile } from '../../entities/user';

interface LoginCredentials {
  login: string;
  password: string;
}

export interface ContactsDto {
  phone?: string;
  email?: string | null;
}

export const authApi = {
  login: (credentials: LoginCredentials) => axiosInstance.post<{ message: string }>('/auth/login', credentials),
  logout: () => axiosInstance.post('/auth/logout'),
  me: () => axiosInstance.get<SessionProfile>('/auth/me'),
  refresh: () => axiosInstance.post('/auth/refresh'),
  changePassword: (currentPassword: string, newPassword: string) =>
    axiosInstance.post<{ message: string }>('/me/password', { currentPassword, newPassword }),
  updateContacts: (dto: ContactsDto) => axiosInstance.patch<SessionProfile>('/me/contacts', dto),
};
```

Export `ContactsDto` type from `src/shared/api/index.ts`.

- [ ] **Step 4: Interceptor `src/shared/api/axiosInstance.ts`**

Keep the BOM/first line state. Replace the interceptor:

```ts
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useNotifyStore } from '../model/notifyStore';
import { translateError } from './errorMessages';

export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout'];

type SessionHandlers = { onExpired: () => void; onPasswordChangeRequired: () => void };

let handlers: SessionHandlers = {
  onExpired: () => undefined,
  onPasswordChangeRequired: () => undefined,
};

export const setSessionHandlers = (next: SessionHandlers) => {
  handlers = next;
};

let refreshing: Promise<unknown> | null = null;

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean };

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const data = (error.response?.data ?? error) as { message?: unknown };
    const original = error.config as RetryConfig | undefined;

    if (status === 401 && original && !original._retried && !NO_REFRESH.some((p) => original.url?.startsWith(p))) {
      original._retried = true;
      refreshing ??= axiosInstance.post('/auth/refresh').finally(() => {
        refreshing = null;
      });
      try {
        await refreshing;
      } catch {
        handlers.onExpired();
        return Promise.reject(data);
      }
      return axiosInstance(original);
    }

    if (status === 403 && data.message === 'Password change required') {
      handlers.onPasswordChangeRequired();
      return Promise.reject(data);
    }

    if (status !== 401) {
      useNotifyStore.getState().push(translateError(data));
    }
    return Promise.reject(data);
  }
);
```

- [ ] **Step 5: Auth store `src/entities/user/model/authStore.ts`**

```ts
import { create } from 'zustand';
import { authApi, setSessionHandlers, type ContactsDto } from '../../../shared/api';
import { useNotifyStore } from '../../../shared/model/notifyStore';
import type { SessionProfile } from './types';

interface LoginCredentials {
  login: string;
  password: string;
}

interface AuthState {
  profile: SessionProfile | null;
  isLoading: boolean;
  isInitialized: boolean;
  login: (credentials: LoginCredentials) => Promise<SessionProfile>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<SessionProfile>;
  updateContacts: (dto: ContactsDto) => Promise<void>;
  markPasswordChangeRequired: () => void;
  expireSession: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  profile: null,
  isLoading: false,
  isInitialized: false,

  login: async (credentials) => {
    set({ isLoading: true });
    try {
      await authApi.login(credentials);
      const { data } = await authApi.me();
      set({ profile: data, isInitialized: true });
      return data;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ profile: null });
    }
  },

  fetchMe: async () => {
    set({ isLoading: true });
    try {
      const { data } = await authApi.me();
      set({ profile: data });
    } catch {
      set({ profile: null });
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    await authApi.changePassword(currentPassword, newPassword);
    const { data } = await authApi.me();
    set({ profile: data });
    return data;
  },

  updateContacts: async (dto) => {
    const { data } = await authApi.updateContacts(dto);
    set({ profile: data });
  },

  markPasswordChangeRequired: () => {
    const profile = get().profile;
    if (profile && !profile.mustChangePassword) set({ profile: { ...profile, mustChangePassword: true } });
  },

  expireSession: () => {
    if (get().profile) useNotifyStore.getState().push('Сесія завершилась, увійдіть знову');
    set({ profile: null, isInitialized: true });
  },
}));

setSessionHandlers({
  onExpired: () => useAuthStore.getState().expireSession(),
  onPasswordChangeRequired: () => useAuthStore.getState().markPasswordChangeRequired(),
});
```

Export `setSessionHandlers` from `src/shared/api/index.ts` (`export { axiosInstance, setSessionHandlers } from './axiosInstance';`). If importing `notifyStore` from `entities` violates the FSD rule in the frontend CLAUDE.md, import it via `shared/model` exactly as above (shared is allowed from entities).

- [ ] **Step 6: Login page**

In `LoginPage.tsx`: import `homePath` from `../../../entities/user` and `translateError` from `../../../shared/api`; replace `onSubmit`:

```tsx
    const onSubmit = async (data: FormData) => {
        try {
            const profile = await login(data)
            navigate(homePath(profile))
        } catch (error) {
            methods.setError('password', { message: translateError(error) })
        }
    }
```

Add to `errorMessages.ts`: `'Invalid credentials': 'Невірний логін або пароль'`, `'Account is disabled': 'Обліковий запис вимкнено'`, `'Password change required': 'Спочатку змініть пароль'`, `'Invalid current password': 'Невірний поточний пароль'`, `'New password must differ from the current one': 'Новий пароль має відрізнятися від поточного'`, `'Phone is required for parents': 'Для батьків потрібен телефон'`.

- [ ] **Step 7: Verify and commit**

Run the tsc diff (no new lines) and `npx eslint src/shared src/entities/user src/pages/login`. Fix any type errors your change caused in files that read `profile` (e.g. `Sidebar.tsx` casts `profile?.role` — it still compiles because `SessionProfile.role` is `SessionRole`; remove the now-unneeded cast only if eslint flags it).

Manual check list (record in the report as "to verify in the browser by the user" — do not start dev servers): expired access cookie → page still loads data; two parallel requests with an expired access cookie → one `/auth/refresh` in the network tab; deleted refresh cookie → redirected to login with one «Сесія завершилась» notice.

```bash
git add src/shared/api src/shared/lib src/entities/user src/pages/login
git commit -m "feat: refresh session on 401 and load full profile"
```

---

### Task 7: Role routing, layouts, profile and password pages

**Files:**
- Create: `src/app/router/RoleGate.tsx`, `src/app/router/PasswordGate.tsx`, `src/app/layouts/ParentLayout.tsx`, `src/app/layouts/RoleLayout.tsx`
- Create: `src/pages/profile/ui/ProfilePage.tsx`, `src/pages/profile/index.ts`, `src/pages/changePassword/ui/ChangePasswordPage.tsx`, `src/pages/changePassword/index.ts`, `src/shared/ui/PasswordFields.tsx`
- Modify: `src/app/router/index.tsx`, `src/widgets/header/ui/Header.tsx`

**Interfaces:**
- Consumes: `useAuthStore`, `homePath`, `SessionRole`, `normalizePhone`, `isValidPhone`.
- Produces routes `/change-password`, `/profile`, parent subtree `/family`, `/family/:childId` (pages come in Task 8; this task mounts placeholders `FamilyPage`/`FamilyChildPage` imported from `src/pages/family` and `src/pages/familyChild` created here as minimal components returning `<Typography>Завантаження…</Typography>` so the router compiles; Task 8 replaces them).

- [ ] **Step 1: Gates**

`src/app/router/RoleGate.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore, type SessionRole } from '../../entities/user'

interface RoleGateProps {
  roles: SessionRole[]
  redirectTo: string
}

export const RoleGate = ({ roles, redirectTo }: RoleGateProps) => {
  const role = useAuthStore((s) => s.profile?.role)
  if (!role || !roles.includes(role)) return <Navigate to={redirectTo} replace />
  return <Outlet />
}
```

`src/app/router/PasswordGate.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../entities/user'

export const PasswordGate = () => {
  const mustChange = useAuthStore((s) => s.profile?.mustChangePassword ?? false)
  if (mustChange) return <Navigate to="/change-password" replace />
  return <Outlet />
}
```

- [ ] **Step 2: Layouts**

`src/app/layouts/ParentLayout.tsx`:

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material'
import { useAuthStore } from '../../entities/user'
import { Notifier } from '../../shared/ui/Notifier'

export const ParentLayout = () => {
  const profile = useAuthStore((s) => s.profile)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout().catch(() => undefined)
    navigate('/login')
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#fff', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', mr: 'auto' }}>
            EduNest
          </Typography>
          <Button component={NavLink} to="/family" color="inherit">
            Моя сім'я
          </Button>
          <Button component={NavLink} to="/profile" color="inherit">
            {profile ? `${profile.firstName} ${profile.lastName}` : 'Профіль'}
          </Button>
          <Button color="inherit" onClick={handleLogout}>
            Вийти
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
        <Outlet />
      </Box>
      <Notifier />
    </Box>
  )
}
```

`src/app/layouts/RoleLayout.tsx`:

```tsx
import { useAuthStore } from '../../entities/user'
import { AdminLayout } from './AdminLayout'
import { ParentLayout } from './ParentLayout'

export const RoleLayout = () => {
  const role = useAuthStore((s) => s.profile?.role)
  return role === 'parent' ? <ParentLayout /> : <AdminLayout />
}
```

- [ ] **Step 3: Shared password fields and pages**

`src/shared/ui/PasswordFields.tsx`:

```tsx
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, TextField } from '@mui/material'

const schema = yup.object({
  currentPassword: yup.string().required("Обов'язкове поле"),
  newPassword: yup.string().min(8, 'Мінімум 8 символів').max(100, 'Максимум 100 символів').required("Обов'язкове поле"),
  repeatPassword: yup
    .string()
    .oneOf([yup.ref('newPassword')], 'Паролі не збігаються')
    .required("Обов'язкове поле"),
})

type FormValues = yup.InferType<typeof schema>

interface PasswordFieldsProps {
  submitLabel: string
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>
}

export const PasswordFields = ({ submitLabel, onSubmit }: PasswordFieldsProps) => {
  const { control, handleSubmit, reset, formState } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { currentPassword: '', newPassword: '', repeatPassword: '' },
    resolver: yupResolver(schema),
  })

  const submit = async (values: FormValues) => {
    await onSubmit(values.currentPassword, values.newPassword)
    reset()
  }

  const field = (name: keyof FormValues, label: string, autoComplete: string) => (
    <Controller
      name={name}
      control={control}
      render={({ field: f, fieldState: { error } }) => (
        <TextField {...f} type="password" label={label} autoComplete={autoComplete} fullWidth error={!!error} helperText={error?.message} />
      )}
    />
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {field('currentPassword', 'Поточний пароль', 'current-password')}
      {field('newPassword', 'Новий пароль', 'new-password')}
      {field('repeatPassword', 'Повторіть новий пароль', 'new-password')}
      <Button variant="contained" disabled={formState.isSubmitting} onClick={handleSubmit((v) => submit(v).catch(() => undefined))}>
        {submitLabel}
      </Button>
    </Box>
  )
}
```

`src/pages/changePassword/ui/ChangePasswordPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { Box, Typography } from '@mui/material'
import { homePath, useAuthStore } from '../../../entities/user'
import { PasswordFields } from '../../../shared/ui/PasswordFields'
import { Notifier } from '../../../shared/ui/Notifier'

export const ChangePasswordPage = () => {
  const changePassword = useAuthStore((s) => s.changePassword)
  const navigate = useNavigate()

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Box sx={{ bgcolor: 'background.paper', borderRadius: 3, boxShadow: '0 4px 24px rgba(0,0,0,0.10)', p: { xs: 3, sm: '40px 36px' }, width: '100%', maxWidth: 420 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Змініть пароль
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Пароль видав адміністратор. Задайте свій, щоб продовжити.
        </Typography>
        <PasswordFields
          submitLabel="Зберегти пароль"
          onSubmit={async (current, next) => {
            const profile = await changePassword(current, next)
            navigate(homePath(profile), { replace: true })
          }}
        />
      </Box>
      <Notifier />
    </Box>
  )
}
```

`src/pages/profile/ui/ProfilePage.tsx`:

```tsx
import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Box, Button, Paper, TextField, Typography } from '@mui/material'
import { useAuthStore } from '../../../entities/user'
import { useNotifyStore } from '../../../shared/model/notifyStore'
import { PasswordFields } from '../../../shared/ui/PasswordFields'
import { isValidPhone, normalizePhone } from '../../../shared/lib/phone'

const schema = yup.object({
  phone: yup
    .string()
    .default('')
    .test('phone', 'Формат +380XXXXXXXXX', (value) => !value || isValidPhone(normalizePhone(value))),
  email: yup.string().default('').email('Невірний email').max(200, 'Максимум 200 символів'),
})

type FormValues = yup.InferType<typeof schema>

export const ProfilePage = () => {
  const profile = useAuthStore((s) => s.profile)
  const updateContacts = useAuthStore((s) => s.updateContacts)
  const changePassword = useAuthStore((s) => s.changePassword)
  const push = useNotifyStore((s) => s.push)
  const isParent = profile?.role === 'parent'

  const { control, handleSubmit, reset, setError, formState } = useForm<FormValues>({
    mode: 'all',
    defaultValues: { phone: '', email: '' },
    resolver: yupResolver(schema),
  })

  useEffect(() => {
    if (profile) reset({ phone: profile.phone ?? '', email: profile.email ?? '' })
  }, [profile, reset])

  if (!profile) return null

  const saveContacts = async (values: FormValues) => {
    const phone = values.phone ? normalizePhone(values.phone) : ''
    if (isParent && !phone) {
      setError('phone', { message: 'Для батьків потрібен телефон' })
      return
    }
    await updateContacts({ phone: phone || undefined, email: values.email.trim() || null })
    push('Контакти збережено', 'success')
  }

  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
        <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
          {[profile.lastName, profile.firstName, profile.middleName].filter(Boolean).join(' ')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Логін: {profile.login}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Controller
            name="phone"
            control={control}
            render={({ field, fieldState: { error } }) => (
              <TextField {...field} label="Телефон" placeholder="+380671234567" fullWidth error={!!error} helperText={error?.message} />
            )}
          />
          <Controller
            name="email"
            control={control}
            render={({ field, fieldState: { error } }) => (
              <TextField {...field} label="Email" fullWidth error={!!error} helperText={error?.message} />
            )}
          />
          <Button variant="contained" disabled={formState.isSubmitting} onClick={handleSubmit((v) => saveContacts(v).catch(() => undefined))}>
            Зберегти контакти
          </Button>
        </Box>
      </Paper>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
        <Typography sx={{ fontWeight: 700, mb: 3 }}>Зміна пароля</Typography>
        <PasswordFields
          submitLabel="Змінити пароль"
          onSubmit={async (current, next) => {
            await changePassword(current, next)
            push('Пароль змінено', 'success')
          }}
        />
      </Paper>
    </Box>
  )
}
```

Index files: `export { ProfilePage } from './ui/ProfilePage'`, `export { ChangePasswordPage } from './ui/ChangePasswordPage'`. Placeholder pages for Task 8:

`src/pages/family/ui/FamilyPage.tsx` and `src/pages/familyChild/ui/FamilyChildPage.tsx` each:

```tsx
import { Typography } from '@mui/material'

export const FamilyPage = () => <Typography color="text.secondary">Завантаження…</Typography>
```

(`FamilyChildPage` analogous) with `index.ts` exporting them.

- [ ] **Step 4: Router**

Replace the `'/'` branch in `src/app/router/index.tsx`:

```tsx
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { path: 'change-password', element: <ChangePasswordPage /> },
      {
        element: <PasswordGate />,
        children: [
          {
            path: 'profile',
            element: <RoleLayout />,
            children: [{ index: true, element: <ProfilePage /> }],
          },
          {
            element: <RoleGate roles={['parent']} redirectTo="/" />,
            children: [
              {
                element: <ParentLayout />,
                children: [
                  { path: 'family', element: <FamilyPage /> },
                  { path: 'family/:childId', element: <FamilyChildPage /> },
                ],
              },
            ],
          },
          {
            element: <RoleGate roles={['root', 'admin', 'teacher']} redirectTo="/family" />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  /* existing AdminLayout children unchanged, including '*' */
                ],
              },
            ],
          },
        ],
      },
    ],
  },
```

Move the existing AdminLayout children array verbatim into the marked place (do not write the comment in code).

Replace `src/widgets/header/ui/Header.tsx` with:

```tsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppBar, Avatar, Box, Menu, MenuItem, Toolbar, Typography } from '@mui/material'
import { useAuthStore } from '../../../entities/user'
import { SIDEBAR_WIDTH } from '../../sidebar/ui/Sidebar'

const pageTitles: Record<string, string> = {
  '/':           'Дашборд',
  '/users':      'Користувачі',
  '/groups':     'Групи',
  '/students':   'Учні',
  '/finance':    'Фінанси',
  '/tariffs':    'Тарифи',
  '/classes':    'Гуртки',
  '/my-classes': 'Мої заняття',
  '/profile':    'Профіль',
  '/settings':   'Налаштування',
}

const roleCaption = { root: 'Адміністратор', admin: 'Адміністратор', teacher: 'Педагог', parent: 'Батьки' } as const

export const Header = () => {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const logout = useAuthStore((s) => s.logout)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const go = (path: string) => {
    setAnchor(null)
    navigate(path)
  }

  const handleLogout = async () => {
    setAnchor(null)
    await logout().catch(() => undefined)
    navigate('/login')
  }

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        width: `calc(100% - ${SIDEBAR_WIDTH}px)`,
        ml: `${SIDEBAR_WIDTH}px`,
        backgroundColor: '#fff',
        borderBottom: '1px solid',
        borderColor: 'divider',
        color: 'text.primary',
      }}
    >
      <Toolbar sx={{ gap: 2 }}>
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 600, color: 'text.primary' }}>
          {pageTitles[pathname] ?? 'EduNest'}
        </Typography>

        {profile && (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
            onClick={(e) => setAnchor(e.currentTarget)}
          >
            <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>
              {`${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {profile.lastName} {profile.firstName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {roleCaption[profile.role]}
              </Typography>
            </Box>
          </Box>
        )}
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
          <MenuItem onClick={() => go('/profile')}>Профіль</MenuItem>
          <MenuItem onClick={handleLogout}>Вийти</MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  )
}
```

In `src/widgets/header/ui/Header.tsx` replace the hardcoded avatar block with the profile: avatar initials from `profile.firstName[0] + profile.lastName[0]`, name `${lastName} ${firstName}`, caption = role label (`root`/`admin` → 'Адміністратор', `teacher` → 'Педагог'); clicking opens an MUI `Menu` with «Профіль» (navigate `/profile`) and «Вийти» (`logout().catch(() => undefined)` then navigate `/login`). Remove the fake notifications badge. Add `'/profile': 'Профіль'` and `'/classes': 'Гуртки'`, `'/my-classes': 'Мої заняття'`, `'/finance': 'Фінанси'`, `'/tariffs': 'Тарифи'` to `pageTitles`.

- [ ] **Step 6: Verify and commit**

tsc diff vs baseline empty; `npx eslint src/app src/pages/profile src/pages/changePassword src/pages/family src/pages/familyChild src/shared/ui/PasswordFields.tsx src/widgets/header` 0 errors.

```bash
git add src/app src/pages/profile src/pages/changePassword src/pages/family src/pages/familyChild src/shared/ui/PasswordFields.tsx src/widgets/header
git commit -m "feat: add role routing, parent layout, profile and password change"
```

---

### Task 8: Parent pages

**Files:**
- Create: `src/shared/api/parentCabinet.ts`; modify `src/shared/api/index.ts`
- Create: `src/pages/family/model/familyStore.ts`; replace `src/pages/family/ui/FamilyPage.tsx`
- Create: `src/pages/familyChild/model/familyChildStore.ts`, `src/pages/familyChild/ui/ChildCardTab.tsx`, `VisitsTab.tsx`, `ChildFinanceTab.tsx`; replace `src/pages/familyChild/ui/FamilyChildPage.tsx`

**Interfaces:**
- Consumes: `formatMoney`, `financeCategoryLabels`, `paymentMethodLabels`, `chargeStateLabels` (check exact export names in `src/shared/api/finance.ts`), `attendanceStatusLabels`, `packageStateLabels`, `formatDay` (`src/shared/api/classes.ts`).

- [ ] **Step 1: API client `src/shared/api/parentCabinet.ts`**

```ts
import { axiosInstance } from './axiosInstance';
import type { FinanceCategory, PaymentMethod, ChargeState } from './finance';
import type { AttendanceStatus, PackageState } from './classes';

export interface FamilyChild {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  group: { id: string; name: string } | null;
  due: string;
  overdue: string;
  prepayment: string;
}

export interface Family {
  children: FamilyChild[];
  totals: { due: string; overdue: string; prepayment: string };
}

export interface ParentContact {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  phone: string | null;
  email: string | null;
}

export type Visit =
  | { type: 'lesson'; date: string; groupName: string; directionName: string; status: AttendanceStatus; isGuest: boolean }
  | { type: 'adaptation'; date: string; hours: string }
  | { type: 'legacy'; date: string; note: string | null; directionName: string };

export interface ChildCard {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  birthDate: string;
  group: { id: string; name: string } | null;
  parents: ParentContact[];
  enrollments: { id: string; tariffName: string; startDate: string; endDate: string | null; pauses: { startDate: string; endDate: string | null }[] }[];
  packages: { id: string; directionName: string; sessionsTotal: number; used: number; remaining: number; expiresAt: string | null; state: PackageState }[];
  visits: Visit[];
}

export interface CabinetCharge {
  id: string;
  category: FinanceCategory;
  description: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: string;
  paid: string;
  remaining: string;
  state: ChargeState;
  overdue: boolean;
  createdAt: string;
}

export interface CabinetPayment {
  id: string;
  receivedAt: string;
  amount: string;
  method: PaymentMethod;
  category: FinanceCategory | null;
  allocated: string;
  free: string;
  allocations: { chargeId: string; description: string; amount: string }[];
}

export interface CabinetFinance {
  summary: { category: FinanceCategory; due: string; overdue: string; prepayment: string }[];
  unallocated: string;
  charges: CabinetCharge[];
  payments: CabinetPayment[];
}

export const parentCabinetApi = {
  getFamily: () => axiosInstance.get<Family>('/me/family'),
  getChild: (id: string) => axiosInstance.get<ChildCard>(`/me/children/${id}`),
  getFinance: (id: string) => axiosInstance.get<CabinetFinance>(`/me/children/${id}/finance`),
};
```

Check that `FinanceCategory`, `PaymentMethod`, `ChargeState` are exported types in `finance.ts` (the index re-exports them) and `AttendanceStatus`, `PackageState` in `classes.ts`. Export everything from `src/shared/api/index.ts`.

- [ ] **Step 2: Stores**

`src/pages/family/model/familyStore.ts`:

```ts
import { create } from 'zustand';
import { parentCabinetApi, type Family } from '../../../shared/api';

interface FamilyState {
  family: Family | null;
  isLoading: boolean;
  fetchFamily: () => Promise<void>;
}

export const useFamilyStore = create<FamilyState>((set) => ({
  family: null,
  isLoading: false,
  fetchFamily: async () => {
    set({ isLoading: true });
    try {
      const { data } = await parentCabinetApi.getFamily();
      set({ family: data });
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

`src/pages/familyChild/model/familyChildStore.ts`:

```ts
import { create } from 'zustand';
import { parentCabinetApi, type CabinetFinance, type ChildCard } from '../../../shared/api';

interface FamilyChildState {
  childId: string | null;
  card: ChildCard | null;
  finance: CabinetFinance | null;
  isLoading: boolean;
  fetchChild: (childId: string) => Promise<void>;
}

export const useFamilyChildStore = create<FamilyChildState>((set, get) => ({
  childId: null,
  card: null,
  finance: null,
  isLoading: false,
  fetchChild: async (childId) => {
    set({ childId, card: null, finance: null, isLoading: true });
    try {
      const [{ data: card }, { data: finance }] = await Promise.all([
        parentCabinetApi.getChild(childId),
        parentCabinetApi.getFinance(childId),
      ]);
      if (get().childId === childId) set({ card, finance });
    } finally {
      if (get().childId === childId) set({ isLoading: false });
    }
  },
}));
```

- [ ] **Step 3: Family page `src/pages/family/ui/FamilyPage.tsx`**

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Card, CardActions, CardContent, Paper, Typography } from '@mui/material'
import { useFamilyStore } from '../model/familyStore'
import { formatMoney } from '../../../shared/api'

const fullName = (c: { lastName: string; firstName: string; middleName: string | null }) =>
  [c.lastName, c.firstName, c.middleName].filter(Boolean).join(' ')

export const FamilyPage = () => {
  const family = useFamilyStore((s) => s.family)
  const fetchFamily = useFamilyStore((s) => s.fetchFamily)
  const navigate = useNavigate()

  useEffect(() => {
    fetchFamily().catch(() => undefined)
  }, [fetchFamily])

  if (!family) return <Typography color="text.secondary">Завантаження…</Typography>

  const due = Number(family.totals.due)
  const overdue = Number(family.totals.overdue)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <Box>
          <Typography variant="body2" color="text.secondary">До оплати</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, color: due > 0 ? 'error.main' : 'success.main' }}>
            {formatMoney(family.totals.due)} грн
          </Typography>
          {overdue > 0 && (
            <Typography variant="body2" color="error.main">з них прострочено {formatMoney(family.totals.overdue)} грн</Typography>
          )}
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">Передоплата</Typography>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{formatMoney(family.totals.prepayment)} грн</Typography>
        </Box>
      </Paper>

      {family.children.length === 0 && (
        <Typography color="text.secondary">До вашого акаунта ще не прив'язано дітей. Зверніться до адміністратора.</Typography>
      )}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(300px, 1fr))' } }}>
        {family.children.map((child) => (
          <Card key={child.id} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <CardContent>
              <Typography sx={{ fontWeight: 700 }}>{fullName(child)}</Typography>
              <Typography variant="body2" color="text.secondary">{child.group?.name ?? 'Без групи'}</Typography>
              <Typography sx={{ mt: 1, fontWeight: 600, color: Number(child.due) > 0 ? 'error.main' : 'success.main' }}>
                До оплати: {formatMoney(child.due)} грн
              </Typography>
              {Number(child.overdue) > 0 && (
                <Typography variant="body2" color="error.main">Прострочено: {formatMoney(child.overdue)} грн</Typography>
              )}
              {Number(child.prepayment) > 0 && (
                <Typography variant="body2" color="text.secondary">Передоплата: {formatMoney(child.prepayment)} грн</Typography>
              )}
            </CardContent>
            <CardActions>
              <Button size="small" variant="contained" onClick={() => navigate(`/family/${child.id}`)}>
                Детальніше
              </Button>
            </CardActions>
          </Card>
        ))}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 4: Child page and tabs**

`src/pages/familyChild/ui/FamilyChildPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Box, IconButton, Tab, Tabs, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useFamilyChildStore } from '../model/familyChildStore'
import { ChildCardTab } from './ChildCardTab'
import { VisitsTab } from './VisitsTab'
import { ChildFinanceTab } from './ChildFinanceTab'

export const FamilyChildPage = () => {
  const { childId } = useParams<{ childId: string }>()
  const navigate = useNavigate()
  const card = useFamilyChildStore((s) => s.card)
  const finance = useFamilyChildStore((s) => s.finance)
  const storeChildId = useFamilyChildStore((s) => s.childId)
  const isLoading = useFamilyChildStore((s) => s.isLoading)
  const fetchChild = useFamilyChildStore((s) => s.fetchChild)
  const [tab, setTab] = useState(0)

  useEffect(() => {
    if (childId) fetchChild(childId).catch(() => undefined)
  }, [childId, fetchChild])

  if (!card || !finance || storeChildId !== childId) {
    return (
      <Typography color="text.secondary">
        {isLoading || storeChildId !== childId ? 'Завантаження…' : 'Дитину не знайдено.'}
      </Typography>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton onClick={() => navigate('/family')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {[card.lastName, card.firstName, card.middleName].filter(Boolean).join(' ')}
        </Typography>
      </Box>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} variant="scrollable" sx={{ mb: 2 }}>
        <Tab label="Картка" />
        <Tab label="Відвідування" />
        <Tab label="Фінанси" />
      </Tabs>
      {tab === 0 && <ChildCardTab card={card} />}
      {tab === 1 && <VisitsTab visits={card.visits} />}
      {tab === 2 && <ChildFinanceTab finance={finance} />}
    </Box>
  )
}
```

`ChildCardTab.tsx`:

```tsx
import { Box, Chip, Link, Paper, Typography } from '@mui/material'
import { formatDay, packageStateLabels, type ChildCard } from '../../../shared/api'

const section = { border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 } as const

export const ChildCardTab = ({ card }: { card: ChildCard }) => (
  <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
    <Paper elevation={0} sx={section}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>Дитина</Typography>
      <Typography>Дата народження: {formatDay(card.birthDate)}</Typography>
      <Typography>Група: {card.group?.name ?? '—'}</Typography>
    </Paper>
    <Paper elevation={0} sx={section}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>Батьки</Typography>
      {card.parents.map((p) => (
        <Box key={p.id} sx={{ mb: 1 }}>
          <Typography>{[p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ')}</Typography>
          {p.phone && <Link href={`tel:${p.phone}`} sx={{ mr: 2 }}>{p.phone}</Link>}
          {p.email && <Link href={`mailto:${p.email}`}>{p.email}</Link>}
        </Box>
      ))}
    </Paper>
    <Paper elevation={0} sx={section}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>Абонементи</Typography>
      {card.enrollments.length === 0 && <Typography color="text.secondary">Немає</Typography>}
      {card.enrollments.map((e) => (
        <Box key={e.id} sx={{ mb: 1 }}>
          <Typography>{e.tariffName}</Typography>
          <Typography variant="body2" color="text.secondary">
            з {formatDay(e.startDate)}{e.endDate ? ` по ${formatDay(e.endDate)}` : ''}
          </Typography>
          {e.pauses.map((p) => (
            <Typography key={p.startDate} variant="body2" color="text.secondary">
              Пауза: {formatDay(p.startDate)}{p.endDate ? ` – ${formatDay(p.endDate)}` : ''}
            </Typography>
          ))}
        </Box>
      ))}
    </Paper>
    <Paper elevation={0} sx={section}>
      <Typography sx={{ fontWeight: 700, mb: 1 }}>Пакети гуртків</Typography>
      {card.packages.length === 0 && <Typography color="text.secondary">Немає</Typography>}
      {card.packages.map((p) => (
        <Box key={p.id} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography>{p.directionName}: залишилось {p.remaining} з {p.sessionsTotal}</Typography>
          {p.expiresAt && <Typography variant="body2" color="text.secondary">до {formatDay(p.expiresAt)}</Typography>}
          <Chip size="small" variant="outlined" label={packageStateLabels[p.state]} />
        </Box>
      ))}
    </Paper>
  </Box>
)
```

`VisitsTab.tsx`:

```tsx
import { Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { attendanceStatusLabels, formatDay, type Visit } from '../../../shared/api'

const describe = (v: Visit) => {
  if (v.type === 'lesson') return [`${v.directionName}, ${v.groupName}`, `${attendanceStatusLabels[v.status]}${v.isGuest ? ' (разово)' : ''}`]
  if (v.type === 'adaptation') return ['Адаптація', `${v.hours} год`]
  return [`${v.directionName} (старий абонемент)`, v.note ?? 'Відвідування']
}

export const VisitsTab = ({ visits }: { visits: Visit[] }) => {
  if (visits.length === 0) return <Typography color="text.secondary">Відвідувань ще немає.</Typography>
  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Дата</TableCell>
            <TableCell>Що</TableCell>
            <TableCell>Статус</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visits.map((v, i) => {
            const [what, status] = describe(v)
            return (
              <TableRow key={`${v.type}-${v.date}-${i}`}>
                <TableCell>{formatDay(v.date)}</TableCell>
                <TableCell>{what}</TableCell>
                <TableCell>{status}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Paper>
  )
}
```

`ChildFinanceTab.tsx`:

```tsx
import { Fragment, useState } from 'react'
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  chargeStateLabels,
  financeCategoryLabels,
  formatDay,
  formatMoney,
  paymentMethodLabels,
  type CabinetFinance,
  type CabinetPayment,
} from '../../../shared/api'

const stateColor = { paid: 'success', partial: 'warning', unpaid: 'error' } as const

const period = (start: string | null, end: string | null) => {
  if (!start) return '—'
  return end && end !== start ? `${formatDay(start)} – ${formatDay(end)}` : formatDay(start)
}

const PaymentRow = ({ payment }: { payment: CabinetPayment }) => {
  const [open, setOpen] = useState(false)
  return (
    <Fragment>
      <TableRow>
        <TableCell sx={{ width: 40 }}>
          <IconButton size="small" aria-label="Розподіл оплати" onClick={() => setOpen(!open)}>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>{formatDay(payment.receivedAt)}</TableCell>
        <TableCell align="right">{formatMoney(payment.amount)}</TableCell>
        <TableCell>{paymentMethodLabels[payment.method]}</TableCell>
        <TableCell>{payment.category ? financeCategoryLabels[payment.category] : 'Будь-що'}</TableCell>
        <TableCell align="right">{formatMoney(payment.free)}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 1 }}>
              {payment.allocations.length === 0 && <Typography variant="body2" color="text.secondary">Ще не розподілено</Typography>}
              {payment.allocations.map((a) => (
                <Typography key={a.chargeId} variant="body2">{a.description}: {formatMoney(a.amount)} грн</Typography>
              ))}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  )
}

export const ChildFinanceTab = ({ finance }: { finance: CabinetFinance }) => {
  const active = finance.summary.filter((s) => Number(s.due) > 0 || Number(s.prepayment) > 0)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(220px, 1fr))' } }}>
        {active.map((s) => (
          <Paper key={s.category} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>{financeCategoryLabels[s.category]}</Typography>
            <Typography color={Number(s.due) > 0 ? 'error.main' : 'text.primary'}>До оплати: {formatMoney(s.due)} грн</Typography>
            {Number(s.overdue) > 0 && <Typography variant="body2" color="error.main">Прострочено: {formatMoney(s.overdue)} грн</Typography>}
            {Number(s.prepayment) > 0 && <Typography variant="body2" color="text.secondary">Передоплата: {formatMoney(s.prepayment)} грн</Typography>}
          </Paper>
        ))}
        {Number(finance.unallocated) > 0 && (
          <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>Аванс без призначення</Typography>
            <Typography>{formatMoney(finance.unallocated)} грн</Typography>
          </Paper>
        )}
      </Box>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Typography sx={{ fontWeight: 700, p: 2 }}>Нарахування</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>За що</TableCell>
              <TableCell>Період</TableCell>
              <TableCell align="right">Сума</TableCell>
              <TableCell align="right">Сплачено</TableCell>
              <TableCell align="right">Залишок</TableCell>
              <TableCell>Статус</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {finance.charges.length === 0 ? (
              <TableRow><TableCell colSpan={6} sx={{ color: 'text.secondary' }}>Нарахувань немає.</TableCell></TableRow>
            ) : (
              finance.charges.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.description}</TableCell>
                  <TableCell>{period(c.periodStart, c.periodEnd)}</TableCell>
                  <TableCell align="right">{formatMoney(c.amount)}</TableCell>
                  <TableCell align="right">{formatMoney(c.paid)}</TableCell>
                  <TableCell align="right">{formatMoney(c.remaining)}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      <Chip size="small" color={stateColor[c.state]} variant="outlined" label={chargeStateLabels[c.state]} />
                      {c.overdue && <Chip size="small" color="error" label="Прострочено" />}
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}>
        <Typography sx={{ fontWeight: 700, p: 2 }}>Оплати</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Дата</TableCell>
              <TableCell align="right">Сума</TableCell>
              <TableCell>Спосіб</TableCell>
              <TableCell>Призначення</TableCell>
              <TableCell align="right">Не розподілено</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {finance.payments.length === 0 ? (
              <TableRow><TableCell colSpan={6} sx={{ color: 'text.secondary' }}>Оплат немає.</TableCell></TableRow>
            ) : (
              finance.payments.map((p) => <PaymentRow key={p.id} payment={p} />)
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
```

Verify exact label export names in `src/shared/api/finance.ts` (`financeCategoryLabels`, `paymentMethodLabels`, `chargeStateLabels` exist per the index) and that `chargeStateLabels` keys are `unpaid | partial | paid`. `Number(...)` here is used only for display comparisons, never for sums.

- [ ] **Step 5: Verify and commit**

tsc diff empty; `npx eslint src/shared/api src/pages/family src/pages/familyChild` 0 errors.

```bash
git add src/shared/api src/pages/family src/pages/familyChild
git commit -m "feat: add parent family and child pages"
```

---

### Task 9: Admin fields, translations, docs

**Files:**
- Modify: `src/shared/api/users.ts`, `src/pages/users/ui/CreateUserModal.tsx`, `EditUserModal.tsx`, `UsersPage.tsx`
- Modify: `src/shared/api/children.ts`, `src/pages/children/ui/CreateChildModal.tsx`, `EditChildModal.tsx`, `ChildrenPage.tsx`
- Modify: `src/shared/api/finance.ts` (ChildFinance `parents`), `src/pages/finance/ui/ChildFinancePage.tsx`
- Modify: `D:\IT\EduNest\CLAUDE.md`

- [ ] **Step 1: Users**

`CreateUserDto` adds `middleName?: string; phone?: string; email?: string;`. `UpdateUserDto` adds `middleName?: string | null; phone?: string | null; email?: string | null;`.

`CreateUserModal`: schema adds

```ts
    middleName: yup.string().default('').max(100, 'Максимум 100 символів'),
    phone: yup.string().default('').when('role', {
        is: 'parent',
        then: (s) => s.required('Для батьків потрібен телефон'),
    }).test('phone', 'Формат +380XXXXXXXXX', (value) => !value || isValidPhone(normalizePhone(value))),
    email: yup.string().default('').email('Невірний email').max(200, 'Максимум 200 символів'),
```

defaults `middleName: '', phone: '', email: ''`; add an `RHFTextField name="middleName" label="По батькові"` after the name row, and `phone` («Телефон», placeholder `+380671234567`) and `email` («Email») fields after the role select. `onSubmit` sends:

```ts
        await createUser({
            firstName: values.firstName,
            lastName: values.lastName,
            role: values.role,
            login: values.login,
            password: values.password,
            middleName: values.middleName.trim() || undefined,
            phone: values.phone ? normalizePhone(values.phone) : undefined,
            email: values.email.trim() || undefined,
        })
```

`EditUserModal`: same three fields and schema; `reset` fills them from `user` (`?? ''`); the dto sends `middleName: values.middleName.trim() || null`, `phone: values.phone ? normalizePhone(values.phone) : null` only if the user is a parent or a phone was entered (for non-parents send `null` when empty), `email: values.email.trim() || null`; keep the existing password handling. Under the password field add helper text: «Після зміни пароля користувач має задати свій при вході».

`UsersPage`: add a «Телефон» column (`user.phone ?? '—'`) and, for `role === 'parent'` without phone, a `Chip size="small" color="warning" label="немає телефону"`. Show `middleName` in the name cell.

- [ ] **Step 2: Children**

`Child` type and both DTOs add `middleName` (`string | null` in `Child`, `string` / `string | null` in DTOs). Child modals: add a «По батькові» text field after «Ім'я» (optional, max 100); create sends `middleName: values.middleName.trim() || undefined`, edit sends `|| null`. `ChildrenPage` name cell shows `lastName firstName middleName`.

- [ ] **Step 3: Finance header parents**

`ChildFinance` type in `src/shared/api/finance.ts` adds `parents: { id: string; firstName: string; lastName: string; middleName: string | null; phone: string | null; email: string | null }[]`. In `ChildFinancePage.tsx` under the child name render a `Typography variant="body2" color="text.secondary"` listing `Батьки: Koval Olena (+380671234567), …` (phone in parentheses when present; «не вказано» when there are no parents).

- [ ] **Step 4: Frontend CLAUDE.md**

Add to Structure: `pages/family`, `pages/familyChild` (parent cabinet), `pages/profile`, `pages/changePassword`; routing note: role gates (`RoleGate`, `PasswordGate`), `RoleLayout` for shared routes; session refresh is implemented in `shared/api/axiosInstance.ts` (remove the Roadmap item for the refresh interceptor and renumber; update any "Roadmap step N" references accordingly).

- [ ] **Step 5: Verify and commit**

tsc diff empty; `npx eslint src/shared/api src/pages/users src/pages/children src/pages/finance/ui/ChildFinancePage.tsx` 0 errors from touched code (pre-existing `any` usages in user modals may be flagged — if eslint reports errors on lines you did not change, list them in the report and do not fix unrelated code).

```bash
git add src/shared/api src/pages/users src/pages/children src/pages/finance/ui/ChildFinancePage.tsx CLAUDE.md
git commit -m "feat: add contact fields to admin forms and parents to finance card"
```
