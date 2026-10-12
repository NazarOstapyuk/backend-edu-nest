import { LessonChangeType, LessonStatus, WeekParity } from '@prisma/client';
import {
  type ChangeLike,
  type ConflictItem,
  type EntryLike,
  checkBellPeriods,
  findConflicts,
  isoWeekParity,
  isoWeekday,
  pupilState,
  slotsForDay,
  toMinutes,
  versionOn,
} from './schedule-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const periods = [
  { number: 1, startTime: '08:30', endTime: '09:15' },
  { number: 2, startTime: '09:25', endTime: '10:10' },
  { number: 3, startTime: '10:30', endTime: '11:15' },
];

const entry = (over: Partial<EntryLike> = {}): EntryLike => ({
  weekday: 1,
  period: 1,
  parity: WeekParity.every,
  subjectId: 'math',
  teacherId: 't1',
  roomId: 'r1',
  subgroupId: null,
  ...over,
});

const change = (over: Partial<ChangeLike>): ChangeLike => ({
  id: 'ch1',
  period: 1,
  subgroupId: null,
  type: LessonChangeType.cancel,
  subjectId: null,
  teacherId: null,
  roomId: null,
  voidedAt: null,
  ...over,
});

describe('weeks', () => {
  it('numbers weekdays from Monday', () => {
    expect(isoWeekday(day('2026-10-12'))).toBe(1);
    expect(isoWeekday(day('2026-10-17'))).toBe(6);
    expect(isoWeekday(day('2026-10-18'))).toBe(7);
  });

  it('uses ISO week numbers for parity', () => {
    expect(isoWeekParity(day('2026-10-12'))).toBe('even');
    expect(isoWeekParity(day('2026-10-18'))).toBe('even');
    expect(isoWeekParity(day('2026-10-19'))).toBe('odd');
    expect(isoWeekParity(day('2025-12-29'))).toBe('odd');
    expect(isoWeekParity(day('2026-12-31'))).toBe('odd');
    expect(isoWeekParity(day('2027-01-04'))).toBe('odd');
  });

  it('picks the version valid on a day', () => {
    const v1 = {
      id: 'v1',
      validFrom: day('2026-09-01'),
      validTo: day('2026-10-31'),
    };
    const v2 = { id: 'v2', validFrom: day('2026-11-01'), validTo: null };
    expect(versionOn([v1, v2], day('2026-10-31'))?.id).toBe('v1');
    expect(versionOn([v1, v2], day('2026-11-01'))?.id).toBe('v2');
    expect(versionOn([v1, v2], day('2026-08-31'))).toBeNull();
  });
});

