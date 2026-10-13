import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollLineType, PayrollStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseMonth } from '../attendance/register-calc';
import { parseDay } from '../classes/access';
import { firstDayOfMonth, kyivToday, lastDayOfMonth } from '../tariffs/dates';
import { positiveAmount } from './amount';
import { PayrollAdjustmentDto, PayrollPaymentDto } from './dto/payroll.dto';
import { PayrollBuilder, toSummary } from './payroll-builder.service';

const ZERO = new Prisma.Decimal(0);

type Tx = Prisma.TransactionClient;

const assertDraft = (status: PayrollStatus) => {
  if (status === PayrollStatus.approved)
    throw new BadRequestException('Payroll is approved');
};

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private builder: PayrollBuilder,
  ) {}

  async list(monthValue: string) {
    const { from, to } = parseMonth(monthValue);
    const teachers = await this.prisma.user.findMany({
      where: {
        role: Role.teacher,
        OR: [
          {
            salaryTerms: {
              some: {
                validFrom: { lte: to },
                OR: [{ validTo: null }, { validTo: { gte: from } }],
              },
            },
          },
          { payrollSheets: { some: { month: from } } },
        ],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const rows: ReturnType<typeof toSummary>[] = [];
    for (const teacher of teachers) {
      rows.push(
        toSummary(await this.builder.detail(this.prisma, teacher, from, true)),
      );
    }
    const total = (key: 'accrued' | 'paid' | 'balance') =>
      rows
        .reduce((sum, row) => sum.add(new Prisma.Decimal(row[key])), ZERO)
        .toFixed(2);
    return {
      month: monthValue,
      rows,
      totals: {
        accrued: total('accrued'),
        paid: total('paid'),
        balance: total('balance'),
      },
    };
  }

  async detail(teacherId: string, monthValue: string) {
    const { from } = parseMonth(monthValue);
    const teacher = await this.builder.teacher(this.prisma, teacherId);
    return this.builder.detail(this.prisma, teacher, from, true);
  }

  async myYear(user: AuthenticatedUser, yearValue: string) {
    if (!/^\d{4}$/.test(yearValue ?? ''))
      throw new BadRequestException('Invalid year');
    const year = Number(yearValue);
    const teacher = await this.builder.teacher(this.prisma, user.id);
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31));
    const current = firstDayOfMonth(kyivToday());
    const [terms, sheets] = await Promise.all([
      this.prisma.salaryTerms.findMany({
        where: {
          teacherId: teacher.id,
          validFrom: { lte: to },
          OR: [{ validTo: null }, { validTo: { gte: from } }],
        },
        select: { validFrom: true, validTo: true },
      }),
      this.prisma.payrollSheet.findMany({
        where: { teacherId: teacher.id, month: { gte: from, lte: to } },
        select: { month: true },
      }),
    ]);
    const months: {
      month: string;
      status: string;
      accrued: string;
      paid: string;
      balance: string;
    }[] = [];
    for (let index = 0; index < 12; index++) {
      const start = new Date(Date.UTC(year, index, 1));
      if (start.getTime() > current.getTime()) break;
      const end = lastDayOfMonth(start);
      const relevant =
        sheets.some((s) => s.month.getTime() === start.getTime()) ||
        terms.some(
          (t) =>
            t.validFrom.getTime() <= end.getTime() &&
            (t.validTo === null || t.validTo.getTime() >= start.getTime()),
        );
      if (!relevant) continue;
      const detail = await this.builder.detail(
        this.prisma,
        teacher,
        start,
        false,
      );
      months.push({
        month: detail.month,
        status: detail.status,
        accrued: detail.totals.accrued,
        paid: detail.totals.paid,
        balance: detail.totals.balance,
      });
    }
    return { year, months };
  }

  async myMonth(user: AuthenticatedUser, monthValue: string) {
    const { from } = parseMonth(monthValue);
    const teacher = await this.builder.teacher(this.prisma, user.id);
    return this.builder.detail(this.prisma, teacher, from, false);
  }

  async setWorkedDays(
    teacherId: string,
    monthValue: string,
    workedDays: number | null,
  ) {
    const { teacher, month } = await this.target(teacherId, monthValue);
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheet(tx, teacher.id, month);
      assertDraft(sheet.status);
      await tx.payrollSheet.update({
        where: { id: sheet.id },
        data: { workedDays },
      });
    });
    return this.builder.detail(this.prisma, teacher, month, true);
  }

  async addAdjustment(
    teacherId: string,
    monthValue: string,
    dto: PayrollAdjustmentDto,
    user: AuthenticatedUser,
  ) {
    const amount = positiveAmount(dto.amount);
    const { teacher, month } = await this.target(teacherId, monthValue);
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheet(tx, teacher.id, month);
      assertDraft(sheet.status);
      await tx.payrollAdjustment.create({
        data: {
          sheetId: sheet.id,
          kind: dto.kind,
          amount,
          reason: dto.reason.trim(),
          createdById: user.id,
        },
      });
    });
    return this.builder.detail(this.prisma, teacher, month, true);
  }

  async voidAdjustment(id: string, reason: string, user: AuthenticatedUser) {
    const found = await this.prisma.payrollAdjustment.findUnique({
      where: { id },
      select: { sheet: { select: { id: true, teacherId: true, month: true } } },
    });
    if (!found) throw new NotFoundException('Payroll adjustment not found');
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheetById(tx, found.sheet.id);
      assertDraft(sheet.status);
      const adjustment = await tx.payrollAdjustment.findUniqueOrThrow({
        where: { id },
        select: { voidedAt: true },
      });
      if (adjustment.voidedAt)
        throw new BadRequestException('Adjustment is voided');
      await tx.payrollAdjustment.update({
        where: { id },
        data: {
          voidedAt: new Date(),
          voidedById: user.id,
          voidReason: reason.trim(),
        },
      });
    });
    return this.sheetDetail(found.sheet);
  }

  async addPayment(
    teacherId: string,
    monthValue: string,
    dto: PayrollPaymentDto,
    user: AuthenticatedUser,
  ) {
    const date = parseDay(dto.date);
    if (date.getTime() > kyivToday().getTime())
      throw new BadRequestException('Payment date is in the future');
    const amount = positiveAmount(dto.amount);
    const { teacher, month } = await this.target(teacherId, monthValue);
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheet(tx, teacher.id, month);
      await tx.payrollPayment.create({
        data: {
          sheetId: sheet.id,
          date,
          amount,
          method: dto.method,
          comment: dto.comment?.trim() || null,
          createdById: user.id,
        },
      });
    });
    return this.builder.detail(this.prisma, teacher, month, true);
  }

  async voidPayment(id: string, reason: string, user: AuthenticatedUser) {
    const found = await this.prisma.payrollPayment.findUnique({
      where: { id },
      select: { sheet: { select: { id: true, teacherId: true, month: true } } },
    });
    if (!found) throw new NotFoundException('Payroll payment not found');
    await this.prisma.$transaction(async (tx) => {
      await this.lockSheetById(tx, found.sheet.id);
      const payment = await tx.payrollPayment.findUniqueOrThrow({
        where: { id },
        select: { voidedAt: true },
      });
      if (payment.voidedAt) throw new BadRequestException('Payment is voided');
      await tx.payrollPayment.update({
        where: { id },
        data: {
          voidedAt: new Date(),
          voidedById: user.id,
          voidReason: reason.trim(),
        },
      });
    });
    return this.sheetDetail(found.sheet);
  }

  async approve(
    teacherId: string,
    monthValue: string,
    user: AuthenticatedUser,
  ) {
    const { teacher, month } = await this.target(teacherId, monthValue);
    if (month.getTime() > firstDayOfMonth(kyivToday()).getTime())
      throw new BadRequestException('Month is in the future');
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheet(tx, teacher.id, month);
      await this.lockApproved(tx, teacher.id);
      assertDraft(sheet.status);
      const computed = await this.builder.compute(
        tx,
        teacher.id,
        month,
        sheet.workedDays,
        sheet.adjustments,
      );
      if (computed.lines.length > 0)
        await tx.payrollLine.createMany({
          data: computed.lines.map((line, position) => ({
            sheetId: sheet.id,
            position,
            type: line.type,
            sourceType: line.sourceType,
            sourceId: line.sourceId,
            lessonType: line.lessonType,
            date: line.date,
            refMonth: line.refMonth,
            title: line.title,
            amount: line.amount,
            meta: line.meta ?? undefined,
          })),
        });
      await tx.payrollSheet.update({
        where: { id: sheet.id },
        data: {
          status: PayrollStatus.approved,
          approvedAt: new Date(),
          approvedById: user.id,
          approvedDays: computed.days,
        },
      });
    });
    return this.builder.detail(this.prisma, teacher, month, true);
  }

  async reopen(
    teacherId: string,
    monthValue: string,
    reason: string,
    user: AuthenticatedUser,
  ) {
    const { teacher, month } = await this.target(teacherId, monthValue);
    await this.prisma.$transaction(async (tx) => {
      await this.lockApproved(tx, teacher.id);
      const sheet = await tx.payrollSheet.findUnique({
        where: { teacherId_month: { teacherId: teacher.id, month } },
      });
      if (
        !sheet ||
        sheet.status !== PayrollStatus.approved ||
        !sheet.approvedAt
      )
        throw new BadRequestException('Payroll is not approved');
      const later = await tx.payrollPayment.count({
        where: {
          sheetId: sheet.id,
          voidedAt: null,
          createdAt: { gt: sheet.approvedAt },
        },
      });
      if (later > 0)
        throw new BadRequestException('Payroll has payments after approval');
      const corrections = await tx.payrollLine.count({
        where: {
          type: PayrollLineType.correction,
          refMonth: month,
          sheet: { teacherId: teacher.id, status: PayrollStatus.approved },
        },
      });
      if (corrections > 0)
        throw new BadRequestException('Payroll has later corrections');
      await tx.payrollLine.deleteMany({ where: { sheetId: sheet.id } });
      await tx.payrollSheet.update({
        where: { id: sheet.id },
        data: {
          status: PayrollStatus.draft,
          approvedAt: null,
          approvedById: null,
          approvedDays: Prisma.JsonNull,
          reopenedAt: new Date(),
          reopenedById: user.id,
          reopenReason: reason.trim(),
        },
      });
    });
    return this.builder.detail(this.prisma, teacher, month, true);
  }

  private async target(teacherId: string, monthValue: string) {
    const { from } = parseMonth(monthValue);
    const teacher = await this.builder.teacher(this.prisma, teacherId);
    return { teacher, month: from };
  }

  private async sheetDetail(sheet: { teacherId: string; month: Date }) {
    const teacher = await this.builder.teacher(this.prisma, sheet.teacherId);
    return this.builder.detail(this.prisma, teacher, sheet.month, true);
  }

  private async lockSheet(tx: Tx, teacherId: string, month: Date) {
    await tx.payrollSheet.createMany({
      data: [{ teacherId, month }],
      skipDuplicates: true,
    });
    const { id } = await tx.payrollSheet.findUniqueOrThrow({
      where: { teacherId_month: { teacherId, month } },
      select: { id: true },
    });
    return this.lockSheetById(tx, id);
  }

  private async lockSheetById(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "PayrollSheet" WHERE id = ${id} FOR UPDATE`;
    return tx.payrollSheet.findUniqueOrThrow({
      where: { id },
      include: {
        adjustments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
  }

  private async lockApproved(tx: Tx, teacherId: string) {
    await tx.$queryRaw`SELECT id FROM "PayrollSheet" WHERE "teacherId" = ${teacherId} AND status = 'approved' ORDER BY id FOR UPDATE`;
  }
}
