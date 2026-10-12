import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NoticeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { assertOwnChild } from '../common/ownership';
import { parseDay } from '../classes/access';
import { dayCount, isoDay, kyivToday } from '../tariffs/dates';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { ListNoticesQueryDto } from './dto/list-notices-query.dto';

const MAX_NOTICE_DAYS = 60;
const person = {
  select: { id: true, firstName: true, lastName: true },
} as const;

const parentSelect = {
  id: true,
  startDate: true,
  endDate: true,
  comment: true,
  status: true,
  decisionReason: true,
  createdAt: true,
  reason: { select: { id: true, name: true } },
} as const;

const adminSelect = {
  ...parentSelect,
  decidedAt: true,
  child: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      group: { select: { id: true, name: true } },
    },
  },
  createdBy: person,
  decidedBy: person,
} as const;

const withDays = <T extends { startDate: Date; endDate: Date }>(notice: T) => ({
  ...notice,
  startDate: isoDay(notice.startDate),
  endDate: isoDay(notice.endDate),
});

@Injectable()
export class NoticesService {
  constructor(private prisma: PrismaService) {}

  async list(query: ListNoticesQueryDto) {
    const notices = await this.prisma.absenceNotice.findMany({
      where: {
        status: query.status,
        child: query.groupId ? { groupId: query.groupId } : undefined,
      },
      select: adminSelect,
      orderBy: { createdAt: 'desc' },
    });
    return notices.map(withDays);
  }

  approve(id: string, user: AuthenticatedUser) {
    return this.decide(
      id,
      NoticeStatus.pending,
      NoticeStatus.approved,
      user,
      null,
    );
  }

  reject(id: string, reason: string, user: AuthenticatedUser) {
    return this.decide(
      id,
      NoticeStatus.pending,
      NoticeStatus.rejected,
      user,
      reason.trim(),
    );
  }

  cancel(id: string, reason: string, user: AuthenticatedUser) {
    return this.decide(
      id,
      NoticeStatus.approved,
      NoticeStatus.cancelled,
      user,
      reason.trim(),
    );
  }

  private async decide(
    id: string,
    from: NoticeStatus,
    to: NoticeStatus,
    user: AuthenticatedUser,
    reason: string | null,
  ) {
    const exists = await this.prisma.absenceNotice.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Notice not found');
    const { count } = await this.prisma.absenceNotice.updateMany({
      where: { id, status: from },
      data: {
        status: to,
        decidedById: user.id,
        decidedAt: new Date(),
        decisionReason: reason,
      },
    });
    if (count === 0) throw new BadRequestException('Notice already decided');
    const notice = await this.prisma.absenceNotice.findUnique({
      where: { id },
      select: adminSelect,
    });
    return notice && withDays(notice);
  }

  async listForParent(parentId: string, childId: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const notices = await this.prisma.absenceNotice.findMany({
      where: { childId },
      select: parentSelect,
      orderBy: { createdAt: 'desc' },
    });
    return notices.map(withDays);
  }

  async createForParent(
    parentId: string,
    childId: string,
    dto: CreateNoticeDto,
    today: Date = kyivToday(),
  ) {
    await assertOwnChild(this.prisma, parentId, childId);
    const startDate = parseDay(dto.startDate);
    const endDate = parseDay(dto.endDate);
    if (
      startDate.getTime() < today.getTime() ||
      endDate.getTime() < startDate.getTime()
    )
      throw new BadRequestException('Invalid period');
    if (dayCount(startDate, endDate) > MAX_NOTICE_DAYS)
      throw new BadRequestException('Notice period is too long');
    const reason = await this.prisma.absenceReason.findFirst({
      where: { id: dto.reasonId, active: true },
      select: { id: true },
    });
    if (!reason) throw new BadRequestException('Absence reason not found');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${childId} FOR UPDATE`;
      const overlap = await tx.absenceNotice.findFirst({
        where: {
          childId,
          status: { in: [NoticeStatus.pending, NoticeStatus.approved] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });
      if (overlap)
        throw new BadRequestException('Notice overlaps an existing notice');
      const notice = await tx.absenceNotice.create({
        data: {
          childId,
          startDate,
          endDate,
          reasonId: dto.reasonId,
          comment: dto.comment?.trim() || null,
          createdById: parentId,
        },
        select: parentSelect,
      });
      return withDays(notice);
    });
  }

  async cancelForParent(parentId: string, childId: string, noticeId: string) {
    await assertOwnChild(this.prisma, parentId, childId);
    const { count } = await this.prisma.absenceNotice.updateMany({
      where: { id: noticeId, childId, status: NoticeStatus.pending },
      data: {
        status: NoticeStatus.cancelled,
        decidedById: parentId,
        decidedAt: new Date(),
      },
    });
    if (count === 0) {
      const exists = await this.prisma.absenceNotice.findFirst({
        where: { id: noticeId, childId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Notice not found');
      throw new BadRequestException('Notice already decided');
    }
    const notice = await this.prisma.absenceNotice.findUnique({
      where: { id: noticeId },
      select: parentSelect,
    });
    return notice && withDays(notice);
  }
}
