import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdjustmentType, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { money } from '../finance/finance-calc';
import { priceOn } from './billing-engine';
import { kyivToday, overlaps, toDay } from './dates';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { EndEnrollmentDto } from './dto/end-enrollment.dto';
import { enrollmentInclude, toEnrollmentView } from './enrollment-view';

const validValue = (type: AdjustmentType, value: string | undefined) => {
  if (type === AdjustmentType.pause) return value === undefined;
  if (value === undefined) return false;
  const amount = money(value);
  if (type === AdjustmentType.discount_percent)
    return amount.gt(0) && amount.lte(100);
  return amount.gt(0);
};

@Injectable()
export class EnrollmentsService {
  constructor(private prisma: PrismaService) {}

  private async assertChild(childId: string) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
  }

  private async getEnrollment(id: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id },
      include: enrollmentInclude,
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async childIdOf(enrollmentId: string) {
    return (await this.getEnrollment(enrollmentId)).childId;
  }

  async listForChild(childId: string, today: Date = kyivToday()) {
    await this.assertChild(childId);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { childId },
      include: enrollmentInclude,
      orderBy: { startDate: 'desc' },
    });
    return enrollments.map((e) => toEnrollmentView(e, today));
  }

  async create(childId: string, dto: CreateEnrollmentDto, userId: string) {
    await this.assertChild(childId);
    const tariff = await this.prisma.tariff.findUnique({
      where: { id: dto.tariffId },
      include: { prices: true },
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (!tariff.isActive) throw new BadRequestException('Tariff is not active');
    if (tariff.unit !== TariffUnit.month)
      throw new BadRequestException('Tariff unit must be month');

    const startDate = toDay(dto.startDate);
    const endDate = dto.endDate ? toDay(dto.endDate) : null;
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('End date must not be before start date');
    }
    if (!priceOn(tariff.prices, startDate))
      throw new BadRequestException('No price for this date');

    const existing = await this.prisma.enrollment.findMany({
      where: { childId, tariffId: dto.tariffId },
    });
    if (
      existing.some((e) => overlaps(startDate, endDate, e.startDate, e.endDate))
    ) {
      throw new BadRequestException(
        'Enrollment overlaps an existing enrollment on this tariff',
      );
    }

    await this.prisma.enrollment.create({
      data: {
        childId,
        tariffId: dto.tariffId,
        startDate,
        endDate,
        billingMode: dto.billingMode ?? null,
        note: dto.note,
        createdById: userId,
      },
    });
    return this.listForChild(childId);
  }

  async end(id: string, dto: EndEnrollmentDto) {
    const enrollment = await this.getEnrollment(id);
    const endDate = toDay(dto.endDate);
    if (endDate.getTime() < enrollment.startDate.getTime()) {
      throw new BadRequestException('End date must not be before start date');
    }
    await this.prisma.enrollment.update({ where: { id }, data: { endDate } });
    return this.listForChild(enrollment.childId);
  }

  async addAdjustment(
    enrollmentId: string,
    dto: CreateAdjustmentDto,
    userId: string,
  ) {
    const enrollment = await this.getEnrollment(enrollmentId);
    const startDate = toDay(dto.startDate);
    const endDate = dto.endDate ? toDay(dto.endDate) : null;
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('End date must not be before start date');
    }
    if (!validValue(dto.type, dto.value))
      throw new BadRequestException('Invalid adjustment value');

    const sameType = await this.prisma.enrollmentAdjustment.findMany({
      where: { enrollmentId, type: dto.type, voidedAt: null },
    });
    if (
      sameType.some((a) => overlaps(startDate, endDate, a.startDate, a.endDate))
    ) {
      throw new BadRequestException(
        'Adjustment overlaps an existing adjustment of the same type',
      );
    }

    await this.prisma.enrollmentAdjustment.create({
      data: {
        enrollmentId,
        type: dto.type,
        value: dto.value,
        startDate,
        endDate,
        reason: dto.reason,
        createdById: userId,
      },
    });
    return this.listForChild(enrollment.childId);
  }

  async voidAdjustment(id: string, reason: string, userId: string) {
    const adjustment = await this.prisma.enrollmentAdjustment.findUnique({
      where: { id },
      include: { enrollment: { select: { childId: true } } },
    });
    if (!adjustment) throw new NotFoundException('Adjustment not found');
    if (adjustment.voidedAt)
      throw new BadRequestException('Adjustment is voided');

    await this.prisma.enrollmentAdjustment.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
    });
    return this.listForChild(adjustment.enrollment.childId);
  }
}
