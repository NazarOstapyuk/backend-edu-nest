import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, GroupKind, Role } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import {
  assertInstitutionInScope,
  groupScopeWhere,
  OUTSIDE_SCOPE,
} from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

const GROUP_FIELDS = [
  'name',
  'kind',
  'teacherIds',
  'bellScheduleId',
  'mealPriceCategoryId',
] as const;

const groupAudit = (group: {
  name: string;
  kind: GroupKind;
  bellScheduleId: string | null;
  mealPriceCategoryId: string | null;
  teachers?: { id: string }[];
}) => ({
  name: group.name,
  kind: group.kind,
  teacherIds: (group.teachers ?? []).map((t) => t.id),
  bellScheduleId: group.bellScheduleId,
  mealPriceCategoryId: group.mealPriceCategoryId,
});

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

  async create(dto: CreateGroupDto, user: AuthenticatedUser) {
    assertInstitutionInScope(scopeIds(user), null);
    const existing = await this.prisma.group.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Group name already taken');

    if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);
    await this.assertBellSchedule(
      null,
      dto.kind ?? GroupKind.kindergarten,
      dto.bellScheduleId,
    );
    await this.assertMealCategory(dto.mealPriceCategoryId, null);

    const created = await this.prisma.group.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        bellScheduleId: dto.bellScheduleId,
        mealPriceCategoryId: dto.mealPriceCategoryId,
        teachers: dto.teacherIds
          ? { connect: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        teachers: { omit: { password: true, refreshToken: true } },
        children: true,
      },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'groups',
      entityId: created.id,
      action: AuditAction.create,
      before: null,
      after: groupAudit(created),
      fields: GROUP_FIELDS,
    });
    return created;
  }

  async findAll(user: AuthenticatedUser) {
    return this.prisma.group.findMany({
      where: groupScopeWhere(scopeIds(user)),
      include: {
        teachers: { omit: { password: true, refreshToken: true } },
        children: true,
      },
    });
  }

  async update(id: string, dto: UpdateGroupDto, user: AuthenticatedUser) {
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
    if (ids && dto.kind && dto.kind !== group.kind)
      throw new ForbiddenException(OUTSIDE_SCOPE);

    if (dto.name && dto.name !== group.name) {
      const existing = await this.prisma.group.findUnique({
        where: { name: dto.name },
      });
      if (existing) throw new ConflictException('Group name already taken');
    }

    if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);
    await this.assertBellSchedule(
      id,
      dto.kind ?? group.kind,
      dto.bellScheduleId,
    );
    await this.assertMealCategory(
      dto.mealPriceCategoryId,
      group.mealPriceCategoryId,
    );

    const updated = await this.prisma.group.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        bellScheduleId: dto.bellScheduleId,
        mealPriceCategoryId: dto.mealPriceCategoryId,
        teachers: dto.teacherIds
          ? { set: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        teachers: { omit: { password: true, refreshToken: true } },
        children: true,
      },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'groups',
      entityId: id,
      action: AuditAction.update,
      before: groupAudit(group),
      after: groupAudit(updated),
      fields: GROUP_FIELDS,
    });
    return updated;
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
