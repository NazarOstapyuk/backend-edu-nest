import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChildrenModule } from './children/children.module';
import { GroupsModule } from './groups/groups.module';
import { PrismaModule } from './prisma/prisma.module';
import { SeedModule } from './seed/seed.module';
import { SubscriptionTypesModule } from './subscription-types/subscription-types.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { FinanceModule } from './finance/finance.module';
import { TariffsModule } from './tariffs/tariffs.module';
import { ClassesModule } from './classes/classes.module';
import { ParentCabinetModule } from './parent-cabinet/parent-cabinet.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SeedModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    ChildrenModule,
    SubscriptionTypesModule,
    SubscriptionsModule,
    FinanceModule,
    TariffsModule,
    ClassesModule,
    ParentCabinetModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
