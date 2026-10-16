import { PaymentProviderKind } from '@prisma/client';

export interface OnlinePaymentsConfig {
  provider: PaymentProviderKind | null;
  enabled: boolean;
  webhookUrl: string | null;
  publicAppUrl: string;
  institution: string;
}

export const ONLINE_PAYMENTS_CONFIG = Symbol('ONLINE_PAYMENTS_CONFIG');

const stripSlash = (value: string): string => value.replace(/\/+$/, '');

export const readOnlinePaymentsConfig = (
  env: Record<string, string | undefined>,
): OnlinePaymentsConfig => {
  const raw = (env.PAYMENT_PROVIDER ?? '').trim();
  const provider =
    raw === 'test'
      ? PaymentProviderKind.test
      : raw === 'monobank'
        ? PaymentProviderKind.monobank
        : null;
  const webhook = (env.PAYMENT_WEBHOOK_URL ?? '').trim();
  const appUrl = (env.PUBLIC_APP_URL ?? '').trim();
  const institution = (env.INSTITUTION_NAME ?? '').trim();
  return {
    provider,
    enabled: provider === PaymentProviderKind.test,
    webhookUrl: webhook ? stripSlash(webhook) : null,
    publicAppUrl: stripSlash(appUrl || 'http://localhost:5173'),
    institution: institution || 'EduNest',
  };
};
