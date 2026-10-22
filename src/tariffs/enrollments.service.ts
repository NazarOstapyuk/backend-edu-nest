import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdjustmentType,
  AuditAction,
  BillingMode,
  Prisma,
  TariffUnit,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { scopeIds } from '../access/access-calc';
import { assertChildInScope } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { money } from '../finance/finance-calc';
import { priceOn } from './billing-engine';
import { isoDay, kyivToday, overlaps, toDay } from './dates';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { EndEnrollmentDto } from './dto/end-enrollment.dto';
import { enrollmentInclude, toEnrollmentView } from './enrollment-view';

const ENROLLMENT_FIELDS = [
  'childId',
  'tariffId',
  'startDate',
  'endDate',
  'billingMode',
] as const;

const enrollmentAudit = (enrollment: {
  childId: string;
  tariffId: string;
  startDate: Date;
  endDate: Date | null;
  billingMode: BillingMode | null;
}) => ({
  childId: enrollment.childId,
  tariffId: enrollment.tariffId,
  startDate: enrollment.startDate,
  endDate: enrollment.endDate,
  billingMode: enrollment.billingMode,
});

const adjustmentLine = (adjustment: {
  type: AdjustmentType;
  value: Prisma.Decimal | null;
  startDate: Date;
  endDate: Date | null;
}) =>
  `${adjustment.type} ${adjustment.value?.toFixed(2) ?? ''} ${isoDay(adjustment.startDate)}–${adjustment.endDate ? isoDay(adjustment.endDate) : ''}`;

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
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async assertChild(childId: string, user: AuthenticatedUser) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      include: { group: { select: { institutionId: true } } },
    });
    if (!child) throw new NotFoundException('Child not found');
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    return child;
  }

  private async getEnrollment(id: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id },
      include: enrollmentInclude,
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async childIdOf(enrollmentId: string, user: AuthenticatedUser) {
    const enrollment = await this.getEnrollment(enrollmentId);
    await assertChildInScope(
      this.prisma,
      scopeIds(user),
      enrollment.childId,
      'Enrollment not found',
    );
    return enrollment.childId;
  }

  async listForChild(
    childId: string,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    await this.assertChild(childId, user);
    return this.loadForChild(childId, today);
  }

  private async loadForChild(childId: string, today: Date = kyivToday()) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { childId },
      include: enrollmentInclude,
      orderBy: { startDate: 'desc' },
    });
    return enrollments.map((e) => toEnrollmentView(e, today));
  }

  async create(
    childId: string,
    dto: CreateEnrollmentDto,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const child = await this.assertChild(childId, user);
    const tariff = await this.prisma.tariff.findUnique({
      where: { id: dto.tariffId },
      include: { prices: true },
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (
      tariff.institutionId !== null &&
      tariff.institutionId !== (child.group?.institutionId ?? null)
    )
      throw new BadRequestException('Tariff belongs to another institution');
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

    const created = await this.prisma.enrollment.create({
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
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'enrollments',
      entityId: created.id,
      action: AuditAction.create,
      before: null,
      after: enrollmentAudit(created),
      fields: ENROLLMENT_FIELDS,
    });
    return this.loadForChild(childId);
  }

  async end(id: string, dto: EndEnrollmentDto, user: AuthenticatedUser) {
    const enrollment = await this.getEnrollment(id);
    await assertChildInScope(
      this.prisma,
      scopeIds(user),
      enrollment.childId,
      'Enrollment not found',
    );
    const endDate = toDay(dto.endDate);
    if (endDate.getTime() < enrollment.startDate.getTime()) {
      throw new BadRequestException('End date must not be before start date');
    }
    const others = await this.prisma.enrollment.findMany({
      where: {
        childId: enrollment.childId,
        tariffId: enrollment.tariffId,
        id: { not: id },
      },
    });
    if (
      others.some((o) =>
        overlaps(enrollment.startDate, endDate, o.startDate, o.endDate),
      )
    ) {
      throw new BadRequestException(
        'Enrollment overlaps an existing enrollment on this tariff',
      );
    }
    const updated = await this.prisma.enrollment.update({
      where: { id },
      data: { endDate },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'enrollments',
      entityId: id,
      action: AuditAction.update,
      before: enrollmentAudit(enrollment),
      after: enrollmentAudit(updated),
      fields: ENROLLMENT_FIELDS,
    });
    return this.loadForChild(enrollment.childId);
  }

  async addAdjustment(
    enrollmentId: string,
    dto: CreateAdjustmentDto,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const enrollment = await this.getEnrollment(enrollmentId);
    await assertChildInScope(
      this.prisma,
      scopeIds(user),
      enrollment.childId,
      'Enrollment not found',
    );
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

    const created = await this.prisma.enrollmentAdjustment.create({
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
    const active = enrollment.adjustments.filter((a) => !a.voidedAt);
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'enrollments',
      entityId: enrollmentId,
      action: AuditAction.update,
      before: { adjustments: active.map(adjustmentLine) },
      after: { adjustments: [...active, created].map(adjustmentLine) },
      fields: ['adjustments'],
    });
    return this.loadForChild(enrollment.childId);
  }

  async voidAdjustment(
    id: string,
    reason: string,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const adjustment = await this.prisma.enrollmentAdjustment.findUnique({
      where: { id },
      include: { enrollment: { select: { childId: true } } },
    });
    if (!adjustment) throw new NotFoundException('Adjustment not found');
    await assertChildInScope(
      this.prisma,
      scopeIds(user),
      adjustment.enrollment.childId,
      'Adjustment not found',
    );
    if (adjustment.voidedAt)
      throw new BadRequestException('Adjustment is voided');

    const active = await this.prisma.enrollmentAdjustment.findMany({
      where: { enrollmentId: adjustment.enrollmentId, voidedAt: null },
    });
    await this.prisma.enrollmentAdjustment.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'enrollments',
      entityId: adjustment.enrollmentId,
      action: AuditAction.void,
      before: { adjustments: active.map(adjustmentLine) },
      after: {
        adjustments: active.filter((a) => a.id !== id).map(adjustmentLine),
      },
      fields: ['adjustments'],
    });
    return this.loadForChild(adjustment.enrollment.childId);
  }
}
