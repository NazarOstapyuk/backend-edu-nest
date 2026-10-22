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
  },
  userInstitution: { findMany: jest.fn() },
  group: { count: jest.fn() },
};
const mockAudit = { recordChange: jest.fn() };

const user = (over: Partial<AuthenticatedUser>): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
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
});
