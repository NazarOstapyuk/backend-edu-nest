import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InvoiceStatus, PaymentProviderKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ONLINE_PAYMENTS_CONFIG,
  type OnlinePaymentsConfig,
} from './online-payments.config';
import type {
  CreateInvoiceInput,
  PaymentProvider,
  ProviderStatus,
} from './payment-provider';

const SUCCESS_MARKER = 'test:success';
const FAILURE_MARKER = 'test:failure';

@Injectable()
export class TestProvider implements PaymentProvider {
  readonly kind = PaymentProviderKind.test;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ONLINE_PAYMENTS_CONFIG)
    private readonly config: OnlinePaymentsConfig,
  ) {}

  createInvoice(
    input: CreateInvoiceInput,
  ): Promise<{ invoiceId: string; pageUrl: string }> {
    const invoiceId = `test_${randomUUID()}`;
    return Promise.resolve({
      invoiceId,
      pageUrl: `${this.config.publicAppUrl}/pay/test/${invoiceId}?return=${encodeURIComponent(input.redirectUrl)}`,
    });
  }

  async getStatus(invoiceId: string): Promise<ProviderStatus> {
    const row = await this.prisma.paymentInvoice.findUnique({
      where: { invoiceId },
    });
    if (row?.failureReason === SUCCESS_MARKER) {
      return {
        status: InvoiceStatus.success,
        amountKop: row.amountKop,
        paidAt: row.checkedAt ?? new Date(),
        failureReason: null,
      };
    }
    if (row?.failureReason === FAILURE_MARKER) {
      return {
        status: InvoiceStatus.failure,
        amountKop: row.amountKop,
        paidAt: null,
        failureReason: 'Відхилено в тестовому банку',
      };
    }
    return {
      status: InvoiceStatus.pending,
      amountKop: row?.amountKop ?? null,
      paidAt: null,
      failureReason: null,
    };
  }

  verifyWebhook(): Promise<{ invoiceId: string } | null> {
    return Promise.resolve(null);
  }

  async setResult(
    invoiceId: string,
    result: 'success' | 'failure',
  ): Promise<void> {
    await this.prisma.paymentInvoice.updateMany({
      where: { invoiceId, status: InvoiceStatus.pending },
      data: {
        failureReason: result === 'success' ? SUCCESS_MARKER : FAILURE_MARKER,
        checkedAt: new Date(),
      },
    });
  }
}
