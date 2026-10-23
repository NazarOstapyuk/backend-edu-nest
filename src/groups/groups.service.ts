import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, GroupKind, Prisma, Role } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { assertInstitutionInScope, groupScopeWhere } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { findInstitution } from '../institutions/institution-checks';
import { assertChildrenCanMove } from '../institutions/move-guard';
import { PrismaService } from '../prisma/prisma.service';
import { kyivToday } from '../tariffs/dates';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

const GROUP_FIELDS = [
  'name',
  'kind',
  'institutionId',
  'teacherIds',
  'bellScheduleId',
  'mealPriceCategoryId',
] as const;

const groupAudit = (group: {
  name: string;
  kind: GroupKind;
  institutionId: string;
  bellScheduleId: string | null;
  mealPriceCategoryId: string | null;
  teachers?: { id: string }[];
}) => ({
  name: group.name,
  kind: group.kind,
  institutionId: group.institutionId,
  teacherIds: (group.teachers ?? []).map((t) => t.id),
  bellScheduleId: group.bellScheduleId,
  mealPriceCategoryId: group.mealPriceCategoryId,
});

const groupInclude = {
  teachers: { omit: { password: true, refreshToken: true } },
  children: true,
  institution: { select: { id: true, name: true, type: true } },
} as const;

