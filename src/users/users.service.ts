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
  Role,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  coversUser,
  grantDenial,
  toPermissionMap,
} from '../access/access-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateAccessDto } from './dto/update-access.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const permissionSelect = { select: { area: true, level: true } } as const;

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
  'permissions',
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
    permissions?: { area: PermissionArea; level: PermissionLevel }[];
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
  permissions: (user.permissions ?? []).map((p) => `${p.area}:${p.level}`),
  password: passwordChanged ? 'змінено' : null,
});

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateUserDto, actor: AuthenticatedUser) {
    if (dto.role === Role.root && actor.role !== Role.root) {
      throw new ForbiddenException('Forbidden');
    }

    const existing = await this.prisma.user.findUnique({
      where: { login: dto.login },
    });
    if (existing) throw new ConflictException('Login already taken');

    if (dto.role === Role.parent && !dto.phone) {
      throw new BadRequestException('Phone is required for parents');
    }

    const password = await bcrypt.hash(dto.password, 10);
    const scoped =
      actor.role !== Role.root &&
      actor.accessScope !== AccessScope.all &&
      dto.role !== Role.parent;
    const user = await this.prisma.user.create({
      data: {
        login: dto.login,
        password,
        role: dto.role,
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        mustChangePassword: dto.role === Role.parent,
        ...(scoped ? { accessScope: actor.accessScope } : {}),
      },
      include: { permissions: permissionSelect },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: actor.id,
      entityType: 'users',
      entityId: user.id,
      action: AuditAction.create,
      before: null,
      after: userAudit(user),
      fields: USER_FIELDS,
    });

    const { password: _p, refreshToken: _r, ...result } = user;
    return result;
  }

  async findAll() {
    return this.prisma.user.findMany({
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
        permissions: permissionSelect,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private assertManageable(
    actor: AuthenticatedUser,
    target: {
      role: Role;
      accessScope: AccessScope;
      permissions: { area: PermissionArea; level: PermissionLevel }[];
    },
  ) {
    if (
      !coversUser(actor, {
        role: target.role,
        accessScope: target.accessScope,
        permissions: toPermissionMap(target.permissions),
      })
    )
      throw new ForbiddenException('Cannot manage this user');
  }

  async delete(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: permissionSelect },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.root)
      throw new ForbiddenException('Cannot delete root user');
    if (actor.id === id)
      throw new ForbiddenException('Cannot change own access');
    this.assertManageable(actor, user);

    const author = { OR: [{ createdById: id }, { voidedById: id }] };
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
      this.prisma.backupRun.count({ where: { createdById: id } }),
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

  async update(id: string, dto: UpdateUserDto, actor: AuthenticatedUser) {
    if (dto.role === Role.root && actor.role !== Role.root) {
      throw new ForbiddenException('Forbidden');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: permissionSelect },
    });
    if (!user) throw new NotFoundException('User not found');
    if (actor.id === id && dto.role !== undefined && dto.role !== user.role)
      throw new ForbiddenException('Cannot change own access');
    if (actor.id === id && dto.isActive === false)
      throw new ForbiddenException('Cannot change own access');
    this.assertManageable(actor, user);
    if (
      user.role === Role.teacher &&
      dto.role !== undefined &&
      dto.role !== Role.teacher
    ) {
      const terms = await this.prisma.salaryTerms.count({
        where: { teacherId: id },
      });
      if (terms > 0) throw new BadRequestException('User has salary terms');
    }

    if (dto.login && dto.login !== user.login) {
      const existing = await this.prisma.user.findUnique({
        where: { login: dto.login },
      });
      if (existing) throw new ConflictException('Login already taken');
    }

    const nextRole = dto.role ?? user.role;
    const clearsPhone = dto.phone === null;
    const becomesParent = dto.role === Role.parent && user.role !== Role.parent;
    const nextPhone = dto.phone !== undefined ? dto.phone : user.phone;
    if (
      nextRole === Role.parent &&
      !nextPhone &&
      (clearsPhone || becomesParent)
    ) {
      throw new BadRequestException('Phone is required for parents');
    }

    const data: {
      login?: string;
      password?: string;
      role?: Role;
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
      middleName?: string | null;
      phone?: string | null;
      email?: string | null;
      mustChangePassword?: boolean;
      refreshToken?: null;
      accessScope?: AccessScope;
      permissions?: { deleteMany: object };
    } = {};
    if (dto.login !== undefined) data.login = dto.login;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
      data.mustChangePassword = true;
      data.refreshToken = null;
    }
    if (dto.middleName !== undefined) data.middleName = dto.middleName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (becomesParent) {
      data.permissions = { deleteMany: {} };
      data.accessScope = AccessScope.all;
    }
    if (
      user.role === Role.parent &&
      (dto.role === Role.admin || dto.role === Role.teacher) &&
      actor.role !== Role.root &&
      actor.accessScope !== AccessScope.all
    )
      data.accessScope = actor.accessScope;

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      include: { permissions: permissionSelect },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: actor.id,
      entityType: 'users',
      entityId: id,
      action: AuditAction.update,
      before: userAudit(user),
      after: userAudit(updated, Boolean(dto.password)),
      fields: USER_FIELDS,
    });
    const { password: _p, refreshToken: _r, ...result } = updated;
    return result;
  }
  async setAccess(id: string, dto: UpdateAccessDto, actor: AuthenticatedUser) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: permissionSelect },
    });
    if (!target) throw new NotFoundException('User not found');
    const areas = new Set(dto.permissions.map((p) => p.area));
    if (areas.size !== dto.permissions.length)
      throw new BadRequestException('Duplicate permission');
    const denial = grantDenial(
      actor,
      {
        id: target.id,
        role: target.role,
        accessScope: target.accessScope,
        permissions: toPermissionMap(target.permissions),
      },
      {
        accessScope: dto.accessScope,
        permissions: toPermissionMap(dto.permissions),
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
    if (actor.role !== Role.root) {
      const requested = {
        role: target.role,
        accessScope: dto.accessScope,
        permissions: toPermissionMap(dto.permissions),
      };
      if (
        !coversUser(actor, {
          role: target.role,
          accessScope: target.accessScope,
          permissions: toPermissionMap(target.permissions),
        }) ||
        !coversUser(actor, requested)
      )
        throw new ForbiddenException('Cannot grant more than you have');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId: id } });
      await tx.userPermission.createMany({
        data: dto.permissions.map((p) => ({
          userId: id,
          area: p.area,
          level: p.level,
        })),
      });
      await tx.user.update({
        where: { id },
        data: { accessScope: dto.accessScope },
      });
      const updated = await tx.user.findUnique({
        where: { id },
        include: { permissions: permissionSelect },
        omit: { password: true, refreshToken: true },
      });
      if (updated) {
        await this.audit.recordChange(tx, {
          actorId: actor.id,
          entityType: 'users',
          entityId: id,
          action: AuditAction.update,
          before: userAudit(target),
          after: userAudit(updated),
          fields: ['accessScope', 'permissions'],
        });
      }
      return updated;
    });
  }
}
