import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { kyivToday, overlaps, toDay } from '../tariffs/dates';
import { assertGroupAccess } from './access';
import {
  groupDetailInclude,
  groupSummaryInclude,
  toGroupDetail,
  toGroupSummary,
} from './class-views';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateClassGroupDto } from './dto/create-class-group.dto';
import { EndMemberDto } from './dto/end-member.dto';
import { UpdateClassGroupDto } from './dto/update-class-group.dto';

@Injectable()
export class ClassGroupsService {
  constructor(private prisma: PrismaService) {}

  private async assertTeachers(ids: string[]) {
    if (ids.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });
    if (
      users.length !== new Set(ids).size ||
      users.some((u) => u.role !== Role.teacher)
    ) {
      throw new BadRequestException('Invalid teachers');
    }
  }

  private async assertTariff(
    id: string | null | undefined,
    unit: TariffUnit,
    message: string,
  ) {
    if (!id) return;
    const tariff = await this.prisma.tariff.findUnique({ where: { id } });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.unit !== unit) throw new BadRequestException(message);
  }

  private async assertNameFree(
    directionId: string,
    name: string,
    exceptId?: string,
  ) {
    const existing = await this.prisma.classGroup.findFirst({
      where: {
        directionId,
        name,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (existing)
      throw new BadRequestException(
        'Class group with this name already exists in the direction',
      );
  }

  private async load(id: string) {
    const group = await this.prisma.classGroup.findUnique({
      where: { id },
      include: groupDetailInclude,
    });
    if (!group) throw new NotFoundException('Class group not found');
    return group;
  }

  async create(dto: CreateClassGroupDto) {
    const direction = await this.prisma.direction.findUnique({
      where: { id: dto.directionId },
    });
    if (!direction) throw new NotFoundException('Direction not found');
    await this.assertNameFree(dto.directionId, dto.name);
    await this.assertTeachers(dto.teacherIds);
    await this.assertTariff(
      dto.singleTariffId,
      TariffUnit.session,
      'Tariff unit must be session',
    );
    await this.assertTariff(
      dto.packageTariffId,
      TariffUnit.package,
      'Tariff unit must be package',
    );

    const group = await this.prisma.classGroup.create({
      data: {
        name: dto.name,
        directionId: dto.directionId,
        format: dto.format,
        singleTariffId: dto.singleTariffId ?? null,
        packageTariffId: dto.packageTariffId ?? null,
        teachers: { connect: dto.teacherIds.map((id) => ({ id })) },
      },
    });
    return toGroupDetail(await this.load(group.id), kyivToday());
  }

  async update(id: string, dto: UpdateClassGroupDto) {
    const group = await this.load(id);
    if (dto.name !== undefined && dto.name !== group.name)
      await this.assertNameFree(group.directionId, dto.name, id);
    if (dto.teacherIds) await this.assertTeachers(dto.teacherIds);
    await this.assertTariff(
      dto.singleTariffId,
      TariffUnit.session,
      'Tariff unit must be session',
    );
    await this.assertTariff(
      dto.packageTariffId,
      TariffUnit.package,
      'Tariff unit must be package',
    );

    await this.prisma.classGroup.update({
      where: { id },
      data: {
        name: dto.name,
        format: dto.format,
        isActive: dto.isActive,
        singleTariffId: dto.singleTariffId,
        packageTariffId: dto.packageTariffId,
        teachers: dto.teacherIds
          ? { set: dto.teacherIds.map((tid) => ({ id: tid })) }
          : undefined,
      },
    });
    return toGroupDetail(await this.load(id), kyivToday());
  }

  async delete(id: string) {
    await this.load(id);
    const lessons = await this.prisma.lesson.count({
      where: { classGroupId: id },
    });
    if (lessons > 0)
      throw new BadRequestException('Cannot delete: group is in use');
    await this.prisma.$transaction([
      this.prisma.classGroupMember.deleteMany({ where: { classGroupId: id } }),
      this.prisma.classGroup.delete({ where: { id } }),
    ]);
    return { message: 'Class group deleted' };
  }

  async get(id: string, user: AuthenticatedUser, today: Date = kyivToday()) {
    const group = await this.load(id);
    assertGroupAccess(group, user);
    return toGroupDetail(group, today);
  }

  async myGroups(user: AuthenticatedUser, today: Date = kyivToday()) {
    const groups = await this.prisma.classGroup.findMany({
      where: { isActive: true, teachers: { some: { id: user.id } } },
      include: {
        ...groupSummaryInclude,
        direction: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => ({
      ...toGroupSummary(g, today),
      direction: g.direction,
    }));
  }

  async addMember(groupId: string, dto: AddMemberDto, userId: string) {
    await this.load(groupId);
    const child = await this.prisma.child.findUnique({
      where: { id: dto.childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    const startDate = toDay(dto.startDate);
    const existing = await this.prisma.classGroupMember.findMany({
      where: { classGroupId: groupId, childId: dto.childId },
    });
    if (
      existing.some((m) => overlaps(startDate, null, m.startDate, m.endDate))
    ) {
      throw new BadRequestException('Child is already a member of this group');
    }
    await this.prisma.classGroupMember.create({
      data: {
        classGroupId: groupId,
        childId: dto.childId,
        startDate,
        createdById: userId,
      },
    });
    return toGroupDetail(await this.load(groupId), kyivToday());
  }

  async endMember(memberId: string, dto: EndMemberDto) {
    const member = await this.prisma.classGroupMember.findUnique({
      where: { id: memberId },
    });
    if (!member) throw new NotFoundException('Member not found');
    const endDate = toDay(dto.endDate);
    if (endDate.getTime() < member.startDate.getTime()) {
      throw new BadRequestException('End date must not be before start date');
    }
    await this.prisma.classGroupMember.update({
      where: { id: memberId },
      data: { endDate },
    });
    return toGroupDetail(await this.load(member.classGroupId), kyivToday());
  }
}
