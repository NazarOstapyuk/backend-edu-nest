# Auth + Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete auth + user-management backend for an educational platform with role-based access control, JWT tokens in HTTP-only cookies, and automatic root-user seeding.

**Architecture:** PrismaModule (global) provides DB access to all modules. SeedService runs at startup to ensure root user exists. AuthModule handles login/refresh/logout via HTTP-only cookies. UsersModule handles user CRUD restricted by role.

**Tech Stack:** NestJS 11, Prisma + PostgreSQL (Docker), `@nestjs/jwt`, `passport-jwt`, `bcryptjs`, `cookie-parser`, `class-validator`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `docker-compose.yml` | Create | PostgreSQL container |
| `.env` | Create | All env vars |
| `prisma/schema.prisma` | Create (via init) | DB schema |
| `src/prisma/prisma.service.ts` | Create | PrismaClient wrapper |
| `src/prisma/prisma.module.ts` | Create | Global Prisma provider |
| `src/common/decorators/roles.decorator.ts` | Create | `@Roles()` metadata decorator |
| `src/seed/seed.service.ts` | Create | Root user seeding on boot |
| `src/seed/seed.module.ts` | Create | Seed module |
| `src/auth/strategies/jwt.strategy.ts` | Create | Extract + validate JWT from cookie |
| `src/auth/guards/jwt-auth.guard.ts` | Create | Protect routes with access token |
| `src/auth/guards/roles.guard.ts` | Create | Enforce `@Roles()` on routes |
| `src/auth/dto/login.dto.ts` | Create | Login request body |
| `src/auth/auth.service.ts` | Create | login / refresh / logout logic |
| `src/auth/auth.controller.ts` | Create | `/auth/*` endpoints |
| `src/auth/auth.module.ts` | Create | Auth module wiring |
| `src/users/dto/create-user.dto.ts` | Create | Create user request body |
| `src/users/dto/update-user.dto.ts` | Create | Update user request body |
| `src/users/users.service.ts` | Create | User CRUD with role checks |
| `src/users/users.controller.ts` | Create | `/users` endpoints |
| `src/users/users.module.ts` | Create | Users module wiring |
| `src/app.module.ts` | Modify | Add all modules |
| `src/main.ts` | Modify | Add cookie-parser + ValidationPipe |
| `src/auth/auth.service.spec.ts` | Create | AuthService unit tests |
| `src/users/users.service.spec.ts` | Create | UsersService unit tests |

---

## Task 1: Docker + .env

**Files:**
- Create: `docker-compose.yml`
- Create: `.env`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:16
    container_name: edu_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: edu_db
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 2: Create .env**

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/edu_db"

JWT_SECRET=super_secret_key_change_me
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=30d

ROOT_LOGIN=root
ROOT_PASSWORD=Root123!
```

- [ ] **Step 3: Start Postgres container**

```bash
docker compose up -d
```

Expected output:
```
✔ Container edu_postgres  Started
```

- [ ] **Step 4: Verify Postgres is running**

```bash
docker ps --filter name=edu_postgres --format "table {{.Names}}\t{{.Status}}"
```

Expected output:
```
NAMES          STATUS
edu_postgres   Up X seconds
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add docker-compose for postgres"
```

---

## Task 2: Install Dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime packages**

```bash
npm install @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt bcryptjs cookie-parser class-validator class-transformer prisma @prisma/client
```

- [ ] **Step 2: Install type definitions**

```bash
npm install -D @types/passport-jwt @types/bcryptjs @types/cookie-parser
```

- [ ] **Step 3: Verify install**

```bash
npx tsc --version
```

Expected output: `Version 5.x.x` (no errors)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install prisma, jwt, passport, bcryptjs, cookie-parser dependencies"
```

---

## Task 3: Prisma Schema + Migration

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/` (auto-generated)

- [ ] **Step 1: Initialize Prisma**

```bash
npx prisma init
```

Expected: creates `prisma/schema.prisma` and appends `DATABASE_URL` hint to `.env` (already set — ignore the .env change).

- [ ] **Step 2: Replace prisma/schema.prisma content**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  login        String   @unique
  password     String
  role         Role
  refreshToken String?
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

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name init
```

Expected output:
```
✔ Generated Prisma Client
Your database is now in sync with your schema.
```

