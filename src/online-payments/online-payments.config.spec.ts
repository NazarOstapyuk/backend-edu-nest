import { PaymentProviderKind } from '@prisma/client';
import { readOnlinePaymentsConfig } from './online-payments.config';

describe('readOnlinePaymentsConfig', () => {
  it('enables the test provider', () => {
    expect(readOnlinePaymentsConfig({ PAYMENT_PROVIDER: ' test ' })).toEqual({
      provider: PaymentProviderKind.test,
      enabled: true,
      webhookUrl: null,
      publicAppUrl: 'http://localhost:5173',
      institution: 'EduNest',
    });
  });

  it('accepts monobank but keeps it disabled', () => {
    const config = readOnlinePaymentsConfig({ PAYMENT_PROVIDER: 'monobank' });
    expect(config.provider).toBe(PaymentProviderKind.monobank);
    expect(config.enabled).toBe(false);
  });

  it('ignores the test provider in production', () => {
    const config = readOnlinePaymentsConfig({
      PAYMENT_PROVIDER: 'test',
      NODE_ENV: 'production',
    });
    expect(config.provider).toBeNull();
    expect(config.enabled).toBe(false);
    expect(
      readOnlinePaymentsConfig({
        PAYMENT_PROVIDER: 'test',
        NODE_ENV: 'development',
      }).enabled,
    ).toBe(true);
  });

  it('disables empty or unknown providers', () => {
    for (const value of [undefined, '', '  ', 'liqpay']) {
      const config = readOnlinePaymentsConfig({ PAYMENT_PROVIDER: value });
      expect(config.provider).toBeNull();
      expect(config.enabled).toBe(false);
    }
  });

  it('reads urls and institution, stripping trailing slashes', () => {
    const config = readOnlinePaymentsConfig({
      PAYMENT_PROVIDER: 'test',
      PAYMENT_WEBHOOK_URL: 'https://api.example.com/hook/',
      PUBLIC_APP_URL: 'https://app.example.com/',
      INSTITUTION_NAME: 'My School',
    });
    expect(config.webhookUrl).toBe('https://api.example.com/hook');
    expect(config.publicAppUrl).toBe('https://app.example.com');
    expect(config.institution).toBe('My School');
    expect(
      readOnlinePaymentsConfig({ PAYMENT_WEBHOOK_URL: '  ' }).webhookUrl,
    ).toBeNull();
  });
});
