// src/users/users.service.spec.ts
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  charge: { count: jest.fn() },
  payment: { count: jest.fn() },
  allocation: { count: jest.fn() },
  tariffPrice: { count: jest.fn() },
  enrollment: { count: jest.fn() },
  enrollmentAdjustment: { count: jest.fn() },
  adaptationVisit: { count: jest.fn() },
  classGroupMember: { count: jest.fn() },
  package: { count: jest.fn() },
  packageExtension: { count: jest.fn() },
  lesson: { count: jest.fn() },
  lessonAttendance: { count: jest.fn() },
  sessionUsage: { count: jest.fn() },
  classGroup: { count: jest.fn() },
  dailyAttendance: { count: jest.fn() },
  calendarDay: { count: jest.fn() },
  absenceNotice: { count: jest.fn() },
  timetable: { count: jest.fn() },
  timetableEntry: { count: jest.fn() },
  lessonChange: { count: jest.fn() },
  schoolLesson: { count: jest.fn() },
  lessonMark: { count: jest.fn() },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('create', () => {
    it('throws ForbiddenException when admin tries to create root', async () => {
      await expect(
        service.create(
          { login: 'x', password: 'pass123', role: Role.root },
          Role.admin,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when login already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create(
          { login: 'taken', password: 'pass123', role: Role.teacher },
          Role.admin,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user and returns without password and refreshToken', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        login: 'newuser',
        role: Role.teacher,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: 'hashed',
        refreshToken: null,
      });
      const result = await service.create(
        { login: 'newuser', password: 'pass123', role: Role.teacher },
        Role.admin,
      );
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('refreshToken');
      expect(result).toHaveProperty('id', 'new-id');
    });

    it('requires a phone for parents', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            login: 'mom',
            password: 'pass123',
            role: Role.parent,
            firstName: 'Olena',
            lastName: 'Koval',
          },
          Role.admin,
        ),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('creates a parent who must change the password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'p1',
        password: 'h',
        refreshToken: null,
      });

      await service.create(
        {
          login: 'mom',
          password: 'pass123',
          role: Role.parent,
          firstName: 'Olena',
          lastName: 'Koval',
          middleName: 'Ivanivna',
          phone: '+380671234567',
          email: 'mom@example.com',
        },
        Role.admin,
      );

      const data = (
        mockPrisma.user.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).toMatchObject({
        role: Role.parent,
        middleName: 'Ivanivna',
        phone: '+380671234567',
        email: 'mom@example.com',
        mustChangePassword: true,
      });
    });

    it('allows root to create any role including root', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'id2',
        login: 'root2',
        role: Role.root,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        password: 'hashed',
        refreshToken: null,
      });
      await expect(
        service.create(
          { login: 'root2', password: 'pass123', role: Role.root },
          Role.root,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('update', () => {
    const parent = {
      id: 'p1',
      login: 'mom',
      role: Role.parent,
      phone: '+380671234567',
    };

    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue({
        id: 'p1',
        password: 'h',
        refreshToken: null,
      });
    });

    it('forces a password change and drops sessions on admin reset', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);

      await service.update('p1', { password: 'newpass1' }, Role.admin);

      const data = (
        mockPrisma.user.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).toMatchObject({
        mustChangePassword: true,
        refreshToken: null,
      });
      expect(typeof data.password).toBe('string');
    });

    it('refuses to clear the phone of a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);

      await expect(
        service.update('p1', { phone: null }, Role.admin),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('keeps a legacy parent without phone editable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...parent, phone: null });

      await service.update('p1', { firstName: 'Olena' }, Role.admin);

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('requires a phone when turning a user into a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...parent,
        role: Role.teacher,
        phone: null,
      });

      await expect(
        service.update('p1', { role: Role.parent }, Role.admin),
      ).rejects.toThrow('Phone is required for parents');
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: Role.admin,
      });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.allocation.count.mockResolvedValue(0);
      mockPrisma.tariffPrice.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollmentAdjustment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.packageExtension.count.mockResolvedValue(0);
      mockPrisma.lesson.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.sessionUsage.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);
      mockPrisma.dailyAttendance.count.mockResolvedValue(0);
      mockPrisma.calendarDay.count.mockResolvedValue(0);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);
      mockPrisma.timetable.count.mockResolvedValue(0);
      mockPrisma.timetableEntry.count.mockResolvedValue(0);
      mockPrisma.lessonChange.count.mockResolvedValue(0);
      mockPrisma.schoolLesson.count.mockResolvedValue(0);
      mockPrisma.lessonMark.count.mockResolvedValue(0);
    });

    it('deletes a user without financial records', async () => {
      mockPrisma.user.delete.mockResolvedValue({});

      const result = await service.delete('u1');

      expect(result).toEqual({ message: 'User deleted' });
      expect(mockPrisma.charge.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { voidedById: 'u1' }] },
      });
    });

    it('throws BadRequestException when user has financial records', async () => {
      mockPrisma.allocation.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user marked lessons', async () => {
      mockPrisma.lessonAttendance.count.mockResolvedValue(2);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user decided absence notices', async () => {
      mockPrisma.absenceNotice.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.absenceNotice.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { decidedById: 'u1' }] },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user teaches timetable entries', async () => {
      mockPrisma.timetableEntry.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.timetableEntry.count).toHaveBeenCalledWith({
        where: { teacherId: 'u1' },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user teaches class groups', async () => {
      mockPrisma.classGroup.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.classGroup.count).toHaveBeenCalledWith({
        where: { teachers: { some: { id: 'u1' } } },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user created tariff records', async () => {
      mockPrisma.enrollmentAdjustment.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
  });
});
