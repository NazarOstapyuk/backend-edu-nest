import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  FinanceCategory,
  InvoiceStatus,
  PaymentMethod,
  PaymentProviderKind,
  PaymentRequestSource,
  PaymentRequestStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { scopeKind } from '../access/access-calc';
import { assertChildInScope } from '../access/scope';
import { assertOwnChild } from '../common/ownership';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { applyAllocations } from '../finance/allocations';
import { formatMoney, money, suggestAllocation } from '../finance/finance-calc';
import { PrismaService } from '../prisma/prisma.service';
import {
  fromKopecks,
  hashLinkKey,
  invoiceExpired,
  isFinal,
  type LinkState,
  linkExpiresAt,
  linkState,
  newLinkKey,
  payerName,
  toKopecks,
} from './online-payments-calc';
import {
  ONLINE_PAYMENTS_CONFIG,
  type OnlinePaymentsConfig,
} from './online-payments.config';
import {
  type CreateInvoiceInput,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderStatus,
} from './payment-provider';
import { TestProvider } from './test-provider';

const DISABLED = 'Online payments are disabled';
const ONLINE_NOTE = 'Онлайн-оплата';

const CATEGORY_LABEL: Record<FinanceCategory, string> = {
  tuition: 'Навчання',
  adaptation: 'Адаптація',
  extra_classes: 'Додаткові заняття',
  meals: 'Харчування',
};

const requestInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  invoices: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.PaymentRequestInclude;

type RequestWithRelations = Prisma.PaymentRequestGetPayload<{
  include: typeof requestInclude;
}>;

