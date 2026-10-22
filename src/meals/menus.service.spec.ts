import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  CalendarDayType,
  CalendarScope,
  GroupKind,
  MenuStatus,
  PermissionLevel,
  Role,
} from '@prisma/client';
import { allPermissions } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { MenusService, parsePeriod } from './menus.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const IK = '11111111-1111-4111-8111-111111111111';
const IS = '22222222-2222-4222-8222-222222222222';
const IX = '33333333-3333-4333-8333-333333333333';
const institutions: Record<string, object> = {
  [IK]: { id: IK, type: GroupKind.kindergarten, isActive: true, name: 'K' },
  [IS]: { id: IS, type: GroupKind.school_class, isActive: true, name: 'S' },
  [IX]: { id: IX, type: GroupKind.kindergarten, isActive: false, name: 'X' },
};
const KI = { id: IK, type: GroupKind.kindergarten };
const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: allPermissions(PermissionLevel.edit),
};
const kgAdmin = {
  ...admin,
  accessScope: AccessScope.institutions,
  institutionIds: [IK],
  scopeInstitutionIds: [IK],
};

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
  menuDayItem: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  dish: { findMany: jest.fn() },
  institution: { findUnique: jest.fn() },
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
    mockPrisma.institution.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(institutions[where.id] ?? null),
    );
  });

  describe('scope', () => {
    const outside = new ForbiddenException('Outside access scope');
    const period = { from: '2026-10-12', to: '2026-10-16' };
    const copyDto = (
      sourceInstitutionId: string,
      institutionIds: string[],
    ) => ({
      sourceInstitutionId,
      institutionIds,
      fromStart: '2026-10-12',
      fromEnd: '2026-10-16',
      toStart: '2026-11-02',
    });

    it('rejects a scoped manager reading another institution', async () => {
      await expect(
        service.list({ institutionId: IS, ...period }, kgAdmin),
      ).rejects.toThrow(outside);
      expect(mockPrisma.menuDay.findMany).not.toHaveBeenCalled();
    });

    it('rejects a scoped manager on every write outside their institutions', async () => {
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IS], dishIds: [] },
          kgAdmin,
        ),
      ).rejects.toThrow(outside);
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK, IS], dishIds: [] },
          kgAdmin,
        ),
      ).rejects.toThrow(outside);
      await expect(
        service.deleteDay('2026-10-14', IS, kgAdmin),
      ).rejects.toThrow(outside);
      await expect(
        service.publish({ institutionIds: [IS], ...period }, kgAdmin),
      ).rejects.toThrow(outside);
      await expect(
        service.unpublish({ institutionIds: [IS], ...period }, kgAdmin),
      ).rejects.toThrow(outside);
      await expect(service.copy(copyDto(IK, [IS]), kgAdmin)).rejects.toThrow(
        outside,
      );
      await expect(service.copy(copyDto(IS, [IK]), kgAdmin)).rejects.toThrow(
        outside,
      );
      expect(mockPrisma.menuDay.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('lets a scoped manager read their institution', async () => {
      await expect(
        service.list({ institutionId: IK, ...period }, kgAdmin),
      ).resolves.toHaveLength(5);
    });

    it('answers 404 for an unknown institution', async () => {
      await expect(
        service.list(
          { institutionId: '44444444-4444-4444-8444-444444444444', ...period },
          admin,
        ),
      ).rejects.toThrow(new NotFoundException('Institution not found'));
    });

    it('reads an inactive institution but refuses writes', async () => {
      await expect(
        service.list({ institutionId: IX, ...period }, admin),
      ).resolves.toHaveLength(5);
      await expect(
        service.publish({ institutionIds: [IX], ...period }, admin),
      ).rejects.toThrow(new BadRequestException('Institution is inactive'));
    });
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
      const working = service.workingFor(KI, entries);
      expect(working(day('2026-10-14')).working).toBe(true);
      expect(working(day('2026-10-15'))).toEqual({
        working: false,
        title: 'Садок зачинено',
      });
      expect(
        service.workingFor(
          { id: IS, type: GroupKind.school_class },
          entries,
        )(day('2026-10-15')).working,
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
      const result = await service.list(
        { institutionId: IK, from: '2026-10-13', to: '2026-10-14' },
        admin,
      );
      expect(result).toEqual([
        {
          institutionId: IK,
          date: '2026-10-13',
          working: true,
          title: null,
          menu: null,
        },
        {
          institutionId: IK,
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
      await service.saveDay(
        '2026-10-14',
        { institutionIds: [IK], dishIds: ['soup', 'rice'] },
        admin,
      );
      expect(mockPrisma.menuDayItem.createMany).toHaveBeenCalledWith({
        data: [
          { menuDayId: 'm1', dishId: 'soup' },
          { menuDayId: 'm1', dishId: 'rice' },
        ],
      });
    });

    it('rejects a non-working day', async () => {
      await expect(
        service.saveDay(
          '2026-10-17',
          { institutionIds: [IK], dishIds: ['soup'] },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Day is not a working day'));
    });

    it('rejects an unknown dish', async () => {
      mockPrisma.dish.findMany.mockResolvedValue([
        { id: 'soup', active: true },
      ]);
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK], dishIds: ['soup', 'x'] },
          admin,
        ),
      ).rejects.toThrow(new NotFoundException('Dish not found'));
    });

    it('rejects a newly added inactive dish but keeps an existing one', async () => {
      mockPrisma.dish.findMany.mockResolvedValue([
        { id: 'soup', active: false },
      ]);
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK], dishIds: ['soup'] },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Dish is inactive'));
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce({ id: 'm1' });
      mockPrisma.menuDayItem.findMany.mockResolvedValueOnce([
        { dishId: 'soup' },
      ]);
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK], dishIds: ['soup'] },
          admin,
        ),
      ).resolves.toBeDefined();
    });

    it('rejects removing a dish used by an active order and locks the day first', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValue({ id: 'm1' });
      mockPrisma.menuDayItem.findMany.mockResolvedValue([
        { dishId: 'soup' },
        { dishId: 'rice' },
      ]);
      mockPrisma.mealOrderItem.count.mockResolvedValue(1);
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK], dishIds: ['soup'] },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Dish is ordered'));
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.mealOrderItem.count.mock.invocationCallOrder[0],
      );
      expect(
        firstArg<{ where: object }>(mockPrisma.mealOrderItem.count).where,
      ).toEqual({
        dishId: { in: ['rice'] },
        order: { menuDayId: 'm1', cancelledAt: null },
      });
    });

    it('allows removing a dish used only by cancelled orders', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValue({ id: 'm1' });
      mockPrisma.menuDayItem.findMany.mockResolvedValue([
        { dishId: 'soup' },
        { dishId: 'rice' },
      ]);
      mockPrisma.mealOrderItem.count.mockResolvedValue(0);
      await service.saveDay(
        '2026-10-14',
        { institutionIds: [IK], dishIds: ['soup'] },
        admin,
      );
      expect(mockPrisma.menuDayItem.deleteMany).toHaveBeenCalledWith({
        where: { menuDayId: 'm1' },
      });
    });
  });

  describe('several institutions', () => {
    beforeEach(() => {
      mockPrisma.dish.findMany.mockResolvedValue([
        { id: 'soup', active: true },
      ]);
      mockPrisma.menuDay.findUnique.mockResolvedValue(null);
      mockPrisma.menuDay.upsert.mockImplementation(
        ({ create }: { create: { institutionId: string } }) =>
          Promise.resolve({ id: `m-${create.institutionId}` }),
      );
    });

    it('saves one dish set as a draft in each institution', async () => {
      const result = await service.saveDay(
        '2026-10-14',
        { institutionIds: [IK, IS], dishIds: ['soup'] },
        admin,
      );
      expect(result).toHaveLength(2);
      expect(
        mockPrisma.menuDay.upsert.mock.calls.map(
          (c: [{ create: { institutionId: string } }]) =>
            c[0].create.institutionId,
        ),
      ).toEqual([IK, IS]);
      expect(mockPrisma.menuDayItem.createMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('returns views carrying their institutionIds in request order', async () => {
      const result = await service.saveDay(
        '2026-10-14',
        { institutionIds: [IS, IK], dishIds: ['soup'] },
        admin,
      );
      expect(result.map((v) => v.institutionId)).toEqual([IS, IK]);
    });

    it('locks and writes institutions in id order regardless of request order', async () => {
      await service.saveDay(
        '2026-10-14',
        { institutionIds: [IS, IK], dishIds: ['soup'] },
        admin,
      );
      expect(
        mockPrisma.menuDay.findUnique.mock.calls.map(
          (c: [{ where: { date_institutionId: { institutionId: string } } }]) =>
            c[0].where.date_institutionId.institutionId,
        ),
      ).toEqual([IK, IS]);
    });

    it('fills institutions in id order regardless of request order', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([]);
      await service.fill(
        [{ id: IS, type: GroupKind.school_class }, KI],
        [{ date: day('2026-10-14'), dishIds: ['a'] }],
        false,
      );
      expect(
        mockPrisma.menuDay.create.mock.calls.map(
          (c: [{ data: { institutionId: string } }]) => c[0].data.institutionId,
        ),
      ).toEqual([IK, IS]);
    });

    it('unpublishes and deletes in an inactive institution', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([{ id: 'm1' }]);
      mockPrisma.mealOrder.count.mockResolvedValue(0);
      mockPrisma.menuDay.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.unpublish(
          { institutionIds: [IX], from: '2026-10-12', to: '2026-10-16' },
          admin,
        ),
      ).resolves.toEqual({ count: 1 });
      mockPrisma.menuDay.findUnique
        .mockResolvedValueOnce({ id: 'm1' })
        .mockResolvedValueOnce({ status: MenuStatus.draft });
      await expect(service.deleteDay('2026-10-14', IX, admin)).resolves.toEqual(
        {
          message: 'Menu day deleted',
        },
      );
    });

    it('writes nothing when one institution is inactive', async () => {
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK, IX], dishIds: ['soup'] },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Institution is inactive'));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.menuDay.upsert).not.toHaveBeenCalled();
    });

    it('rejects when the day is non-working for any institution', async () => {
      mockCalendar.entriesBetween.mockResolvedValue([
        {
          startDate: day('2026-10-14'),
          endDate: day('2026-10-14'),
          type: CalendarDayType.non_working,
          scope: CalendarScope.institution,
          groupId: null,
          institutionId: IS,
          title: 'Closed',
          voidedAt: null,
        },
      ]);
      await expect(
        service.saveDay(
          '2026-10-14',
          { institutionIds: [IK, IS], dishIds: ['soup'] },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Day is not a working day'));
    });

    it('copies the source institution menu into the targets', async () => {
      mockPrisma.menuDay.findMany
        .mockResolvedValueOnce([
          {
            date: day('2026-10-12'),
            items: [{ dishId: 'a', dish: { active: true } }],
          },
        ])
        .mockResolvedValueOnce([]);
      const result = await service.copy(
        {
          sourceInstitutionId: IK,
          institutionIds: [IS],
          fromStart: '2026-10-12',
          fromEnd: '2026-10-16',
          toStart: '2026-11-02',
        },
        admin,
      );
      expect(result.created).toBe(1);
      expect(mockPrisma.menuDay.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          institutionId: IK,
          date: { gte: day('2026-10-12'), lte: day('2026-10-16') },
        },
        select: expect.objectContaining({ date: true }) as object,
        orderBy: { date: 'asc' },
      });
      expect(
        firstArg<{ data: object }>(mockPrisma.menuDay.create).data,
      ).toEqual({
        date: day('2026-11-02'),
        institutionId: IS,
        items: { create: [{ dishId: 'a' }] },
      });
    });
  });

  describe('publish and unpublish', () => {
    it('publishes drafts with dishes', async () => {
      mockPrisma.menuDay.updateMany.mockResolvedValue({ count: 4 });
      await expect(
        service.publish(
          { institutionIds: [IK], from: '2026-10-12', to: '2026-10-16' },
          admin,
        ),
      ).resolves.toEqual({ count: 4 });
      expect(
        firstArg<{ where: object }>(mockPrisma.menuDay.updateMany).where,
      ).toEqual({
        institutionId: { in: [IK] },
        date: { gte: day('2026-10-12'), lte: day('2026-10-16') },
        status: MenuStatus.draft,
        items: { some: {} },
      });
    });

    it('refuses to unpublish a period with active orders', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([{ id: 'm1' }]);
      mockPrisma.mealOrder.count.mockResolvedValue(2);
      await expect(
        service.unpublish(
          { institutionIds: [IK], from: '2026-10-12', to: '2026-10-16' },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Menu has orders'));
      expect(mockPrisma.menuDay.updateMany).not.toHaveBeenCalled();
    });

    it('unpublishes a period without orders', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([{ id: 'm1' }]);
      mockPrisma.mealOrder.count.mockResolvedValue(0);
      mockPrisma.menuDay.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.unpublish(
          { institutionIds: [IK], from: '2026-10-12', to: '2026-10-16' },
          admin,
        ),
      ).resolves.toEqual({ count: 1 });
      const strings = (
        mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray]
      )[0].join('?');
      expect(strings).toContain('ORDER BY "institutionId", id FOR UPDATE');
    });
  });

  describe('fill and copy', () => {
    it('creates, overwrites drafts, skips published and non-working days', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([
        {
          id: 'd1',
          date: day('2026-10-20'),
          status: MenuStatus.draft,
          institutionId: IK,
        },
        {
          id: 'p1',
          date: day('2026-10-21'),
          status: MenuStatus.published,
          institutionId: IK,
        },
      ]);
      const result = await service.fill(
        [KI],
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
          institutionId: IK,
          items: { create: [{ dishId: 'a' }] },
        },
      });
      expect(mockPrisma.menuDayItem.createMany).toHaveBeenCalledWith({
        data: [{ menuDayId: 'd1', dishId: 'b' }],
      });
    });

    it('locks targets and skips days published or ordered meanwhile', async () => {
      mockPrisma.menuDay.findMany
        .mockResolvedValueOnce([
          {
            id: 'd1',
            date: day('2026-10-20'),
            status: MenuStatus.draft,
            institutionId: IK,
          },
          {
            id: 'd2',
            date: day('2026-10-21'),
            status: MenuStatus.draft,
            institutionId: IK,
          },
        ])
        .mockResolvedValueOnce([
          { id: 'd1', status: MenuStatus.published },
          { id: 'd2', status: MenuStatus.draft },
        ]);
      mockPrisma.mealOrder.groupBy.mockResolvedValue([{ menuDayId: 'd2' }]);
      const result = await service.fill(
        [KI],
        [
          { date: day('2026-10-20'), dishIds: ['a'] },
          { date: day('2026-10-21'), dishIds: ['b'] },
        ],
        true,
      );
      expect(result).toEqual({ created: 0, overwritten: 0, skipped: 2 });
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.menuDayItem.deleteMany).not.toHaveBeenCalled();
    });

    it('locks only the draft target ids', async () => {
      mockPrisma.menuDay.findMany
        .mockResolvedValueOnce([
          {
            id: 'd1',
            date: day('2026-10-20'),
            status: MenuStatus.draft,
            institutionId: IK,
          },
          {
            id: 'p1',
            date: day('2026-10-21'),
            status: MenuStatus.published,
            institutionId: IK,
          },
        ])
        .mockResolvedValueOnce([{ id: 'd1', status: MenuStatus.draft }]);
      await service.fill(
        [KI],
        [
          { date: day('2026-10-20'), dishIds: ['a'] },
          { date: day('2026-10-21'), dishIds: ['b'] },
        ],
        true,
      );
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.menuDay.findMany).toHaveBeenLastCalledWith({
        where: { id: { in: ['d1'] } },
        select: { id: true, status: true },
      });
    });

    it('takes no lock when every target is published', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValueOnce([
        {
          id: 'p1',
          date: day('2026-10-21'),
          status: MenuStatus.published,
          institutionId: IK,
        },
      ]);
      await expect(
        service.fill([KI], [{ date: day('2026-10-21'), dishIds: ['b'] }], true),
      ).resolves.toEqual({ created: 0, overwritten: 0, skipped: 1 });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('skips existing drafts without overwrite', async () => {
      mockPrisma.menuDay.findMany.mockResolvedValue([
        {
          id: 'd1',
          date: day('2026-10-20'),
          status: MenuStatus.draft,
          institutionId: IK,
        },
      ]);
      await expect(
        service.fill(
          [KI],
          [{ date: day('2026-10-20'), dishIds: ['b'] }],
          false,
        ),
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
      await service.copy(
        {
          sourceInstitutionId: IK,
          institutionIds: [IK],
          fromStart: '2026-10-12',
          fromEnd: '2026-10-16',
          toStart: '2026-11-02',
        },
        admin,
      );
      expect(fill).toHaveBeenCalledWith(
        [expect.objectContaining({ id: IK })],
        [{ date: day('2026-11-02'), dishIds: ['a'] }],
        false,
      );
    });
  });

  describe('deleteDay', () => {
    const found = (status: MenuStatus) => {
      mockPrisma.menuDay.findUnique
        .mockResolvedValueOnce({ id: 'm1' })
        .mockResolvedValueOnce({ status });
    };

    it('deletes a draft without orders after locking the day', async () => {
      found(MenuStatus.draft);
      mockPrisma.mealOrder.count.mockResolvedValue(0);
      await expect(service.deleteDay('2026-10-14', IK, admin)).resolves.toEqual(
        {
          message: 'Menu day deleted',
        },
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.menuDay.findUnique.mock.invocationCallOrder[1],
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.mealOrder.count.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.menuDay.delete).toHaveBeenCalledWith({
        where: { id: 'm1' },
      });
    });

    it('rejects a day published while waiting for the lock', async () => {
      found(MenuStatus.published);
      await expect(service.deleteDay('2026-10-14', IK, admin)).rejects.toThrow(
        new BadRequestException('Menu is published'),
      );
      expect(mockPrisma.menuDay.delete).not.toHaveBeenCalled();
    });

    it('rejects days with orders, cancelled included', async () => {
      found(MenuStatus.draft);
      mockPrisma.mealOrder.count.mockResolvedValueOnce(1);
      await expect(service.deleteDay('2026-10-14', IK, admin)).rejects.toThrow(
        new BadRequestException('Menu has orders'),
      );
      expect(mockPrisma.mealOrder.count).toHaveBeenCalledWith({
        where: { menuDayId: 'm1' },
      });
    });

    it('rejects a missing day', async () => {
      mockPrisma.menuDay.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteDay('2026-10-14', IK, admin)).rejects.toThrow(
        new NotFoundException('Menu day not found'),
      );
    });
  });
});
