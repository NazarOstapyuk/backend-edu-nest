import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeSource,
  PermissionArea,
  PermissionLevel,
  Prisma,
} from '@prisma/client';
import { hasPermission } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { voidChargeInTx } from '../finance/void-charge';
import { priceOn } from '../tariffs/billing-engine';
import { kyivToday, uaDay } from '../tariffs/dates';
import { assertGroupAccess, parseDay } from './access';
import { personSelect } from './class-views';
import {
  effectiveExpiry,
  packageRemaining,
  pickPackage,
  shouldConsume,
} from './consumption';
import { MarkLessonDto } from './dto/mark-lesson.dto';

const packageConsumeInclude = {
  extensions: { select: { newExpiresAt: true, createdAt: true } },
  usages: { select: { voidedAt: true } },
} satisfies Prisma.PackageInclude;

const markGroupInclude = {
  direction: true,
  teachers: { select: { id: true } },
  singleTariff: { include: { prices: true } },
} satisfies Prisma.ClassGroupInclude;

type MarkGroup = Prisma.ClassGroupGetPayload<{
  include: typeof markGroupInclude;
}>;
type ActiveAttendance = Prisma.LessonAttendanceGetPayload<{
  include: { usage: true };
}>;

const memberOnDate = (classGroupId: string, date: Date) => ({
  classGroupId,
  startDate: { lte: date },
  OR: [{ endDate: null }, { endDate: { gte: date } }],
});

@Injectable()
export class LessonsService {
  constructor(private prisma: PrismaService) {}

  async getRoster(groupId: string, dateValue: string, user: AuthenticatedUser) {
    const group = await this.prisma.classGroup.findUnique({
      where: { id: groupId },
      include: markGroupInclude,
    });
    if (!group) throw new NotFoundException('Class group not found');
    assertGroupAccess(group, user);
    const date = parseDay(dateValue);

    const lesson = await this.prisma.lesson.findUnique({
      where: { classGroupId_date: { classGroupId: groupId, date } },
      include: {
        conductedBy: personSelect,
        attendances: {
          where: { voidedAt: null },
          include: { child: personSelect },
        },
      },
    });
    const members = await this.prisma.classGroupMember.findMany({
      where: memberOnDate(groupId, date),
      include: { child: personSelect },
    });

    const children = new Map<
      string,
      { id: string; firstName: string; lastName: string }
    >();
    members.forEach((m) => children.set(m.childId, m.child));
    lesson?.attendances.forEach((a) => children.set(a.childId, a.child));
    const memberIds = new Set(members.map((m) => m.childId));

    const packages = await this.prisma.package.findMany({
      where: {
        childId: { in: [...children.keys()] },
        directionId: group.directionId,
      },
      include: packageConsumeInclude,
    });

    const rows = [...children.values()]
      .sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(
          `${b.lastName} ${b.firstName}`,
          'uk',
        ),
      )
      .map((child) => {
        const attendance =
          lesson?.attendances.find((a) => a.childId === child.id) ?? null;
        const pkg = pickPackage(
          packages.filter((p) => p.childId === child.id),
          date,
        );
        return {
          child,
          isMember: memberIds.has(child.id),
          attendance: attendance
            ? {
                id: attendance.id,
                status: attendance.status,
                isGuest: attendance.isGuest,
              }
            : null,
          packageInfo: pkg
            ? {
                packageId: pkg.id,
                remaining: packageRemaining(pkg),
                total: pkg.sessionsTotal,
                expiresAt: effectiveExpiry(pkg),
              }
            : null,
        };
      });

