import { Logger } from '@nestjs/common';
import type { OnlinePaymentsConfig } from './online-payments.config';
import { OnlinePaymentsScheduler } from './online-payments.scheduler';
import { OnlinePaymentsService } from './online-payments.service';

const setup = (enabled: boolean) => {
  const service = {
    syncPending: jest.fn().mockResolvedValue(0),
    expireRequests: jest.fn().mockResolvedValue(0),
  };
  const config: OnlinePaymentsConfig = {
    provider: null,
    enabled,
    webhookUrl: null,
    publicAppUrl: 'http://localhost:5173',
    institution: 'EduNest',
  };
  const scheduler = new OnlinePaymentsScheduler(
    service as unknown as OnlinePaymentsService,
    config,
  );
  return { service, scheduler };
};

describe('OnlinePaymentsScheduler', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does nothing when disabled', async () => {
    const { service, scheduler } = setup(false);
    await scheduler.sync();
    await scheduler.expire();
    expect(service.syncPending).not.toHaveBeenCalled();
    expect(service.expireRequests).not.toHaveBeenCalled();
  });

  it('syncs and expires when enabled', async () => {
    const { service, scheduler } = setup(true);
    await scheduler.sync();
    await scheduler.expire();
    expect(service.syncPending).toHaveBeenCalledTimes(1);
    expect(service.expireRequests).toHaveBeenCalledTimes(1);
  });

  it('logs errors instead of throwing', async () => {
    const { service, scheduler } = setup(true);
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service.syncPending.mockRejectedValue(new Error('boom'));
    service.expireRequests.mockRejectedValue(new Error('bang'));
    await expect(scheduler.sync()).resolves.toBeUndefined();
    await expect(scheduler.expire()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
  });
});
