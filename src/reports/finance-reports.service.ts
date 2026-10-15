import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { kyivDayStart } from '../audit/audit-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { childFilterWhere, reportPeriod, resolveFilter } from './report-query';
import { ReportQueryDto } from './dto/report-query.dto';
import { chargesReport, debtsReport, paymentsReport } from './reports-calc';
import { Report } from './report.types';

const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.lastName} ${p.firstName}`;

@Injectable()
export class FinanceReportsService {
  constructor(private prisma: PrismaService) {}

  async payments(
    query: ReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<Report> {
    const period = reportPeriod(query.from, query.to);
    const filter = await resolveFilter(this.prisma, user, query);
    const rows = await this.prisma.payment.findMany({
      where: {
        voidedAt: null,
        status: PaymentStatus.confirmed,
        receivedAt: {
          gte: kyivDayStart(isoDay(period.from)),
          lt: kyivDayStart(isoDay(addDays(period.to, 1))),
        },
        child: childFilterWhere(filter, query.childId),
      },
      select: {
        receivedAt: true,
        category: true,
        method: true,
        amount: true,
        reference: true,
        note: true,
        child: {
          select: {
            firstName: true,
            lastName: true,
            group: { select: { name: true } },
          },
        },
      },
      orderBy: { receivedAt: 'asc' },
    });
    return paymentsReport(
      period,
      rows.map((r) => ({
        receivedAt: r.receivedAt,
        child: fullName(r.child),
        group: r.child.group?.name ?? null,
        category: r.category,
        method: r.method,
        amount: r.amount,
        reference: r.reference,
        note: r.note,
      })),
    );
  }

  async charges(
    query: ReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<Report> {
    const period = reportPeriod(query.from, query.to);
    const filter = await resolveFilter(this.prisma, user, query);
    const rows = await this.prisma.charge.findMany({
      where: {
        voidedAt: null,
        child: childFilterWhere(filter, query.childId),
        OR: [
          { periodStart: { gte: period.from, lte: period.to } },
          {
            periodStart: null,
            createdAt: {
              gte: kyivDayStart(isoDay(period.from)),
              lt: kyivDayStart(isoDay(addDays(period.to, 1))),
            },
          },
        ],
      },
      select: {
        periodStart: true,
        createdAt: true,
        category: true,
        sourceType: true,
        description: true,
        amount: true,
        child: {
          select: {
            firstName: true,
            lastName: true,
            group: { select: { name: true } },
          },
        },
      },
      orderBy: [{ periodStart: 'asc' }, { createdAt: 'asc' }],
    });
    return chargesReport(
      period,
      rows.map((r) => ({
        periodStart: r.periodStart,
        createdAt: r.createdAt,
        child: fullName(r.child),
        group: r.child.group?.name ?? null,
        category: r.category,
        sourceType: r.sourceType,
        description: r.description,
        amount: r.amount,
      })),
    );
  }

  async debts(query: ReportQueryDto, user: AuthenticatedUser): Promise<Report> {
    const filter = await resolveFilter(this.prisma, user, query);
    const children = await this.prisma.child.findMany({
      where: childFilterWhere(filter, query.childId),
      select: {
        firstName: true,
        lastName: true,
        group: { select: { name: true } },
        parents: { select: { firstName: true, lastName: true, phone: true } },
        charges: { where: { voidedAt: null }, include: { allocations: true } },
        payments: { where: { voidedAt: null }, include: { allocations: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return debtsReport(
      children.map((c) => ({
        child: fullName(c),
        group: c.group?.name ?? null,
        parents: c.parents
          .map((p) => `${p.lastName} ${p.firstName} ${p.phone ?? ''}`.trim())
          .join(', '),
        charges: c.charges,
        payments: c.payments,
      })),
      kyivToday(),
    );
  }
}
