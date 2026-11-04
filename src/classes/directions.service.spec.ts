import { Test } from '@nestjs/testing';
import {
  ClassFormat,
  MissedLessonRule,
  Role,
  TariffUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DirectionsService } from './directions.service';

const mockPrisma = {
  direction: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  classGroup: { create: jest.fn(), deleteMany: jest.fn() },
  classGroupMember: { deleteMany: jest.fn() },
  user: { findMany: jest.fn() },
  tariff: { findUnique: jest.fn() },
  lesson: { count: jest.fn() },
  salaryRate: { count: jest.fn() },
  package: { count: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const group = {
  format: ClassFormat.group,
  teacherIds: ['t1'],
  singleTariffId: 'ts',
  packageTariffId: 'tp',
};

describe('DirectionsService', () => {
  let service: DirectionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.direction.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    mockPrisma.lesson.count.mockResolvedValue(0);
    mockPrisma.salaryRate.count.mockResolvedValue(0);
    mockPrisma.package.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        DirectionsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(DirectionsService);
  });

  it('rejects a duplicate name', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });

    await expect(
      service.create({ name: 'LEGO', missedRule: MissedLessonRule.no_charge }),
    ).rejects.toThrow('Direction with this name already exists');
  });

  it('creates a direction', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue(null);

    await service.create({
      name: 'LEGO',
      missedRule: MissedLessonRule.unexcused_only,
    });

    expect(mockPrisma.direction.create).toHaveBeenCalledWith({
      data: { name: 'LEGO', missedRule: MissedLessonRule.unexcused_only },
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.classGroup.create).not.toHaveBeenCalled();
  });

  describe('create with a group', () => {
    beforeEach(() => {
      mockPrisma.direction.findUnique.mockResolvedValue(null);
      mockPrisma.direction.create.mockResolvedValue({ id: 'd1' });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 't1', role: Role.teacher, isActive: true },
      ]);
      mockPrisma.tariff.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            unit: where.id === 'ts' ? TariffUnit.session : TariffUnit.package,
            institutionId: null,
            isActive: true,
          }),
      );
    });

    it('creates the direction and its group in one transaction', async () => {
      await service.create({
        name: 'Drawing',
        missedRule: MissedLessonRule.always,
        group,
      });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.direction.create).toHaveBeenCalledWith({
        data: { name: 'Drawing', missedRule: MissedLessonRule.always },
      });
      expect(mockPrisma.classGroup.create).toHaveBeenCalledWith({
        data: {
          name: 'Drawing',
          directionId: 'd1',
          format: ClassFormat.group,
          singleTariffId: 'ts',
          packageTariffId: 'tp',
          teachers: { connect: [{ id: 't1' }] },
        },
      });
    });

    it('uses the group name when given', async () => {
      await service.create({
        name: 'Drawing',
        missedRule: MissedLessonRule.always,
        group: { ...group, name: 'Drawing 1' },
      });

      expect(mockPrisma.classGroup.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Drawing 1' }) as unknown,
      });
    });

    it('creates nothing when a teacher is inactive', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 't1', role: Role.teacher, isActive: false },
      ]);

      await expect(
        service.create({
          name: 'Drawing',
          missedRule: MissedLessonRule.always,
          group,
        }),
      ).rejects.toThrow('Teacher is inactive');
      expect(mockPrisma.direction.create).not.toHaveBeenCalled();
      expect(mockPrisma.classGroup.create).not.toHaveBeenCalled();
    });

    it('rejects a tariff of the wrong unit', async () => {
      await expect(
        service.create({
          name: 'Drawing',
          missedRule: MissedLessonRule.always,
          group: { ...group, singleTariffId: 'tp' },
        }),
      ).rejects.toThrow('Tariff unit must be session');
      expect(mockPrisma.direction.create).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });
    });

    it('deletes the direction with its unused groups', async () => {
      await service.delete('d1');

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.lesson.count).toHaveBeenCalledWith({
        where: { classGroup: { directionId: 'd1' } },
      });
      expect(mockPrisma.salaryRate.count).toHaveBeenCalledWith({
        where: { classGroup: { directionId: 'd1' } },
      });
      expect(mockPrisma.classGroupMember.deleteMany).toHaveBeenCalledWith({
        where: { classGroup: { directionId: 'd1' } },
      });
      expect(mockPrisma.classGroup.deleteMany).toHaveBeenCalledWith({
        where: { directionId: 'd1' },
      });
      expect(mockPrisma.direction.delete).toHaveBeenCalledWith({
        where: { id: 'd1' },
      });
    });

    it('refuses when a group has a lesson', async () => {
      mockPrisma.lesson.count.mockResolvedValue(1);

      await expect(service.delete('d1')).rejects.toThrow(
        'Cannot delete: direction is in use',
      );
      expect(mockPrisma.classGroup.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.direction.delete).not.toHaveBeenCalled();
    });

    it('refuses when a group has salary rates', async () => {
      mockPrisma.salaryRate.count.mockResolvedValue(1);

      await expect(service.delete('d1')).rejects.toThrow(
        'Cannot delete: direction is in use',
      );
      expect(mockPrisma.direction.delete).not.toHaveBeenCalled();
    });

    it('refuses when the direction has packages', async () => {
      mockPrisma.package.count.mockResolvedValue(2);

      await expect(service.delete('d1')).rejects.toThrow(
        'Cannot delete: direction is in use',
      );
      expect(mockPrisma.classGroupMember.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.direction.delete).not.toHaveBeenCalled();
    });
  });

  it('throws for an unknown direction', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
      'Direction not found',
    );
  });
});
