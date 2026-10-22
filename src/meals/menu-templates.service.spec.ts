import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, GroupKind, PermissionLevel, Role } from '@prisma/client';
import { allPermissions } from '../access/access-calc';
import { PrismaService } from '../prisma/prisma.service';
import { MenusService } from './menus.service';
import { MenuTemplatesService } from './menu-templates.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const IK = '11111111-1111-4111-8111-111111111111';
const IS = '22222222-2222-4222-8222-222222222222';
const KI = { id: IK, type: GroupKind.kindergarten };
const SI = { id: IS, type: GroupKind.school_class };
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

const template = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Осінь',
  weeks: 2,
  active: true,
  items: [],
  ...over,
});

const mockPrisma = {
  menuTemplate: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  menuTemplateItem: {
    count: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  dish: { findMany: jest.fn() },
  $transaction: jest.fn(),
};
const mockMenus = { fill: jest.fn(), resolveInstitutions: jest.fn() };

describe('MenuTemplatesService', () => {
  let service: MenuTemplatesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MenuTemplatesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MenusService, useValue: mockMenus },
      ],
    }).compile();
    service = moduleRef.get(MenuTemplatesService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.menuTemplate.findUnique.mockResolvedValue(template());
    mockMenus.resolveInstitutions.mockResolvedValue([KI, SI]);
    mockMenus.fill.mockResolvedValue({
      created: 0,
      overwritten: 0,
      skipped: 0,
    });
  });

  it('creates a template and rejects duplicates', async () => {
    mockPrisma.menuTemplate.findUnique.mockResolvedValueOnce(null);
    mockPrisma.menuTemplate.create.mockResolvedValue({ id: 't1' });
    await service.create({ name: ' Осінь ', weeks: 4 });
    expect(mockPrisma.menuTemplate.create).toHaveBeenCalledWith({
      data: { name: 'Осінь', weeks: 4 },
    });
    mockPrisma.menuTemplate.findUnique.mockResolvedValueOnce({ id: 't0' });
    await expect(service.create({ name: 'Осінь', weeks: 4 })).rejects.toThrow(
      new ConflictException('Menu template already exists'),
    );
  });

  it('refuses to shrink weeks below existing items', async () => {
    mockPrisma.menuTemplateItem.count.mockResolvedValue(3);
    await expect(service.update('t1', { weeks: 1 })).rejects.toThrow(
      new BadRequestException('Template week out of range'),
    );
    expect(mockPrisma.menuTemplateItem.count).toHaveBeenCalledWith({
      where: { templateId: 't1', week: { gt: 1 } },
    });
  });

  it('404 for a missing template', async () => {
    mockPrisma.menuTemplate.findUnique.mockResolvedValue(null);
    await expect(service.update('t9', { active: false })).rejects.toThrow(
      new NotFoundException('Menu template not found'),
    );
  });

  describe('saveItems', () => {
    it('replaces items and removes duplicates', async () => {
      mockPrisma.dish.findMany.mockResolvedValue([{ id: 'a', active: true }]);
      await service.saveItems('t1', {
        items: [
          { week: 1, weekday: 1, dishId: 'a' },
          { week: 1, weekday: 1, dishId: 'a' },
          { week: 2, weekday: 3, dishId: 'a' },
        ],
      });
      expect(mockPrisma.menuTemplateItem.deleteMany).toHaveBeenCalledWith({
        where: { templateId: 't1' },
      });
      expect(mockPrisma.menuTemplateItem.createMany).toHaveBeenCalledWith({
        data: [
          { templateId: 't1', week: 1, weekday: 1, dishId: 'a' },
          { templateId: 't1', week: 2, weekday: 3, dishId: 'a' },
        ],
      });
    });

    it('rejects a week beyond the cycle, unknown and new inactive dishes', async () => {
      await expect(
        service.saveItems('t1', {
          items: [{ week: 3, weekday: 1, dishId: 'a' }],
        }),
      ).rejects.toThrow(new BadRequestException('Template week out of range'));
      mockPrisma.dish.findMany.mockResolvedValueOnce([]);
      await expect(
        service.saveItems('t1', {
          items: [{ week: 1, weekday: 1, dishId: 'a' }],
        }),
      ).rejects.toThrow(new NotFoundException('Dish not found'));
      mockPrisma.dish.findMany.mockResolvedValueOnce([
        { id: 'a', active: false },
      ]);
      await expect(
        service.saveItems('t1', {
          items: [{ week: 1, weekday: 1, dishId: 'a' }],
        }),
      ).rejects.toThrow(new BadRequestException('Dish is inactive'));
    });

    it('keeps an inactive dish already in the template', async () => {
      mockPrisma.menuTemplate.findUnique.mockResolvedValue(
        template({ items: [{ week: 1, weekday: 1, dishId: 'a', dish: {} }] }),
      );
      mockPrisma.dish.findMany.mockResolvedValue([{ id: 'a', active: false }]);
      await expect(
        service.saveItems('t1', {
          items: [{ week: 1, weekday: 1, dishId: 'a' }],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('apply', () => {
    it('builds a cyclic plan from the template, skipping empty and inactive', async () => {
      mockPrisma.menuTemplate.findUnique.mockResolvedValue(
        template({
          items: [
            { week: 1, weekday: 1, dishId: 'mon1', dish: { active: true } },
            { week: 2, weekday: 1, dishId: 'mon2', dish: { active: true } },
            { week: 2, weekday: 2, dishId: 'off', dish: { active: false } },
          ],
        }),
      );
      await service.apply(
        't1',
        {
          institutionIds: [IK, IS],
          from: '2026-10-12',
          to: '2026-10-27',
          startWeek: 1,
          overwrite: true,
        },
        admin,
      );
      expect(mockMenus.resolveInstitutions).toHaveBeenCalledWith(
        [IK, IS],
        admin,
        true,
      );
      expect(mockMenus.fill).toHaveBeenCalledWith(
        [KI, SI],
        [
          { date: day('2026-10-12'), dishIds: ['mon1'] },
          { date: day('2026-10-19'), dishIds: ['mon2'] },
          { date: day('2026-10-26'), dishIds: ['mon1'] },
        ],
        true,
      );
    });

    it('writes nothing when an institution is refused', async () => {
      mockMenus.resolveInstitutions.mockRejectedValue(
        new ForbiddenException('Outside access scope'),
      );
      await expect(
        service.apply(
          't1',
          {
            institutionIds: [IS],
            from: '2026-10-12',
            to: '2026-10-16',
            startWeek: 1,
          },
          admin,
        ),
      ).rejects.toThrow(new ForbiddenException('Outside access scope'));
      expect(mockMenus.fill).not.toHaveBeenCalled();
    });

    it('rejects an inactive template', async () => {
      mockPrisma.menuTemplate.findUnique.mockResolvedValue(
        template({ active: false }),
      );
      await expect(
        service.apply(
          't1',
          {
            institutionIds: [IK],
            from: '2026-10-12',
            to: '2026-10-16',
            startWeek: 1,
          },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Menu template is inactive'));
      expect(mockMenus.fill).not.toHaveBeenCalled();
    });

    it('rejects a start week beyond the cycle', async () => {
      await expect(
        service.apply(
          't1',
          {
            institutionIds: [IK],
            from: '2026-10-12',
            to: '2026-10-16',
            startWeek: 3,
          },
          admin,
        ),
      ).rejects.toThrow(new BadRequestException('Template week out of range'));
    });
  });
});
