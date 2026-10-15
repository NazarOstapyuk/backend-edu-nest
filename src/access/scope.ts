import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupKind, Prisma } from '@prisma/client';

export const OUTSIDE_SCOPE = 'Outside access scope';

export const childScopeWhere = (
  kind: GroupKind | null,
): Prisma.ChildWhereInput => (kind ? { group: { kind } } : {});

export const groupScopeWhere = (
  kind: GroupKind | null,
): Prisma.GroupWhereInput => (kind ? { kind } : {});

export function assertKindInScope(
  kind: GroupKind | null,
  target: GroupKind | null,
): void {
  if (kind && target !== kind) throw new ForbiddenException(OUTSIDE_SCOPE);
}

export async function assertChildInScope(
  db: {
    child: {
      findFirst(
        args: Prisma.ChildFindFirstArgs,
      ): Promise<{ id: string } | null>;
    };
  },
  kind: GroupKind | null,
  childId: string,
  message = 'Child not found',
): Promise<void> {
  if (!kind) return;
  const found = await db.child.findFirst({
    where: { id: childId, ...childScopeWhere(kind) },
    select: { id: true },
  });
  if (!found) throw new NotFoundException(message);
}
