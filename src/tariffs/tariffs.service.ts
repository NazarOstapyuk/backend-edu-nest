import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, TariffUnit } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatMoney, money } from '../finance/finance-calc';
import { priceOn } from './billing-engine';
import { isoDay, kyivToday, toDay } from './dates';
import { AddTariffPriceDto } from './dto/add-tariff-price.dto';
import { CreateTariffDto } from './dto/create-tariff.dto';
import { UpdateTariffDto } from './dto/update-tariff.dto';

const tariffInclude = {
  prices: { orderBy: { effectiveFrom: 'desc' } },
} satisfies Prisma.TariffInclude;

type LoadedTariff = Prisma.TariffGetPayload<{ include: typeof tariffInclude }>;

const TARIFF_FIELDS = [
  'name',
  'unit',
  'billingMode',
  'validityDays',
  'isActive',
  'prices',
] as const;

const tariffAudit = (tariff: LoadedTariff) => ({
  name: tariff.name,
  unit: tariff.unit,
  billingMode: tariff.billingMode,
  validityDays: tariff.validityDays,
  isActive: tariff.isActive,
  prices: tariff.prices.map(
    (p) => `${p.price.toFixed(2)}@${isoDay(p.effectiveFrom)}`,
  ),
});

export const toTariffView = (tariff: LoadedTariff, today: Date) => {
  const current = priceOn(tariff.prices, today);
  return {
    id: tariff.id,
    name: tariff.name,
    category: tariff.category,
    unit: tariff.unit,
    packageSize: tariff.packageSize,
    validityDays: tariff.validityDays,
    billingMode: tariff.billingMode,
    isActive: tariff.isActive,
    currentPrice: current ? formatMoney(current) : null,
    prices: tariff.prices.map((p) => ({
      id: p.id,
      price: formatMoney(p.price),
      effectiveFrom: p.effectiveFrom,
    })),
  };
};

@Injectable()
export class TariffsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async get(id: string) {
    const tariff = await this.prisma.tariff.findUnique({
      where: { id },
      include: tariffInclude,
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    return tariff;
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.tariff.findUnique({ where: { name } });
    if (existing)
      throw new BadRequestException('Tariff with this name already exists');
  }

  async list(today: Date = kyivToday()) {
    const tariffs = await this.prisma.tariff.findMany({
      include: tariffInclude,
      orderBy: { name: 'asc' },
    });
    return tariffs.map((t) => toTariffView(t, today));
  }

  async create(dto: CreateTariffDto, userId: string) {
    if (dto.unit === TariffUnit.package && !dto.packageSize) {
      throw new BadRequestException(
        'Package size is required for package tariffs',
      );
    }
    if (money(dto.price).lte(0))
      throw new BadRequestException('Amount must be greater than 0');
    await this.assertNameFree(dto.name);

    const tariff = await this.prisma.tariff.create({
      data: {
        name: dto.name,
        category: dto.category,
        unit: dto.unit,
        packageSize:
          dto.unit === TariffUnit.package ? (dto.packageSize ?? null) : null,
        validityDays:
          dto.unit === TariffUnit.package ? (dto.validityDays ?? null) : null,
        billingMode: dto.billingMode,
        prices: {
          create: {
            price: dto.price,
            effectiveFrom: toDay(dto.effectiveFrom),
            createdById: userId,
          },
        },
      },
      include: tariffInclude,
    });
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'tariffs',
      entityId: tariff.id,
      action: AuditAction.create,
      before: null,
      after: tariffAudit(tariff),
      fields: TARIFF_FIELDS,
    });
    return toTariffView(tariff, kyivToday());
  }

  async update(id: string, dto: UpdateTariffDto, userId: string) {
    const tariff = await this.get(id);
    if (dto.name !== undefined && dto.name !== tariff.name)
      await this.assertNameFree(dto.name);

    if (
      dto.billingMode !== undefined &&
      dto.billingMode !== tariff.billingMode
    ) {
      const enrollments = await this.prisma.enrollment.count({
        where: { tariffId: id },
      });
      if (enrollments > 0)
        throw new BadRequestException(
          'Cannot change billing mode: tariff has enrollments',
        );
    }

    const updated = await this.prisma.tariff.update({
      where: { id },
      data: {
        name: dto.name,
        billingMode: dto.billingMode,
        isActive: dto.isActive,
        validityDays:
          tariff.unit === TariffUnit.package ? dto.validityDays : undefined,
      },
      include: tariffInclude,
    });
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'tariffs',
      entityId: id,
      action: AuditAction.update,
      before: tariffAudit(tariff),
      after: tariffAudit(updated),
      fields: TARIFF_FIELDS,
    });
    return toTariffView(updated, kyivToday());
  }

  async addPrice(id: string, dto: AddTariffPriceDto, userId: string) {
    const before = await this.get(id);
    if (money(dto.price).lte(0))
      throw new BadRequestException('Amount must be greater than 0');
    const effectiveFrom = toDay(dto.effectiveFrom);

    const existing = await this.prisma.tariffPrice.findUnique({
      where: { tariffId_effectiveFrom: { tariffId: id, effectiveFrom } },
    });
    if (existing)
      throw new BadRequestException('Price for this date already exists');

    await this.prisma.tariffPrice.create({
      data: {
        tariffId: id,
        price: dto.price,
        effectiveFrom,
        createdById: userId,
      },
    });
    const after = await this.get(id);
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'tariffs',
      entityId: id,
      action: AuditAction.update,
      before: tariffAudit(before),
      after: tariffAudit(after),
      fields: ['prices'],
    });
    return toTariffView(after, kyivToday());
  }

  async delete(id: string, userId: string) {
    const tariff = await this.get(id);
    const [enrollments, visits, packages, groups] = await Promise.all([
      this.prisma.enrollment.count({ where: { tariffId: id } }),
      this.prisma.adaptationVisit.count({ where: { tariffId: id } }),
      this.prisma.package.count({ where: { tariffId: id } }),
      this.prisma.classGroup.count({
        where: { OR: [{ singleTariffId: id }, { packageTariffId: id }] },
      }),
    ]);
    if (enrollments + visits + packages + groups > 0)
      throw new BadRequestException('Cannot delete: tariff is in use');

    await this.prisma.$transaction([
      this.prisma.tariffPrice.deleteMany({ where: { tariffId: id } }),
      this.prisma.tariff.delete({ where: { id } }),
    ]);
    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'tariffs',
      entityId: id,
      action: AuditAction.delete,
      before: tariffAudit(tariff),
      after: null,
      fields: TARIFF_FIELDS,
    });
    return { message: 'Tariff deleted' };
  }
}
