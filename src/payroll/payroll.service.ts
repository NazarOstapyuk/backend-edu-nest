import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseMonth } from '../attendance/register-calc';
import { firstDayOfMonth, kyivToday, lastDayOfMonth } from '../tariffs/dates';
import { PayrollBuilder, toSummary } from './payroll-builder.service';

const ZERO = new Prisma.Decimal(0);

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
}