export interface RequestView {
  id: string;
  category: FinanceCategory;
  amount: string;
  source: PaymentRequestSource;
  status: LinkState;
  comment: string | null;
  expiresAt: string | null;
  createdAt: string;
  paidAt: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  invoices: {
    id: string;
    invoiceId: string;
    status: InvoiceStatus;
    amount: string;
    failureReason: string | null;
    createdAt: string;
    paidAt: string | null;
  }[];
}

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);
  private rootIdCache: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ONLINE_PAYMENTS_CONFIG)
    private readonly options: OnlinePaymentsConfig,
    private readonly configService: ConfigService,
    @Optional() private readonly testProvider?: TestProvider,
  ) {}

  config(): { enabled: boolean } {
    return { enabled: this.options.enabled };
  }

  async payFromCabinet(
    parentId: string,
    childId: string,
    dto: { category: FinanceCategory; amount: string },
  ): Promise<{ pageUrl: string }> {
    this.assertEnabled();
    const amount = money(dto.amount);
    const amountKop = toKopecks(amount);
    await assertOwnChild(this.prisma, parentId, childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { firstName: true, lastName: true },
    });
    if (!child) throw new NotFoundException('Child not found');

    const rowId = randomUUID();
    const created = await this.createProviderInvoice({
      amountKop,
      reference: rowId,
      destination: this.destination(dto.category, child),
      redirectUrl: `${this.options.publicAppUrl}/family/${childId}?invoice=${rowId}`,
    });

    await this.prisma.$transaction(async (tx) => {
      const request = await tx.paymentRequest.create({
        data: {
          childId,
          category: dto.category,
          amount,
          source: PaymentRequestSource.cabinet,
          createdById: parentId,
        },
      });
      await tx.paymentInvoice.create({
        data: {
          id: rowId,
          requestId: request.id,
          provider: this.provider.kind,
          invoiceId: created.invoiceId,
          pageUrl: created.pageUrl,
          amountKop,
        },
      });
    });
    return { pageUrl: created.pageUrl };
  }

  async parentInvoice(
    parentId: string,
    invoiceId: string,
  ): Promise<{
    status: InvoiceStatus;
    amount: string;
    category: FinanceCategory;
    paidAt: string | null;
  }> {
    const find = () =>
      this.prisma.paymentInvoice.findFirst({
        where: {
          id: invoiceId,
          request: { child: { parents: { some: { id: parentId } } } },
        },
        include: { request: true },
      });
    let invoice = await find();
    if (!invoice) throw new NotFoundException('Invoice not found');

    if (
      invoice.status === InvoiceStatus.pending &&
      this.options.enabled &&
      invoice.provider === this.provider.kind
    ) {
      try {
        const status = await this.provider.getStatus(invoice.invoiceId);
        await this.applyInvoiceStatus(invoice.invoiceId, status);
        invoice = (await find()) ?? invoice;
      } catch (error) {
        this.logError(
          `Invoice ${invoice.invoiceId} status check failed`,
          error,
        );
      }
    }

    return {
      status: invoice.status,
      amount: formatMoney(fromKopecks(invoice.amountKop)),
      category: invoice.request.category,
      paidAt: iso(invoice.paidAt),
    };
  }

  async createLink(
    user: AuthenticatedUser,
    childId: string,
    dto: { category: FinanceCategory; amount: string; comment?: string },
  ): Promise<{ id: string; url: string; expiresAt: string }> {
    this.assertEnabled();
    const amount = money(dto.amount);
    toKopecks(amount);
    await assertChildInScope(this.prisma, scopeKind(user), childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) throw new NotFoundException('Child not found');

    const { key, hash } = newLinkKey();
    const expiresAt = linkExpiresAt(new Date());
    const request = await this.prisma.paymentRequest.create({
      data: {
        childId,
        category: dto.category,
        amount,
        source: PaymentRequestSource.link,
        linkTokenHash: hash,
        expiresAt,
        comment: dto.comment ?? null,
        createdById: user.id,
      },
    });
    return {
      id: request.id,
      url: `${this.options.publicAppUrl}/pay/${key}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listRequests(
    user: AuthenticatedUser,
    childId: string,
  ): Promise<RequestView[]> {
    await assertChildInScope(this.prisma, scopeKind(user), childId);
    const requests = await this.prisma.paymentRequest.findMany({
      where: { childId },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return requests.map((request) => this.toView(request, now));
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<RequestView> {
    const notFound = 'Payment request not found';
    const request = await this.prisma.paymentRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException(notFound);
    await assertChildInScope(
      this.prisma,
      scopeKind(user),
      request.childId,
      notFound,
    );

    const now = new Date();
    if (linkState(request, now) !== 'open') {
      throw new BadRequestException('Payment request is not open');
    }
    const { count } = await this.prisma.paymentRequest.updateMany({
      where: { id, status: PaymentRequestStatus.open },
      data: {
        status: PaymentRequestStatus.cancelled,
        cancelledAt: now,
        cancelledById: user.id,
      },
    });
    if (count === 0) {
      throw new BadRequestException('Payment request is not open');
    }

    const updated = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: requestInclude,
    });
    if (!updated) throw new NotFoundException(notFound);
    return this.toView(updated, now);
  }

  async publicLink(key: string): Promise<{
    institution: string;
    payer: string;
    category: FinanceCategory;
    amount: string;
    status: LinkState;
    expiresAt: string | null;
  }> {
    const { request, state } = await this.findLink(key);
    return {
      institution: this.options.institution,
      payer: payerName(request.child.firstName, request.child.lastName),
      category: request.category,
      amount: formatMoney(request.amount),
      status: state,
      expiresAt: iso(request.expiresAt),
    };
  }

  async payLink(key: string): Promise<{ pageUrl: string }> {
    this.assertEnabled();
    const { request, state } = await this.findLink(key);
    if (state === 'expired') {
      throw new BadRequestException('Payment link expired');
    }
    if (state !== 'open') {
      throw new BadRequestException('Payment request is not open');
    }

    const amountKop = toKopecks(request.amount);
    const rowId = randomUUID();
    const created = await this.createProviderInvoice({
      amountKop,
      reference: rowId,
      destination: this.destination(request.category, request.child),
      redirectUrl: `${this.options.publicAppUrl}/pay/${key}`,
    });
    await this.prisma.paymentInvoice.create({
      data: {
        id: rowId,
        requestId: request.id,
        provider: this.provider.kind,
        invoiceId: created.invoiceId,
        pageUrl: created.pageUrl,
        amountKop,
      },
    });
    return { pageUrl: created.pageUrl };
  }

  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    if (!this.options.enabled || providerName !== this.provider.kind) {
      throw new NotFoundException();
    }
    const verified = await this.provider.verifyWebhook(rawBody, headers);
    if (!verified) throw new UnauthorizedException('Invalid signature');
    const status = await this.provider.getStatus(verified.invoiceId);
    await this.applyInvoiceStatus(verified.invoiceId, status);
  }

  async testResult(
    invoiceId: string,
    result: 'success' | 'failure',
  ): Promise<{ status: InvoiceStatus }> {
    const testProvider = this.testProvider;
    if (this.options.provider !== PaymentProviderKind.test || !testProvider) {
      throw new NotFoundException('Invoice not found');
    }
    const invoice = await this.prisma.paymentInvoice.findUnique({
      where: { invoiceId },
    });
    if (!invoice || invoice.provider !== PaymentProviderKind.test) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status !== InvoiceStatus.pending) {
      return { status: invoice.status };
    }

    await testProvider.setResult(invoiceId, result);
    const status = await this.provider.getStatus(invoiceId);
    await this.applyInvoiceStatus(invoiceId, status);
    const updated = await this.prisma.paymentInvoice.findUnique({
      where: { invoiceId },
    });
    return { status: updated?.status ?? invoice.status };
  }

  async syncPending(now: Date = new Date()): Promise<number> {
    const invoices = await this.prisma.paymentInvoice.findMany({
      where: { status: InvoiceStatus.pending, provider: this.provider.kind },
      select: { invoiceId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    let processed = 0;
    for (const invoice of invoices) {
      try {
        const status = await this.provider.getStatus(invoice.invoiceId);
        const late =
          invoiceExpired(invoice, now) &&
          status.status !== InvoiceStatus.success;
        await this.applyInvoiceStatus(
          invoice.invoiceId,
          late
            ? {
                status: InvoiceStatus.expired,
                amountKop: null,
                paidAt: null,
                failureReason: null,
              }
            : status,
        );
        processed++;
      } catch (error) {
        this.logError(`Invoice ${invoice.invoiceId} sync failed`, error);
      }
    }
    return processed;
  }

  async expireRequests(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.paymentRequest.updateMany({
      where: { status: PaymentRequestStatus.open, expiresAt: { lte: now } },
      data: { status: PaymentRequestStatus.expired },
    });
    return count;
  }

  async applyInvoiceStatus(
    invoiceId: string,
    status: ProviderStatus,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PaymentInvoice" WHERE "invoiceId" = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.paymentInvoice.findUnique({
        where: { invoiceId },
        include: { request: true },
      });
      if (!invoice || isFinal(invoice.status)) return;

      const now = new Date();
      if (status.status === InvoiceStatus.pending) {
        await tx.paymentInvoice.update({
          where: { id: invoice.id },
          data: { checkedAt: now },
        });
        return;
      }

      if (status.status !== InvoiceStatus.success) {
        await tx.paymentInvoice.update({
          where: { id: invoice.id },
          data: {
            status: status.status,
            failureReason:
              status.status === InvoiceStatus.failure
                ? status.failureReason
                : null,
            checkedAt: now,
          },
        });
        return;
      }

      if (status.amountKop !== invoice.amountKop) {
        await tx.paymentInvoice.update({
          where: { id: invoice.id },
          data: {
            status: InvoiceStatus.failure,
            failureReason: 'amount mismatch',
            checkedAt: now,
          },
        });
        return;
      }

      const { request } = invoice;
      const amount = fromKopecks(invoice.amountKop);
      const paidAt = status.paidAt ?? now;
      const payment = await tx.payment.create({
        data: {
          childId: request.childId,
          amount,
          category: request.category,
          method: PaymentMethod.online,
          status: PaymentStatus.confirmed,
          reference: invoice.invoiceId,
          externalId: invoice.invoiceId,
          receivedAt: paidAt,
          createdById: null,
          note: ONLINE_NOTE,
        },
      });

      await tx.$queryRaw`SELECT id FROM "Charge" WHERE "childId" = ${request.childId} ORDER BY id FOR UPDATE`;
      const charges = await tx.charge.findMany({
        where: {
          childId: request.childId,
          category: request.category,
          voidedAt: null,
        },
        include: { allocations: { where: { voidedAt: null } } },
      });
      const items = suggestAllocation(charges, amount)
        .lines.map((line) => ({
          chargeId: line.chargeId,
          amount: line.suggestedAmount,
        }))
        .filter((item) => money(item.amount).gt(0));
      if (items.length) {
        const rootId = await this.rootId(tx);
        await applyAllocations(tx, payment.id, items, rootId);
      }

      await tx.paymentInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.success,
          paidAt,
          checkedAt: now,
          paymentId: payment.id,
          failureReason: null,
        },
      });
      await tx.paymentRequest.update({
        where: { id: request.id },
        data: { status: PaymentRequestStatus.paid, paidAt },
      });
    });
  }

  private assertEnabled(): void {
    if (!this.options.enabled) throw new BadRequestException(DISABLED);
  }

  private destination(
    category: FinanceCategory,
    child: { firstName: string; lastName: string },
  ): string {
    return `${CATEGORY_LABEL[category]} — ${payerName(child.firstName, child.lastName)}`;
  }

  private async createProviderInvoice(
    input: Omit<CreateInvoiceInput, 'webhookUrl'>,
  ): Promise<{ invoiceId: string; pageUrl: string }> {
    const webhookUrl = this.options.webhookUrl
      ? `${this.options.webhookUrl}/online-payments/webhook/${this.provider.kind}`
      : null;
    try {
      return await this.provider.createInvoice({ ...input, webhookUrl });
    } catch (error) {
      this.logError('Invoice creation failed', error);
      throw new BadGatewayException('Payment provider error');
    }
  }

  private async findLink(key: string) {
    const request = await this.prisma.paymentRequest.findUnique({
      where: { linkTokenHash: hashLinkKey(key) },
      include: { child: { select: { firstName: true, lastName: true } } },
    });
    if (!request) throw new NotFoundException('Payment link not found');
    const state = linkState(request, new Date());
    if (state === 'expired' && request.status === PaymentRequestStatus.open) {
      await this.prisma.paymentRequest.updateMany({
        where: { id: request.id, status: PaymentRequestStatus.open },
        data: { status: PaymentRequestStatus.expired },
      });
    }
    return { request, state };
  }

  private async rootId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.rootIdCache) return this.rootIdCache;
    const login = this.configService.get<string>('ROOT_LOGIN');
    const root = login
      ? await tx.user.findUnique({ where: { login }, select: { id: true } })
      : null;
    if (!root) throw new Error('Root user not found');
    this.rootIdCache = root.id;
    return root.id;
  }

  private toView(request: RequestWithRelations, now: Date): RequestView {
    return {
      id: request.id,
      category: request.category,
      amount: formatMoney(request.amount),
      source: request.source,
      status: linkState(request, now),
      comment: request.comment,
      expiresAt: iso(request.expiresAt),
      createdAt: request.createdAt.toISOString(),
      paidAt: iso(request.paidAt),
      createdBy: request.createdBy,
      invoices: request.invoices.map((invoice) => ({
        id: invoice.id,
        invoiceId: invoice.invoiceId,
        status: invoice.status,
        amount: formatMoney(fromKopecks(invoice.amountKop)),
        failureReason: invoice.failureReason,
        createdAt: invoice.createdAt.toISOString(),
        paidAt: iso(invoice.paidAt),
      })),
    };
  }

  private logError(message: string, error: unknown): void {
    this.logger.error(
      `${message}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
