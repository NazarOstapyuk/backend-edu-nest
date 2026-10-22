import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ChargeSource,
  FinanceCategory,
  GroupKind,
  MenuStatus,
  Prisma,
  Role,
  AccessScope,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from '../attendance/calendar.service';
import { MealSettingsService } from './meal-settings.service';
import { MealOrdersService } from './meal-orders.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const BEFORE = new Date('2026-10-14T06:59:00Z');
const AFTER = new Date('2026-10-14T07:00:00Z');

const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: {},
};
const parent = {
  id: 'p1',
  role: Role.parent,
  login: 'parent',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: {},
};

const kgAdmin = {
  ...admin,
  accessScope: AccessScope.institutions,
  institutionIds: ['inst-k'],
  scopeInstitutionIds: ['inst-k'],
};

const child = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  group: {
    id: 'g1',
    kind: GroupKind.kindergarten,
    mealPriceCategory: { id: 'pc1', active: true },
  },
  ...over,
});

const mockPrisma = {
  child: { findUnique: jest.fn(), findFirst: jest.fn() },
  mealComplex: { findMany: jest.fn() },
  mealComplexPrice: { findMany: jest.fn() },
  menuDay: { findMany: jest.fn() },
  menuDayItem: { findMany: jest.fn() },
  mealOrder: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  charge: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockCalendar = { entriesBetween: jest.fn() };
const mockSettings = { getDeadline: jest.fn() };

interface MenuRow {
  id: string;
  date: Date;
  status: MenuStatus;
}
interface MenuWhere {
  date?: { in: Date[] };
  id?: { in: string[] };
}

const useMenus = (rows: MenuRow[], relocked?: MenuRow[]) => {
  let reads = 0;
  mockPrisma.menuDay.findMany.mockImplementation(
    (args: { where: MenuWhere }) => {
      const { where } = args;
      if (where.date) {
        const dates = where.date.in.map((d) => d.getTime());
        return Promise.resolve(
          rows.filter((r) => dates.includes(r.date.getTime())),
        );
      }
      reads++;
      return Promise.resolve(reads === 1 && relocked ? relocked : rows);
    },
  );
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];
const order = (date = '2026-10-14', dishIds: string[] = ['bulgur']) => ({
  date,
  complexId: 'x1',
  dishIds,
});

describe('MealOrdersService', () => {
  let service: MealOrdersService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MealOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
        { provide: MealSettingsService, useValue: mockSettings },
      ],
    }).compile();
    service = moduleRef.get(MealOrdersService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockSettings.getDeadline.mockResolvedValue('10:00');
    mockPrisma.child.findUnique.mockResolvedValue(child());
    mockPrisma.mealComplex.findMany.mockResolvedValue([
      {
        id: 'x1',
        name: 'Повний',
        active: true,
        courses: [{ courseId: 'first' }, { courseId: 'side' }],
      },
    ]);
    mockPrisma.mealComplexPrice.findMany.mockResolvedValue([
      {
        complexId: 'x1',
        priceCategoryId: 'pc1',
        validFrom: day('2026-09-01'),
        price: new Prisma.Decimal(120),
      },
    ]);
    useMenus([
      { id: 'm1', date: day('2026-10-14'), status: MenuStatus.published },
      { id: 'm2', date: day('2026-10-15'), status: MenuStatus.published },
    ]);
    mockPrisma.menuDayItem.findMany.mockResolvedValue([
      { dishId: 'soup', dish: { courseId: 'first' } },
      { dishId: 'rice', dish: { courseId: 'side' } },
      { dishId: 'bulgur', dish: { courseId: 'side' } },
    ]);
    mockPrisma.mealOrder.findFirst.mockResolvedValue(null);
    mockPrisma.charge.create.mockResolvedValue({ id: 'ch1' });
    mockPrisma.mealOrder.create.mockResolvedValue({ id: 'o1' });
    mockPrisma.mealOrder.findMany.mockResolvedValue([]);
  });

  describe('scope', () => {
    it('404s creating an order for a child outside the scope before any lock', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.create('c1', [order()], kgAdmin, BEFORE),
      ).rejects.toThrow(new NotFoundException('Child not found'));
      expect(
        firstArg<{ where: object }>(mockPrisma.child.findFirst).where,
      ).toEqual({
        id: 'c1',
        group: { institutionId: { in: ['inst-k'] } },
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates for a child inside the scope', async () => {
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
      await service.create('c1', [order()], kgAdmin, BEFORE);
      expect(mockPrisma.charge.create).toHaveBeenCalled();
    });

    it('404s cancelling an order of a child outside the scope', async () => {
      mockPrisma.mealOrder.findUnique.mockResolvedValue({
        id: 'o1',
        childId: 'c1',
        date: day('2026-10-14'),
        chargeId: 'ch1',
        cancelledAt: null,
      });
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(service.cancel('o1', kgAdmin, 'x', BEFORE)).rejects.toThrow(
        new NotFoundException('Order not found'),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates the charge and the order with snapshots', async () => {
      await service.create('c1', [order()], parent, BEFORE);
      expect(firstArg(mockPrisma.charge.create)).toEqual({
        data: {
          childId: 'c1',
          category: FinanceCategory.meals,
          amount: new Prisma.Decimal(120),
          description: 'Харчування 14.10.2026: Повний',
          periodStart: day('2026-10-14'),
          periodEnd: day('2026-10-14'),
          sourceType: ChargeSource.meals,
          createdById: 'p1',
        },
      });
      expect(firstArg(mockPrisma.mealOrder.create)).toEqual({
        data: {
          childId: 'c1',
          date: day('2026-10-14'),
          menuDayId: 'm1',
          complexId: 'x1',
          priceCategoryId: 'pc1',
          price: new Prisma.Decimal(120),
          chargeId: 'ch1',
          createdById: 'p1',
          items: {
            create: [
              { courseId: 'first', dishId: 'soup' },
              { courseId: 'side', dishId: 'bulgur' },
            ],
          },
        },
      });
      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'ch1' },
        data: { sourceId: 'o1' },
      });
    });

    it('locks the child before checking for an existing order', async () => {
      await service.create('c1', [order()], parent, BEFORE);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.mealOrder.findFirst.mock.invocationCallOrder[0],
      );
    });

    it('rejects a parent order at the deadline but allows an admin', async () => {
      await expect(
        service.create('c1', [order()], parent, AFTER),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Order deadline has passed'),
      );
      await expect(
        service.create('c1', [order()], admin, AFTER),
      ).resolves.toEqual([]);
    });

    it('rejects a second active order for the day', async () => {
      mockPrisma.mealOrder.findFirst.mockResolvedValue({ id: 'o0' });
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Order already exists'),
      );
    });

    it('rejects a non-working day', async () => {
      await expect(
        service.create('c1', [order('2026-10-17')], admin, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-17: Day is not a working day'),
      );
    });

    it('rejects a draft or missing menu', async () => {
      useMenus([
        { id: 'm1', date: day('2026-10-14'), status: MenuStatus.draft },
      ]);
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Menu is not published'),
      );
      useMenus([]);
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Menu is not published'),
      );
    });

    it('reports dish choice problems', async () => {
      await expect(
        service.create('c1', [order('2026-10-14', [])], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Dish choice is required'),
      );
      mockPrisma.mealComplex.findMany.mockResolvedValue([
        {
          id: 'x1',
          name: 'Повний',
          active: true,
          courses: [{ courseId: 'first' }, { courseId: 'drink' }],
        },
      ]);
      await expect(
        service.create('c1', [order('2026-10-14', [])], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException(
          '2026-10-14: Complex is not available on this day',
        ),
      );
    });

    it('rejects a complex without a price for the category', async () => {
      mockPrisma.mealComplexPrice.findMany.mockResolvedValue([]);
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Complex has no price'),
      );
    });

    it('rejects inactive and unknown complexes', async () => {
      mockPrisma.mealComplex.findMany.mockResolvedValueOnce([
        { id: 'x1', name: 'Повний', active: false, courses: [] },
      ]);
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Complex is inactive'),
      );
      mockPrisma.mealComplex.findMany.mockResolvedValueOnce([]);
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(new NotFoundException('Meal complex not found'));
    });

    it('checks the child group and price category', async () => {
      mockPrisma.child.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create('c1', [order()], admin, BEFORE),
      ).rejects.toThrow(new NotFoundException('Child not found'));
      mockPrisma.child.findUnique.mockResolvedValueOnce(child({ group: null }));
      await expect(
        service.create('c1', [order()], admin, BEFORE),
      ).rejects.toThrow(new BadRequestException('Child has no group'));
      mockPrisma.child.findUnique.mockResolvedValueOnce(
        child({
          group: {
            id: 'g1',
            kind: GroupKind.kindergarten,
            mealPriceCategory: null,
          },
        }),
      );
      await expect(
        service.create('c1', [order()], admin, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('Group has no meal price category'),
      );
      mockPrisma.child.findUnique.mockResolvedValueOnce(
        child({
          group: {
            id: 'g1',
            kind: GroupKind.kindergarten,
            mealPriceCategory: { id: 'pc1', active: false },
          },
        }),
      );
      await expect(
        service.create('c1', [order()], admin, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('Group has no meal price category'),
      );
    });

    it('re-reads the menu status after taking the lock', async () => {
      useMenus(
        [{ id: 'm1', date: day('2026-10-14'), status: MenuStatus.published }],
        [{ id: 'm1', date: day('2026-10-14'), status: MenuStatus.draft }],
      );
      await expect(
        service.create('c1', [order()], parent, BEFORE),
      ).rejects.toThrow(
        new BadRequestException('2026-10-14: Menu is not published'),
      );
      const lockCalls = mockPrisma.$queryRaw.mock.invocationCallOrder;
      expect(lockCalls[lockCalls.length - 1]).toBeLessThan(
        mockPrisma.menuDay.findMany.mock.invocationCallOrder[1],
      );
      expect(mockPrisma.charge.create).not.toHaveBeenCalled();
    });

    it('locks all menu days once, ordered, before reading orders', async () => {
      await service.create(
        'c1',
        [order('2026-10-14'), order('2026-10-15')],
        admin,
        BEFORE,
      );
      const locks = mockPrisma.$queryRaw.mock.calls.length;
      expect(locks).toBe(2);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        mockPrisma.mealOrder.findFirst.mock.invocationCallOrder[0],
      );
      const sql = (
        mockPrisma.$queryRaw.mock.calls[1] as [TemplateStringsArray]
      )[0].join('?');
      expect(sql).toContain('ORDER BY id FOR SHARE');
    });

    it('skips the menu lock when no menu day exists', async () => {
      useMenus([]);
      await expect(
        service.create('c1', [order()], admin, BEFORE),
      ).rejects.toThrow();
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects duplicate dates', async () => {
      await expect(
        service.create('c1', [order(), order()], parent, BEFORE),
      ).rejects.toThrow(new BadRequestException('Duplicate date in order'));
    });

    it('fails the whole multi-day order on one bad day', async () => {
      useMenus([
        { id: 'm1', date: day('2026-10-14'), status: MenuStatus.published },
        { id: 'm2', date: day('2026-10-15'), status: MenuStatus.draft },
      ]);
      await expect(
        service.create(
          'c1',
          [order('2026-10-14'), order('2026-10-15')],
          admin,
          BEFORE,
        ),
      ).rejects.toThrow(
        new BadRequestException('2026-10-15: Menu is not published'),
      );
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.mealOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const active = {
      id: 'o1',
      childId: 'c1',
      date: day('2026-10-14'),
      chargeId: 'ch1',
      cancelledAt: null,
    };

    beforeEach(() => {
      mockPrisma.mealOrder.findUnique.mockResolvedValue(active);
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'ch1',
        voidedAt: null,
      });
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
    });

    it('lets a parent cancel before the deadline and voids the charge', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([
        {
          id: 'o1',
          childId: 'c1',
          date: day('2026-10-14'),
          price: new Prisma.Decimal(120),
          createdAt: new Date(),
          cancelledAt: new Date(),
          cancelReason: 'Скасовано батьками',
          complex: { id: 'x1', name: 'Повний' },
          items: [],
        },
      ]);
      await service.cancel('o1', parent, undefined, BEFORE, 'c1');
      expect(firstArg(mockPrisma.mealOrder.update)).toEqual({
        where: { id: 'o1' },
        data: {
          cancelledAt: expect.any(Date) as Date,
          cancelledById: 'p1',
          cancelReason: 'Скасовано батьками',
        },
      });
      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'ch1' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'p1',
          voidReason: 'Скасовано батьками',
        },
      });
    });

    it('rejects a parent cancel at the deadline', async () => {
      await expect(
        service.cancel('o1', parent, undefined, AFTER, 'c1'),
      ).rejects.toThrow(new BadRequestException('Order deadline has passed'));
    });

    it('requires an admin reason after the deadline', async () => {
      await expect(
        service.cancel('o1', admin, undefined, AFTER),
      ).rejects.toThrow(new BadRequestException('Reason is required'));
      await expect(service.cancel('o1', admin, ' ', AFTER)).rejects.toThrow(
        new BadRequestException('Reason is required'),
      );
    });

    it('stores the admin reason', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      await service
        .cancel('o1', admin, 'Помилка', AFTER)
        .catch(() => undefined);
      expect(
        firstArg<{ data: { cancelReason: string } }>(
          mockPrisma.mealOrder.update,
        ).data.cancelReason,
      ).toBe('Помилка');
    });

    it('rejects a cancelled order and a foreign child', async () => {
      mockPrisma.mealOrder.findUnique.mockResolvedValueOnce({
        ...active,
        cancelledAt: new Date(),
      });
      await expect(service.cancel('o1', admin, 'x', BEFORE)).rejects.toThrow(
        new BadRequestException('Order is cancelled'),
      );
      await expect(
        service.cancel('o1', parent, undefined, BEFORE, 'c2'),
      ).rejects.toThrow(new NotFoundException('Order not found'));
      mockPrisma.mealOrder.findUnique.mockResolvedValueOnce(null);
      await expect(service.cancel('o9', admin, 'x', BEFORE)).rejects.toThrow(
        new NotFoundException('Order not found'),
      );
    });

    it('does not void a charge that was voided in finance', async () => {
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'ch1',
        voidedAt: new Date(),
      });
      await service.cancel('o1', admin, 'x', BEFORE).catch(() => undefined);
      expect(mockPrisma.mealOrder.update).toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
    });
  });
});
