import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from './groups.service';

const mockPrisma = {
  group: {
    findUnique: jest.fn(),
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
      ],
    }).compile();
    service = moduleRef.get(GroupsService);
  });

  it('stores the group kind', async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null);
    mockPrisma.group.create.mockResolvedValue({ id: 'g1' });
    await service.create({ name: '1-А', kind: GroupKind.school_class });
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
    await expect(service.delete('g1')).rejects.toThrow(
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
    await expect(service.delete('g1')).rejects.toThrow(
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
    await expect(service.delete('g1')).resolves.toEqual({
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
      service.update('g1', { bellScheduleId: 'b1' }),
    ).rejects.toThrow(new BadRequestException('Not a school class'));
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      name: '1-А',
      kind: GroupKind.school_class,
    });
    mockPrisma.timetableEntry.findMany.mockResolvedValue([{ period: 5 }]);
    await expect(
      service.update('g1', { bellScheduleId: 'b1' }),
    ).rejects.toThrow(new BadRequestException('Bell period is in use'));
    mockPrisma.bellSchedule.findUnique.mockResolvedValue(null);
    await expect(
      service.update('g1', { bellScheduleId: 'b9' }),
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
      await service.update('g1', { mealPriceCategoryId: 'pc1' });
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
      await service.update('g1', { mealPriceCategoryId: null });
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
        service.update('g1', { mealPriceCategoryId: 'pc9' }),
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
        service.update('g1', { mealPriceCategoryId: 'pc2' }),
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
        service.update('g1', { mealPriceCategoryId: 'pc2' }),
      ).resolves.toEqual({ id: 'g1' });
    });

    it('validates the category on create', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      mockPrisma.mealPriceCategory.findUnique.mockResolvedValue(null);
      await expect(
        service.create({ name: 'Нова', mealPriceCategoryId: 'pc9' }),
      ).rejects.toThrow(new NotFoundException('Meal price category not found'));
    });
  });
});
