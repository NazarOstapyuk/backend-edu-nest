import { levelFor, validateLevels } from './assessment-levels';

const scale = [
  { name: 'Високий', code: 'В', minPercent: 85 },
  { name: 'Достатній', code: 'Д', minPercent: 65 },
  { name: 'Середній', code: 'С', minPercent: 40 },
  { name: 'Початковий', code: 'П', minPercent: 0 },
];

describe('assessment levels', () => {
  it('picks the highest bound not above the percent', () => {
    expect(levelFor(scale, 84)).toEqual({ name: 'Достатній', code: 'Д' });
    expect(levelFor(scale, 85)).toEqual({ name: 'Високий', code: 'В' });
    expect(levelFor(scale, 0)).toEqual({ name: 'Початковий', code: 'П' });
  });

  it('returns null below the lowest bound or without a scale', () => {
    expect(levelFor(scale.slice(0, 3), 39)).toBeNull();
    expect(levelFor([], 70)).toBeNull();
  });

  it('validates', () => {
    expect(validateLevels(scale)).toBeNull();
    expect(validateLevels([])).toBeNull();
    expect(
      validateLevels([...scale, { name: 'X', code: 'X', minPercent: 85 }]),
    ).toBe('Duplicate level bound');
    expect(validateLevels([{ name: '', code: 'В', minPercent: 10 }])).toBe(
      'Invalid level',
    );
    expect(
      validateLevels([{ name: 'A', code: 'ABCDEF', minPercent: 10 }]),
    ).toBe('Invalid level');
    expect(validateLevels([{ name: 'A', code: 'A', minPercent: 101 }])).toBe(
      'Invalid level',
    );
    expect(
      validateLevels(
        Array.from({ length: 11 }, (_, i) => ({
          name: `L${i}`,
          code: `${i}`,
          minPercent: i,
        })),
      ),
    ).toBe('Too many levels');
  });
});
