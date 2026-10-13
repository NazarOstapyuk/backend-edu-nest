import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MealComplexesService } from './meal-complexes.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');

const complexRow = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  name: 'Повний',
  description: null,
  sortOrder: 0,
  active: true,
  courses: [
    { course: { id: 'main', name: 'Друга страва', sortOrder: 2 } },
    { course: { id: 'first', name: 'Перша страва', sortOrder: 1 } },
  ],
  prices: [
    {
      id: 'pr1',
      priceCategoryId: 'p1',
      priceCategory: { name: '1–3 роки' },
      price: new Prisma.Decimal(120),
      validFrom: day('2026-09-01'),
    },
  ],
  ...over,
});

const mockPrisma = {
  mealComplex: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  mealCourse: { findMany: jest.fn() },
  mealComplexCourse: { deleteMany: jest.fn(), createMany: jest.fn() },
  mealPriceCategory: { findUnique: jest.fn() },
  mealComplexPrice: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('MealComplexesService', () => {
  let service: MealComplexesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MealComplexesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(MealComplexesService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.mealComplex.findUnique.mockResolvedValue(complexRow());
  });

  it('shapes the complex view with sorted courses and string prices', async () => {
    mockPrisma.mealComplex.findMany.mockResolvedValue([complexRow()]);
    await expect(service.list()).resolves.toEqual([
      {
        id: 'x1',
        name: 'Повний',
        description: null,
        sortOrder: 0,
        active: true,
        courses: [
          { id: 'first', name: 'Перша страва', sortOrder: 1 },
          { id: 'main', name: 'Друга страва', sortOrder: 2 },
        ],
        prices: [
          {
            id: 'pr1',
            priceCategoryId: 'p1',
            priceCategoryName: '1–3 роки',
            price: '120.00',
            validFrom: '2026-09-01',
          },
        ],
      },
    ]);
  });

  describe('create', () => {
    it('creates a complex with active courses', async () => {
      mockPrisma.mealComplex.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(complexRow());
      mockPrisma.mealCourse.findMany.mockResolvedValue([
        { id: 'first', active: true },
        { id: 'main', active: true },
      ]);
      mockPrisma.mealComplex.create.mockResolvedValue({ id: 'x1' });
      await service.create({
        name: ' Повний ',
        courseIds: ['first', 'main'],
      });
      expect(firstArg(mockPrisma.mealComplex.create)).toEqual({
        data: {
          name: 'Повний',
          description: null,
          sortOrder: undefined,
          courses: {
            create: [{ courseId: 'first' }, { courseId: 'main' }],
          },
        },
      });
    });

    it('rejects a duplicate name', async () => {
      mockPrisma.mealComplex.findUnique.mockResolvedValueOnce({ id: 'x0' });
      await expect(
        service.create({ name: 'Повний', courseIds: ['first'] }),
      ).rejects.toThrow(new ConflictException('Meal complex already exists'));
    });

    it('rejects missing or inactive courses', async () => {
      mockPrisma.mealComplex.findUnique.mockResolvedValueOnce(null);
      mockPrisma.mealCourse.findMany.mockResolvedValueOnce([
        { id: 'first', active: true },
      ]);
      await expect(
        service.create({ name: 'Повний', courseIds: ['first', 'x'] }),
      ).rejects.toThrow(new NotFoundException('Meal course not found'));
      mockPrisma.mealComplex.findUnique.mockResolvedValueOnce(null);
      mockPrisma.mealCourse.findMany.mockResolvedValueOnce([
        { id: 'first', active: false },
      ]);
      await expect(
        service.create({ name: 'Повний', courseIds: ['first'] }),
      ).rejects.toThrow(new BadRequestException('Meal course is inactive'));
    });
  });

  describe('update', () => {
    it('replaces courses and allows keeping an inactive current course', async () => {
      mockPrisma.mealCourse.findMany.mockResolvedValue([
        { id: 'first', active: false },
        { id: 'salad', active: true },
      ]);
      await service.update('x1', { courseIds: ['first', 'salad'] });
      expect(mockPrisma.mealComplexCourse.deleteMany).toHaveBeenCalledWith({
        where: { complexId: 'x1' },
      });
      expect(mockPrisma.mealComplexCourse.createMany).toHaveBeenCalledWith({
        data: [
          { complexId: 'x1', courseId: 'first' },
          { complexId: 'x1', courseId: 'salad' },
        ],
      });
    });

    it('rejects adding an inactive course that is not current', async () => {
      mockPrisma.mealCourse.findMany.mockResolvedValue([
        { id: 'drink', active: false },
      ]);
      await expect(
        service.update('x1', { courseIds: ['drink'] }),
      ).rejects.toThrow(new BadRequestException('Meal course is inactive'));
    });

    it('404 for a missing complex', async () => {
      mockPrisma.mealComplex.findUnique.mockResolvedValue(null);
      await expect(service.update('x9', { active: false })).rejects.toThrow(
        new NotFoundException('Meal complex not found'),
      );
    });
  });

  describe('prices', () => {
    it('adds a price', async () => {
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue({
        id: 'p1',
        active: true,
      });
      mockPrisma.mealComplexPrice.findUnique.mockResolvedValue(null);
      await service.addPrice('x1', {
        priceCategoryId: 'p1',
        price: '130.50',
        validFrom: '2026-11-01',
      });
      expect(firstArg(mockPrisma.mealComplexPrice.create)).toEqual({
        data: {
          complexId: 'x1',
          priceCategoryId: 'p1',
          price: '130.50',
          validFrom: day('2026-11-01'),
        },
      });
    });

    it('rejects a zero price, unknown/inactive category and duplicates', async () => {
      await expect(
        service.addPrice('x1', {
          priceCategoryId: 'p1',
          price: '0',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(
        new BadRequestException('Amount must be greater than 0'),
      );
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.addPrice('x1', {
          priceCategoryId: 'p9',
          price: '10',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(new NotFoundException('Meal price category not found'));
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValueOnce({
        id: 'p2',
        active: false,
      });
      await expect(
        service.addPrice('x1', {
          priceCategoryId: 'p2',
          price: '10',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(
        new BadRequestException('Meal price category is inactive'),
      );
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValueOnce({
        id: 'p1',
        active: true,
      });
      mockPrisma.mealComplexPrice.findUnique.mockResolvedValueOnce({
        id: 'pr1',
      });
      await expect(
        service.addPrice('x1', {
          priceCategoryId: 'p1',
          price: '10',
          validFrom: '2026-09-01',
        }),
      ).rejects.toThrow(
        new BadRequestException('Price for this date already exists'),
      );
    });

    it('deletes only a future price', async () => {
      mockPrisma.mealComplexPrice.findUnique.mockResolvedValueOnce({
        id: 'pr2',
        complexId: 'x1',
        validFrom: day('2026-10-15'),
      });
      await service.deletePrice('x1', 'pr2', TODAY);
      expect(mockPrisma.mealComplexPrice.delete).toHaveBeenCalledWith({
        where: { id: 'pr2' },
      });
      mockPrisma.mealComplexPrice.findUnique.mockResolvedValueOnce({
        id: 'pr1',
        complexId: 'x1',
        validFrom: day('2026-10-14'),
      });
      await expect(service.deletePrice('x1', 'pr1', TODAY)).rejects.toThrow(
        new BadRequestException('Price is already in effect'),
      );
    });

    it('404 when the price belongs to another complex', async () => {
      mockPrisma.mealComplexPrice.findUnique.mockResolvedValueOnce({
        id: 'pr5',
        complexId: 'x2',
        validFrom: day('2026-12-01'),
      });
      await expect(service.deletePrice('x1', 'pr5', TODAY)).rejects.toThrow(
        new NotFoundException('Price not found'),
      );
    });
  });
});
