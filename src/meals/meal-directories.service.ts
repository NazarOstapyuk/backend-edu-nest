import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDishDto,
  CreateSortedNamedDto,
  DishesQueryDto,
  UpdateDishDto,
  UpdateSortedNamedDto,
} from './dto/meal-directory.dto';

const sorted = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

@Injectable()
export class MealDirectoriesService {
  constructor(private prisma: PrismaService) {}

  listCourses() {
    return this.prisma.mealCourse.findMany({ orderBy: sorted });
  }

  async createCourse(dto: CreateSortedNamedDto) {
    const name = dto.name.trim();
    if (await this.prisma.mealCourse.findUnique({ where: { name } }))
      throw new ConflictException('Meal course already exists');
    return this.prisma.mealCourse.create({
      data: { name, sortOrder: dto.sortOrder },
    });
  }

  async updateCourse(id: string, dto: UpdateSortedNamedDto) {
    const course = await this.prisma.mealCourse.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Meal course not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== course.name &&
      (await this.prisma.mealCourse.findUnique({ where: { name } }))
    )
      throw new ConflictException('Meal course already exists');
    return this.prisma.mealCourse.update({
      where: { id },
      data: { name, sortOrder: dto.sortOrder, active: dto.active },
    });
  }

  listDishes(query: DishesQueryDto) {
    return this.prisma.dish.findMany({
      where: { courseId: query.courseId, active: query.active },
      include: {
        course: { select: { id: true, name: true, sortOrder: true } },
      },
      orderBy: [{ course: { sortOrder: 'asc' } }, { name: 'asc' }],
    });
  }

  async createDish(dto: CreateDishDto) {
    const course = await this.prisma.mealCourse.findUnique({
      where: { id: dto.courseId },
    });
    if (!course) throw new NotFoundException('Meal course not found');
    if (!course.active)
      throw new BadRequestException('Meal course is inactive');
    const name = dto.name.trim();
    if (
      await this.prisma.dish.findUnique({
        where: { courseId_name: { courseId: dto.courseId, name } },
      })
    )
      throw new ConflictException('Dish already exists');
    return this.prisma.dish.create({
      data: {
        name,
        courseId: dto.courseId,
        description: dto.description?.trim() || null,
      },
      include: {
        course: { select: { id: true, name: true, sortOrder: true } },
      },
    });
  }

  async updateDish(id: string, dto: UpdateDishDto) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Dish not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== dish.name &&
      (await this.prisma.dish.findUnique({
        where: { courseId_name: { courseId: dish.courseId, name } },
      }))
    )
      throw new ConflictException('Dish already exists');
    const description =
      dto.description === undefined
        ? undefined
        : dto.description?.trim() || null;
    return this.prisma.dish.update({
      where: { id },
      data: { name, description, active: dto.active },
      include: {
        course: { select: { id: true, name: true, sortOrder: true } },
      },
    });
  }

  listPriceCategories() {
    return this.prisma.mealPriceCategory.findMany({ orderBy: sorted });
  }

  async createPriceCategory(dto: CreateSortedNamedDto) {
    const name = dto.name.trim();
    if (await this.prisma.mealPriceCategory.findUnique({ where: { name } }))
      throw new ConflictException('Meal price category already exists');
    return this.prisma.mealPriceCategory.create({
      data: { name, sortOrder: dto.sortOrder },
    });
  }

  async updatePriceCategory(id: string, dto: UpdateSortedNamedDto) {
    const category = await this.prisma.mealPriceCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Meal price category not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== category.name &&
      (await this.prisma.mealPriceCategory.findUnique({ where: { name } }))
    )
      throw new ConflictException('Meal price category already exists');
    return this.prisma.mealPriceCategory.update({
      where: { id },
      data: { name, sortOrder: dto.sortOrder, active: dto.active },
    });
  }
}
