import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { BackupKind, BackupStatus } from '@prisma/client';
import { BackupsService } from './backups.service';

const CATCH_UP_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BackupsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackupsScheduler.name);

  constructor(
    private backups: BackupsService,
    private config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.get<string>('BACKUP_DIR')?.trim()) return;
    void this.catchUp().catch((error: unknown) =>
      this.logger.error(
        `Catch-up backup failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  private async catchUp() {
    const { lastSuccess } = await this.backups.status();
    const finishedAt = lastSuccess?.finishedAt
      ? new Date(lastSuccess.finishedAt).getTime()
      : null;
    if (finishedAt !== null && Date.now() - finishedAt < CATCH_UP_MS) return;
    const run = await this.backups.create(BackupKind.scheduled);
    if (run.status === BackupStatus.failed)
      this.logger.error(`Catch-up backup failed: ${run.error}`);
    else this.logger.log(`Catch-up backup: ${run.fileName}`);
  }

  @Cron('0 2 * * *', { timeZone: 'Europe/Kyiv' })
  async handleDailyBackup() {
    if (!this.config.get<string>('BACKUP_DIR')?.trim()) return;
    try {
      const run = await this.backups.create(BackupKind.scheduled);
      if (run.status === BackupStatus.failed)
        this.logger.error(`Daily backup failed: ${run.error}`);
      else this.logger.log(`Daily backup: ${run.fileName}`);
    } catch (error) {
      this.logger.error(
        `Daily backup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
