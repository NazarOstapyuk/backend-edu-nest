import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, PaymentRequestStatus, Prisma } from '@prisma/client';
import {
  fromKopecks,
  hashLinkKey,
  invoiceExpired,
  isFinal,
  linkExpiresAt,
  linkState,
  newLinkKey,
  payerName,
  toKopecks,
} from './online-payments-calc';

const D = (v: string) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;

describe('kopecks', () => {
  it('converts decimals to kopecks', () => {
    expect(toKopecks(D('1250.50'))).toBe(125050);
    expect(toKopecks(D('0.10'))).toBe(10);
    expect(toKopecks(D('19.99'))).toBe(1999);
  });

  it('converts kopecks to decimals', () => {
    expect(fromKopecks(125050).toFixed(2)).toBe('1250.50');
    expect(fromKopecks(1).toFixed(2)).toBe('0.01');
  });

  it('throws on zero or negative amounts', () => {
    expect(() => toKopecks(D('0.00'))).toThrow(BadRequestException);
    expect(() => toKopecks(D('0.00'))).toThrow('Amount must be greater than 0');
    expect(() => toKopecks(D('-1'))).toThrow(BadRequestException);
  });
});

describe('payerName', () => {
  it('uses first name and last name initial', () => {
    expect(payerName('Олена', 'Іваненко')).toBe('Олена І.');
  });

  it('trims and handles empty last name', () => {
    expect(payerName('  Олена ', '  Іваненко ')).toBe('Олена І.');
    expect(payerName('Олена', '')).toBe('Олена');
    expect(payerName('Олена', '   ')).toBe('Олена');
  });
});

describe('link keys', () => {
  it('generates a 43 char key with a matching hash', () => {
    const { key, hash } = newLinkKey();
    expect(key).toHaveLength(43);
    expect(hash).toBe(hashLinkKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(newLinkKey().key).not.toBe(key);
  });

  it('hashes deterministically', () => {
    expect(hashLinkKey('abc')).toBe(hashLinkKey('abc'));
    expect(hashLinkKey('abc')).not.toBe(hashLinkKey('abd'));
  });
});

describe('expiry', () => {
  const now = new Date('2026-10-16T10:00:00.000Z');

  it('link expires in exactly 7 days', () => {
    expect(linkExpiresAt(now).getTime() - now.getTime()).toBe(7 * DAY);
  });

  it('maps link state', () => {
    const past = new Date(now.getTime() - 1);
    const future = new Date(now.getTime() + 1);
    const state = (status: PaymentRequestStatus, expiresAt: Date | null) =>
      linkState({ status, expiresAt }, now);
    expect(state(PaymentRequestStatus.paid, past)).toBe('paid');
    expect(state(PaymentRequestStatus.cancelled, past)).toBe('cancelled');
    expect(state(PaymentRequestStatus.expired, future)).toBe('expired');
    expect(state(PaymentRequestStatus.open, future)).toBe('open');
    expect(state(PaymentRequestStatus.open, now)).toBe('expired');
    expect(state(PaymentRequestStatus.open, past)).toBe('expired');
    expect(state(PaymentRequestStatus.open, null)).toBe('open');
  });

  it('invoice expires at 24 hours', () => {
    const created = new Date('2026-10-15T10:00:00.000Z');
    expect(
      invoiceExpired({ createdAt: created }, new Date(now.getTime() - 1)),
    ).toBe(false);
    expect(invoiceExpired({ createdAt: created }, now)).toBe(true);
  });
});

describe('isFinal', () => {
  it('is true for success, failure and expired only', () => {
    expect(isFinal(InvoiceStatus.success)).toBe(true);
    expect(isFinal(InvoiceStatus.failure)).toBe(true);
    expect(isFinal(InvoiceStatus.expired)).toBe(true);
    expect(isFinal(InvoiceStatus.pending)).toBe(false);
  });
});
