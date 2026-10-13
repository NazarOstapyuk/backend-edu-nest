import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CalendarDayType,
  CalendarScope,
  GroupKind,
  MenuStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { MealSettingsService } from './meal-settings.service';
import { MealOrdersService } from './meal-orders.service';
import { ParentMealsService } from './parent-meals.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const parent = {
  id: 'p1',
  role: Role.parent,
  login: 'p',
  mustChangePassword: false,
};
const BEFORE = new Date('2026-10-14T06:00:00Z');

const dish = (id: string, courseId: string, sortOrder: number) => ({
  dish: {
    id,
    name: id,
    course: { id: courseId, name: courseId, sortOrder },
  },
});

const mockPrisma = {
  child: { findFirst: jest.fn(), findUnique: jest.fn() },
  menuDay: { findMany: jest.fn() },
  mealComplex: { findMany: jest.fn() },
  mealComplexPrice: { findMany: jest.fn() },
  mealOrder: { findMany: jest.fn() },
};
const mockCalendar = { entriesBetween: jest.fn() };
const mockSettings = { getDeadline: jest.fn() };
const mockOrders = { create: jest.fn(), cancel: jest.fn() };

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('ParentMealsService', () => {
  let service: ParentMealsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ParentMealsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
        { provide: MealSettingsService, useValue: mockSettings },
        { provide: MealOrdersService, useValue: mockOrders },
      ],
    }).compile();
    service = moduleRef.get(ParentMealsService);
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.child.findUnique.mockResolvedValue({
      id: 'c1',
      group: {
        id: 'g1',
        kind: GroupKind.kindergarten,
        mealPriceCategory: { id: 'pc1', active: true },
      },
    });
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockSettings.getDeadline.mockResolvedValue('10:00');
    mockPrisma.menuDay.findMany.mockResolvedValue([
      {
        id: 'm1',
        date: day('2026-10-14'),
        items: [
          dish('rice', 'side', 2),
          dish('soup', 'first', 1),
          dish('bulgur', 'side', 2),
        ],
      },
      {
        id: 'm2',
        date: day('2026-10-13'),
        items: [dish('soup', 'first', 1)],
      },
      {
        id: 'm3',
        date: day('2026-10-17'),
        items: [dish('soup', 'first', 1)],
      },
    ]);
    mockPrisma.mealComplex.findMany.mockResolvedValue([
      {
        id: 'x1',
        name: 'Повний',
        description: null,
        courses: [
          { course: { id: 'first', name: 'first', sortOrder: 1 } },
          { course: { id: 'side', name: 'side', sortOrder: 2 } },
        ],
      },
      {
        id: 'x2',
        name: 'Малий',
        description: null,
        courses: [{ course: { id: 'side', name: 'side', sortOrder: 2 } }],
      },
      {
        id: 'x3',
        name: 'Без ціни',
        description: null,
        courses: [{ course: { id: 'first', name: 'first', sortOrder: 1 } }],
      },
    ]);
    mockPrisma.mealComplexPrice.findMany.mockResolvedValue([
      {
        complexId: 'x1',
        priceCategoryId: 'pc1',
        validFrom: day('2026-01-01'),
        price: new Prisma.Decimal(120),
      },
      {
        complexId: 'x2',
        priceCategoryId: 'pc1',
        validFrom: day('2026-01-01'),
        price: new Prisma.Decimal(90),
      },
    ]);
    mockPrisma.mealOrder.findMany.mockResolvedValue([]);
  });

  it('checks ownership', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(
      service.menu('p1', 'c9', '2026-10-12', '2026-10-18', BEFORE),
    ).rejects.toThrow(new NotFoundException('Child not found'));
  });

  it('reads only published menus of the child kind', async () => {
    await service.menu('p1', 'c1', '2026-10-12', '2026-10-18', BEFORE);
    expect(
      firstArg<{ where: object }>(mockPrisma.menuDay.findMany).where,
    ).toEqual({
      kind: GroupKind.kindergarten,
      status: MenuStatus.published,
      date: { gte: day('2026-10-12'), lte: day('2026-10-18') },
    });
  });

  it('builds days with available complexes, options and deadline flags', async () => {
    const result = await service.menu(
      'p1',
      'c1',
      '2026-10-12',
      '2026-10-18',
      BEFORE,
    );
    expect(result.deadline).toBe('10:00');
    expect(result.days.map((d) => d.date)).toEqual([
      '2026-10-13',
      '2026-10-14',
    ]);
    const [past, today] = result.days;
    expect(past).toMatchObject({ open: false, canOrder: false, complexes: [] });
    expect(today.deadlineAt).toBe('2026-10-14T07:00:00.000Z');
    expect(today.open).toBe(true);
    expect(today.canOrder).toBe(true);
    expect(today.dishes.map((d) => d.id)).toEqual(['soup', 'bulgur', 'rice']);
    expect(today.complexes).toEqual([
      {
        id: 'x1',
        name: 'Повний',
        description: null,
        price: '120.00',
        courses: [
          {
            id: 'first',
            name: 'first',
            options: [{ id: 'soup', name: 'soup' }],
          },
          {
            id: 'side',
            name: 'side',
            options: [
              { id: 'bulgur', name: 'bulgur' },
              { id: 'rice', name: 'rice' },
            ],
          },
        ],
      },
      {
        id: 'x2',
        name: 'Малий',
        description: null,
        price: '90.00',
        courses: [
          {
            id: 'side',
            name: 'side',
            options: [
              { id: 'bulgur', name: 'bulgur' },
              { id: 'rice', name: 'rice' },
            ],
          },
        ],
      },
    ]);
  });

  it('marks a day with an active order as cancellable', async () => {
    mockPrisma.mealOrder.findMany.mockResolvedValue([
      {
        id: 'o1',
        childId: 'c1',
        date: day('2026-10-14'),
        price: new Prisma.Decimal(120),
        createdAt: new Date(),
        cancelledAt: null,
        cancelReason: null,
        complex: { id: 'x1', name: 'Повний' },
        items: [],
      },
    ]);
    const result = await service.menu(
      'p1',
      'c1',
      '2026-10-12',
      '2026-10-18',
      BEFORE,
    );
    const today = result.days.find((d) => d.date === '2026-10-14');
    expect(today?.order?.id).toBe('o1');
    expect(today?.canOrder).toBe(false);
    expect(today?.canCancel).toBe(true);
    expect(today?.order).not.toHaveProperty('createdBy');
  });

  it('returns no days for a child without a group', async () => {
    mockPrisma.child.findUnique.mockResolvedValue({ id: 'c1', group: null });
    await expect(
      service.menu('p1', 'c1', '2026-10-12', '2026-10-18', BEFORE),
    ).resolves.toEqual({ deadline: '10:00', issue: 'no_group', days: [] });
  });

  it('shows menus without complexes when the group has no price category', async () => {
    mockPrisma.child.findUnique.mockResolvedValue({
      id: 'c1',
      group: {
        id: 'g1',
        kind: GroupKind.kindergarten,
        mealPriceCategory: null,
      },
    });
    const result = await service.menu(
      'p1',
      'c1',
      '2026-10-12',
      '2026-10-18',
      BEFORE,
    );
    expect(result.issue).toBe('no_price_category');
    expect(
      result.days.every((d) => d.complexes.length === 0 && !d.canOrder),
    ).toBe(true);
  });

  it('reports no issue for a normal child and working on every day', async () => {
    const result = await service.menu(
      'p1',
      'c1',
      '2026-10-12',
      '2026-10-18',
      BEFORE,
    );
    expect(result.issue).toBeNull();
    expect(result.days.every((d) => d.working)).toBe(true);
  });

  describe('day closed after ordering', () => {
    const closed = [
      {
        startDate: day('2026-10-14'),
        endDate: day('2026-10-14'),
        type: CalendarDayType.non_working,
        scope: CalendarScope.all,
        groupId: null,
        title: 'Закрито',
        voidedAt: null,
      },
    ];
    const activeOrder = {
      id: 'o1',
      childId: 'c1',
      date: day('2026-10-14'),
      price: new Prisma.Decimal(120),
      createdAt: new Date(),
      cancelledAt: null,
      cancelReason: null,
      complex: { id: 'x1', name: 'Повний' },
      items: [],
    };

    it('keeps the day with its order and disables ordering', async () => {
      mockCalendar.entriesBetween.mockResolvedValue(closed);
      mockPrisma.mealOrder.findMany.mockResolvedValue([activeOrder]);
      const result = await service.menu(
        'p1',
        'c1',
        '2026-10-12',
        '2026-10-18',
        BEFORE,
      );
      const today = result.days.find((d) => d.date === '2026-10-14');
      expect(today).toMatchObject({
        working: false,
        complexes: [],
        canOrder: false,
        canCancel: true,
      });
      expect(today?.order?.id).toBe('o1');
    });

    it('turns cancelling off after the deadline', async () => {
      mockCalendar.entriesBetween.mockResolvedValue(closed);
      mockPrisma.mealOrder.findMany.mockResolvedValue([activeOrder]);
      const result = await service.menu(
        'p1',
        'c1',
        '2026-10-12',
        '2026-10-18',
        new Date('2026-10-14T07:00:00Z'),
      );
      const today = result.days.find((d) => d.date === '2026-10-14');
      expect(today).toMatchObject({ working: false, canCancel: false });
    });

    it('drops the closed day when there is no order', async () => {
      mockCalendar.entriesBetween.mockResolvedValue(closed);
      const result = await service.menu(
        'p1',
        'c1',
        '2026-10-12',
        '2026-10-18',
        BEFORE,
      );
      expect(result.days.map((d) => d.date)).toEqual(['2026-10-13']);
    });
  });

  it('delegates ordering and cancelling after the ownership check', async () => {
    mockOrders.create.mockResolvedValue([]);
    mockOrders.cancel.mockResolvedValue({ id: 'o1' });
    await service.order(parent, 'c1', {
      days: [{ date: '2026-10-14', complexId: 'x1', dishIds: [] }],
    });
    expect(mockOrders.create).toHaveBeenCalledWith(
      'c1',
      [{ date: '2026-10-14', complexId: 'x1', dishIds: [] }],
      parent,
    );
    await service.cancel(parent, 'c1', 'o1');
    expect(mockOrders.cancel).toHaveBeenCalledWith(
      'o1',
      parent,
      undefined,
      expect.any(Date),
      'c1',
    );
    mockPrisma.child.findFirst.mockResolvedValue(null);
    await expect(service.cancel(parent, 'c9', 'o1')).rejects.toThrow(
      new NotFoundException('Child not found'),
    );
  });
});
