import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DirectoriesService } from './directories.service';

const mockPrisma = {
  subject: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  room: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};
const user = (role: Role) => ({
  id: 'u1',
  role,
  login: 'x',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
});
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('DirectoriesService', () => {
  let service: DirectoriesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DirectoriesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(DirectoriesService);
  });

  it('lists only active subjects for teachers', async () => {
    mockPrisma.subject.findMany.mockResolvedValue([]);
    await service.listSubjects(user(Role.teacher));
    expect(
      firstArg<{ where: object }>(mockPrisma.subject.findMany).where,
    ).toEqual({ active: true });
  });

  it('rejects a duplicate subject and trims names', async () => {
    mockPrisma.subject.findUnique.mockResolvedValue({
      id: 's1',
      name: 'Математика',
    });
    await expect(
      service.createSubject({ name: ' Математика ' }),
    ).rejects.toThrow(new ConflictException('Subject already exists'));
    mockPrisma.subject.findUnique.mockResolvedValue(null);
    mockPrisma.subject.create.mockResolvedValue({ id: 's2' });
    await service.createSubject({ name: ' Читання ' });
    expect(firstArg<{ data: object }>(mockPrisma.subject.create).data).toEqual({
      name: 'Читання',
    });
  });

  it('updates and deactivates rooms, 404 for missing', async () => {
    mockPrisma.room.findUnique.mockResolvedValueOnce(null);
    await expect(service.updateRoom('nope', { active: false })).rejects.toThrow(
      new NotFoundException('Room not found'),
    );
    mockPrisma.room.findUnique.mockResolvedValueOnce({ id: 'r1', name: '101' });
    mockPrisma.room.update.mockResolvedValue({ id: 'r1' });
    await service.updateRoom('r1', { active: false });
    expect(firstArg<{ data: object }>(mockPrisma.room.update).data).toEqual({
      name: undefined,
      active: false,
    });
  });

  it('rejects a duplicate room name on rename', async () => {
    mockPrisma.room.findUnique
      .mockResolvedValueOnce({ id: 'r1', name: '101' })
      .mockResolvedValueOnce({ id: 'r2', name: '102' });
    await expect(service.updateRoom('r1', { name: '102' })).rejects.toThrow(
      new ConflictException('Room already exists'),
    );
  });
});
