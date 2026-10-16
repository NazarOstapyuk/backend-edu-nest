import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  NoticeStatus,
  PaymentStatus,
  PayrollStatus,
  PermissionArea,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import { hasPermission, scopeKind } from '../access/access-calc';
import { childScopeWhere, groupScopeWhere } from '../access/scope';
import { kyivDayStart } from '../audit/audit-calc';
import { CalendarService } from '../attendance/calendar.service';
import { canManageRegister } from '../attendance/register.service';
import { BackupsService } from '../backups/backups.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { formatMoney, sumMoney } from '../finance/finance-calc';
import { OnlinePaymentsService } from '../online-payments/online-payments.service';
import { childMoney } from '../parent-cabinet/cabinet-calc';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, isoDay, kyivToday } from '../tariffs/dates';
import {
  mealsByGroup,
  paymentsByMethod,
  pendingPayrollTeachers,
  PENDING_ONLINE_MINUTES,
  previousMonth,
  unmarkedGroups,
} from './dashboard-calc';

const can = (user: AuthenticatedUser, area: PermissionArea) =>
  hasPermission(user, area, PermissionLevel.view);

export interface TodayDashboard {
  date: string;
  register?: { count: number; names: string[]; more: number };
  notices?: { count: number };
  debts?: { children: number; amount: string };
  meals?: { count: number; groups: { name: string; count: number }[] };
  payments?: {
    total: string;
    count: number;
    byMethod: Record<'cash' | 'bank_transfer' | 'card' | 'online', string>;
  };
  onlinePending?: { count: number };
  payroll?: { month: string; count: number; names: string[]; more: number };
  backups?: { configured: boolean; stale: boolean };
}

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private backups: BackupsService,
    private onlinePayments: OnlinePaymentsService,
  ) {}

  async today(user: AuthenticatedUser): Promise<TodayDashboard> {
    if (user.role === Role.parent) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const today = kyivToday();
    const childScope = childScopeWhere(scopeKind(user));
    const isTeacher = user.role === Role.teacher;
    const result: TodayDashboard = { date: isoDay(today) };

    const sections: Promise<void>[] = [];
    const add = (task: () => Promise<void>) => sections.push(task());

    if (canManageRegister(user) || isTeacher) {
      add(async () => {
        result.register = await this.register(user, today);
      });
    }
    if (can(user, PermissionArea.register)) {
      add(async () => {
        const count = await this.prisma.absenceNotice.count({
          where: { status: NoticeStatus.pending, child: childScope },
        });
        result.notices = { count };
      });
    }
    if (can(user, PermissionArea.meals) || isTeacher) {
      add(async () => {
        result.meals = await this.meals(user, today);
      });
    }
    if (can(user, PermissionArea.finance)) {
      add(async () => {
        result.debts = await this.debts(childScope, today);
      });
      add(async () => {
        result.payments = await this.payments(childScope, today);
      });
      if (this.onlinePayments.config().enabled) {
        add(async () => {
          const count = await this.prisma.paymentInvoice.count({
            where: {
              status: InvoiceStatus.pending,
              createdAt: {
                lt: new Date(Date.now() - PENDING_ONLINE_MINUTES * 60_000),
              },
              request: { child: childScope },
            },
          });
          if (count > 0) result.onlinePending = { count };
        });
      }
    }
    if (can(user, PermissionArea.payroll)) {
      add(async () => {
        result.payroll = await this.payroll(today);
      });
    }
    if (can(user, PermissionArea.backups)) {
      add(async () => {
        const { configured, stale } = await this.backups.status();
        if (!configured || stale) result.backups = { configured, stale };
      });
    }
    await Promise.all(sections);
    return result;
  }

  private async register(user: AuthenticatedUser, today: Date) {
    const groups = await this.prisma.group.findMany({
      where: {
        ...(canManageRegister(user)
          ? {}
          : { teachers: { some: { id: user.id } } }),
        ...groupScopeWhere(scopeKind(user)),
      },
      select: {
        id: true,
        name: true,
        kind: true,
        children: {
          select: {
            dailyAttendances: {
              where: { date: today, voidedAt: null },
              select: {
                date: true,
                status: true,
                reasonId: true,
                voidedAt: true,
              },
            },
            absenceNotices: {
              where: {
                status: NoticeStatus.approved,
                startDate: { lte: today },
                endDate: { gte: today },
              },
              select: {
                startDate: true,
                endDate: true,
                reasonId: true,
                status: true,
              },
            },
          },
        },
      },
    });
    const entries = await this.calendar.entriesBetween(today, today);
    return unmarkedGroups(
      today,
      groups.map((group) => ({
        id: group.id,
        name: group.name,
        kind: group.kind,
        children: group.children.map((child) => ({
          marks: child.dailyAttendances,
          notices: child.absenceNotices,
        })),
      })),
      entries,
    );
  }

  private async meals(user: AuthenticatedUser, today: Date) {
    const scoped = childScopeWhere(scopeKind(user));
    const child: Prisma.ChildWhereInput = can(user, PermissionArea.meals)
      ? scoped
      : { AND: [scoped, { group: { teachers: { some: { id: user.id } } } }] };
    const orders = await this.prisma.mealOrder.findMany({
      where: { date: today, cancelledAt: null, child },
      select: { child: { select: { group: { select: { name: true } } } } },
    });
    return mealsByGroup(
      orders.map((order) => ({ group: order.child.group?.name ?? null })),
    );
  }

  private async debts(childScope: Prisma.ChildWhereInput, today: Date) {
    const children = await this.prisma.child.findMany({
      where: childScope,
      select: {
        charges: { where: { voidedAt: null }, include: { allocations: true } },
        payments: { where: { voidedAt: null }, include: { allocations: true } },
      },
    });
    const overdue = children
      .map(
        (c) =>
          new Prisma.Decimal(childMoney(c.charges, c.payments, today).overdue),
      )
      .filter((amount) => amount.gt(0));
    return {
      children: overdue.length,
      amount: formatMoney(sumMoney(overdue)),
    };
  }

  private async payments(childScope: Prisma.ChildWhereInput, today: Date) {
    const rows = await this.prisma.payment.findMany({
      where: {
        voidedAt: null,
        status: PaymentStatus.confirmed,
        receivedAt: {
          gte: kyivDayStart(isoDay(today)),
          lt: kyivDayStart(isoDay(addDays(today, 1))),
        },
        child: childScope,
      },
      select: { method: true, amount: true },
    });
    return paymentsByMethod(rows);
  }

  private async payroll(today: Date) {
    const month = previousMonth(today);
    const teachers = await this.prisma.user.findMany({
      where: {
        salaryTerms: {
          some: {
            validFrom: { lte: month.to },
            OR: [{ validTo: null }, { validTo: { gte: month.from } }],
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        payrollSheets: {
          where: { month: month.from, status: PayrollStatus.approved },
          select: { id: true },
        },
      },
    });
    const pending = pendingPayrollTeachers(
      teachers.map((t) => ({
        id: t.id,
        name: `${t.lastName} ${t.firstName}`,
        hasApprovedSheet: t.payrollSheets.length > 0,
      })),
    );
    return { month: month.label, ...pending };
  }
}
