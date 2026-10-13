import { Prisma } from '@prisma/client';
import { voidChargeInTx } from '../finance/void-charge';
import { isBeforeDeadline, parseTime } from './meals-calc';
import { DEADLINE_KEY, DEFAULT_DEADLINE } from './meal-settings.service';

export async function cancelOrderInTx(
  tx: Prisma.TransactionClient,
  order: { id: string; chargeId: string },
  userId: string,
  reason: string,
) {
  await tx.mealOrder.update({
    where: { id: order.id },
    data: {
      cancelledAt: new Date(),
      cancelledById: userId,
      cancelReason: reason,
    },
  });
  const charge = await tx.charge.findUnique({
    where: { id: order.chargeId },
    select: { id: true, voidedAt: true },
  });
  if (charge && !charge.voidedAt)
    await voidChargeInTx(tx, order.chargeId, reason, userId);
}

export async function cancelOrdersForNoticeInTx(
  tx: Prisma.TransactionClient,
  notice: { childId: string; startDate: Date; endDate: Date; createdAt: Date },
  userId: string,
): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "Child" WHERE id = ${notice.childId} FOR UPDATE`;
  const orders = await tx.mealOrder.findMany({
    where: {
      childId: notice.childId,
      cancelledAt: null,
      date: { gte: notice.startDate, lte: notice.endDate },
    },
    select: { id: true, date: true, chargeId: true },
    orderBy: { date: 'asc' },
  });
  if (!orders.length) return 0;
  const setting = await tx.appSetting.findUnique({
    where: { key: DEADLINE_KEY },
  });
  const deadline =
    setting && parseTime(setting.value) !== null
      ? setting.value
      : DEFAULT_DEADLINE;
  let count = 0;
  for (const order of orders) {
    if (!isBeforeDeadline(order.date, deadline, notice.createdAt)) continue;
    await cancelOrderInTx(tx, order, userId, 'Відсутність');
    count++;
  }
  return count;
}
