import { BadRequestException } from '@nestjs/common';

type IdRow = { id: string };

type MoveGuardDb = {
  enrollment: {
    findFirst: (args: {
      where: {
        childId: { in: string[] };
        tariff: { institutionId: string };
        OR: ({ endDate: null } | { endDate: { gte: Date } })[];
      };
      select: { id: true };
    }) => Promise<IdRow | null>;
  };
  mealOrder: {
    findFirst: (args: {
      where: {
        childId: { in: string[] };
        cancelledAt: null;
        date: { gte: Date };
      };
      select: { id: true };
    }) => Promise<IdRow | null>;
  };
};

export async function assertChildrenCanMove(
  db: MoveGuardDb,
  childIds: string[],
  fromInstitutionId: string,
  today: Date,
): Promise<void> {
  if (childIds.length === 0) return;
  const enrollment = await db.enrollment.findFirst({
    where: {
      childId: { in: childIds },
      tariff: { institutionId: fromInstitutionId },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
    select: { id: true },
  });
  if (enrollment) {
    throw new BadRequestException('Child has an active enrollment');
  }
  const order = await db.mealOrder.findFirst({
    where: {
      childId: { in: childIds },
      cancelledAt: null,
      date: { gte: today },
    },
    select: { id: true },
  });
  if (order) throw new BadRequestException('Child has meal orders');
}
