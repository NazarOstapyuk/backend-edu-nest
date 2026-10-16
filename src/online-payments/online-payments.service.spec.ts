import {
  BadGatewayException,
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  FinanceCategory,
  InvoiceStatus,
  PaymentMethod,
  PaymentProviderKind,
  PaymentRequestSource,
  PaymentRequestStatus,
  PaymentStatus,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { hashLinkKey } from './online-payments-calc';
import {
  ONLINE_PAYMENTS_CONFIG,
  type OnlinePaymentsConfig,
} from './online-payments.config';
import { OnlinePaymentsService } from './online-payments.service';
import {
  type CreateInvoiceInput,
  PAYMENT_PROVIDER,
  type ProviderStatus,
} from './payment-provider';
import { TestProvider } from './test-provider';

const d = (value: string) => new Prisma.Decimal(value);
const HOUR = 60 * 60 * 1000;

const mockPrisma = {
  child: { findFirst: jest.fn(), findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  paymentRequest: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  paymentInvoice: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  payment: { create: jest.fn(), findUnique: jest.fn() },
  charge: { findMany: jest.fn() },
  allocation: { findMany: jest.fn(), create: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockProvider = {
  kind: PaymentProviderKind.test,
  createInvoice: jest.fn(),
  getStatus: jest.fn(),
  verifyWebhook: jest.fn(),
};

const mockTestProvider = { setResult: jest.fn() };

const mockConfigService = { get: jest.fn() };

const enabledConfig: OnlinePaymentsConfig = {
  provider: PaymentProviderKind.test,
  enabled: true,
  webhookUrl: null,
  publicAppUrl: 'http://app.test',
  institution: 'EduNest',
};

const admin: AuthenticatedUser = {
  id: 'admin-1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: { finance: PermissionLevel.edit },
};

const request = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  childId: 'child-1',
  category: FinanceCategory.meals,
  amount: d('500.00'),
  source: PaymentRequestSource.link,
  status: PaymentRequestStatus.open,
  linkTokenHash: 'hash',
  comment: null,
  expiresAt: new Date(Date.now() + 24 * HOUR),
  createdById: 'admin-1',
  createdAt: new Date('2026-10-16T08:00:00.000Z'),
  paidAt: null,
  cancelledAt: null,
  cancelledById: null,
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'row-1',
  requestId: 'req-1',
  provider: PaymentProviderKind.test,
  invoiceId: 'inv-1',
  pageUrl: 'http://pay/inv-1',
  amountKop: 50000,
  status: InvoiceStatus.pending,
  failureReason: null,
  paidAt: null,
  checkedAt: null,
  paymentId: null,
  createdAt: new Date(),
  request: request(),
  ...over,
});

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  childId: 'child-1',
  category: FinanceCategory.meals,
  amount: d('200.00'),
  description: 'Meals',
  periodStart: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  voidedAt: null,
  allocations: [],
  ...over,
});

const success = (over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  status: InvoiceStatus.success,
  amountKop: 50000,
  paidAt: new Date('2026-10-16T09:00:00.000Z'),
  failureReason: null,
  ...over,
});

type Data = Record<string, unknown>;

const arg = <T>(fn: jest.Mock, call = 0): T => (fn.mock.calls[call] as [T])[0];
const dataOf = (fn: jest.Mock, call = 0): Data =>
  arg<{ data: Data }>(fn, call).data;
const sqlOf = (fn: jest.Mock, call = 0): string =>
  (fn.mock.calls[call] as [string[]])[0].join('?');

const anyDate: unknown = expect.any(Date);
const anyDecimal: unknown = expect.any(Prisma.Decimal);
const anyString: unknown = expect.any(String);
const uuidLike: unknown = expect.stringMatching(/^[0-9a-f-]{36}$/);

async function make(
  config: OnlinePaymentsConfig = enabledConfig,
): Promise<OnlinePaymentsService> {
  const module = await Test.createTestingModule({
    providers: [
      OnlinePaymentsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: PAYMENT_PROVIDER, useValue: mockProvider },
      { provide: ONLINE_PAYMENTS_CONFIG, useValue: config },
      { provide: ConfigService, useValue: mockConfigService },
      { provide: TestProvider, useValue: mockTestProvider },
    ],
  }).compile();
  return module.get(OnlinePaymentsService);
}

