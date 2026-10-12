import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind, Role } from '@prisma/client';
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

  async create(dto: CreateGroupDto) {
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

    return this.prisma.group.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        bellScheduleId: dto.bellScheduleId,
        teachers: dto.teacherIds
          ? { connect: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        teachers: { omit: { password: true, refreshToken: true } },
        children: true,
      },
    });
  }

  async findAll() {
    return this.prisma.group.findMany({
      include: {
        teachers: { omit: { password: true, refreshToken: true } },
        children: true,
      },
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
    await this.assertBellSchedule(
      id,
      dto.kind ?? group.kind,
      dto.bellScheduleId,
    );

    return this.prisma.group.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        bellScheduleId: dto.bellScheduleId,
        teachers: dto.teacherIds
          ? { set: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        teachers: { omit: { password: true, refreshToken: true } },
        children: true,
      },
    });
  }

  async delete(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');

    const [marks, calendarDays] = await Promise.all([
      this.prisma.dailyAttendance.count({ where: { groupId: id } }),
      this.prisma.calendarDay.count({ where: { groupId: id } }),
    ]);
    if (marks > 0 || calendarDays > 0) {
      throw new BadRequestException(
        'Cannot delete: group has attendance records',
      );
    }

    await this.prisma.group.delete({ where: { id } });
    return { message: 'Group deleted' };
  }
}
