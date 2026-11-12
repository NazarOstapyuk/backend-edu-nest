import { NoteQuestionType } from '@prisma/client';
import {
  isComplete,
  normalizeAnswer,
  pendingForGroup,
  validateQuestion,
} from './notes-calc';

describe('validateQuestion', () => {
  const choice = { text: 'Mood', type: 'choice' as const };

  it('accepts valid questions', () => {
    expect(
      validateQuestion({ ...choice, options: ['Good', 'Bad'] }),
    ).toBeNull();
    expect(validateQuestion({ text: 'Slept', type: 'yes_no' })).toBeNull();
    expect(
      validateQuestion({
        text: 'Temp',
        type: 'number',
        min: 30,
        max: 42,
        unit: 'C',
      }),
    ).toBeNull();
  });

  it('rejects bad text', () => {
    expect(validateQuestion({ text: '  ', type: 'text' })).toBe(
      'Invalid question text',
    );
    expect(validateQuestion({ text: 'x'.repeat(301), type: 'text' })).toBe(
      'Invalid question text',
    );
  });

  it('checks option count', () => {
    expect(validateQuestion({ ...choice, options: ['A'] })).toBe(
      'Choice needs 2 to 10 options',
    );
    expect(validateQuestion(choice)).toBe('Choice needs 2 to 10 options');
    const eleven = Array.from({ length: 11 }, (_, i) => `o${i}`);
    expect(validateQuestion({ ...choice, options: eleven })).toBe(
      'Choice needs 2 to 10 options',
    );
  });

  it('checks options', () => {
    expect(validateQuestion({ ...choice, options: ['A', ' '] })).toBe(
      'Invalid option',
    );
    expect(
      validateQuestion({ ...choice, options: ['A', 'x'.repeat(51)] }),
    ).toBe('Invalid option');
    expect(validateQuestion({ ...choice, options: ['A', ' A '] })).toBe(
      'Duplicate option',
    );
  });

  it('rejects options for other types', () => {
    expect(
      validateQuestion({ text: 'T', type: 'text', options: ['A', 'B'] }),
    ).toBe('Options are only for choice questions');
  });

  it('checks range', () => {
    expect(
      validateQuestion({ text: 'N', type: 'number', min: 5, max: 1 }),
    ).toBe('Invalid range');
    expect(
      validateQuestion({ text: 'N', type: 'number', max: 100000000 }),
    ).toBe('Invalid range');
    expect(
      validateQuestion({ text: 'N', type: 'number', min: -100000000 }),
    ).toBe('Invalid range');
    expect(validateQuestion({ text: 'N', type: 'number', min: 1.234 })).toBe(
      'Invalid range',
    );
    expect(
      validateQuestion({ text: 'N', type: 'number', min: 3, max: 3 }),
    ).toBeNull();
  });

  it('checks unit', () => {
    expect(
      validateQuestion({ text: 'N', type: 'number', unit: 'x'.repeat(21) }),
    ).toBe('Invalid unit');
    expect(
      validateQuestion({ text: 'N', type: 'number', unit: 'x'.repeat(20) }),
    ).toBeNull();
  });
});

describe('normalizeAnswer', () => {
  const base = { options: [] as string[], min: null, max: null };

  it('clears on null and blank', () => {
    const q = { ...base, type: 'text' as const };
    expect(normalizeAnswer(q, null)).toEqual({ clear: true });
    expect(normalizeAnswer(q, '  ')).toEqual({ clear: true });
  });

  it('handles choice', () => {
    const q = { ...base, type: 'choice' as const, options: ['Good', 'Bad'] };
    expect(normalizeAnswer(q, 'Good')).toEqual({
      clear: false,
      value: { valueText: 'Good', valueBool: null, valueNumber: null },
    });
    expect(normalizeAnswer(q, 'Great')).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, 5)).toEqual({ error: 'Invalid answer' });
  });

  it('handles text', () => {
    const q = { ...base, type: 'text' as const };
    expect(normalizeAnswer(q, ' hi ')).toEqual({
      clear: false,
      value: { valueText: 'hi', valueBool: null, valueNumber: null },
    });
    expect(normalizeAnswer(q, 'x'.repeat(1001))).toEqual({
      error: 'Invalid answer',
    });
    expect(normalizeAnswer(q, 'x'.repeat(1000))).toMatchObject({
      clear: false,
    });
    expect(normalizeAnswer(q, 3)).toEqual({ error: 'Invalid answer' });
  });

  it('handles yes_no', () => {
    const q = { ...base, type: 'yes_no' as const };
    expect(normalizeAnswer(q, false)).toEqual({
      clear: false,
      value: { valueText: null, valueBool: false, valueNumber: null },
    });
    expect(normalizeAnswer(q, 'yes')).toEqual({ error: 'Invalid answer' });
  });

  it('handles number', () => {
    const q = { ...base, type: 'number' as const };
    const num = (v: string) => ({
      clear: false,
      value: { valueText: null, valueBool: null, valueNumber: v },
    });
    expect(normalizeAnswer(q, 2.5)).toEqual(num('2.50'));
    expect(normalizeAnswer(q, '3')).toEqual(num('3.00'));
    expect(normalizeAnswer(q, '-1.25')).toEqual(num('-1.25'));
    expect(normalizeAnswer(q, '2,5')).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, 'abc')).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, '1.234')).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, 1.234)).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, NaN)).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, Infinity)).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, 100000000)).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, true)).toEqual({ error: 'Invalid answer' });
  });

  it('applies min and max', () => {
    const q = {
      ...base,
      type: 'number' as const,
      min: '30.00',
      max: '42.00',
    };
    expect(normalizeAnswer(q, 36.6)).toMatchObject({ clear: false });
    expect(normalizeAnswer(q, 30)).toMatchObject({ clear: false });
    expect(normalizeAnswer(q, 42)).toMatchObject({ clear: false });
    expect(normalizeAnswer(q, 29.99)).toEqual({ error: 'Invalid answer' });
    expect(normalizeAnswer(q, '42.01')).toEqual({ error: 'Invalid answer' });
  });
});

