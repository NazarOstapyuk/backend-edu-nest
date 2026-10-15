import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditRetentionScheduler } from './audit-retention.scheduler';

const mockPrisma = {
  auditEvent: { deleteMany: jest.fn() },
  auditChange: { deleteMany: jest.fn() },
  authEvent: { deleteMany: jest.fn() },
};

describe('AuditRetentionScheduler', () => {
  let scheduler: AuditRetentionScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.auditEvent.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditChange.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.authEvent.deleteMany.mockResolvedValue({ count: 3 });
    const module = await Test.createTestingModule({
      providers: [
        AuditRetentionScheduler,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    scheduler = module.get(AuditRetentionScheduler);
  });

  it('deletes records older than 365 days', async () => {
    await scheduler.purge(new Date('2026-10-15T01:00:00Z'));
    const args = { where: { at: { lt: new Date('2025-10-15T01:00:00Z') } } };
    expect(mockPrisma.auditEvent.deleteMany).toHaveBeenCalledWith(args);
    expect(mockPrisma.auditChange.deleteMany).toHaveBeenCalledWith(args);
    expect(mockPrisma.authEvent.deleteMany).toHaveBeenCalledWith(args);
  });

  it('swallows purge errors', async () => {
    mockPrisma.auditEvent.deleteMany.mockRejectedValueOnce(new Error('down'));
    await expect(scheduler.purge()).resolves.toBeUndefined();
  });
});
