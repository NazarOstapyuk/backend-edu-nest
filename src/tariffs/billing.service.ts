import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ChargeSource, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { scopeKind } from '../access/access-calc';
import {
  OUTSIDE_SCOPE,
  assertChildInScope,
  childScopeWhere,
} from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { voidChargeInTx } from '../finance/void-charge';
import {
  PeriodBill,
  computePeriod,
  dueBills,
  findPeriod,
} from './billing-engine';
import { kyivToday } from './dates';
import {
  LoadedEnrollment,
  enrollmentInclude,
  toEngineInput,
} from './enrollment-view';

const LEAD_KEY = 'chargeLeadDays';
const DEFAULT_LEAD_DAYS = 5;

export interface BillingProblem {
  enrollmentId: string;
  childId: string;
  childName: string;
  tariffName: string;
  periodStart: Date;
  reason: 'no_price';
}

export interface BillResult {
  created: number;
  skippedZero: number;
  alreadyBilled: number;
  problems: BillingProblem[];
  failed: { enrollmentId: string; message: string }[];
}

const emptyResult = (): BillResult => ({
  created: 0,
  skippedZero: 0,
  alreadyBilled: 0,
  problems: [],
  failed: [],
});

const merge = (target: BillResult, source: BillResult) => {
  target.created += source.created;
  target.skippedZero += source.skippedZero;
  target.alreadyBilled += source.alreadyBilled;
  target.problems.push(...source.problems);
  target.failed.push(...source.failed);
};

export const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const toProblem = (e: LoadedEnrollment, periodStart: Date): BillingProblem => ({
  enrollmentId: e.id,
  childId: e.childId,
  childName: `${e.child.lastName} ${e.child.firstName}`,
  tariffName: e.tariff.name,
  periodStart,
  reason: 'no_price',
});

