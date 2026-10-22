import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Gender, Role } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { assertInstitutionInScope, childScopeWhere } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { findInstitution } from '../institutions/institution-checks';
import { assertChildrenCanMove } from '../institutions/move-guard';
import { PrismaService } from '../prisma/prisma.service';
import { kyivToday } from '../tariffs/dates';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

const groupInclude = {
  include: { institution: { select: { id: true, name: true, type: true } } },
} as const;

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

  private async loadScopedChild(id: string, ids: string[] | null) {
    const child = await this.prisma.child.findUnique({
      where: { id },
      include: {
        group: { select: { institutionId: true } },
        parents: { select: { id: true } },
      },
    });
    const institutionId = child?.group?.institutionId ?? null;
    if (
      !child ||
      (ids && (institutionId === null || !ids.includes(institutionId)))
    ) {
      throw new NotFoundException('Child not found');
    }
    return child;
  }

  async create(dto: CreateChildDto, user: AuthenticatedUser) {
    const ids = scopeIds(user);
    const group = await this.prisma.group.findUnique({
      where: { id: dto.groupId },
    });
    if (!group) throw new NotFoundException('Group not found');
    assertInstitutionInScope(ids, group.institutionId);

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
        group: groupInclude,
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
      where: childScopeWhere(scopeIds(user)),
      include: {
        group: groupInclude,
        parents: { omit: { password: true, refreshToken: true } },
        subscriptions: {
          include: { subscriptionType: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async update(id: string, dto: UpdateChildDto, user: AuthenticatedUser) {
    const ids = scopeIds(user);
    const before = await this.loadScopedChild(id, ids);

    if (dto.groupId === null)
      throw new BadRequestException('Group is required');

    let targetInstitutionId: string | null = null;
    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: dto.groupId },
      });
      if (!group) throw new NotFoundException('Group not found');
      assertInstitutionInScope(ids, group.institutionId);
      if (group.institutionId !== before.group?.institutionId) {
        targetInstitutionId = group.institutionId;
      }
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    return this.prisma.$transaction(async (tx) => {
      if (targetInstitutionId) {
        await tx.$queryRaw`SELECT id FROM "Institution" WHERE id = ${targetInstitutionId} FOR SHARE`;
        const target = await findInstitution(tx, targetInstitutionId, {
          active: true,
        });
        assertInstitutionInScope(ids, target.id);
        await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${id} FOR UPDATE`;
        if (before.group?.institutionId) {
          await assertChildrenCanMove(
            tx,
            [id],
            before.group.institutionId,
            kyivToday(),
          );
        }
      }

      const updated = await tx.child.update({
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
          group: groupInclude,
          parents: { omit: { password: true, refreshToken: true } },
          subscriptions: {
            include: { subscriptionType: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      await this.audit.recordChange(tx, {
        actorId: user.id,
        entityType: 'children',
        entityId: id,
        action: AuditAction.update,
        before: childAudit(before),
        after: childAudit(updated),
        fields: CHILD_FIELDS,
      });
      return updated;
    });
  }

  async delete(id: string, user: AuthenticatedUser) {
    const child = await this.loadScopedChild(id, scopeIds(user));
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
