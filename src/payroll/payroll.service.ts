import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  PayrollLineType,
  PayrollStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseMonth } from '../attendance/register-calc';
import { parseDay } from '../classes/access';
import {
  dayCount,
  firstDayOfMonth,
  isoDay,
  kyivToday,
  lastDayOfMonth,
} from '../tariffs/dates';
import { positiveAmount } from './amount';
import {
  AbsenceDto,
  ExtraHoursDto,
  PayrollAdjustmentDto,
  PayrollPaymentDto,
} from './dto/payroll.dto';
import { PayrollBuilder, toSummary } from './payroll-builder.service';

const ZERO = new Prisma.Decimal(0);

type Tx = Prisma.TransactionClient;

const assertDraft = (status: PayrollStatus) => {
  if (status === PayrollStatus.approved)
    throw new BadRequestException('Payroll is approved');
};

const absencePerson = {
  select: { id: true, firstName: true, lastName: true, login: true },
};

const absenceView = (row: {
  id: string;
  teacherId: string;
  startDate: Date;
  endDate: Date;
  paid: boolean;
  reason: string;
  createdAt: Date;
  createdBy: { id: string; firstName: string; lastName: string; login: string };
  voidedAt: Date | null;
  voidReason: string | null;
}) => ({
  id: row.id,
  teacherId: row.teacherId,
  startDate: isoDay(row.startDate),
  endDate: isoDay(row.endDate),
  paid: row.paid,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
  voidedAt: row.voidedAt?.toISOString() ?? null,
  voidReason: row.voidReason,
});

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private builder: PayrollBuilder,
    private audit: AuditService,
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
      select: {
        id: true,
        firstName: true,
        lastName: true,
        payrollDetailsVisible: true,
      },
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
      assertDraft(sheet.status);
      await this.lockApproved(tx, teacher.id);
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
      const lockedIds = await this.lockApproved(tx, teacher.id);
      const sheet = await tx.payrollSheet.findUnique({
        where: { teacherId_month: { teacherId: teacher.id, month } },
      });
      if (
        !sheet ||
        sheet.status !== PayrollStatus.approved ||
        !sheet.approvedAt ||
        !lockedIds.some((row) => row.id === sheet.id)
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

  async addExtraHours(
    teacherId: string,
    monthValue: string,
    dto: ExtraHoursDto,
    user: AuthenticatedUser,
  ) {
    const { teacher, month } = await this.target(teacherId, monthValue);
    const hours = new Prisma.Decimal(dto.hours);
    const date = dto.date ? parseDay(dto.date) : null;
    const today = kyivToday();
    if (date) {
      if (
        date.getTime() < month.getTime() ||
        date.getTime() > lastDayOfMonth(month).getTime()
      )
        throw new BadRequestException('Invalid date range');
      if (date.getTime() > today.getTime())
        throw new BadRequestException('Date is in the future');
    } else if (month.getTime() > firstDayOfMonth(today).getTime())
      throw new BadRequestException('Date is in the future');
    if (hours.lte(0) || hours.gt(date ? 24 : 400))
      throw new BadRequestException('Invalid hours');
    const rate = dto.rate ? positiveAmount(dto.rate) : null;
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheet(tx, teacher.id, month);
      assertDraft(sheet.status);
      if (!rate) {
        const terms = await tx.salaryTerms.findMany({
          where: {
            teacherId: teacher.id,
            validFrom: { lte: lastDayOfMonth(month) },
            OR: [{ validTo: null }, { validTo: { gte: month } }],
          },
          select: { validFrom: true, validTo: true, extraHourRate: true },
          orderBy: { validFrom: 'asc' },
        });
        const version = date
          ? terms.find(
              (t) =>
                t.validFrom.getTime() <= date.getTime() &&
                (t.validTo === null || t.validTo.getTime() >= date.getTime()),
            )
          : terms.at(-1);
        if (!version) throw new BadRequestException('Salary terms not found');
        if (!version.extraHourRate)
          throw new BadRequestException('No extra hour rate');
      }
      await tx.payrollExtraHours.create({
        data: {
          teacherId: teacher.id,
          month,
          date,
          hours,
          rate,
          comment: dto.comment?.trim() || null,
          createdById: user.id,
        },
      });
    });
    return this.builder.detail(this.prisma, teacher, month, true);
  }

  async voidExtraHours(id: string, reason: string, user: AuthenticatedUser) {
    const found = await this.prisma.payrollExtraHours.findUnique({
      where: { id },
      select: { teacherId: true, month: true },
    });
    if (!found) throw new NotFoundException('Extra hours not found');
    await this.prisma.$transaction(async (tx) => {
      const sheet = await this.lockSheet(tx, found.teacherId, found.month);
      assertDraft(sheet.status);
      const record = await tx.payrollExtraHours.findUniqueOrThrow({
        where: { id },
        select: { voidedAt: true },
      });
      if (record.voidedAt)
        throw new BadRequestException('Extra hours are voided');
      await tx.payrollExtraHours.update({
        where: { id },
        data: {
          voidedAt: new Date(),
          voidedById: user.id,
          voidReason: reason.trim(),
        },
      });
    });
    return this.sheetDetail(found);
  }

  async addAbsence(
    teacherId: string,
    dto: AbsenceDto,
    user: AuthenticatedUser,
  ) {
    const teacher = await this.builder.teacher(this.prisma, teacherId);
    const startDate = parseDay(dto.startDate);
    const endDate = dto.endDate ? parseDay(dto.endDate) : startDate;
    if (
      endDate.getTime() < startDate.getTime() ||
      dayCount(startDate, endDate) > 92
    )
      throw new BadRequestException('Invalid date range');
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockTeacher(tx, teacher.id);
      await this.assertNoApproved(tx, teacher.id, startDate, endDate);
      const overlap = await tx.teacherAbsence.count({
        where: {
          teacherId: teacher.id,
          voidedAt: null,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });
      if (overlap > 0)
        throw new ConflictException('Absence overlaps another absence');
      return tx.teacherAbsence.create({
        data: {
          teacherId: teacher.id,
          startDate,
          endDate,
          paid: dto.paid,
          reason: dto.reason.trim(),
          createdById: user.id,
        },
        include: { createdBy: absencePerson },
      });
    });
    return absenceView(created);
  }

  async listAbsences(teacherId: string, from?: string, to?: string) {
    const teacher = await this.builder.teacher(this.prisma, teacherId);
    const rows = await this.prisma.teacherAbsence.findMany({
      where: {
        teacherId: teacher.id,
        ...(to ? { startDate: { lte: parseDay(to) } } : {}),
        ...(from ? { endDate: { gte: parseDay(from) } } : {}),
      },
      include: { createdBy: absencePerson },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(absenceView);
  }

  async voidAbsence(id: string, reason: string, user: AuthenticatedUser) {
    const found = await this.prisma.teacherAbsence.findUnique({
      where: { id },
      select: { teacherId: true },
    });
    if (!found) throw new NotFoundException('Absence not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockTeacher(tx, found.teacherId);
      const absence = await tx.teacherAbsence.findUniqueOrThrow({
        where: { id },
      });
      if (absence.voidedAt) throw new BadRequestException('Absence is voided');
      await this.assertNoApproved(
        tx,
        found.teacherId,
        absence.startDate,
        absence.endDate,
      );
      return tx.teacherAbsence.update({
        where: { id },
        data: {
          voidedAt: new Date(),
          voidedById: user.id,
          voidReason: reason.trim(),
        },
        include: { createdBy: absencePerson },
      });
    });
    return absenceView(updated);
  }

  async setDetailsVisibility(
    teacherId: string,
    visible: boolean,
    user: AuthenticatedUser,
  ) {
    const found = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { id: true, role: true, payrollDetailsVisible: true },
    });
    if (!found) throw new NotFoundException('Teacher not found');
    if (found.role !== Role.teacher)
      throw new BadRequestException('User is not a teacher');
    await this.prisma.user.update({
      where: { id: teacherId },
      data: { payrollDetailsVisible: visible },
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'users',
      entityId: teacherId,
      action: AuditAction.update,
      before: { payrollDetailsVisible: found.payrollDetailsVisible },
      after: { payrollDetailsVisible: visible },
      fields: ['payrollDetailsVisible'],
    });
    return { visible };
  }

  private async lockTeacher(tx: Tx, teacherId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${teacherId} FOR UPDATE`;
  }

  private async assertNoApproved(
    tx: Tx,
    teacherId: string,
    start: Date,
    end: Date,
  ) {
    const approved = await tx.payrollSheet.count({
      where: {
        teacherId,
        status: PayrollStatus.approved,
        month: { gte: firstDayOfMonth(start), lte: end },
      },
    });
    if (approved > 0) throw new BadRequestException('Payroll is approved');
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
    return tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "PayrollSheet" WHERE "teacherId" = ${teacherId} AND status = 'approved' ORDER BY id FOR UPDATE`;
  }
}
