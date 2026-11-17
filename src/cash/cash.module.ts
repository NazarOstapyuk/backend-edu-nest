import { Module } from '@nestjs/common';
import { CashAlertsService } from './cash-alerts.service';
import { CashDesksService } from './cash-desks.service';
import { CashShiftsService } from './cash-shifts.service';
import { CashController } from './cash.controller';

@Module({
  controllers: [CashController],
  providers: [CashDesksService, CashShiftsService, CashAlertsService],
  exports: [CashShiftsService, CashAlertsService],
})
export class CashModule {}