describe('isComplete', () => {
  it('requires all required questions', () => {
    const qs = [
      { id: 'a', required: true },
      { id: 'b', required: true },
      { id: 'c', required: false },
    ];
    expect(isComplete(qs, new Set(['a', 'b']))).toBe(true);
    expect(isComplete(qs, new Set(['a', 'c']))).toBe(false);
  });

  it('needs one answer when nothing is required', () => {
    const qs = [
      { id: 'a', required: false },
      { id: 'b', required: false },
    ];
    expect(isComplete(qs, new Set())).toBe(false);
    expect(isComplete(qs, new Set(['b']))).toBe(true);
  });

  it('is complete without questions', () => {
    expect(isComplete([], new Set())).toBe(true);
  });
});

describe('pendingForGroup', () => {
  const date = new Date('2026-11-03T00:00:00.000Z');
  const set = {
    deadline: '17:00',
    questions: [{ id: 'q1', required: true }],
  };
  const answered = new Map([['c1', new Set(['q1'])]]);

  it('counts incomplete children once', () => {
    const now = new Date('2026-11-03T10:00:00Z');
    expect(
      pendingForGroup([set, set], ['c1', 'c2', 'c3'], answered, date, now),
    ).toEqual({ pending: 2, overdue: false });
  });

  it('flips overdue at the Kyiv deadline', () => {
    const before = new Date('2026-11-03T14:59:00Z');
    const at = new Date('2026-11-03T15:00:00Z');
    expect(pendingForGroup([set], ['c2'], answered, date, before).overdue).toBe(
      false,
    );
    expect(pendingForGroup([set], ['c2'], answered, date, at).overdue).toBe(
      true,
    );
  });

  it('is not overdue when everyone is complete', () => {
    const now = new Date('2026-11-03T20:00:00Z');
    expect(pendingForGroup([set], ['c1'], answered, date, now)).toEqual({
      pending: 0,
      overdue: false,
    });
  });

  it('ignores children not passed in', () => {
    const now = new Date('2026-11-03T20:00:00Z');
    expect(pendingForGroup([set], [], answered, date, now)).toEqual({
      pending: 0,
      overdue: false,
    });
  });

  it('handles sets with different deadlines', () => {
    const early = {
      deadline: '10:00',
      questions: [{ id: 'q2', required: true }],
    };
    const late = {
      deadline: '17:00',
      questions: [{ id: 'q1', required: true }],
    };
    const now = new Date('2026-11-03T12:00:00Z');
    expect(pendingForGroup([early, late], ['c1'], answered, date, now)).toEqual(
      { pending: 1, overdue: true },
    );
    expect(
      pendingForGroup(
        [early, late],
        ['c1'],
        new Map(),
        date,
        new Date('2026-11-03T07:00:00Z'),
      ),
    ).toEqual({ pending: 1, overdue: false });
  });
});

describe('percent questions', () => {
  const q = {
    type: NoteQuestionType.percent,
    options: ['20', '50', '100'],
    min: null,
    max: null,
  };
  it('accepts valid options', () =>
    expect(
      validateQuestion({
        text: 'LEGO',
        type: 'percent',
        options: ['0', '50', '100'],
      }),
    ).toBeNull());
  it('rejects fewer than 2', () =>
    expect(
      validateQuestion({ text: 'x', type: 'percent', options: ['50'] }),
    ).toBe('Percent needs 2 to 10 options'));
  it('rejects non-integers and >100', () => {
    expect(
      validateQuestion({ text: 'x', type: 'percent', options: ['20', '50%'] }),
    ).toBe('Invalid percent option');
    expect(
      validateQuestion({ text: 'x', type: 'percent', options: ['20', '101'] }),
    ).toBe('Invalid percent option');
  });
  it('rejects duplicates', () =>
    expect(
      validateQuestion({ text: 'x', type: 'percent', options: ['20', '020'] }),
    ).toBe('Duplicate option'));
  it('rejects unit and bounds', () =>
    expect(
      validateQuestion({
        text: 'x',
        type: 'percent',
        options: ['0', '100'],
        unit: '%',
      }),
    ).toBe('Unit and range are not allowed for percent'));
  it('stores a number answer', () =>
    expect(normalizeAnswer(q, 50)).toEqual({
      clear: false,
      value: { valueText: null, valueBool: null, valueNumber: '50.00' },
    }));
  it('accepts a numeric string', () =>
    expect(normalizeAnswer(q, '100')).toMatchObject({
      value: { valueNumber: '100.00' },
    }));
  it('rejects a value outside options', () =>
    expect(normalizeAnswer(q, 30)).toEqual({ error: 'Invalid answer' }));
  it('clears on null', () =>
    expect(normalizeAnswer(q, null)).toEqual({ clear: true }));
});
