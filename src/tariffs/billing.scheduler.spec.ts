import { Logger } from '@nestjs/common';
import { BillingScheduler } from './billing.scheduler';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

describe('BillingScheduler', () => {
  let billing: { runAll: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let config: { get: jest.Mock };
  let errorSpy: jest.SpyInstance;
  let scheduler: BillingScheduler;

  beforeEach(() => {
    billing = { runAll: jest.fn() };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u-root' }) },
    };
    config = { get: jest.fn().mockReturnValue('root') };
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    scheduler = new BillingScheduler(
      billing as unknown as BillingService,
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not throw and logs when the root lookup rejects', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));

    await expect(scheduler.handleDailyBilling()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Daily billing failed: db down');
  });

  it('logs each failed enrollment', async () => {
    billing.runAll.mockResolvedValue({
      created: 1,
      skippedZero: 0,
      alreadyBilled: 0,
      problems: [],
      failed: [{ enrollmentId: 'e2', message: 'db down' }],
    });

    await scheduler.handleDailyBilling();

    expect(errorSpy).toHaveBeenCalledWith(
      'Billing failed for enrollment e2: db down',
    );
  });

  it('does not run billing when root user is missing', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await scheduler.handleDailyBilling();

    expect(billing.runAll).not.toHaveBeenCalled();
  });
});
