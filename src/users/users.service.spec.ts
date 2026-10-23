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
import { AuditService } from '../audit/audit.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  userPermission: { deleteMany: jest.fn(), createMany: jest.fn() },
  userInstitution: { deleteMany: jest.fn(), createMany: jest.fn() },
  institution: { findUnique: jest.fn() },
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
  payrollExtraHours: { count: jest.fn() },
  teacherAbsence: { count: jest.fn() },
};

const mockAudit = { recordChange: jest.fn() };

const actorOf = (
  role: Role,
  permissions: Partial<Record<PermissionArea, PermissionLevel>> = {},
  id = 'actor',
) => ({
  id,
  role,
  login: 'actor',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions,
});
const rootActor = actorOf(Role.root);
const adminActor = actorOf(Role.admin, {
  users: PermissionLevel.edit,
  finance: PermissionLevel.edit,
});
const teacherActor = actorOf(Role.teacher, { users: PermissionLevel.edit });

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('create', () => {
    it('throws ForbiddenException when admin tries to create root', async () => {
      await expect(
        service.create(
          { login: 'x', password: 'pass123', role: Role.root },
          adminActor,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when login already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create(
          { login: 'taken', password: 'pass123', role: Role.teacher },
          adminActor,
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
        adminActor,
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
          adminActor,
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
        adminActor,
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
          rootActor,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('update', () => {
    const parent = {
      id: 'p1',
      login: 'mom',
      role: Role.parent,
      accessScope: AccessScope.all,
      permissions: [],
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

      await service.update('p1', { password: 'newpass1' }, adminActor);

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
        service.update('p1', { phone: null }, adminActor),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('keeps a legacy parent without phone editable', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...parent, phone: null });

      await service.update('p1', { firstName: 'Olena' }, adminActor);

      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('requires a phone when turning a user into a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...parent,
        role: Role.teacher,
        phone: null,
      });

      await expect(
        service.update('p1', { role: Role.parent }, adminActor),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('clears access when a teacher becomes a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...parent,
        role: Role.teacher,
        phone: '+380671234567',
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(0);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
      mockPrisma.teacherAbsence.count.mockResolvedValue(0);

      await service.update('p1', { role: Role.parent }, adminActor);

      const data = (
        mockPrisma.user.update.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).toMatchObject({
        permissions: { deleteMany: {} },
        institutions: { deleteMany: {} },
        accessScope: AccessScope.all,
      });
    });
  });

  describe('privilege escalation', () => {
    const target = (over: Record<string, unknown> = {}) => ({
      id: 'x1',
      login: 'x',
      role: Role.admin,
      phone: null,
      accessScope: AccessScope.all,
      permissions: [
        { area: PermissionArea.payroll, level: PermissionLevel.edit },
      ],
      ...over,
    });

    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue({ id: 'x1' });
    });

    it('refuses a non-root actor creating root', async () => {
      await expect(
        service.create(
          { login: 'r', password: 'pass123', role: Role.root },
          teacherActor,
        ),
      ).rejects.toThrow('Forbidden');
    });

    it('refuses an admin making themselves root', async () => {
      await expect(
        service.update('actor', { role: Role.root }, adminActor),
      ).rejects.toThrow('Forbidden');
    });

    it('refuses to change own role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ id: 'actor', role: Role.admin, permissions: [] }),
      );
      await expect(
        service.update('actor', { role: Role.parent }, adminActor),
      ).rejects.toThrow('Cannot change own access');
      await expect(
        service.update('actor', { role: Role.teacher }, rootActor),
      ).rejects.toThrow('Cannot change own access');
    });

    it('refuses a non-root actor touching root', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ role: Role.root, permissions: [] }),
      );
      await expect(
        service.update('x1', { password: 'newpass1' }, adminActor),
      ).rejects.toThrow('Cannot manage this user');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to update a staff user the actor does not cover', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(target());
      await expect(
        service.update('x1', { isActive: false }, adminActor),
      ).rejects.toThrow('Cannot manage this user');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows updating a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ role: Role.parent, permissions: [], phone: '+380' }),
      );
      await service.update('x1', { firstName: 'A' }, adminActor);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('allows a non-root actor to update their own fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ id: 'actor', permissions: [] }),
      );
      await service.update('actor', { firstName: 'A' }, adminActor);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('refuses to deactivate oneself', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ id: 'actor', permissions: [] }),
      );
      await expect(
        service.update('actor', { isActive: false }, adminActor),
      ).rejects.toThrow('Cannot change own access');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to delete oneself', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ id: 'actor', permissions: [] }),
      );
      await expect(service.delete('actor', adminActor)).rejects.toThrow(
        'Cannot change own access',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('gives staff created by a scoped actor the actor scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'n' });
      const scoped = {
        ...adminActor,
        accessScope: AccessScope.institutions,
        institutionIds: ['inst-a', 'inst-b'],
      };
      await service.create(
        { login: 'n', password: 'pass123', role: Role.teacher },
        scoped,
      );
      const scopedCall = mockPrisma.user.create.mock.calls[0] as [
        {
          data: {
            accessScope?: AccessScope;
            institutions?: { create: { institutionId: string }[] };
          };
        },
      ];
      expect(scopedCall[0].data.accessScope).toBe(AccessScope.institutions);
      expect(scopedCall[0].data.institutions).toEqual({
        create: [{ institutionId: 'inst-a' }, { institutionId: 'inst-b' }],
      });
      mockPrisma.user.create.mockClear();
      await service.create(
        { login: 'n', password: 'pass123', role: Role.teacher },
        adminActor,
      );
      const data = (
        mockPrisma.user.create.mock.calls[0] as [{ data: object }]
      )[0].data;
      expect(data).not.toHaveProperty('accessScope');
    });

    it('gives a promoted parent the actor scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ role: Role.parent, permissions: [], phone: '+380' }),
      );
      const scoped = {
        ...adminActor,
        accessScope: AccessScope.institutions,
        institutionIds: ['inst-a'],
      };
      await service.update('x1', { role: Role.teacher }, scoped);
      const call = mockPrisma.user.update.mock.calls[0] as [
        {
          data: {
            accessScope?: AccessScope;
            institutions?: unknown;
          };
        },
      ];
      expect(call[0].data.accessScope).toBe(AccessScope.institutions);
      expect(call[0].data.institutions).toEqual({
        deleteMany: {},
        create: [{ institutionId: 'inst-a' }],
      });
    });

    it('refuses to delete a staff user the actor does not cover', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(target());
      await expect(service.delete('x1', adminActor)).rejects.toThrow(
        'Cannot manage this user',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: Role.admin,
        accessScope: AccessScope.all,
        permissions: [],
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
      mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
      mockPrisma.teacherAbsence.count.mockResolvedValue(0);
    });

    it('throws BadRequestException when user has extra hours records', async () => {
      mockPrisma.payrollExtraHours.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.payrollExtraHours.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { teacherId: 'u1' },
            { createdById: 'u1' },
            { voidedById: 'u1' },
          ],
        },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has teacher absences', async () => {
      mockPrisma.teacherAbsence.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.teacherAbsence.count).toHaveBeenCalledWith({
        where: {
          OR: [
            { teacherId: 'u1' },
            { createdById: 'u1' },
            { voidedById: 'u1' },
          ],
        },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has salary terms', async () => {
      mockPrisma.salaryTerms.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.salaryTerms.count).toHaveBeenCalledWith({
        where: { OR: [{ teacherId: 'u1' }, { createdById: 'u1' }] },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user has payroll payments', async () => {
      mockPrisma.payrollPayment.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
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

      const result = await service.delete('u1', rootActor);

      expect(result).toEqual({ message: 'User deleted' });
      expect(mockPrisma.charge.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { voidedById: 'u1' }] },
      });
    });

    it('throws BadRequestException when user has financial records', async () => {
      mockPrisma.allocation.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user marked lessons', async () => {
      mockPrisma.lessonAttendance.count.mockResolvedValue(2);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user decided absence notices', async () => {
      mockPrisma.absenceNotice.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.absenceNotice.count).toHaveBeenCalledWith({
        where: { OR: [{ createdById: 'u1' }, { decidedById: 'u1' }] },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user teaches timetable entries', async () => {
      mockPrisma.timetableEntry.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.timetableEntry.count).toHaveBeenCalledWith({
        where: { teacherId: 'u1' },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user teaches class groups', async () => {
      mockPrisma.classGroup.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.classGroup.count).toHaveBeenCalledWith({
        where: { teachers: { some: { id: 'u1' } } },
      });
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when user created tariff records', async () => {
      mockPrisma.enrollmentAdjustment.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
        'Cannot delete: user has financial records, deactivate instead',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a user who created meal orders', async () => {
      mockPrisma.mealOrder.count.mockResolvedValue(1);

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
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

      await expect(service.delete('u1', rootActor)).rejects.toThrow(
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
        accessScope: AccessScope.all,
        permissions: [],
        phone: null,
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(2);

      await expect(
        service.update('t1', { role: Role.admin }, rootActor),
      ).rejects.toThrow('User has salary terms');
      expect(mockPrisma.salaryTerms.count).toHaveBeenCalledWith({
        where: { teacherId: 't1' },
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects changing the role away from teacher with absences or extra hours', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 't1',
        login: 'teacher',
        role: Role.teacher,
        accessScope: AccessScope.all,
        permissions: [],
        phone: null,
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(0);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
      mockPrisma.teacherAbsence.count.mockResolvedValue(1);

      await expect(
        service.update('t1', { role: Role.admin }, rootActor),
      ).rejects.toThrow('User has salary terms');

      mockPrisma.teacherAbsence.count.mockResolvedValue(0);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(1);
      await expect(
        service.update('t1', { role: Role.admin }, rootActor),
      ).rejects.toThrow('User has salary terms');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows other changes of a teacher with salary terms', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 't1',
        login: 'teacher',
        role: Role.teacher,
        accessScope: AccessScope.all,
        permissions: [],
        phone: null,
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(2);
      mockPrisma.user.update.mockResolvedValue({
        id: 't1',
        login: 'teacher',
        role: Role.teacher,
        accessScope: AccessScope.all,
        permissions: [],
        password: 'x',
        refreshToken: null,
      });

      await service.update('t1', { firstName: 'Олена' }, rootActor);

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
      institutionIds: [] as string[],
      scopeInstitutionIds: null as string[] | null,
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
      mockPrisma.$transaction.mockImplementation(
        (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
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

    it('refuses changing access of a user the actor does not cover', async () => {
      const narrowTarget = targetRow({
        accessScope: AccessScope.institutions,
        institutions: [{ institutionId: 'inst-a' }],
        permissions: [
          { area: PermissionArea.finance, level: PermissionLevel.edit },
          { area: PermissionArea.payroll, level: PermissionLevel.edit },
        ],
      });
      const deputy = {
        ...actor,
        permissions: {
          users: PermissionLevel.edit,
          finance: PermissionLevel.view,
        },
      };
      mockPrisma.user.findUnique.mockResolvedValue(narrowTarget);
      await expect(
        service.setAccess(
          't1',
          {
            accessScope: AccessScope.all,
            permissions: [
              { area: PermissionArea.finance, level: PermissionLevel.edit },
              { area: PermissionArea.payroll, level: PermissionLevel.edit },
            ],
          },
          deputy,
        ),
      ).rejects.toThrow('Cannot grant more than you have');
      await expect(
        service.setAccess(
          't1',
          {
            accessScope: AccessScope.institutions,
            institutionIds: ['inst-a'],
            permissions: [],
          },
          deputy,
        ),
      ).rejects.toThrow('Cannot grant more than you have');
      expect(mockPrisma.userPermission.deleteMany).not.toHaveBeenCalled();
    });

    it('allows changing access of a covered user with a covered request', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(
          targetRow({
            permissions: [
              { area: PermissionArea.finance, level: PermissionLevel.view },
            ],
          }),
        )
        .mockResolvedValueOnce(targetRow());
      await service.setAccess(
        't1',
        {
          accessScope: AccessScope.all,
          permissions: [
            { area: PermissionArea.finance, level: PermissionLevel.edit },
          ],
        },
        actor,
      );
      expect(mockPrisma.userPermission.deleteMany).toHaveBeenCalled();
    });

    describe('institutions', () => {
      const scopedActor = (institutionIds: string[]) => ({
        ...actor,
        accessScope: AccessScope.institutions,
        institutionIds,
        scopeInstitutionIds: institutionIds,
      });
      const grant = (ids: string[]) => ({
        accessScope: AccessScope.institutions,
        institutionIds: ids,
        permissions: [],
      });
      const inst = (isActive: boolean) => ({
        id: 'a',
        type: 'kindergarten',
        isActive,
        name: 'A',
      });

      it('refuses a granter holding [A] granting [A,B]', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(targetRow());
        await expect(
          service.setAccess('t1', grant(['a', 'b']), scopedActor(['a'])),
        ).rejects.toThrow('Cannot grant more than you have');
        expect(mockPrisma.userInstitution.deleteMany).not.toHaveBeenCalled();
      });

      it('lets a granter holding [A,B] grant [A] and replaces rows', async () => {
        mockPrisma.user.findUnique
          .mockResolvedValueOnce(
            targetRow({
              accessScope: AccessScope.institutions,
              institutions: [{ institutionId: 'b' }],
            }),
          )
          .mockResolvedValueOnce(
            targetRow({
              accessScope: AccessScope.institutions,
              institutions: [{ institutionId: 'a' }],
            }),
          );
        mockPrisma.institution.findUnique.mockResolvedValue(inst(true));
        const view = await service.setAccess(
          't1',
          grant(['a']),
          scopedActor(['a', 'b']),
        );
        expect(mockPrisma.userInstitution.deleteMany).toHaveBeenCalledWith({
          where: { userId: 't1' },
        });
        expect(mockPrisma.userInstitution.createMany).toHaveBeenCalledWith({
          data: [{ userId: 't1', institutionId: 'a' }],
        });
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
          where: { id: 't1' },
          data: { accessScope: AccessScope.institutions },
        });
        expect(view?.institutionIds).toEqual(['a']);
      });

      it('clears institution rows when access becomes all', async () => {
        mockPrisma.user.findUnique
          .mockResolvedValueOnce(
            targetRow({
              accessScope: AccessScope.institutions,
              institutions: [{ institutionId: 'a' }],
            }),
          )
          .mockResolvedValueOnce(targetRow());
        await service.setAccess(
          't1',
          { accessScope: AccessScope.all, permissions: [] },
          actor,
        );
        expect(mockPrisma.userInstitution.deleteMany).toHaveBeenCalled();
        expect(mockPrisma.userInstitution.createMany).not.toHaveBeenCalled();
      });

      it('refuses to newly grant an inactive institution', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(targetRow());
        mockPrisma.institution.findUnique.mockResolvedValue(inst(false));
        await expect(
          service.setAccess('t1', grant(['a']), actor),
        ).rejects.toThrow('Institution is inactive');
        expect(mockPrisma.userInstitution.deleteMany).not.toHaveBeenCalled();
      });

      it('keeps an already granted inactive institution', async () => {
        mockPrisma.user.findUnique
          .mockResolvedValueOnce(
            targetRow({
              accessScope: AccessScope.institutions,
              institutions: [{ institutionId: 'a' }],
            }),
          )
          .mockResolvedValueOnce(targetRow());
        mockPrisma.institution.findUnique.mockResolvedValue(inst(false));
        await service.setAccess('t1', grant(['a']), actor);
        expect(mockPrisma.userInstitution.createMany).toHaveBeenCalled();
      });

      it('answers 404 for an unknown institution', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(targetRow());
        mockPrisma.institution.findUnique.mockResolvedValue(null);
        await expect(
          service.setAccess('t1', grant(['zzz']), actor),
        ).rejects.toThrow('Institution not found');
      });
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
  describe('audit', () => {
    const row = {
      id: 'u1',
      login: 'ann',
      role: Role.admin,
      firstName: 'Ann',
      lastName: 'Lee',
      middleName: null,
      phone: null,
      email: null,
      isActive: true,
      accessScope: AccessScope.all,
      permissions: [
        { area: PermissionArea.finance, level: PermissionLevel.view },
      ],
    };

    it('records a created user without a password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ ...row, password: 'hash' });

      await service.create(
        {
          login: 'ann',
          password: 'secret99',
          role: Role.admin,
          firstName: 'Ann',
          lastName: 'Lee',
        },
        adminActor,
      );

      const [, input] = mockAudit.recordChange.mock.calls[0] as [
        unknown,
        { before: unknown; after: { login: string; password: unknown } },
      ];
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'actor',
          entityType: 'users',
          entityId: 'u1',
          action: 'create',
        }),
      );
      expect(input.before).toBeNull();
      expect(input.after.login).toBe('ann');
      expect(input.after.password).toBeNull();
      expect(JSON.stringify(mockAudit.recordChange.mock.calls)).not.toContain(
        'secret99',
      );
    });

    it('records an update and marks a password reset without leaking it', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      mockPrisma.user.update.mockResolvedValue({
        ...row,
        firstName: 'Anna',
        password: 'newhash',
      });

      await service.update(
        'u1',
        { firstName: 'Anna', password: 'newsecret1' },
        adminActor,
      );

      const [, input] = mockAudit.recordChange.mock.calls[0] as [
        unknown,
        {
          action: string;
          before: {
            firstName: string;
            password: unknown;
            permissions: string[];
          };
          after: { firstName: string; password: unknown };
        },
      ];
      expect(input.action).toBe('update');
      expect(input.before.firstName).toBe('Ann');
      expect(input.before.password).toBeNull();
      expect(input.before.permissions).toEqual(['finance:view']);
      expect(input.after.firstName).toBe('Anna');
      expect(input.after.password).toBe('змінено');
      const dump = JSON.stringify(mockAudit.recordChange.mock.calls);
      expect(dump).not.toContain('newsecret1');
      expect(dump).not.toContain('newhash');
    });

    it('records a deletion without the password field', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      for (const model of [
        'charge',
        'payment',
        'allocation',
        'tariffPrice',
        'enrollment',
        'enrollmentAdjustment',
        'adaptationVisit',
        'classGroupMember',
        'package',
        'packageExtension',
        'lesson',
        'lessonAttendance',
        'sessionUsage',
        'classGroup',
        'dailyAttendance',
        'calendarDay',
        'absenceNotice',
        'timetable',
        'timetableEntry',
        'lessonChange',
        'schoolLesson',
        'lessonMark',
        'mealOrder',
        'backupRun',
        'salaryTerms',
        'payrollSheet',
        'payrollAdjustment',
        'payrollPayment',
        'payrollExtraHours',
        'teacherAbsence',
      ] as const) {
        mockPrisma[model].count.mockResolvedValue(0);
      }
      mockPrisma.user.delete.mockResolvedValue(row);

      await service.delete('u1', adminActor);

      const [, input] = mockAudit.recordChange.mock.calls[0] as [
        unknown,
        {
          action: string;
          after: unknown;
          before: { login: string };
          fields: string[];
        },
      ];
      expect(input.action).toBe('delete');
      expect(input.after).toBeNull();
      expect(input.before.login).toBe('ann');
      expect(input.fields).not.toContain('password');
    });

    it('records an access change inside the transaction', async () => {
      mockPrisma.userPermission.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.userPermission.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          ...row,
          permissions: [],
          accessScope: AccessScope.institutions,
          institutions: [{ institutionId: 'b' }],
        })
        .mockResolvedValueOnce({
          ...row,
          accessScope: AccessScope.institutions,
          institutions: [{ institutionId: 'a' }],
        });
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'a',
        type: 'kindergarten',
        isActive: true,
        name: 'A',
      });
      const actor = {
        ...adminActor,
        id: 'g1',
        permissions: {
          users: PermissionLevel.edit,
          finance: PermissionLevel.edit,
        },
      };

      await service.setAccess(
        'u1',
        {
          accessScope: AccessScope.institutions,
          institutionIds: ['a'],
          permissions: [
            { area: PermissionArea.finance, level: PermissionLevel.view },
          ],
        },
        actor,
      );

      const [db, input] = mockAudit.recordChange.mock.calls[0] as [
        unknown,
        {
          fields: string[];
          before: { permissions: string[]; institutionIds: string[] };
          after: { permissions: string[]; institutionIds: string[] };
        },
      ];
      expect(db).toBe(mockPrisma);
      expect(input.before.institutionIds).toEqual(['b']);
      expect(input.after.institutionIds).toEqual(['a']);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(input.fields).toEqual([
        'accessScope',
        'institutionIds',
        'permissions',
      ]);
      expect(input.before.permissions).toEqual([]);
      expect(input.after.permissions).toEqual(['finance:view']);
    });
  });
});
