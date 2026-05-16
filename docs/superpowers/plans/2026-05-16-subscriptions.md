# Subscriptions Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SubscriptionTypes and Subscriptions modules (with Attendance tracking) to the NestJS school management system.

**Architecture:** Two NestJS modules — `SubscriptionTypesModule` handles activity-type CRUD; `SubscriptionsModule` owns subscription lifecycle and Attendance. Attendance is a separate entity inside `SubscriptionsModule`; every attendance write/delete runs in a Prisma `$transaction` to keep `remainingSessions` consistent. A `ChildSubscriptionsController` (also inside `SubscriptionsModule`) handles `GET /children/:childId/subscriptions` with parent-ownership enforcement.

**Tech Stack:** NestJS 11, Prisma ORM 7, PostgreSQL, TypeScript, Jest + `@nestjs/testing`, `class-validator`, `@nestjs/mapped-types`

---

## File Map

### New files
```
prisma/schema.prisma                                         (modify)
src/app.module.ts                                            (modify)

src/subscription-types/dto/create-subscription-type.dto.ts  (create)
src/subscription-types/dto/update-subscription-type.dto.ts  (create)
src/subscription-types/subscription-types.service.ts        (create)
src/subscription-types/subscription-types.service.spec.ts   (create)
src/subscription-types/subscription-types.controller.ts     (create)
src/subscription-types/subscription-types.module.ts         (create)

src/subscriptions/dto/create-subscription.dto.ts            (create)
src/subscriptions/dto/create-attendance.dto.ts              (create)
src/subscriptions/subscriptions.service.ts                  (create)
src/subscriptions/subscriptions.service.spec.ts             (create)
src/subscriptions/subscriptions.controller.ts               (create)
src/subscriptions/child-subscriptions.controller.ts         (create)
src/subscriptions/attendances.service.ts                    (create)
src/subscriptions/attendances.service.spec.ts               (create)
src/subscriptions/attendances.controller.ts                 (create)
src/subscriptions/subscriptions.module.ts                   (create)
```

---

## Task 1: Prisma schema — add new models and run migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enum, new models, and Child relation to schema**

Replace the contents of `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

enum Role {
  root
  admin
  teacher
  parent
}

enum Gender {
  male
  female
}

enum SubscriptionStatus {
  active
  finished
  cancelled
}

model User {
  id           String   @id @default(uuid())
  login        String   @unique
  password     String
  role         Role
  firstName    String
  lastName     String
  refreshToken String?
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  groups       Group[]  @relation("GroupTeachers")
  children     Child[]  @relation("ChildParents")
}

model Group {
  id        String   @id @default(uuid())
  name      String   @unique
  teachers  User[]   @relation("GroupTeachers")
  children  Child[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Child {
  id            String         @id @default(uuid())
  firstName     String
  lastName      String
  birthDate     DateTime
  gender        Gender

  groupId       String?
  group         Group?         @relation(fields: [groupId], references: [id])

  parents       User[]         @relation("ChildParents")
  subscriptions Subscription[]

  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
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

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_subscriptions
```

Expected: migration created and applied, Prisma client regenerated.

If the command fails with a connection error, ensure `DATABASE_URL` is set in your `.env` file.

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add SubscriptionType, Subscription, Attendance models to schema"
```

---

## Task 2: SubscriptionTypesService (TDD)

**Files:**
- Create: `src/subscription-types/dto/create-subscription-type.dto.ts`
- Create: `src/subscription-types/dto/update-subscription-type.dto.ts`
- Create: `src/subscription-types/subscription-types.service.spec.ts`
- Create: `src/subscription-types/subscription-types.service.ts`

- [ ] **Step 1: Create DTOs**

`src/subscription-types/dto/create-subscription-type.dto.ts`:
```typescript
import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateSubscriptionTypeDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  pricePerSession: number;
}
```

`src/subscription-types/dto/update-subscription-type.dto.ts`:
```typescript
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateSubscriptionTypeDto } from './create-subscription-type.dto';

