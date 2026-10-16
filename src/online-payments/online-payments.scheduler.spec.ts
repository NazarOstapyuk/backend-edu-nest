import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ONLINE_PAYMENTS_CONFIG,
  type OnlinePaymentsConfig,
} from './online-payments.config';
import { OnlinePaymentsScheduler } from './online-payments.scheduler';
import { OnlinePaymentsService } from './online-payments.service';

const setup = async (enabled: boolean) => {
  const service: jest.Mocked<
    Pick<OnlinePaymentsService, 'syncPending' | 'expireRequests'>
  > = {
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
  const module = await Test.createTestingModule({
    providers: [
      OnlinePaymentsScheduler,
      { provide: OnlinePaymentsService, useValue: service },
      { provide: ONLINE_PAYMENTS_CONFIG, useValue: config },
    ],
  }).compile();
  return { service, scheduler: module.get(OnlinePaymentsScheduler) };
};

describe('OnlinePaymentsScheduler', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does nothing when disabled', async () => {
    const { service, scheduler } = await setup(false);
    await scheduler.sync();
    await scheduler.expire();
    expect(service.syncPending).not.toHaveBeenCalled();
    expect(service.expireRequests).not.toHaveBeenCalled();
  });

  it('syncs and expires when enabled', async () => {
    const { service, scheduler } = await setup(true);
    await scheduler.sync();
    await scheduler.expire();
    expect(service.syncPending).toHaveBeenCalledTimes(1);
    expect(service.expireRequests).toHaveBeenCalledTimes(1);
  });

  it('logs errors instead of throwing', async () => {
    const { service, scheduler } = await setup(true);
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
