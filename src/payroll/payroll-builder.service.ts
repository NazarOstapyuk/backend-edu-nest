import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceStatus,
  ClassFormat,
  type PayrollLine,
  PayrollLessonType,
  PayrollLineType,
  PayrollSourceType,
  PayrollStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import {
  addDays,
  firstDayOfMonth,
  isoDay,
  lastDayOfMonth,
} from '../tariffs/dates';
import {
  type AdjustmentLike,
  type BookedLine,
  type ComputedLine,
  type ComputedSheet,
  type LessonSource,
  type LineMeta,
  type SheetDays,
  absenceWorkingDays,
  computeSheet,
  monthSegments,
  sumAmounts,
} from './payroll-calc';

type Db = Prisma.TransactionClient;

type Records = Awaited<ReturnType<PayrollBuilder['records']>>;

export interface TeacherRef {
  id: string;
  firstName: string;
  lastName: string;
  payrollDetailsVisible: boolean;
}

const person = { select: { id: true, firstName: true, lastName: true } };

const sheetInclude = {
  lines: { orderBy: { position: 'asc' } },
  adjustments: {
    include: { createdBy: person },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  payments: {
    include: { createdBy: person },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.PayrollSheetInclude;

const EMPTY_DAYS: SheetDays = {
  normDays: 0,
  defaultDays: 0,
  workedDays: 0,
  unpaidAbsenceDays: 0,
  override: false,
};

export const monthKey = (month: Date) => isoDay(month).slice(0, 7);

const money = (value: Prisma.Decimal) => value.toFixed(2);

const storedLine = (line: PayrollLine): ComputedLine => ({
  type: line.type,
  sourceType: line.sourceType,
  sourceId: line.sourceId,
  lessonType: line.lessonType,
  date: line.date,
  refMonth: line.refMonth,
  title: line.title,
  amount: line.amount,
  meta: line.meta === null ? null : (line.meta as unknown as LineMeta),
});

const lineView = (line: ComputedLine) => ({
  type: line.type,
  title: line.title,
  date: line.date ? isoDay(line.date) : null,
  lessonType: line.lessonType,
  refMonth: line.refMonth ? monthKey(line.refMonth) : null,
  amount: money(line.amount),
  noRate: line.meta?.noRate === true,
  sourceType: line.sourceType,
  sourceId: line.sourceId,
});

@Injectable()
export class PayrollBuilder {
  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
  ) {}

  async teacher(db: Db, id: string): Promise<TeacherRef> {
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        payrollDetailsVisible: true,
      },
    });
    if (!user || user.role !== Role.teacher)
      throw new NotFoundException('Teacher not found');
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      payrollDetailsVisible: user.payrollDetailsVisible,
    };
  }

  async lessons(
    db: Db,
    teacherId: string,
    from: Date,
    to: Date,
  ): Promise<LessonSource[]> {
    const [school, classes] = await Promise.all([
      db.schoolLesson.findMany({
        where: { teacherId, date: { gte: from, lte: to } },
        select: {
          id: true,
          date: true,
          subjectId: true,
          subject: { select: { name: true } },
        },
      }),
      db.lesson.findMany({
        where: {
          conductedById: teacherId,
          date: { gte: from, lte: to },
          attendances: {
            some: { voidedAt: null, status: AttendanceStatus.present },
          },
        },
        select: {
          id: true,
          date: true,
          classGroupId: true,
          classGroup: { select: { name: true, format: true } },
        },
      }),
    ]);
    return [
      ...school.map((lesson) => ({
        sourceType: PayrollSourceType.school_lesson,
        sourceId: lesson.id,
        date: lesson.date,
        lessonType: PayrollLessonType.school_lesson,
        subjectId: lesson.subjectId,
        classGroupId: null,
        title: lesson.subject.name,
      })),
      ...classes.map((lesson) => ({
        sourceType: PayrollSourceType.class_lesson,
        sourceId: lesson.id,
        date: lesson.date,
        lessonType:
          lesson.classGroup.format === ClassFormat.individual
            ? PayrollLessonType.individual
            : PayrollLessonType.class_group,
        subjectId: null,
        classGroupId: lesson.classGroupId,
        title: lesson.classGroup.name,
      })),
    ];
  }

  async records(db: Db, teacherId: string, month: Date) {
    const [absences, extraHours] = await Promise.all([
      db.teacherAbsence.findMany({
        where: {
          teacherId,
          startDate: { lte: lastDayOfMonth(month) },
          endDate: { gte: month },
        },
        include: { createdBy: person },
        orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      db.payrollExtraHours.findMany({
        where: { teacherId, month },
        include: { createdBy: person },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { absences, extraHours };
  }

  async compute(
    db: Db,
    teacherId: string,
    month: Date,
    workedDays: number | null,
    adjustments: AdjustmentLike[],
    loaded?: Records,
  ): Promise<ComputedSheet> {
    const to = lastDayOfMonth(month);
    const [terms, entries, lessons, approved, records] = await Promise.all([
      db.salaryTerms.findMany({
        where: { teacherId },
        include: { rates: true, allowances: true },
        orderBy: { validFrom: 'asc' },
      }),
      this.calendar.entriesBetween(month, to),
      this.lessons(db, teacherId, month, to),
      db.payrollSheet.findMany({
        where: {
          teacherId,
          status: PayrollStatus.approved,
          month: { lt: month },
        },
        select: { month: true },
        orderBy: { month: 'asc' },
      }),
      loaded ?? this.records(db, teacherId, month),
    ]);
    let past: LessonSource[] = [];
    let booked: BookedLine[] = [];
    if (approved.length > 0) {
      const months = new Set(approved.map((sheet) => sheet.month.getTime()));
      const [before, lines] = await Promise.all([
        this.lessons(db, teacherId, approved[0].month, addDays(month, -1)),
        db.payrollLine.findMany({
          where: {
            sheet: { teacherId, status: PayrollStatus.approved },
            type: { in: [PayrollLineType.lesson, PayrollLineType.correction] },
            date: { lt: month },
          },
          select: {
            sourceType: true,
            sourceId: true,
            lessonType: true,
            date: true,
            title: true,
            amount: true,
          },
          orderBy: [{ date: 'asc' }, { id: 'asc' }],
        }),
      ]);
      past = before.filter((lesson) =>
        months.has(firstDayOfMonth(lesson.date).getTime()),
      );
      booked = lines.flatMap((line) =>
        line.sourceType && line.sourceId && line.lessonType && line.date
          ? [
              {
                sourceType: line.sourceType,
                sourceId: line.sourceId,
                lessonType: line.lessonType,
                date: line.date,
                title: line.title,
                amount: line.amount,
              },
            ]
          : [],
      );
    }
    return computeSheet({
      month,
      terms,
      entries,
      workedDays,
      lessons,
      past,
      booked,
      adjustments,
      absences: records.absences,
      extraHours: records.extraHours.map((record) => ({
        id: record.id,
        date: record.date,
        hours: record.hours,
        rate: record.rate,
        voidedAt: record.voidedAt,
      })),
    });
  }

  async detail(db: Db, teacher: TeacherRef, month: Date, staff: boolean) {
    const sheet = await db.payrollSheet.findUnique({
      where: { teacherId_month: { teacherId: teacher.id, month } },
      include: sheetInclude,
    });
    let days: SheetDays;
    let lines: ComputedLine[];
    let warnings: {
      noRate: number;
      lessonsWithoutTerms: number;
      lessonsOnAbsenceDays: string[];
    };
    let lessons: number;
    const records = await this.records(db, teacher.id, month);
    if (sheet?.status === PayrollStatus.approved) {
      lines = sheet.lines.map(storedLine);
      days = {
        ...EMPTY_DAYS,
        ...(sheet.approvedDays as unknown as Partial<SheetDays> | null),
      };
      warnings = {
        noRate: lines.filter((line) => line.meta?.noRate).length,
        lessonsWithoutTerms: 0,
        lessonsOnAbsenceDays: [],
      };
      lessons = lines.filter(
        (line) => line.type === PayrollLineType.lesson,
      ).length;
    } else {
      const computed = await this.compute(
        db,
        teacher.id,
        month,
        sheet?.workedDays ?? null,
        sheet?.adjustments ?? [],
        records,
      );
      lines = computed.lines;
      days = computed.days;
      warnings = computed.warnings;
      lessons = computed.lessons;
    }
    const activePayments = (sheet?.payments ?? []).filter(
      (p) => p.voidedAt === null,
    );
    const showDetails = staff || teacher.payrollDetailsVisible;
    const extraItems = new Map(
      lines
        .flatMap((line) => line.meta?.extraHours ?? [])
        .map((item) => [item.id, item]),
    );
    const extraHours = records.extraHours
      .filter((record) => staff || record.voidedAt === null)
      .map((record) => {
        const used = extraItems.get(record.id);
        return {
          id: record.id,
          date: record.date ? isoDay(record.date) : null,
          hours: record.hours.toFixed(2),
          rate: used?.rate ?? null,
          ownRate: record.rate ? money(record.rate) : null,
          amount: used?.amount ?? null,
          comment: record.comment,
          createdAt: record.createdAt.toISOString(),
          ...(staff ? { createdBy: record.createdBy } : {}),
          voidedAt: record.voidedAt?.toISOString() ?? null,
          voidReason: record.voidReason,
        };
      });
    const visibleAbsences = records.absences.filter(
      (absence) => staff || absence.voidedAt === null,
    );
    let absenceDays = new Map<string, number>();
    if (showDetails && visibleAbsences.length > 0) {
      const [terms, entries] = await Promise.all([
        db.salaryTerms.findMany({
          where: { teacherId: teacher.id },
          include: { rates: true, allowances: true },
          orderBy: { validFrom: 'asc' },
        }),
        this.calendar.entriesBetween(month, lastDayOfMonth(month)),
      ]);
      const segments = monthSegments(month, terms, entries);
      absenceDays = new Map(
        visibleAbsences.map((absence) => [
          absence.id,
          absenceWorkingDays(month, segments, absence, entries),
        ]),
      );
    }
    const absences = visibleAbsences.map((absence) => ({
      id: absence.id,
      startDate: isoDay(absence.startDate),
      endDate: isoDay(absence.endDate),
      paid: absence.paid,
      reason: absence.reason,
      workingDays: absenceDays.get(absence.id) ?? 0,
      createdAt: absence.createdAt.toISOString(),
      ...(staff ? { createdBy: absence.createdBy } : {}),
      voidedAt: absence.voidedAt?.toISOString() ?? null,
      voidReason: absence.voidReason,
    }));
    const daysRest: Omit<SheetDays, 'unpaidAbsenceDays'> & {
      unpaidAbsenceDays?: number;
    } = { ...days };
    delete daysRest.unpaidAbsenceDays;
    const accrued = sumAmounts(lines);
    const paid = sumAmounts(activePayments);
    const teacherPublic = {
      id: teacher.id,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
    };
    return {
      teacher: staff ? teacher : teacherPublic,
      month: monthKey(month),
      status: sheet?.status ?? PayrollStatus.draft,
      approvedAt: sheet?.approvedAt?.toISOString() ?? null,
      reopenReason: sheet?.reopenReason ?? null,
      days: showDetails ? days : daysRest,
      ...(staff
        ? { payrollDetailsVisible: teacher.payrollDetailsVisible }
        : {}),
      ...(showDetails ? { extraHours, absences } : {}),
      lines: lines.map(lineView),
      adjustments: (sheet?.adjustments ?? [])
        .filter((a) => staff || a.voidedAt === null)
        .map((a) => ({
          id: a.id,
          kind: a.kind,
          amount: money(a.amount),
          reason: a.reason,
          createdAt: a.createdAt.toISOString(),
          ...(staff ? { createdBy: a.createdBy } : {}),
          voidedAt: a.voidedAt?.toISOString() ?? null,
          voidReason: a.voidReason,
        })),
      payments: (staff ? (sheet?.payments ?? []) : activePayments).map((p) => ({
        id: p.id,
        date: isoDay(p.date),
        amount: money(p.amount),
        method: p.method,
        comment: p.comment,
        createdAt: p.createdAt.toISOString(),
        ...(staff ? { createdBy: p.createdBy } : {}),
        voidedAt: p.voidedAt?.toISOString() ?? null,
        voidReason: p.voidReason,
      })),
      warnings: showDetails
        ? warnings
        : { ...warnings, lessonsOnAbsenceDays: [] },
      lessons,
      totals: {
        accrued: money(accrued),
        paid: money(paid),
        balance: money(accrued.sub(paid)),
      },
    };
  }
}

export type PayrollDetail = Awaited<ReturnType<PayrollBuilder['detail']>>;

export const toSummary = (detail: PayrollDetail) => ({
  teacher: detail.teacher,
  status: detail.status,
  accrued: detail.totals.accrued,
  paid: detail.totals.paid,
  balance: detail.totals.balance,
  lessons: detail.lessons,
  warnings: detail.warnings,
});
