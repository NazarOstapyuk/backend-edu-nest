import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { TestResultDto } from './dto/online-payment.dto';
import { OnlinePaymentsService } from './online-payments.service';

@Controller()
export class PublicOnlinePaymentsController {
  constructor(private payments: OnlinePaymentsService) {}

  @Get('online-payments/config')
  config() {
    return this.payments.config();
  }

  @Get('pay/:token')
  link(@Param('token') token: string) {
    return this.payments.publicLink(token);
  }

  @Post('pay/:token/invoice')
  payLink(@Param('token') token: string) {
    return this.payments.payLink(token);
  }

  @Post('online-payments/webhook/:provider')
  @HttpCode(200)
  async webhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    await this.payments.handleWebhook(
      provider,
      req.rawBody ?? Buffer.alloc(0),
      req.headers,
    );
    return { ok: true };
  }

  @Post('online-payments/test/:invoiceId')
  @HttpCode(200)
  testResult(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: TestResultDto,
  ) {
    return this.payments.testResult(invoiceId, dto.result);
  }
}
