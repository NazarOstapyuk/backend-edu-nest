import { Prisma } from '@prisma/client';
import { isoDay } from '../tariffs/dates';

export const termsInclude = {
  rates: {
    include: {
      subject: { select: { name: true } },
      classGroup: { select: { name: true } },
    },
    orderBy: [{ lessonType: 'asc' }, { id: 'asc' }],
  },
  allowances: { orderBy: [{ name: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SalaryTermsInclude;

type TermsRow = Prisma.SalaryTermsGetPayload<{ include: typeof termsInclude }>;

export const toTermsView = (row: TermsRow, today: Date) => ({
  id: row.id,
  teacherId: row.teacherId,
  validFrom: isoDay(row.validFrom),
  validTo: row.validTo ? isoDay(row.validTo) : null,
  monthlyRate: row.monthlyRate.toFixed(2),
  extraHourRate: row.extraHourRate ? row.extraHourRate.toFixed(2) : null,
  calendarKind: row.calendarKind,
  note: row.note,
  started: row.validFrom.getTime() <= today.getTime(),
  createdAt: row.createdAt.toISOString(),
  rates: row.rates.map((rate) => ({
    id: rate.id,
    lessonType: rate.lessonType,
    subjectId: rate.subjectId,
    subjectName: rate.subject?.name ?? null,
    classGroupId: rate.classGroupId,
    classGroupName: rate.classGroup?.name ?? null,
    amount: rate.amount.toFixed(2),
  })),
  allowances: row.allowances.map((allowance) => ({
    id: allowance.id,
    name: allowance.name,
    amount: allowance.amount.toFixed(2),
  })),
});
