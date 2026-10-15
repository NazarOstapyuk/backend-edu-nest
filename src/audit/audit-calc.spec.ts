import { Prisma } from '@prisma/client';
import {
  diffFields,
  entityFromRoute,
  kyivDayStart,
  normalizeValue,
  sanitizeBody,
  shouldRecordEvent,
} from './audit-calc';

describe('normalizeValue', () => {
  it('normalizes money, dates, arrays and empties', () => {
    expect(normalizeValue(new Prisma.Decimal('12.5'))).toBe('12.50');
    expect(normalizeValue(new Date('2026-10-15T00:00:00.000Z'))).toBe(
      '2026-10-15',
    );
    expect(normalizeValue(new Date('2026-10-15T08:30:00.000Z'))).toBe(
      '2026-10-15T08:30:00.000Z',
    );
    expect(normalizeValue(['b', 'a'])).toBe('a, b');
    expect(normalizeValue(undefined)).toBeNull();
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue(true)).toBe('true');
    expect(normalizeValue(5)).toBe('5');
  });
});

describe('diffFields', () => {
  const fields = ['name', 'price', 'tags'] as const;

  it('returns only changed fields', () => {
    expect(
      diffFields(
        { name: 'A', price: new Prisma.Decimal('10'), tags: ['x'] },
        { name: 'B', price: new Prisma.Decimal('10.00'), tags: ['x'] },
        fields,
      ),
    ).toEqual([{ field: 'name', before: 'A', after: 'B' }]);
  });

  it('records creation and deletion', () => {
    expect(diffFields(null, { name: 'A' }, ['name'])).toEqual([
      { field: 'name', before: null, after: 'A' },
    ]);
    expect(diffFields({ name: 'A' }, null, ['name'])).toEqual([
      { field: 'name', before: 'A', after: null },
    ]);
  });

  it('returns nothing when unchanged', () => {
    expect(
      diffFields({ name: 'A' }, { name: 'A', other: 1 }, ['name']),
    ).toEqual([]);
  });
});

describe('sanitizeBody', () => {
  it('removes secrets at any depth', () => {
    expect(
      sanitizeBody({
        login: 'x',
        password: 'p',
        nested: { newPassword: 'n', token: 't', keep: 1 },
        list: [{ currentPassword: 'c', a: 2 }],
      }),
    ).toEqual({ login: 'x', nested: { keep: 1 }, list: [{ a: 2 }] });
  });

  it('truncates large bodies and handles empties', () => {
    const big = { text: 'x'.repeat(11_000) };
    expect(sanitizeBody(big)).toEqual({
      truncated: true,
      size: JSON.stringify(big).length,
    });
    expect(sanitizeBody(undefined)).toBeNull();
  });
});

describe('entityFromRoute', () => {
  it('takes the first segment and the best id', () => {
    expect(entityFromRoute('PATCH /children/:id', { id: 'c1' }, null)).toEqual({
      entityType: 'children',
      entityId: 'c1',
    });
    expect(
      entityFromRoute(
        'POST /children/:childId/charges',
        { childId: 'c2' },
        'ch1',
      ),
    ).toEqual({ entityType: 'children', entityId: 'c2' });
    expect(entityFromRoute('POST /tariffs', {}, 't1')).toEqual({
      entityType: 'tariffs',
      entityId: 't1',
    });
    expect(entityFromRoute('POST /billing/run', {}, null)).toEqual({
      entityType: 'billing',
      entityId: null,
    });
  });
});

describe('shouldRecordEvent', () => {
  it('records mutations except auth routes', () => {
    expect(shouldRecordEvent('POST', '/children')).toBe(true);
    expect(shouldRecordEvent('DELETE', '/groups/1')).toBe(true);
    expect(shouldRecordEvent('GET', '/children')).toBe(false);
    expect(shouldRecordEvent('POST', '/auth/login')).toBe(false);
    expect(shouldRecordEvent('POST', '/auth/refresh?x=1')).toBe(false);
    expect(shouldRecordEvent('POST', '/auth/logout')).toBe(false);
    expect(shouldRecordEvent('POST', '/me/password')).toBe(false);
    expect(shouldRecordEvent('PATCH', '/me/contacts')).toBe(true);
  });
});

describe('kyivDayStart', () => {
  it('returns Kyiv midnight in summer and winter', () => {
    expect(kyivDayStart('2026-10-15').toISOString()).toBe(
      '2026-10-14T21:00:00.000Z',
    );
    expect(kyivDayStart('2026-12-01').toISOString()).toBe(
      '2026-11-30T22:00:00.000Z',
    );
  });
});
