import {
  CalendarDayType,
  CalendarScope,
  DailyStatus,
  GroupKind,
  NoticeStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import type {
  CalendarEntryLike,
  MarkLike,
  NoticeLike,
} from '../attendance/register-calc';
import {
  LIST_LIMIT,
  mealsByGroup,
  paymentsByMethod,
  pendingPayrollTeachers,
  previousMonth,
  type RegisterGroupInput,
  unmarkedGroups,
} from './dashboard-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = day('2026-10-16');
const saturday = day('2026-10-17');

const mark = (date: Date): MarkLike => ({
  date,
  status: DailyStatus.present,
  reasonId: null,
  voidedAt: null,
});

const notice = (start: Date, end: Date): NoticeLike => ({
  startDate: start,
  endDate: end,
  reasonId: 'r1',
  status: NoticeStatus.approved,
});

const group = (
  id: string,
  children: RegisterGroupInput['children'],
  kind: GroupKind = GroupKind.kindergarten,
): RegisterGroupInput => ({ id, name: `Group ${id}`, kind, children });

const unmarkedChild = { marks: [], notices: [] };
const markedChild = { marks: [mark(today)], notices: [] };

const nonWorking = (scope: CalendarScope): CalendarEntryLike => ({
  startDate: today,
  endDate: today,
  type: CalendarDayType.non_working,
  scope,
  groupId: null,
  title: 'Holiday',
  voidedAt: null,
});

describe('unmarkedGroups', () => {
  it('counts a working group with an unmarked child', () => {
    const result = unmarkedGroups(today, [group('a', [unmarkedChild])], []);
    expect(result).toEqual({ count: 1, names: ['Group a'], more: 0 });
  });

  it('is zero on a weekend', () => {
    const result = unmarkedGroups(saturday, [group('a', [unmarkedChild])], []);
    expect(result.count).toBe(0);
  });

  it('is zero when today is non-working for the group kind', () => {
    const entries = [nonWorking(CalendarScope.kindergarten)];
    const result = unmarkedGroups(
      today,
      [group('a', [unmarkedChild])],
      entries,
    );
    expect(result.count).toBe(0);
  });

  it('keeps a group of another kind when only one kind is non-working', () => {
    const entries = [nonWorking(CalendarScope.kindergarten)];
    const result = unmarkedGroups(
      today,
      [
        group('a', [unmarkedChild]),
        group('b', [unmarkedChild], GroupKind.school_class),
      ],
      entries,
    );
    expect(result.names).toEqual(['Group b']);
  });

  it('is zero when all children are marked', () => {
    const result = unmarkedGroups(
      today,
      [group('a', [markedChild, markedChild])],
      [],
    );
    expect(result.count).toBe(0);
  });

  it('does not count a child with an approved notice covering today', () => {
    const noticed = { marks: [], notices: [notice(today, today)] };
    const result = unmarkedGroups(today, [group('a', [noticed])], []);
    expect(result.count).toBe(0);
  });

  it('counts the group when one child is unmarked among marked ones', () => {
    const result = unmarkedGroups(
      today,
      [group('a', [markedChild, unmarkedChild])],
      [],
    );
    expect(result.count).toBe(1);
  });

  it('never counts a group without children', () => {
    expect(unmarkedGroups(today, [group('a', [])], []).count).toBe(0);
  });

  it('limits and sorts names and reports the remainder', () => {
    const groups = Array.from({ length: 12 }, (_, i) =>
      group(String(11 - i).padStart(2, '0'), [unmarkedChild]),
    );
    const result = unmarkedGroups(today, groups, []);
    expect(result.count).toBe(12);
    expect(result.names).toHaveLength(LIST_LIMIT);
    expect(result.names[0]).toBe('Group 00');
    expect(result.more).toBe(2);
  });
});

describe('paymentsByMethod', () => {
  it('sums by method and keys every method', () => {
    const result = paymentsByMethod([
      { method: PaymentMethod.cash, amount: new Prisma.Decimal('100.10') },
      { method: PaymentMethod.card, amount: new Prisma.Decimal('0.20') },
    ]);
    expect(result).toEqual({
      total: '100.30',
      count: 2,
      byMethod: {
        cash: '100.10',
        card: '0.20',
        bank_transfer: '0.00',
        online: '0.00',
      },
    });
  });

  it('returns zeros for no rows', () => {
    const result = paymentsByMethod([]);
    expect(result.total).toBe('0.00');
    expect(result.count).toBe(0);
    expect(result.byMethod.online).toBe('0.00');
  });
});

describe('mealsByGroup', () => {
  it('names a missing group and sorts by name', () => {
    const result = mealsByGroup([
      { group: 'Бджілки' },
      { group: null },
      { group: 'Айстри' },
      { group: 'Бджілки' },
    ]);
    expect(result).toEqual({
      count: 4,
      groups: [
        { name: 'Айстри', count: 1 },
        { name: 'Бджілки', count: 2 },
        { name: 'Без групи', count: 1 },
      ],
    });
  });
});

describe('pendingPayrollTeachers', () => {
  it('keeps teachers without an approved sheet', () => {
    const result = pendingPayrollTeachers([
      { id: '1', name: 'Борис', hasApprovedSheet: false },
      { id: '2', name: 'Анна', hasApprovedSheet: true },
      { id: '3', name: 'Андрій', hasApprovedSheet: false },
    ]);
    expect(result).toEqual({ count: 2, names: ['Андрій', 'Борис'], more: 0 });
  });

  it('limits names', () => {
    const teachers = Array.from({ length: 11 }, (_, i) => ({
      id: String(i),
      name: `T${String(i).padStart(2, '0')}`,
      hasApprovedSheet: false,
    }));
    const result = pendingPayrollTeachers(teachers);
    expect(result.names).toHaveLength(LIST_LIMIT);
    expect(result.more).toBe(1);
  });
});

describe('previousMonth', () => {
  it('returns the previous month of the same year', () => {
    expect(previousMonth(today)).toEqual({
      from: day('2026-09-01'),
      to: day('2026-09-30'),
      label: '09.2026',
    });
  });

  it('wraps January to the previous December', () => {
    expect(previousMonth(day('2026-01-05'))).toEqual({
      from: day('2025-12-01'),
      to: day('2025-12-31'),
      label: '12.2025',
    });
  });
});
