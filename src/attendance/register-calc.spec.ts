import { BadRequestException } from '@nestjs/common';
import {
  CalendarDayType,
  CalendarScope,
  DailyStatus,
  GroupKind,
  NoticeStatus,
} from '@prisma/client';
import {
  type CalendarEntryLike,
  dayInfo,
  dayRange,
  parseMonth,
  resolveDay,
  summarizeDays,
} from './register-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const kg = { id: 'g1', kind: GroupKind.kindergarten };
const school = { id: 'g2', kind: GroupKind.school_class };

const entry = (over: Partial<CalendarEntryLike>): CalendarEntryLike => ({
  startDate: day('2026-10-14'),
  endDate: day('2026-10-14'),
  type: CalendarDayType.non_working,
  scope: CalendarScope.all,
  groupId: null,
  title: 'Свято',
  voidedAt: null,
  ...over,
});

describe('dayInfo', () => {
  it('treats Monday to Friday as working and weekends as not', () => {
    expect(dayInfo(day('2026-10-12'), kg, [])).toEqual({
      working: true,
      title: null,
    });
    expect(dayInfo(day('2026-10-17'), kg, [])).toEqual({
      working: false,
      title: null,
    });
    expect(dayInfo(day('2026-10-18'), kg, [])).toEqual({
      working: false,
      title: null,
    });
  });

  it('applies a non-working period for everyone', () => {
    const holiday = entry({
      startDate: day('2026-10-13'),
      endDate: day('2026-10-15'),
    });
    expect(dayInfo(day('2026-10-14'), kg, [holiday])).toEqual({
      working: false,
      title: 'Свято',
    });
    expect(dayInfo(day('2026-10-16'), kg, [holiday]).working).toBe(true);
  });

  it('ignores voided entries', () => {
    expect(
      dayInfo(day('2026-10-14'), kg, [entry({ voidedAt: new Date() })]).working,
    ).toBe(true);
  });

  it('applies a group-kind entry only to that kind', () => {
    const vacation = entry({
      scope: CalendarScope.school_class,
      title: 'Канікули',
    });
    expect(dayInfo(day('2026-10-14'), school, [vacation]).working).toBe(false);
    expect(dayInfo(day('2026-10-14'), kg, [vacation]).working).toBe(true);
  });

  it('lets a group entry override a kind entry and a kind entry override an all entry', () => {
    const all = entry({ title: 'Свято' });
    const kindWorking = entry({
      type: CalendarDayType.working,
      scope: CalendarScope.kindergarten,
      title: 'Чергова група',
    });
    const groupOff = entry({
      scope: CalendarScope.group,
      groupId: 'g1',
      title: 'Карантин',
    });
    expect(dayInfo(day('2026-10-14'), kg, [all, kindWorking])).toEqual({
      working: true,
      title: 'Чергова група',
    });
    expect(
      dayInfo(day('2026-10-14'), kg, [all, kindWorking, groupOff]),
    ).toEqual({ working: false, title: 'Карантин' });
    expect(dayInfo(day('2026-10-14'), school, [all, kindWorking]).working).toBe(
      false,
    );
  });

  it('makes a weekend working by a transfer for one group only', () => {
    const transfer = entry({
      startDate: day('2026-10-17'),
      endDate: day('2026-10-17'),
      type: CalendarDayType.working,
      scope: CalendarScope.group,
      groupId: 'g1',
      title: 'Робоча субота',
    });
    expect(dayInfo(day('2026-10-17'), kg, [transfer])).toEqual({
      working: true,
      title: 'Робоча субота',
    });
    expect(dayInfo(day('2026-10-17'), school, [transfer]).working).toBe(false);
  });

  it('prefers non-working when both types exist on the same level', () => {
    const working = entry({ type: CalendarDayType.working, title: 'Робочий' });
    const off = entry({ title: 'Вихідний' });
    expect(dayInfo(day('2026-10-14'), kg, [working, off])).toEqual({
      working: false,
      title: 'Вихідний',
    });
    expect(dayInfo(day('2026-10-14'), kg, [off, working])).toEqual({
      working: false,
      title: 'Вихідний',
    });
  });

  it('applies only all-scope entries when the child has no group', () => {
    const kindOff = entry({ scope: CalendarScope.kindergarten });
    expect(dayInfo(day('2026-10-14'), null, [kindOff]).working).toBe(true);
    expect(dayInfo(day('2026-10-14'), null, [entry({})]).working).toBe(false);
  });
});

