import { BadRequestException } from '@nestjs/common';
import {
  CalendarDayType,
  CalendarScope,
  DailyStatus,
  GroupKind,
  NoticeStatus,
} from '@prisma/client';
import { addDays, dayCount, daysInMonth } from '../tariffs/dates';

export type DayState =
  | 'present'
  | 'absent'
  | 'expected_absent'
  | 'unmarked'
  | 'non_working';

export interface CalendarEntryLike {
  startDate: Date;
  endDate: Date;
  type: CalendarDayType;
  scope: CalendarScope;
  groupId: string | null;
  institutionId?: string | null;
  title: string;
  voidedAt: Date | null;
}

export interface GroupLike {
  id: string;
  kind: GroupKind;
  institutionId?: string | null;
}

export interface MarkLike {
  date: Date;
  status: DailyStatus;
  reasonId: string | null;
  voidedAt: Date | null;
}

export interface NoticeLike {
  startDate: Date;
  endDate: Date;
  reasonId: string;
  status: NoticeStatus;
}

export interface ResolvedDay {
  working: boolean;
  state: DayState;
  status: DailyStatus | null;
  reasonId: string | null;
  source: 'mark' | 'notice' | 'none';
}

export interface DaySummary {
  workingDays: number;
  present: number;
  absentExcused: number;
  absentUnexcused: number;
  expectedAbsent: number;
  unmarked: number;
}

const time = (day: Date) => day.getTime();

const covers = (start: Date, end: Date, day: Date) =>
  time(start) <= time(day) && time(day) <= time(end);

const level = (
  entry: CalendarEntryLike,
  group: GroupLike | null,
): number | null => {
  if (entry.scope === CalendarScope.all) return 1;
  if (!group) return null;
  if (entry.scope === CalendarScope.group)
    return entry.groupId === group.id ? 4 : null;
  if (entry.scope === CalendarScope.institution)
    return group.institutionId && entry.institutionId === group.institutionId
      ? 3
      : null;
  return String(entry.scope) === String(group.kind) ? 2 : null;
};

export function dayInfo(
  day: Date,
  group: GroupLike | null,
  entries: CalendarEntryLike[],
): { working: boolean; title: string | null } {
  let best: CalendarEntryLike | null = null;
  let bestLevel = 0;
  for (const entry of entries) {
    if (entry.voidedAt || !covers(entry.startDate, entry.endDate, day))
      continue;
    const entryLevel = level(entry, group);
    if (entryLevel === null) continue;
    const winsTie =
      entryLevel === bestLevel &&
      entry.type === CalendarDayType.non_working &&
      best?.type === CalendarDayType.working;
    if (entryLevel > bestLevel || winsTie) {
      best = entry;
      bestLevel = entryLevel;
    }
  }
  if (best)
    return {
      working: best.type === CalendarDayType.working,
      title: best.title,
    };
  const weekday = day.getUTCDay();
  return { working: weekday !== 0 && weekday !== 6, title: null };
}

export function resolveDay(
  day: Date,
  working: boolean,
  marks: MarkLike[],
  notices: NoticeLike[],
): ResolvedDay {
  const mark = marks.find((m) => !m.voidedAt && time(m.date) === time(day));
  if (mark) {
    return {
      working,
      state: mark.status === DailyStatus.absent ? 'absent' : 'present',
      status: mark.status,
      reasonId: mark.reasonId,
      source: 'mark',
    };
  }
  if (!working)
    return {
      working,
      state: 'non_working',
      status: null,
      reasonId: null,
      source: 'none',
    };
  const notice = notices.find(
    (n) =>
      n.status === NoticeStatus.approved && covers(n.startDate, n.endDate, day),
  );
  if (notice) {
    return {
      working,
      state: 'expected_absent',
      status: null,
      reasonId: notice.reasonId,
      source: 'notice',
    };
  }
  return {
    working,
    state: 'unmarked',
    status: null,
    reasonId: null,
    source: 'none',
  };
}

export function summarizeDays(
  days: ResolvedDay[],
  excusedReasonIds: ReadonlySet<string>,
): DaySummary {
  const count = (fn: (day: ResolvedDay) => boolean) => days.filter(fn).length;
  const excused = (day: ResolvedDay) =>
    day.reasonId !== null && excusedReasonIds.has(day.reasonId);
  return {
    workingDays: count((d) => d.working),
    present: count((d) => d.state === 'present'),
    absentExcused: count((d) => d.state === 'absent' && excused(d)),
    absentUnexcused: count((d) => d.state === 'absent' && !excused(d)),
    expectedAbsent: count((d) => d.state === 'expected_absent'),
    unmarked: count((d) => d.state === 'unmarked'),
  };
}

export const dayRange = (from: Date, to: Date): Date[] =>
  Array.from({ length: dayCount(from, to) }, (_, i) => addDays(from, i));

export function parseMonth(value: string): {
  from: Date;
  to: Date;
  days: Date[];
} {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12)
    throw new BadRequestException('Invalid month');
  const year = Number(match[1]);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month - 1, daysInMonth(year, month - 1)));
  return { from, to, days: dayRange(from, to) };
}
