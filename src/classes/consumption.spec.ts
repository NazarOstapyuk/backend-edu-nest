import { AttendanceStatus, MissedLessonRule } from '@prisma/client';
import {
  PackageLike,
  effectiveExpiry,
  expiresAtFor,
  isValidOn,
  packageRemaining,
  packageState,
  pickPackage,
  shouldConsume,
} from './consumption';
import { isoDay } from '../tariffs/dates';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const pkg = (over: Partial<PackageLike> = {}): PackageLike => ({
  id: 'p1',
  sessionsTotal: 4,
  usedBefore: 0,
  purchaseDate: day('2026-10-01'),
  expiresAt: day('2026-10-30'),
  createdAt: new Date('2026-10-01T10:00:00Z'),
  voidedAt: null,
  needsReconciliation: false,
  extensions: [],
  usages: [],
  ...over,
});

describe('shouldConsume', () => {
  const cases: [MissedLessonRule, AttendanceStatus, boolean][] = [
    [MissedLessonRule.no_charge, AttendanceStatus.present, true],
    [MissedLessonRule.no_charge, AttendanceStatus.absent_excused, false],
    [MissedLessonRule.no_charge, AttendanceStatus.absent_unexcused, false],
    [MissedLessonRule.always, AttendanceStatus.present, true],
    [MissedLessonRule.always, AttendanceStatus.absent_excused, true],
    [MissedLessonRule.always, AttendanceStatus.absent_unexcused, true],
    [MissedLessonRule.unexcused_only, AttendanceStatus.present, true],
    [MissedLessonRule.unexcused_only, AttendanceStatus.absent_excused, false],
    [MissedLessonRule.unexcused_only, AttendanceStatus.absent_unexcused, true],
  ];

  it.each(cases)('%s + %s → %s', (rule, status, expected) => {
    expect(shouldConsume(rule, status)).toBe(expected);
  });
});

describe('expiry', () => {
  it('computes the last valid day from validity days', () => {
    expect(isoDay(expiresAtFor(day('2026-10-01'), 30)!)).toBe('2026-10-30');
    expect(expiresAtFor(day('2026-10-01'), null)).toBeNull();
  });

  it('uses the latest extension', () => {
    const p = pkg({
      extensions: [
        {
          newExpiresAt: day('2026-11-30'),
          createdAt: new Date('2026-11-02T10:00:00Z'),
        },
        {
          newExpiresAt: day('2026-11-15'),
          createdAt: new Date('2026-11-01T10:00:00Z'),
        },
      ],
    });
    expect(isoDay(effectiveExpiry(p)!)).toBe('2026-11-30');
  });
});

describe('packageRemaining', () => {
  it('subtracts earlier usage and active usages only', () => {
    const p = pkg({
      usedBefore: 1,
      usages: [{ voidedAt: null }, { voidedAt: new Date() }],
    });
    expect(packageRemaining(p)).toBe(2);
  });
});

describe('isValidOn', () => {
  it('checks purchase date, expiry, extension and voiding', () => {
    expect(isValidOn(pkg(), day('2026-09-30'))).toBe(false);
    expect(isValidOn(pkg(), day('2026-10-30'))).toBe(true);
    expect(isValidOn(pkg(), day('2026-10-31'))).toBe(false);
    expect(isValidOn(pkg({ voidedAt: new Date() }), day('2026-10-10'))).toBe(
      false,
    );
    expect(
      isValidOn(
        pkg({
          extensions: [
            { newExpiresAt: day('2026-11-15'), createdAt: new Date() },
          ],
        }),
        day('2026-11-10'),
      ),
    ).toBe(true);
    expect(isValidOn(pkg({ expiresAt: null }), day('2030-01-01'))).toBe(true);
  });
});

describe('pickPackage', () => {
  it('takes the valid package expiring first', () => {
    const late = pkg({ id: 'late', expiresAt: day('2026-10-30') });
    const early = pkg({ id: 'early', expiresAt: day('2026-10-20') });
    expect(pickPackage([late, early], day('2026-10-10'))?.id).toBe('early');
  });

  it('skips exhausted packages and puts packages without expiry last', () => {
    const exhausted = pkg({
      id: 'ex',
      expiresAt: day('2026-10-20'),
      usedBefore: 4,
    });
    const open = pkg({ id: 'open', expiresAt: null });
    const dated = pkg({ id: 'dated', expiresAt: day('2026-12-31') });
    expect(pickPackage([open, exhausted, dated], day('2026-10-10'))?.id).toBe(
      'dated',
    );
    expect(pickPackage([open, exhausted], day('2026-10-10'))?.id).toBe('open');
  });

  it('returns null when nothing is usable', () => {
    expect(
      pickPackage([pkg({ voidedAt: new Date() })], day('2026-10-10')),
    ).toBeNull();
    expect(pickPackage([], day('2026-10-10'))).toBeNull();
  });
});

describe('packageState', () => {
  it('orders voided, reconciliation, exhausted, expired, active', () => {
    const today = day('2026-10-10');
    expect(
      packageState(
        pkg({ voidedAt: new Date(), needsReconciliation: true }),
        today,
      ),
    ).toBe('voided');
    expect(
      packageState(pkg({ needsReconciliation: true, usedBefore: 4 }), today),
    ).toBe('needs_reconciliation');
    expect(packageState(pkg({ usedBefore: 4 }), today)).toBe('exhausted');
    expect(packageState(pkg(), day('2026-11-01'))).toBe('expired');
    expect(packageState(pkg(), today)).toBe('active');
  });
});
