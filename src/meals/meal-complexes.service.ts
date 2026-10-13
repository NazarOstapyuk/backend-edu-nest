import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseDay } from '../classes/access';
import { formatMoney, money } from '../finance/finance-calc';
import { isoDay, kyivToday } from '../tariffs/dates';
import {
  AddComplexPriceDto,
  CreateMealComplexDto,
  UpdateMealComplexDto,
} from './dto/meal-complex.dto';

const complexInclude = {
  courses: {
    select: { course: { select: { id: true, name: true, sortOrder: true } } },
  },
  prices: {
    select: {
      id: true,
      priceCategoryId: true,
      priceCategory: { select: { name: true } },
      price: true,
      validFrom: true,
    },
    orderBy: [{ validFrom: 'desc' as const }],
  },
} satisfies Prisma.MealComplexInclude;

type ComplexRow = Prisma.MealComplexGetPayload<{
  include: typeof complexInclude;
}>;

export const toComplexView = (row: ComplexRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  sortOrder: row.sortOrder,
  active: row.active,
  courses: row.courses
    .map((c) => c.course)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  prices: row.prices.map((p) => ({
    id: p.id,
    priceCategoryId: p.priceCategoryId,
    priceCategoryName: p.priceCategory.name,
    price: formatMoney(p.price),
    validFrom: isoDay(p.validFrom),
  })),
});

@Injectable()
export class MealComplexesService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.mealComplex.findMany({
      include: complexInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toComplexView);
  }

  private async view(id: string) {
    const row = await this.prisma.mealComplex.findUnique({
      where: { id },
      include: complexInclude,
    });
    if (!row) throw new NotFoundException('Meal complex not found');
    return toComplexView(row);
  }

  private async assertCourses(ids: string[], currentIds: string[]) {
    const courses = await this.prisma.mealCourse.findMany({
      where: { id: { in: ids } },
      select: { id: true, active: true },
    });
    if (courses.length !== ids.length)
      throw new NotFoundException('Meal course not found');
    if (courses.some((c) => !c.active && !currentIds.includes(c.id)))
      throw new BadRequestException('Meal course is inactive');
  }

  async create(dto: CreateMealComplexDto) {
    const name = dto.name.trim();
    if (await this.prisma.mealComplex.findUnique({ where: { name } }))
      throw new ConflictException('Meal complex already exists');
    await this.assertCourses(dto.courseIds, []);
    const created = await this.prisma.mealComplex.create({
      data: {
        name,
        description: dto.description?.trim() || null,
        sortOrder: dto.sortOrder,
        courses: { create: dto.courseIds.map((courseId) => ({ courseId })) },
      },
    });
    return this.view(created.id);
  }

  async update(id: string, dto: UpdateMealComplexDto) {
    const current = await this.view(id);
    const name = dto.name?.trim();
    if (
      name &&
      name !== current.name &&
      (await this.prisma.mealComplex.findUnique({ where: { name } }))
    )
      throw new ConflictException('Meal complex already exists');
    if (dto.courseIds)
      await this.assertCourses(
        dto.courseIds,
        current.courses.map((c) => c.id),
      );
    const description =
      dto.description === undefined
        ? undefined
        : dto.description?.trim() || null;
    const courseIds = dto.courseIds;
    await this.prisma.$transaction(async (tx) => {
      await tx.mealComplex.update({
        where: { id },
        data: {
          name,
          description,
          sortOrder: dto.sortOrder,
          active: dto.active,
        },
      });
      if (courseIds) {
        await tx.mealComplexCourse.deleteMany({ where: { complexId: id } });
        await tx.mealComplexCourse.createMany({
          data: courseIds.map((courseId) => ({ complexId: id, courseId })),
        });
      }
    });
    return this.view(id);
  }

  async addPrice(id: string, dto: AddComplexPriceDto) {
    if (money(dto.price).lte(0))
      throw new BadRequestException('Amount must be greater than 0');
    await this.view(id);
    const category = await this.prisma.mealPriceCategory.findUnique({
      where: { id: dto.priceCategoryId },
    });
    if (!category) throw new NotFoundException('Meal price category not found');
    if (!category.active)
      throw new BadRequestException('Meal price category is inactive');
    const validFrom = parseDay(dto.validFrom.slice(0, 10));
    const existing = await this.prisma.mealComplexPrice.findUnique({
      where: {
        complexId_priceCategoryId_validFrom: {
          complexId: id,
          priceCategoryId: dto.priceCategoryId,
          validFrom,
        },
      },
    });
    if (existing)
      throw new BadRequestException('Price for this date already exists');
    await this.prisma.mealComplexPrice.create({
      data: {
        complexId: id,
        priceCategoryId: dto.priceCategoryId,
        price: dto.price,
        validFrom,
      },
    });
    return this.view(id);
  }

  async deletePrice(id: string, priceId: string, today: Date = kyivToday()) {
    const price = await this.prisma.mealComplexPrice.findUnique({
      where: { id: priceId },
    });
    if (!price || price.complexId !== id)
      throw new NotFoundException('Price not found');
    if (price.validFrom.getTime() <= today.getTime())
      throw new BadRequestException('Price is already in effect');
    await this.prisma.mealComplexPrice.delete({ where: { id: priceId } });
    return this.view(id);
  }
}
