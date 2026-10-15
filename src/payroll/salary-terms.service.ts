import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ClassFormat,
  PayrollLessonType,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { parseDay } from '../classes/access';
import { addDays, kyivToday } from '../tariffs/dates';
import { positiveAmount } from './amount';
import {
  CloseSalaryTermsDto,
  CreateSalaryTermsDto,
  SalaryAllowanceDto,
  SalaryRateDto,
  UpdateSalaryTermsDto,
} from './dto/salary-terms.dto';
import { termsInclude, toTermsView } from './terms-view';

const TERMS_FIELDS = [
  'teacherId',
  'validFrom',
  'validTo',
  'monthlyRate',
  'calendarKind',
  'note',
  'rates',
  'allowances',
] as const;

type TermsRow = Prisma.SalaryTermsGetPayload<{ include: typeof termsInclude }>;

const termsAudit = (row: TermsRow) => ({
  teacherId: row.teacherId,
  validFrom: row.validFrom,
  validTo: row.validTo,
  monthlyRate: row.monthlyRate,
  calendarKind: row.calendarKind,
  note: row.note,
  rates: row.rates.map(
    (rate) =>
      `${rate.lessonType}:${rate.subjectId ?? rate.classGroupId ?? '*'}=${rate.amount.toFixed(2)}`,
  ),
  allowances: row.allowances.map(
    (allowance) => `${allowance.name}=${allowance.amount.toFixed(2)}`,
  ),
});

