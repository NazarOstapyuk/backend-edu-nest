import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const KEEP_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuditRetentionScheduler {
  private readonly logger = new Logger(AuditRetentionScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 4 * * *', { timeZone: 'Europe/Kyiv' })
  async purge(now: Date = new Date()) {
    const before = new Date(now.getTime() - KEEP_MS);
    try {
      const [events, changes, auth] = await Promise.all([
        this.prisma.auditEvent.deleteMany({ where: { at: { lt: before } } }),
        this.prisma.auditChange.deleteMany({ where: { at: { lt: before } } }),
        this.prisma.authEvent.deleteMany({ where: { at: { lt: before } } }),
      ]);
      this.logger.log(
        `Audit purge: ${events.count} events, ${changes.count} changes, ${auth.count} logins`,
      );
    } catch (error) {
      this.logger.error(`Audit purge failed: ${String(error)}`);
    }
  }
}
