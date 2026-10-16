import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ONLINE_PAYMENTS_CONFIG,
  type OnlinePaymentsConfig,
} from './online-payments.config';
import { OnlinePaymentsService } from './online-payments.service';

@Injectable()
export class OnlinePaymentsScheduler {
  private readonly logger = new Logger(OnlinePaymentsScheduler.name);

  constructor(
    private payments: OnlinePaymentsService,
    @Inject(ONLINE_PAYMENTS_CONFIG) private config: OnlinePaymentsConfig,
  ) {}

  @Cron('*/2 * * * *')
  async sync() {
    if (!this.config.enabled) return;
    try {
      await this.payments.syncPending();
    } catch (error) {
      this.logger.error(
        `Online payment sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron('30 0 * * *', { timeZone: 'Europe/Kyiv' })
  async expire() {
    if (!this.config.enabled) return;
    try {
      await this.payments.expireRequests();
    } catch (error) {
      this.logger.error(
        `Online payment expiry failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
