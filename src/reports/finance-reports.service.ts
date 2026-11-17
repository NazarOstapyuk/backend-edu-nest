import { Injectable, NotFoundException } from '@nestjs/common';
import { ChargeSource, PaymentStatus, Prisma } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { directionForInstitution } from '../cash/cash-calc';
import { PrismaService } from '../prisma/prisma.service';
import { kyivDayStart } from '../audit/audit-calc';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import {
  type ReportFilter,
  childFilterWhere,
  reportPeriod,
  resolveFilter,
} from './report-query';
import { ReportQueryDto } from './dto/report-query.dto';
import {
  ChargeTariffSources,
  TariffRef,
  chargeTariff,
  chargesReport,
  debtsReport,
  paymentsReport,
} from './reports-calc';
import { cashReport } from './cash-report-calc';
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

  async cash(query: ReportQueryDto, user: AuthenticatedUser): Promise<Report> {
    const shift = query.shiftId
      ? await this.prisma.cashShift.findUnique({
          where: { id: query.shiftId },
          select: { openedAt: true },
        })
      : null;
    if (query.shiftId && !shift) throw new NotFoundException('Shift not found');
    const shiftDay = shift ? kyivToday(shift.openedAt) : null;
    const period = shiftDay
      ? { from: shiftDay, to: shiftDay }
      : reportPeriod(query.from, query.to);
    const range = {
      gte: kyivDayStart(isoDay(period.from)),
      lt: kyivDayStart(isoDay(addDays(period.to, 1))),
    };
    const filter: ReportFilter = query.shiftId
      ? {
          kind: query.kind ?? null,
          institutionIds: null,
          groupId: query.groupId ?? null,
        }
      : await resolveFilter(this.prisma, user, query);
    const byPayment = Boolean(
      query.kind || query.groupId || query.childId || query.category,
    );
    const scopedOnly = !byPayment && filter.institutionIds !== null;
    const child = childFilterWhere(filter, query.childId);
    const entryWhere: Prisma.CashEntryWhereInput =
      byPayment && query.entryKind && query.entryKind !== 'income'
        ? { id: { in: [] } }
        : {
            ...(query.shiftId
              ? { shiftId: query.shiftId }
              : { createdAt: range }),
            ...(query.deskId ? { deskId: query.deskId } : {}),
            ...(query.employeeId ? { createdById: query.employeeId } : {}),
            ...(query.direction ? { direction: query.direction } : {}),
            ...(byPayment
              ? {
                  kind: 'income',
                  payment: {
                    ...(query.category ? { category: query.category } : {}),
                    child,
                  },
                }
              : query.entryKind
                ? { kind: query.entryKind }
                : {}),
            ...(scopedOnly && (!query.entryKind || query.entryKind === 'income')
              ? {
                  OR: [{ kind: { not: 'income' } }, { payment: { child } }],
                }
              : {}),
          };
    const [entries, payments, shifts] = await Promise.all([
      this.prisma.cashEntry.findMany({
        where: entryWhere,
        include: {
          desk: { select: { name: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          recipient: { select: { firstName: true, lastName: true } },
          payment: {
            select: {
              category: true,
              payerName: true,
              periodFrom: true,
              periodTo: true,
              child: {
                select: {
                  firstName: true,
                  lastName: true,
                  group: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        where: {
          voidedAt: null,
          status: PaymentStatus.confirmed,
          ...(query.shiftId
            ? { cashEntry: { shiftId: query.shiftId } }
            : { receivedAt: range }),
          ...(query.category ? { category: query.category } : {}),
          child,
        },
        select: {
          category: true,
          method: true,
          amount: true,
          child: {
            select: {
              group: { select: { institution: { select: { type: true } } } },
            },
          },
        },
      }),
      this.prisma.cashShift.findMany({
        where: {
          ...(query.shiftId ? { id: query.shiftId } : { openedAt: range }),
          ...(query.deskId ? { deskId: query.deskId } : {}),
        },
        include: {
          desk: { select: { name: true } },
          openedBy: { select: { firstName: true, lastName: true } },
          closedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { openedAt: 'asc' },
      }),
    ]);
    return cashReport({
      period,
      shiftDay,
      entries: entries.map((e) => ({
        createdAt: e.createdAt,
        desk: e.desk.name,
        kind: e.kind,
        direction: e.direction,
        amount: e.amount,
        sign: e.sign,
        paymentCategory: e.payment?.category ?? null,
        expenseCategory: e.expenseCategory,
        child: e.payment ? fullName(e.payment.child) : null,
        group: e.payment?.child.group?.name ?? null,
        payer: e.payment?.payerName ?? null,
        periodFrom: e.payment?.periodFrom ?? null,
        periodTo: e.payment?.periodTo ?? null,
        employeeId: e.createdById,
        employee: fullName(e.createdBy),
        recipient: e.recipient ? fullName(e.recipient) : null,
        transferStatus: e.transferStatus,
        comment: e.comment,
        voidedAt: e.voidedAt,
      })),
      payments: payments
        .map((p) => ({
          category: p.category,
          method: p.method,
          amount: p.amount,
          direction: directionForInstitution(p.child.group?.institution?.type),
        }))
        .filter((p) => !query.direction || p.direction === query.direction),
      shifts: shifts.map((s) => ({
        desk: s.desk.name,
        openedAt: s.openedAt,
        openedBy: fullName(s.openedBy),
        closedAt: s.closedAt,
        closedBy: s.closedBy ? fullName(s.closedBy) : null,
        openingCounted: s.openingCounted,
        closingExpected: s.closingExpected,
        closingCounted: s.closingCounted,
        closingNote: s.closingNote,
      })),
    });
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