describe('OnlinePaymentsService', () => {
  let service: OnlinePaymentsService;
  let errorLog: jest.SpyInstance;

  afterEach(() => errorLog.mockRestore());

  beforeEach(async () => {
    jest.clearAllMocks();
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'ROOT_LOGIN' ? 'root' : undefined,
    );
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'root-id' });
    mockPrisma.payment.create.mockImplementation(({ data }: { data: Data }) =>
      Promise.resolve({ id: 'pay-1', voidedAt: null, ...data }),
    );
    mockPrisma.payment.findUnique.mockImplementation(() =>
      Promise.resolve({
        id: 'pay-1',
        childId: 'child-1',
        amount: d('500.00'),
        category: FinanceCategory.meals,
        status: PaymentStatus.confirmed,
        voidedAt: null,
      }),
    );
    mockPrisma.allocation.findMany.mockResolvedValue([]);
    mockPrisma.allocation.create.mockImplementation(
      ({ data }: { data: { chargeId: string } }) =>
        Promise.resolve({ id: `a-${data.chargeId}`, ...data }),
    );
    mockPrisma.charge.findMany.mockResolvedValue([]);
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'child-1' });
    mockPrisma.child.findUnique.mockResolvedValue({
      id: 'child-1',
      firstName: 'Олена',
      lastName: 'Іваненко',
    });
    mockProvider.createInvoice.mockResolvedValue({
      invoiceId: 'inv-new',
      pageUrl: 'http://pay/inv-new',
    });
    mockPrisma.paymentRequest.create.mockImplementation(
      ({ data }: { data: Data }) =>
        Promise.resolve({ ...request(), id: 'req-new', ...data }),
    );
    mockPrisma.paymentInvoice.create.mockImplementation(
      ({ data }: { data: Data }) => Promise.resolve(data),
    );
    service = await make();
  });

  describe('applyInvoiceStatus', () => {
    it('locks the invoice first and creates one confirmed payment', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());

      await service.applyInvoiceStatus('inv-1', success());

      expect(sqlOf(mockPrisma.$queryRaw)).toBe(
        'SELECT id FROM "PaymentInvoice" WHERE "invoiceId" = ? FOR UPDATE',
      );
      expect((mockPrisma.$queryRaw.mock.calls[0] as unknown[])[1]).toBe(
        'inv-1',
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.paymentInvoice.findUnique.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.paymentInvoice.findUnique).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-1' },
        include: { request: true },
      });
      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
      const data = dataOf(mockPrisma.payment.create);
      expect(data).toEqual({
        childId: 'child-1',
        amount: anyDecimal,
        category: FinanceCategory.meals,
        method: PaymentMethod.online,
        status: PaymentStatus.confirmed,
        reference: 'inv-1',
        externalId: 'inv-1',
        receivedAt: new Date('2026-10-16T09:00:00.000Z'),
        createdById: null,
        note: 'Онлайн-оплата',
      });
      expect((data.amount as Prisma.Decimal).toFixed(2)).toBe('500.00');
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          status: InvoiceStatus.success,
          paidAt: new Date('2026-10-16T09:00:00.000Z'),
          checkedAt: anyDate,
          paymentId: 'pay-1',
          failureReason: null,
        },
      });
      expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: PaymentRequestStatus.paid,
          paidAt: new Date('2026-10-16T09:00:00.000Z'),
        },
      });
    });

    it('uses now as receivedAt when the provider gives no paidAt', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      const before = Date.now();
      await service.applyInvoiceStatus('inv-1', success({ paidAt: null }));
      const receivedAt = dataOf(mockPrisma.payment.create).receivedAt as Date;
      expect(receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('does nothing for a second success after the invoice became success', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(
        invoice({ status: InvoiceStatus.success, paymentId: 'pay-1' }),
      );

      await service.applyInvoiceStatus('inv-1', success());

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.allocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
    });

    it('applies the same success twice in sequence only once', async () => {
      const row = invoice();
      mockPrisma.paymentInvoice.findUnique.mockImplementation(() =>
        Promise.resolve({ ...row }),
      );
      mockPrisma.paymentInvoice.update.mockImplementation(
        ({ data }: { data: Data }) => {
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      );

      await service.applyInvoiceStatus('inv-1', success());
      await service.applyInvoiceStatus('inv-1', success());

      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledTimes(1);
    });

    it('ignores unknown invoices', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(null);
      await service.applyInvoiceStatus('nope', success());
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.update).not.toHaveBeenCalled();
    });

    it('locks the invoice, then the child, then its charges before reading charges', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      mockPrisma.charge.findMany.mockResolvedValue([charge()]);

      await service.applyInvoiceStatus('inv-1', success());

      expect([0, 1, 2].map((i) => sqlOf(mockPrisma.$queryRaw, i))).toEqual([
        'SELECT id FROM "PaymentInvoice" WHERE "invoiceId" = ? FOR UPDATE',
        'SELECT id FROM "Child" WHERE id = ? FOR UPDATE',
        'SELECT id FROM "Charge" WHERE "childId" = ? ORDER BY id FOR UPDATE',
      ]);
      expect((mockPrisma.$queryRaw.mock.calls[1] as unknown[])[1]).toBe(
        'child-1',
      );
      expect((mockPrisma.$queryRaw.mock.calls[2] as unknown[])[1]).toBe(
        'child-1',
      );
      const [invoiceLock, childLock, chargeLock] =
        mockPrisma.$queryRaw.mock.invocationCallOrder;
      const [paymentInsert] =
        mockPrisma.payment.create.mock.invocationCallOrder;
      const [chargeRead] = mockPrisma.charge.findMany.mock.invocationCallOrder;
      expect(invoiceLock).toBeLessThan(childLock);
      expect(childLock).toBeLessThan(paymentInsert);
      expect(paymentInsert).toBeLessThan(chargeLock);
      expect(chargeLock).toBeLessThan(chargeRead);
    });

    it('allocates 500.00 over meals charges of 200.00 and 100.00, leaving a prepayment', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      mockPrisma.charge.findMany.mockResolvedValue([
        charge({ id: 'c1', amount: d('200.00') }),
        charge({
          id: 'c2',
          amount: d('100.00'),
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
      ]);

      await service.applyInvoiceStatus('inv-1', success());

      expect(arg<unknown>(mockPrisma.charge.findMany)).toEqual({
        where: {
          childId: 'child-1',
          category: FinanceCategory.meals,
          voidedAt: null,
        },
        include: { allocations: { where: { voidedAt: null } } },
      });
      expect(mockPrisma.allocation.create).toHaveBeenCalledTimes(2);
      expect(dataOf(mockPrisma.allocation.create)).toEqual({
        paymentId: 'pay-1',
        chargeId: 'c1',
        amount: '200.00',
        createdById: 'root-id',
      });
      expect(dataOf(mockPrisma.allocation.create, 1)).toEqual({
        paymentId: 'pay-1',
        chargeId: 'c2',
        amount: '100.00',
        createdById: 'root-id',
      });
      expect(mockConfigService.get).toHaveBeenCalledWith('ROOT_LOGIN');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { login: 'root' },
        select: { id: true },
      });
    });

    it('allocates only the remaining part of a partly paid charge', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(
        invoice({ amountKop: 10000 }),
      );
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        childId: 'child-1',
        amount: d('100.00'),
        category: FinanceCategory.meals,
        status: PaymentStatus.confirmed,
        voidedAt: null,
      });
      mockPrisma.charge.findMany.mockResolvedValue([
        charge({
          id: 'c1',
          amount: d('200.00'),
          allocations: [{ amount: d('150.00'), voidedAt: null }],
        }),
        charge({
          id: 'c2',
          amount: d('100.00'),
          createdAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
      ]);

      await service.applyInvoiceStatus('inv-1', success({ amountKop: 10000 }));

      expect(
        [0, 1].map((i) => {
          const data = dataOf(mockPrisma.allocation.create, i);
          return [data.chargeId, data.amount];
        }),
      ).toEqual([
        ['c1', '50.00'],
        ['c2', '50.00'],
      ]);
    });

    it('creates the payment without allocations when no charges are open', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      await service.applyInvoiceStatus('inv-1', success());
      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.allocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledTimes(1);
    });

    it('throws when the root user is missing and allocations are needed', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      mockPrisma.charge.findMany.mockResolvedValue([charge()]);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.applyInvoiceStatus('inv-1', success()),
      ).rejects.toThrow('Root user not found');
      expect(mockPrisma.paymentInvoice.update).not.toHaveBeenCalled();
    });

    it('marks the request paid even when it was cancelled meanwhile', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(
        invoice({
          request: request({ status: PaymentRequestStatus.cancelled }),
        }),
      );
      await service.applyInvoiceStatus('inv-1', success());
      expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: PaymentRequestStatus.paid, paidAt: anyDate },
      });
    });

    it('credits nothing on an amount mismatch', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());

      await service.applyInvoiceStatus('inv-1', success({ amountKop: 49999 }));

      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.allocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          status: InvoiceStatus.failure,
          failureReason: 'amount mismatch',
          checkedAt: anyDate,
        },
      });
    });

    it('treats a missing provider amount as a mismatch', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      await service.applyInvoiceStatus('inv-1', success({ amountKop: null }));
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(dataOf(mockPrisma.paymentInvoice.update).failureReason).toBe(
        'amount mismatch',
      );
    });

    it('records a failure and keeps the request open', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());

      await service.applyInvoiceStatus('inv-1', {
        status: InvoiceStatus.failure,
        amountKop: 50000,
        paidAt: null,
        failureReason: 'declined',
      });

      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          status: InvoiceStatus.failure,
          failureReason: 'declined',
          checkedAt: anyDate,
        },
      });
      expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentRequest.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('records expiry without a reason', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      await service.applyInvoiceStatus('inv-1', {
        status: InvoiceStatus.expired,
        amountKop: null,
        paidAt: null,
        failureReason: 'ignored',
      });
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: {
          status: InvoiceStatus.expired,
          failureReason: null,
          checkedAt: anyDate,
        },
      });
    });

    it('only touches checkedAt for pending', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      await service.applyInvoiceStatus('inv-1', {
        status: InvoiceStatus.pending,
        amountKop: null,
        paidAt: null,
        failureReason: null,
      });
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { checkedAt: anyDate },
      });
    });

    it('credits a late success on a locally expired invoice once', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const row = invoice({ status: InvoiceStatus.expired });
      mockPrisma.paymentInvoice.findUnique.mockImplementation(() =>
        Promise.resolve({ ...row }),
      );
      mockPrisma.paymentInvoice.update.mockImplementation(
        ({ data }: { data: Data }) => {
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      );

      await service.applyInvoiceStatus('inv-1', success());
      await service.applyInvoiceStatus('inv-1', success());

      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledTimes(1);
      expect(dataOf(mockPrisma.paymentInvoice.update)).toEqual({
        status: InvoiceStatus.success,
        paidAt: new Date('2026-10-16T09:00:00.000Z'),
        checkedAt: anyDate,
        paymentId: 'pay-1',
        failureReason: null,
      });
      expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: {
          status: PaymentRequestStatus.paid,
          paidAt: new Date('2026-10-16T09:00:00.000Z'),
        },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('inv-1');
      warn.mockRestore();
    });

    it('credits a late success on a declined invoice, keeping the lock order', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(
        invoice({
          status: InvoiceStatus.failure,
          failureReason: 'Відхилено в тестовому банку',
        }),
      );
      mockPrisma.charge.findMany.mockResolvedValue([charge()]);

      await service.applyInvoiceStatus('inv-1', success());

      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.allocation.create).toHaveBeenCalledTimes(1);
      expect(dataOf(mockPrisma.paymentInvoice.update).status).toBe(
        InvoiceStatus.success,
      );
      const sql = [0, 1, 2].map((call) => sqlOf(mockPrisma.$queryRaw, call));
      expect(sql[0]).toContain('"PaymentInvoice"');
      expect(sql[1]).toContain('"Child"');
      expect(sql[2]).toContain('"Charge"');
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        mockPrisma.payment.create.mock.invocationCallOrder[0],
      );
      expect(
        mockPrisma.payment.create.mock.invocationCallOrder[0],
      ).toBeLessThan(mockPrisma.$queryRaw.mock.invocationCallOrder[2]);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
        mockPrisma.charge.findMany.mock.invocationCallOrder[0],
      );
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('keeps an amount mismatch failure when a success arrives later', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(
        invoice({
          status: InvoiceStatus.failure,
          failureReason: 'amount mismatch',
        }),
      );
      await service.applyInvoiceStatus('inv-1', success());
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
    });

    it('ignores a non-success status on a final invoice', async () => {
      for (const stored of [
        invoice({ status: InvoiceStatus.expired }),
        invoice({ status: InvoiceStatus.failure, failureReason: 'declined' }),
        invoice({ status: InvoiceStatus.success, paymentId: 'pay-1' }),
      ]) {
        mockPrisma.paymentInvoice.findUnique.mockResolvedValue(stored);
        for (const next of [
          InvoiceStatus.pending,
          InvoiceStatus.failure,
          InvoiceStatus.expired,
        ]) {
          await service.applyInvoiceStatus('inv-1', {
            status: next,
            amountKop: 50000,
            paidAt: null,
            failureReason: 'other',
          });
        }
      }
      expect(mockPrisma.paymentInvoice.update).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('payFromCabinet', () => {
    it('creates the provider invoice first, then the request and the row', async () => {
      const result = await service.payFromCabinet('parent-1', 'child-1', {
        category: FinanceCategory.meals,
        amount: '250.50',
      });

      expect(result).toEqual({ pageUrl: 'http://pay/inv-new' });
      expect(mockPrisma.child.findFirst).toHaveBeenCalledWith({
        where: { id: 'child-1', parents: { some: { id: 'parent-1' } } },
        select: { id: true },
      });
      const input = arg<CreateInvoiceInput>(mockProvider.createInvoice);
      expect(input).toEqual({
        amountKop: 25050,
        reference: uuidLike,
        destination: 'Харчування — Олена І.',
        redirectUrl: `http://app.test/family/child-1?invoice=${input.reference}`,
        webhookUrl: null,
      });
      expect(
        mockProvider.createInvoice.mock.invocationCallOrder[0],
      ).toBeLessThan(mockPrisma.$transaction.mock.invocationCallOrder[0]);
      const requestData = dataOf(mockPrisma.paymentRequest.create);
      expect(requestData).toEqual({
        childId: 'child-1',
        category: FinanceCategory.meals,
        amount: anyDecimal,
        source: PaymentRequestSource.cabinet,
        createdById: 'parent-1',
      });
      expect((requestData.amount as Prisma.Decimal).toFixed(2)).toBe('250.50');
      expect(mockPrisma.paymentInvoice.create).toHaveBeenCalledWith({
        data: {
          id: input.reference,
          requestId: 'req-new',
          provider: PaymentProviderKind.test,
          invoiceId: 'inv-new',
          pageUrl: 'http://pay/inv-new',
          amountKop: 25050,
        },
      });
    });

    it('passes the webhook url when configured', async () => {
      service = await make({
        ...enabledConfig,
        webhookUrl: 'https://api.test',
      });
      await service.payFromCabinet('parent-1', 'child-1', {
        category: FinanceCategory.tuition,
        amount: '10.00',
      });
      const input = arg<CreateInvoiceInput>(mockProvider.createInvoice);
      expect(input.webhookUrl).toBe(
        'https://api.test/online-payments/webhook/test',
      );
      expect(input.destination).toBe('Навчання — Олена І.');
    });

    it('answers 502 and writes nothing when the provider throws', async () => {
      mockProvider.createInvoice.mockRejectedValue(new Error('down'));

      const call = service.payFromCabinet('parent-1', 'child-1', {
        category: FinanceCategory.meals,
        amount: '100.00',
      });
      await expect(call).rejects.toThrow(BadGatewayException);
      await expect(call).rejects.toThrow('Payment provider error');
      expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects another family child', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.payFromCabinet('parent-2', 'child-1', {
          category: FinanceCategory.meals,
          amount: '100.00',
        }),
      ).rejects.toThrow('Child not found');
      expect(mockProvider.createInvoice).not.toHaveBeenCalled();
    });

    it('rejects a zero amount', async () => {
      await expect(
        service.payFromCabinet('parent-1', 'child-1', {
          category: FinanceCategory.meals,
          amount: '0.00',
        }),
      ).rejects.toThrow('Amount must be greater than 0');
      expect(mockProvider.createInvoice).not.toHaveBeenCalled();
    });

    it('rejects amounts outside 1.00 to 1000000.00', async () => {
      for (const amount of ['0.99', '1000000.01']) {
        await expect(
          service.payFromCabinet('parent-1', 'child-1', {
            category: FinanceCategory.meals,
            amount,
          }),
        ).rejects.toThrow(new BadRequestException('Amount is out of range'));
      }
      expect(mockProvider.createInvoice).not.toHaveBeenCalled();
      expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
    });

    it('accepts the range bounds 1.00 and 1000000.00', async () => {
      for (const amount of ['1.00', '1000000.00']) {
        await service.payFromCabinet('parent-1', 'child-1', {
          category: FinanceCategory.meals,
          amount,
        });
      }
      expect(
        arg<CreateInvoiceInput>(mockProvider.createInvoice, 0).amountKop,
      ).toBe(100);
      expect(
        arg<CreateInvoiceInput>(mockProvider.createInvoice, 1).amountKop,
      ).toBe(100000000);
    });
  });

  describe('parentInvoice', () => {
    it('answers 404 for another family invoice', async () => {
      mockPrisma.paymentInvoice.findFirst.mockResolvedValue(null);
      await expect(service.parentInvoice('parent-2', 'row-1')).rejects.toThrow(
        new NotFoundException('Invoice not found'),
      );
      expect(mockPrisma.paymentInvoice.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'row-1',
          request: { child: { parents: { some: { id: 'parent-2' } } } },
        },
        include: { request: true },
      });
      expect(mockProvider.getStatus).not.toHaveBeenCalled();
    });

    it('returns a final invoice without asking the provider', async () => {
      mockPrisma.paymentInvoice.findFirst.mockResolvedValue(
        invoice({
          status: InvoiceStatus.success,
          paidAt: new Date('2026-10-16T09:00:00.000Z'),
        }),
      );
      await expect(service.parentInvoice('parent-1', 'row-1')).resolves.toEqual(
        {
          status: InvoiceStatus.success,
          amount: '500.00',
          category: FinanceCategory.meals,
          paidAt: '2026-10-16T09:00:00.000Z',
        },
      );
      expect(mockProvider.getStatus).not.toHaveBeenCalled();
    });

    it('polls a pending invoice and returns the reloaded state', async () => {
      mockPrisma.paymentInvoice.findFirst
        .mockResolvedValueOnce(invoice())
        .mockResolvedValueOnce(
          invoice({ status: InvoiceStatus.failure, paidAt: null }),
        );
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      mockProvider.getStatus.mockResolvedValue({
        status: InvoiceStatus.failure,
        amountKop: 50000,
        paidAt: null,
        failureReason: 'declined',
      });

      const result = await service.parentInvoice('parent-1', 'row-1');

      expect(mockProvider.getStatus).toHaveBeenCalledWith('inv-1');
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalled();
      expect(result.status).toBe(InvoiceStatus.failure);
    });
  });

  describe('createLink', () => {
    it('creates a 7-day link request storing only the key hash', async () => {
      const result = await service.createLink(admin, 'child-1', {
        category: FinanceCategory.meals,
        amount: '300.00',
        comment: 'Жовтень',
      });

      const data = dataOf(mockPrisma.paymentRequest.create);
      const key = result.url.replace('http://app.test/pay/', '');
      expect(key).toHaveLength(43);
      expect(data).toEqual({
        childId: 'child-1',
        category: FinanceCategory.meals,
        amount: anyDecimal,
        source: PaymentRequestSource.link,
        linkTokenHash: hashLinkKey(key),
        expiresAt: anyDate,
        comment: 'Жовтень',
        createdById: 'admin-1',
      });
      expect((data.amount as Prisma.Decimal).toFixed(2)).toBe('300.00');
      expect((data.expiresAt as Date).getTime() - Date.now()).toBeGreaterThan(
        7 * 24 * HOUR - 60000,
      );
      expect(result).toEqual({
        id: 'req-new',
        url: `http://app.test/pay/${key}`,
        expiresAt: (data.expiresAt as Date).toISOString(),
      });
    });

    it('answers 404 for a missing child', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);
      await expect(
        service.createLink(admin, 'child-x', {
          category: FinanceCategory.meals,
          amount: '300.00',
        }),
      ).rejects.toThrow(new NotFoundException('Child not found'));
    });

    it('answers 404 for a child outside the scope', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.createLink(
          { ...admin, accessScope: AccessScope.kindergarten },
          'child-1',
          { category: FinanceCategory.meals, amount: '300.00' },
        ),
      ).rejects.toThrow(new NotFoundException('Child not found'));
      expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
    });

    it('rejects amounts outside 1.00 to 1000000.00', async () => {
      for (const amount of ['0.99', '1000000.01']) {
        await expect(
          service.createLink(admin, 'child-1', {
            category: FinanceCategory.meals,
            amount,
          }),
        ).rejects.toThrow(new BadRequestException('Amount is out of range'));
      }
      expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
    });

    it('accepts the range bounds 1.00 and 1000000.00', async () => {
      for (const amount of ['1.00', '1000000.00']) {
        await service.createLink(admin, 'child-1', {
          category: FinanceCategory.meals,
          amount,
        });
      }
      expect(
        (
          dataOf(mockPrisma.paymentRequest.create, 0).amount as Prisma.Decimal
        ).toFixed(2),
      ).toBe('1.00');
      expect(
        (
          dataOf(mockPrisma.paymentRequest.create, 1).amount as Prisma.Decimal
        ).toFixed(2),
      ).toBe('1000000.00');
    });
  });

  describe('listRequests and cancel', () => {
    const withRelations = (over: Record<string, unknown> = {}) => ({
      ...request(),
      createdBy: { id: 'admin-1', firstName: 'Ірина', lastName: 'Коваль' },
      invoices: [invoice({ request: undefined })],
      ...over,
    });

    it('lists requests newest first with views', async () => {
      mockPrisma.paymentRequest.findMany.mockResolvedValue([
        withRelations({ expiresAt: new Date(Date.now() - 1000) }),
      ]);

      const [view] = await service.listRequests(admin, 'child-1');

      expect(mockPrisma.paymentRequest.findMany).toHaveBeenCalledWith({
        where: { childId: 'child-1' },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          invoices: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(view).toMatchObject({
        id: 'req-1',
        category: FinanceCategory.meals,
        amount: '500.00',
        source: PaymentRequestSource.link,
        status: 'expired',
        comment: null,
        createdAt: '2026-10-16T08:00:00.000Z',
        paidAt: null,
        createdBy: { id: 'admin-1', firstName: 'Ірина', lastName: 'Коваль' },
      });
      expect(view.invoices[0]).toEqual({
        id: 'row-1',
        invoiceId: 'inv-1',
        status: InvoiceStatus.pending,
        amount: '500.00',
        failureReason: null,
        createdAt: anyString,
        paidAt: null,
      });
    });

    it('cancels an open request', async () => {
      mockPrisma.paymentRequest.findUnique
        .mockResolvedValueOnce(request())
        .mockResolvedValueOnce(
          withRelations({ status: PaymentRequestStatus.cancelled }),
        );
      mockPrisma.paymentRequest.updateMany.mockResolvedValue({ count: 1 });

      const view = await service.cancel(admin, 'req-1');

      expect(mockPrisma.paymentRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: PaymentRequestStatus.open },
        data: {
          status: PaymentRequestStatus.cancelled,
          cancelledAt: anyDate,
          cancelledById: 'admin-1',
        },
      });
      expect(view.status).toBe('cancelled');
    });

    it('refuses to cancel a request that is not open', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(
        request({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.cancel(admin, 'req-1')).rejects.toThrow(
        new BadRequestException('Payment request is not open'),
      );
      expect(mockPrisma.paymentRequest.updateMany).not.toHaveBeenCalled();
    });

    it('refuses when the request was paid concurrently', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(request());
      mockPrisma.paymentRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancel(admin, 'req-1')).rejects.toThrow(
        'Payment request is not open',
      );
    });

    it('answers 404 for a missing or out-of-scope request', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(null);
      await expect(service.cancel(admin, 'req-x')).rejects.toThrow(
        new NotFoundException('Payment request not found'),
      );
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(request());
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.cancel(
          { ...admin, accessScope: AccessScope.school_class },
          'req-1',
        ),
      ).rejects.toThrow(new NotFoundException('Payment request not found'));
    });
  });

  describe('public links', () => {
    const linked = (over: Record<string, unknown> = {}) => ({
      ...request(),
      child: { firstName: 'Олена', lastName: 'Іваненко' },
      ...over,
    });

    it('shows the public view without ids', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(linked());
      const view = await service.publicLink('key-1');
      expect(mockPrisma.paymentRequest.findUnique).toHaveBeenCalledWith({
        where: { linkTokenHash: hashLinkKey('key-1') },
        include: { child: { select: { firstName: true, lastName: true } } },
      });
      expect(view).toEqual({
        institution: 'EduNest',
        payer: 'Олена І.',
        category: FinanceCategory.meals,
        amount: '500.00',
        status: 'open',
        expiresAt: anyString,
      });
    });

    it('marks an expired open link as expired', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(
        linked({ expiresAt: new Date(Date.now() - 1000) }),
      );
      const view = await service.publicLink('key-1');
      expect(view.status).toBe('expired');
      expect(mockPrisma.paymentRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'req-1', status: PaymentRequestStatus.open },
        data: { status: PaymentRequestStatus.expired },
      });
    });

    it('answers 404 for an unknown key', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(null);
      await expect(service.publicLink('random')).rejects.toThrow(
        new NotFoundException('Payment link not found'),
      );
      await expect(service.payLink('random')).rejects.toThrow(
        new NotFoundException('Payment link not found'),
      );
    });

    it('refuses to pay an expired link', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(
        linked({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.payLink('key-1')).rejects.toThrow(
        new BadRequestException('Payment link expired'),
      );
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(
        linked({ status: PaymentRequestStatus.expired }),
      );
      await expect(service.payLink('key-1')).rejects.toThrow(
        'Payment link expired',
      );
      expect(mockProvider.createInvoice).not.toHaveBeenCalled();
    });

    it('refuses to pay a cancelled or paid link', async () => {
      for (const status of [
        PaymentRequestStatus.cancelled,
        PaymentRequestStatus.paid,
      ]) {
        mockPrisma.paymentRequest.findUnique.mockResolvedValue(
          linked({ status }),
        );
        await expect(service.payLink('key-1')).rejects.toThrow(
          new BadRequestException('Payment request is not open'),
        );
      }
      expect(mockProvider.createInvoice).not.toHaveBeenCalled();
    });

    it('creates an invoice for an open link', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(linked());
      await expect(service.payLink('key-1')).resolves.toEqual({
        pageUrl: 'http://pay/inv-new',
      });
      const input = arg<CreateInvoiceInput>(mockProvider.createInvoice);
      expect(input).toEqual({
        amountKop: 50000,
        reference: uuidLike,
        destination: 'Харчування — Олена І.',
        redirectUrl: 'http://app.test/pay/key-1',
        webhookUrl: null,
      });
      expect(mockPrisma.paymentInvoice.create).toHaveBeenCalledWith({
        data: {
          id: input.reference,
          requestId: 'req-1',
          provider: PaymentProviderKind.test,
          invoiceId: 'inv-new',
          pageUrl: 'http://pay/inv-new',
          amountKop: 50000,
        },
      });
      expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
    });

    it('writes no invoice when the provider throws on a link', async () => {
      mockPrisma.paymentRequest.findUnique.mockResolvedValue(linked());
      mockProvider.createInvoice.mockRejectedValue(new Error('down'));
      await expect(service.payLink('key-1')).rejects.toThrow(
        new BadGatewayException('Payment provider error'),
      );
      expect(mockPrisma.paymentInvoice.create).not.toHaveBeenCalled();
    });
  });

  describe('disabled online payments', () => {
    const disabledConfigs: OnlinePaymentsConfig[] = [
      { ...enabledConfig, provider: null, enabled: false },
      {
        ...enabledConfig,
        provider: PaymentProviderKind.monobank,
        enabled: false,
      },
    ];

    it.each(disabledConfigs)(
      'refuses create paths and the test route for provider $provider',
      async (config) => {
        service = await make(config);
        mockPrisma.paymentRequest.findUnique.mockResolvedValue({
          ...request(),
          child: { firstName: 'Олена', lastName: 'Іваненко' },
        });

        expect(service.config()).toEqual({ enabled: false });
        await expect(
          service.payFromCabinet('parent-1', 'child-1', {
            category: FinanceCategory.meals,
            amount: '100.00',
          }),
        ).rejects.toThrow(
          new BadRequestException('Online payments are disabled'),
        );
        await expect(
          service.createLink(admin, 'child-1', {
            category: FinanceCategory.meals,
            amount: '100.00',
          }),
        ).rejects.toThrow(
          new BadRequestException('Online payments are disabled'),
        );
        await expect(service.payLink('key-1')).rejects.toThrow(
          new BadRequestException('Online payments are disabled'),
        );
        await expect(service.testResult('inv-1', 'success')).rejects.toThrow(
          NotFoundException,
        );
        await expect(
          service.handleWebhook('test', Buffer.from('{}'), {}),
        ).rejects.toThrow(NotFoundException);
        expect(mockProvider.createInvoice).not.toHaveBeenCalled();
        expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
        expect(mockTestProvider.setResult).not.toHaveBeenCalled();
      },
    );

    it('reports enabled for the test provider', () => {
      expect(service.config()).toEqual({ enabled: true });
    });
  });

  describe('handleWebhook', () => {
    it('answers 401 on a bad signature without asking the provider', async () => {
      mockProvider.verifyWebhook.mockResolvedValue(null);
      await expect(
        service.handleWebhook('test', Buffer.from('{}'), { 'x-sign': 'bad' }),
      ).rejects.toThrow(new UnauthorizedException('Invalid signature'));
      expect(mockProvider.getStatus).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers 404 for another provider name', async () => {
      await expect(
        service.handleWebhook('monobank', Buffer.from('{}'), {}),
      ).rejects.toThrow(NotFoundException);
      expect(mockProvider.verifyWebhook).not.toHaveBeenCalled();
    });

    it('fetches the status instead of trusting the body', async () => {
      const raw = Buffer.from('{"status":"success"}');
      mockProvider.verifyWebhook.mockResolvedValue({ invoiceId: 'inv-1' });
      mockProvider.getStatus.mockResolvedValue({
        status: InvoiceStatus.pending,
        amountKop: null,
        paidAt: null,
        failureReason: null,
      });
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());

      await service.handleWebhook('test', raw, { a: 'b' });

      expect(mockProvider.verifyWebhook).toHaveBeenCalledWith(raw, { a: 'b' });
      expect(mockProvider.getStatus).toHaveBeenCalledWith('inv-1');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        data: { checkedAt: anyDate },
      });
    });
  });

  describe('testResult', () => {
    it('sets the test result and applies the provider status', async () => {
      mockPrisma.paymentInvoice.findUnique
        .mockResolvedValueOnce(invoice())
        .mockResolvedValueOnce(invoice())
        .mockResolvedValueOnce(invoice({ status: InvoiceStatus.success }));
      mockProvider.getStatus.mockResolvedValue(success());

      await expect(service.testResult('inv-1', 'success')).resolves.toEqual({
        status: InvoiceStatus.success,
      });
      expect(mockTestProvider.setResult).toHaveBeenCalledWith(
        'inv-1',
        'success',
      );
      expect(mockProvider.getStatus).toHaveBeenCalledWith('inv-1');
      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
    });

    it('returns the status of a final invoice untouched', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(
        invoice({ status: InvoiceStatus.failure }),
      );
      await expect(service.testResult('inv-1', 'success')).resolves.toEqual({
        status: InvoiceStatus.failure,
      });
      expect(mockTestProvider.setResult).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown invoice', async () => {
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(null);
      await expect(service.testResult('nope', 'failure')).rejects.toThrow(
        new NotFoundException('Invoice not found'),
      );
    });
  });

  describe('syncPending and expireRequests', () => {
    it('expires a 25-hour-old pending invoice and polls a fresh one', async () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      mockPrisma.paymentInvoice.findMany.mockResolvedValue([
        { invoiceId: 'old', createdAt: new Date(now.getTime() - 25 * HOUR) },
        { invoiceId: 'fresh', createdAt: new Date(now.getTime() - HOUR) },
      ]);
      mockProvider.getStatus.mockResolvedValue({
        status: InvoiceStatus.pending,
        amountKop: null,
        paidAt: null,
        failureReason: null,
      });
      mockPrisma.paymentInvoice.findUnique.mockImplementation(
        ({ where }: { where: { invoiceId: string } }) =>
          Promise.resolve(
            invoice({
              id: `row-${where.invoiceId}`,
              invoiceId: where.invoiceId,
            }),
          ),
      );

      await expect(service.syncPending(now)).resolves.toBe(2);

      expect(mockPrisma.paymentInvoice.findMany).toHaveBeenCalledWith({
        where: {
          status: InvoiceStatus.pending,
          provider: PaymentProviderKind.test,
        },
        select: { invoiceId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(mockProvider.getStatus).toHaveBeenCalledWith('fresh');
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-old' },
        data: {
          status: InvoiceStatus.expired,
          failureReason: null,
          checkedAt: anyDate,
        },
      });
      expect(mockPrisma.paymentInvoice.update).toHaveBeenCalledWith({
        where: { id: 'row-fresh' },
        data: { checkedAt: anyDate },
      });
    });

    it('credits a late success instead of expiring it', async () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      mockPrisma.paymentInvoice.findMany.mockResolvedValue([
        { invoiceId: 'inv-1', createdAt: new Date(now.getTime() - 25 * HOUR) },
      ]);
      mockProvider.getStatus.mockResolvedValue(success());
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());

      await service.syncPending(now);

      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
    });

    it('logs and skips per-invoice errors', async () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      mockPrisma.paymentInvoice.findMany.mockResolvedValue([
        { invoiceId: 'a', createdAt: now },
        { invoiceId: 'b', createdAt: now },
      ]);
      mockProvider.getStatus
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({
          status: InvoiceStatus.pending,
          amountKop: null,
          paidAt: null,
          failureReason: null,
        });
      mockPrisma.paymentInvoice.findUnique.mockResolvedValue(invoice());
      await expect(service.syncPending(now)).resolves.toBe(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('expires open links past their date', async () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      mockPrisma.paymentRequest.updateMany.mockResolvedValue({ count: 3 });
      await expect(service.expireRequests(now)).resolves.toBe(3);
      expect(mockPrisma.paymentRequest.updateMany).toHaveBeenCalledWith({
        where: { status: PaymentRequestStatus.open, expiresAt: { lte: now } },
        data: { status: PaymentRequestStatus.expired },
      });
    });
  });
});
