import { AccessScope, Role } from '@prisma/client';
import {
  assigneeState,
  AssignTarget,
  canAssign,
  isClosed,
  normalizeDescription,
  normalizeTitle,
  progress,
} from './tasks-calc';

const teacher = (over: Partial<AssignTarget> = {}): AssignTarget => ({
  role: Role.teacher,
  isActive: true,
  accessScope: AccessScope.all,
  institutionIds: [],
  ...over,
});

describe('canAssign', () => {
  it('root assigns admin and teacher', () => {
    expect(canAssign(Role.root, null, teacher({ role: Role.admin }))).toBe(
      true,
    );
    expect(canAssign(Role.root, null, teacher())).toBe(true);
  });

  it('root ignores its base and cannot assign root or parent', () => {
    expect(canAssign(Role.root, new Set(['A']), teacher())).toBe(true);
    expect(canAssign(Role.root, null, teacher({ role: Role.root }))).toBe(
      false,
    );
    expect(canAssign(Role.root, null, teacher({ role: Role.parent }))).toBe(
      false,
    );
  });

  it('admin cannot assign admin', () => {
    expect(canAssign(Role.admin, null, teacher({ role: Role.admin }))).toBe(
      false,
    );
  });

  it('admin with full scope assigns any active teacher', () => {
    expect(canAssign(Role.admin, null, teacher())).toBe(true);
  });

  it('admin with institutions needs an overlap and scoped teacher', () => {
    const base = new Set(['A']);
    const scoped = (ids: string[]) =>
      teacher({ accessScope: AccessScope.institutions, institutionIds: ids });
    expect(canAssign(Role.admin, base, scoped(['A', 'B']))).toBe(true);
    expect(canAssign(Role.admin, base, scoped(['B']))).toBe(false);
    expect(canAssign(Role.admin, base, teacher())).toBe(false);
  });

  it('refuses inactive targets and teacher actors', () => {
    expect(canAssign(Role.admin, null, teacher({ isActive: false }))).toBe(
      false,
    );
    expect(canAssign(Role.root, null, teacher({ isActive: false }))).toBe(
      false,
    );
    expect(canAssign(Role.teacher, null, teacher())).toBe(false);
  });
});

describe('assigneeState', () => {
  const dueAt = new Date('2026-11-03T12:00:00Z');
  const open = { dueAt, cancelledAt: null };
  const at = (ms: number) => new Date(dueAt.getTime() + ms);

  it('is open before and overdue after the deadline', () => {
    expect(assigneeState(open, { doneAt: null }, at(-1))).toBe('open');
    expect(assigneeState(open, { doneAt: null }, at(0))).toBe('open');
    expect(assigneeState(open, { doneAt: null }, at(1))).toBe('overdue');
  });

  it('done wins over overdue', () => {
    expect(assigneeState(open, { doneAt: at(500) }, at(1000))).toBe('done');
  });

  it('cancelled wins over done', () => {
    expect(
      assigneeState({ dueAt, cancelledAt: at(-5) }, { doneAt: at(-4) }, at(1)),
    ).toBe('cancelled');
  });
});

describe('progress and isClosed', () => {
  const d = new Date();

  it('skips removed and inactive rows', () => {
    expect(
      progress([
        { doneAt: d, removedAt: null, user: { isActive: true } },
        { doneAt: null, removedAt: null, user: { isActive: true } },
        { doneAt: d, removedAt: d, user: { isActive: true } },
        { doneAt: d, removedAt: null, user: { isActive: false } },
      ]),
    ).toEqual({ done: 1, total: 2 });
  });

  it('closes when cancelled or all counted are done', () => {
    expect(isClosed({ cancelledAt: d }, { done: 0, total: 2 })).toBe(true);
    expect(isClosed({ cancelledAt: null }, { done: 2, total: 2 })).toBe(true);
    expect(isClosed({ cancelledAt: null }, { done: 1, total: 2 })).toBe(false);
    expect(isClosed({ cancelledAt: null }, { done: 0, total: 0 })).toBe(false);
  });
});

describe('normalizeTitle', () => {
  it('trims and bounds to 1-200', () => {
    expect(normalizeTitle('  Hi ')).toBe('Hi');
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle('a'.repeat(200))).toBe('a'.repeat(200));
    expect(normalizeTitle('a'.repeat(201))).toBeNull();
  });
});

describe('normalizeDescription', () => {
  it('maps empty or missing to null value', () => {
    expect(normalizeDescription(undefined)).toEqual({ value: null });
    expect(normalizeDescription(null)).toEqual({ value: null });
    expect(normalizeDescription('   ')).toEqual({ value: null });
  });

  it('trims and bounds to 2000', () => {
    expect(normalizeDescription(' x ')).toEqual({ value: 'x' });
    expect(normalizeDescription('a'.repeat(2000))).toEqual({
      value: 'a'.repeat(2000),
    });
    expect(normalizeDescription('a'.repeat(2001))).toBeNull();
  });
});