describe('resolveDay', () => {
  const d = day('2026-10-14');
  const approved = {
    startDate: day('2026-10-13'),
    endDate: day('2026-10-15'),
    reasonId: 'sick',
    status: NoticeStatus.approved,
  };

  it('returns unmarked for a working day without data', () => {
    expect(resolveDay(d, true, [], [])).toEqual({
      working: true,
      state: 'unmarked',
      status: null,
      reasonId: null,
      source: 'none',
    });
  });

  it('returns non_working for a day off without a mark', () => {
    expect(resolveDay(d, false, [], [approved]).state).toBe('non_working');
  });

  it('uses an approved notice as expected absence', () => {
    expect(resolveDay(d, true, [], [approved])).toEqual({
      working: true,
      state: 'expected_absent',
      status: null,
      reasonId: 'sick',
      source: 'notice',
    });
  });

  it('ignores pending, rejected and cancelled notices', () => {
    const others = [
      NoticeStatus.pending,
      NoticeStatus.rejected,
      NoticeStatus.cancelled,
    ].map((status) => ({ ...approved, status }));
    expect(resolveDay(d, true, [], others).state).toBe('unmarked');
  });

  it('lets a mark win over an approved notice', () => {
    const mark = {
      date: d,
      status: DailyStatus.present,
      reasonId: null,
      voidedAt: null,
    };
    expect(resolveDay(d, true, [mark], [approved])).toEqual({
      working: true,
      state: 'present',
      status: DailyStatus.present,
      reasonId: null,
      source: 'mark',
    });
  });

  it('counts late and left early as present and keeps the absence reason', () => {
    expect(
      resolveDay(
        d,
        true,
        [{ date: d, status: DailyStatus.late, reasonId: null, voidedAt: null }],
        [],
      ).state,
    ).toBe('present');
    expect(
      resolveDay(
        d,
        true,
        [
          {
            date: d,
            status: DailyStatus.left_early,
            reasonId: null,
            voidedAt: null,
          },
        ],
        [],
      ).state,
    ).toBe('present');
    expect(
      resolveDay(
        d,
        true,
        [
          {
            date: d,
            status: DailyStatus.absent,
            reasonId: 'sick',
            voidedAt: null,
          },
        ],
        [],
      ),
    ).toMatchObject({ state: 'absent', reasonId: 'sick' });
  });

  it('ignores voided marks and marks of other days', () => {
    const voided = {
      date: d,
      status: DailyStatus.present,
      reasonId: null,
      voidedAt: new Date(),
    };
    const otherDay = {
      date: day('2026-10-13'),
      status: DailyStatus.present,
      reasonId: null,
      voidedAt: null,
    };
    expect(resolveDay(d, true, [voided, otherDay], []).state).toBe('unmarked');
  });

  it('keeps a mark on a day that became non-working', () => {
    const mark = {
      date: d,
      status: DailyStatus.present,
      reasonId: null,
      voidedAt: null,
    };
    expect(resolveDay(d, false, [mark], [])).toEqual({
      working: false,
      state: 'present',
      status: DailyStatus.present,
      reasonId: null,
      source: 'mark',
    });
  });
});

describe('summarizeDays', () => {
  it('counts each state, splitting absences by excused reasons', () => {
    const base = { status: null, source: 'none' as const };
    const days = [
      { ...base, working: true, state: 'present' as const, reasonId: null },
      { ...base, working: true, state: 'absent' as const, reasonId: 'sick' },
      { ...base, working: true, state: 'absent' as const, reasonId: 'none' },
      { ...base, working: true, state: 'absent' as const, reasonId: null },
      {
        ...base,
        working: true,
        state: 'expected_absent' as const,
        reasonId: 'sick',
      },
      { ...base, working: true, state: 'unmarked' as const, reasonId: null },
      {
        ...base,
        working: false,
        state: 'non_working' as const,
        reasonId: null,
      },
    ];
    expect(summarizeDays(days, new Set(['sick']))).toEqual({
      workingDays: 6,
      present: 1,
      absentExcused: 1,
      absentUnexcused: 2,
      expectedAbsent: 1,
      unmarked: 1,
    });
  });
});

describe('dayRange and parseMonth', () => {
  it('lists every day inclusive', () => {
    expect(
      dayRange(day('2026-10-30'), day('2026-11-02')).map((d) =>
        d.toISOString().slice(0, 10),
      ),
    ).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('parses a month into its days', () => {
    const feb = parseMonth('2028-02');
    expect(feb.from).toEqual(day('2028-02-01'));
    expect(feb.to).toEqual(day('2028-02-29'));
    expect(feb.days).toHaveLength(29);
  });

  it('rejects malformed months', () => {
    for (const value of ['2026-13', '2026-1', 'abc', '']) {
      expect(() => parseMonth(value)).toThrow(
        new BadRequestException('Invalid month'),
      );
    }
  });
});
