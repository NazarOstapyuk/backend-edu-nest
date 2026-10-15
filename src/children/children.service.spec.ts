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
import { CreateChildDto } from './dto/create-child.dto';

const mockPrisma = {
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
  enrollment: { count: jest.fn() },
  adaptationVisit: { count: jest.fn() },
  classGroupMember: { count: jest.fn() },
  lessonAttendance: { count: jest.fn() },
  package: { count: jest.fn() },
  dailyAttendance: { count: jest.fn() },
  absenceNotice: { count: jest.fn() },
  subgroupMember: { count: jest.fn() },
  lessonMark: { count: jest.fn() },
};

const fullAdmin: AuthenticatedUser = {
  id: 'a0',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: { children: PermissionLevel.edit },
};

describe('ChildrenService', () => {
  let service: ChildrenService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ChildrenService,
        { provide: PrismaService, useValue: mockPrisma },
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
    };

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
          groupId: undefined,
          parents: undefined,
        },
        include: {
          group: true,
          parents: { omit: { password: true, refreshToken: true } },
          subscriptions: {
            include: { subscriptionType: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });

    it('passes middleName into the created child', async () => {
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
          group: true,
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
          group: true,
          parents: { omit: { password: true, refreshToken: true } },
          subscriptions: {
            include: { subscriptionType: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });

    it('disconnects group when groupId is null', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(existingChild);
      mockPrisma.child.update.mockResolvedValue({
        ...existingChild,
        group: null,
        parents: [],
      });

      await service.update('child-1', { groupId: null }, fullAdmin);

      expect(mockPrisma.child.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ groupId: null }),
        }),
      );
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
      accessScope: AccessScope.kindergarten,
      permissions: { children: PermissionLevel.edit },
    };
    const validDto: CreateChildDto = {
      firstName: 'Ivan',
      lastName: 'Petrenko',
      birthDate: '2020-01-15',
      gender: Gender.male,
    };

    it('lists only children of the scope', async () => {
      mockPrisma.child.findMany.mockResolvedValue([]);
      await service.findAll(kgAdmin);
      expect(mockPrisma.child.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { group: { kind: GroupKind.kindergarten } },
        }),
      );
    });

    it('refuses a child in a group of another kind', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g1',
        kind: GroupKind.school_class,
      });
      await expect(
        service.create({ ...validDto, groupId: 'g1' }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
    });

    it('refuses a child without a group for a scoped user', async () => {
      await expect(
        service.create({ ...validDto, groupId: undefined }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
    });

    it('hides a child of another kind on update and delete', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'c1',
        groupId: 'g2',
        group: { kind: GroupKind.school_class },
      });
      await expect(service.update('c1', {}, kgAdmin)).rejects.toThrow(
        'Child not found',
      );
      await expect(service.delete('c1', kgAdmin)).rejects.toThrow(
        'Child not found',
      );
    });

    it('refuses moving a child to another kind or out of groups', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'c1',
        groupId: 'g1',
        group: { kind: GroupKind.kindergarten },
      });
      mockPrisma.group.findUnique.mockResolvedValue({
        id: 'g2',
        kind: GroupKind.school_class,
      });
      await expect(
        service.update('c1', { groupId: 'g2' }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
      await expect(
        service.update('c1', { groupId: null }, kgAdmin),
      ).rejects.toThrow('Outside access scope');
    });
  });
});