    return {
      group: {
        id: group.id,
        name: group.name,
        direction: {
          id: group.direction.id,
          name: group.direction.name,
          missedRule: group.direction.missedRule,
        },
      },
      date,
      lessonId: lesson?.id ?? null,
      conductedBy: lesson?.conductedBy ?? null,
      hasSingleTariff:
        !!group.singleTariff &&
        priceOn(group.singleTariff.prices, date) !== null,
      rows,
    };
  }

  async mark(
    groupId: string,
    dateValue: string,
    dto: MarkLessonDto,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const group = await this.prisma.classGroup.findUnique({
      where: { id: groupId },
      include: markGroupInclude,
    });
    if (!group) throw new NotFoundException('Class group not found');
    assertGroupAccess(
      group,
      user,
      PermissionArea.classes,
      PermissionLevel.edit,
    );
    const date = parseDay(dateValue);
    if (date.getTime() > today.getTime())
      throw new BadRequestException('Lesson date must not be in the future');
    const ids = dto.marks.map((m) => m.childId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('Duplicate child in marks');
    const found = await this.prisma.child.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length)
      throw new NotFoundException('Child not found');

    const isTeacher = !hasPermission(
      user,
      PermissionArea.classes,
      PermissionLevel.edit,
    );
    const isLate = date.getTime() < today.getTime();
    const reason = dto.reason?.trim() ?? '';

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "Lesson" ("id", "classGroupId", "date", "conductedById") VALUES (${randomUUID()}, ${groupId}, ${date}::date, ${user.id}) ON CONFLICT ("classGroupId", "date") DO NOTHING`;
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Lesson" WHERE "classGroupId" = ${groupId} AND "date" = ${date}::date FOR UPDATE`;
      const lesson = { id: locked[0].id };
      const active = await tx.lessonAttendance.findMany({
        where: { lessonId: lesson.id, voidedAt: null },
        include: { usage: true },
      });
      const members = await tx.classGroupMember.findMany({
        where: memberOnDate(groupId, date),
      });
      const memberIds = new Set(members.map((m) => m.childId));

      for (const item of dto.marks) {
        const existing = active.find((a) => a.childId === item.childId);
        if (existing && existing.status === item.status) continue;
        const isMember = memberIds.has(item.childId);
        if (!existing && !isMember && !item.isGuest) {
          throw new BadRequestException(
            'Child is not a member of this group on this date',
          );
        }
        if (existing) {
          if (isTeacher && isLate)
            throw new ForbiddenException(
              'Only the lesson day can be corrected by a teacher',
            );
          if (!isTeacher && isLate && !reason)
            throw new BadRequestException(
              'Reason is required for a late correction',
            );
          await this.reverse(
            tx,
            existing,
            reason || 'Виправлення відмітки',
            user.id,
          );
        }
        const attendance = await tx.lessonAttendance.create({
          data: {
            lessonId: lesson.id,
            childId: item.childId,
            status: item.status,
            isGuest: existing ? existing.isGuest : !isMember,
            markedById: user.id,
          },
        });
        if (shouldConsume(group.direction.missedRule, item.status)) {
          await this.consume(
            tx,
            group,
            attendance.id,
            item.childId,
            date,
            user.id,
          );
        }
      }
      return { lessonId: lesson.id };
    });
  }

  private async reverse(
    tx: Prisma.TransactionClient,
    attendance: ActiveAttendance,
    reason: string,
    userId: string,
  ) {
    const data = {
      voidedAt: new Date(),
      voidedById: userId,
      voidReason: reason,
    };
    if (attendance.usage && !attendance.usage.voidedAt) {
      if (attendance.usage.chargeId) {
        const charge = await tx.charge.findUnique({
          where: { id: attendance.usage.chargeId },
        });
        if (charge && !charge.voidedAt)
          await voidChargeInTx(tx, attendance.usage.chargeId, reason, userId);
      }
      await tx.sessionUsage.update({
        where: { id: attendance.usage.id },
        data,
      });
    }
    await tx.lessonAttendance.update({ where: { id: attendance.id }, data });
  }

  private async consume(
    tx: Prisma.TransactionClient,
    group: MarkGroup,
    attendanceId: string,
    childId: string,
    date: Date,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "Package" WHERE "childId" = ${childId} AND "directionId" = ${group.directionId} ORDER BY id FOR UPDATE`;
    const packages = await tx.package.findMany({
      where: { childId, directionId: group.directionId },
      include: packageConsumeInclude,
    });
    const pkg = pickPackage(packages, date);
    if (pkg) {
      await tx.sessionUsage.create({
        data: { attendanceId, packageId: pkg.id },
      });
      return;
    }

    const price = group.singleTariff
      ? priceOn(group.singleTariff.prices, date)
      : null;
    if (!group.singleTariff || !price)
      throw new BadRequestException('No price for this date');
    const charge = await tx.charge.create({
      data: {
        childId,
        category: group.singleTariff.category,
        amount: price,
        description: `${group.name}, ${uaDay(date)}: разове заняття`,
        periodStart: date,
        periodEnd: date,
        sourceType: ChargeSource.extra_session,
        sourceId: attendanceId,
        createdById: userId,
      },
    });
    await tx.sessionUsage.create({
      data: { attendanceId, chargeId: charge.id },
    });
  }
}
