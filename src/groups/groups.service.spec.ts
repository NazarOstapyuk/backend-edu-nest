import { BadRequestException, NotFoundException } from '@nestjs/common';
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
};

const mockAudit = { recordChange: jest.fn() };

const fullAdmin: AuthenticatedUser = {
  id: 'a0',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: { children: PermissionLevel.edit },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('GroupsService', () => {
  let service: GroupsService;

  beforeEach(async () => {
    jest.resetAllMocks();
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

  it('stores the group kind', async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null);
    mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
    await service.create(
      { name: '1-А', kind: GroupKind.school_class },
      fullAdmin,
    );
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
        service.create({ name: 'Нова', mealPriceCategoryId: 'pc9' }, fullAdmin),
      ).rejects.toThrow(new NotFoundException('Meal price category not found'));
    });
  });

  describe('scope', () => {
    const kgAdmin: AuthenticatedUser = {
      id: 'a1',
      role: Role.admin,
      login: 'kg',
      mustChangePassword: false,
      accessScope: AccessScope.kindergarten,
      permissions: { children: PermissionLevel.edit },
    };

    it('lists only groups of the scope', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.findAll(kgAdmin);
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { kind: GroupKind.kindergarten } }),
      );
    });

    it('refuses to create a group of another kind', async () => {
      await expect(
        service.create({ name: '1-А', kind: GroupKind.school_class }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
    });

    it('hides a group of another kind on update and delete', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        kind: GroupKind.school_class,
      });
      await expect(service.update('g1', {}, kgAdmin)).rejects.toThrow(
        'Group not found',
      );
      await expect(service.delete('g1', kgAdmin)).rejects.toThrow(
        'Group not found',
      );
    });

    it('refuses changing the kind out of the scope', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        kind: GroupKind.kindergarten,
      });
      await expect(
        service.update('g1', { kind: GroupKind.school_class }, kgAdmin),
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

      await service.create(
        { name: '1-А', kind: GroupKind.school_class },
        fullAdmin,
      );

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