@Injectable()
export class GroupsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

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

  private async assertBellSchedule(
    groupId: string | null,
    kind: GroupKind,
    bellScheduleId: string | null | undefined,
  ) {
    if (!bellScheduleId) return;
    const schedule = await this.prisma.bellSchedule.findUnique({
      where: { id: bellScheduleId },
      select: { id: true, periods: { select: { number: true } } },
    });
    if (!schedule) throw new NotFoundException('Bell schedule not found');
    if (kind !== GroupKind.school_class)
      throw new BadRequestException('Not a school class');
    if (!groupId) return;
    const used = await this.prisma.timetableEntry.findMany({
      where: { timetable: { groupId } },
      select: { period: true },
      distinct: ['period'],
    });
    const numbers = new Set(schedule.periods.map((p) => p.number));
    if (used.some((u) => !numbers.has(u.period)))
      throw new BadRequestException('Bell period is in use');
  }

  private async assertMealCategory(
    id: string | null | undefined,
    currentId: string | null,
  ) {
    if (!id) return;
    const category = await this.prisma.mealPriceCategory.findUnique({
      where: { id },
      select: { id: true, active: true },
    });
    if (!category) throw new NotFoundException('Meal price category not found');
    if (!category.active && id !== currentId)
      throw new BadRequestException('Meal price category is inactive');
  }

  private async lockInstitution(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "Institution" WHERE id = ${id} FOR SHARE`;
  }

  async create(dto: CreateGroupDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockInstitution(tx, dto.institutionId);
      const institution = await findInstitution(tx, dto.institutionId, {
        active: true,
      });
      assertInstitutionInScope(scopeIds(user), institution.id);

      const existing = await tx.group.findUnique({
        where: {
          institutionId_name: {
            institutionId: institution.id,
            name: dto.name,
          },
        },
      });
      if (existing) throw new ConflictException('Group name already taken');

      if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);
      await this.assertBellSchedule(null, institution.type, dto.bellScheduleId);
      await this.assertMealCategory(dto.mealPriceCategoryId, null);

      const created = await tx.group.create({
        data: {
          name: dto.name,
          kind: institution.type,
          institutionId: institution.id,
          bellScheduleId: dto.bellScheduleId,
          mealPriceCategoryId: dto.mealPriceCategoryId,
          teachers: dto.teacherIds
            ? { connect: dto.teacherIds.map((id) => ({ id })) }
            : undefined,
        },
        include: groupInclude,
      });
      await this.audit.recordChange(tx, {
        actorId: user.id,
        entityType: 'groups',
        entityId: created.id,
        action: AuditAction.create,
        before: null,
        after: groupAudit(created),
        fields: GROUP_FIELDS,
      });
      return created;
    });
  }

  async findAll(user: AuthenticatedUser, institutionId?: string) {
    const ids = scopeIds(user);
    if (institutionId && ids && !ids.includes(institutionId)) return [];
    return this.prisma.group.findMany({
      where: institutionId ? { institutionId } : groupScopeWhere(ids),
      include: groupInclude,
    });
  }

  async update(id: string, dto: UpdateGroupDto, user: AuthenticatedUser) {
    const ids = scopeIds(user);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Group" WHERE id = ${id} FOR UPDATE`;
      const group = await tx.group.findUnique({
        where: { id },
        include: { teachers: { select: { id: true } } },
      });
      if (
        !group ||
        (ids && (!group.institutionId || !ids.includes(group.institutionId)))
      ) {
        throw new NotFoundException('Group not found');
      }

      const moving =
        dto.institutionId !== undefined &&
        dto.institutionId !== group.institutionId;
      const targetInstitutionId = moving
        ? (dto.institutionId as string)
        : group.institutionId;

      if (moving) {
        await this.lockInstitution(tx, targetInstitutionId);
        const target = await findInstitution(tx, targetInstitutionId, {
          active: true,
        });
        assertInstitutionInScope(ids, target.id);
        if (target.type !== group.kind) {
          throw new BadRequestException('Institution type cannot change');
        }
      }

      if (moving || (dto.name && dto.name !== group.name)) {
        const existing = await tx.group.findUnique({
          where: {
            institutionId_name: {
              institutionId: targetInstitutionId,
              name: dto.name ?? group.name,
            },
          },
        });
        if (existing && existing.id !== id)
          throw new ConflictException('Group name already taken');
      }

      if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);
      await this.assertBellSchedule(id, group.kind, dto.bellScheduleId);
      await this.assertMealCategory(
        dto.mealPriceCategoryId,
        group.mealPriceCategoryId,
      );

      if (moving) {
        const children = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Child" WHERE "groupId" = ${id} ORDER BY id FOR UPDATE`;
        await assertChildrenCanMove(
          tx,
          children.map((c) => c.id),
          group.institutionId,
          kyivToday(),
        );
      }

      const updated = await tx.group.update({
        where: { id },
        data: {
          name: dto.name,
          institutionId: moving ? targetInstitutionId : undefined,
          bellScheduleId: dto.bellScheduleId,
          mealPriceCategoryId: dto.mealPriceCategoryId,
          teachers: dto.teacherIds
            ? { set: dto.teacherIds.map((id) => ({ id })) }
            : undefined,
        },
        include: groupInclude,
      });
      await this.audit.recordChange(tx, {
        actorId: user.id,
        entityType: 'groups',
        entityId: id,
        action: AuditAction.update,
        before: groupAudit(group),
        after: groupAudit(updated),
        fields: GROUP_FIELDS,
      });
      return updated;
    });
  }

  async delete(id: string, user: AuthenticatedUser) {
    const ids = scopeIds(user);
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: { teachers: { select: { id: true } } },
    });
    if (
      !group ||
      (ids && (!group.institutionId || !ids.includes(group.institutionId)))
    ) {
      throw new NotFoundException('Group not found');
    }

    const counts = await Promise.all([
      this.prisma.dailyAttendance.count({ where: { groupId: id } }),
      this.prisma.calendarDay.count({ where: { groupId: id } }),
      this.prisma.timetable.count({ where: { groupId: id } }),
      this.prisma.lessonChange.count({ where: { groupId: id } }),
      this.prisma.schoolLesson.count({ where: { groupId: id } }),
      this.prisma.subgroup.count({ where: { groupId: id } }),
      this.prisma.routineTemplate.count({ where: { groupId: id } }),
      this.prisma.routineDay.count({ where: { groupId: id } }),
    ]);
    if (counts.some((count) => count > 0)) {
      throw new BadRequestException(
        'Cannot delete: group has attendance records',
      );
    }

    await this.prisma.group.delete({ where: { id } });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'groups',
      entityId: id,
      action: AuditAction.delete,
      before: groupAudit(group),
      after: null,
      fields: GROUP_FIELDS,
    });
    return { message: 'Group deleted' };
  }
}
