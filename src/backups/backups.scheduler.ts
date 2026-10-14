import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { BackupKind, BackupStatus } from '@prisma/client';
import { BackupsService } from './backups.service';

@Injectable()
export class BackupsScheduler {
  private readonly logger = new Logger(BackupsScheduler.name);

  constructor(
    private backups: BackupsService,
    private config: ConfigService,
  ) {}

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
