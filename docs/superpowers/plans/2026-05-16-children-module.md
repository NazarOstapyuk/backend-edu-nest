# Children Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `children` module with full CRUD, an optional group link, and an optional parents list, and update `GroupsService` to include children in its responses.

**Architecture:** New `Child` Prisma model with a nullable `groupId` FK and a many-to-many `parents` relation to `User` (role=parent only). `ChildrenService` mirrors `GroupsService` patterns: `validateParents` analogous to `validateTeachers`, `connect`/`set` for relations, `include` inlined on every Prisma call. All endpoints protected by `JwtAuthGuard` + `RolesGuard` for roles `root`, `admin`, `teacher`.

**Tech Stack:** NestJS 11, Prisma 7, PostgreSQL, class-validator, Jest 30

---

## File Map

| Action | Path |
|--------|------|
| Modify | `prisma/schema.prisma` |
| Create | `src/children/dto/create-child.dto.ts` |
| Create | `src/children/dto/update-child.dto.ts` |
| Create | `src/children/children.service.ts` |
| Create | `src/children/children.service.spec.ts` |
| Create | `src/children/children.controller.ts` |
| Create | `src/children/children.module.ts` |
| Modify | `src/app.module.ts` |
| Modify | `src/groups/groups.service.ts` |

---

## Task 1: Prisma Schema — Gender enum, Child model, update Group and User

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update `prisma/schema.prisma`**

Replace the full file content with:

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

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_children
```

Expected: migration file created, Prisma client regenerated, no errors.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Child model and Gender enum to Prisma schema"
```

---

## Task 2: DTOs

**Files:**
- Create: `src/children/dto/create-child.dto.ts`
- Create: `src/children/dto/update-child.dto.ts`

- [ ] **Step 1: Create `src/children/dto/create-child.dto.ts`**

```typescript
import { Gender } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateChildDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsDateString()
  birthDate: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsUUID('4')
  @IsOptional()
  groupId?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  parentIds?: string[];
}
```

- [ ] **Step 2: Create `src/children/dto/update-child.dto.ts`**

```typescript
import { Gender } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateChildDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  lastName?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  // @IsOptional skips validation for both undefined and null,
  // allowing null to explicitly disconnect the child from a group.
  @IsUUID('4')
  @IsOptional()
  groupId?: string | null;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  parentIds?: string[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/children/dto
git commit -m "feat: add CreateChildDto and UpdateChildDto"
```

---

## Task 3: ChildrenService — scaffold + create (TDD)

**Files:**
- Create: `src/children/children.service.ts`
- Create: `src/children/children.service.spec.ts`

- [ ] **Step 1: Create minimal `src/children/children.service.ts` skeleton**

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private prisma: PrismaService) {}
}
```

- [ ] **Step 2: Create `src/children/children.service.spec.ts` with mock + `create` tests**

```typescript
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Gender, Role } from '@prisma/client';
import { ChildrenService } from './children.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

const mockPrisma = {
  child: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: { findMany: jest.fn() },
  group: { findUnique: jest.fn() },
};

