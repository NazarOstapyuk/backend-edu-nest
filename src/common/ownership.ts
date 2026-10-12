import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function assertOwnChild(
  prisma: PrismaService,
  parentId: string,
  childId: string,
): Promise<void> {
  const child = await prisma.child.findFirst({
    where: { id: childId, parents: { some: { id: parentId } } },
    select: { id: true },
  });
  if (!child) throw new NotFoundException('Child not found');
}
