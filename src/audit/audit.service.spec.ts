import { Test } from '@nestjs/testing';
import { AuditAction, AuthEventType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { runWithRequest } from './request-context';

const mockPrisma = {
  auditEvent: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  auditChange: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  authEvent: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
};

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
    mockPrisma.auditEvent.count.mockResolvedValue(0);
    mockPrisma.auditChange.findMany.mockResolvedValue([]);
    mockPrisma.auditChange.count.mockResolvedValue(0);
    mockPrisma.authEvent.findMany.mockResolvedValue([]);
    mockPrisma.authEvent.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AuditService);
    prisma = module.get(PrismaService);
  });

  it('records an event and swallows write errors', async () => {
    mockPrisma.auditEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.recordEvent({
        requestId: 'r1',
        actorId: 'u1',
        actorRole: Role.admin,
        method: 'PATCH',
        route: 'PATCH /children/:id',
        entityType: 'children',
        entityId: 'c1',
        statusCode: 200,
        ip: '::1',
        userAgent: 'test',
        body: { firstName: 'A' },
      }),
    ).resolves.toBeUndefined();
  });

  it('records auth events and swallows write errors', async () => {
    mockPrisma.authEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.recordAuth({
        type: AuthEventType.login_failed,
        login: 'x',
        userId: null,
        reason: 'invalid_credentials',
        ip: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('records a change with the request id and skips empty updates', async () => {
    await runWithRequest('r9', () =>
      service.recordChange(prisma, {
        actorId: 'u1',
        entityType: 'groups',
        entityId: 'g1',
        action: AuditAction.update,
        before: { name: 'A' },
        after: { name: 'B' },
        fields: ['name'],
      }),
    );
    expect(mockPrisma.auditChange.create).toHaveBeenCalledWith({
      data: {
        requestId: 'r9',
        actorId: 'u1',
        entityType: 'groups',
        entityId: 'g1',
        action: AuditAction.update,
        changes: [{ field: 'name', before: 'A', after: 'B' }],
      },
    });
    mockPrisma.auditChange.create.mockClear();
    await service.recordChange(prisma, {
      actorId: null,
      entityType: 'groups',
      entityId: 'g1',
      action: AuditAction.update,
      before: { name: 'A' },
      after: { name: 'A' },
      fields: ['name'],
    });
    expect(mockPrisma.auditChange.create).not.toHaveBeenCalled();
  });

  it('uses an empty request id outside a request', async () => {
    await service.recordChange(prisma, {
      actorId: null,
      entityType: 'settings',
      entityId: 'chargeLeadDays',
      action: AuditAction.update,
      before: { value: '5' },
      after: { value: '7' },
      fields: ['value'],
    });
    expect(mockPrisma.auditChange.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestId: '' }) as object,
      }),
    );
  });

  it('filters events by Kyiv days, actor, entity and failures, 50 per page', async () => {
    await service.listEvents({
      from: '2026-10-15',
      to: '2026-10-15',
      actorId: 'u1',
      entityType: 'children',
      entityId: 'c1',
      failedOnly: 'true',
      page: 2,
    });
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          at: {
            gte: new Date('2026-10-14T21:00:00.000Z'),
            lt: new Date('2026-10-15T21:00:00.000Z'),
          },
          actorId: 'u1',
          entityType: 'children',
          entityId: 'c1',
          statusCode: { gte: 400 },
        },
        orderBy: { at: 'desc' },
        skip: 50,
        take: 50,
      }),
    );
  });

  it('rejects bad periods', async () => {
    await expect(service.listEvents({ from: '2026-13-01' })).rejects.toThrow(
      'Invalid date',
    );
    await expect(
      service.listEvents({ from: '2026-10-15', to: '2026-10-14' }),
    ).rejects.toThrow('Invalid period');
  });

  it('returns an event with its changes or 404', async () => {
    mockPrisma.auditEvent.findUnique.mockResolvedValueOnce(null);
    await expect(service.getEvent('e1')).rejects.toThrow(
      'Audit event not found',
    );
    mockPrisma.auditEvent.findUnique.mockResolvedValueOnce({
      id: 'e1',
      requestId: 'r1',
    });
    mockPrisma.auditChange.findMany.mockResolvedValueOnce([{ id: 'ch1' }]);
    const event = await service.getEvent('e1');
    expect(mockPrisma.auditChange.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 'r1' } }),
    );
    expect(event).toMatchObject({ id: 'e1', changes: [{ id: 'ch1' }] });
  });

  it('lists changes of one object and auth events by login and type', async () => {
    await service.listChanges({ entityType: 'children', entityId: 'c1' });
    expect(mockPrisma.auditChange.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: 'children', entityId: 'c1' },
        take: 50,
        skip: 0,
      }),
    );
    await service.listAuth({ login: 'acc', type: AuthEventType.login_failed });
    expect(mockPrisma.authEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          login: { contains: 'acc', mode: Prisma.QueryMode.insensitive },
          type: AuthEventType.login_failed,
        },
      }),
    );
  });
});
