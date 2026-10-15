// src/users/users.service.spec.ts
import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AccessScope,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
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
  userPermission: { deleteMany: jest.fn(), createMany: jest.fn() },
  $transaction: jest.fn(),
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
  mealOrder: { count: jest.fn() },
  backupRun: { count: jest.fn() },
  salaryTerms: { count: jest.fn() },
  payrollSheet: { count: jest.fn() },
  payrollAdjustment: { count: jest.fn() },
  payrollPayment: { count: jest.fn() },
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

    it('clears access when a teacher becomes a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...parent,
        role: Role.teacher,
        phone: '+380671234567',
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(0);

      await service.update('p1', { role: Role.parent }, Role.admin);

      const data = (
        mockPrisma.user.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).toMatchObject({
        permissions: { deleteMany: {} },
        accessScope: AccessScope.all,
      });
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
      mockPrisma.mealOrder.count.mockResolvedValue(0);
      mockPrisma.backupRun.count.mockResolvedValue(0);
      mockPrisma.salaryTerms.count.mockResolvedValue(0);
      mockPrisma.payrollSheet.count.mockResolvedValue(0);
      mockPrisma.payrollAdjustment.count.mockResolvedValue(0);
      mockPrisma.payrollPayment.count.mockResolvedValue(0);
    });

    it('throws BadRequestException when user has salary terms', async () => {
      mockPrisma.salaryTerms.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.salaryTerms.count).toHaveBeenCalledWith({
        where: { OR: [{ teacherId: 'u1' }, { createdById: 'u1' }] },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has payroll payments', async () => {
      mockPrisma.payrollPayment.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.payrollSheet.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { teacherId: 'u1' },
            { approvedById: 'u1' },
            { reopenedById: 'u1' },
          ],
        },
      });
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

    it('refuses to delete a user who created meal orders', async () => {
      mockPrisma.mealOrder.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        new BadRequestException(
          'Cannot delete: user has financial records, deactivate instead',
        ),
      );
      expect(mockPrisma.mealOrder.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { cancelledById: 'u1' }] },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user created backup runs', async () => {
      mockPrisma.backupRun.count.mockResolvedValue(1);

      await expect(service.delete('u1')).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.backupRun.count).toHaveBeenCalledWith({
        where: { createdById: 'u1' },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('update role of a teacher with salary terms', () => {
    it('rejects changing the role away from teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 't1',
        login: 'teacher',
        role: Role.teacher,
        phone: null,
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(2);

      await expect(
        service.update('t1', { role: Role.admin }, Role.root),
      ).rejects.toThrow('User has salary terms');
      expect(mockPrisma.salaryTerms.count).toHaveBeenCalledWith({
        where: { teacherId: 't1' },
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows other changes of a teacher with salary terms', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 't1',
        login: 'teacher',
        role: Role.teacher,
        phone: null,
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(2);
      mockPrisma.user.update.mockResolvedValue({
        id: 't1',
        login: 'teacher',
        role: Role.teacher,
        password: 'x',
        refreshToken: null,
      });

      await service.update('t1', { firstName: 'Олена' }, Role.root);

      expect(mockPrisma.salaryTerms.count).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });
  });

  describe('setAccess', () => {
    const actor = {
      id: 'g1',
      role: Role.admin,
      login: 'deputy',
      mustChangePassword: false,
      accessScope: AccessScope.all,
      permissions: {
        users: PermissionLevel.edit,
        finance: PermissionLevel.edit,
      },
    };
    const targetRow = (over: Record<string, unknown> = {}) => ({
      id: 't1',
      role: Role.admin,
      accessScope: AccessScope.all,
      permissions: [],
      ...over,
    });

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation((ops: unknown[]) =>
        Promise.all(ops),
      );
      mockPrisma.userPermission.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userPermission.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('replaces permissions and scope', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(targetRow())
        .mockResolvedValueOnce({
          ...targetRow({
            permissions: [
              { area: PermissionArea.finance, level: PermissionLevel.view },
            ],
          }),
          login: 'acc',
        });

      const view = await service.setAccess(
        't1',
        {
          accessScope: AccessScope.all,
          permissions: [
            { area: PermissionArea.finance, level: PermissionLevel.view },
          ],
        },
        actor,
      );

      expect(mockPrisma.userPermission.deleteMany).toHaveBeenCalledWith({
        where: { userId: 't1' },
      });
      expect(mockPrisma.userPermission.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 't1',
            area: PermissionArea.finance,
            level: PermissionLevel.view,
          },
        ],
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { accessScope: AccessScope.all },
      });
      expect(view.permissions).toEqual([
        { area: PermissionArea.finance, level: PermissionLevel.view },
      ]);
    });

    it('maps denials to errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        targetRow({ role: Role.root }),
      );
      await expect(
        service.setAccess(
          't1',
          { accessScope: AccessScope.all, permissions: [] },
          actor,
        ),
      ).rejects.toThrow('Root access cannot be changed');

      mockPrisma.user.findUnique.mockResolvedValue(
        targetRow({ role: Role.parent }),
      );
      await expect(
        service.setAccess(
          't1',
          { accessScope: AccessScope.all, permissions: [] },
          actor,
        ),
      ).rejects.toThrow('Access applies to staff only');

      mockPrisma.user.findUnique.mockResolvedValue(targetRow({ id: 'g1' }));
      await expect(
        service.setAccess(
          'g1',
          { accessScope: AccessScope.all, permissions: [] },
          actor,
        ),
      ).rejects.toThrow('Cannot change own access');

      mockPrisma.user.findUnique.mockResolvedValue(targetRow());
      await expect(
        service.setAccess(
          't1',
          {
            accessScope: AccessScope.all,
            permissions: [
              { area: PermissionArea.payroll, level: PermissionLevel.view },
            ],
          },
          actor,
        ),
      ).rejects.toThrow('Cannot grant more than you have');
      expect(mockPrisma.userPermission.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects duplicates and a missing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(targetRow());
      await expect(
        service.setAccess(
          't1',
          {
            accessScope: AccessScope.all,
            permissions: [
              { area: PermissionArea.finance, level: PermissionLevel.view },
              { area: PermissionArea.finance, level: PermissionLevel.edit },
            ],
          },
          actor,
        ),
      ).rejects.toThrow('Duplicate permission');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setAccess(
          't1',
          { accessScope: AccessScope.all, permissions: [] },
          actor,
        ),
      ).rejects.toThrow('User not found');
    });
  });
});
