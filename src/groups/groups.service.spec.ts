import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, GroupKind, PermissionLevel, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from './groups.service';
import { AuditService } from '../audit/audit.service';

const mockPrisma = {
  group: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: { findMany: jest.fn() },
  dailyAttendance: { count: jest.fn() },
  calendarDay: { count: jest.fn() },
  timetable: { count: jest.fn() },
  lessonChange: { count: jest.fn() },
  schoolLesson: { count: jest.fn() },
  subgroup: { count: jest.fn() },
  bellSchedule: { findUnique: jest.fn() },
  mealPriceCategory: { findUnique: jest.fn() },
  timetableEntry: { findMany: jest.fn() },
  institution: { findUnique: jest.fn() },
  enrollment: { findFirst: jest.fn() },
  mealOrder: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const schoolInst = {
  id: 'inst-s',
  name: 'Школа',
  type: GroupKind.school_class,
  isActive: true,
};
const kgInst = {
  id: 'inst-k',
  name: 'Садок',
  type: GroupKind.kindergarten,
  isActive: true,
};

const mockAudit = { recordChange: jest.fn() };

const fullAdmin: AuthenticatedUser = {
  id: 'a0',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: { children: PermissionLevel.edit },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('GroupsService', () => {
  let service: GroupsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.institution.findUnique.mockResolvedValue(kgInst);
    mockPrisma.enrollment.findFirst.mockResolvedValue(null);
    mockPrisma.mealOrder.findFirst.mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [
        GroupsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = moduleRef.get(GroupsService);
  });

  it('copies the kind from the institution type', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(schoolInst);
    mockPrisma.group.findUnique.mockResolvedValue(null);
    mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
    await service.create({ name: '1-А', institutionId: 'inst-s' }, fullAdmin);
    expect(
      firstArg<{ data: { kind: GroupKind } }>(mockPrisma.group.create).data
        .kind,
    ).toBe(GroupKind.school_class);
  });

  it('refuses to delete a group with attendance records', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(1);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    mockPrisma.timetable.count.mockResolvedValue(0);
    mockPrisma.lessonChange.count.mockResolvedValue(0);
    mockPrisma.schoolLesson.count.mockResolvedValue(0);
    mockPrisma.subgroup.count.mockResolvedValue(0);
    await expect(service.delete('g1', fullAdmin)).rejects.toThrow(
      new BadRequestException('Cannot delete: group has attendance records'),
    );
    expect(mockPrisma.group.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a group with recorded school lessons', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(0);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    mockPrisma.timetable.count.mockResolvedValue(0);
    mockPrisma.lessonChange.count.mockResolvedValue(0);
    mockPrisma.schoolLesson.count.mockResolvedValue(1);
    mockPrisma.subgroup.count.mockResolvedValue(0);
    await expect(service.delete('g1', fullAdmin)).rejects.toThrow(
      new BadRequestException('Cannot delete: group has attendance records'),
    );
    expect(mockPrisma.group.delete).not.toHaveBeenCalled();
  });

  it('deletes a group without attendance records', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'g1' });
    mockPrisma.dailyAttendance.count.mockResolvedValue(0);
    mockPrisma.calendarDay.count.mockResolvedValue(0);
    mockPrisma.timetable.count.mockResolvedValue(0);
    mockPrisma.lessonChange.count.mockResolvedValue(0);
    mockPrisma.schoolLesson.count.mockResolvedValue(0);
    mockPrisma.subgroup.count.mockResolvedValue(0);
    await expect(service.delete('g1', fullAdmin)).resolves.toEqual({
      message: 'Group deleted',
    });
  });

  it('sets a bell schedule only on school classes and checks used periods', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      name: '1-А',
      kind: GroupKind.kindergarten,
    });
    mockPrisma.bellSchedule.findUnique.mockResolvedValue({
      id: 'b1',
      periods: [{ number: 1 }],
    });
    await expect(
      service.update('g1', { bellScheduleId: 'b1' }, fullAdmin),
    ).rejects.toThrow(new BadRequestException('Not a school class'));
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      name: '1-А',
      kind: GroupKind.school_class,
    });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 5 }]);
    await expect(
      service.update('g1', { bellScheduleId: 'b1' }, fullAdmin),
    ).rejects.toThrow(new BadRequestException('Bell period is in use'));
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(
      service.update('g1', { bellScheduleId: 'b9' }, fullAdmin),
    ).rejects.toThrow(new NotFoundException('Bell schedule not found'));
  });

  describe('meal price category', () => {
    it('stores the meal price category on update', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Сонечко',
        kind: GroupKind.kindergarten,
        mealPriceCategoryId: null,
      });
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue({
        id: 'pc1',
        active: true,
      });
      mockPrisma.group.update.mockResolvedValue({ id: 'g1' });
      await service.update('g1', { mealPriceCategoryId: 'pc1' }, fullAdmin);
      expect(
        firstArg<{ data: { mealPriceCategoryId: string } }>(
          mockPrisma.group.update,
        ).data.mealPriceCategoryId,
      ).toBe('pc1');
    });

    it('clears the meal price category with null', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Сонечко',
        kind: GroupKind.kindergarten,
        mealPriceCategoryId: 'pc1',
      });
      mockPrisma.group.update.mockResolvedValue({ id: 'g1' });
      await service.update('g1', { mealPriceCategoryId: null }, fullAdmin);
      expect(mockPrisma.mealPriceCategory.findUnique).not.toHaveBeenCalled();
      expect(
        firstArg<{ data: { mealPriceCategoryId: null } }>(
          mockPrisma.group.update,
        ).data.mealPriceCategoryId,
      ).toBeNull();
    });

    it('rejects an unknown meal price category', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Сонечко',
        kind: GroupKind.kindergarten,
        mealPriceCategoryId: null,
      });
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue(null);
      await expect(
        service.update('g1', { mealPriceCategoryId: 'pc9' }, fullAdmin),
      ).rejects.toThrow(new NotFoundException('Meal price category not found'));
    });

    it('rejects an inactive meal price category that is not current', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Сонечко',
        kind: GroupKind.kindergarten,
        mealPriceCategoryId: null,
      });
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue({
        id: 'pc2',
        active: false,
      });
      await expect(
        service.update('g1', { mealPriceCategoryId: 'pc2' }, fullAdmin),
      ).rejects.toThrow(
        new BadRequestException('Meal price category is inactive'),
      );
    });

    it('keeps the current inactive category on update', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'Сонечко',
        kind: GroupKind.kindergarten,
        mealPriceCategoryId: 'pc2',
      });
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue({
        id: 'pc2',
        active: false,
      });
      mockPrisma.group.update.mockResolvedValue({ id: 'g1' });
      await expect(
        service.update('g1', { mealPriceCategoryId: 'pc2' }, fullAdmin),
      ).resolves.toEqual({ id: 'g1' });
    });

    it('validates the category on create', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          {
            name: 'Нова',
            institutionId: 'inst-k',
            mealPriceCategoryId: 'pc9',
          },
          fullAdmin,
        ),
      ).rejects.toThrow(new NotFoundException('Meal price category not found'));
    });
  });

  describe('institutions', () => {
    it('rejects an unknown institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ name: 'A', institutionId: 'x' }, fullAdmin),
      ).rejects.toThrow(new NotFoundException('Institution not found'));
    });

    it('rejects an inactive institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        ...kgInst,
        isActive: false,
      });
      await expect(
        service.create({ name: 'A', institutionId: 'inst-k' }, fullAdmin),
      ).rejects.toThrow(new BadRequestException('Institution is inactive'));
      expect(mockPrisma.group.create).not.toHaveBeenCalled();
    });

    it('locks the institution row before reading it', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
      await service.create({ name: 'A', institutionId: 'inst-k' }, fullAdmin);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.institution.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('looks the name up inside the institution', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
      await service.create({ name: 'A', institutionId: 'inst-k' }, fullAdmin);
      expect(mockPrisma.group.findUnique).toHaveBeenCalledWith({
        where: { institutionId_name: { institutionId: 'inst-k', name: 'A' } },
      });
    });

    it('rejects a duplicate name in the same institution', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'g0' });
      await expect(
        service.create({ name: 'A', institutionId: 'inst-k' }, fullAdmin),
      ).rejects.toThrow(new ConflictException('Group name already taken'));
    });

    it('refuses moving to an institution of another type', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'A',
        kind: GroupKind.kindergarten,
        institutionId: 'inst-k',
      });
      mockPrisma.institution.findUnique.mockResolvedValue(schoolInst);
      await expect(
        service.update('g1', { institutionId: 'inst-s' }, fullAdmin),
      ).rejects.toThrow(
        new BadRequestException('Institution type cannot change'),
      );
      expect(mockPrisma.group.update).not.toHaveBeenCalled();
    });

    it('refuses moving a group whose child has a future meal order', async () => {
      mockPrisma.group.findUnique
        .mockResolvedValueOnce({
          id: 'g1',
          name: 'A',
          kind: GroupKind.kindergarten,
          institutionId: 'inst-k',
        })
        .mockResolvedValueOnce(null);
      mockPrisma.institution.findUnique.mockResolvedValue({
        ...kgInst,
        id: 'inst-k2',
      });
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'c1' }]);
      mockPrisma.mealOrder.findFirst.mockResolvedValue({ id: 'm1' });
      await expect(
        service.update('g1', { institutionId: 'inst-k2' }, fullAdmin),
      ).rejects.toThrow(new BadRequestException('Child has meal orders'));
      expect(mockPrisma.group.update).not.toHaveBeenCalled();
    });

    it('moves a group and audits in the transaction', async () => {
      mockPrisma.group.findUnique
        .mockResolvedValueOnce({
          id: 'g1',
          name: 'A',
          kind: GroupKind.kindergarten,
          institutionId: 'inst-k',
          bellScheduleId: null,
          mealPriceCategoryId: null,
        })
        .mockResolvedValueOnce(null);
      mockPrisma.institution.findUnique.mockResolvedValue({
        ...kgInst,
        id: 'inst-k2',
      });
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'c1' }]);
      mockPrisma.group.update.mockResolvedValue({
        id: 'g1',
        name: 'A',
        kind: GroupKind.kindergarten,
        institutionId: 'inst-k2',
        bellScheduleId: null,
        mealPriceCategoryId: null,
      });
      await service.update('g1', { institutionId: 'inst-k2' }, fullAdmin);
      expect(mockPrisma.enrollment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            childId: { in: ['c1'] },
            tariff: { institutionId: 'inst-k' },
          }) as unknown,
        }),
      );
      expect(
        firstArg<{ data: { institutionId: string } }>(mockPrisma.group.update)
          .data.institutionId,
      ).toBe('inst-k2');
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          after: expect.objectContaining({
            institutionId: 'inst-k2',
          }) as unknown,
        }),
      );
    });
  });

  describe('scope', () => {
    const kgAdmin: AuthenticatedUser = {
      id: 'a1',
      role: Role.admin,
      login: 'kg',
      mustChangePassword: false,
      accessScope: AccessScope.institutions,
      institutionIds: ['inst-k'],
      scopeInstitutionIds: ['inst-k'],
      permissions: { children: PermissionLevel.edit },
    };

    it('lists only groups of the scope', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.findAll(kgAdmin);
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { institutionId: { in: ['inst-k'] } },
        }),
      );
    });

    it('refuses to create a group outside the scope', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue(schoolInst);
      await expect(
        service.create({ name: '1-А', institutionId: 'inst-s' }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
      expect(mockPrisma.group.create).not.toHaveBeenCalled();
    });

    it('filters the list by institution inside the scope', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.findAll(kgAdmin, 'inst-k');
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { institutionId: 'inst-k' } }),
      );
      await expect(service.findAll(kgAdmin, 'inst-s')).resolves.toEqual([]);
    });

    it('hides a group of another institution on update and delete', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        kind: GroupKind.school_class,
        institutionId: 'inst-s',
      });
      await expect(service.update('g1', {}, kgAdmin)).rejects.toThrow(
        'Group not found',
      );
      await expect(service.delete('g1', kgAdmin)).rejects.toThrow(
        'Group not found',
      );
    });

    it('refuses moving a group into an institution outside the scope', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        name: 'A',
        kind: GroupKind.kindergarten,
        institutionId: 'inst-k',
      });
      mockPrisma.institution.findUnique.mockResolvedValue({
        ...kgInst,
        id: 'inst-k2',
      });
      await expect(
        service.update('g1', { institutionId: 'inst-k2' }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
    });
  });
  describe('audit', () => {
    const row = {
      id: 'g1',
      name: '1-А',
      kind: GroupKind.school_class,
      bellScheduleId: null,
      mealPriceCategoryId: null,
      teachers: [{ id: 't1' }],
    };

    it('records a created group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      mockPrisma.group.create.mockResolvedValue(row);

      mockPrisma.institution.findUnique.mockResolvedValue(schoolInst);
      await service.create({ name: '1-А', institutionId: 'inst-s' }, fullAdmin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'a0',
          entityType: 'groups',
          entityId: 'g1',
          action: 'create',
          before: null,
          after: expect.objectContaining({
            name: '1-А',
            teacherIds: ['t1'],
          }) as unknown,
        }),
      );
    });

    it('records an update with before and after', async () => {
      mockPrisma.group.findUnique
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(null);
      mockPrisma.group.update.mockResolvedValue({
        ...row,
        name: '1-Б',
        teachers: [],
      });

      await service.update('g1', { name: '1-Б' }, fullAdmin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityId: 'g1',
          action: 'update',
          before: expect.objectContaining({
            name: '1-А',
            teacherIds: ['t1'],
          }) as unknown,
          after: expect.objectContaining({
            name: '1-Б',
            teacherIds: [],
          }) as unknown,
        }),
      );
    });

    it('records a deletion', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(row);
      for (const model of [
        'dailyAttendance',
        'calendarDay',
        'timetable',
        'lessonChange',
        'schoolLesson',
        'subgroup',
      ] as const) {
        mockPrisma[model].count.mockResolvedValue(0);
      }
      mockPrisma.group.delete.mockResolvedValue(row);

      await service.delete('g1', fullAdmin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityId: 'g1',
          action: 'delete',
          before: expect.objectContaining({ name: '1-А' }) as unknown,
          after: null,
        }),
      );
    });
  });
});