const chargeData = (e: LoadedEnrollment, bill: PeriodBill, userId: string) => ({
  childId: e.childId,
  category: e.tariff.category,
  amount: bill.amount,
  description: bill.description,
  periodStart: bill.periodStart,
  periodEnd: bill.periodEnd,
  sourceType: ChargeSource.monthly,
  sourceId: e.id,
  createdById: userId,
});

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getLeadDays(): Promise<number> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: LEAD_KEY },
    });
    return setting ? Number(setting.value) : DEFAULT_LEAD_DAYS;
  }

  async setLeadDays(value: number, userId: string) {
    if (!Number.isInteger(value) || value < 0 || value > 60) {
      throw new BadRequestException('Lead days must be between 0 and 60');
    }
    const previous = await this.getLeadDays();
    await this.prisma.appSetting.upsert({
      where: { key: LEAD_KEY },
      create: { key: LEAD_KEY, value: String(value) },
      update: { value: String(value) },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'settings',
      entityId: 'chargeLeadDays',
      action: AuditAction.update,
      before: { value: String(previous) },
      after: { value: String(value) },
      fields: ['value'],
    });
    return { chargeLeadDays: value };
  }

  async billEnrollment(
    enrollmentId: string,
    user: AuthenticatedUser,
    today: Date = kyivToday(),
  ) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: enrollmentInclude,
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    await assertChildInScope(
      this.prisma,
      scopeKind(user),
      enrollment.childId,
      'Enrollment not found',
    );
    return this.billLoaded(
      enrollment,
      user.id,
      today,
      await this.getLeadDays(),
    );
  }

  async runForUser(user: AuthenticatedUser) {
    if (scopeKind(user)) throw new ForbiddenException(OUTSIDE_SCOPE);
    return this.runAll(user.id);
  }

  async runAll(userId: string, today: Date = kyivToday()) {
    const leadDays = await this.getLeadDays();
    const enrollments = await this.prisma.enrollment.findMany({
      include: enrollmentInclude,
    });
    const total = emptyResult();
    for (const enrollment of enrollments) {
      try {
        merge(
          total,
          await this.billLoaded(enrollment, userId, today, leadDays),
        );
      } catch (error) {
        total.failed.push({
          enrollmentId: enrollment.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return total;
  }

  async problems(user: AuthenticatedUser, today: Date = kyivToday()) {
    const leadDays = await this.getLeadDays();
    const enrollments = await this.prisma.enrollment.findMany({
      where: { child: childScopeWhere(scopeKind(user)) },
      include: enrollmentInclude,
    });
    return enrollments.flatMap((e) =>
      dueBills(
        toEngineInput(e),
        e.billedPeriods.map((p) => p.periodStart),
        today,
        leadDays,
      ).flatMap((r) => (r.ok ? [] : [toProblem(e, r.periodStart)])),
    );
  }

  async recalculate(
    billedPeriodId: string,
    reason: string,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const period = await this.prisma.billedPeriod.findUnique({
      where: { id: billedPeriodId },
      include: { enrollment: { include: enrollmentInclude } },
    });
    if (!period) throw new NotFoundException('Billed period not found');
    await assertChildInScope(
      this.prisma,
      scopeKind(user),
      period.enrollment.childId,
      'Billed period not found',
    );

    const enrollment = period.enrollment;
    const input = toEngineInput(enrollment);
    const range = findPeriod(input, period.periodStart);
    let bill: PeriodBill | null = null;
    if (range) {
      const result = computePeriod(input, range);
      if (!result.ok) throw new BadRequestException('No price for this date');
      bill = result.bill;
    } else if (
      !enrollment.endDate ||
      period.periodStart.getTime() <= enrollment.endDate.getTime()
    ) {
      throw new BadRequestException(
        'Billed period no longer matches the enrollment schedule',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BilledPeriod" WHERE id = ${billedPeriodId} FOR UPDATE`;
      const current = await tx.billedPeriod.findUnique({
        where: { id: billedPeriodId },
      });
      if (!current) throw new NotFoundException('Billed period not found');
      if (current.chargeId) {
        const old = await tx.charge.findUnique({
          where: { id: current.chargeId },
        });
        if (old && !old.voidedAt)
          await voidChargeInTx(tx, current.chargeId, reason, userId);
      }
      const charge =
        bill && !bill.zero
          ? await tx.charge.create({
              data: chargeData(enrollment, bill, userId),
            })
          : null;
      await tx.billedPeriod.update({
        where: { id: billedPeriodId },
        data: {
          periodEnd: bill ? bill.periodEnd : period.periodEnd,
          amount: bill ? bill.amount : new Prisma.Decimal(0),
          chargeId: charge ? charge.id : null,
          note: bill ? bill.note : 'after end date',
        },
      });
    });

    return { childId: enrollment.childId };
  }

  private async billLoaded(
    enrollment: LoadedEnrollment,
    userId: string,
    today: Date,
    leadDays: number,
  ): Promise<BillResult> {
    const result = emptyResult();
    const due = dueBills(
      toEngineInput(enrollment),
      enrollment.billedPeriods.map((p) => p.periodStart),
      today,
      leadDays,
    );

    for (const item of due) {
      if (!item.ok) {
        result.problems.push(toProblem(enrollment, item.periodStart));
        continue;
      }
      const bill = item.bill;
      try {
        await this.prisma.$transaction(async (tx) => {
          const charge = bill.zero
            ? null
            : await tx.charge.create({
                data: chargeData(enrollment, bill, userId),
              });
          await tx.billedPeriod.create({
            data: {
              enrollmentId: enrollment.id,
              periodStart: bill.periodStart,
              periodEnd: bill.periodEnd,
              amount: bill.amount,
              chargeId: charge ? charge.id : null,
              note: bill.note,
            },
          });
        });
        if (bill.zero) result.skippedZero += 1;
        else result.created += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        result.alreadyBilled += 1;
      }
    }

    return result;
  }
}