- [ ] **Step 4: Verify the table exists**

```bash
npx prisma studio
```

Open browser at `http://localhost:5555` — you should see the `User` model. Close studio when done (`Ctrl+C`).

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat: add prisma schema with User model and init migration"
```

---

## Task 4: PrismaModule + PrismaService

**Files:**
- Create: `src/prisma/prisma.service.ts`
- Create: `src/prisma/prisma.module.ts`

- [ ] **Step 1: Create prisma.service.ts**

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 2: Create prisma.module.ts**

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/prisma/
git commit -m "feat: add global PrismaModule and PrismaService"
```

---

## Task 5: Roles Decorator

**Files:**
- Create: `src/common/decorators/roles.decorator.ts`

- [ ] **Step 1: Create roles.decorator.ts**

```typescript
// src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 2: Commit**

```bash
git add src/common/
git commit -m "feat: add Roles decorator"
```

---

## Task 6: Seed Module

**Files:**
- Create: `src/seed/seed.service.ts`
- Create: `src/seed/seed.module.ts`

- [ ] **Step 1: Create seed.service.ts**

```typescript
// src/seed/seed.service.ts
import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const login = this.config.get<string>('ROOT_LOGIN');
    const existing = await this.prisma.user.findUnique({ where: { login } });
    if (existing) return;

    const rawPassword = this.config.get<string>('ROOT_PASSWORD');
    const password = await bcrypt.hash(rawPassword, 10);
    await this.prisma.user.create({
      data: { login, password, role: 'root' },
    });
    this.logger.log(`Root user "${login}" created`);
  }
}
```

- [ ] **Step 2: Create seed.module.ts**

```typescript
// src/seed/seed.module.ts
import { Module } from '@nestjs/common';
import { SeedService } from './seed.service';

@Module({
  providers: [SeedService],
})
export class SeedModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/seed/
git commit -m "feat: add SeedModule — creates root user on app start"
```

---

## Task 7: JWT Strategy + Guards

**Files:**
- Create: `src/auth/strategies/jwt.strategy.ts`
- Create: `src/auth/guards/jwt-auth.guard.ts`
- Create: `src/auth/guards/roles.guard.ts`

- [ ] **Step 1: Create jwt.strategy.ts**

```typescript
// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.accessToken ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; role: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException();
    return { id: user.id, role: user.role, login: user.login };
  }
}
```

- [ ] **Step 2: Create jwt-auth.guard.ts**

```typescript
// src/auth/guards/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 3: Create roles.guard.ts**

```typescript
// src/auth/guards/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const { user } = context.switchToHttp().getRequest();
    return required.includes(user?.role);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/auth/
git commit -m "feat: add JWT strategy and auth guards"
```

---

## Task 8: AuthService Unit Tests + Implementation

**Files:**
- Create: `src/auth/auth.service.spec.ts`
- Create: `src/auth/auth.service.ts`
- Create: `src/auth/dto/login.dto.ts`

- [ ] **Step 1: Create login.dto.ts**

```typescript
// src/auth/dto/login.dto.ts
import { IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  login: string;

  @IsString()
  password: string;
}
```

- [ ] **Step 2: Write failing tests**

```typescript
// src/auth/auth.service.spec.ts
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = {
  signAsync: jest.fn().mockResolvedValue('signed-token'),
  verify: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      JWT_SECRET: 'secret',
      JWT_ACCESS_EXPIRES: '15m',
      JWT_REFRESH_EXPIRES: '30d',
    };
    return map[key];
  }),
};

const mockRes = {
  cookie: jest.fn(),
  clearCookie: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('login', () => {
    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('x', 'y', mockRes as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: 'hash',
        isActive: false,
        role: 'admin',
      });
      await expect(service.login('x', 'pass', mockRes as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when password does not match', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      await expect(service.login('x', 'wrong', mockRes as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('sets two cookies on successful login', async () => {
      const hashed = await bcrypt.hash('pass', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid',
        password: hashed,
        isActive: true,
        role: 'admin',
      });
      mockPrisma.user.update.mockResolvedValue({});
      await service.login('x', 'pass', mockRes as any);
      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
      expect(mockRes.cookie).toHaveBeenCalledWith('accessToken', expect.any(String), expect.any(Object));
      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', expect.any(String), expect.any(Object));
    });
  });

  describe('logout', () => {
    it('clears refreshToken in DB and clears both cookies', async () => {
      mockPrisma.user.update.mockResolvedValue({});
      await service.logout('uid', mockRes as any);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'uid' },
        data: { refreshToken: null },
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith('accessToken');
      expect(mockRes.clearCookie).toHaveBeenCalledWith('refreshToken');
    });
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest auth.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './auth.service'`

