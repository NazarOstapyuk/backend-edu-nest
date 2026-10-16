import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Gender, GroupKind, Role } from '@prisma/client';
import { scopeKind } from '../access/access-calc';
import {
  assertKindInScope,
  childScopeWhere,
  OUTSIDE_SCOPE,
} from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

const CHILD_FIELDS = [
  'firstName',
  'lastName',
  'middleName',
  'birthDate',
  'gender',
  'groupId',
  'parentIds',
] as const;

const childAudit = (child: {
  firstName: string;
  lastName: string;
  middleName: string | null;
  birthDate: Date;
  gender: Gender;
  groupId: string | null;
  parents?: { id: string }[];
}) => ({
  firstName: child.firstName,
  lastName: child.lastName,
  middleName: child.middleName,
  birthDate: child.birthDate,
  gender: child.gender,
  groupId: child.groupId,
  parentIds: (child.parents ?? []).map((p) => p.id),
});

@Injectable()
export class ChildrenService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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

  private async loadScopedChild(id: string, kind: GroupKind | null) {
    const child = await this.prisma.child.findUnique({
      where: { id },
      include: {
        group: { select: { kind: true } },
        parents: { select: { id: true } },
      },
    });
    if (!child || (kind && child.group?.kind !== kind)) {
      throw new NotFoundException('Child not found');
    }
    return child;
  }

  async create(dto: CreateChildDto, user: AuthenticatedUser) {
    const kind = scopeKind(user);
    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: dto.groupId },
      });
      if (!group) throw new NotFoundException('Group not found');
      assertKindInScope(kind, group.kind);
    } else if (kind) {
      throw new ForbiddenException(OUTSIDE_SCOPE);
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    const created = await this.prisma.child.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName ?? null,
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
        subscriptions: {
          include: { subscriptionType: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'children',
      entityId: created.id,
      action: AuditAction.create,
      before: null,
      after: childAudit(created),
      fields: CHILD_FIELDS,
    });
    return created;
  }

  async findAll(user: AuthenticatedUser) {
    return this.prisma.child.findMany({
      where: childScopeWhere(scopeKind(user)),
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
        subscriptions: {
          include: { subscriptionType: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async update(id: string, dto: UpdateChildDto, user: AuthenticatedUser) {
    const kind = scopeKind(user);
    const before = await this.loadScopedChild(id, kind);

    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: dto.groupId },
      });
      if (!group) throw new NotFoundException('Group not found');
      assertKindInScope(kind, group.kind);
    } else if (kind && dto.groupId === null) {
      throw new ForbiddenException(OUTSIDE_SCOPE);
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    const updated = await this.prisma.child.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
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
        subscriptions: {
          include: { subscriptionType: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'children',
      entityId: id,
      action: AuditAction.update,
      before: childAudit(before),
      after: childAudit(updated),
      fields: CHILD_FIELDS,
    });
    return updated;
  }

  async delete(id: string, user: AuthenticatedUser) {
    const child = await this.loadScopedChild(id, scopeKind(user));
    const counts = await Promise.all([
      this.prisma.charge.count({ where: { childId: id } }),
      this.prisma.payment.count({ where: { childId: id } }),
      this.prisma.enrollment.count({ where: { childId: id } }),
      this.prisma.adaptationVisit.count({ where: { childId: id } }),
      this.prisma.classGroupMember.count({ where: { childId: id } }),
      this.prisma.lessonAttendance.count({ where: { childId: id } }),
      this.prisma.package.count({ where: { childId: id } }),
      this.prisma.dailyAttendance.count({ where: { childId: id } }),
      this.prisma.absenceNotice.count({ where: { childId: id } }),
      this.prisma.subgroupMember.count({ where: { childId: id } }),
      this.prisma.lessonMark.count({ where: { childId: id } }),
      this.prisma.paymentRequest.count({ where: { childId: id } }),
    ]);
    if (counts.some((count) => count > 0)) {
      throw new BadRequestException(
        'Cannot delete: child has financial records',
      );
    }
    await this.prisma.child.delete({ where: { id } });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'children',
      entityId: id,
      action: AuditAction.delete,
      before: childAudit(child),
      after: null,
      fields: CHILD_FIELDS,
    });
    return { message: 'Child deleted' };
  }
}
