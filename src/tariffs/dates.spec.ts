import {
  addDays,
  dayCount,
  daysInMonth,
  firstDayOfMonth,
  isoDay,
  kyivToday,
  lastDayOfMonth,
  monthDay,
  overlaps,
  toDay,
  uaDay,
} from './dates';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('dates', () => {
  it('normalizes to UTC midnight', () => {
    expect(toDay('2026-10-15').toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(toDay(new Date('2026-10-15T17:45:00Z')).toISOString()).toBe(
      '2026-10-15T00:00:00.000Z',
    );
  });

  it('adds days across month ends', () => {
    expect(isoDay(addDays(day('2026-10-31'), 1))).toBe('2026-11-01');
    expect(isoDay(addDays(day('2026-03-01'), -1))).toBe('2026-02-28');
  });

  it('counts days inclusively', () => {
    expect(dayCount(day('2026-10-15'), day('2026-10-31'))).toBe(17);
    expect(dayCount(day('2026-10-15'), day('2026-10-15'))).toBe(1);
  });

  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(31);
  });

  it('clamps the day to the month length and handles month overflow', () => {
    expect(isoDay(monthDay(2026, 1, 31))).toBe('2026-02-28');
    expect(isoDay(monthDay(2028, 1, 31))).toBe('2028-02-29');
    expect(isoDay(monthDay(2026, 12, 15))).toBe('2027-01-15');
  });

  it('returns first and last day of month', () => {
    expect(isoDay(firstDayOfMonth(day('2026-10-15')))).toBe('2026-10-01');
    expect(isoDay(lastDayOfMonth(day('2026-02-10')))).toBe('2026-02-28');
  });

  it('formats Ukrainian dates', () => {
    expect(uaDay(day('2026-03-05'))).toBe('05.03.2026');
  });

  it('detects overlapping ranges with open ends', () => {
    expect(
      overlaps(day('2026-01-01'), day('2026-01-31'), day('2026-01-31'), null),
    ).toBe(true);
    expect(
      overlaps(day('2026-01-01'), day('2026-01-31'), day('2026-02-01'), null),
    ).toBe(false);
    expect(
      overlaps(day('2026-03-01'), null, day('2026-01-01'), day('2026-02-28')),
    ).toBe(false);
    expect(overlaps(day('2026-03-01'), null, day('2026-01-01'), null)).toBe(
      true,
    );
  });

  it('returns the Kyiv calendar day', () => {
    expect(isoDay(kyivToday(new Date('2026-10-11T22:30:00Z')))).toBe(
      '2026-10-12',
    );
    expect(isoDay(kyivToday(new Date('2026-12-31T21:59:00Z')))).toBe(
      '2026-12-31',
    );
  });
});
