import { Module } from '@nestjs/common';
import { BackupStorage } from './backup-storage';
import { BackupsController } from './backups.controller';
import { BackupsScheduler } from './backups.scheduler';
import { BackupsService } from './backups.service';
import { ProcessRunner } from './process-runner';

@Module({
  controllers: [BackupsController],
  providers: [BackupsService, BackupsScheduler, ProcessRunner, BackupStorage],
  exports: [BackupsService],
})
export class BackupsModule {}
