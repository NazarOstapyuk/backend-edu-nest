import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CalendarDayType,
  CalendarScope,
  GroupKind,
  MenuStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { MenusService, parsePeriod } from './menus.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const K = GroupKind.kindergarten;

const dish = (id: string, active = true) => ({
  id,
  name: id,
  active,
  course: { id: `c-${id}`, name: `Course ${id}`, sortOrder: 1 },
});

const mockPrisma = {
  menuDay: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  menuDayItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  dish: { findMany: jest.fn() },
  mealOrder: { groupBy: jest.fn(), count: jest.fn() },
  mealOrderItem: { count: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockCalendar = { entriesBetween: jest.fn() };

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('parsePeriod', () => {
  it('validates order and length', () => {
    expect(parsePeriod('2026-10-01', '2026-10-31', 62)).toEqual({
      from: day('2026-10-01'),
      to: day('2026-10-31'),
    });
    expect(() => parsePeriod('2026-10-02', '2026-10-01', 62)).toThrow(
      new BadRequestException('Invalid period'),
    );
    expect(() => parsePeriod('2026-10-01', '2026-12-31', 62)).toThrow(
      new BadRequestException('Period is too long'),
    );
  });
});

describe('MenusService', () => {
  let service: MenusService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MenusService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
      ],
    }).compile();
    service = moduleRef.get(MenusService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockPrisma.mealOrder.groupBy.mockResolvedValue([]);
    mockPrisma.menuDay.findMany.mockResolvedValue([]);
  });

  describe('workingFor', () => {
    it('ignores group-level entries and uses kind-level ones', () => {
      const entries = [
        {
          startDate: day('2026-10-14'),
          endDate: day('2026-10-14'),
          type: CalendarDayType.non_working,
          scope: CalendarScope.group,
          groupId: 'g1',
          title: 'Group trip',
          voidedAt: null,
        },
        {
          startDate: day('2026-10-15'),
          endDate: day('2026-10-15'),
          type: CalendarDayType.non_working,
          scope: CalendarScope.kindergarten,
          groupId: null,
          title: 'Садок зачинено',
          voidedAt: null,
        },
      ];
      const working = service.workingFor(K, entries);
      expect(working(day('2026-10-14')).working).toBe(true);
      expect(working(day('2026-10-15'))).toEqual({
        working: false,
        title: 'Садок зачинено',
      });
      expect(
        service.workingFor(GroupKind.school_class, entries)(day('2026-10-15'))
          .working,
      ).toBe(true);
      expect(working(day('2026-10-17')).working).toBe(false);
    });
  });

  describe('list', () => {
    it('returns every date with its menu and active order count', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([
        {
          id: 'm1',
          date: day('2026-10-14'),
          status: MenuStatus.published,
          publishedAt: null,
          items: [{ dish: dish('soup') }],
        },
      ]);
      mockPrisma.mealOrder.groupBy.mockResolvedValue([
        { menuDayId: 'm1', _count: { _all: 3 } },
      ]);
      const result = await service.list({
        kind: K,
        from: '2026-10-13',
        to: '2026-10-14',
      });
      expect(result).toEqual([
        { date: '2026-10-13', working: true, title: null, menu: null },
        {
          date: '2026-10-14',
          working: true,
          title: null,
          menu: {
            id: 'm1',
            status: MenuStatus.published,
            publishedAt: null,
            activeOrders: 3,
            dishes: [dish('soup')],
          },
        },
      ]);
    });
  });

  describe('saveDay', () => {
    beforeEach(() => {
      mockPrisma.dish.findMany.mockResolvedValue([
        { id: 'soup', active: true },
        { id: 'rice', active: true },
      ]);
      mockPrisma.menuDay.upsert.mockResolvedValue({ id: 'm1' });
    });

    it('creates a draft day with the dishes', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValue(null);
      await service.saveDay('2026-10-14', K, { dishIds: ['soup', 'rice'] });
      expect(mockPrisma.menuDayItem.createMany).toHaveBeenCalledWith({
        data: [
          { menuDayId: 'm1', dishId: 'soup' },
          { menuDayId: 'm1', dishId: 'rice' },
        ],
      });
    });

    it('rejects a non-working day', async () => {
      await expect(
        service.saveDay('2026-10-17', K, { dishIds: ['soup'] }),
      ).rejects.toThrow(new BadRequestException('Day is not a working day'));
    });

    it('rejects an unknown dish', async () => {
      mockPrisma.dish.findMany.mockResolvedValue([
        { id: 'soup', active: true },
      ]);
      await expect(
        service.saveDay('2026-10-14', K, { dishIds: ['soup', 'x'] }),
      ).rejects.toThrow(new NotFoundException('Dish not found'));
    });

    it('rejects a newly added inactive dish but keeps an existing one', async () => {
      mockPrisma.dish.findMany.mockResolvedValue([
        { id: 'soup', active: false },
      ]);
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.saveDay('2026-10-14', K, { dishIds: ['soup'] }),
      ).rejects.toThrow(new BadRequestException('Dish is inactive'));
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce({
        id: 'm1',
        status: MenuStatus.draft,
        items: [{ dishId: 'soup' }],
      });
      await expect(
        service.saveDay('2026-10-14', K, { dishIds: ['soup'] }),
      ).resolves.toBeDefined();
    });

    it('rejects removing a dish used by an active order and locks the day first', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValue({
        id: 'm1',
        status: MenuStatus.published,
        items: [{ dishId: 'soup' }, { dishId: 'rice' }],
      });
      mockPrisma.mealOrderItem.count.mockResolvedValue(1);
      await expect(
        service.saveDay('2026-10-14', K, { dishIds: ['soup'] }),
      ).rejects.toThrow(new BadRequestException('Dish is ordered'));
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(
        firstArg<{ where: object }>(mockPrisma.mealOrderItem.count).where,
      ).toEqual({
        dishId: { in: ['rice'] },
        order: { menuDayId: 'm1', cancelledAt: null },
      });
    });

    it('allows removing a dish used only by cancelled orders', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValue({
        id: 'm1',
        status: MenuStatus.published,
        items: [{ dishId: 'soup' }, { dishId: 'rice' }],
      });
      mockPrisma.mealOrderItem.count.mockResolvedValue(0);
      await service.saveDay('2026-10-14', K, { dishIds: ['soup'] });
      expect(mockPrisma.menuDayItem.deleteMany).toHaveBeenCalledWith({
        where: { menuDayId: 'm1' },
      });
    });
  });

  describe('publish and unpublish', () => {
    it('publishes drafts with dishes', async () => {
      mockPrisma.menuDay.updateMany.mockResolvedValue({ count: 4 });
      await expect(
        service.publish({ kind: K, from: '2026-10-12', to: '2026-10-16' }),
      ).resolves.toEqual({ count: 4 });
      expect(
        firstArg<{ where: object }>(mockPrisma.menuDay.updateMany).where,
      ).toEqual({
        kind: K,
        date: { gte: day('2026-10-12'), lte: day('2026-10-16') },
        status: MenuStatus.draft,
        items: { some: {} },
      });
    });

    it('refuses to unpublish a period with active orders', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([{ id: 'm1' }]);
      mockPrisma.mealOrder.count.mockResolvedValue(2);
      await expect(
        service.unpublish({ kind: K, from: '2026-10-12', to: '2026-10-16' }),
      ).rejects.toThrow(new BadRequestException('Menu has orders'));
      expect(mockPrisma.menuDay.updateMany).not.toHaveBeenCalled();
    });

    it('unpublishes a period without orders', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([{ id: 'm1' }]);
      mockPrisma.mealOrder.count.mockResolvedValue(0);
      mockPrisma.menuDay.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.unpublish({ kind: K, from: '2026-10-12', to: '2026-10-16' }),
      ).resolves.toEqual({ count: 1 });
    });
  });

  describe('fill and copy', () => {
    it('creates, overwrites drafts, skips published and non-working days', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([
        { id: 'd1', date: day('2026-10-20'), status: MenuStatus.draft },
        { id: 'p1', date: day('2026-10-21'), status: MenuStatus.published },
      ]);
      const result = await service.fill(
        K,
        [
          { date: day('2026-10-19'), dishIds: ['a'] },
          { date: day('2026-10-20'), dishIds: ['b'] },
          { date: day('2026-10-21'), dishIds: ['c'] },
          { date: day('2026-10-24'), dishIds: ['d'] },
        ],
        true,
      );
      expect(result).toEqual({ created: 1, overwritten: 1, skipped: 2 });
      expect(firstArg(mockPrisma.menuDay.create)).toEqual({
        data: {
          date: day('2026-10-19'),
          kind: K,
          items: { create: [{ dishId: 'a' }] },
        },
      });
      expect(mockPrisma.menuDayItem.createMany).toHaveBeenCalledWith({
        data: [{ menuDayId: 'd1', dishId: 'b' }],
      });
    });

    it('skips existing drafts without overwrite', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([
        { id: 'd1', date: day('2026-10-20'), status: MenuStatus.draft },
      ]);
      await expect(
        service.fill(K, [{ date: day('2026-10-20'), dishIds: ['b'] }], false),
      ).resolves.toEqual({ created: 0, overwritten: 0, skipped: 1 });
    });

    it('copies a week to the offset dates and drops inactive dishes', async () => {
      mockPrisma.menuDay.findMany
        .mockResolvedValueOnce([
          {
            date: day('2026-10-12'),
            items: [
              { dishId: 'a', dish: { active: true } },
              { dishId: 'x', dish: { active: false } },
            ],
          },
          {
            date: day('2026-10-13'),
            items: [{ dishId: 'y', dish: { active: false } }],
          },
        ])
        .mockResolvedValueOnce([]);
      const fill = jest.spyOn(service, 'fill');
      await service.copy({
        kind: K,
        fromStart: '2026-10-12',
        fromEnd: '2026-10-16',
        toStart: '2026-11-02',
      });
      expect(fill).toHaveBeenCalledWith(
        K,
        [{ date: day('2026-11-02'), dishIds: ['a'] }],
        false,
      );
    });
  });

  describe('deleteDay', () => {
    it('deletes a draft without orders', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValue({
        id: 'm1',
        status: MenuStatus.draft,
      });
      mockPrisma.mealOrder.count.mockResolvedValue(0);
      await expect(service.deleteDay('2026-10-14', K)).resolves.toEqual({
        message: 'Menu day deleted',
      });
    });

    it('rejects published days, days with orders and missing days', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce({
        id: 'm1',
        status: MenuStatus.published,
      });
      await expect(service.deleteDay('2026-10-14', K)).rejects.toThrow(
        new BadRequestException('Menu is published'),
      );
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce({
        id: 'm1',
        status: MenuStatus.draft,
      });
      mockPrisma.mealOrder.count.mockResolvedValueOnce(1);
      await expect(service.deleteDay('2026-10-14', K)).rejects.toThrow(
        new BadRequestException('Menu has orders'),
      );
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteDay('2026-10-14', K)).rejects.toThrow(
        new NotFoundException('Menu day not found'),
      );
    });
  });
});
