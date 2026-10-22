import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AccessScope,
  Gender,
  GroupKind,
  PermissionLevel,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { ChildrenService } from './children.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateChildDto } from './dto/create-child.dto';

const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  institution: { findUnique: jest.fn() },
  mealOrder: { findFirst: jest.fn() },
  child: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: { findMany: jest.fn() },
  group: { findUnique: jest.fn() },
  charge: { count: jest.fn() },
  payment: { count: jest.fn() },
  enrollment: { count: jest.fn(), findFirst: jest.fn() },
  adaptationVisit: { count: jest.fn() },
  classGroupMember: { count: jest.fn() },
  lessonAttendance: { count: jest.fn() },
  package: { count: jest.fn() },
  dailyAttendance: { count: jest.fn() },
  absenceNotice: { count: jest.fn() },
  subgroupMember: { count: jest.fn() },
  lessonMark: { count: jest.fn() },
  paymentRequest: { count: jest.fn() },
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

describe('ChildrenService', () => {
  let service: ChildrenService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'i1',
      type: GroupKind.kindergarten,
      isActive: true,
      name: 'K',
    });
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    const module = await Test.createTestingModule({
      providers: [
        ChildrenService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(ChildrenService);
  });

  describe('create', () => {
    const baseDto: CreateChildDto = {
      firstName: 'Ivan',
      lastName: 'Petrenko',
      birthDate: '2020-01-15',
      gender: Gender.male,
      groupId: 'g1',
    };

    it('refuses a group of an inactive institution', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        institutionId: 'i1',
      });
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'i1',
        type: GroupKind.kindergarten,
        isActive: false,
        name: 'K',
      });

      await expect(service.create(baseDto, fullAdmin)).rejects.toThrow(
        'Institution is inactive',
      );
      expect(mockPrisma.child.create).not.toHaveBeenCalled();
    });

    it('creates a child with required fields only', async () => {
      const created = {
        id: 'child-1',
        firstName: 'Ivan',
        lastName: 'Petrenko',
        birthDate: new Date('2020-01-15'),
        gender: Gender.male,
        groupId: null,
        group: null,
        parents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        institutionId: 'i1',
      });
      mockPrisma.child.create.mockResolvedValue(created);

      const result = await service.create(baseDto, fullAdmin);

      expect(result).toEqual(created);
      expect(mockPrisma.child.create).toHaveBeenCalledWith({
        data: {
          firstName: 'Ivan',
          lastName: 'Petrenko',
          birthDate: new Date('2020-01-15'),
          middleName: null,
          gender: Gender.male,
          groupId: 'g1',
          parents: undefined,
        },
        include: {
          group: {
            include: {
              institution: { select: { id: true, name: true, type: true } },
            },
          },
          parents: { omit: { password: true, refreshToken: true } },
          subscriptions: {
            include: { subscriptionType: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });

    it('passes middleName into the created child', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        institutionId: 'i1',
      });
      mockPrisma.child.create.mockResolvedValue({ id: 'child-1' });

      await service.create({ ...baseDto, middleName: 'Petrivna' }, fullAdmin);

      const data = (
        mockPrisma.child.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(data).toMatchObject({ middleName: 'Petrivna' });
    });

    it('throws NotFoundException when groupId does not exist', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, groupId: 'missing-group' }, fullAdmin),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.child.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when a parentId does not exist', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        institutionId: 'i1',
      });
      mockPrisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.create(
          {
            ...baseDto,
            parentIds: ['00000000-0000-0000-0000-000000000001'],
          },
          fullAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when user is not a parent', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        institutionId: 'i1',
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: '00000000-0000-0000-0000-000000000001', role: Role.teacher },
      ]);

      await expect(
        service.create(
          {
            ...baseDto,
            parentIds: ['00000000-0000-0000-0000-000000000001'],
          },
          fullAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns all children with group and parents', async () => {
      const children = [
        { id: 'child-1', firstName: 'Ivan', group: null, parents: [] },
      ];
      mockPrisma.child.findMany.mockResolvedValue(children);

      const result = await service.findAll(fullAdmin);
      expect(result).toEqual(children);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith({
        where: {},
        include: {
          group: {
            include: {
              institution: { select: { id: true, name: true, type: true } },
            },
          },
          parents: { omit: { password: true, refreshToken: true } },
          subscriptions: {
            include: { subscriptionType: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  });

  describe('update', () => {
    const existingChild = {
      id: 'child-1',
      firstName: 'Ivan',
      lastName: 'Petrenko',
      birthDate: new Date('2020-01-15'),
      gender: Gender.male,
      groupId: null,
    };

    it('updates a child successfully', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      const updated = {
        ...existingChild,
        firstName: 'Petro',
        group: null,
        parents: [],
      };
      mockPrisma.child.update.mockResolvedValue(updated);

      const result = await service.update(
        'child-1',
        { firstName: 'Petro' },
        fullAdmin,
      );

      expect(result).toEqual(updated);
      expect(mockPrisma.child.update).toHaveBeenCalledWith({
        where: { id: 'child-1' },
        data: {
          firstName: 'Petro',
          lastName: undefined,
          birthDate: undefined,
          gender: undefined,
          groupId: undefined,
          parents: undefined,
        },
        include: {
          group: {
            include: {
              institution: { select: { id: true, name: true, type: true } },
            },
          },
          parents: { omit: { password: true, refreshToken: true } },
          subscriptions: {
            include: { subscriptionType: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });

    it('rejects an explicit null group', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);

      await expect(
        service.update('child-1', { groupId: null }, fullAdmin),
      ).rejects.toThrow('Group is required');
      expect(mockPrisma.child.update).not.toHaveBeenCalled();
    });

    describe('moving between institutions', () => {
      const inGroup = {
        ...existingChild,
        groupId: 'g1',
        group: { institutionId: 'i1' },
        parents: [],
      };

      beforeEach(() => {
        mockPrisma.child.findUnique.mockResolvedValue(inGroup);
        mockPrisma.child.update.mockResolvedValue({ ...inGroup, parents: [] });
        mockPrisma.enrollment.findFirst.mockResolvedValue(null);
        mockPrisma.mealOrder.findFirst.mockResolvedValue(null);
      });

      it('refuses a move with an active enrollment on the old institution', async () => {
        mockPrisma.group.findUnique.mockResolvedValue({
          id: 'g2',
          institutionId: 'i2',
        });
        mockPrisma.institution.findUnique.mockResolvedValue({
          id: 'i2',
          type: GroupKind.school_class,
          isActive: true,
          name: 'S',
        });
        mockPrisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' });

        await expect(
          service.update('child-1', { groupId: 'g2' }, fullAdmin),
        ).rejects.toThrow('Child has an active enrollment');
        expect(mockPrisma.enrollment.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              tariff: { institutionId: 'i1' },
            }) as unknown,
          }),
        );
        expect(mockPrisma.child.update).not.toHaveBeenCalled();
      });

      it('refuses a move into an inactive institution', async () => {
        mockPrisma.group.findUnique.mockResolvedValue({
          id: 'g2',
          institutionId: 'i2',
        });
        mockPrisma.institution.findUnique.mockResolvedValue({
          id: 'i2',
          type: GroupKind.school_class,
          isActive: false,
          name: 'S',
        });

        await expect(
          service.update('child-1', { groupId: 'g2' }, fullAdmin),
        ).rejects.toThrow('Institution is inactive');
        expect(mockPrisma.child.update).not.toHaveBeenCalled();
      });

      it('skips the guard for a move within the same institution', async () => {
        mockPrisma.group.findUnique.mockResolvedValue({
          id: 'g3',
          institutionId: 'i1',
        });

        await service.update('child-1', { groupId: 'g3' }, fullAdmin);

        expect(mockPrisma.enrollment.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.institution.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.child.update).toHaveBeenCalled();
      });

      it('moves to another institution when nothing blocks it', async () => {
        mockPrisma.group.findUnique.mockResolvedValue({
          id: 'g2',
          institutionId: 'i2',
        });
        mockPrisma.institution.findUnique.mockResolvedValue({
          id: 'i2',
          type: GroupKind.school_class,
          isActive: true,
          name: 'S',
        });

        await service.update('child-1', { groupId: 'g2' }, fullAdmin);

        expect(mockPrisma.mealOrder.findFirst).toHaveBeenCalled();
        expect(mockPrisma.child.update).toHaveBeenCalled();
      });
    });

    it('keeps updating a legacy child without a group', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      mockPrisma.child.update.mockResolvedValue({
        ...existingChild,
        parents: [],
      });

      await service.update('child-1', { firstName: 'Petro' }, fullAdmin);

      expect(mockPrisma.child.update).toHaveBeenCalled();
    });

    it('throws BadRequestException when child has enrollments', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(1);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);

      await expect(service.delete('child-1', fullAdmin)).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {}, fullAdmin)).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.child.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when new groupId does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      mockPrisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.update('child-1', { groupId: 'missing-group' }, fullAdmin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes a child and returns a message', async () => {
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.dailyAttendance.count.mockResolvedValue(0);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);
      mockPrisma.subgroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonMark.count.mockResolvedValue(0);
      mockPrisma.paymentRequest.count.mockResolvedValue(0);
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.child.delete.mockResolvedValue({});

      const result = await service.delete('child-1', fullAdmin);

      expect(result).toEqual({ message: 'Child deleted' });
      expect(mockPrisma.child.delete).toHaveBeenCalledWith({
        where: { id: 'child-1' },
      });
    });

    it('throws BadRequestException when child has financial records', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(2);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.dailyAttendance.count.mockResolvedValue(0);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);
      mockPrisma.subgroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonMark.count.mockResolvedValue(0);

      await expect(service.delete('child-1', fullAdmin)).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when child has class records', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(1);
      mockPrisma.dailyAttendance.count.mockResolvedValue(0);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);
      mockPrisma.subgroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonMark.count.mockResolvedValue(0);

      await expect(service.delete('child-1', fullAdmin)).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a child with lesson marks', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.dailyAttendance.count.mockResolvedValue(0);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);
      mockPrisma.subgroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonMark.count.mockResolvedValue(1);

      await expect(service.delete('child-1', fullAdmin)).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a child with register marks', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.charge.count.mockResolvedValue(0);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonAttendance.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.dailyAttendance.count.mockResolvedValue(1);
      mockPrisma.absenceNotice.count.mockResolvedValue(0);
      mockPrisma.subgroupMember.count.mockResolvedValue(0);
      mockPrisma.lessonMark.count.mockResolvedValue(0);

      await expect(service.delete('child-1', fullAdmin)).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete a child with payment requests', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      for (const model of [
        'charge',
        'payment',
        'enrollment',
        'adaptationVisit',
        'classGroupMember',
        'lessonAttendance',
        'package',
        'dailyAttendance',
        'absenceNotice',
        'subgroupMember',
        'lessonMark',
      ] as const) {
        mockPrisma[model].count.mockResolvedValue(0);
      }
      mockPrisma.paymentRequest.count.mockResolvedValue(1);

      await expect(service.delete('child-1', fullAdmin)).rejects.toThrow(
        'Cannot delete: child has financial records',
      );
      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing', fullAdmin)).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.child.delete).not.toHaveBeenCalled();
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
    const validDto: CreateChildDto = {
      firstName: 'Ivan',
      lastName: 'Petrenko',
      birthDate: '2020-01-15',
      gender: Gender.male,
      groupId: 'g1',
    };

    it('lists only children of the scope', async () => {
      mockPrisma.child.findMany.mockResolvedValue([]);
      await service.findAll(kgAdmin);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group: { institutionId: { in: ['inst-k'] } } },
        }),
      );
    });

    it('refuses a child in a group of another institution', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        kind: GroupKind.school_class,
        institutionId: 'inst-s',
      });
      await expect(
        service.create({ ...validDto, groupId: 'g1' }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
    });

    it('hides a child of another institution on update and delete', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'c1',
        groupId: 'g2',
        group: { institutionId: 'inst-s' },
      });
      await expect(service.update('c1', {}, kgAdmin)).rejects.toThrow(
        'Child not found',
      );
      await expect(service.delete('c1', kgAdmin)).rejects.toThrow(
        'Child not found',
      );
    });

    it('refuses moving a child to another institution or clearing the group', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'c1',
        groupId: 'g1',
        group: { institutionId: 'inst-k' },
      });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g2',
        kind: GroupKind.school_class,
        institutionId: 'inst-s',
      });
      await expect(
        service.update('c1', { groupId: 'g2' }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
      await expect(
        service.update('c1', { groupId: null }, kgAdmin),
      ).rejects.toThrow('Group is required');
    });
  });
  describe('audit', () => {
    const row = {
      id: 'c1',
      firstName: 'Ivan',
      lastName: 'Petrenko',
      middleName: null,
      birthDate: new Date('2020-01-15'),
      gender: Gender.male,
      groupId: 'g1',
      group: { kind: GroupKind.kindergarten },
      parents: [{ id: 'p1' }],
    };

    it('records a created child', async () => {
      mockPrisma.child.create.mockResolvedValue(row);
      mockPrisma.group.findUnique.mockResolvedValue({
        kind: GroupKind.kindergarten,
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'p1', role: Role.parent },
      ]);

      await service.create(
        {
          firstName: 'Ivan',
          lastName: 'Petrenko',
          birthDate: '2020-01-15',
          gender: Gender.male,
          groupId: 'g1',
          parentIds: ['p1'],
        },
        fullAdmin,
      );

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'a0',
          entityType: 'children',
          entityId: 'c1',
          action: 'create',
          before: null,
          after: expect.objectContaining({
            firstName: 'Ivan',
            parentIds: ['p1'],
          }) as unknown,
        }),
      );
    });

    it('records an update with before and after', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(row);
      mockPrisma.child.update.mockResolvedValue({
        ...row,
        firstName: 'Petro',
        parents: [],
      });

      await service.update('c1', { firstName: 'Petro' }, fullAdmin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityId: 'c1',
          action: 'update',
          before: expect.objectContaining({
            firstName: 'Ivan',
            parentIds: ['p1'],
          }) as unknown,
          after: expect.objectContaining({
            firstName: 'Petro',
            parentIds: [],
          }) as unknown,
        }),
      );
    });

    it('records a deletion', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(row);
      for (const model of [
        'charge',
        'payment',
        'enrollment',
        'adaptationVisit',
        'classGroupMember',
        'lessonAttendance',
        'package',
        'dailyAttendance',
        'absenceNotice',
        'subgroupMember',
        'lessonMark',
        'paymentRequest',
      ] as const) {
        mockPrisma[model].count.mockResolvedValue(0);
      }
      mockPrisma.child.delete.mockResolvedValue(row);

      await service.delete('c1', fullAdmin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityId: 'c1',
          action: 'delete',
          before: expect.objectContaining({ groupId: 'g1' }) as unknown,
          after: null,
        }),
      );
    });
  });
});
