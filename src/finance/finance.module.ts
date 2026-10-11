import { Module } from '@nestjs/common';
import { ChargesService } from './charges.service';
import { ChildFinanceController } from './child-finance.controller';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [ChildFinanceController, FinanceController],
  providers: [FinanceService, ChargesService, PaymentsService],
})
export class FinanceModule {}
