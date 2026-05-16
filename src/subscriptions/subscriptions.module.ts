import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AttendancesController } from './attendances.controller';
import { AttendancesService } from './attendances.service';
import { ChildSubscriptionsController } from './child-subscriptions.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionsController, AttendancesController, ChildSubscriptionsController],
  providers: [SubscriptionsService, AttendancesService],
})
export class SubscriptionsModule {}
