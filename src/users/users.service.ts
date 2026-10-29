// src/users/users.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  AuditAction,
  PermissionArea,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  coversUser,
  grantDenial,
  hasPermission,
  holdsAll,
  scopeIds,
  toPermissionMap,
} from '../access/access-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { childScopeWhere } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { findInstitution } from '../institutions/institution-checks';
import { positionRef, positionSelect } from '../positions/position-select';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateAccessDto } from './dto/update-access.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const institutionSelect = { select: { institutionId: true } } as const;
const userInclude = {
  position: positionSelect,
  institutions: institutionSelect,
} as const;
const userOmit = { password: true, refreshToken: true } as const;

type PositionRow = {
  id: string;
  name: string;
  teaching: boolean;
  permissions: { area: PermissionArea; level: PermissionLevel }[];
};

const idsOf = (row: { institutions?: { institutionId: string }[] }) =>
  (row.institutions ?? []).map((i) => i.institutionId).sort();

const permissionsOf = (row: { position?: PositionRow | null }) =>
  (row.position?.permissions ?? []).map((p) => ({
    area: p.area,
    level: p.level,
  }));

const roleOf = (position: { teaching: boolean }): Role =>
  position.teaching ? Role.teacher : Role.admin;

const toUserView = <
  T extends {
    institutions?: { institutionId: string }[];
    position?: PositionRow | null;
  },
>(
  row: T,
) => {
  const { institutions, position, ...rest } = row;
  return {
    ...rest,
    position: positionRef(position ?? null),
    permissions: permissionsOf({ position }),
    institutionIds: idsOf({ institutions }),
  };
};

const USER_FIELDS = [
  'login',
  'role',
  'firstName',
  'lastName',
  'middleName',
  'phone',
  'email',
  'isActive',
  'accessScope',
  'institutionIds',
  'positionId',
  'position',
  'password',
] as const;
const USER_FIELDS_NO_PASSWORD = USER_FIELDS.filter((f) => f !== 'password');

