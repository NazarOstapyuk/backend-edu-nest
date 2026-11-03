import { AccessScope, Role } from '@prisma/client';

export type AssignTarget = {
  role: Role;
  isActive: boolean;
  accessScope: AccessScope;
  institutionIds: string[];
};

export function canAssign(
  actorRole: Role,
  actorBase: Set<string> | null,
  target: AssignTarget,
): boolean {
  if (!target.isActive) return false;
  if (actorRole === Role.root) {
    return target.role === Role.admin || target.role === Role.teacher;
  }
  if (actorRole !== Role.admin || target.role !== Role.teacher) return false;
  if (actorBase === null) return true;
  if (target.accessScope !== AccessScope.institutions) return false;
  return target.institutionIds.some((id) => actorBase.has(id));
}

export type AssigneeState = 'open' | 'overdue' | 'done' | 'cancelled';

export function assigneeState(
  task: { dueAt: Date; cancelledAt: Date | null },
  row: { doneAt: Date | null },
  now: Date,
): AssigneeState {
  if (task.cancelledAt) return 'cancelled';
  if (row.doneAt) return 'done';
  return now.getTime() > task.dueAt.getTime() ? 'overdue' : 'open';
}

export function progress(
  rows: {
    doneAt: Date | null;
    removedAt: Date | null;
    user: { isActive: boolean };
  }[],
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const row of rows) {
    if (row.removedAt || !row.user.isActive) continue;
    total += 1;
    if (row.doneAt) done += 1;
  }
  return { done, total };
}

export function isClosed(
  task: { cancelledAt: Date | null },
  counted: { done: number; total: number },
): boolean {
  return (
    task.cancelledAt !== null ||
    (counted.total > 0 && counted.done === counted.total)
  );
}

export function normalizeTitle(raw: string): string | null {
  const value = raw.trim();
  return value.length >= 1 && value.length <= 200 ? value : null;
}

export function normalizeDescription(
  raw?: string | null,
): { value: string | null } | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return { value: null };
  return value.length <= 2000 ? { value } : null;
}
