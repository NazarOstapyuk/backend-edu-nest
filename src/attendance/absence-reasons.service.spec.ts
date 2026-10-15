import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AbsenceReasonsService } from './absence-reasons.service';

const mockPrisma = {
  absenceReason: {
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

describe('AbsenceReasonsService', () => {
  let service: AbsenceReasonsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AbsenceReasonsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = moduleRef.get(AbsenceReasonsService);
  });

  it('lists all reasons for admins and only active ones for others', async () => {
    mockPrisma.absenceReason.findMany.mockResolvedValue([]);
    await service.list(user(Role.admin));
    await service.list(user(Role.teacher));
    expect(
      firstArg<{ where: object }>(mockPrisma.absenceReason.findMany).where,
    ).toEqual({});
    expect(
      (
        mockPrisma.absenceReason.findMany.mock.calls[1] as [{ where: object }]
      )[0].where,
    ).toEqual({ active: true });
  });

  it('rejects a duplicate name on create', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue({
      id: 'r1',
      name: 'Хвороба',
    });
    await expect(
      service.create({ name: ' Хвороба ', excused: true }),
    ).rejects.toThrow(new ConflictException('Absence reason already exists'));
    expect(mockPrisma.absenceReason.create).not.toHaveBeenCalled();
  });

  it('creates with trimmed name and defaults', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue(null);
    mockPrisma.absenceReason.create.mockResolvedValue({ id: 'r9' });
    await service.create({ name: ' Карантин ', excused: true });
    expect(
      firstArg<{ data: object }>(mockPrisma.absenceReason.create).data,
    ).toEqual({
      name: 'Карантин',
      excused: true,
      requiresDocument: false,
      sortOrder: 0,
    });
  });

  it('updates an existing reason and rejects a taken name', async () => {
    mockPrisma.absenceReason.findUnique
      .mockResolvedValueOnce({ id: 'r1', name: 'Хвороба' })
      .mockResolvedValueOnce({ id: 'r2', name: 'Відпустка' });
    await expect(service.update('r1', { name: 'Відпустка' })).rejects.toThrow(
      new ConflictException('Absence reason already exists'),
    );
  });

  it('deactivates a reason', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue({
      id: 'r1',
      name: 'Хвороба',
    });
    mockPrisma.absenceReason.update.mockResolvedValue({
      id: 'r1',
      active: false,
    });
    await service.update('r1', { active: false });
    expect(
      firstArg<{ data: { active: boolean } }>(mockPrisma.absenceReason.update)
        .data.active,
    ).toBe(false);
  });

  it('throws when the reason is missing', async () => {
    mockPrisma.absenceReason.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { active: false })).rejects.toThrow(
      new NotFoundException('Absence reason not found'),
    );
  });
});
