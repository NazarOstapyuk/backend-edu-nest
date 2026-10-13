import {
  copyTarget,
  deadlineFor,
  isBeforeDeadline,
  mondayOf,
  parseTime,
  priceOn,
  resolveChoices,
  templateWeek,
} from './meals-calc';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('parseTime', () => {
  it('parses HH:MM', () => {
    expect(parseTime('10:00')).toBe(600);
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
  });

  it('rejects malformed values', () => {
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('9:00')).toBeNull();
    expect(parseTime('10:60')).toBeNull();
    expect(parseTime('ab:cd')).toBeNull();
  });
});

describe('deadlineFor', () => {
  it('uses summer time (UTC+3)', () => {
    expect(deadlineFor(day('2026-10-14'), '10:00').toISOString()).toBe(
      '2026-10-14T07:00:00.000Z',
    );
  });

  it('uses winter time (UTC+2)', () => {
    expect(deadlineFor(day('2026-12-14'), '10:00').toISOString()).toBe(
      '2026-12-14T08:00:00.000Z',
    );
  });

  it('handles the day after the switch to winter time', () => {
    expect(deadlineFor(day('2026-10-26'), '09:30').toISOString()).toBe(
      '2026-10-26T07:30:00.000Z',
    );
  });
});

describe('isBeforeDeadline', () => {
  it('is true one minute before and false at the deadline', () => {
    const date = day('2026-10-14');
    expect(
      isBeforeDeadline(date, '10:00', new Date('2026-10-14T06:59:00.000Z')),
    ).toBe(true);
    expect(
      isBeforeDeadline(date, '10:00', new Date('2026-10-14T07:00:00.000Z')),
    ).toBe(false);
  });

  it('is true for the previous evening', () => {
    expect(
      isBeforeDeadline(
        day('2026-10-14'),
        '10:00',
        new Date('2026-10-13T20:00:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('priceOn', () => {
  const prices = [
    {
      id: 'a',
      complexId: 'c1',
      priceCategoryId: 'p1',
      validFrom: day('2026-09-01'),
    },
    {
      id: 'b',
      complexId: 'c1',
      priceCategoryId: 'p1',
      validFrom: day('2026-11-01'),
    },
    {
      id: 'c',
      complexId: 'c1',
      priceCategoryId: 'p2',
      validFrom: day('2026-01-01'),
    },
    {
      id: 'd',
      complexId: 'c2',
      priceCategoryId: 'p1',
      validFrom: day('2026-01-01'),
    },
  ];

  it('takes the latest price effective on the date', () => {
    expect(priceOn(prices, 'c1', 'p1', day('2026-10-14'))?.id).toBe('a');
    expect(priceOn(prices, 'c1', 'p1', day('2026-11-01'))?.id).toBe('b');
  });

  it('returns null before the first price or for another category', () => {
    expect(priceOn(prices, 'c1', 'p1', day('2026-08-31'))).toBeNull();
    expect(priceOn(prices, 'c2', 'p2', day('2026-10-14'))).toBeNull();
  });
});

describe('resolveChoices', () => {
  const dishes = [
    { id: 'soup', courseId: 'first' },
    { id: 'rice', courseId: 'side' },
    { id: 'bulgur', courseId: 'side' },
    { id: 'meat', courseId: 'main' },
    { id: 'salad', courseId: 'salad' },
  ];

  it('includes single dishes automatically and uses the pick', () => {
    expect(
      resolveChoices(['first', 'side', 'main'], dishes, ['bulgur']),
    ).toEqual({
      items: [
        { courseId: 'first', dishId: 'soup' },
        { courseId: 'side', dishId: 'bulgur' },
        { courseId: 'main', dishId: 'meat' },
      ],
    });
  });

  it('requires a choice when a course has several dishes', () => {
    expect(resolveChoices(['side', 'main'], dishes, [])).toEqual({
      error: 'choice_required',
    });
  });

  it('reports a course missing from the day', () => {
    expect(resolveChoices(['first', 'drink'], dishes, [])).toEqual({
      error: 'course_missing',
    });
  });

  it('rejects a dish not on the menu, outside the complex or a double pick', () => {
    expect(resolveChoices(['side'], dishes, ['pasta'])).toEqual({
      error: 'invalid_choice',
    });
    expect(resolveChoices(['side'], dishes, ['rice', 'salad'])).toEqual({
      error: 'invalid_choice',
    });
    expect(resolveChoices(['side'], dishes, ['rice', 'bulgur'])).toEqual({
      error: 'invalid_choice',
    });
  });

  it('accepts a pick for a single-dish course', () => {
    expect(resolveChoices(['first'], dishes, ['soup'])).toEqual({
      items: [{ courseId: 'first', dishId: 'soup' }],
    });
  });
});

describe('templateWeek', () => {
  it('starts at startWeek in the week of from and cycles', () => {
    const from = day('2026-10-14');
    expect(templateWeek(from, 1, 4, day('2026-10-12'))).toBe(1);
    expect(templateWeek(from, 1, 4, day('2026-10-18'))).toBe(1);
    expect(templateWeek(from, 1, 4, day('2026-10-19'))).toBe(2);
    expect(templateWeek(from, 1, 4, day('2026-11-09'))).toBe(1);
    expect(templateWeek(from, 3, 4, day('2026-10-26'))).toBe(1);
    expect(templateWeek(from, 2, 1, day('2026-11-30'))).toBe(1);
  });
});

describe('mondayOf and copyTarget', () => {
  it('finds the ISO Monday', () => {
    expect(mondayOf(day('2026-10-18')).toISOString()).toBe(
      '2026-10-12T00:00:00.000Z',
    );
    expect(mondayOf(day('2026-10-12')).toISOString()).toBe(
      '2026-10-12T00:00:00.000Z',
    );
  });

  it('shifts a day by the copy offset', () => {
    expect(
      copyTarget(day('2026-10-12'), day('2026-11-02'), day('2026-10-14')),
    ).toEqual(day('2026-11-04'));
  });
});