export class UpdateSubscriptionTypeDto extends PartialType(CreateSubscriptionTypeDto) {
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

`src/subscription-types/subscription-types.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionTypesService } from './subscription-types.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  subscriptionType: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
  },
};

describe('SubscriptionTypesService', () => {
  let service: SubscriptionTypesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SubscriptionTypesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SubscriptionTypesService);
  });

  describe('create', () => {
    it('creates a subscription type', async () => {
      const dto = { name: 'Football', pricePerSession: 100 };
      const created = { id: 'type-1', name: 'Football', pricePerSession: 100, isActive: true, createdAt: new Date(), updatedAt: new Date() };
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);
      mockPrisma.subscriptionType.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrisma.subscriptionType.create).toHaveBeenCalledWith({
        data: { name: 'Football', pricePerSession: 100 },
      });
    });

    it('throws BadRequestException when name already exists', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create({ name: 'Football', pricePerSession: 100 }))
        .rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscriptionType.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the subscription type when found', async () => {
      const type = { id: 'type-1', name: 'Football' };
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(type);

      const result = await service.findOne('type-1');
      expect(result).toEqual(type);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates the subscription type', async () => {
      const existing = { id: 'type-1', name: 'Football', pricePerSession: 100 };
      const updated = { ...existing, pricePerSession: 120 };
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(existing);
      mockPrisma.subscriptionType.update.mockResolvedValue(updated);

      const result = await service.update('type-1', { pricePerSession: 120 });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException when type does not exist', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { pricePerSession: 120 }))
        .rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscriptionType.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes type when no subscriptions exist', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Football' });
      mockPrisma.subscription.count.mockResolvedValue(0);
      mockPrisma.subscriptionType.delete.mockResolvedValue({});

      const result = await service.delete('type-1');
      expect(result).toEqual({ message: 'Subscription type deleted' });
    });

    it('throws BadRequestException when subscriptions exist for this type', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue({ id: 'type-1', name: 'Football' });
      mockPrisma.subscription.count.mockResolvedValue(2);

      await expect(service.delete('type-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscriptionType.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when type does not exist', async () => {
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest --testPathPattern=subscription-types.service --no-coverage
```

Expected: FAIL — `Cannot find module './subscription-types.service'`

- [ ] **Step 4: Implement the service**

`src/subscription-types/subscription-types.service.ts`:
```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { UpdateSubscriptionTypeDto } from './dto/update-subscription-type.dto';

@Injectable()
export class SubscriptionTypesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSubscriptionTypeDto) {
    const existing = await this.prisma.subscriptionType.findUnique({ where: { name: dto.name } });
    if (existing) throw new BadRequestException('Subscription type with this name already exists');
    return this.prisma.subscriptionType.create({ data: { name: dto.name, pricePerSession: dto.pricePerSession } });
  }

  async findAll() {
    return this.prisma.subscriptionType.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const type = await this.prisma.subscriptionType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('Subscription type not found');
    return type;
  }

  async update(id: string, dto: UpdateSubscriptionTypeDto) {
    await this.findOne(id);
    return this.prisma.subscriptionType.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    await this.findOne(id);
    const count = await this.prisma.subscription.count({ where: { subscriptionTypeId: id } });
    if (count > 0) throw new BadRequestException('Cannot delete: subscriptions exist for this type');
    await this.prisma.subscriptionType.delete({ where: { id } });
    return { message: 'Subscription type deleted' };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest --testPathPattern=subscription-types.service --no-coverage
```

Expected: PASS — 8 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/subscription-types/
git commit -m "feat: add SubscriptionTypesService with tests"
```

---

## Task 3: SubscriptionTypesController + Module

**Files:**
- Create: `src/subscription-types/subscription-types.controller.ts`
- Create: `src/subscription-types/subscription-types.module.ts`

- [ ] **Step 1: Create the controller**

`src/subscription-types/subscription-types.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionTypesService } from './subscription-types.service';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { UpdateSubscriptionTypeDto } from './dto/update-subscription-type.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscription-types')
export class SubscriptionTypesController {
  constructor(private service: SubscriptionTypesService) {}

