import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditMiddleware } from './audit.middleware';
import { AuditResponseInterceptor } from './audit-response.interceptor';
import { AuditRetentionScheduler } from './audit-retention.scheduler';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditRetentionScheduler,
    { provide: APP_INTERCEPTOR, useClass: AuditResponseInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuditMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