describe('slotsForDay', () => {
  const monday = day('2026-10-12');

  it('returns nothing on a non-working day', () => {
    expect(
      slotsForDay(monday, {
        working: false,
        entries: [entry()],
        changes: [],
        periods,
      }),
    ).toEqual([]);
  });

  it('takes entries of the weekday with matching parity and bell times', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [
        entry({ period: 2 }),
        entry({ period: 1, parity: WeekParity.odd, subjectId: 'art' }),
        entry({ period: 1, parity: WeekParity.even, subjectId: 'music' }),
        entry({ weekday: 2, subjectId: 'pe' }),
      ],
      changes: [],
      periods,
    });
    expect(
      slots.map((s) => [s.period, s.subjectId, s.startTime, s.endTime]),
    ).toEqual([
      [1, 'music', '08:30', '09:15'],
      [2, 'math', '09:25', '10:10'],
    ]);
  });

  it('orders the whole class before subgroups in a period', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [
        entry({ subgroupId: 'g-a', subjectId: 'eng' }),
        entry({ period: 1 }),
      ],
      changes: [],
      periods,
    });
    expect(slots.map((s) => s.subgroupId)).toEqual([null, 'g-a']);
  });

  it('applies cancel, replace and extra, ignoring voided changes', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [entry({ period: 1 }), entry({ period: 2, subjectId: 'read' })],
      changes: [
        change({ id: 'c1', period: 1, type: LessonChangeType.cancel }),
        change({
          id: 'c2',
          period: 2,
          type: LessonChangeType.replace,
          teacherId: 't9',
        }),
        change({
          id: 'c3',
          period: 3,
          type: LessonChangeType.extra,
          subjectId: 'art',
          teacherId: 't2',
        }),
        change({
          id: 'c4',
          period: 2,
          type: LessonChangeType.cancel,
          voidedAt: new Date(),
        }),
      ],
      periods,
    });
    expect(slots).toEqual([
      {
        period: 1,
        startTime: '08:30',
        endTime: '09:15',
        subgroupId: null,
        subjectId: 'math',
        teacherId: 't1',
        roomId: 'r1',
        source: 'timetable',
        cancelled: true,
        changeId: 'c1',
      },
      {
        period: 2,
        startTime: '09:25',
        endTime: '10:10',
        subgroupId: null,
        subjectId: 'read',
        teacherId: 't9',
        roomId: 'r1',
        source: 'replace',
        cancelled: false,
        changeId: 'c2',
      },
      {
        period: 3,
        startTime: '10:30',
        endTime: '11:15',
        subgroupId: null,
        subjectId: 'art',
        teacherId: 't2',
        roomId: null,
        source: 'extra',
        cancelled: false,
        changeId: 'c3',
      },
    ]);
  });

  it('matches changes by period and subgroup', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [
        entry({ subgroupId: 'g-a' }),
        entry({ subgroupId: 'g-b', teacherId: 't2' }),
      ],
      changes: [change({ subgroupId: 'g-b' })],
      periods,
    });
    expect(slots.map((s) => [s.subgroupId, s.cancelled])).toEqual([
      ['g-a', false],
      ['g-b', true],
    ]);
  });

  it('moves a lesson as cancel plus extra', () => {
    const slots = slotsForDay(monday, {
      working: true,
      entries: [entry({ period: 1 })],
      changes: [
        change({ id: 'c1', period: 1 }),
        change({
          id: 'c2',
          period: 3,
          type: LessonChangeType.extra,
          subjectId: 'math',
          teacherId: 't1',
        }),
      ],
      periods,
    });
    expect(slots.filter((s) => !s.cancelled).map((s) => s.period)).toEqual([3]);
  });
});