- [ ] **Step 4: Implement auth.service.ts**

```typescript
// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(login: string, password: string, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account is disabled');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
    return { message: 'Login successful' };
  }

  async refresh(req: Request, res: Response) {
    const token: string | undefined = (req.cookies as Record<string, string>)?.refreshToken;
    if (!token) throw new UnauthorizedException('Invalid refresh token');

    let payload: { sub: string; role: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.refreshToken)
      throw new UnauthorizedException('Invalid refresh token');

    const match = await bcrypt.compare(token, user.refreshToken);
    if (!match) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.generateTokens(user.id, user.role);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    this.setCookies(res, tokens);
    return { message: 'Token refreshed' };
  }

  async logout(userId: string, res: Response) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return { message: 'Logged out' };
  }

  private async generateTokens(userId: string, role: string) {
    const payload = { sub: userId, role };
    const secret = this.config.get<string>('JWT_SECRET');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret,
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES'),
      }),
      this.jwtService.signAsync(payload, {
        secret,
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, token: string) {
    const hashed = await bcrypt.hash(token, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed },
    });
  }

  private setCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, // 15 minutes
    });
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest auth.service.spec.ts --no-coverage
```

Expected: PASS — 4 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/auth/auth.service.ts src/auth/auth.service.spec.ts src/auth/dto/login.dto.ts
git commit -m "feat: implement AuthService with login, refresh, logout"
```

---

## Task 9: AuthController + AuthModule

**Files:**
- Create: `src/auth/auth.controller.ts`
- Create: `src/auth/auth.module.ts`

- [ ] **Step 1: Create auth.controller.ts**

```typescript
// src/auth/auth.controller.ts
import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto.login, dto.password, res);
  }

  @Post('refresh')
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.refresh(req, res);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.logout(req.user.id, res);
  }
}
```

- [ ] **Step 2: Create auth.module.ts**

```typescript
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRES') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/auth/auth.controller.ts src/auth/auth.module.ts
git commit -m "feat: add AuthController and AuthModule"
```

---

## Task 10: UsersService Unit Tests + Implementation

**Files:**
- Create: `src/users/dto/create-user.dto.ts`
- Create: `src/users/dto/update-user.dto.ts`
- Create: `src/users/users.service.spec.ts`
- Create: `src/users/users.service.ts`

- [ ] **Step 1: Create create-user.dto.ts**

```typescript
// src/users/dto/create-user.dto.ts
import { IsEnum, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  login: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(Role)
  role: Role;
}
```

- [ ] **Step 2: Create update-user.dto.ts**

```typescript
// src/users/dto/update-user.dto.ts
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

- [ ] **Step 3: Write failing tests**

```typescript
// src/users/users.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('create', () => {
    it('throws ForbiddenException when admin tries to create root', async () => {
      await expect(
        service.create({ login: 'x', password: 'pass123', role: Role.root }, Role.admin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when login already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ login: 'taken', password: 'pass123', role: Role.teacher }, Role.admin),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user and returns without password and refreshToken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        login: 'newuser',
        role: Role.teacher,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: 'hashed',
        refreshToken: null,
      });
      const result = await service.create(
        { login: 'newuser', password: 'pass123', role: Role.teacher },
        Role.admin,
      );
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).toHaveProperty('id', 'new-id');
    });

    it('allows root to create any role including root', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'id2',
        login: 'root2',
        role: Role.root,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: 'hashed',
        refreshToken: null,
      });
      await expect(
        service.create({ login: 'root2', password: 'pass123', role: Role.root }, Role.root),
      ).resolves.not.toThrow();
    });
  });
});
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
npx jest users.service.spec.ts --no-coverage
```

Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 5: Implement users.service.ts**

