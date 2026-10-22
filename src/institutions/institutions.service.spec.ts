import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  InstitutionType,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { InstitutionsService } from './institutions.service';

const mockPrisma = {
  institution: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  userInstitution: { findMany: jest.fn(), count: jest.fn() },
  group: { count: jest.fn() },
  tariff: { count: jest.fn() },
  menuDay: { count: jest.fn() },
  calendarDay: { count: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockAudit = { recordChange: jest.fn() };

const user = (over: Partial<AuthenticatedUser>): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: { settings: PermissionLevel.edit },
  ...over,
});

const root = user({ id: 'r', role: Role.root });
const scoped = user({ accessScope: AccessScope.institutions });
const existing = {
  id: 'i1',
  name: 'Садок',
  type: InstitutionType.kindergarten,
  isActive: true,
};

describe('InstitutionsService', () => {
  let service: InstitutionsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    const module = await Test.createTestingModule({
      providers: [
        InstitutionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(InstitutionsService);
  });

  it('list returns all institutions for root, active first then by name', async () => {
    mockPrisma.institution.findMany.mockResolvedValue([existing]);
    await expect(service.list(root)).resolves.toEqual([existing]);
    expect(mockPrisma.institution.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, type: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  });

  it('list returns only granted institutions for a scoped user', async () => {
    mockPrisma.userInstitution.findMany.mockResolvedValue([
      { institutionId: 'i1' },
    ]);
    mockPrisma.institution.findMany.mockResolvedValue([existing]);
    await service.list(scoped);
    expect(mockPrisma.userInstitution.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { institutionId: true },
    });
    expect(mockPrisma.institution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['i1'] } } }),
    );
  });

  it('list rejects parents with Insufficient permissions', async () => {
    await expect(service.list(user({ role: Role.parent }))).rejects.toThrow(
      new ForbiddenException('Insufficient permissions'),
    );
  });

  it('create rejects a duplicate name with Institution name already taken', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(existing);
    await expect(
      service.create(
        { name: 'Садок', type: InstitutionType.kindergarten },
        root,
      ),
    ).rejects.toThrow(new ConflictException('Institution name already taken'));
  });

  it('create rejects a scoped admin with Outside access scope', async () => {
    await expect(
      service.create(
        { name: 'Нова', type: InstitutionType.school_class },
        scoped,
      ),
    ).rejects.toThrow(new ForbiddenException('Outside access scope'));
  });

  it('create records an audit change with entityType institutions', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);
    const created = { ...existing, id: 'i2', name: 'Нова' };
    mockPrisma.institution.create.mockResolvedValue(created);
    await service.create(
      { name: 'Нова', type: InstitutionType.kindergarten },
      root,
    );
    expect(mockAudit.recordChange).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        entityType: 'institutions',
        entityId: 'i2',
        fields: ['name', 'type', 'isActive'],
      }),
    );
  });

  it('update rejects a type change while the institution has groups with Institution type cannot change', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(existing);
    mockPrisma.group.count.mockResolvedValue(2);
    await expect(
      service.update('i1', { type: InstitutionType.school_class }, root),
    ).rejects.toThrow(
      new BadRequestException('Institution type cannot change'),
    );
    expect(mockPrisma.institution.update).not.toHaveBeenCalled();
  });

  it('update allows a type change when there are no groups', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(existing);
    mockPrisma.group.count.mockResolvedValue(0);
    mockPrisma.institution.update.mockResolvedValue({
      ...existing,
      type: InstitutionType.school_class,
    });
    await service.update('i1', { type: InstitutionType.school_class }, root);
    expect(mockPrisma.institution.update).toHaveBeenCalled();
    expect(mockAudit.recordChange).toHaveBeenCalled();
  });

  it('update of a missing id throws Institution not found', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);
    await expect(
      service.update('x', { isActive: false }, root),
    ).rejects.toThrow(new NotFoundException('Institution not found'));
  });

  it('create maps a unique violation to Institution name already taken', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(null);
    mockPrisma.institution.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.create(
        { name: 'Нова', type: InstitutionType.kindergarten },
        root,
      ),
    ).rejects.toThrow(new ConflictException('Institution name already taken'));
  });

  it('update maps a unique violation to Institution name already taken', async () => {
    mockPrisma.institution.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    mockPrisma.institution.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(service.update('i1', { name: 'Інша' }, root)).rejects.toThrow(
      new ConflictException('Institution name already taken'),
    );
  });

  it('update rejects a name used by another institution', async () => {
    mockPrisma.institution.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, id: 'i2' });
    await expect(service.update('i1', { name: 'Школа' }, root)).rejects.toThrow(
      new ConflictException('Institution name already taken'),
    );
  });

  it('update rejects a scoped admin with Outside access scope', async () => {
    await expect(
      service.update('i1', { isActive: false }, scoped),
    ).rejects.toThrow(new ForbiddenException('Outside access scope'));
  });

  it('update locks the institution row before counting groups', async () => {
    mockPrisma.institution.findUnique.mockResolvedValue(existing);
    mockPrisma.group.count.mockResolvedValue(0);
    mockPrisma.institution.update.mockResolvedValue(existing);
    await service.update('i1', { type: InstitutionType.school_class }, root);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.group.count.mock.invocationCallOrder[0],
    );
  });

  describe('delete', () => {
    const empty = () => {
      mockPrisma.institution.findUnique.mockResolvedValue(existing);
      mockPrisma.group.count.mockResolvedValue(0);
      mockPrisma.tariff.count.mockResolvedValue(0);
      mockPrisma.menuDay.count.mockResolvedValue(0);
      mockPrisma.calendarDay.count.mockResolvedValue(0);
      mockPrisma.userInstitution.count.mockResolvedValue(0);
    };

    it('deletes an empty institution and records the change', async () => {
      empty();
      await expect(service.delete('i1', root)).resolves.toEqual({
        message: 'Institution deleted',
      });
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.institution.delete).toHaveBeenCalledWith({
        where: { id: 'i1' },
      });
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'institutions',
          entityId: 'i1',
          action: 'delete',
          after: null,
        }),
      );
    });

    it.each([
      'group',
      'tariff',
      'menuDay',
      'calendarDay',
      'userInstitution',
    ] as const)('refuses when the institution has %s rows', async (model) => {
      empty();
      mockPrisma[model].count.mockResolvedValue(1);
      await expect(service.delete('i1', root)).rejects.toThrow(
        new BadRequestException('Institution is in use'),
      );
      expect(mockPrisma.institution.delete).not.toHaveBeenCalled();
    });

    it('rejects a scoped admin', async () => {
      await expect(service.delete('i1', scoped)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.institution.delete).not.toHaveBeenCalled();
    });

    it('throws Institution not found for a missing id', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', root)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