describe('findConflicts', () => {
  const item = (over: Partial<ConflictItem>): ConflictItem => ({
    ref: 'x',
    bucket: '1',
    parity: WeekParity.every,
    start: toMinutes('08:30'),
    end: toMinutes('09:15'),
    groupId: 'g1',
    teacherId: 't1',
    roomId: null,
    subgroupId: null,
    memberIds: [],
    isNew: true,
    ...over,
  });

  it('detects a teacher busy in two classes by real time, not period number', () => {
    const a = item({ ref: 'a', groupId: 'g1' });
    const b = item({
      ref: 'b',
      groupId: 'g2',
      isNew: false,
      start: toMinutes('09:00'),
      end: toMinutes('09:40'),
    });
    expect(findConflicts([a, b])).toEqual([
      { kind: 'teacher', a: 'a', b: 'b' },
    ]);
  });

  it('ignores touching intervals, other buckets and pairs of existing items', () => {
    const a = item({ ref: 'a' });
    const touching = item({
      ref: 'b',
      groupId: 'g2',
      start: toMinutes('09:15'),
      end: toMinutes('10:00'),
    });
    const otherDay = item({ ref: 'c', groupId: 'g2', bucket: '2' });
    const old1 = item({
      ref: 'd',
      groupId: 'g3',
      teacherId: 't5',
      isNew: false,
    });
    const old2 = item({
      ref: 'e',
      groupId: 'g4',
      teacherId: 't5',
      isNew: false,
    });
    expect(findConflicts([a, touching, otherDay, old1, old2])).toEqual([]);
  });

  it('treats every as overlapping both parities and odd vs even as disjoint', () => {
    const odd = item({ ref: 'odd', parity: WeekParity.odd });
    const even = item({ ref: 'even', groupId: 'g2', parity: WeekParity.even });
    const every = item({
      ref: 'every',
      groupId: 'g3',
      parity: WeekParity.every,
      isNew: false,
    });
    expect(findConflicts([odd, even, every])).toEqual([
      { kind: 'teacher', a: 'odd', b: 'every' },
      { kind: 'teacher', a: 'even', b: 'every' },
    ]);
  });

  it('detects room double booking', () => {
    const a = item({ ref: 'a', roomId: 'r1' });
    const b = item({ ref: 'b', groupId: 'g2', teacherId: 't2', roomId: 'r1' });
    expect(findConflicts([a, b])).toEqual([{ kind: 'room', a: 'a', b: 'b' }]);
  });

  it('detects a class booked twice and a whole-class lesson over a subgroup', () => {
    const whole = item({ ref: 'whole' });
    const sub = item({
      ref: 'sub',
      teacherId: 't2',
      subgroupId: 's1',
      memberIds: ['c1'],
    });
    expect(findConflicts([whole, sub])).toEqual([
      { kind: 'class', a: 'whole', b: 'sub' },
    ]);
  });

  it('allows disjoint subgroups and rejects intersecting ones', () => {
    const a = item({ ref: 'a', subgroupId: 's1', memberIds: ['c1', 'c2'] });
    const b = item({
      ref: 'b',
      teacherId: 't2',
      subgroupId: 's2',
      memberIds: ['c3'],
    });
    const c = item({
      ref: 'c',
      teacherId: 't3',
      subgroupId: 's3',
      memberIds: ['c2'],
    });
    expect(findConflicts([a, b, c])).toEqual([
      { kind: 'subgroup', a: 'a', b: 'c' },
    ]);
  });

  it('reports one teacher teaching two subgroups at once', () => {
    const a = item({ ref: 'a', subgroupId: 's1', memberIds: ['c1'] });
    const b = item({ ref: 'b', subgroupId: 's2', memberIds: ['c2'] });
    expect(findConflicts([a, b])).toEqual([
      { kind: 'teacher', a: 'a', b: 'b' },
    ]);
  });
});

describe('pupilState', () => {
  it('lets the lesson mark win over the register', () => {
    expect(
      pupilState('absent', 'sick', {
        status: LessonStatus.present,
        reasonId: null,
        voidedAt: null,
      }),
    ).toEqual({
      status: LessonStatus.present,
      reasonId: null,
      source: 'mark',
    });
  });

  it('shows register absences and expected absences as absent', () => {
    expect(pupilState('absent', 'sick', null)).toEqual({
      status: LessonStatus.absent,
      reasonId: 'sick',
      source: 'register',
    });
    expect(pupilState('expected_absent', 'trip', null)).toEqual({
      status: LessonStatus.absent,
      reasonId: 'trip',
      source: 'register',
    });
  });

  it('is unmarked otherwise and ignores voided marks', () => {
    expect(pupilState('present', null, null)).toEqual({
      status: null,
      reasonId: null,
      source: 'none',
    });
    expect(
      pupilState('unmarked', null, {
        status: LessonStatus.absent,
        reasonId: null,
        voidedAt: new Date(),
      }),
    ).toEqual({
      status: null,
      reasonId: null,
      source: 'none',
    });
    expect(pupilState(null, null, null).source).toBe('none');
  });
});

describe('checkBellPeriods', () => {
  it('accepts ordered non-overlapping periods', () => {
    expect(checkBellPeriods(periods)).toBeNull();
  });

  it('rejects inverted times and overlaps or duplicate numbers', () => {
    expect(
      checkBellPeriods([{ number: 1, startTime: '09:00', endTime: '09:00' }]),
    ).toBe('Invalid bell time');
    expect(
      checkBellPeriods([
        ...periods,
        { number: 4, startTime: '11:00', endTime: '11:40' },
      ]),
    ).toBe('Bell periods overlap');
    expect(checkBellPeriods([periods[0], { ...periods[1], number: 1 }])).toBe(
      'Bell periods overlap',
    );
  });
});