const userAudit = (
  user: {
    login: string;
    role: Role;
    firstName: string;
    lastName: string;
    middleName: string | null;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    accessScope: AccessScope;
    position?: PositionRow | null;
    institutions?: { institutionId: string }[];
  },
  passwordChanged = false,
) => ({
  login: user.login,
  role: user.role,
  firstName: user.firstName,
  lastName: user.lastName,
  middleName: user.middleName,
  phone: user.phone,
  email: user.email,
  isActive: user.isActive,
  accessScope: user.accessScope,
  institutionIds: idsOf(user),
  positionId: user.position?.id ?? null,
  position: user.position?.name ?? null,
  password: passwordChanged ? 'змінено' : null,
});

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async lockPosition(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "Position" WHERE id = ${id} FOR SHARE`;
    const position = await tx.position.findUnique({
      where: { id },
      ...positionSelect,
    });
    if (!position) throw new NotFoundException('Position not found');
    return position;
  }

  private assertCanAssign(actor: AuthenticatedUser, position: PositionRow) {
    if (!holdsAll(actor, toPermissionMap(position.permissions)))
      throw new ForbiddenException('Cannot grant more than you have');
  }

  private async assertNoSalaryRecords(
    db: Prisma.TransactionClient,
    id: string,
  ) {
    const [terms, extraHours, absences] = await Promise.all([
      db.salaryTerms.count({ where: { teacherId: id } }),
      db.payrollExtraHours.count({ where: { teacherId: id } }),
      db.teacherAbsence.count({ where: { teacherId: id } }),
    ]);
    if (terms + extraHours + absences > 0)
      throw new BadRequestException('User has salary terms');
  }

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    if (dto.role === Role.root && actor.role !== Role.root) {
      throw new ForbiddenException('Forbidden');
    }
    if (dto.role && (dto.positionId || dto.accessScope)) {
      throw new BadRequestException('Access applies to staff only');
    }
    if (!dto.role && !dto.positionId) {
      throw new BadRequestException('Position is required');
    }

    const existing = await this.prisma.user.findUnique({
      where: { login: dto.login },
    });
    if (existing) throw new ConflictException('Login already taken');

    if (dto.role === Role.parent && !dto.phone) {
      throw new BadRequestException('Phone is required for parents');
    }

    const password = await bcrypt.hash(dto.password, 10);
    const requestedScope = dto.accessScope;
    const requestedIds =
      requestedScope === AccessScope.institutions
        ? [...new Set(dto.institutionIds ?? [])].sort()
        : [];
    const scoped =
      !dto.role &&
      !requestedScope &&
      actor.role !== Role.root &&
      actor.accessScope !== AccessScope.all;
    return this.prisma.$transaction(async (tx) => {
      let role: Role = dto.role ?? Role.admin;
      let positionId: string | null = null;
      if (dto.positionId) {
        const position = await this.lockPosition(tx, dto.positionId);
        this.assertCanAssign(actor, position);
        role = roleOf(position);
        positionId = position.id;
        if (requestedScope && actor.role !== Role.root) {
          const requested = {
            role,
            accessScope: requestedScope,
            institutionIds: requestedIds,
            permissions: toPermissionMap(position.permissions),
          };
          if (!coversUser(actor, requested))
            throw new ForbiddenException('Cannot grant more than you have');
        }
        for (const institutionId of requestedIds) {
          await findInstitution(tx, institutionId, { active: true });
        }
      }
      const user = await tx.user.create({
        data: {
          login: dto.login,
          password,
          role,
          positionId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          middleName: dto.middleName ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          mustChangePassword: dto.role === Role.parent,
          ...(requestedScope
            ? {
                accessScope: requestedScope,
                ...(requestedIds.length > 0
                  ? {
                      institutions: {
                        create: requestedIds.map((institutionId) => ({
                          institutionId,
                        })),
                      },
                    }
                  : {}),
              }
            : {}),
          ...(scoped
            ? {
                accessScope: actor.accessScope,
                institutions: {
                  create: actor.institutionIds.map((institutionId) => ({
                    institutionId,
                  })),
                },
              }
            : {}),
        },
        include: userInclude,
        omit: userOmit,
      });
      await this.audit.recordChange(tx, {
        actorId: actor.id,
        entityType: 'users',
        entityId: user.id,
        action: AuditAction.create,
        before: null,
        after: userAudit(user),
        fields: USER_FIELDS,
      });
      return toUserView(user);
    });
  }

  async lookup(
    role: 'teacher' | 'parent',
    includeInactive: boolean,
    actor: AuthenticatedUser,
  ) {
    const isParents = role === 'parent';
    if (
      isParents &&
      !hasPermission(actor, PermissionArea.users, PermissionLevel.view) &&
      !hasPermission(actor, PermissionArea.children, PermissionLevel.view)
    )
      throw new ForbiddenException('Insufficient permissions');
    const scope = scopeIds(actor);
    const users = await this.prisma.user.findMany({
      where: {
        role,
        ...(includeInactive ? {} : { isActive: true }),
        ...(isParents && scope
          ? {
              OR: [
                { children: { some: childScopeWhere(scope) } },
                { children: { none: {} } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        ...(isParents ? { phone: true } : {}),
        isActive: true,
        institutions: institutionSelect,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users.map(({ institutions, ...rest }) => ({
      ...rest,
      phone: isParents ? (rest.phone ?? null) : null,
      institutionIds: idsOf({ institutions }),
    }));
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { role: { not: Role.root } },
      select: {
        id: true,
        login: true,
        role: true,
        firstName: true,
        lastName: true,
        middleName: true,
        phone: true,
        email: true,
        mustChangePassword: true,
        isActive: true,
        accessScope: true,
        positionId: true,
        position: positionSelect,
        institutions: institutionSelect,
        createdAt: true,
        updatedAt: true,
      },
    });
    return users.map(toUserView);
  }

  private assertManageable(
    actor: AuthenticatedUser,
    target: {
      role: Role;
      accessScope: AccessScope;
      position?: PositionRow | null;
      institutions?: { institutionId: string }[];
    },
  ) {
    if (
      !coversUser(actor, {
        role: target.role,
        accessScope: target.accessScope,
        institutionIds: idsOf(target),
        permissions: toPermissionMap(permissionsOf(target)),
      })
    )
      throw new ForbiddenException('Cannot manage this user');
  }

  async delete(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.root)
      throw new ForbiddenException('Cannot delete root user');
    if (actor.id === id)
      throw new ForbiddenException('Cannot change own access');
    this.assertManageable(actor, user);

    const author = { OR: [{ createdById: id }, { voidedById: id }] };
    const payrollRecord = {
      OR: [{ teacherId: id }, { createdById: id }, { voidedById: id }],
    };
    const counts = await Promise.all([
      this.prisma.charge.count({ where: author }),
      this.prisma.payment.count({ where: author }),
      this.prisma.allocation.count({ where: author }),
      this.prisma.tariffPrice.count({ where: { createdById: id } }),
      this.prisma.enrollment.count({ where: { createdById: id } }),
      this.prisma.enrollmentAdjustment.count({ where: author }),
      this.prisma.adaptationVisit.count({ where: author }),
      this.prisma.classGroupMember.count({ where: { createdById: id } }),
      this.prisma.package.count({
        where: {
          OR: [{ createdById: id }, { voidedById: id }, { reconciledById: id }],
        },
      }),
      this.prisma.packageExtension.count({ where: { createdById: id } }),
      this.prisma.lesson.count({ where: { conductedById: id } }),
      this.prisma.lessonAttendance.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
      this.prisma.mealOrder.count({
        where: { OR: [{ createdById: id }, { cancelledById: id }] },
      }),
      this.prisma.sessionUsage.count({ where: { voidedById: id } }),
      this.prisma.classGroup.count({ where: { teachers: { some: { id } } } }),
      this.prisma.dailyAttendance.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
      this.prisma.calendarDay.count({ where: author }),
      this.prisma.absenceNotice.count({
        where: { OR: [{ createdById: id }, { decidedById: id }] },
      }),
      this.prisma.timetable.count({ where: { createdById: id } }),
      this.prisma.timetableEntry.count({ where: { teacherId: id } }),
      this.prisma.lessonChange.count({
        where: {
          OR: [{ createdById: id }, { voidedById: id }, { teacherId: id }],
        },
      }),
      this.prisma.schoolLesson.count({
        where: { OR: [{ teacherId: id }, { conductedById: id }] },
      }),
      this.prisma.lessonMark.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
      this.prisma.salaryTerms.count({
        where: { OR: [{ teacherId: id }, { createdById: id }] },
      }),
      this.prisma.payrollSheet.count({
        where: {
          OR: [{ teacherId: id }, { approvedById: id }, { reopenedById: id }],
        },
      }),
      this.prisma.payrollAdjustment.count({ where: author }),
      this.prisma.payrollPayment.count({ where: author }),
      this.prisma.payrollExtraHours.count({ where: payrollRecord }),
      this.prisma.teacherAbsence.count({ where: payrollRecord }),
      this.prisma.backupRun.count({ where: { createdById: id } }),
      this.prisma.routineTemplate.count({ where: { createdById: id } }),
      this.prisma.routineDay.count({ where: { createdById: id } }),
    ]);
    if (counts.some((count) => count > 0)) {
      throw new BadRequestException(
        'Cannot delete: user has financial records, deactivate instead',
      );
    }

    await this.prisma.user.delete({ where: { id } });
    await this.audit.recordChange(this.prisma, {
      actorId: actor.id,
      entityType: 'users',
      entityId: id,
      action: AuditAction.delete,
      before: userAudit(user),
      after: null,
      fields: USER_FIELDS_NO_PASSWORD,
    });
    return { message: 'User deleted' };
  }

  private async lockUser(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    if (dto.role && dto.positionId)
      throw new BadRequestException('Access applies to staff only');
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;

    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockUser(tx, id);
      const changesPosition =
        !!dto.positionId && dto.positionId !== user.positionId;
      const becomesParent =
        dto.role === Role.parent && user.role !== Role.parent;
      if (actor.id === id && (changesPosition || becomesParent))
        throw new ForbiddenException('Cannot change own access');
      if (actor.id === id && dto.isActive === false)
        throw new ForbiddenException('Cannot change own access');
      if (user.role === Role.root && (changesPosition || becomesParent))
        throw new ForbiddenException('Root access cannot be changed');
      this.assertManageable(actor, user);

      if (dto.login && dto.login !== user.login) {
        const existing = await tx.user.findUnique({
          where: { login: dto.login },
        });
        if (existing) throw new ConflictException('Login already taken');
      }

      const nextIsParent =
        becomesParent || (user.role === Role.parent && !changesPosition);
      const clearsPhone = dto.phone === null;
      const nextPhone = dto.phone !== undefined ? dto.phone : user.phone;
      if (nextIsParent && !nextPhone && (clearsPhone || becomesParent)) {
        throw new BadRequestException('Phone is required for parents');
      }

      const data: Prisma.UserUncheckedUpdateInput = {};
      if (dto.login !== undefined) data.login = dto.login;
      if (passwordHash) {
        data.password = passwordHash;
        data.mustChangePassword = true;
        data.refreshToken = null;
      }
      if (dto.middleName !== undefined) data.middleName = dto.middleName;
      if (dto.phone !== undefined) data.phone = dto.phone;
      if (dto.email !== undefined) data.email = dto.email;
      if (dto.firstName !== undefined) data.firstName = dto.firstName;
      if (dto.lastName !== undefined) data.lastName = dto.lastName;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      let nextRole: Role = user.role;
      if (becomesParent) {
        nextRole = Role.parent;
        data.role = Role.parent;
        data.positionId = null;
        data.institutions = { deleteMany: {} };
        data.accessScope = AccessScope.all;
      } else if (changesPosition && dto.positionId) {
        const position = await this.lockPosition(tx, dto.positionId);
        this.assertCanAssign(actor, position);
        nextRole = roleOf(position);
        data.role = nextRole;
        data.positionId = position.id;
        if (
          user.role === Role.parent &&
          actor.role !== Role.root &&
          actor.accessScope !== AccessScope.all
        ) {
          data.accessScope = actor.accessScope;
          data.institutions = {
            deleteMany: {},
            create: actor.institutionIds.map((institutionId) => ({
              institutionId,
            })),
          };
        }
      }
      if (user.role === Role.teacher && nextRole !== Role.teacher)
        await this.assertNoSalaryRecords(tx, id);

      const updated = await tx.user.update({
        where: { id },
        data,
        include: userInclude,
        omit: userOmit,
      });
      await this.audit.recordChange(tx, {
        actorId: actor.id,
        entityType: 'users',
        entityId: id,
        action: AuditAction.update,
        before: userAudit(user),
        after: userAudit(updated, Boolean(dto.password)),
        fields: USER_FIELDS,
      });
      return toUserView(updated);
    });
  }

  async setAccess(id: string, dto: UpdateAccessDto, actor: AuthenticatedUser) {
    const requestedIds =
      dto.accessScope === AccessScope.institutions
        ? [...new Set(dto.institutionIds ?? [])].sort()
        : [];
    return this.prisma.$transaction(async (tx) => {
      const target = await this.lockUser(tx, id);
      const targetIds = idsOf(target);
      const current = {
        role: target.role,
        accessScope: target.accessScope,
        institutionIds: targetIds,
        permissions: toPermissionMap(permissionsOf(target)),
      };
      const position = await this.lockPosition(tx, dto.positionId);
      const permissions = toPermissionMap(position.permissions);
      const denial = grantDenial(
        actor,
        { id: target.id, ...current },
        {
          accessScope: dto.accessScope,
          institutionIds: requestedIds,
          permissions,
        },
      );
      if (denial === 'root')
        throw new ForbiddenException('Root access cannot be changed');
      if (denial === 'staff_only')
        throw new BadRequestException('Access applies to staff only');
      if (denial === 'self')
        throw new ForbiddenException('Cannot change own access');
      if (denial === 'too_much')
        throw new ForbiddenException('Cannot grant more than you have');
      const role = roleOf(position);
      if (actor.role !== Role.root) {
        const requested = {
          role,
          accessScope: dto.accessScope,
          institutionIds: requestedIds,
          permissions,
        };
        if (!coversUser(actor, current) || !coversUser(actor, requested))
          throw new ForbiddenException('Cannot grant more than you have');
      }
      if (target.role === Role.teacher && role !== Role.teacher)
        await this.assertNoSalaryRecords(tx, id);
      for (const institutionId of requestedIds) {
        await findInstitution(tx, institutionId, {
          active: !targetIds.includes(institutionId),
        });
      }
      await tx.userInstitution.deleteMany({ where: { userId: id } });
      if (requestedIds.length > 0) {
        await tx.userInstitution.createMany({
          data: requestedIds.map((institutionId) => ({
            userId: id,
            institutionId,
          })),
        });
      }
      await tx.user.update({
        where: { id },
        data: { accessScope: dto.accessScope, positionId: position.id, role },
      });
      const updated = await tx.user.findUnique({
        where: { id },
        include: userInclude,
        omit: userOmit,
      });
      if (!updated) throw new NotFoundException('User not found');
      await this.audit.recordChange(tx, {
        actorId: actor.id,
        entityType: 'users',
        entityId: id,
        action: AuditAction.update,
        before: userAudit(target),
        after: userAudit(updated),
        fields: [
          'role',
          'accessScope',
          'institutionIds',
          'positionId',
          'position',
        ],
      });
      return toUserView(updated);
    });
  }
}
