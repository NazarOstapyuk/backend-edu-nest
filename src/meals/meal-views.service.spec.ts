import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  GroupKind,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import { allPermissions } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import { MealViewsService } from './meal-views.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: allPermissions(PermissionLevel.edit),
};
const teacher = {
  id: 't1',
  role: Role.teacher,
  login: 't',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  childId: 'c1',
  date: day('2026-10-14'),
  price: new Prisma.Decimal(120),
  createdAt: new Date('2026-10-13T10:00:00Z'),
  cancelledAt: null,
  cancelReason: null,
  complex: { id: 'x1', name: 'Повний' },
  items: [
    {
      course: { id: 'side', name: 'Гарнір', sortOrder: 2 },
      dish: { id: 'rice', name: 'Рис' },
    },
    {
      course: { id: 'first', name: 'Перша', sortOrder: 1 },
      dish: { id: 'soup', name: 'Суп' },
    },
  ],
  child: {
    id: 'c1',
    firstName: 'Ія',
    lastName: 'Бондар',
    group: { id: 'g1', name: 'Сонечко' },
  },
  createdBy: {
    id: 'p1',
    firstName: 'Олена',
    lastName: 'Бондар',
    role: Role.parent,
  },
  cancelledBy: null,
  ...over,
});

const mockPrisma = {
  mealOrder: { findMany: jest.fn() },
  group: { findUnique: jest.fn() },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('MealViewsService', () => {
  let service: MealViewsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MealViewsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(MealViewsService);
  });

  describe('scope', () => {
    const kgAdmin = { ...admin, accessScope: AccessScope.kindergarten };

    it('limits the admin list to children of the scoped kind', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      await service.adminList({ date: '2026-10-14', groupId: 'g1' }, kgAdmin);
      expect(
        firstArg<{ where: object }>(mockPrisma.mealOrder.findMany).where,
      ).toEqual({
        date: day('2026-10-14'),
        child: { group: { kind: GroupKind.kindergarten, id: 'g1' } },
      });
    });

    it('rejects a request for another kind than the scope', async () => {
      await expect(
        service.adminList(
          { date: '2026-10-14', kind: GroupKind.school_class },
          kgAdmin,
        ),
      ).rejects.toThrow(new ForbiddenException('Outside access scope'));
      expect(mockPrisma.mealOrder.findMany).not.toHaveBeenCalled();
    });

    it('404s today for a group of another kind', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g2',
        kind: GroupKind.school_class,
        teachers: [],
      });
      await expect(
        service.today('g2', kgAdmin, day('2026-10-14')),
      ).rejects.toThrow(new NotFoundException('Group not found'));
      expect(mockPrisma.mealOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('adminList', () => {
    it('filters by date, kind and group', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      await service.adminList(
        {
          date: '2026-10-14',
          kind: GroupKind.kindergarten,
          groupId: 'g1',
        },
        admin,
      );
      expect(
        firstArg<{ where: object }>(mockPrisma.mealOrder.findMany).where,
      ).toEqual({
        date: day('2026-10-14'),
        child: { group: { kind: GroupKind.kindergarten, id: 'g1' } },
      });
    });

    it('lists orders with people and counts only active ones', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([
        row(),
        row({
          id: 'o2',
          childId: 'c2',
          cancelledAt: new Date(),
          cancelReason: 'Відсутність',
          cancelledBy: { id: 'a1', firstName: 'Адмін', lastName: 'Головний' },
        }),
      ]);
      const result = await service.adminList({ date: '2026-10-14' }, admin);
      expect(result.orders).toHaveLength(2);
      expect(result.orders[0]).toMatchObject({
        id: 'o1',
        price: '120.00',
        child: { id: 'c1', firstName: 'Ія', lastName: 'Бондар' },
        group: { id: 'g1', name: 'Сонечко' },
        createdBy: { id: 'p1', role: Role.parent },
        items: [
          { courseId: 'first', dishName: 'Суп' },
          { courseId: 'side', dishName: 'Рис' },
        ],
      });
      expect(result.summary).toEqual({
        complexes: [{ complexId: 'x1', name: 'Повний', count: 1 }],
        dishes: [
          { dishId: 'soup', name: 'Суп', courseName: 'Перша', count: 1 },
          { dishId: 'rice', name: 'Рис', courseName: 'Гарнір', count: 1 },
        ],
      });
    });
  });

  describe('today', () => {
    beforeEach(() => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        teachers: [{ id: 't1' }],
      });
      mockPrisma.mealOrder.findMany.mockResolvedValue([row()]);
    });

    it('returns active orders of the group for Kyiv today', async () => {
      const result = await service.today('g1', teacher, day('2026-10-14'));
      expect(
        firstArg<{ where: object }>(mockPrisma.mealOrder.findMany).where,
      ).toEqual({
        date: day('2026-10-14'),
        cancelledAt: null,
        child: { groupId: 'g1' },
      });
      expect(result.date).toBe('2026-10-14');
      expect(result.orders[0]).toEqual({
        id: 'o1',
        child: { id: 'c1', firstName: 'Ія', lastName: 'Бондар' },
        complex: { id: 'x1', name: 'Повний' },
        items: [
          {
            courseId: 'first',
            courseName: 'Перша',
            dishId: 'soup',
            dishName: 'Суп',
          },
          {
            courseId: 'side',
            courseName: 'Гарнір',
            dishId: 'rice',
            dishName: 'Рис',
          },
        ],
      });
      expect(result.summary.complexes).toEqual([
        { complexId: 'x1', name: 'Повний', count: 1 },
      ]);
    });

    it('rejects a teacher of another group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g2',
        teachers: [{ id: 't9' }],
      });
      await expect(
        service.today('g2', teacher, day('2026-10-14')),
      ).rejects.toThrow(new ForbiddenException('Not your class group'));
    });

    it('allows an admin and 404s a missing group', async () => {
      await expect(
        service.today('g1', admin, day('2026-10-14')),
      ).resolves.toBeDefined();
      mockPrisma.group.findUnique.mockResolvedValue(null);
      await expect(
        service.today('g9', admin, day('2026-10-14')),
      ).rejects.toThrow(new NotFoundException('Group not found'));
    });
  });
});
