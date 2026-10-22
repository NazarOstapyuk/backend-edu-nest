import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const OUTSIDE_SCOPE = 'Outside access scope';

export const childScopeWhere = (
  ids: string[] | null,
): Prisma.ChildWhereInput =>
  ids ? { group: { institutionId: { in: ids } } } : {};

export const groupScopeWhere = (
  ids: string[] | null,
): Prisma.GroupWhereInput => (ids ? { institutionId: { in: ids } } : {});

export function assertInstitutionInScope(
  ids: string[] | null,
  institutionId: string | null,
): void {
  if (ids && (institutionId === null || !ids.includes(institutionId)))
    throw new ForbiddenException(OUTSIDE_SCOPE);
}

export async function assertChildInScope(
  db: {
    child: {
      findFirst(
        args: Prisma.ChildFindFirstArgs,
      ): Promise<{ id: string } | null>;
    };
  },
  ids: string[] | null,
  childId: string,
  message = 'Child not found',
): Promise<void> {
  if (!ids) return;
  const found = await db.child.findFirst({
    where: { id: childId, ...childScopeWhere(ids) },
    select: { id: true },
  });
  if (!found) throw new NotFoundException(message);
}
