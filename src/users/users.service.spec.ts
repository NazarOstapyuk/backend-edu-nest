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
  position: { findUnique: jest.fn() },
  userInstitution: { deleteMany: jest.fn(), createMany: jest.fn() },
  institution: { findUnique: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
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
  routineTemplate: { count: jest.fn() },
  routineDay: { count: jest.fn() },
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
  positionId: null as string | null,
  permissions,
});
const rootActor = actorOf(Role.root);
const adminActor = actorOf(Role.admin, {
  users: PermissionLevel.edit,
  finance: PermissionLevel.edit,
});
const teacherActor = actorOf(Role.teacher, { users: PermissionLevel.edit });

const teachingPosition = {
  id: 'pos-teach',
  name: 'Педагог',
  teaching: true,
  permissions: [] as { area: PermissionArea; level: PermissionLevel }[],
};
const accountantPosition = {
  id: 'pos-acc',
  name: 'Бухгалтер',
  teaching: false,
  permissions: [{ area: PermissionArea.finance, level: PermissionLevel.view }],
};
const payrollPosition = {
  id: 'pos-pay',
  name: 'Зарплата',
  teaching: false,
  permissions: [{ area: PermissionArea.payroll, level: PermissionLevel.edit }],
};

const dataOf = (mock: jest.Mock) =>
  (mock.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

const zeroSalaryRecords = () => {
  mockPrisma.salaryTerms.count.mockResolvedValue(0);
  mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
  mockPrisma.teacherAbsence.count.mockResolvedValue(0);
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
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
          { login: 'taken', password: 'pass123', positionId: 'pos-teach' },
          adminActor,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('requires a position for staff', async () => {
      await expect(
        service.create({ login: 'n', password: 'pass123' }, adminActor),
      ).rejects.toThrow(new BadRequestException('Position is required'));
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('refuses a role together with a position', async () => {
      await expect(
        service.create(
          {
            login: 'r2',
            password: 'pass123',
            role: Role.root,
            positionId: 'pos-acc',
          },
          rootActor,
        ),
      ).rejects.toThrow(
        new BadRequestException('Access applies to staff only'),
      );
      await expect(
        service.create(
          {
            login: 'mom',
            password: 'pass123',
            role: Role.parent,
            phone: '+380671234567',
            positionId: 'pos-acc',
          },
          adminActor,
        ),
      ).rejects.toThrow('Access applies to staff only');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a teacher from a teaching position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(teachingPosition);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        login: 'newuser',
        role: Role.teacher,
        positionId: 'pos-teach',
        position: teachingPosition,
        institutions: [],
      });

      const result = await service.create(
        { login: 'newuser', password: 'pass123', positionId: 'pos-teach' },
        adminActor,
      );

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.position.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'pos-teach' } }),
      );
      expect(dataOf(mockPrisma.user.create)).toMatchObject({
        role: Role.teacher,
        positionId: 'pos-teach',
        mustChangePassword: false,
      });
      const call = mockPrisma.user.create.mock.calls[0] as [
        { omit: Record<string, boolean> },
      ];
      expect(call[0].omit).toEqual({ password: true, refreshToken: true });
      expect(result).toMatchObject({
        id: 'new-id',
        position: { id: 'pos-teach', name: 'Педагог', teaching: true },
        permissions: [],
        institutionIds: [],
      });
    });

    it('creates an admin from a non-teaching position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);
      mockPrisma.user.create.mockResolvedValue({
        id: 'a1',
        position: accountantPosition,
      });

      const result = await service.create(
        { login: 'acc', password: 'pass123', positionId: 'pos-acc' },
        adminActor,
      );

      expect(dataOf(mockPrisma.user.create)).toMatchObject({
        role: Role.admin,
        positionId: 'pos-acc',
      });
      expect(result.permissions).toEqual([
        { area: PermissionArea.finance, level: PermissionLevel.view },
      ]);
    });

    describe('scope in one call', () => {
      const scopedActor = {
        ...adminActor,
        accessScope: AccessScope.institutions,
        institutionIds: ['a', 'b'],
        scopeInstitutionIds: ['a', 'b'],
      };
      const inst = (isActive = true) => ({
        id: 'a',
        type: 'kindergarten',
        isActive,
        name: 'A',
      });
      const dto = (extra: Record<string, unknown>) => ({
        login: 'n',
        password: 'pass123',
        positionId: 'pos-acc',
        ...extra,
      });

      beforeEach(() => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);
        mockPrisma.institution.findUnique.mockResolvedValue(inst());
        mockPrisma.user.create.mockResolvedValue({
          id: 'a1',
          position: accountantPosition,
          institutions: [{ institutionId: 'a' }],
        });
      });

      it('stores the requested scope in the create call', async () => {
        await service.create(
          dto({
            accessScope: AccessScope.institutions,
            institutionIds: ['a', 'a'],
          }),
          rootActor,
        );
        expect(dataOf(mockPrisma.user.create)).toMatchObject({
          accessScope: AccessScope.institutions,
          institutions: { create: [{ institutionId: 'a' }] },
        });
        expect(mockPrisma.institution.findUnique).toHaveBeenCalledTimes(1);
      });

      it('stores scope all explicitly', async () => {
        await service.create(dto({ accessScope: AccessScope.all }), rootActor);
        const data = dataOf(mockPrisma.user.create);
        expect(data).toMatchObject({ accessScope: AccessScope.all });
        expect(data.institutions).toBeUndefined();
      });

      it('refuses institutions outside the actor scope', async () => {
        await expect(
          service.create(
            dto({
              accessScope: AccessScope.institutions,
              institutionIds: ['c'],
            }),
            scopedActor,
          ),
        ).rejects.toThrow(
          new ForbiddenException('Cannot grant more than you have'),
        );
        await expect(
          service.create(dto({ accessScope: AccessScope.all }), scopedActor),
        ).rejects.toThrow('Cannot grant more than you have');
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
      });

      it('refuses an inactive or unknown institution', async () => {
        mockPrisma.institution.findUnique.mockResolvedValue(inst(false));
        await expect(
          service.create(
            dto({
              accessScope: AccessScope.institutions,
              institutionIds: ['a'],
            }),
            rootActor,
          ),
        ).rejects.toThrow('Institution is inactive');
        mockPrisma.institution.findUnique.mockResolvedValue(null);
        await expect(
          service.create(
            dto({
              accessScope: AccessScope.institutions,
              institutionIds: ['a'],
            }),
            rootActor,
          ),
        ).rejects.toThrow('Institution not found');
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
      });

      it('refuses scope for parents', async () => {
        await expect(
          service.create(
            {
              login: 'mom',
              password: 'pass123',
              role: Role.parent,
              phone: '+380671234567',
              accessScope: AccessScope.all,
            },
            rootActor,
          ),
        ).rejects.toThrow(
          new BadRequestException('Access applies to staff only'),
        );
      });

      it('keeps copying the actor scope when none is sent', async () => {
        await service.create(dto({}), scopedActor);
        expect(dataOf(mockPrisma.user.create)).toMatchObject({
          accessScope: AccessScope.institutions,
          institutions: {
            create: [{ institutionId: 'a' }, { institutionId: 'b' }],
          },
        });
      });
    });

    it('answers 404 for an unknown position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(null);
      await expect(
        service.create(
          { login: 'n', password: 'pass123', positionId: 'pos-x' },
          adminActor,
        ),
      ).rejects.toThrow('Position not found');
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('refuses a non-root actor assigning a position with an area they lack', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(payrollPosition);
      await expect(
        service.create(
          { login: 'n', password: 'pass123', positionId: 'pos-pay' },
          adminActor,
        ),
      ).rejects.toThrow(
        new ForbiddenException('Cannot grant more than you have'),
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('lets root assign any position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(payrollPosition);
      mockPrisma.user.create.mockResolvedValue({ id: 'n' });
      await service.create(
        { login: 'n', password: 'pass123', positionId: 'pos-pay' },
        rootActor,
      );
      expect(mockPrisma.user.create).toHaveBeenCalled();
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
      mockPrisma.user.create.mockResolvedValue({ id: 'p1' });

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

      expect(dataOf(mockPrisma.user.create)).toMatchObject({
        role: Role.parent,
        positionId: null,
        middleName: 'Ivanivna',
        phone: '+380671234567',
        email: 'mom@example.com',
        mustChangePassword: true,
      });
      expect(mockPrisma.position.findUnique).not.toHaveBeenCalled();
    });

    it('allows root to create root', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'id2', role: Role.root });
      await service.create(
        { login: 'root2', password: 'pass123', role: Role.root },
        rootActor,
      );
      expect(dataOf(mockPrisma.user.create)).toMatchObject({
        role: Role.root,
        positionId: null,
      });
    });
  });

  describe('lookup', () => {
    it('returns active teachers by name', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          firstName: 'A',
          lastName: 'B',
          middleName: null,
          phone: null,
          isActive: true,
          institutions: [{ institutionId: 'y' }, { institutionId: 'x' }],
        },
      ]);
      const rows = await service.lookup(Role.teacher, false);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: Role.teacher, isActive: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
      );
      expect(rows).toEqual([
        {
          id: 'u1',
          firstName: 'A',
          lastName: 'B',
          middleName: null,
          phone: null,
          isActive: true,
          institutionIds: ['x', 'y'],
        },
      ]);
    });

    it('includes inactive users on request', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.lookup(Role.parent, true);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: Role.parent } }),
      );
    });
  });

  describe('findAll', () => {
    it('maps the position and its permissions', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          role: Role.admin,
          positionId: 'pos-acc',
          position: accountantPosition,
          institutions: [{ institutionId: 'b' }, { institutionId: 'a' }],
        },
        { id: 'u2', role: Role.parent, positionId: null, position: null },
      ]);

      const rows = await service.findAll();

      expect(rows[0]).toEqual({
        id: 'u1',
        role: Role.admin,
        positionId: 'pos-acc',
        position: { id: 'pos-acc', name: 'Бухгалтер', teaching: false },
        permissions: [
          { area: PermissionArea.finance, level: PermissionLevel.view },
        ],
        institutionIds: ['a', 'b'],
      });
      expect(rows[1]).toMatchObject({ position: null, permissions: [] });
    });
  });

  describe('update', () => {
    const parent = {
      id: 'p1',
      login: 'mom',
      role: Role.parent,
      accessScope: AccessScope.all,
      positionId: null,
      position: null,
      phone: '+380671234567',
    };
    const teacher = {
      ...parent,
      role: Role.teacher,
      positionId: 'pos-teach',
      position: teachingPosition,
    };

    beforeEach(() => {
      mockPrisma.user.update.mockResolvedValue({ id: 'p1' });
    });

    it('forces a password change and drops sessions on admin reset', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);

      await service.update('p1', { password: 'newpass1' }, adminActor);

      const data = dataOf(mockPrisma.user.update);
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
      mockPrisma.user.findUnique.mockResolvedValue({ ...teacher, phone: null });

      await expect(
        service.update('p1', { role: Role.parent }, adminActor),
      ).rejects.toThrow('Phone is required for parents');
    });

    it('clears position and access when a teacher becomes a parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(teacher);
      zeroSalaryRecords();

      await service.update('p1', { role: Role.parent }, adminActor);

      expect(dataOf(mockPrisma.user.update)).toMatchObject({
        role: Role.parent,
        positionId: null,
        institutions: { deleteMany: {} },
        accessScope: AccessScope.all,
      });
    });

    it('locks the user row before the position row', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...parent,
        role: Role.admin,
        positionId: 'pos-acc',
        position: accountantPosition,
      });
      mockPrisma.position.findUnique.mockResolvedValue(teachingPosition);

      await service.update('p1', { positionId: 'pos-teach' }, adminActor);

      const order = mockPrisma.$queryRaw.mock.invocationCallOrder;
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(
        (mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray])[0].join(
          '',
        ),
      ).toContain('"User"');
      expect(
        (mockPrisma.$queryRaw.mock.calls[1] as [TemplateStringsArray])[0].join(
          '',
        ),
      ).toContain('"Position"');
      expect(order[0]).toBeLessThan(order[1]);
    });

    it('refuses a position together with role parent', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(teacher);
      await expect(
        service.update(
          'p1',
          { role: Role.parent, positionId: 'pos-acc' },
          adminActor,
        ),
      ).rejects.toThrow(
        new BadRequestException('Access applies to staff only'),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('changes the position and derives the role', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...teacher,
        role: Role.admin,
        positionId: 'pos-acc',
        position: accountantPosition,
      });
      mockPrisma.position.findUnique.mockResolvedValue(teachingPosition);

      await service.update('p1', { positionId: 'pos-teach' }, adminActor);

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(dataOf(mockPrisma.user.update)).toMatchObject({
        role: Role.teacher,
        positionId: 'pos-teach',
      });
    });

    it('turns a parent into staff through a position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);
      mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);

      await service.update('p1', { positionId: 'pos-acc' }, adminActor);

      expect(dataOf(mockPrisma.user.update)).toMatchObject({
        role: Role.admin,
        positionId: 'pos-acc',
      });
    });

    it('refuses assigning a position with an area the actor lacks', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);
      mockPrisma.position.findUnique.mockResolvedValue(payrollPosition);

      await expect(
        service.update('p1', { positionId: 'pos-pay' }, adminActor),
      ).rejects.toThrow(
        new ForbiddenException('Cannot grant more than you have'),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);
      mockPrisma.position.findUnique.mockResolvedValue(null);

      await expect(
        service.update('p1', { positionId: 'pos-x' }, adminActor),
      ).rejects.toThrow('Position not found');
    });

    it('refuses to give root a position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...parent,
        role: Role.root,
      });

      await expect(
        service.update('p1', { positionId: 'pos-acc' }, rootActor),
      ).rejects.toThrow(
        new ForbiddenException('Root access cannot be changed'),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('returns the position and derived permissions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(parent);
      mockPrisma.user.update.mockResolvedValue({
        id: 'p1',
        role: Role.admin,
        positionId: 'pos-acc',
        position: accountantPosition,
        institutions: [],
      });

      const result = await service.update('p1', { firstName: 'A' }, rootActor);

      expect(result).toMatchObject({
        position: { id: 'pos-acc', name: 'Бухгалтер', teaching: false },
        permissions: [
          { area: PermissionArea.finance, level: PermissionLevel.view },
        ],
        institutionIds: [],
      });
      expect(result).not.toHaveProperty('institutions');
    });
  });

  describe('privilege escalation', () => {
    const target = (over: Record<string, unknown> = {}) => ({
      id: 'x1',
      login: 'x',
      role: Role.admin,
      phone: null,
      accessScope: AccessScope.all,
      positionId: 'pos-pay',
      position: payrollPosition,
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

    it('refuses to change own role or position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({
          id: 'actor',
          positionId: 'pos-acc',
          position: accountantPosition,
        }),
      );
      await expect(
        service.update('actor', { role: Role.parent }, adminActor),
      ).rejects.toThrow('Cannot change own access');
      await expect(
        service.update('actor', { positionId: 'pos-teach' }, adminActor),
      ).rejects.toThrow(new ForbiddenException('Cannot change own access'));
      await expect(
        service.update('actor', { positionId: 'pos-teach' }, rootActor),
      ).rejects.toThrow('Cannot change own access');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a non-root actor touching root', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({ role: Role.root, positionId: null, position: null }),
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
        target({
          role: Role.parent,
          positionId: null,
          position: null,
          phone: '+380',
        }),
      );
      await service.update('x1', { firstName: 'A' }, adminActor);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('allows a non-root actor to update their own fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({
          id: 'actor',
          positionId: 'pos-acc',
          position: accountantPosition,
        }),
      );
      await service.update('actor', { firstName: 'A' }, adminActor);
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('refuses to deactivate oneself', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({
          id: 'actor',
          positionId: 'pos-acc',
          position: accountantPosition,
        }),
      );
      await expect(
        service.update('actor', { isActive: false }, adminActor),
      ).rejects.toThrow('Cannot change own access');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to delete oneself', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({
          id: 'actor',
          positionId: 'pos-acc',
          position: accountantPosition,
        }),
      );
      await expect(service.delete('actor', adminActor)).rejects.toThrow(
        'Cannot change own access',
      );
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });

    it('gives staff created by a scoped actor the actor scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(teachingPosition);
      mockPrisma.user.create.mockResolvedValue({ id: 'n' });
      const scoped = {
        ...adminActor,
        accessScope: AccessScope.institutions,
        institutionIds: ['inst-a', 'inst-b'],
      };
      await service.create(
        { login: 'n', password: 'pass123', positionId: 'pos-teach' },
        scoped,
      );
      const scopedData = dataOf(mockPrisma.user.create);
      expect(scopedData.accessScope).toBe(AccessScope.institutions);
      expect(scopedData.institutions).toEqual({
        create: [{ institutionId: 'inst-a' }, { institutionId: 'inst-b' }],
      });
      mockPrisma.user.create.mockClear();
      await service.create(
        { login: 'n', password: 'pass123', positionId: 'pos-teach' },
        adminActor,
      );
      expect(dataOf(mockPrisma.user.create)).not.toHaveProperty('accessScope');
    });

    it('gives a promoted parent the actor scope', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        target({
          role: Role.parent,
          positionId: null,
          position: null,
          phone: '+380',
        }),
      );
      mockPrisma.position.findUnique.mockResolvedValue(teachingPosition);
      const scoped = {
        ...adminActor,
        accessScope: AccessScope.institutions,
        institutionIds: ['inst-a'],
      };
      await service.update('x1', { positionId: 'pos-teach' }, scoped);
      const data = dataOf(mockPrisma.user.update);
      expect(data.accessScope).toBe(AccessScope.institutions);
      expect(data.institutions).toEqual({
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
        position: null,
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
      mockPrisma.routineTemplate.count.mockResolvedValue(0);
      mockPrisma.routineDay.count.mockResolvedValue(0);
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

    it.each(['routineTemplate', 'routineDay'] as const)(
      'throws BadRequestException when user created %s rows',
      async (model) => {
        mockPrisma[model].count.mockResolvedValue(1);

        await expect(service.delete('u1', rootActor)).rejects.toThrow(
          'Cannot delete: user has financial records, deactivate instead',
        );
        expect(mockPrisma[model].count).toHaveBeenCalledWith({
          where: { createdById: 'u1' },
        });
        expect(mockPrisma.user.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('leaving a teaching position with salary records', () => {
    const teacherRow = {
      id: 't1',
      login: 'teacher',
      role: Role.teacher,
      accessScope: AccessScope.all,
      positionId: 'pos-teach',
      position: teachingPosition,
      phone: null,
    };

    it('rejects moving a teacher with salary terms to a non-teaching position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(teacherRow);
      mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);
      mockPrisma.salaryTerms.count.mockResolvedValue(2);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
      mockPrisma.teacherAbsence.count.mockResolvedValue(0);

      await expect(
        service.update('t1', { positionId: 'pos-acc' }, rootActor),
      ).rejects.toThrow(new BadRequestException('User has salary terms'));
      expect(mockPrisma.salaryTerms.count).toHaveBeenCalledWith({
        where: { teacherId: 't1' },
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects leaving teaching with absences or extra hours', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...teacherRow,
        phone: '+380671234567',
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(0);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
      mockPrisma.teacherAbsence.count.mockResolvedValue(1);

      await expect(
        service.update('t1', { role: Role.parent }, rootActor),
      ).rejects.toThrow('User has salary terms');

      mockPrisma.teacherAbsence.count.mockResolvedValue(0);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(1);
      await expect(
        service.update('t1', { role: Role.parent }, rootActor),
      ).rejects.toThrow('User has salary terms');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('allows moving between teaching positions and other changes', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(teacherRow);
      mockPrisma.position.findUnique.mockResolvedValue({
        ...teachingPosition,
        id: 'pos-teach2',
      });
      mockPrisma.salaryTerms.count.mockResolvedValue(2);
      mockPrisma.user.update.mockResolvedValue({ id: 't1' });

      await service.update('t1', { positionId: 'pos-teach2' }, rootActor);
      await service.update('t1', { firstName: 'Олена' }, rootActor);

      expect(mockPrisma.salaryTerms.count).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
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
      positionId: 'pos-deputy',
      permissions: {
        users: PermissionLevel.edit,
        finance: PermissionLevel.edit,
      },
    };
    const targetRow = (over: Record<string, unknown> = {}) => ({
      id: 't1',
      role: Role.admin,
      accessScope: AccessScope.all,
      positionId: 'pos-empty',
      position: {
        id: 'pos-empty',
        name: 'Порожня',
        teaching: false,
        permissions: [],
      },
      ...over,
    });
    const access = (over: Record<string, unknown> = {}) => ({
      positionId: 'pos-acc',
      accessScope: AccessScope.all,
      ...over,
    });

    beforeEach(() => {
      mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('assigns the position, role and scope', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(targetRow())
        .mockResolvedValueOnce({
          ...targetRow({
            positionId: 'pos-acc',
            position: accountantPosition,
          }),
          login: 'acc',
        });

      const view = await service.setAccess('t1', access(), actor);

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: {
          accessScope: AccessScope.all,
          positionId: 'pos-acc',
          role: Role.admin,
        },
      });
      expect(view.position).toEqual({
        id: 'pos-acc',
        name: 'Бухгалтер',
        teaching: false,
      });
      expect(view.permissions).toEqual([
        { area: PermissionArea.finance, level: PermissionLevel.view },
      ]);
    });

    it('sets role teacher for a teaching position', async () => {
      mockPrisma.position.findUnique.mockResolvedValue(teachingPosition);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(targetRow())
        .mockResolvedValueOnce(targetRow());

      await service.setAccess('t1', access({ positionId: 'pos-teach' }), actor);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: {
          accessScope: AccessScope.all,
          positionId: 'pos-teach',
          role: Role.teacher,
        },
      });
    });

    it('refuses a non-teaching position for a teacher with salary terms', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        targetRow({
          role: Role.teacher,
          positionId: 'pos-teach',
          position: teachingPosition,
        }),
      );
      mockPrisma.salaryTerms.count.mockResolvedValue(1);
      mockPrisma.payrollExtraHours.count.mockResolvedValue(0);
      mockPrisma.teacherAbsence.count.mockResolvedValue(0);

      await expect(service.setAccess('t1', access(), actor)).rejects.toThrow(
        new BadRequestException('User has salary terms'),
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown position', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(targetRow());
      mockPrisma.position.findUnique.mockResolvedValue(null);
      await expect(service.setAccess('t1', access(), actor)).rejects.toThrow(
        'Position not found',
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('maps denials to errors', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        targetRow({ role: Role.root, positionId: null, position: null }),
      );
      await expect(service.setAccess('t1', access(), actor)).rejects.toThrow(
        'Root access cannot be changed',
      );

      mockPrisma.user.findUnique.mockResolvedValue(
        targetRow({ role: Role.parent, positionId: null, position: null }),
      );
      await expect(service.setAccess('t1', access(), actor)).rejects.toThrow(
        'Access applies to staff only',
      );

      mockPrisma.user.findUnique.mockResolvedValue(targetRow({ id: 'g1' }));
      await expect(service.setAccess('g1', access(), actor)).rejects.toThrow(
        'Cannot change own access',
      );

      mockPrisma.user.findUnique.mockResolvedValue(targetRow());
      mockPrisma.position.findUnique.mockResolvedValue(payrollPosition);
      await expect(
        service.setAccess('t1', access({ positionId: 'pos-pay' }), actor),
      ).rejects.toThrow('Cannot grant more than you have');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses changing access of a user the actor does not cover', async () => {
      const narrowTarget = targetRow({
        accessScope: AccessScope.institutions,
        institutions: [{ institutionId: 'inst-a' }],
        positionId: 'pos-big',
        position: {
          id: 'pos-big',
          name: 'Велика',
          teaching: false,
          permissions: [
            { area: PermissionArea.finance, level: PermissionLevel.edit },
            { area: PermissionArea.payroll, level: PermissionLevel.edit },
          ],
        },
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
          access({
            accessScope: AccessScope.institutions,
            institutionIds: ['inst-a'],
          }),
          deputy,
        ),
      ).rejects.toThrow('Cannot grant more than you have');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    describe('institutions', () => {
      const scopedActor = (institutionIds: string[]) => ({
        ...actor,
        accessScope: AccessScope.institutions,
        institutionIds,
        scopeInstitutionIds: institutionIds,
      });
      const grant = (ids: string[]) =>
        access({
          accessScope: AccessScope.institutions,
          institutionIds: ids,
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
          data: {
            accessScope: AccessScope.institutions,
            positionId: 'pos-acc',
            role: Role.admin,
          },
        });
        expect(view.institutionIds).toEqual(['a']);
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
        await service.setAccess('t1', access(), actor);
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

    it('rejects a missing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setAccess('t1', access(), actor)).rejects.toThrow(
        'User not found',
      );
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
      positionId: 'pos-acc',
      position: accountantPosition,
    };

    it('records a created user without a password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);
      mockPrisma.user.create.mockResolvedValue(row);

      await service.create(
        {
          login: 'ann',
          password: 'secret99',
          positionId: 'pos-acc',
          firstName: 'Ann',
          lastName: 'Lee',
        },
        adminActor,
      );

      const [, input] = mockAudit.recordChange.mock.calls[0] as [
        unknown,
        {
          before: unknown;
          after: { login: string; password: unknown; position: unknown };
          fields: string[];
        },
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
      expect(input.after.position).toBe('Бухгалтер');
      expect(input.after.password).toBeNull();
      expect(input.fields).toContain('position');
      expect(input.fields).toContain('positionId');
      expect(input.fields).not.toContain('permissions');
      expect(JSON.stringify(mockAudit.recordChange.mock.calls)).not.toContain(
        'secret99',
      );
    });

    it('records an update and marks a password reset without leaking it', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(row);
      mockPrisma.user.update.mockResolvedValue({
        ...row,
        firstName: 'Anna',
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
            position: unknown;
          };
          after: { firstName: string; password: unknown };
        },
      ];
      expect(input.action).toBe('update');
      expect(input.before.firstName).toBe('Ann');
      expect(input.before.password).toBeNull();
      expect(input.before.position).toBe('Бухгалтер');
      expect(input.after.firstName).toBe('Anna');
      expect(input.after.password).toBe('змінено');
      const dump = JSON.stringify(mockAudit.recordChange.mock.calls);
      expect(dump).not.toContain('newsecret1');
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
        'routineTemplate',
        'routineDay',
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
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.position.findUnique.mockResolvedValue(accountantPosition);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          ...row,
          positionId: null,
          position: null,
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
          positionId: 'pos-acc',
          accessScope: AccessScope.institutions,
          institutionIds: ['a'],
        },
        actor,
      );

      const [db, input] = mockAudit.recordChange.mock.calls[0] as [
        unknown,
        {
          fields: string[];
          before: { position: unknown; institutionIds: string[] };
          after: { position: unknown; institutionIds: string[] };
        },
      ];
      expect(db).toBe(mockPrisma);
      expect(input.before.institutionIds).toEqual(['b']);
      expect(input.after.institutionIds).toEqual(['a']);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(input.fields).toEqual([
        'role',
        'accessScope',
        'institutionIds',
        'positionId',
        'position',
      ]);
      expect(input.before.position).toBeNull();
      expect(input.after.position).toBe('Бухгалтер');
      expect(input.after).toMatchObject({ positionId: 'pos-acc' });
    });
  });
});