@Injectable()
export class SalaryTermsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(teacherId: string) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { id: true, role: true },
    });
    if (!teacher || teacher.role !== Role.teacher)
      throw new NotFoundException('Teacher not found');
    const rows = await this.prisma.salaryTerms.findMany({
      where: { teacherId },
      include: termsInclude,
      orderBy: { validFrom: 'desc' },
    });
    const today = kyivToday();
    return rows.map((row) => toTermsView(row, today));
  }

  async get(id: string) {
    const row = await this.prisma.salaryTerms.findUnique({
      where: { id },
      include: termsInclude,
    });
    if (!row) throw new NotFoundException('Salary terms not found');
    return toTermsView(row, kyivToday());
  }

  async create(dto: CreateSalaryTermsDto, user: AuthenticatedUser) {
    const teacher = await this.prisma.user.findUnique({
      where: { id: dto.teacherId },
      select: { id: true, role: true },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');
    if (teacher.role !== Role.teacher)
      throw new BadRequestException('User is not a teacher');
    const validFrom = parseDay(dto.validFrom);
    const rates = await this.validateRates(dto.rates);
    const allowances = this.validateAllowances(dto.allowances);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${teacher.id} FOR UPDATE`;
      const versions = await tx.salaryTerms.findMany({
        where: { teacherId: teacher.id },
        select: { id: true, validFrom: true, validTo: true },
      });
      const open = versions.find(
        (v) =>
          v.validTo === null && v.validFrom.getTime() < validFrom.getTime(),
      );
      const clash = versions.some(
        (v) =>
          v.id !== open?.id &&
          (v.validTo === null || v.validTo.getTime() >= validFrom.getTime()),
      );
      if (clash) throw new BadRequestException('Salary terms overlap');
      if (open) {
        const closedTo = addDays(validFrom, -1);
        await tx.salaryTerms.update({
          where: { id: open.id },
          data: { validTo: closedTo },
        });
        await this.audit.recordChange(tx, {
          actorId: user.id,
          entityType: 'salary-terms',
          entityId: open.id,
          action: AuditAction.update,
          before: { validTo: open.validTo },
          after: { validTo: closedTo },
          fields: ['validTo'],
        });
      }
      const created = await tx.salaryTerms.create({
        data: {
          teacherId: teacher.id,
          validFrom,
          monthlyRate: new Prisma.Decimal(dto.monthlyRate),
          calendarKind: dto.calendarKind,
          note: dto.note?.trim() || null,
          createdById: user.id,
          rates: { create: rates },
          allowances: { create: allowances },
        },
        include: termsInclude,
      });
      await this.audit.recordChange(tx, {
        actorId: user.id,
        entityType: 'salary-terms',
        entityId: created.id,
        action: AuditAction.create,
        before: null,
        after: termsAudit(created),
        fields: TERMS_FIELDS,
      });
      return created.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateSalaryTermsDto, userId: string) {
    await this.findNotStarted(this.prisma, id);
    const rates = dto.rates ? await this.validateRates(dto.rates) : null;
    const allowances = dto.allowances
      ? this.validateAllowances(dto.allowances)
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SalaryTerms" WHERE id = ${id} FOR UPDATE`;
      const before = await this.findNotStarted(tx, id);
      if (rates) {
        await tx.salaryRate.deleteMany({ where: { termsId: id } });
        await tx.salaryRate.createMany({
          data: rates.map((rate) => ({ termsId: id, ...rate })),
        });
      }
      if (allowances) {
        await tx.salaryAllowance.deleteMany({ where: { termsId: id } });
        await tx.salaryAllowance.createMany({
          data: allowances.map((allowance) => ({ termsId: id, ...allowance })),
        });
      }
      await tx.salaryTerms.update({
        where: { id },
        data: {
          monthlyRate:
            dto.monthlyRate === undefined
              ? undefined
              : new Prisma.Decimal(dto.monthlyRate),
          calendarKind: dto.calendarKind,
          note: dto.note === undefined ? undefined : dto.note.trim() || null,
        },
      });
      const after = await tx.salaryTerms.findUnique({
        where: { id },
        include: termsInclude,
      });
      if (!after) throw new NotFoundException('Salary terms not found');
      await this.audit.recordChange(tx, {
        actorId: userId,
        entityType: 'salary-terms',
        entityId: id,
        action: AuditAction.update,
        before: termsAudit(before),
        after: termsAudit(after),
        fields: TERMS_FIELDS,
      });
    });
    return this.get(id);
  }

  async remove(id: string, userId: string) {
    await this.findNotStarted(this.prisma, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SalaryTerms" WHERE id = ${id} FOR UPDATE`;
      const row = await this.findNotStarted(tx, id);
      const previous = await tx.salaryTerms.findFirst({
        where: {
          teacherId: row.teacherId,
          validTo: addDays(row.validFrom, -1),
        },
        select: { id: true, validTo: true },
      });
      await tx.salaryTerms.updateMany({
        where: {
          teacherId: row.teacherId,
          validTo: addDays(row.validFrom, -1),
        },
        data: { validTo: row.validTo },
      });
      if (previous)
        await this.audit.recordChange(tx, {
          actorId: userId,
          entityType: 'salary-terms',
          entityId: previous.id,
          action: AuditAction.update,
          before: { validTo: previous.validTo },
          after: { validTo: row.validTo },
          fields: ['validTo'],
        });
      await tx.salaryTerms.delete({ where: { id } });
      await this.audit.recordChange(tx, {
        actorId: userId,
        entityType: 'salary-terms',
        entityId: id,
        action: AuditAction.delete,
        before: termsAudit(row),
        after: null,
        fields: TERMS_FIELDS,
      });
    });
    return { message: 'Salary terms deleted' };
  }

  async close(id: string, dto: CloseSalaryTermsDto, userId: string) {
    const row = await this.prisma.salaryTerms.findUnique({
      where: { id },
      include: termsInclude,
    });
    if (!row) throw new NotFoundException('Salary terms not found');
    if (row.validTo !== null)
      throw new BadRequestException('Salary terms are closed');
    const validTo = parseDay(dto.validTo);
    if (validTo.getTime() < row.validFrom.getTime())
      throw new BadRequestException('Invalid date range');
    const result = await this.prisma.salaryTerms.updateMany({
      where: { id, validTo: null },
      data: { validTo },
    });
    if (result.count === 0)
      throw new BadRequestException('Salary terms are closed');
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'salary-terms',
      entityId: id,
      action: AuditAction.update,
      before: termsAudit(row),
      after: termsAudit({ ...row, validTo }),
      fields: TERMS_FIELDS,
    });
    return this.get(id);
  }

  private async findNotStarted(db: Prisma.TransactionClient, id: string) {
    const row = await db.salaryTerms.findUnique({
      where: { id },
      include: termsInclude,
    });
    if (!row) throw new NotFoundException('Salary terms not found');
    if (row.validFrom.getTime() <= kyivToday().getTime())
      throw new BadRequestException('Started salary terms cannot be changed');
    return row;
  }

  private validateAllowances(allowances: SalaryAllowanceDto[]) {
    return allowances.map((allowance) => ({
      name: allowance.name.trim(),
      amount: positiveAmount(allowance.amount),
    }));
  }

  private async validateRates(rates: SalaryRateDto[]) {
    const keys = new Set<string>();
    const subjectIds = new Set<string>();
    const groupIds = new Set<string>();
    for (const rate of rates) {
      if (rate.subjectId && rate.lessonType !== PayrollLessonType.school_lesson)
        throw new BadRequestException('Subject rate must be a school lesson');
      if (
        rate.classGroupId &&
        rate.lessonType === PayrollLessonType.school_lesson
      )
        throw new BadRequestException('Rate does not match class group format');
      const key = `${rate.lessonType}:${rate.subjectId ?? ''}:${rate.classGroupId ?? ''}`;
      if (keys.has(key)) throw new BadRequestException('Duplicate salary rate');
      keys.add(key);
      if (rate.subjectId) subjectIds.add(rate.subjectId);
      if (rate.classGroupId) groupIds.add(rate.classGroupId);
    }
    const [subjects, groups] = await Promise.all([
      this.prisma.subject.findMany({
        where: { id: { in: [...subjectIds] } },
        select: { id: true },
      }),
      this.prisma.classGroup.findMany({
        where: { id: { in: [...groupIds] } },
        select: { id: true, format: true },
      }),
    ]);
    if (subjects.length !== subjectIds.size)
      throw new NotFoundException('Subject not found');
    const formats = new Map(groups.map((group) => [group.id, group.format]));
    for (const rate of rates) {
      if (!rate.classGroupId) continue;
      const format = formats.get(rate.classGroupId);
      if (!format) throw new NotFoundException('Class group not found');
      const expected =
        format === ClassFormat.individual
          ? PayrollLessonType.individual
          : PayrollLessonType.class_group;
      if (rate.lessonType !== expected)
        throw new BadRequestException('Rate does not match class group format');
    }
    return rates.map((rate) => ({
      lessonType: rate.lessonType,
      subjectId: rate.subjectId ?? null,
      classGroupId: rate.classGroupId ?? null,
      amount: new Prisma.Decimal(rate.amount),
    }));
  }
}