describe('ChildrenService', () => {
  let service: ChildrenService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ChildrenService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ChildrenService);
  });

  describe('create', () => {
    const baseDto: CreateChildDto = {
      firstName: 'Ivan',
      lastName: 'Petrenko',
      birthDate: '2020-01-15',
      gender: Gender.male,
    };

    it('creates a child with required fields only', async () => {
      const created = {
        id: 'child-1',
        ...baseDto,
        birthDate: new Date('2020-01-15'),
        groupId: null,
        group: null,
        parents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.child.create.mockResolvedValue(created);

      const result = await service.create(baseDto);

      expect(result).toEqual(created);
      expect(mockPrisma.child.create).toHaveBeenCalledWith({
        data: {
          firstName: 'Ivan',
          lastName: 'Petrenko',
          birthDate: new Date('2020-01-15'),
          gender: Gender.male,
          groupId: undefined,
          parents: undefined,
        },
        include: {
          group: true,
          parents: { omit: { password: true, refreshToken: true } },
        },
      });
    });

    it('throws NotFoundException when groupId does not exist', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, groupId: 'missing-group' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.child.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when a parentId does not exist', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.create({ ...baseDto, parentIds: ['00000000-0000-0000-0000-000000000001'] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when user is not a parent', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', role: Role.teacher },
      ]);

      await expect(
        service.create({ ...baseDto, parentIds: ['00000000-0000-0000-0000-000000000001'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest children.service.spec --no-coverage
```

Expected: FAIL — `TypeError: service.create is not a function`

- [ ] **Step 4: Implement `validateParents` and `create` in `src/children/children.service.ts`**

```typescript
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private prisma: PrismaService) {}

  private async validateParents(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });

    const notFound = ids.filter((id) => !users.find((u) => u.id === id));
    if (notFound.length) {
      throw new NotFoundException(`Users not found: ${notFound.join(', ')}`);
    }

    const notParents = users.filter((u) => u.role !== Role.parent);
    if (notParents.length) {
      throw new BadRequestException(
        `Users are not parents: ${notParents.map((u) => u.id).join(', ')}`,
      );
    }
  }

  async create(dto: CreateChildDto) {
    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new NotFoundException('Group not found');
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    return this.prisma.child.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        birthDate: new Date(dto.birthDate),
        gender: dto.gender,
        groupId: dto.groupId,
        parents: dto.parentIds?.length
          ? { connect: dto.parentIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
      },
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest children.service.spec --no-coverage
```

Expected: PASS — 4 tests in `create`

- [ ] **Step 6: Commit**

```bash
git add src/children/children.service.ts src/children/children.service.spec.ts
git commit -m "feat: implement ChildrenService create with validateParents"
```

---

## Task 4: ChildrenService — findAll (TDD)

**Files:**
- Modify: `src/children/children.service.spec.ts`
- Modify: `src/children/children.service.ts`

- [ ] **Step 1: Add `findAll` test to `src/children/children.service.spec.ts`**

Add after the `create` describe block (before the closing `describe('ChildrenService'` brace):

```typescript
  describe('findAll', () => {
    it('returns all children with group and parents', async () => {
      const children = [
        { id: 'child-1', firstName: 'Ivan', group: null, parents: [] },
      ];
      mockPrisma.child.findMany.mockResolvedValue(children);

      const result = await service.findAll();

      expect(result).toEqual(children);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith({
        include: {
          group: true,
          parents: { omit: { password: true, refreshToken: true } },
        },
      });
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest children.service.spec --no-coverage
```

Expected: FAIL — `TypeError: service.findAll is not a function`

- [ ] **Step 3: Add `findAll` to `src/children/children.service.ts`**

Add after the `create` method:

```typescript
  async findAll() {
    return this.prisma.child.findMany({
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
      },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest children.service.spec --no-coverage
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/children/children.service.ts src/children/children.service.spec.ts
git commit -m "feat: implement ChildrenService findAll"
```

---

## Task 5: ChildrenService — update (TDD)

**Files:**
- Modify: `src/children/children.service.spec.ts`
- Modify: `src/children/children.service.ts`

- [ ] **Step 1: Add `update` tests to `src/children/children.service.spec.ts`**

Add after the `findAll` describe block:

```typescript
  describe('update', () => {
    const existingChild = {
      id: 'child-1',
      firstName: 'Ivan',
      lastName: 'Petrenko',
      birthDate: new Date('2020-01-15'),
      gender: Gender.male,
      groupId: null,
    };

    it('updates a child successfully', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      const updated = { ...existingChild, firstName: 'Petro', group: null, parents: [] };
      mockPrisma.child.update.mockResolvedValue(updated);

      const result = await service.update('child-1', { firstName: 'Petro' } as UpdateChildDto);

      expect(result).toEqual(updated);
      expect(mockPrisma.child.update).toHaveBeenCalledWith({
        where: { id: 'child-1' },
        data: {
          firstName: 'Petro',
          lastName: undefined,
          birthDate: undefined,
          gender: undefined,
          groupId: undefined,
          parents: undefined,
        },
        include: {
          group: true,
          parents: { omit: { password: true, refreshToken: true } },
        },
      });
    });

    it('disconnects group when groupId is null', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      mockPrisma.child.update.mockResolvedValue({ ...existingChild, group: null, parents: [] });

      await service.update('child-1', { groupId: null } as UpdateChildDto);

      expect(mockPrisma.child.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ groupId: null }),
        }),
      );
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', {} as UpdateChildDto),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.child.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when new groupId does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      mockPrisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.update('child-1', { groupId: 'missing-group' } as UpdateChildDto),
      ).rejects.toThrow(NotFoundException);
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest children.service.spec --no-coverage
```

Expected: FAIL — `TypeError: service.update is not a function`

- [ ] **Step 3: Add `update` to `src/children/children.service.ts`**

Add after `findAll`:

```typescript
  async update(id: string, dto: UpdateChildDto) {
    const child = await this.prisma.child.findUnique({ where: { id } });
    if (!child) throw new NotFoundException('Child not found');

    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new NotFoundException('Group not found');
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    return this.prisma.child.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        gender: dto.gender,
        groupId: dto.groupId,
        parents: dto.parentIds
          ? { set: dto.parentIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
      },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest children.service.spec --no-coverage
```

Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/children/children.service.ts src/children/children.service.spec.ts
git commit -m "feat: implement ChildrenService update"
```

---

## Task 6: ChildrenService — delete (TDD)

**Files:**
- Modify: `src/children/children.service.spec.ts`
- Modify: `src/children/children.service.ts`

- [ ] **Step 1: Add `delete` tests to `src/children/children.service.spec.ts`**

Add after the `update` describe block:

```typescript
  describe('delete', () => {
    it('deletes a child and returns a message', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.child.delete.mockResolvedValue({});

      const result = await service.delete('child-1');

      expect(result).toEqual({ message: 'Child deleted' });
      expect(mockPrisma.child.delete).toHaveBeenCalledWith({ where: { id: 'child-1' } });
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing')).rejects.toThrow(NotFoundException);

      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx jest children.service.spec --no-coverage
```

Expected: FAIL — `TypeError: service.delete is not a function`

- [ ] **Step 3: Add `delete` to `src/children/children.service.ts`**

Add after `update`:

```typescript
  async delete(id: string) {
    const child = await this.prisma.child.findUnique({ where: { id } });
    if (!child) throw new NotFoundException('Child not found');
    await this.prisma.child.delete({ where: { id } });
    return { message: 'Child deleted' };
  }
```

- [ ] **Step 4: Run full spec to verify all tests pass**

```bash
npx jest children.service.spec --no-coverage
```

Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/children/children.service.ts src/children/children.service.spec.ts
git commit -m "feat: implement ChildrenService delete"
```

---

## Task 7: ChildrenController + ChildrenModule + AppModule

**Files:**
- Create: `src/children/children.controller.ts`
- Create: `src/children/children.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `src/children/children.controller.ts`**

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin, Role.teacher)
@Controller('children')
export class ChildrenController {
  constructor(private childrenService: ChildrenService) {}

  @Post()
  create(@Body() dto: CreateChildDto) {
    return this.childrenService.create(dto);
  }

  @Get()
  findAll() {
    return this.childrenService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChildDto) {
    return this.childrenService.update(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.childrenService.delete(id);
  }
}
```

- [ ] **Step 2: Create `src/children/children.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ChildrenController } from './children.controller';
import { ChildrenService } from './children.service';

@Module({
  controllers: [ChildrenController],
  providers: [ChildrenService],
})
export class ChildrenModule {}
```

- [ ] **Step 3: Register `ChildrenModule` in `src/app.module.ts`**

Add import and register:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChildrenModule } from './children/children.module';
import { GroupsModule } from './groups/groups.module';
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
    GroupsModule,
    ChildrenModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 4: Verify the app compiles**

```bash
npx nest build
```

Expected: no TypeScript errors, `dist/` produced.

- [ ] **Step 5: Commit**

```bash
git add src/children/children.controller.ts src/children/children.module.ts src/app.module.ts
git commit -m "feat: add ChildrenController, ChildrenModule, register in AppModule"
```

---

## Task 8: Update GroupsService to include children in responses

**Files:**
- Modify: `src/groups/groups.service.ts`

- [ ] **Step 1: Update all `include` clauses in `src/groups/groups.service.ts`**

There are three occurrences (in `create`, `findAll`, `update`). Change each from:

```typescript
include: { teachers: { omit: { password: true, refreshToken: true } } }
```

to:

```typescript
include: { teachers: { omit: { password: true, refreshToken: true } }, children: true }
```

Full updated file:

```typescript
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService) {}

  private async validateTeachers(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });

    const notFound = ids.filter((id) => !users.find((u) => u.id === id));
    if (notFound.length) {
      throw new NotFoundException(`Users not found: ${notFound.join(', ')}`);
    }

    const notTeachers = users.filter((u) => u.role !== Role.teacher);
    if (notTeachers.length) {
      throw new BadRequestException(
        `Users are not teachers: ${notTeachers.map((u) => u.id).join(', ')}`,
      );
    }
  }

  async create(dto: CreateGroupDto) {
    const existing = await this.prisma.group.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Group name already taken');

    if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);

    return this.prisma.group.create({
      data: {
        name: dto.name,
        teachers: dto.teacherIds
          ? { connect: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { teachers: { omit: { password: true, refreshToken: true } }, children: true },
    });
  }

  async findAll() {
    return this.prisma.group.findMany({
      include: { teachers: { omit: { password: true, refreshToken: true } }, children: true },
    });
  }

  async update(id: string, dto: UpdateGroupDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');

    if (dto.name && dto.name !== group.name) {
      const existing = await this.prisma.group.findUnique({
        where: { name: dto.name },
      });
      if (existing) throw new ConflictException('Group name already taken');
    }

    if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);

    return this.prisma.group.update({
      where: { id },
      data: {
        name: dto.name,
        teachers: dto.teacherIds
          ? { set: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { teachers: { omit: { password: true, refreshToken: true } }, children: true },
    });
  }

  async delete(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.group.delete({ where: { id } });
    return { message: 'Group deleted' };
  }
}
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: all existing tests pass, no new failures.

- [ ] **Step 3: Commit**

```bash
git add src/groups/groups.service.ts
git commit -m "feat: include children in GroupsService responses"
```
