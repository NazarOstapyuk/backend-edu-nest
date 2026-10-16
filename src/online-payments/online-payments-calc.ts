import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InvoiceStatus, PaymentRequestStatus, Prisma } from '@prisma/client';

export const LINK_DAYS = 7;
export const INVOICE_TTL_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

export const toKopecks = (amount: Prisma.Decimal): number => {
  if (amount.lte(0)) {
    throw new BadRequestException('Amount must be greater than 0');
  }
  return Number(amount.mul(100).toFixed(0));
};

export const fromKopecks = (kop: number): Prisma.Decimal =>
  new Prisma.Decimal(kop).div(100);

export const payerName = (firstName: string, lastName: string): string => {
  const first = firstName.trim();
  const initial = Array.from(lastName.trim())[0];
  return initial ? `${first} ${initial}.` : first;
};

export const hashLinkKey = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

export const newLinkKey = (): { key: string; hash: string } => {
  const key = randomBytes(32).toString('base64url');
  return { key, hash: hashLinkKey(key) };
};

export const linkExpiresAt = (now: Date): Date =>
  new Date(now.getTime() + LINK_DAYS * 24 * HOUR_MS);

export type LinkState = 'open' | 'paid' | 'cancelled' | 'expired';

export const linkState = (
  request: { status: PaymentRequestStatus; expiresAt: Date | null },
  now: Date,
): LinkState => {
  if (request.status === PaymentRequestStatus.paid) return 'paid';
  if (request.status === PaymentRequestStatus.cancelled) return 'cancelled';
  if (request.status === PaymentRequestStatus.expired) return 'expired';
  if (request.expiresAt && request.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'open';
};

export const invoiceExpired = (
  invoice: { createdAt: Date },
  now: Date,
): boolean =>
  invoice.createdAt.getTime() + INVOICE_TTL_HOURS * HOUR_MS <= now.getTime();

export const isFinal = (status: InvoiceStatus): boolean =>
  status === InvoiceStatus.success ||
  status === InvoiceStatus.failure ||
  status === InvoiceStatus.expired;
