import { Test } from '@nestjs/testing';
import { ClassFormat, Role, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClassGroupsService } from './class-groups.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const mockPrisma = {
  direction: { findUnique: jest.fn() },
  classGroup: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  classGroupMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: { findMany: jest.fn() },
  tariff: { findUnique: jest.fn() },
  child: { findUnique: jest.fn() },
  lesson: { count: jest.fn() },
  $transaction: jest.fn(),
};

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'LEGO 1',
  format: ClassFormat.group,
  isActive: true,
  directionId: 'd1',
  direction: { id: 'd1', name: 'LEGO', missedRule: 'no_charge' },
  teachers: [{ id: 't1', firstName: 'Olha', lastName: 'Teacher' }],
  singleTariff: null,
  packageTariff: null,
  members: [],
  lessons: [],
  ...over,
});

const dto = {
  name: 'LEGO 1',
  directionId: 'd1',
  format: ClassFormat.group,
  teacherIds: ['t1'],
};

describe('ClassGroupsService', () => {
  let service: ClassGroupsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) =>
      Promise.all(ops),
    );
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });
    mockPrisma.classGroup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 't1', role: Role.teacher },
    ]);
    mockPrisma.classGroup.findUnique.mockResolvedValue(detail());
    mockPrisma.classGroup.create.mockResolvedValue({ id: 'g1' });
    const module = await Test.createTestingModule({
      providers: [
        ClassGroupsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(ClassGroupsService);
  });

  describe('create', () => {
    it('creates a group with teachers', async () => {
      await service.create(dto);

      expect(mockPrisma.classGroup.create).toHaveBeenCalledWith({
        data: {
          name: 'LEGO 1',
          directionId: 'd1',
          format: ClassFormat.group,
          singleTariffId: null,
          packageTariffId: null,
          teachers: { connect: [{ id: 't1' }] },
        },
      });
    });

    it('rejects users who are not teachers', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 't1', role: Role.parent },
      ]);

      await expect(service.create(dto)).rejects.toThrow('Invalid teachers');
    });

    it('rejects a duplicate name in the direction', async () => {
      mockPrisma.classGroup.findFirst.mockResolvedValue({ id: 'other' });

      await expect(service.create(dto)).rejects.toThrow(
        'Class group with this name already exists in the direction',
      );
    });

    it('checks tariff units', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue({
        id: 'x',
        unit: TariffUnit.month,
      });

      await expect(
        service.create({
          ...dto,
          singleTariffId: '00000000-0000-4000-8000-000000000001',
        }),
      ).rejects.toThrow('Tariff unit must be session');
      await expect(
        service.create({
          ...dto,
          packageTariffId: '00000000-0000-4000-8000-000000000002',
        }),
      ).rejects.toThrow('Tariff unit must be package');
    });
  });

  describe('members', () => {
    it('rejects an overlapping membership', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.classGroupMember.findMany.mockResolvedValue([
        { startDate: day('2026-09-01'), endDate: null },
      ]);

      await expect(
        service.addMember(
          'g1',
          { childId: 'c1', startDate: '2026-10-01' },
          'u1',
        ),
      ).rejects.toThrow('Child is already a member of this group');
    });

    it('adds a member', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'c1' });
      mockPrisma.classGroupMember.findMany.mockResolvedValue([]);

      await service.addMember(
        'g1',
        { childId: 'c1', startDate: '2026-10-01' },
        'u1',
      );

      expect(mockPrisma.classGroupMember.create).toHaveBeenCalledWith({
        data: {
          classGroupId: 'g1',
          childId: 'c1',
          startDate: day('2026-10-01'),
          createdById: 'u1',
        },
      });
    });

    it('rejects an end date before the start', async () => {
      mockPrisma.classGroupMember.findUnique.mockResolvedValue({
        id: 'm1',
        classGroupId: 'g1',
        startDate: day('2026-10-01'),
      });

      await expect(
        service.endMember('m1', { endDate: '2026-09-30' }),
      ).rejects.toThrow('End date must not be before start date');
    });
  });

  it('forbids a teacher from another group', async () => {
    await expect(
      service.get('g1', {
        id: 't2',
        role: Role.teacher,
        login: 't2',
        mustChangePassword: false,
      }),
    ).rejects.toThrow('Not your class group');
  });

  it('refuses to delete a group with lessons', async () => {
    mockPrisma.lesson.count.mockResolvedValue(3);

    await expect(service.delete('g1')).rejects.toThrow(
      'Cannot delete: group is in use',
    );
  });
});
