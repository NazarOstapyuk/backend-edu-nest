import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind, Prisma } from '@prisma/client';
import { scopeKind } from '../access/access-calc';
import { OUTSIDE_SCOPE } from '../access/scope';
import { parseDay } from '../classes/access';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { dayCount } from '../tariffs/dates';

export const MAX_PERIOD_DAYS = 366;

export interface ReportFilter {
  kind: GroupKind | null;
  groupId: string | null;
}

export function reportPeriod(
  from?: string,
  to?: string,
): { from: Date; to: Date } {
  const start = parseDay(from ?? '');
  const end = parseDay(to ?? '');
  if (end.getTime() < start.getTime())
    throw new BadRequestException('Invalid period');
  if (dayCount(start, end) > MAX_PERIOD_DAYS)
    throw new BadRequestException('Period too long');
  return { from: start, to: end };
}

export async function resolveFilter(
  db: {
    group: {
      findUnique(args: {
        where: { id: string };
        select: { id: true; kind: true };
      }): Promise<{ id: string; kind: GroupKind } | null>;
    };
  },
  user: AuthenticatedUser,
  query: { kind?: GroupKind; groupId?: string },
): Promise<ReportFilter> {
  const scope = scopeKind(user);
  if (scope && query.kind && query.kind !== scope)
    throw new ForbiddenException(OUTSIDE_SCOPE);
  if (query.groupId) {
    const group = await db.group.findUnique({
      where: { id: query.groupId },
      select: { id: true, kind: true },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (scope && group.kind !== scope)
      throw new ForbiddenException(OUTSIDE_SCOPE);
  }
  return { kind: query.kind ?? scope, groupId: query.groupId ?? null };
}

export const childFilterWhere = (
  filter: ReportFilter,
  childId?: string,
): Prisma.ChildWhereInput => ({
  ...(filter.kind ? { group: { kind: filter.kind } } : {}),
  ...(filter.groupId ? { groupId: filter.groupId } : {}),
  ...(childId ? { id: childId } : {}),
});