  @Roles(Role.root, Role.admin)
  @Post()
  create(@Body() dto: CreateSubscriptionTypeDto) {
    return this.service.create(dto);
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(Role.root, Role.admin)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionTypeDto) {
    return this.service.update(id, dto);
  }

  @Roles(Role.root, Role.admin)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
```

- [ ] **Step 2: Create the module**

`src/subscription-types/subscription-types.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionTypesController } from './subscription-types.controller';
import { SubscriptionTypesService } from './subscription-types.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionTypesController],
  providers: [SubscriptionTypesService],
  exports: [SubscriptionTypesService],
})
export class SubscriptionTypesModule {}
```

- [ ] **Step 3: Register in AppModule**

Open `src/app.module.ts` and add `SubscriptionTypesModule` to the `imports` array:

```typescript
import { SubscriptionTypesModule } from './subscription-types/subscription-types.module';

// inside @Module({ imports: [..., SubscriptionTypesModule] })
```

- [ ] **Step 4: Verify build compiles**

```bash
npx nest build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/subscription-types/subscription-types.controller.ts src/subscription-types/subscription-types.module.ts src/app.module.ts
git commit -m "feat: add SubscriptionTypesController and module"
```

---

## Task 4: SubscriptionsService (TDD)

**Files:**
- Create: `src/subscriptions/dto/create-subscription.dto.ts`
- Create: `src/subscriptions/subscriptions.service.spec.ts`
- Create: `src/subscriptions/subscriptions.service.ts`

- [ ] **Step 1: Create DTO**

`src/subscriptions/dto/create-subscription.dto.ts`:
```typescript
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  childId: string;

  @IsUUID()
  subscriptionTypeId: string;

  @IsInt()
  @IsPositive()
  totalSessions: number;
}
```

- [ ] **Step 2: Write the failing tests**

`src/subscriptions/subscriptions.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SubscriptionStatus } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  child: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  subscriptionType: {
    findUnique: jest.fn(),
  },
  subscription: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SubscriptionsService);
  });

  describe('create', () => {
    const dto = { childId: 'child-1', subscriptionTypeId: 'type-1', totalSessions: 10 };
    const child = { id: 'child-1', firstName: 'Ivan' };
    const type = { id: 'type-1', name: 'Football', pricePerSession: 100 };

    it('creates subscription and fixes price from type at creation time', async () => {
      const created = {
        id: 'sub-1',
        childId: 'child-1',
        subscriptionTypeId: 'type-1',
        totalSessions: 10,
        remainingSessions: 10,
        pricePerSession: 100,
        totalPrice: 1000,
        status: SubscriptionStatus.active,
        child,
        subscriptionType: type,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.child.findUnique.mockResolvedValue(child);
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(type);
      mockPrisma.subscription.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrisma.subscription.create).toHaveBeenCalledWith({
        data: {
          childId: 'child-1',
          subscriptionTypeId: 'type-1',
          totalSessions: 10,
          remainingSessions: 10,
          pricePerSession: 100,
          totalPrice: 1000,
        },
        include: { child: true, subscriptionType: true },
      });
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription type does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(child);
      mockPrisma.subscriptionType.findUnique.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  describe('findByChild', () => {
    const subs = [{ id: 'sub-1', childId: 'child-1', subscriptionType: {} }];

    it('returns subscriptions for admin without ownership check', async () => {
      const admin = { id: 'user-1', role: Role.admin, login: 'admin' };
      mockPrisma.subscription.findMany.mockResolvedValue(subs);

      const result = await service.findByChild('child-1', admin);

      expect(result).toEqual(subs);
      expect(mockPrisma.child.findFirst).not.toHaveBeenCalled();
    });

    it('returns subscriptions for parent when child belongs to them', async () => {
      const parent = { id: 'parent-1', role: Role.parent, login: 'parent' };
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'child-1' });
      mockPrisma.subscription.findMany.mockResolvedValue(subs);

      const result = await service.findByChild('child-1', parent);

      expect(result).toEqual(subs);
      expect(mockPrisma.child.findFirst).toHaveBeenCalledWith({
        where: { id: 'child-1', parents: { some: { id: 'parent-1' } } },
      });
    });

    it('throws ForbiddenException when parent does not own child', async () => {
      const parent = { id: 'parent-1', role: Role.parent, login: 'parent' };
      mockPrisma.child.findFirst.mockResolvedValue(null);

      await expect(service.findByChild('child-1', parent)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.subscription.findMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels an active subscription', async () => {
      const sub = { id: 'sub-1', status: SubscriptionStatus.active };
      const cancelled = { ...sub, status: SubscriptionStatus.cancelled };
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.subscription.update.mockResolvedValue(cancelled);

      const result = await service.cancel('sub-1');

      expect(result.status).toBe(SubscriptionStatus.cancelled);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: SubscriptionStatus.cancelled },
      });
    });

    it('throws BadRequestException when subscription is not active', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', status: SubscriptionStatus.finished });

      await expect(service.cancel('sub-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.cancel('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest --testPathPattern=subscriptions.service --no-coverage
```

Expected: FAIL — `Cannot find module './subscriptions.service'`

- [ ] **Step 4: Implement the service**

`src/subscriptions/subscriptions.service.ts`:
```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSubscriptionDto) {
    const child = await this.prisma.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw new NotFoundException('Child not found');

    const type = await this.prisma.subscriptionType.findUnique({ where: { id: dto.subscriptionTypeId } });
    if (!type) throw new NotFoundException('Subscription type not found');

    const pricePerSession = Number(type.pricePerSession);
    const totalPrice = pricePerSession * dto.totalSessions;

    return this.prisma.subscription.create({
      data: {
        childId: dto.childId,
        subscriptionTypeId: dto.subscriptionTypeId,
        totalSessions: dto.totalSessions,
        remainingSessions: dto.totalSessions,
        pricePerSession,
        totalPrice,
      },
      include: { child: true, subscriptionType: true },
    });
  }

  async findAll(filters: { childId?: string; status?: SubscriptionStatus }) {
    return this.prisma.subscription.findMany({
      where: { childId: filters.childId, status: filters.status },
      include: { child: true, subscriptionType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        child: true,
        subscriptionType: true,
        attendances: { orderBy: { date: 'desc' } },
      },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    return sub;
  }

  async findByChild(childId: string, requestingUser: AuthenticatedUser) {
    if (requestingUser.role === Role.parent) {
      const child = await this.prisma.child.findFirst({
        where: { id: childId, parents: { some: { id: requestingUser.id } } },
      });
      if (!child) throw new ForbiddenException('Access denied');
    }

    return this.prisma.subscription.findMany({
      where: { childId },
      include: { subscriptionType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.active) {
      throw new BadRequestException('Only active subscriptions can be cancelled');
    }
    return this.prisma.subscription.update({
      where: { id },
      data: { status: SubscriptionStatus.cancelled },
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest --testPathPattern=subscriptions.service --no-coverage
```

Expected: PASS — 8 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/subscriptions/dto/create-subscription.dto.ts src/subscriptions/subscriptions.service.ts src/subscriptions/subscriptions.service.spec.ts
git commit -m "feat: add SubscriptionsService with tests"
```

---

## Task 5: SubscriptionsController + ChildSubscriptionsController

**Files:**
- Create: `src/subscriptions/subscriptions.controller.ts`
- Create: `src/subscriptions/child-subscriptions.controller.ts`

- [ ] **Step 1: Create SubscriptionsController**

`src/subscriptions/subscriptions.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role, SubscriptionStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private service: SubscriptionsService) {}

  @Roles(Role.root, Role.admin)
  @Post()
  create(@Body() dto: CreateSubscriptionDto) {
    return this.service.create(dto);
  }

  @Roles(Role.root, Role.admin)
  @Get()
  findAll(
    @Query('childId') childId?: string,
    @Query('status') status?: SubscriptionStatus,
  ) {
    return this.service.findAll({ childId, status });
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(Role.root, Role.admin)
  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }
}
```

- [ ] **Step 2: Create ChildSubscriptionsController**

`src/subscriptions/child-subscriptions.controller.ts`:
```typescript
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { SubscriptionsService } from './subscriptions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher, Role.parent)
@Controller('children')
export class ChildSubscriptionsController {
  constructor(private service: SubscriptionsService) {}

  @Get(':childId/subscriptions')
  findByChild(
    @Param('childId') childId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findByChild(childId, user);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/subscriptions/subscriptions.controller.ts src/subscriptions/child-subscriptions.controller.ts
git commit -m "feat: add SubscriptionsController and ChildSubscriptionsController"
```

---

## Task 6: AttendancesService (TDD)

**Files:**
- Create: `src/subscriptions/dto/create-attendance.dto.ts`
- Create: `src/subscriptions/attendances.service.spec.ts`
- Create: `src/subscriptions/attendances.service.ts`

- [ ] **Step 1: Create DTO**

`src/subscriptions/dto/create-attendance.dto.ts`:
```typescript
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateAttendanceDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
```

- [ ] **Step 2: Write the failing tests**

`src/subscriptions/attendances.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { AttendancesService } from './attendances.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  subscription: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  attendance: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((fn) => fn(mockPrisma)),
};

describe('AttendancesService', () => {
  let service: AttendancesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    const module = await Test.createTestingModule({
      providers: [
        AttendancesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AttendancesService);
  });

  describe('create', () => {
    it('marks attendance and decrements remainingSessions', async () => {
      const sub = { id: 'sub-1', remainingSessions: 3, status: SubscriptionStatus.active };
      const attendance = { id: 'att-1', subscriptionId: 'sub-1', date: new Date(), note: null };
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.create.mockResolvedValue(attendance);
      mockPrisma.subscription.update.mockResolvedValue({});

      const result = await service.create('sub-1', {});

      expect(result).toEqual(attendance);
      expect(mockPrisma.attendance.create).toHaveBeenCalledWith({
        data: { subscriptionId: 'sub-1', note: undefined, date: undefined },
      });
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 2, status: SubscriptionStatus.active },
      });
    });

    it('sets status to finished when the last session is used', async () => {
      const sub = { id: 'sub-1', remainingSessions: 1, status: SubscriptionStatus.active };
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.create.mockResolvedValue({ id: 'att-1', subscriptionId: 'sub-1' });
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.create('sub-1', {});

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 0, status: SubscriptionStatus.finished },
      });
    });

    it('throws ForbiddenException when subscription is not active', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        remainingSessions: 5,
        status: SubscriptionStatus.cancelled,
      });

      await expect(service.create('sub-1', {})).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.create('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('removes attendance and increments remainingSessions', async () => {
      const attendance = { id: 'att-1', subscriptionId: 'sub-1' };
      const sub = { id: 'sub-1', remainingSessions: 2, status: SubscriptionStatus.active };
      mockPrisma.attendance.findUnique.mockResolvedValue(attendance);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.delete.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.delete('sub-1', 'att-1');

      expect(mockPrisma.attendance.delete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 3, status: SubscriptionStatus.active },
      });
    });

    it('reverts finished subscription to active when attendance is deleted', async () => {
      const attendance = { id: 'att-1', subscriptionId: 'sub-1' };
      const sub = { id: 'sub-1', remainingSessions: 0, status: SubscriptionStatus.finished };
      mockPrisma.attendance.findUnique.mockResolvedValue(attendance);
      mockPrisma.subscription.findUnique.mockResolvedValue(sub);
      mockPrisma.attendance.delete.mockResolvedValue({});
      mockPrisma.subscription.update.mockResolvedValue({});

      await service.delete('sub-1', 'att-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { remainingSessions: 1, status: SubscriptionStatus.active },
      });
    });

    it('throws NotFoundException when attendance does not exist', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue(null);

      await expect(service.delete('sub-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when attendance belongs to a different subscription', async () => {
      mockPrisma.attendance.findUnique.mockResolvedValue({ id: 'att-1', subscriptionId: 'other-sub' });

      await expect(service.delete('sub-1', 'att-1')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest --testPathPattern=attendances.service --no-coverage
```

Expected: FAIL — `Cannot find module './attendances.service'`

- [ ] **Step 4: Implement the service**

`src/subscriptions/attendances.service.ts`:
```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@Injectable()
export class AttendancesService {
  constructor(private prisma: PrismaService) {}

  async create(subscriptionId: string, dto: CreateAttendanceDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.active) {
      throw new ForbiddenException('Cannot mark attendance on a non-active subscription');
    }

    const newRemaining = sub.remainingSessions - 1;

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.create({
        data: { subscriptionId, note: dto.note, date: dto.date ? new Date(dto.date) : undefined },
      });

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          remainingSessions: newRemaining,
          status: newRemaining === 0 ? SubscriptionStatus.finished : SubscriptionStatus.active,
        },
      });

      return attendance;
    });
  }

  async findBySubscription(subscriptionId: string) {
    return this.prisma.attendance.findMany({
      where: { subscriptionId },
      orderBy: { date: 'desc' },
    });
  }

  async delete(subscriptionId: string, attendanceId: string) {
    const attendance = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!attendance) throw new NotFoundException('Attendance not found');
    if (attendance.subscriptionId !== subscriptionId) {
      throw new BadRequestException('Attendance does not belong to this subscription');
    }

    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });

    return this.prisma.$transaction(async (tx) => {
      await tx.attendance.delete({ where: { id: attendanceId } });
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          remainingSessions: sub.remainingSessions + 1,
          status: sub.status === SubscriptionStatus.finished ? SubscriptionStatus.active : sub.status,
        },
      });
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest --testPathPattern=attendances.service --no-coverage
```

Expected: PASS — 8 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/subscriptions/dto/create-attendance.dto.ts src/subscriptions/attendances.service.ts src/subscriptions/attendances.service.spec.ts
git commit -m "feat: add AttendancesService with tests"
```

---

## Task 7: AttendancesController + SubscriptionsModule + wire AppModule

**Files:**
- Create: `src/subscriptions/attendances.controller.ts`
- Create: `src/subscriptions/subscriptions.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create AttendancesController**

`src/subscriptions/attendances.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AttendancesService } from './attendances.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscriptions/:subscriptionId/attendances')
export class AttendancesController {
  constructor(private service: AttendancesService) {}

  @Roles(Role.root, Role.admin, Role.teacher)
  @Post()
  create(
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: CreateAttendanceDto,
  ) {
    return this.service.create(subscriptionId, dto);
  }

  @Roles(Role.root, Role.admin, Role.teacher)
  @Get()
  findAll(@Param('subscriptionId') subscriptionId: string) {
    return this.service.findBySubscription(subscriptionId);
  }

  @Roles(Role.root, Role.admin)
  @Delete(':id')
  delete(
    @Param('subscriptionId') subscriptionId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(subscriptionId, id);
  }
}
```

- [ ] **Step 2: Create SubscriptionsModule**

`src/subscriptions/subscriptions.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { AttendancesController } from './attendances.controller';
import { AttendancesService } from './attendances.service';
import { ChildSubscriptionsController } from './child-subscriptions.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionsController, AttendancesController, ChildSubscriptionsController],
  providers: [SubscriptionsService, AttendancesService],
})
export class SubscriptionsModule {}
```

- [ ] **Step 3: Add SubscriptionsModule to AppModule**

Open `src/app.module.ts` and add `SubscriptionsModule` to the `imports` array:

```typescript
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

// inside @Module({ imports: [..., SubscriptionsModule] })
```

- [ ] **Step 4: Run all tests to verify nothing is broken**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Verify build compiles**

```bash
npx nest build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/subscriptions/attendances.controller.ts src/subscriptions/subscriptions.module.ts src/app.module.ts
git commit -m "feat: add AttendancesController, SubscriptionsModule, wire app"
```
