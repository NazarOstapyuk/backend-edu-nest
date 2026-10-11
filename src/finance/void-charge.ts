import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function voidChargeInTx(
  tx: Prisma.TransactionClient,
  id: string,
  reason: string,
  userId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Charge" WHERE id = ${id} FOR UPDATE`;
  const charge = await tx.charge.findUnique({ where: { id } });
  if (!charge) throw new NotFoundException('Charge not found');
  if (charge.voidedAt) throw new BadRequestException('Charge is voided');

  const data = { voidedAt: new Date(), voidedById: userId, voidReason: reason };
  await tx.allocation.updateMany({
    where: { chargeId: id, voidedAt: null },
    data,
  });
  return tx.charge.update({ where: { id }, data });
}
