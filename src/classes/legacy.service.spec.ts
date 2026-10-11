import { Test } from '@nestjs/testing';
import { MissedLessonRule, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LegacyService } from './legacy.service';

const mockPrisma = {
  subscription: { findMany: jest.fn() },
  direction: { findUnique: jest.fn(), create: jest.fn() },
  package: { create: jest.fn() },
};

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  childId: 'c1',
  totalSessions: 8,
  remainingSessions: 5,
  status: SubscriptionStatus.active,
  createdAt: new Date('2026-05-20T09:00:00Z'),
  subscriptionType: { name: 'Футбол' },
  package: null,
  ...over,
});

describe('LegacyService', () => {
  let service: LegacyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.direction.findUnique.mockResolvedValue(null);
    mockPrisma.direction.create.mockResolvedValue({ id: 'd-new' });
    const module = await Test.createTestingModule({
      providers: [
        LegacyService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(LegacyService);
  });

  it('maps subscriptions to packages needing reconciliation', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([sub()]);

    const result = await service.migrate('u1');

    expect(result).toEqual({ directions: 1, packages: 1, skipped: 0 });
    expect(mockPrisma.direction.create).toHaveBeenCalledWith({
      data: { name: 'Футбол', missedRule: MissedLessonRule.no_charge },
    });
    expect(mockPrisma.package.create).toHaveBeenCalledWith({
      data: {
        childId: 'c1',
        directionId: 'd-new',
        tariffId: null,
        sessionsTotal: 8,
        usedBefore: 3,
        purchaseDate: new Date('2026-05-20T00:00:00.000Z'),
        expiresAt: null,
        legacySubscriptionId: 's1',
        needsReconciliation: true,
        createdById: 'u1',
        voidedAt: null,
        voidedById: null,
        voidReason: null,
      },
    });
  });

  it('migrates cancelled subscriptions as voided packages without reconciliation', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      sub({ status: SubscriptionStatus.cancelled }),
    ]);

    await service.migrate('u1');

    const data = (
      mockPrisma.package.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    expect(data).toMatchObject({
      needsReconciliation: false,
      voidedById: 'u1',
      voidReason: 'Скасовано до перенесення',
    });
    expect(data.voidedAt).toBeInstanceOf(Date);
  });

  it('is idempotent and reuses existing directions', async () => {
    mockPrisma.subscription.findMany.mockResolvedValue([
      sub({ package: { id: 'p-existing' } }),
      sub({ id: 's2' }),
    ]);
    mockPrisma.direction.findUnique.mockResolvedValue({ id: 'd-old' });

    const result = await service.migrate('u1');

    expect(result).toEqual({ directions: 0, packages: 1, skipped: 1 });
    expect(mockPrisma.direction.create).not.toHaveBeenCalled();
    expect(mockPrisma.package.create).toHaveBeenCalledTimes(1);
  });
});
