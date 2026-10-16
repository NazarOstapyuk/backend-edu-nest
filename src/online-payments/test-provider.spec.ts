import { InvoiceStatus, PaymentProviderKind } from '@prisma/client';
import { TestProvider } from './test-provider';
import { OnlinePaymentsConfig } from './online-payments.config';

const mockPrisma = {
  paymentInvoice: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
};

const config: OnlinePaymentsConfig = {
  provider: PaymentProviderKind.test,
  enabled: true,
  webhookUrl: null,
  publicAppUrl: 'http://localhost:5173',
  institution: 'EduNest',
};

const make = () => new TestProvider(mockPrisma as never, config);

describe('TestProvider', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  it('creates an invoice with a test page url', async () => {
    const result = await make().createInvoice({
      amountKop: 100,
      reference: 'r',
      destination: 'd',
      redirectUrl: 'http://localhost:5173/family/c1?invoice=r',
      webhookUrl: null,
    });
    expect(result.invoiceId).toMatch(/^test_[0-9a-f-]{36}$/);
    expect(result.pageUrl).toBe(
      `http://localhost:5173/pay/test/${result.invoiceId}?return=http%3A%2F%2Flocalhost%3A5173%2Ffamily%2Fc1%3Finvoice%3Dr`,
    );
  });

  it('reports success for the success marker', async () => {
    const checkedAt = new Date('2026-10-16T10:00:00.000Z');
    mockPrisma.paymentInvoice.findUnique.mockResolvedValue({
      amountKop: 5000,
      failureReason: 'test:success',
      checkedAt,
    });
    await expect(make().getStatus('test_1')).resolves.toEqual({
      status: InvoiceStatus.success,
      amountKop: 5000,
      paidAt: checkedAt,
      failureReason: null,
    });
    expect(mockPrisma.paymentInvoice.findUnique).toHaveBeenCalledWith({
      where: { invoiceId: 'test_1' },
    });
  });

  it('reports failure for the failure marker', async () => {
    mockPrisma.paymentInvoice.findUnique.mockResolvedValue({
      amountKop: 5000,
      failureReason: 'test:failure',
      checkedAt: new Date(),
    });
    const status = await make().getStatus('test_1');
    expect(status.status).toBe(InvoiceStatus.failure);
    expect(status.failureReason).toBe('Відхилено в тестовому банку');
  });

  it('reports pending without a marker or row', async () => {
    mockPrisma.paymentInvoice.findUnique.mockResolvedValue({
      amountKop: 5000,
      failureReason: null,
      checkedAt: null,
    });
    expect((await make().getStatus('test_1')).status).toBe(
      InvoiceStatus.pending,
    );
    mockPrisma.paymentInvoice.findUnique.mockResolvedValue(null);
    expect((await make().getStatus('test_2')).status).toBe(
      InvoiceStatus.pending,
    );
  });

  it('stores the marker only on pending invoices', async () => {
    const now = new Date('2026-10-16T10:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    mockPrisma.paymentInvoice.updateMany.mockResolvedValue({ count: 1 });
    await make().setResult('test_1', 'success');
    expect(mockPrisma.paymentInvoice.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: 'test_1', status: InvoiceStatus.pending },
      data: { failureReason: 'test:success', checkedAt: now },
    });
  });

  it('has no webhooks', async () => {
    await expect(
      make().verifyWebhook(Buffer.from('{}'), {}),
    ).resolves.toBeNull();
  });
});
