import { AttendanceStatus, MissedLessonRule } from '@prisma/client';
import { addDays } from '../tariffs/dates';

export interface PackageLike {
  id: string;
  sessionsTotal: number;
  usedBefore: number;
  purchaseDate: Date;
  expiresAt: Date | null;
  createdAt: Date;
  voidedAt: Date | null;
  needsReconciliation: boolean;
  extensions: { newExpiresAt: Date | null; createdAt: Date }[];
  usages: { voidedAt: Date | null }[];
}

export type PackageState =
  | 'voided'
  | 'needs_reconciliation'
  | 'exhausted'
  | 'expired'
  | 'active';

const time = (day: Date) => day.getTime();

export function shouldConsume(
  rule: MissedLessonRule,
  status: AttendanceStatus,
): boolean {
  if (status === AttendanceStatus.present) return true;
  if (rule === MissedLessonRule.always) return true;
  return (
    rule === MissedLessonRule.unexcused_only &&
    status === AttendanceStatus.absent_unexcused
  );
}

export const expiresAtFor = (
  purchaseDate: Date,
  validityDays: number | null,
): Date | null =>
  validityDays === null ? null : addDays(purchaseDate, validityDays - 1);

export function effectiveExpiry(p: PackageLike): Date | null {
  if (p.extensions.length === 0) return p.expiresAt;
  const latest = [...p.extensions].sort(
    (a, b) => time(b.createdAt) - time(a.createdAt),
  )[0];
  return latest.newExpiresAt;
}

export const packageRemaining = (p: PackageLike): number =>
  p.sessionsTotal - p.usedBefore - p.usages.filter((u) => !u.voidedAt).length;

export function isValidOn(p: PackageLike, day: Date): boolean {
  if (p.voidedAt) return false;
  if (time(p.purchaseDate) > time(day)) return false;
  const expiry = effectiveExpiry(p);
  return expiry === null || time(day) <= time(expiry);
}

export function pickPackage<T extends PackageLike>(
  packages: T[],
  day: Date,
): T | null {
  const usable = packages
    .filter((p) => isValidOn(p, day) && packageRemaining(p) > 0)
    .sort((a, b) => {
      const ea = effectiveExpiry(a);
      const eb = effectiveExpiry(b);
      if (ea === null && eb !== null) return 1;
      if (ea !== null && eb === null) return -1;
      if (ea !== null && eb !== null && time(ea) !== time(eb))
        return time(ea) - time(eb);
      if (time(a.purchaseDate) !== time(b.purchaseDate))
        return time(a.purchaseDate) - time(b.purchaseDate);
      return time(a.createdAt) - time(b.createdAt);
    });
  return usable[0] ?? null;
}

export type PackageBlockReason =
  | 'none'
  | 'expired'
  | 'used_up'
  | 'starts_later';

export interface PackageBlock {
  reason: PackageBlockReason;
  date: Date | null;
  packageId: string | null;
}

export function packageBlock(
  packages: PackageLike[],
  day: Date,
): PackageBlock | null {
  if (pickPackage(packages, day)) return null;
  const live = packages.filter((p) => !p.voidedAt);
  const started = live.filter((p) => time(p.purchaseDate) <= time(day));
  const expired = started
    .filter((p) => packageRemaining(p) > 0)
    .map((p) => ({ p, expiry: effectiveExpiry(p) }))
    .filter(
      (x): x is { p: PackageLike; expiry: Date } =>
        x.expiry !== null && time(x.expiry) < time(day),
    )
    .sort((a, b) => time(b.expiry) - time(a.expiry))[0];
  if (expired)
    return { reason: 'expired', date: expired.expiry, packageId: expired.p.id };
  if (started.length > 0)
    return { reason: 'used_up', date: null, packageId: null };
  const later = [...live].sort(
    (a, b) => time(a.purchaseDate) - time(b.purchaseDate),
  )[0];
  if (later)
    return {
      reason: 'starts_later',
      date: later.purchaseDate,
      packageId: later.id,
    };
  return { reason: 'none', date: null, packageId: null };
}

export function packageState(p: PackageLike, today: Date): PackageState {
  if (p.voidedAt) return 'voided';
  if (p.needsReconciliation) return 'needs_reconciliation';
  if (packageRemaining(p) <= 0) return 'exhausted';
  const expiry = effectiveExpiry(p);
  if (expiry !== null && time(today) > time(expiry)) return 'expired';
  return 'active';
}
