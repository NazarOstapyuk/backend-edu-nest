import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@Injectable()
export class AttendancesService {
  constructor(private prisma: PrismaService) {}

  async create(subscriptionId: string, dto: CreateAttendanceDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.status !== SubscriptionStatus.active) {
      throw new ForbiddenException('Cannot mark attendance on a non-active subscription');
    }

    const newRemaining = sub.remainingSessions - 1;

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.create({
        data: { subscriptionId, note: dto.note, date: dto.date ? new Date(dto.date) : undefined },
      });

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          remainingSessions: newRemaining,
          status: newRemaining === 0 ? SubscriptionStatus.finished : SubscriptionStatus.active,
        },
      });

      return attendance;
    });
  }

  async findBySubscription(subscriptionId: string) {
    return this.prisma.attendance.findMany({
      where: { subscriptionId },
      orderBy: { date: 'desc' },
    });
  }

  async delete(subscriptionId: string, attendanceId: string) {
    const attendance = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!attendance) throw new NotFoundException('Attendance not found');
    if (attendance.subscriptionId !== subscriptionId) {
      throw new BadRequestException('Attendance does not belong to this subscription');
    }

    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException('Subscription not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.attendance.delete({ where: { id: attendanceId } });
      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          remainingSessions: sub.remainingSessions + 1,
          status: sub.status === SubscriptionStatus.finished ? SubscriptionStatus.active : sub.status,
        },
      });
    });
  }
}
