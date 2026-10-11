import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

@Injectable()
export class BillingScheduler {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    private billing: BillingService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Europe/Kyiv' })
  async handleDailyBilling() {
    const login = this.config.get<string>('ROOT_LOGIN');
    const root = login
      ? await this.prisma.user.findUnique({ where: { login } })
      : null;
    if (!root) {
      this.logger.error('Daily billing skipped: root user not found');
      return;
    }
    const result = await this.billing.runAll(root.id);
    this.logger.log(
      `Daily billing: created ${result.created}, zero ${result.skippedZero}, already ${result.alreadyBilled}, problems ${result.problems.length}, failed ${result.failed.length}`,
    );
  }
}
