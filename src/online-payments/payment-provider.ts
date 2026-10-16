import { InvoiceStatus, PaymentProviderKind } from '@prisma/client';

export interface CreateInvoiceInput {
  amountKop: number;
  reference: string;
  destination: string;
  redirectUrl: string;
  webhookUrl: string | null;
}

export interface ProviderStatus {
  status: InvoiceStatus;
  amountKop: number | null;
  paidAt: Date | null;
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly kind: PaymentProviderKind;
  createInvoice(
    input: CreateInvoiceInput,
  ): Promise<{ invoiceId: string; pageUrl: string }>;
  getStatus(invoiceId: string): Promise<ProviderStatus>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ invoiceId: string } | null>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
