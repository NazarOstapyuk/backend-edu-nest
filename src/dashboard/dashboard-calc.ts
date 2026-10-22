import { GroupKind, PaymentMethod, Prisma } from '@prisma/client';
import {
  type CalendarEntryLike,
  dayInfo,
  type MarkLike,
  type NoticeLike,
  resolveDay,
} from '../attendance/register-calc';
import { formatMoney, sumMoney } from '../finance/finance-calc';
import { daysInMonth, monthDay } from '../tariffs/dates';

export const PENDING_ONLINE_MINUTES = 15;
export const LIST_LIMIT = 10;

export interface RegisterGroupInput {
  id: string;
  name: string;
  kind: GroupKind;
  institutionId?: string | null;
  children: { marks: MarkLike[]; notices: NoticeLike[] }[];
}

interface NamedList {
  count: number;
  names: string[];
  more: number;
}

const namedList = (names: string[]): NamedList => {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return {
    count: sorted.length,
    names: sorted.slice(0, LIST_LIMIT),
    more: Math.max(0, sorted.length - LIST_LIMIT),
  };
};

export function unmarkedGroups(
  today: Date,
  groups: RegisterGroupInput[],
  entries: CalendarEntryLike[],
): NamedList {
  const names = groups
    .filter((group) => {
      const { working } = dayInfo(today, group, entries);
      return (
        working &&
        group.children.some(
          (child) =>
            resolveDay(today, working, child.marks, child.notices).state ===
            'unmarked',
        )
      );
    })
    .map((group) => group.name);
  return namedList(names);
}

export function paymentsByMethod(
  rows: { method: PaymentMethod; amount: Prisma.Decimal }[],
): { total: string; count: number; byMethod: Record<PaymentMethod, string> } {
  const byMethod = {} as Record<PaymentMethod, string>;
  for (const method of Object.values(PaymentMethod)) {
    byMethod[method] = formatMoney(
      sumMoney(rows.filter((r) => r.method === method).map((r) => r.amount)),
    );
  }
  return {
    total: formatMoney(sumMoney(rows.map((r) => r.amount))),
    count: rows.length,
    byMethod,
  };
}

export function mealsByGroup(rows: { group: string | null }[]): {
  count: number;
  groups: { name: string; count: number }[];
} {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.group ?? 'Без групи';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const groups = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { count: rows.length, groups };
}

export function pendingPayrollTeachers(
  teachers: { id: string; name: string; hasApprovedSheet: boolean }[],
): NamedList {
  return namedList(
    teachers.filter((t) => !t.hasApprovedSheet).map((t) => t.name),
  );
}

export function previousMonth(today: Date): {
  from: Date;
  to: Date;
  label: string;
} {
  const index = today.getUTCFullYear() * 12 + today.getUTCMonth() - 1;
  const year = Math.floor(index / 12);
  const month = index % 12;
  return {
    from: monthDay(year, month, 1),
    to: monthDay(year, month, daysInMonth(year, month)),
    label: `${String(month + 1).padStart(2, '0')}.${year}`,
  };
}
