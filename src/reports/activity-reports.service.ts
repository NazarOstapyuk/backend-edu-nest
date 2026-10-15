import { Injectable } from '@nestjs/common';
import {
  AttendanceStatus,
  NoticeStatus,
  PermissionArea,
  PermissionLevel,
  Prisma,
} from '@prisma/client';
import { hasPermission } from '../access/access-calc';
import { CalendarService } from '../attendance/calendar.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { isoDay } from '../tariffs/dates';
import { ReportQueryDto } from './dto/report-query.dto';
import { childFilterWhere, reportPeriod, resolveFilter } from './report-query';
import { Report } from './report.types';
import {
  PayrollMonthRow,
  attendanceReport,
  lessonsReport,
  mealsReport,
  monthsTouched,
  payrollReport,
} from './reports-calc';

const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.lastName} ${p.firstName}`;

@Injectable()
export class ActivityReportsService {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    private payrollService: PayrollService,
  ) {}

  async attendance(
    query: ReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<Report> {
    const period = reportPeriod(query.from, query.to);
    const filter = await resolveFilter(this.prisma, user, query);
    const [children, entries, reasons] = await Promise.all([
      this.prisma.child.findMany({
        where: {
          groupId: { not: null },
          ...childFilterWhere(filter, query.childId),
        },
        select: {
          firstName: true,
          lastName: true,
          group: { select: { id: true, kind: true, name: true } },
          dailyAttendances: {
            where: {
              voidedAt: null,
              date: { gte: period.from, lte: period.to },
            },
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
              startDate: { lte: period.to },
              endDate: { gte: period.from },
            },
            select: {
              startDate: true,
              endDate: true,
              reasonId: true,
              status: true,
            },
          },
        },
      }),
      this.calendar.entriesBetween(period.from, period.to),
      this.prisma.absenceReason.findMany({
        where: { excused: true },
        select: { id: true },
      }),
    ]);
    return attendanceReport(
      period,
      children.flatMap((c) =>
        c.group
          ? [
              {
                child: fullName(c),
                group: c.group,
                marks: c.dailyAttendances,
                notices: c.absenceNotices,
              },
            ]
          : [],
      ),
      entries,
      new Set(reasons.map((r) => r.id)),
    );
  }

  async lessons(
    query: ReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<Report> {
    const period = reportPeriod(query.from, query.to);
    const filter = await resolveFilter(this.prisma, user, query);
    const date = { gte: period.from, lte: period.to };
    const teacherId = query.teacherId;
    const school = hasPermission(
      user,
      PermissionArea.timetable,
      PermissionLevel.view,
    )
      ? await this.prisma.schoolLesson.findMany({
          where: {
            date,
            ...(teacherId ? { teacherId } : {}),
            group: {
              ...(filter.kind ? { kind: filter.kind } : {}),
              ...(filter.groupId ? { id: filter.groupId } : {}),
            },
          },
          select: {
            date: true,
            period: true,
            topic: true,
            teacher: { select: { firstName: true, lastName: true } },
            subject: { select: { name: true } },
            group: { select: { name: true } },
          },
        })
      : [];
    const classes =
      !filter.groupId &&
      hasPermission(user, PermissionArea.classes, PermissionLevel.view)
        ? await this.prisma.lesson.findMany({
            where: {
              date,
              ...(teacherId ? { conductedById: teacherId } : {}),
              attendances: {
                some: { voidedAt: null, status: AttendanceStatus.present },
              },
            },
            select: {
              date: true,
              conductedBy: { select: { firstName: true, lastName: true } },
              classGroup: {
                select: { name: true, direction: { select: { name: true } } },
              },
            },
          })
        : [];
    return lessonsReport(
      period,
      school.map((l) => ({
        date: l.date,
        period: l.period,
        teacher: fullName(l.teacher),
        subject: l.subject.name,
        group: l.group.name,
        topic: l.topic,
      })),
      classes.map((l) => ({
        date: l.date,
        teacher: fullName(l.conductedBy),
        direction: l.classGroup.direction.name,
        classGroup: l.classGroup.name,
      })),
    );
  }

  async meals(query: ReportQueryDto, user: AuthenticatedUser): Promise<Report> {
    const period = reportPeriod(query.from, query.to);
    const filter = await resolveFilter(this.prisma, user, query);
    const orders = await this.prisma.mealOrder.findMany({
      where: {
        cancelledAt: null,
        date: { gte: period.from, lte: period.to },
        child: childFilterWhere(filter),
      },
      select: {
        date: true,
        price: true,
        complex: { select: { name: true } },
        child: { select: { group: { select: { name: true } } } },
      },
    });
    return mealsReport(
      period,
      orders.map((o) => ({
        date: o.date,
        group: o.child.group?.name ?? null,
        complex: o.complex.name,
        price: o.price,
      })),
    );
  }

  async payroll(
    query: ReportQueryDto,
    user: AuthenticatedUser,
  ): Promise<Report> {
    const period = reportPeriod(query.from, query.to);
    await resolveFilter(this.prisma, user, query);
    const payments = await this.prisma.payrollPayment.findMany({
      where: {
        voidedAt: null,
        date: { gte: period.from, lte: period.to },
        ...(query.teacherId ? { sheet: { teacherId: query.teacherId } } : {}),
      },
      select: {
        amount: true,
        sheet: { select: { teacherId: true, month: true } },
      },
    });
    const paid = new Map<string, Prisma.Decimal>();
    const paidTeachers = new Map<string, Set<string>>();
    for (const p of payments) {
      const month = isoDay(p.sheet.month).slice(0, 7);
      const key = `${p.sheet.teacherId}:${month}`;
      paid.set(key, (paid.get(key) ?? new Prisma.Decimal(0)).add(p.amount));
      paidTeachers.set(
        month,
        (paidTeachers.get(month) ?? new Set<string>()).add(p.sheet.teacherId),
      );
    }
    const touched = monthsTouched(period.from, period.to);
    const months = [...new Set([...touched, ...paidTeachers.keys()])].sort();
    const rows: PayrollMonthRow[] = [];
    for (const month of months) {
      const { rows: monthRows } = await this.payrollService.list(month);
      const extra = !touched.includes(month);
      for (const row of monthRows) {
        if (query.teacherId && row.teacher.id !== query.teacherId) continue;
        if (extra && !paidTeachers.get(month)?.has(row.teacher.id)) continue;
        rows.push({
          teacherId: row.teacher.id,
          teacher: fullName(row.teacher),
          month,
          status: row.status,
          accrued: row.accrued,
          balance: row.balance,
        });
      }
    }
    return payrollReport(period, rows, paid);
  }
}
