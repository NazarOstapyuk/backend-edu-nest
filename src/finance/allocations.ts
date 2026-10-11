import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { activeAllocated, money, sumMoney } from './finance-calc';

export interface AllocationItem {
  chargeId: string;
  amount: string;
}

export async function applyAllocations(
  tx: Prisma.TransactionClient,
  paymentId: string,
  items: AllocationItem[],
  userId: string,
) {
  const chargeIds = items.map((item) => item.chargeId);
  if (new Set(chargeIds).size !== chargeIds.length) {
    throw new BadRequestException('Duplicate charge in allocations');
  }
  if (items.some((item) => money(item.amount).lte(0))) {
    throw new BadRequestException('Amount must be greater than 0');
  }

  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundException('Payment not found');
  if (payment.voidedAt) throw new BadRequestException('Payment is voided');
  if (payment.status !== PaymentStatus.confirmed) {
    throw new BadRequestException('Payment is not confirmed');
  }

  await tx.$queryRaw`SELECT id FROM "Charge" WHERE id IN (${Prisma.join(chargeIds)}) ORDER BY id FOR UPDATE`;
  const charges = await tx.charge.findMany({
    where: { id: { in: chargeIds } },
    include: { allocations: { where: { voidedAt: null } } },
  });

  for (const item of items) {
    const charge = charges.find((c) => c.id === item.chargeId);
    if (!charge) throw new NotFoundException('Charge not found');
    if (charge.voidedAt) throw new BadRequestException('Charge is voided');
    if (charge.childId !== payment.childId) {
      throw new BadRequestException('Charge belongs to another child');
    }
    if (payment.category && charge.category !== payment.category) {
      throw new BadRequestException(
        'Charge category does not match payment category',
      );
    }
    if (
      money(item.amount).gt(
        charge.amount.minus(activeAllocated(charge.allocations)),
      )
    ) {
      throw new BadRequestException(
        'Allocation exceeds charge remaining amount',
      );
    }
  }

  const paymentAllocations = await tx.allocation.findMany({
    where: { paymentId, voidedAt: null },
  });
  const free = payment.amount.minus(activeAllocated(paymentAllocations));
  if (sumMoney(items.map((item) => item.amount)).gt(free)) {
    throw new BadRequestException('Allocation exceeds payment free amount');
  }

  const allocations = [];
  for (const item of items) {
    allocations.push(
      await tx.allocation.create({
        data: {
          paymentId,
          chargeId: item.chargeId,
          amount: item.amount,
          createdById: userId,
        },
      }),
    );
  }

  return { payment, allocations };
}
