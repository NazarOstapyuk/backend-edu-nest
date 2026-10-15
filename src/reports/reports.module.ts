import { Module } from '@nestjs/common';
import { FinanceReportsService } from './finance-reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [],
  controllers: [ReportsController],
  providers: [FinanceReportsService],
})
export class ReportsModule {}
