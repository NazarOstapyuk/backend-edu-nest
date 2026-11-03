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

export function kyivDateTime(instant: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export type TaskCursor = { dueAt: Date; id: string | null };

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const cursorOf = (item: { dueAt: Date; id: string }): string =>
  `${item.dueAt.toISOString()}|${item.id}`;

export function parseCursor(raw: string): TaskCursor | null {
  const parts = raw.split('|');
  if (parts.length > 2) return null;
  const [instant, id] = parts;
  if (!ISO_INSTANT.test(instant)) return null;
  const dueAt = new Date(instant);
  if (Number.isNaN(dueAt.getTime()) || dueAt.toISOString() !== instant)
    return null;
  if (id === undefined) return { dueAt, id: null };
  return id.length > 0 ? { dueAt, id } : null;
}
