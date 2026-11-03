import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { BackupsModule } from '../backups/backups.module';
import { DailyNotesModule } from '../daily-notes/daily-notes.module';
import { OnlinePaymentsModule } from '../online-payments/online-payments.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    AttendanceModule,
    BackupsModule,
    DailyNotesModule,
    OnlinePaymentsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
