import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubgroupsService } from './subgroups.service';

const mockPrisma = {
  group: { findUnique: jest.fn() },
  child: { count: jest.fn() },
  subgroup: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  subgroupMember: { deleteMany: jest.fn(), createMany: jest.fn() },
  $transaction: jest.fn(),
};
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];
const row = {
  id: 'sg1',
  groupId: 'g1',
  name: 'Англ. 1',
  active: true,
  members: [{ child: { id: 'c1', firstName: 'А', lastName: 'Б' } }],
};

describe('SubgroupsService', () => {
  let service: SubgroupsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubgroupsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(SubgroupsService);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      kind: GroupKind.school_class,
    });
    mockPrisma.child.count.mockResolvedValue(1);
    mockPrisma.subgroup.findUnique.mockResolvedValue(null);
    mockPrisma.subgroup.create.mockResolvedValue(row);
  });

  it('creates a subgroup of class children', async () => {
    await expect(
      service.create('g1', { name: ' Англ. 1 ', childIds: ['c1'] }),
    ).resolves.toEqual({
      id: 'sg1',
      groupId: 'g1',
      name: 'Англ. 1',
      active: true,
      children: [{ id: 'c1', firstName: 'А', lastName: 'Б' }],
    });
    expect(firstArg<{ data: object }>(mockPrisma.subgroup.create).data).toEqual(
      {
        groupId: 'g1',
        name: 'Англ. 1',
        members: { create: [{ childId: 'c1' }] },
      },
    );
    expect(firstArg<{ where: object }>(mockPrisma.child.count).where).toEqual({
      id: { in: ['c1'] },
      groupId: 'g1',
    });
  });

  it('rejects children from other classes, kindergarten groups and duplicate names', async () => {
    mockPrisma.child.count.mockResolvedValue(0);
    await expect(
      service.create('g1', { name: 'x', childIds: ['c9'] }),
    ).rejects.toThrow(new BadRequestException('Child is not in this class'));
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      kind: GroupKind.kindergarten,
    });
    await expect(
      service.create('g1', { name: 'x', childIds: [] }),
    ).rejects.toThrow(new BadRequestException('Not a school class'));
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      kind: GroupKind.school_class,
    });
    mockPrisma.child.count.mockResolvedValue(0);
    mockPrisma.subgroup.findUnique.mockResolvedValue({ id: 'sg0' });
    await expect(
      service.create('g1', { name: 'x', childIds: [] }),
    ).rejects.toThrow(new ConflictException('Subgroup already exists'));
    mockPrisma.group.findUnique.mockResolvedValue(null);
    await expect(service.list('g9')).rejects.toThrow(
      new NotFoundException('Group not found'),
    );
  });

  it('replaces members on update', async () => {
    mockPrisma.subgroup.findUnique
      .mockResolvedValueOnce({ id: 'sg1', groupId: 'g1', name: 'Англ. 1' })
      .mockResolvedValueOnce(row);
    await service.update('sg1', { childIds: ['c1'] });
    expect(mockPrisma.subgroupMember.deleteMany).toHaveBeenCalledWith({
      where: { subgroupId: 'sg1' },
    });
    expect(mockPrisma.subgroupMember.createMany).toHaveBeenCalledWith({
      data: [{ subgroupId: 'sg1', childId: 'c1' }],
    });
  });
});
