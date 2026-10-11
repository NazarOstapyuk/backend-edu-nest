import { Module } from '@nestjs/common';
import { AdaptationController } from './adaptation.controller';
import { AdaptationService } from './adaptation.service';
import { BillingController } from './billing.controller';
import { BillingScheduler } from './billing.scheduler';
import { BillingService } from './billing.service';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { TariffsController } from './tariffs.controller';
import { TariffsService } from './tariffs.service';

@Module({
  controllers: [
    TariffsController,
    EnrollmentsController,
    BillingController,
    AdaptationController,
  ],
  providers: [
    TariffsService,
    EnrollmentsService,
    BillingService,
    AdaptationService,
    BillingScheduler,
  ],
})
export class TariffsModule {}
