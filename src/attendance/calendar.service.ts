import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CalendarScope, GroupKind } from '@prisma/client';
import { scopeKind } from '../access/access-calc';
import { OUTSIDE_SCOPE } from '../access/scope';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { CreateCalendarDayDto } from './dto/create-calendar-day.dto';

const withGroup = { group: { select: { id: true, name: true } } } as const;

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  entriesBetween(from: Date, to: Date) {
    return this.prisma.calendarDay.findMany({
      where: { voidedAt: null, startDate: { lte: to }, endDate: { gte: from } },
    });
  }

  private entryInScope(
    kind: GroupKind | null,
    entry: { scope: CalendarScope; group?: { kind: GroupKind } | null },
  ) {
    if (!kind) return true;
    if (entry.scope === CalendarScope.group) return entry.group?.kind === kind;
    return entry.scope === CalendarScope[kind];
  }

  async list(
    fromValue: string,
    toValue: string,
    groupId: string | undefined,
    user: AuthenticatedUser,
  ) {
    const kind = scopeKind(user);
    const from = parseDay(fromValue);
    const to = parseDay(toValue);
    if (to.getTime() < from.getTime())
      throw new BadRequestException('Invalid period');
    let scopeFilter = {};
    if (groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, kind: true },
      });
      if (!group || (kind && group.kind !== kind))
        throw new NotFoundException('Group not found');
      scopeFilter = {
        OR: [
          { scope: CalendarScope.all },
          { scope: CalendarScope[group.kind] },
          { scope: CalendarScope.group, groupId },
        ],
      };
    } else if (kind) {
      scopeFilter = {
        OR: [
          { scope: CalendarScope.all },
          { scope: CalendarScope[kind] },
          { scope: CalendarScope.group, group: { kind } },
        ],
      };
    }
    return this.prisma.calendarDay.findMany({
      where: {
        voidedAt: null,
        startDate: { lte: to },
        endDate: { gte: from },
        ...scopeFilter,
      },
      include: withGroup,
      orderBy: { startDate: 'asc' },
    });
  }

  async create(dto: CreateCalendarDayDto, user: AuthenticatedUser) {
    const startDate = parseDay(dto.startDate);
    const endDate = dto.endDate ? parseDay(dto.endDate) : startDate;
    if (endDate.getTime() < startDate.getTime())
      throw new BadRequestException('Invalid period');
    const isGroup = dto.scope === CalendarScope.group;
    if (isGroup !== Boolean(dto.groupId))
      throw new BadRequestException('Group is required for group scope');
    const kind = scopeKind(user);
    let groupKind: GroupKind | undefined;
    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({
        where: { id: dto.groupId },
        select: { id: true, kind: true },
      });
      if (!group) throw new NotFoundException('Group not found');
      groupKind = group.kind;
    }
    if (
      !this.entryInScope(kind, {
        scope: dto.scope,
        group: groupKind ? { kind: groupKind } : null,
      })
    )
      throw new ForbiddenException(OUTSIDE_SCOPE);
    return this.prisma.calendarDay.create({
      data: {
        startDate,
        endDate,
        type: dto.type,
        scope: dto.scope,
        groupId: dto.groupId ?? null,
        title: dto.title.trim(),
        createdById: user.id,
      },
      include: withGroup,
    });
  }

  async void(id: string, reason: string, user: AuthenticatedUser) {
    const entry = await this.prisma.calendarDay.findUnique({
      where: { id },
      include: { group: { select: { kind: true } } },
    });
    if (!entry) throw new NotFoundException('Calendar entry not found');
    if (!this.entryInScope(scopeKind(user), entry))
      throw new ForbiddenException(OUTSIDE_SCOPE);
    if (entry.voidedAt)
      throw new BadRequestException('Calendar entry is voided');
    return this.prisma.calendarDay.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedById: user.id,
        voidReason: reason.trim(),
      },
      include: withGroup,
    });
  }
}
