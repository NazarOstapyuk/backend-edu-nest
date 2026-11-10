import { Injectable, NotFoundException } from '@nestjs/common';
import { ChargeSource, PaymentStatus } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import { kyivDayStart } from '../audit/audit-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import { childFilterWhere, reportPeriod, resolveFilter } from './report-query';
import { ReportQueryDto } from './dto/report-query.dto';
import {
  ChargeTariffSources,
  TariffRef,
  chargeTariff,
  chargesReport,
  debtsReport,
  paymentsReport,
} from './reports-calc';
import { Report } from './report.types';

const tariffSelect = { tariff: { select: { id: true, name: true } } };

const toMap = <T extends { id: string }>(
  rows: T[],
  tariffOf: (row: T) => TariffRef | null | undefined,
): Map<string, TariffRef> =>
  new Map(
    rows.flatMap((row) => {
      const tariff = tariffOf(row);
      return tariff ? [[row.id, tariff] as const] : [];
    }),
  );

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
    if (query.tariffId) await this.assertTariffVisible(query.tariffId, user);
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
        sourceId: true,
        description: true,
        amount: true,
        child: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            group: { select: { name: true } },
          },
        },
      },
      orderBy: [{ periodStart: 'asc' }, { createdAt: 'asc' }],
    });
    const sources = await this.tariffSources(rows);
    return chargesReport(
      period,
      rows
        .map((r) => {
          const tariff = chargeTariff(r, sources);
          return {
            periodStart: r.periodStart,
            createdAt: r.createdAt,
            childId: r.child.id,
            child: fullName(r.child),
            group: r.child.group?.name ?? null,
            category: r.category,
            sourceType: r.sourceType,
            description: r.description,
            amount: r.amount,
            tariffId: tariff?.id ?? null,
            tariff: tariff?.name ?? null,
          };
        })
        .filter((r) => !query.tariffId || r.tariffId === query.tariffId),
    );
  }

  private async assertTariffVisible(id: string, user: AuthenticatedUser) {
    const tariff = await this.prisma.tariff.findUnique({
      where: { id },
      select: { institutionId: true },
    });
    const ids = scopeIds(user);
    if (
      !tariff ||
      (ids &&
        tariff.institutionId !== null &&
        !ids.includes(tariff.institutionId))
    )
      throw new NotFoundException('Tariff not found');
  }

  private async tariffSources(
    charges: { sourceType: ChargeSource; sourceId: string | null }[],
  ): Promise<ChargeTariffSources> {
    const idsOf = (type: ChargeSource) => [
      ...new Set(
        charges.flatMap((c) =>
          c.sourceType === type && c.sourceId ? [c.sourceId] : [],
        ),
      ),
    ];
    const enrollmentIds = idsOf(ChargeSource.monthly);
    const packageIds = idsOf(ChargeSource.extra_package);
    const visitIds = idsOf(ChargeSource.adaptation);
    const attendanceIds = idsOf(ChargeSource.extra_session);
    const [enrollments, packages, visits, attendances] = await Promise.all([
      enrollmentIds.length
        ? this.prisma.enrollment.findMany({
            where: { id: { in: enrollmentIds } },
            select: { id: true, ...tariffSelect },
          })
        : [],
      packageIds.length
        ? this.prisma.package.findMany({
            where: { id: { in: packageIds } },
            select: { id: true, ...tariffSelect },
          })
        : [],
      visitIds.length
        ? this.prisma.adaptationVisit.findMany({
            where: { id: { in: visitIds } },
            select: { id: true, ...tariffSelect },
          })
        : [],
      attendanceIds.length
        ? this.prisma.lessonAttendance.findMany({
            where: { id: { in: attendanceIds } },
            select: {
              id: true,
              lesson: {
                select: {
                  classGroup: {
                    select: {
                      singleTariff: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          })
        : [],
    ]);
    return {
      enrollments: toMap(enrollments, (e) => e.tariff),
      packages: toMap(packages, (p) => p.tariff),
      adaptations: toMap(visits, (v) => v.tariff),
      attendances: toMap(attendances, (a) => a.lesson.classGroup.singleTariff),
    };
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
