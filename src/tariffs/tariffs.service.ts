import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, TariffUnit } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { baseScope, scopeIds } from '../access/access-calc';
import { OUTSIDE_SCOPE, assertInstitutionInScope } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { findInstitution } from '../institutions/institution-checks';
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
  'institutionId',
  'prices',
] as const;

const tariffAudit = (tariff: LoadedTariff) => ({
  name: tariff.name,
  unit: tariff.unit,
  billingMode: tariff.billingMode,
  validityDays: tariff.validityDays,
  isActive: tariff.isActive,
  institutionId: tariff.institutionId,
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
    institutionId: tariff.institutionId,
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

  private assertWritable(
    user: AuthenticatedUser,
    institutionId: string | null,
  ) {
    if (institutionId === null) {
      if (baseScope(user) !== null) throw new ForbiddenException(OUTSIDE_SCOPE);
      return;
    }
    assertInstitutionInScope(scopeIds(user), institutionId);
  }

  private async get(id: string, user: AuthenticatedUser) {
    const tariff = await this.prisma.tariff.findUnique({
      where: { id },
      include: tariffInclude,
    });
    if (!tariff) throw new NotFoundException('Tariff not found');
    const ids = scopeIds(user);
    if (
      ids &&
      tariff.institutionId !== null &&
      !ids.includes(tariff.institutionId)
    )
      throw new NotFoundException('Tariff not found');
    return tariff;
  }

  private async assertNameFree(
    name: string,
    institutionId: string | null,
    exceptId?: string,
  ) {
    const existing = await this.prisma.tariff.findFirst({
      where: {
        name,
        institutionId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (existing)
      throw new BadRequestException('Tariff with this name already exists');
  }

  async list(user: AuthenticatedUser, today: Date = kyivToday()) {
    const ids = scopeIds(user);
    const tariffs = await this.prisma.tariff.findMany({
      where: ids
        ? { OR: [{ institutionId: null }, { institutionId: { in: ids } }] }
        : undefined,
      include: tariffInclude,
      orderBy: { name: 'asc' },
    });
    return tariffs.map((t) => toTariffView(t, today));
  }

  async create(dto: CreateTariffDto, user: AuthenticatedUser) {
    const userId = user.id;
    const institutionId = dto.institutionId ?? null;
    if (dto.unit === TariffUnit.package && !dto.packageSize) {
      throw new BadRequestException(
        'Package size is required for package tariffs',
      );
    }
    if (money(dto.price).lte(0))
      throw new BadRequestException('Amount must be greater than 0');
    this.assertWritable(user, institutionId);
    if (institutionId !== null)
      await findInstitution(this.prisma, institutionId, { active: true });
    await this.assertNameFree(dto.name, institutionId);

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
        institutionId,
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

  async update(id: string, dto: UpdateTariffDto, user: AuthenticatedUser) {
    const userId = user.id;
    const tariff = await this.get(id, user);
    this.assertWritable(user, tariff.institutionId);
    const institutionId =
      dto.institutionId === undefined
        ? tariff.institutionId
        : dto.institutionId;
    const institutionChanged = institutionId !== tariff.institutionId;
    if (institutionChanged) {
      this.assertWritable(user, institutionId);
      if (institutionId !== null)
        await findInstitution(this.prisma, institutionId, { active: true });
      const [enrollments, visits, groups] = await Promise.all([
        this.prisma.enrollment.count({ where: { tariffId: id } }),
        this.prisma.adaptationVisit.count({ where: { tariffId: id } }),
        this.prisma.classGroup.count({
          where: { OR: [{ singleTariffId: id }, { packageTariffId: id }] },
        }),
      ]);
      if (enrollments + visits + groups > 0)
        throw new BadRequestException('Tariff is in use');
    }
    const name = dto.name ?? tariff.name;
    if (name !== tariff.name || institutionChanged)
      await this.assertNameFree(name, institutionId, id);

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
        institutionId: institutionChanged ? institutionId : undefined,
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

  async addPrice(id: string, dto: AddTariffPriceDto, user: AuthenticatedUser) {
    const userId = user.id;
    const before = await this.get(id, user);
    this.assertWritable(user, before.institutionId);
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
    const after = await this.get(id, user);
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

  async delete(id: string, user: AuthenticatedUser) {
    const userId = user.id;
    const tariff = await this.get(id, user);
    this.assertWritable(user, tariff.institutionId);
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

    await this.prisma.$transaction(async (tx) => {
      await tx.tariffPrice.deleteMany({ where: { tariffId: id } });
      await tx.tariff.delete({ where: { id } });
      await this.audit.recordChange(tx, {
        actorId: userId,
        entityType: 'tariffs',
        entityId: id,
        action: AuditAction.delete,
        before: tariffAudit(tariff),
        after: null,
        fields: TARIFF_FIELDS,
      });
    });
    return { message: 'Tariff deleted' };
  }
}
