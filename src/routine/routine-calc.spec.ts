import { BadRequestException } from '@nestjs/common';
import { CalendarDayType, CalendarScope, GroupKind } from '@prisma/client';
import {
  normalizeItems,
  resolveRoutine,
  versionBounds,
  versionOn,
} from './routine-calc';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const group = { id: 'g1', kind: GroupKind.kindergarten, institutionId: 'i1' };

const item = (startTime: string, endTime: string, title: string) => ({
  startTime,
  endTime,
  title,
});

describe('normalizeItems', () => {
  it('rejects an invalid time', () => {
    expect(() => normalizeItems([item('25:00', '26:00', 'x')])).toThrow(
      new BadRequestException('Invalid time range'),
    );
  });

  it('rejects end equal to start', () => {
    expect(() => normalizeItems([item('10:00', '10:00', 'x')])).toThrow(
      new BadRequestException('Invalid time range'),
    );
  });

  it('rejects end before start', () => {
    expect(() => normalizeItems([item('10:00', '09:00', 'x')])).toThrow(
      BadRequestException,
    );
  });

  it('keeps overlapping items ordered and trims titles', () => {
    const result = normalizeItems([
      item('09:10', '09:30', ' B '),
      item('08:00', '09:15', 'A'),
    ]);
    expect(result.map((i) => [i.title, i.sortOrder])).toEqual([
      ['A', 0],
      ['B', 1],
    ]);
  });

  it('orders equal starts by end then input order', () => {
    const result = normalizeItems([
      item('08:00', '09:00', 'late'),
      item('08:00', '08:30', 'short'),
      item('08:00', '08:30', 'short2'),
    ]);
    expect(result.map((i) => i.title)).toEqual(['short', 'short2', 'late']);
  });
});

describe('versionOn', () => {
  const versions = [
    { validFrom: d('2026-01-01'), validTo: d('2026-02-09') },
    { validFrom: d('2026-02-10'), validTo: null },
  ];

  it('switches exactly on validFrom', () => {
    expect(versionOn(versions, d('2026-02-09'))).toBe(versions[0]);
    expect(versionOn(versions, d('2026-02-10'))).toBe(versions[1]);
  });

  it('respects validTo and the start', () => {
    expect(versionOn([versions[0]], d('2026-02-10'))).toBeNull();
    expect(versionOn(versions, d('2025-12-31'))).toBeNull();
  });
});

describe('versionBounds', () => {
  const existing = [
    { id: 'a', validFrom: d('2026-01-01'), validTo: d('2026-02-09') },
    { id: 'b', validFrom: d('2026-02-10'), validTo: d('2026-04-30') },
    { id: 'c', validFrom: d('2026-05-01'), validTo: null },
  ];

  it('before all versions', () => {
    expect(versionBounds(existing, d('2025-06-01'))).toEqual({
      validTo: d('2025-12-31'),
      close: null,
    });
  });

  it('between versions closes the covering one', () => {
    expect(versionBounds(existing, d('2026-03-15'))).toEqual({
      validTo: d('2026-04-30'),
      close: { id: 'b', validTo: d('2026-03-14') },
    });
  });

  it('after all versions closes the open one', () => {
    expect(versionBounds(existing, d('2026-09-01'))).toEqual({
      validTo: null,
      close: { id: 'c', validTo: d('2026-08-31') },
    });
  });

  it('with no versions', () => {
    expect(versionBounds([], d('2026-09-01'))).toEqual({
      validTo: null,
      close: null,
    });
  });
});

describe('resolveRoutine', () => {
  const version = {
    validFrom: d('2026-10-01'),
    validTo: null,
    workingHours: '07:30-18:00',
    note: 'template note',
    items: [
      { weekday: 1, ...item('08:00', '09:00', 'Breakfast'), sortOrder: 0 },
      { weekday: 7, ...item('10:00', '11:00', 'Sunday'), sortOrder: 0 },
    ],
  };
  const holiday = {
    startDate: d('2026-10-14'),
    endDate: d('2026-10-14'),
    type: CalendarDayType.non_working,
    scope: CalendarScope.all,
    groupId: null,
    institutionId: null,
    title: 'Holiday',
    voidedAt: null,
  };

  const run = (
    from: string,
    to: string,
    extra: Partial<Parameters<typeof resolveRoutine>[0]> = {},
  ) =>
    resolveRoutine({
      from: d(from),
      to: d(to),
      group,
      entries: [],
      versions: [version],
      overrides: [],
      ...extra,
    });

  it('uses the template on a working day', () => {
    const [day] = run('2026-10-12', '2026-10-12');
    expect(day).toEqual({
      date: '2026-10-12',
      working: true,
      calendarTitle: null,
      source: 'template',
      workingHours: '07:30-18:00',
      note: 'template note',
      items: [item('08:00', '09:00', 'Breakfast')],
    });
  });

  it('shows none on a weekday without items', () => {
    const [day] = run('2026-10-13', '2026-10-13');
    expect(day.source).toBe('none');
    expect(day.items).toEqual([]);
    expect(day.workingHours).toBe('07:30-18:00');
  });

  it('shows none on Saturday without override', () => {
    const [day] = run('2026-10-17', '2026-10-17');
    expect(day.working).toBe(false);
    expect(day.source).toBe('none');
    expect(day.items).toEqual([]);
    expect(day.workingHours).toBeNull();
    expect(day.note).toBeNull();
  });

  it('maps Sunday to weekday 7 on a working Sunday', () => {
    const [day] = run('2026-10-18', '2026-10-18', {
      entries: [
        {
          ...holiday,
          startDate: d('2026-10-18'),
          endDate: d('2026-10-18'),
          type: CalendarDayType.working,
          title: 'Working Sunday',
        },
      ],
    });
    expect(day.working).toBe(true);
    expect(day.items).toEqual([item('10:00', '11:00', 'Sunday')]);
  });

  it('shows a holiday as non-working without items', () => {
    const [day] = run('2026-10-14', '2026-10-14', { entries: [holiday] });
    expect(day.working).toBe(false);
    expect(day.calendarTitle).toBe('Holiday');
    expect(day.source).toBe('none');
    expect(day.items).toEqual([]);
  });

  it('shows an override on a holiday', () => {
    const [day] = run('2026-10-14', '2026-10-14', {
      entries: [holiday],
      overrides: [
        {
          date: d('2026-10-14'),
          note: 'event',
          items: [{ ...item('10:00', '12:00', 'Party'), sortOrder: 0 }],
        },
      ],
    });
    expect(day.working).toBe(false);
    expect(day.source).toBe('override');
    expect(day.note).toBe('event');
    expect(day.items).toEqual([item('10:00', '12:00', 'Party')]);
    expect(day.workingHours).toBe('07:30-18:00');
  });

  it('shows an empty override on a working day', () => {
    const [day] = run('2026-10-12', '2026-10-12', {
      overrides: [{ date: d('2026-10-12'), note: null, items: [] }],
    });
    expect(day.source).toBe('override');
    expect(day.items).toEqual([]);
  });

  it('has no workingHours for an override before any version', () => {
    const [day] = run('2026-09-28', '2026-09-28', {
      overrides: [{ date: d('2026-09-28'), note: null, items: [] }],
    });
    expect(day.workingHours).toBeNull();
  });

  it('shows none before the first version', () => {
    const [day] = run('2026-09-28', '2026-09-28');
    expect(day.source).toBe('none');
    expect(day.workingHours).toBeNull();
    expect(day.note).toBeNull();
  });

  it('returns one view per day in order', () => {
    expect(run('2026-10-12', '2026-10-14').map((x) => x.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
  });
});
