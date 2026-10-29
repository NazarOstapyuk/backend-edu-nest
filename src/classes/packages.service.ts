import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChargeSource,
  FinanceCategory,
  Prisma,
  TariffUnit,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { scopeIds } from '../access/access-calc';
import { assertChildInScope } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { formatMoney, money } from '../finance/finance-calc';
import { voidChargeInTx } from '../finance/void-charge';
import { priceOn } from '../tariffs/billing-engine';
import { kyivToday, toDay, uaDay } from '../tariffs/dates';
import {
  effectiveExpiry,
  expiresAtFor,
  packageRemaining,
  packageState,
} from './consumption';
import { ExtendPackageDto } from './dto/extend-package.dto';
import { PurchasePackageDto } from './dto/purchase-package.dto';
import { ReconcilePackageDto } from './dto/reconcile-package.dto';

export const packageInclude = {
  direction: { select: { id: true, name: true } },
  tariff: { select: { id: true, name: true } },
  extensions: { orderBy: { createdAt: 'asc' } },
  usages: {
    include: {
      attendance: {
        include: {
          lesson: { include: { classGroup: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  },
  legacySubscription: {
    select: { totalPrice: true, attendances: { orderBy: { date: 'desc' } } },
  },
} satisfies Prisma.PackageInclude;

type LoadedPackage = Prisma.PackageGetPayload<{
  include: typeof packageInclude;
}>;

export const toPackageView = (p: LoadedPackage, today: Date) => {
  const remaining = packageRemaining(p);
  return {
    id: p.id,
    direction: p.direction,
    tariff: p.tariff,
    sessionsTotal: p.sessionsTotal,
    used: p.sessionsTotal - remaining,
    remaining,
    purchaseDate: p.purchaseDate,
    expiresAt: effectiveExpiry(p),
    state: packageState(p, today),
    chargeId: p.chargeId,
    needsReconciliation: p.needsReconciliation,
    reconciledAt: p.reconciledAt,
    reconciliationNote: p.reconciliationNote,
    legacyTotalPrice: p.legacySubscription
      ? formatMoney(p.legacySubscription.totalPrice)
      : null,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
    extensions: p.extensions.map((e) => ({
      id: e.id,
      previousExpiresAt: e.previousExpiresAt,
      newExpiresAt: e.newExpiresAt,
      reason: e.reason,
      createdAt: e.createdAt,
    })),
    usages: p.usages.map((u) => ({
      id: u.id,
      date: u.attendance.lesson.date,
      groupName: u.attendance.lesson.classGroup.name,
      status: u.attendance.status,
      voidedAt: u.voidedAt,
    })),
    legacyAttendances: (p.legacySubscription?.attendances ?? []).map((a) => ({
      id: a.id,
      date: a.date,
      note: a.note,
    })),
  };
};

@Injectable()
export class PackagesService {
  constructor(private prisma: PrismaService) {}

  async listForChild(childId: string, today: Date = kyivToday()) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    const packages = await this.prisma.package.findMany({
      where: { childId },
      include: packageInclude,
      orderBy: { purchaseDate: 'desc' },
    });
    return packages.map((p) => toPackageView(p, today));
  }

  async purchase(
    childId: string,
    dto: PurchasePackageDto,
    user: AuthenticatedUser,
  ) {
    const userId = user.id;
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    const direction = await this.prisma.direction.findUnique({
      where: { id: dto.directionId },
    });
    if (!direction) throw new NotFoundException('Direction not found');
    if (!direction.isActive)
      throw new BadRequestException('Direction is not active');
    const tariff = await this.prisma.tariff.findUnique({
      where: { id: dto.tariffId },
      include: { prices: true },
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    if (tariff.unit !== TariffUnit.package)
      throw new BadRequestException('Tariff unit must be package');
    if (!tariff.isActive) throw new BadRequestException('Tariff is not active');
    const offered = await this.prisma.classGroup.findFirst({
      where: {
        directionId: direction.id,
        packageTariffId: tariff.id,
        isActive: true,
      },
      select: { id: true },
    });
    if (!offered)
      throw new BadRequestException(
        'Tariff is not a package of this direction',
      );

    const purchaseDate = toDay(dto.purchaseDate);
    const price = priceOn(tariff.prices, purchaseDate);
    if (!price) throw new BadRequestException('No price for this date');

    const packageId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const charge = await tx.charge.create({
        data: {
          childId,
          category: tariff.category,
          amount: price,
          description: `${tariff.name} (${direction.name}), ${uaDay(purchaseDate)}`,
          periodStart: purchaseDate,
          periodEnd: purchaseDate,
          sourceType: ChargeSource.extra_package,
          sourceId: packageId,
          createdById: userId,
        },
      });
      await tx.package.create({
        data: {
          id: packageId,
          childId,
          directionId: direction.id,
          tariffId: tariff.id,
          sessionsTotal: tariff.packageSize ?? 1,
          purchaseDate,
          expiresAt: expiresAtFor(purchaseDate, tariff.validityDays),
          chargeId: charge.id,
          createdById: userId,
        },
      });
    });
    return this.listForChild(childId);
  }

  async extend(id: string, dto: ExtendPackageDto, userId: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
      include: { extensions: true, usages: true },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    if (pkg.voidedAt) throw new BadRequestException('Package is voided');

    const current = effectiveExpiry(pkg);
    const newExpiresAt = toDay(dto.newExpiresAt);
    if (current && newExpiresAt.getTime() <= current.getTime()) {
      throw new BadRequestException(
        'New expiry must be after the current expiry',
      );
    }
    await this.prisma.packageExtension.create({
      data: {
        packageId: id,
        previousExpiresAt: current,
        newExpiresAt,
        reason: dto.reason,
        createdById: userId,
      },
    });
    return this.listForChild(pkg.childId);
  }

  async void(id: string, reason: string, userId: string) {
    const childId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${id} FOR UPDATE`;
      const pkg = await tx.package.findUnique({
        where: { id },
        include: { usages: true },
      });
      if (!pkg) throw new NotFoundException('Package not found');
      if (pkg.voidedAt) throw new BadRequestException('Package is voided');
      if (pkg.usages.some((u) => !u.voidedAt))
        throw new BadRequestException('Package has used sessions');

      if (pkg.chargeId) {
        const charge = await tx.charge.findUnique({
          where: { id: pkg.chargeId },
        });
        if (charge && !charge.voidedAt)
          await voidChargeInTx(tx, pkg.chargeId, reason, userId);
      }
      await tx.package.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
      });
      return pkg.childId;
    });
    return this.listForChild(childId);
  }

  async reconcile(id: string, dto: ReconcilePackageDto, userId: string) {
    const pkg = await this.prisma.package.findUnique({
      where: { id },
      include: {
        direction: { select: { name: true } },
        legacySubscription: { select: { totalPrice: true } },
      },
    });
    if (!pkg) throw new NotFoundException('Package not found');
    if (pkg.voidedAt) throw new BadRequestException('Package is voided');
    if (!pkg.needsReconciliation || !pkg.legacySubscription) {
      throw new BadRequestException('Package does not need reconciliation');
    }

    const total = pkg.legacySubscription.totalPrice;
    let due = new Prisma.Decimal(0);
    if (dto.outcome === 'not_paid') due = new Prisma.Decimal(total);
    if (dto.outcome === 'paid_partial') {
      const paid = dto.paidAmount ? money(dto.paidAmount) : null;
      if (!paid || paid.lte(0) || paid.gte(total))
        throw new BadRequestException('Invalid paid amount');
      due = new Prisma.Decimal(total).minus(paid);
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.package.updateMany({
        where: { id, needsReconciliation: true },
        data: {
          needsReconciliation: false,
          reconciledAt: new Date(),
          reconciledById: userId,
          reconciliationNote: dto.note?.trim() || null,
        },
      });
      if (count === 0)
        throw new BadRequestException('Package does not need reconciliation');
      if (due.gt(0)) {
        await tx.charge.create({
          data: {
            childId: pkg.childId,
            category: FinanceCategory.extra_classes,
            amount: due,
            description: `Початковий залишок (звірка): ${pkg.direction.name}`,
            sourceType: ChargeSource.opening_balance,
            sourceId: pkg.id,
            createdById: userId,
          },
        });
      }
    });
    return this.listForChild(pkg.childId);
  }

  async reconciliationList() {
    const packages = await this.prisma.package.findMany({
      where: { needsReconciliation: true, voidedAt: null },
      include: {
        child: { select: { id: true, firstName: true, lastName: true } },
        direction: { select: { name: true } },
        legacySubscription: { select: { totalPrice: true } },
        extensions: { select: { newExpiresAt: true, createdAt: true } },
        usages: { select: { voidedAt: true } },
      },
      orderBy: { purchaseDate: 'asc' },
    });
    return packages.map((p) => ({
      id: p.id,
      child: p.child,
      directionName: p.direction.name,
      sessionsTotal: p.sessionsTotal,
      remaining: packageRemaining(p),
      totalPrice: formatMoney(p.legacySubscription?.totalPrice ?? 0),
    }));
  }
}
