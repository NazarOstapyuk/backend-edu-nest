import { LessonChangeType, LessonStatus, WeekParity } from '@prisma/client';
import type { DayState } from '../attendance/register-calc';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VersionLike {
  validFrom: Date;
  validTo: Date | null;
}

export interface EntryLike {
  weekday: number;
  period: number;
  parity: WeekParity;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  subgroupId: string | null;
}

export interface ChangeLike {
  id: string;
  period: number;
  subgroupId: string | null;
  type: LessonChangeType;
  subjectId: string | null;
  teacherId: string | null;
  roomId: string | null;
  voidedAt: Date | null;
}

export interface PeriodLike {
  number: number;
  startTime: string;
  endTime: string;
}

export type SlotSource = 'timetable' | 'replace' | 'extra';

export interface Slot {
  period: number;
  startTime: string;
  endTime: string;
  subgroupId: string | null;
  subjectId: string;
  teacherId: string;
  roomId: string | null;
  source: SlotSource;
  cancelled: boolean;
  changeId: string | null;
}

export interface ConflictItem {
  ref: string;
  bucket: string;
  parity: WeekParity;
  start: number;
  end: number;
  groupId: string;
  teacherId: string;
  roomId: string | null;
  subgroupId: string | null;
  memberIds: readonly string[];
  isNew: boolean;
}

export type ConflictKind = 'teacher' | 'room' | 'class' | 'subgroup';

export interface Conflict {
  kind: ConflictKind;
  a: string;
  b: string;
}

export interface PupilState {
  status: LessonStatus | null;
  reasonId: string | null;
  source: 'mark' | 'register' | 'none';
}

export const isoWeekday = (day: Date): number =>
  ((day.getUTCDay() + 6) % 7) + 1;

export function isoWeekParity(day: Date): 'odd' | 'even' {
  const thursday = new Date(day.getTime() + (4 - isoWeekday(day)) * DAY_MS);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
  return week % 2 === 1 ? 'odd' : 'even';
}

export const versionOn = <T extends VersionLike>(
  versions: T[],
  day: Date,
): T | null =>
  versions.find(
    (v) =>
      v.validFrom.getTime() <= day.getTime() &&
      (v.validTo === null || day.getTime() <= v.validTo.getTime()),
  ) ?? null;

const parityMatches = (parity: WeekParity, day: Date) =>
  parity === WeekParity.every || String(parity) === isoWeekParity(day);

export function slotsForDay(
  day: Date,
  input: {
    working: boolean;
    entries: EntryLike[];
    changes: ChangeLike[];
    periods: PeriodLike[];
  },
): Slot[] {
  if (!input.working) return [];
  const make = (
    period: number,
    fields: Pick<Slot, 'subgroupId' | 'subjectId' | 'teacherId' | 'roomId'>,
    source: SlotSource,
    changeId: string | null,
  ): Slot => {
    const bell = input.periods.find((p) => p.number === period);
    return {
      period,
      startTime: bell?.startTime ?? '',
      endTime: bell?.endTime ?? '',
      ...fields,
      source,
      cancelled: false,
      changeId,
    };
  };
  const weekday = isoWeekday(day);
  const slots = input.entries
    .filter((e) => e.weekday === weekday && parityMatches(e.parity, day))
    .map((e) =>
      make(
        e.period,
        {
          subgroupId: e.subgroupId,
          subjectId: e.subjectId,
          teacherId: e.teacherId,
          roomId: e.roomId,
        },
        'timetable',
        null,
      ),
    );
  for (const change of input.changes) {
    if (change.voidedAt) continue;
    const target = slots.find(
      (s) =>
        !s.cancelled &&
        s.period === change.period &&
        s.subgroupId === change.subgroupId,
    );
    if (change.type === LessonChangeType.cancel) {
      if (target) {
        target.cancelled = true;
        target.changeId = change.id;
      }
      continue;
    }
    if (change.type === LessonChangeType.replace) {
      if (target) {
        target.subjectId = change.subjectId ?? target.subjectId;
        target.teacherId = change.teacherId ?? target.teacherId;
        target.roomId = change.roomId ?? target.roomId;
        target.source = 'replace';
        target.changeId = change.id;
      }
      continue;
    }
    if (change.subjectId && change.teacherId) {
      slots.push(
        make(
          change.period,
          {
            subgroupId: change.subgroupId,
            subjectId: change.subjectId,
            teacherId: change.teacherId,
            roomId: change.roomId,
          },
          'extra',
          change.id,
        ),
      );
    }
  }
  const rank = (s: Slot) => (s.subgroupId === null ? 0 : 1);
  return slots.sort((a, b) => a.period - b.period || rank(a) - rank(b));
}

export const toMinutes = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

const parityOverlap = (a: WeekParity, b: WeekParity) =>
  a === WeekParity.every || b === WeekParity.every || a === b;

function conflictKind(a: ConflictItem, b: ConflictItem): ConflictKind | null {
  if (a.groupId === b.groupId) {
    if (
      a.subgroupId === null ||
      b.subgroupId === null ||
      a.subgroupId === b.subgroupId
    )
      return 'class';
    if (a.memberIds.some((id) => b.memberIds.includes(id))) return 'subgroup';
  }
  if (a.teacherId === b.teacherId) return 'teacher';
  if (a.roomId !== null && a.roomId === b.roomId) return 'room';
  return null;
}

export function findConflicts(items: ConflictItem[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!a.isNew && !b.isNew) continue;
      if (a.bucket !== b.bucket || !parityOverlap(a.parity, b.parity)) continue;
      if (!(a.start < b.end && b.start < a.end)) continue;
      const kind = conflictKind(a, b);
      if (kind) conflicts.push({ kind, a: a.ref, b: b.ref });
    }
  }
  return conflicts;
}

export function pupilState(
  dayState: DayState | null,
  dayReasonId: string | null,
  mark: {
    status: LessonStatus;
    reasonId: string | null;
    voidedAt: Date | null;
  } | null,
): PupilState {
  if (mark && !mark.voidedAt)
    return { status: mark.status, reasonId: mark.reasonId, source: 'mark' };
  if (dayState === 'absent' || dayState === 'expected_absent')
    return {
      status: LessonStatus.absent,
      reasonId: dayReasonId,
      source: 'register',
    };
  return { status: null, reasonId: null, source: 'none' };
}

export function checkBellPeriods(
  periods: PeriodLike[],
): 'Invalid bell time' | 'Bell periods overlap' | null {
  if (periods.some((p) => toMinutes(p.startTime) >= toMinutes(p.endTime)))
    return 'Invalid bell time';
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].number === sorted[i - 1].number)
      return 'Bell periods overlap';
    if (toMinutes(sorted[i].startTime) < toMinutes(sorted[i - 1].endTime))
      return 'Bell periods overlap';
  }
  return null;
}
