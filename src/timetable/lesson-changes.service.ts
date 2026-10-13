import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LessonChangeType, Role, WeekParity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { isoDay } from '../tariffs/dates';
import {
  type ChangeLike,
  type ConflictItem,
  findConflicts,
  type Slot,
  toMinutes,
} from './schedule-calc';
import {
  type ClassSchedule,
  type ConflictRef,
  ScheduleService,
  subgroupKey,
} from './schedule.service';
import { CreateLessonChangeDto } from './dto/lesson-change.dto';

@Injectable()
export class LessonChangesService {
  constructor(
    private prisma: PrismaService,
    private schedule: ScheduleService,
  ) {}

  private async validateRefs(groupId: string, dto: CreateLessonChangeDto) {
    if (
      dto.subgroupId &&
      (await this.prisma.subgroup.count({
        where: { id: dto.subgroupId, groupId },
      })) !== 1
    )
      throw new BadRequestException('Subgroup does not belong to this class');
    if (
      dto.subjectId &&
      (await this.prisma.subject.count({
        where: { id: dto.subjectId, active: true },
      })) !== 1
    )
      throw new NotFoundException('Subject not found');
    if (
      dto.roomId &&
      (await this.prisma.room.count({
        where: { id: dto.roomId, active: true },
      })) !== 1
    )
      throw new NotFoundException('Room not found');
    if (
      dto.teacherId &&
      (await this.prisma.user.count({
        where: { id: dto.teacherId, role: Role.teacher, isActive: true },
      })) !== 1
    )
      throw new BadRequestException('User is not a teacher');
  }

  async create(
    groupId: string,
    dto: CreateLessonChangeDto,
    user: AuthenticatedUser,
  ) {
    const group = await this.schedule.requireClass(groupId);
    const date = parseDay(dto.date);
    if (!group.periods.some((p) => p.number === dto.period))
      throw new BadRequestException('Bell period not found');
    await this.validateRefs(groupId, dto);
    if (
      dto.type === LessonChangeType.replace &&
      !dto.subjectId &&
      !dto.teacherId &&
      !dto.roomId
    )
      throw new BadRequestException('Nothing to replace');
    if (
      dto.type === LessonChangeType.extra &&
      (!dto.subjectId || !dto.teacherId)
    )
      throw new BadRequestException('Subject and teacher are required');
    const [schedule] = await this.schedule.build(date, date, [groupId]);
    const day = schedule.days[0];
    if (!day.working) throw new BadRequestException('Not a working day');
    const subgroupId = dto.subgroupId ?? null;
    const target = day.slots.find(
      (s) =>
        !s.cancelled && s.period === dto.period && s.subgroupId === subgroupId,
    );
    if (dto.type !== LessonChangeType.extra && !target)
      throw new NotFoundException('Lesson not found');
    const change: ChangeLike = {
      id: 'pending',
      period: dto.period,
      subgroupId,
      type: dto.type,
      subjectId: dto.subjectId ?? null,
      teacherId: dto.teacherId ?? null,
      roomId: dto.roomId ?? null,
      voidedAt: null,
    };
    if (dto.type === LessonChangeType.cancel) {
      const recorded = await this.prisma.schoolLesson.findUnique({
        where: {
          groupId_date_period_subgroupKey: {
            groupId,
            date,
            period: dto.period,
            subgroupKey: subgroupKey(subgroupId),
          },
        },
        select: { id: true },
      });
      if (recorded) throw new BadRequestException('Lesson already recorded');
    } else {
      const schedules = await this.schedule.build(date, date, undefined, {
        groupId: group.id,
        change: { ...change, date },
      });
      await this.assertNoConflicts(
        group.id,
        date,
        schedules,
        (slot) => slot.changeId === 'pending',
      );
    }
    const created = await this.prisma.lessonChange.create({
      data: {
        groupId,
        date,
        period: dto.period,
        subgroupId,
        type: dto.type,
        subjectId: change.subjectId,
        teacherId: change.teacherId,
        roomId: change.roomId,
        reason: dto.reason.trim(),
        createdById: user.id,
      },
    });
    return { ...created, date: isoDay(created.date) };
  }

  private async assertNoConflicts(
    groupId: string,
    date: Date,
    schedules: ClassSchedule[],
    isNewSlot: (slot: Slot) => boolean,
  ) {
    const members = await this.prisma.subgroupMember.findMany({
      where: { subgroup: { groupId } },
      select: { subgroupId: true, childId: true },
    });
    const items: ConflictItem[] = [];
    const refs = new Map<string, ConflictRef>();
    for (const schedule of schedules) {
      schedule.days[0].slots.forEach((slot, i) => {
        if (slot.cancelled || !slot.startTime) return;
        const ref = `${schedule.group.id}:${i}`;
        const isNew = schedule.group.id === groupId && isNewSlot(slot);
        refs.set(ref, {
          groupName: schedule.group.name,
          weekday: null,
          date: isoDay(date),
          period: slot.period,
          subjectId: slot.subjectId,
          isNew,
        });
        items.push({
          ref,
          bucket: 'day',
          parity: WeekParity.every,
          start: toMinutes(slot.startTime),
          end: toMinutes(slot.endTime),
          groupId: schedule.group.id,
          teacherId: slot.teacherId,
          roomId: slot.roomId,
          subgroupId: slot.subgroupId,
          memberIds:
            schedule.group.id === groupId && slot.subgroupId
              ? members
                  .filter((m) => m.subgroupId === slot.subgroupId)
                  .map((m) => m.childId)
              : [],
          isNew,
        });
      });
    }
    const conflicts = findConflicts(items);
    if (conflicts.length) await this.schedule.throwConflicts(conflicts, refs);
  }

  async void(id: string, reason: string, user: AuthenticatedUser) {
    const change = await this.prisma.lessonChange.findUnique({ where: { id } });
    if (!change) throw new NotFoundException('Lesson change not found');
    if (change.voidedAt)
      throw new BadRequestException('Lesson change is voided');
    if (change.type !== LessonChangeType.cancel) {
      const recorded = await this.prisma.schoolLesson.findUnique({
        where: {
          groupId_date_period_subgroupKey: {
            groupId: change.groupId,
            date: change.date,
            period: change.period,
            subgroupKey: subgroupKey(change.subgroupId),
          },
        },
        select: { id: true },
      });
      if (recorded) throw new BadRequestException('Lesson already recorded');
    }
    if (change.type !== LessonChangeType.extra) {
      const schedules = await this.schedule.build(
        change.date,
        change.date,
        undefined,
        undefined,
        id,
      );
      await this.assertNoConflicts(
        change.groupId,
        change.date,
        schedules,
        (slot) =>
          slot.period === change.period &&
          slot.subgroupId === change.subgroupId,
      );
    }
    const updated = await this.prisma.lessonChange.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: reason.trim(),
      },
    });
    return { ...updated, date: isoDay(updated.date) };
  }
}
