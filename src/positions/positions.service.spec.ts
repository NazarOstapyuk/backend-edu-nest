import { Test } from '@nestjs/testing';
import { AccessScope, AuditAction, PermissionArea, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PositionsService } from './positions.service';

const mockPrisma = {
  position: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  positionPermission: { deleteMany: jest.fn(), createMany: jest.fn() },
  user: { count: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockAudit = { recordChange: jest.fn() };

const actor = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'actor',
  role: Role.admin,
  login: 'a',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: { users: 'edit', finance: 'edit' },
  institutionIds: [],
  scopeInstitutionIds: null,
  positionId: 'own-pos',
  ...over,
});

const root = actor({ role: Role.root, positionId: null, permissions: {} });

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Manager',
  teaching: false,
  permissions: [{ area: PermissionArea.finance, level: 'edit' }],
  ...over,
});

describe('PositionsService', () => {
  let service: PositionsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma),
    );
    mockPrisma.position.findFirst.mockResolvedValue(null);
    mockPrisma.user.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        PositionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(PositionsService);
  });

  describe('list', () => {
    it('orders by name and maps userCount', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        { ...row(), _count: { users: 3 } },
      ]);
      const result = await service.list();
      expect(mockPrisma.position.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
      expect(result).toEqual([
        {
          id: 'p1',
          name: 'Manager',
          teaching: false,
          permissions: [{ area: 'finance', level: 'edit' }],
          userCount: 3,
        },
      ]);
    });
  });

  describe('create', () => {
    const dto = {
      name: 'Manager',
      teaching: false,
      permissions: [{ area: PermissionArea.finance, level: 'edit' as const }],
    };

    it('creates as root and audits', async () => {
      mockPrisma.position.create.mockResolvedValue({
        ...row(),
        _count: { users: 0 },
      });
      const result = await service.create(dto, root);
      expect(mockPrisma.position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Manager',
            teaching: false,
            permissions: { create: [{ area: 'finance', level: 'edit' }] },
          },
        }),
      );
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          entityType: 'positions',
          entityId: 'p1',
          action: AuditAction.create,
          before: null,
          after: {
            name: 'Manager',
            teaching: false,
            permissions: ['finance:edit'],
          },
          fields: ['name', 'teaching', 'permissions'],
        }),
      );
      expect(result.userCount).toBe(0);
    });

    it('rejects duplicate areas', async () => {
      await expect(
        service.create(
          {
            ...dto,
            permissions: [
              { area: PermissionArea.finance, level: 'edit' },
              { area: PermissionArea.finance, level: 'view' },
            ],
          },
          root,
        ),
      ).rejects.toThrow('Duplicate permission');
    });

    it('rejects a taken name', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'x' });
      await expect(service.create(dto, root)).rejects.toThrow(
        'Position name already taken',
      );
    });

    it('rejects non-root with institution scope', async () => {
      await expect(
        service.create(
          dto,
          actor({
            accessScope: AccessScope.institutions,
            institutionIds: ['i1'],
            scopeInstitutionIds: ['i1'],
          }),
        ),
      ).rejects.toThrow('Outside access scope');
    });

    it('rejects non-root lacking an area', async () => {
      await expect(
        service.create(dto, actor({ permissions: { users: 'edit' } })),
      ).rejects.toThrow('Cannot grant more than you have');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockPrisma.position.findUnique.mockResolvedValue(row());
      mockPrisma.position.update.mockResolvedValue({
        ...row(),
        _count: { users: 0 },
      });
    });

    it('throws when unknown', async () => {
      mockPrisma.position.findUnique.mockResolvedValue(null);
      await expect(service.update('p1', {}, root)).rejects.toThrow(
        'Position not found',
      );
    });

    it('rejects rename by non-root lacking a current area', async () => {
      await expect(
        service.update(
          'p1',
          { name: 'New' },
          actor({ permissions: { users: 'edit' } }),
        ),
      ).rejects.toThrow('Cannot grant more than you have');
    });

    it('rejects own position', async () => {
      await expect(
        service.update('own-pos', { name: 'New' }, actor()),
      ).rejects.toThrow('Cannot change own access');
    });

    it('rejects teaching change with users, counting all users', async () => {
      mockPrisma.user.count.mockResolvedValue(2);
      await expect(
        service.update('p1', { teaching: true }, root),
      ).rejects.toThrow('Position type cannot change');
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { positionId: 'p1' },
      });
    });

    it('replaces permissions and audits', async () => {
      await service.update(
        'p1',
        { permissions: [{ area: PermissionArea.users, level: 'view' }] },
        root,
      );
      expect(mockPrisma.positionPermission.deleteMany).toHaveBeenCalledWith({
        where: { positionId: 'p1' },
      });
      expect(mockPrisma.positionPermission.createMany).toHaveBeenCalledWith({
        data: [{ positionId: 'p1', area: 'users', level: 'view' }],
      });
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ action: AuditAction.update }),
      );
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      mockPrisma.position.findUnique.mockResolvedValue(row());
    });

    it('rejects when users exist', async () => {
      mockPrisma.user.count.mockResolvedValue(1);
      await expect(service.remove('p1', root)).rejects.toThrow(
        'Position is in use',
      );
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { positionId: 'p1' },
      });
    });

    it('rejects own position', async () => {
      await expect(service.remove('own-pos', actor())).rejects.toThrow(
        'Cannot change own access',
      );
    });

    it('deletes', async () => {
      const result = await service.remove('p1', root);
      expect(mockPrisma.position.delete).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ action: AuditAction.delete, after: null }),
      );
      expect(result).toEqual({ message: 'Position deleted' });
    });
  });
});
