import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ActivityReportsService } from './activity-reports.service';
import { FinanceReportsService } from './finance-reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [AttendanceModule, PayrollModule],
  controllers: [ReportsController],
  providers: [FinanceReportsService, ActivityReportsService],
})
export class ReportsModule {}
