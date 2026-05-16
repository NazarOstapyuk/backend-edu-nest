import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionTypesController } from './subscription-types.controller';
import { SubscriptionTypesService } from './subscription-types.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionTypesController],
  providers: [SubscriptionTypesService],
  exports: [SubscriptionTypesService],
})
export class SubscriptionTypesModule {}
