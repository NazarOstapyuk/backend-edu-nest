import { Module } from '@nestjs/common';
import {
  ONLINE_PAYMENTS_CONFIG,
  readOnlinePaymentsConfig,
} from './online-payments.config';
import { OnlinePaymentsScheduler } from './online-payments.scheduler';
import { OnlinePaymentsService } from './online-payments.service';
import { ParentOnlinePaymentsController } from './parent-online-payments.controller';
import { PAYMENT_PROVIDER } from './payment-provider';
import { PublicOnlinePaymentsController } from './public-online-payments.controller';
import { StaffOnlinePaymentsController } from './staff-online-payments.controller';
import { TestProvider } from './test-provider';

@Module({
  controllers: [
    ParentOnlinePaymentsController,
    StaffOnlinePaymentsController,
    PublicOnlinePaymentsController,
  ],
  providers: [
    OnlinePaymentsService,
    OnlinePaymentsScheduler,
    {
      provide: ONLINE_PAYMENTS_CONFIG,
      useFactory: () => readOnlinePaymentsConfig(process.env),
    },
    TestProvider,
    { provide: PAYMENT_PROVIDER, useExisting: TestProvider },
  ],
})
export class OnlinePaymentsModule {}
