import { Test } from '@nestjs/testing';
import { MissedLessonRule } from '@prisma/client';
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
  classGroup: { count: jest.fn() },
  package: { count: jest.fn() },
};

describe('DirectionsService', () => {
  let service: DirectionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.direction.findMany.mockResolvedValue([]);
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
  });

  it('refuses to delete a direction in use', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd1' });
    mockPrisma.classGroup.count.mockResolvedValue(1);
    mockPrisma.package.count.mockResolvedValue(0);

    await expect(service.delete('d1')).rejects.toThrow(
      'Cannot delete: direction is in use',
    );
    expect(mockPrisma.direction.delete).not.toHaveBeenCalled();
  });

  it('throws for an unknown direction', async () => {
    mockPrisma.direction.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
      'Direction not found',
    );
  });
});
