import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MealDirectoriesService } from './meal-directories.service';

const mockPrisma = {
  mealCourse: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  dish: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  mealPriceCategory: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('MealDirectoriesService', () => {
  let service: MealDirectoriesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MealDirectoriesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(MealDirectoriesService);
  });

  describe('courses', () => {
    it('creates a course with a trimmed name', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue(null);
      mockPrisma.mealCourse.create.mockResolvedValue({ id: 'c1' });
      await service.createCourse({ name: ' Гарнір ', sortOrder: 3 });
      expect(firstArg(mockPrisma.mealCourse.create)).toEqual({
        data: { name: 'Гарнір', sortOrder: 3 },
      });
    });

    it('rejects a duplicate course name', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue({ id: 'c0' });
      await expect(service.createCourse({ name: 'Гарнір' })).rejects.toThrow(
        new ConflictException('Meal course already exists'),
      );
    });

    it('updates a course and checks the new name', async () => {
      mockPrisma.mealCourse.findUnique
        .mockResolvedValueOnce({ id: 'c1', name: 'Суп' })
        .mockResolvedValueOnce({ id: 'c2', name: 'Перша' });
      await expect(
        service.updateCourse('c1', { name: 'Перша' }),
      ).rejects.toThrow(new ConflictException('Meal course already exists'));
    });

    it('404 for a missing course', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue(null);
      await expect(
        service.updateCourse('c9', { active: false }),
      ).rejects.toThrow(new NotFoundException('Meal course not found'));
    });
  });

  describe('dishes', () => {
    it('filters dishes by course and active flag', async () => {
      mockPrisma.dish.findMany.mockResolvedValue([]);
      await service.listDishes({ courseId: 'c1', active: true });
      expect(
        firstArg<{ where: object }>(mockPrisma.dish.findMany).where,
      ).toEqual({ courseId: 'c1', active: true });
    });

    it('creates a dish in an active course', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue({
        id: 'c1',
        active: true,
      });
      mockPrisma.dish.findUnique.mockResolvedValue(null);
      mockPrisma.dish.create.mockResolvedValue({ id: 'd1' });
      await service.createDish({
        name: ' Булгур ',
        courseId: 'c1',
        description: ' ',
      });
      expect(firstArg<{ data: object }>(mockPrisma.dish.create).data).toEqual({
        name: 'Булгур',
        courseId: 'c1',
        description: null,
      });
    });

    it('rejects a dish in an inactive course', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue({
        id: 'c1',
        active: false,
      });
      await expect(
        service.createDish({ name: 'Булгур', courseId: 'c1' }),
      ).rejects.toThrow(new BadRequestException('Meal course is inactive'));
    });

    it('rejects a dish in a missing course', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue(null);
      await expect(
        service.createDish({ name: 'Булгур', courseId: 'c9' }),
      ).rejects.toThrow(new NotFoundException('Meal course not found'));
    });

    it('rejects a duplicate dish in the course', async () => {
      mockPrisma.mealCourse.findUnique.mockResolvedValue({
        id: 'c1',
        active: true,
      });
      mockPrisma.dish.findUnique.mockResolvedValue({ id: 'd0' });
      await expect(
        service.createDish({ name: 'Булгур', courseId: 'c1' }),
      ).rejects.toThrow(new ConflictException('Dish already exists'));
    });

    it('updates a dish: rename checks duplicates in the same course', async () => {
      mockPrisma.dish.findUnique
        .mockResolvedValueOnce({ id: 'd1', name: 'Рис', courseId: 'c1' })
        .mockResolvedValueOnce({ id: 'd2' });
      await expect(
        service.updateDish('d1', { name: 'Булгур' }),
      ).rejects.toThrow(new ConflictException('Dish already exists'));
    });

    it('clears a dish description with null', async () => {
      mockPrisma.dish.findUnique.mockResolvedValueOnce({
        id: 'd1',
        name: 'Рис',
        courseId: 'c1',
      });
      mockPrisma.dish.update.mockResolvedValue({ id: 'd1' });
      await service.updateDish('d1', { description: null, active: false });
      expect(firstArg<{ data: object }>(mockPrisma.dish.update).data).toEqual({
        name: undefined,
        description: null,
        active: false,
      });
    });
  });

  describe('price categories', () => {
    it('creates and rejects duplicates', async () => {
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValueOnce(null);
      mockPrisma.mealPriceCategory.create.mockResolvedValue({ id: 'p1' });
      await service.createPriceCategory({ name: '1–3 роки' });
      expect(firstArg(mockPrisma.mealPriceCategory.create)).toEqual({
        data: { name: '1–3 роки', sortOrder: undefined },
      });
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValueOnce({
        id: 'p1',
      });
      await expect(
        service.createPriceCategory({ name: '1–3 роки' }),
      ).rejects.toThrow(
        new ConflictException('Meal price category already exists'),
      );
    });

    it('404 for a missing category', async () => {
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue(null);
      await expect(
        service.updatePriceCategory('p9', { active: false }),
      ).rejects.toThrow(new NotFoundException('Meal price category not found'));
    });
  });
});
