import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChargeSource, Prisma, TariffUnit } from '@prisma/client';
import { randomUUID } from 'crypto';
import { scopeIds } from '../access/access-calc';
import { assertChildInScope } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  activeAllocated,
  chargeState,
  formatMoney,
  money,
} from '../finance/finance-calc';
import { voidChargeInTx } from '../finance/void-charge';
import { priceOn } from './billing-engine';
import { toDay, uaDay } from './dates';
import { CreateAdaptationVisitDto } from './dto/create-adaptation-visit.dto';

const visitInclude = {
  tariff: { select: { id: true, name: true } },
  charge: { include: { allocations: true } },
} satisfies Prisma.AdaptationVisitInclude;

type LoadedVisit = Prisma.AdaptationVisitGetPayload<{
  include: typeof visitInclude;
}>;

const toVisitView = (v: LoadedVisit) => ({
  id: v.id,
  tariff: v.tariff,
  date: v.date,
  hours: formatMoney(v.hours),
  ratePerHour: formatMoney(v.ratePerHour),
  amount: formatMoney(v.amount),
  note: v.note,
  chargeId: v.chargeId,
  chargeState: v.charge.voidedAt
    ? null
    : chargeState(v.charge.amount, activeAllocated(v.charge.allocations)),
  createdAt: v.createdAt,
  voidedAt: v.voidedAt,
  voidReason: v.voidReason,
});

@Injectable()
export class AdaptationService {
  constructor(private prisma: PrismaService) {}

  async listForChild(childId: string, user: AuthenticatedUser) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    return this.loadForChild(childId);
  }

  private async loadForChild(childId: string) {
    const visits = await this.prisma.adaptationVisit.findMany({
      where: { childId },
      include: visitInclude,
      orderBy: { date: 'desc' },
    });
    return visits.map(toVisitView);
  }

  async create(
    childId: string,
    dto: CreateAdaptationVisitDto,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      include: { group: { select: { institutionId: true } } },
    });
    if (!child) throw new NotFoundException('Child not found');
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    const tariff = await this.prisma.tariff.findUnique({
      where: { id: dto.tariffId },
      include: { prices: true },
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (
      tariff.institutionId !== null &&
      tariff.institutionId !== (child.group?.institutionId ?? null)
    )
      throw new BadRequestException('Tariff belongs to another institution');
    if (tariff.unit !== TariffUnit.hour)
      throw new BadRequestException('Tariff unit must be hour');
    if (!tariff.isActive) throw new BadRequestException('Tariff is not active');

    const hours = money(dto.hours);
    if (hours.lte(0) || hours.gt(24))
      throw new BadRequestException('Invalid hours');

    const date = toDay(dto.date);
    const rate = dto.ratePerHour
      ? money(dto.ratePerHour)
      : priceOn(tariff.prices, date);
    if (!rate) throw new BadRequestException('No price for this date');
    const amount = hours
      .mul(rate)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (amount.lte(0))
      throw new BadRequestException('Amount must be greater than 0');

    const visitId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const charge = await tx.charge.create({
        data: {
          childId,
          category: tariff.category,
          amount,
          description: `${tariff.name}, ${uaDay(date)}: ${formatMoney(hours)} год × ${formatMoney(rate)}`,
          periodStart: date,
          periodEnd: date,
          sourceType: ChargeSource.adaptation,
          sourceId: visitId,
          createdById: userId,
        },
      });
      await tx.adaptationVisit.create({
        data: {
          id: visitId,
          childId,
          tariffId: tariff.id,
          date,
          hours,
          ratePerHour: rate,
          amount,
          note: dto.note,
          chargeId: charge.id,
          createdById: userId,
        },
      });
    });
    return this.loadForChild(childId);
  }

  async void(
    id: string,
    reason: string,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const ids = scopeIds(user);
    const childId = await this.prisma.$transaction(async (tx) => {
      const visit = await tx.adaptationVisit.findUnique({ where: { id } });
      if (!visit) throw new NotFoundException('Adaptation visit not found');
      await assertChildInScope(
        tx,
        ids,
        visit.childId,
        'Adaptation visit not found',
      );
      if (visit.voidedAt)
        throw new BadRequestException('Adaptation visit is voided');

      const charge = await tx.charge.findUnique({
        where: { id: visit.chargeId },
      });
      if (charge && !charge.voidedAt)
        await voidChargeInTx(tx, visit.chargeId, reason, userId);

      await tx.adaptationVisit.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
      });
      return visit.childId;
    });
    return this.loadForChild(childId);
  }
}