```typescript
// src/users/users.service.ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto, creatorRole: Role) {
    if (creatorRole === Role.admin && dto.role === Role.root) {
      throw new ForbiddenException('Forbidden');
    }

    const existing = await this.prisma.user.findUnique({ where: { login: dto.login } });
    if (existing) throw new ConflictException('Login already taken');

    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { login: dto.login, password, role: dto.role },
    });

    const { password: _p, refreshToken: _r, ...result } = user;
    return result;
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        login: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(id: string, dto: UpdateUserDto, updaterRole: Role) {
    if (updaterRole === Role.admin && dto.role === Role.root) {
      throw new ForbiddenException('Forbidden');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const data: { password?: string; role?: Role; isActive?: boolean } = {};
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.user.update({ where: { id }, data });
    const { password: _p, refreshToken: _r, ...result } = updated;
    return result;
  }
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx jest users.service.spec.ts --no-coverage
```

Expected: PASS — 4 tests passing

- [ ] **Step 7: Commit**

```bash
git add src/users/
git commit -m "feat: implement UsersService with role-based create/update"
```

---

## Task 11: UsersController + UsersModule

**Files:**
- Create: `src/users/users.controller.ts`
- Create: `src/users/users.module.ts`

- [ ] **Step 1: Create users.controller.ts**

```typescript
// src/users/users.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.create(dto, req.user.role);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: any) {
    return this.usersService.update(id, dto, req.user.role);
  }
}
```

- [ ] **Step 2: Create users.module.ts**

```typescript
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/users/users.controller.ts src/users/users.module.ts
git commit -m "feat: add UsersController and UsersModule"
```

---

## Task 12: Wire AppModule + main.ts

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Update app.module.ts**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { SeedModule } from './seed/seed.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SeedModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 2: Update main.ts**

```typescript
// src/main.ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 3: Commit**

```bash
git add src/app.module.ts src/main.ts
git commit -m "feat: wire all modules into AppModule, add cookie-parser and ValidationPipe"
```

---

## Task 13: Smoke Test — Start App and Verify

- [ ] **Step 1: Start the app**

```bash
npm run start:dev
```

Expected in console:
```
[SeedService] Root user "root" created
[NestApplication] Nest application successfully started
```

(On subsequent starts: no "Root user created" log — it already exists.)

- [ ] **Step 2: Test login with curl**

```bash
curl -s -c cookies.txt -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"root","password":"Root123!"}' \
  -i | head -20
```

Expected:
```
HTTP/1.1 201 Created
Set-Cookie: accessToken=...
Set-Cookie: refreshToken=...

{"message":"Login successful"}
```

- [ ] **Step 3: Test create user (using saved cookies)**

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"login":"teacher1","password":"Teacher1!","role":"teacher"}'
```

Expected:
```json
{"id":"...","login":"teacher1","role":"teacher","isActive":true,"createdAt":"...","updatedAt":"..."}
```

- [ ] **Step 4: Test logout**

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/auth/logout
```

Expected:
```json
{"message":"Logged out"}
```

- [ ] **Step 5: Verify protected route is blocked after logout**

```bash
curl -s -b cookies.txt -X GET http://localhost:3000/users
```

Expected: `401 Unauthorized`

- [ ] **Step 6: Delete test cookie file**

```bash
rm cookies.txt
```

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: initial full working implementation of auth + users"
```

---

## Self-Review Checklist

- [x] Docker + .env — Task 1
- [x] All dependencies installed — Task 2
- [x] Prisma schema with User + Role enum — Task 3
- [x] PrismaModule (global) — Task 4
- [x] `@Roles()` decorator — Task 5
- [x] Root user seeded on boot — Task 6
- [x] JWT cookie extraction strategy — Task 7
- [x] JwtAuthGuard + RolesGuard — Task 7
- [x] AuthService: login / refresh / logout — Task 8
- [x] Auth error cases: 401 wrong creds, 401 inactive, 401 bad refresh — Task 8
- [x] AuthController: login / refresh / logout — Task 9
- [x] AuthModule wired with PassportModule + JwtModule — Task 9
- [x] UsersService: create (role check + conflict) / findAll / update — Task 10
- [x] 403 when admin creates root — Task 10
- [x] Password + refreshToken stripped from responses — Task 10
- [x] UsersController + UsersModule — Task 11
- [x] AppModule + main.ts (cookie-parser + ValidationPipe) — Task 12
- [x] Smoke test — Task 13
