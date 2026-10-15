# Online Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parents pay a finance category online (from the cabinet or a 7-day payment link); confirmed invoices become ordinary `Payment`s allocated to the category's oldest charges; a test provider imitates the bank; a manual «Картка» method is added.

**Architecture:** New `src/online-payments/` module: pure rules in `online-payments-calc.ts`, a `PaymentProvider` interface with a `TestProvider`, `OnlinePaymentsService` (requests, invoices, the idempotent `applyInvoiceStatus`), controllers for parent / staff / public / webhook / test routes, and a scheduler that polls pending invoices and expires old ones. Frontend: pay dialog and return banner in the cabinet, public `/pay/:token` page, test bank page, staff link dialog and «Онлайн-оплати» tab.

**Tech Stack:** NestJS 11, Prisma 7, `@nestjs/schedule`, `node:crypto`, Jest. Frontend: React 19, MUI 9, Zustand 5, axios.

**Spec:** `docs/superpowers/specs/2026-10-16-online-payments-design.md`

**Repos / branches:** backend `D:\IT\backend-edu-nest`: branch `feature/online-payments` from `main` (Tasks 1–5). Frontend `D:\IT\EduNest`: branch `feature/online-payments` from `main` (Task 6).

## Global Constraints

- Node 22: `export PATH="/c/Users/Nazarii/AppData/Local/nvm/v22.22.2:$PATH"`. Docker `edu_postgres` must run for the migration.
- No new dependencies (`node:crypto` only). No code comments.
- Money is `Prisma.Decimal` in code and 2-decimal strings in the API; kopecks are integers computed from the Decimal (`amount.mul(100).toFixed(0)`), never from JS float arithmetic.
- `applyInvoiceStatus` is idempotent: it locks the invoice row (`SELECT … FOR UPDATE`) inside `$transaction`; an invoice already `success` is never applied twice; a provider amount different from `amountKop` credits nothing (`failure`, `failureReason 'amount mismatch'`).
- A successful invoice creates `Payment` with `method online`, `status confirmed`, `category` of the request, `reference = externalId = invoiceId`, `receivedAt = paidAt`, `createdById null`, `note 'Онлайн-оплата'`, allocated with `suggestAllocation` to the category's open charges via `applyAllocations` (allocations are created by the root user: the user whose `login` = `ROOT_LOGIN`); the remainder stays a prepayment.
- Link keys: 32 random bytes base64url (`randomBytes(32).toString('base64url')`), stored only as SHA-256 hex in `PaymentRequest.linkTokenHash`; valid 7 days; unknown keys → 404 `Payment link not found`.
- Public responses never include ids of children, debts or contacts; payer name is `Ім'я П.` (first name + first letter of last name + `.`).
- Webhook bodies are never trusted: `verifyWebhook` then `getStatus`; bad signature → 401, nothing changes.
- Config (all optional): `PAYMENT_PROVIDER` (`test` | `monobank`; empty → 400 `Online payments are disabled`), `PAYMENT_WEBHOOK_URL` (empty → polling only), `PUBLIC_APP_URL` (default `http://localhost:5173`), `INSTITUTION_NAME` (default `EduNest`). `monobank` is accepted by config but has no adapter in this plan: selecting it → 400 `Online payments are disabled`.
- Messages: 400 `Online payments are disabled`, 404 `Payment link not found`, 400 `Payment link expired`, 400 `Payment request is not open`, 502 `Payment provider error`, 404 `Invoice not found`; 404 `Payment request not found`; reuse `Child not found`, `Amount must be greater than 0`.
- `main.ts`: only add `{ rawBody: true }` to `NestFactory.create`. Don't change CORS, ValidationPipe, cookies, JWT config. Never reset/drop data; don't edit applied migrations.
- Backend: `npx eslint --fix <touched files>`; no new lint errors. Jest mocks without `as unknown as` (except Nest framework objects); never `as any`. CRLF files: never stage line-ending-only changes of untouched files.
- Frontend: tsc baseline `<scratchpad>/fe-tsc-baseline-online.txt` saved before Task 6; per-file error counts equal; eslint 0 errors on touched files; MUI 9 no system props on `Stack`/`Typography`; never touch untracked `children 2.ts` / `children 3.ts` / `CreateSubscriptionModal 2.tsx` / `SubscriptionsPage 2.tsx`; never `git add -A`.
- Commits: Conventional Commits, one task = one commit, `Co-Authored-By` trailer. Never push. Live checks on PORT=3101 with `PAYMENT_PROVIDER=test` set only in the server's process environment (never edit `.env`); never print `ROOT_PASSWORD`.
- Scratchpad: `C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad`.

## Review Focus

1. The same success arrives twice (webhook + poll, or two webhooks at once): exactly one `Payment`, balance unchanged by the second. Pinned in Task 3 (sequential repeat + lock statement asserted) and Task 5 (live repeat).
2. A parent pays 500.00 against a category debt of 300.00 split over two charges: both charges become fully paid, 200.00 remains a prepayment of that category, nothing touches other categories. Pinned in Task 3.
3. An expired or cancelled link opened later shows the right state and refuses a new invoice; a link key of another request or a random string answers 404 with the same message. Pinned in Task 3 and Task 5.
4. `PAYMENT_PROVIDER` empty or `monobank`: every create route answers 400 `Online payments are disabled`, the test route answers 404, `GET /online-payments/config` says `enabled: false`. Pinned in Task 3 (service tests with disabled and `monobank` configs).
5. The provider throws while creating an invoice: the request stays usable (no half-created invoice row), client gets 502 `Payment provider error`. Pinned in Task 3.

---

## File Map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration `add_online_payments` | `PaymentMethod.card`, `PaymentRequest`, `PaymentInvoice`, enums |
| `src/finance/dto/create-payment.dto.ts` | allow `card` |
| `src/online-payments/online-payments-calc.ts` | pure rules |
| `src/online-payments/payment-provider.ts` | `PaymentProvider` interface, `PAYMENT_PROVIDER` token, `ProviderStatus` |
| `src/online-payments/test-provider.ts` | test provider (DB-backed status) |
| `src/online-payments/online-payments.config.ts` | reads env into `OnlinePaymentsConfig` |
| `src/online-payments/online-payments.service.ts` | requests, invoices, `applyInvoiceStatus`, polling, expiry |
| `src/online-payments/*.controller.ts` | parent, staff, public, webhook/test/config routes |
| `src/online-payments/online-payments.scheduler.ts` | every 2 min poll, nightly expiry |
| `src/online-payments/online-payments.module.ts`, `src/app.module.ts`, `src/main.ts` | wiring, `rawBody` |

---

### Task 1: Schema, migration, manual card method

**Files:**
- Modify: `prisma/schema.prisma`, `src/finance/dto/create-payment.dto.ts`, `src/finance/dto/finance-dtos.spec.ts`
- Create: `prisma/migrations/<timestamp>_add_online_payments/migration.sql`

**Interfaces:**
- Produces: enum values `PaymentMethod.card`; enums `PaymentRequestSource { cabinet link }`, `PaymentRequestStatus { open paid cancelled expired }`, `PaymentProviderKind { test monobank }`, `InvoiceStatus { pending success failure expired }`; models below.

- [ ] **Step 1: Branch** — `cd /d/IT/backend-edu-nest && git checkout main && git checkout -b feature/online-payments`.
- [ ] **Step 2: Schema** — add `card` to `enum PaymentMethod` (after `bank_transfer`), the four enums, and:

```prisma
model PaymentRequest {
  id            String               @id @default(uuid())
  childId       String
  child         Child                @relation(fields: [childId], references: [id], onDelete: Restrict)
  category      FinanceCategory
  amount        Decimal              @db.Decimal(10, 2)
  source        PaymentRequestSource
  status        PaymentRequestStatus @default(open)
  linkTokenHash String?              @unique
  comment       String?
  expiresAt     DateTime?
  createdById   String?
  createdBy     User?                @relation("PaymentRequestCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt     DateTime             @default(now())
  paidAt        DateTime?
  cancelledAt   DateTime?
  cancelledById String?
  cancelledBy   User?                @relation("PaymentRequestCancelledBy", fields: [cancelledById], references: [id], onDelete: SetNull)
  invoices      PaymentInvoice[]

  @@index([childId])
  @@index([status])
}

model PaymentInvoice {
  id            String              @id @default(uuid())
  requestId     String
  request       PaymentRequest      @relation(fields: [requestId], references: [id], onDelete: Restrict)
  provider      PaymentProviderKind
  invoiceId     String              @unique
  pageUrl       String
  amountKop     Int
  status        InvoiceStatus       @default(pending)
  failureReason String?
  paidAt        DateTime?
  checkedAt     DateTime?
  paymentId     String?             @unique
  payment       Payment?            @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  createdAt     DateTime            @default(now())

  @@index([requestId])
  @@index([status])
}
```

Add the back-relations: `Child.paymentRequests PaymentRequest[]`, `User.paymentRequestsCreated PaymentRequest[] @relation("PaymentRequestCreatedBy")`, `User.paymentRequestsCancelled PaymentRequest[] @relation("PaymentRequestCancelledBy")`, `Payment.invoice PaymentInvoice?`.

- [ ] **Step 3: Migration** — `npx prisma migrate dev --name add_online_payments` (never reset; if Prisma asks to reset, stop and report). Check the SQL contains `ALTER TYPE "PaymentMethod" ADD VALUE 'card'`, the enums, both tables, the unique indexes.
- [ ] **Step 4: Children/users delete guards** — read `ChildrenService.delete` and `UsersService.delete`: a child with payment requests must not be deletable (`onDelete: Restrict` would raise a Prisma error → 500). Add `paymentRequests` to the child's finance-records check so deletion answers the existing 400 message for finance records (read the exact message there). Users: `SetNull`, no change. Add a children spec case.
- [ ] **Step 5: DTO** — `CreatePaymentDto.method`: `@IsIn([PaymentMethod.cash, PaymentMethod.bank_transfer, PaymentMethod.card])`. Spec case in `finance-dtos.spec.ts`: `card` valid, `online` invalid.
- [ ] **Step 6: Verify and commit** — `npx prisma generate`, `npm test`, `npm run build`, eslint on touched files.

```bash
git add prisma/schema.prisma prisma/migrations src/finance/dto src/children
git commit -m "feat: add online payment schema and card method"
```

---

### Task 2: Pure rules, provider interface, test provider, config

**Files:**
- Create: `src/online-payments/online-payments-calc.ts` (+spec), `src/online-payments/payment-provider.ts`, `src/online-payments/online-payments.config.ts` (+spec), `src/online-payments/test-provider.ts` (+spec)

**Interfaces:**
- Produces:

```ts
// online-payments-calc.ts
export const LINK_DAYS = 7;
export const INVOICE_TTL_HOURS = 24;
export const toKopecks: (amount: Prisma.Decimal) => number;
export const fromKopecks: (kop: number) => Prisma.Decimal;
export const payerName: (firstName: string, lastName: string) => string;
export const newLinkKey: () => { key: string; hash: string };
export const hashLinkKey: (key: string) => string;
export const linkExpiresAt: (now: Date) => Date;
export type LinkState = 'open' | 'paid' | 'cancelled' | 'expired';
export const linkState: (request: { status: PaymentRequestStatus; expiresAt: Date | null }, now: Date) => LinkState;
export const invoiceExpired: (invoice: { createdAt: Date }, now: Date) => boolean;
export const isFinal: (status: InvoiceStatus) => boolean;

// payment-provider.ts
export interface CreateInvoiceInput { amountKop: number; reference: string; destination: string; redirectUrl: string; webhookUrl: string | null }
export interface ProviderStatus { status: InvoiceStatus; amountKop: number | null; paidAt: Date | null; failureReason: string | null }
export interface PaymentProvider {
  readonly kind: PaymentProviderKind;
  createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; pageUrl: string }>;
  getStatus(invoiceId: string): Promise<ProviderStatus>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ invoiceId: string } | null>;
}
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

// online-payments.config.ts
export interface OnlinePaymentsConfig { provider: PaymentProviderKind | null; enabled: boolean; webhookUrl: string | null; publicAppUrl: string; institution: string }
export const readOnlinePaymentsConfig: (env: Record<string, string | undefined>) => OnlinePaymentsConfig;
export const ONLINE_PAYMENTS_CONFIG = Symbol('ONLINE_PAYMENTS_CONFIG');

// test-provider.ts
@Injectable() export class TestProvider implements PaymentProvider {
  constructor(prisma: PrismaService, @Inject(ONLINE_PAYMENTS_CONFIG) config: OnlinePaymentsConfig)
  setResult(invoiceId: string, result: 'success' | 'failure'): Promise<void>;
}
```

Rules:
- `toKopecks(d)` = `Number(d.mul(100).toFixed(0))`; throws `BadRequestException('Amount must be greater than 0')` when `d.lte(0)`. `fromKopecks(125050)` = `Decimal('1250.50')`.
- `payerName('Олена', 'Іваненко')` = `'Олена І.'`; trims; empty last name → first name only.
- `newLinkKey()` = `randomBytes(32).toString('base64url')`, `hash = createHash('sha256').update(key).digest('hex')`.
- `linkExpiresAt(now)` = now + 7 × 24 h.
- `linkState`: `paid`/`cancelled`/`expired` statuses map to themselves; `open` with `expiresAt` in the past (≤ now) → `expired`; else `open`.
- `invoiceExpired`: `createdAt` + 24 h ≤ now.
- `isFinal`: `success`, `failure`, `expired` → true.
- `readOnlinePaymentsConfig`: `PAYMENT_PROVIDER` trimmed; `'test'` → provider `test`, enabled true; `'monobank'` → provider `monobank`, enabled false (no adapter yet); anything else/empty → provider null, enabled false. `PAYMENT_WEBHOOK_URL` empty → null (trailing `/` removed). `PUBLIC_APP_URL` default `http://localhost:5173` (trailing `/` removed). `INSTITUTION_NAME` default `EduNest`.
- `TestProvider`:
  - `createInvoice` → `invoiceId = 'test_' + randomUUID()`, `pageUrl = ${publicAppUrl}/pay/test/${invoiceId}`.
  - `getStatus` reads the `PaymentInvoice` row: a row whose `failureReason` is the marker `'test:success'` → `{ status: success, amountKop: row.amountKop, paidAt: row.checkedAt ?? now, failureReason: null }`; marker `'test:failure'` → `{ status: failure, …, failureReason: 'Відхилено в тестовому банку' }`; otherwise `pending`. Missing row → `pending`.
  - `setResult(invoiceId, result)` stores the marker in `failureReason` and `checkedAt = now` with an `updateMany` where `status: pending` (no-op otherwise).
  - `verifyWebhook` → `null` always (the test provider has no webhooks).

The marker lives in `failureReason` only until `applyInvoiceStatus` writes the final status; this keeps the test provider stateless outside the invoice table.

- [ ] **Step 1: Failing tests** — calc: kopecks both ways (`'1250.50'` → 125050, `'0.10'` → 10, `'19.99'` → 1999, `fromKopecks(1)` → `'0.01'`), `toKopecks('0.00')` throws, payer names, key length (43 chars) and hash determinism, expiry boundaries (exactly 7 days, 1 ms before), `linkState` table, `invoiceExpired` at 24 h. Config: the four cases above. Test provider (Prisma mock): `createInvoice` shape; `getStatus` for the two markers and for none; `setResult` calls `updateMany` with `where: { invoiceId, status: InvoiceStatus.pending }`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify and commit** `feat: add online payment rules and test provider`.

---

### Task 3: Online payments service

**Files:**
- Create: `src/online-payments/online-payments.service.ts`, `src/online-payments/online-payments.service.spec.ts`

**Interfaces:**
- Consumes: Task 2; `suggestAllocation`, `money`, `formatMoney`, `AMOUNT_PATTERN` (`src/finance/finance-calc.ts`); `applyAllocations` (`src/finance/allocations.ts`); `assertOwnChild` (`src/common/ownership.ts`); `assertChildInScope`, `scopeKind` (access); `ConfigService` for `ROOT_LOGIN`.
- Produces (used by Task 4):

```ts
@Injectable() export class OnlinePaymentsService {
  constructor(prisma: PrismaService, @Inject(PAYMENT_PROVIDER) provider: PaymentProvider, @Inject(ONLINE_PAYMENTS_CONFIG) config: OnlinePaymentsConfig, configService: ConfigService)
  config(): { enabled: boolean };
  payFromCabinet(parentId: string, childId: string, dto: { category: FinanceCategory; amount: string }): Promise<{ pageUrl: string }>;
  parentInvoice(parentId: string, invoiceId: string): Promise<{ status: InvoiceStatus; amount: string; category: FinanceCategory; paidAt: string | null }>;
  createLink(user: AuthenticatedUser, childId: string, dto: { category: FinanceCategory; amount: string; comment?: string }): Promise<{ id: string; url: string; expiresAt: string }>;
  listRequests(user: AuthenticatedUser, childId: string): Promise<RequestView[]>;
  cancel(user: AuthenticatedUser, id: string): Promise<RequestView>;
  publicLink(key: string): Promise<{ institution: string; payer: string; category: FinanceCategory; amount: string; status: LinkState; expiresAt: string | null }>;
  payLink(key: string): Promise<{ pageUrl: string }>;
  handleWebhook(provider: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<void>;
  testResult(invoiceId: string, result: 'success' | 'failure'): Promise<{ status: InvoiceStatus }>;
  syncPending(now?: Date): Promise<number>;
  expireRequests(now?: Date): Promise<number>;
  applyInvoiceStatus(invoiceId: string, status: ProviderStatus): Promise<void>;
}
export interface RequestView {
  id: string; category: FinanceCategory; amount: string; source: PaymentRequestSource; status: LinkState;
  comment: string | null; expiresAt: string | null; createdAt: string; paidAt: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  invoices: { id: string; invoiceId: string; status: InvoiceStatus; amount: string; failureReason: string | null; createdAt: string; paidAt: string | null }[];
}
```

Rules:
- Every create path first checks `config.enabled` → else 400 `Online payments are disabled`.
- Amount: must match `AMOUNT_PATTERN` (DTO does it) and be > 0 (`Amount must be greater than 0`).
- `payFromCabinet`: `assertOwnChild`; generate `rowId = randomUUID()` (it becomes `PaymentInvoice.id` and the provider `reference`), `redirectUrl = ${publicAppUrl}/family/${childId}?invoice=${rowId}`. Order: call `provider.createInvoice` first (outside the DB transaction), then in one `$transaction` create the request and the invoice row. If the provider throws → 502 `Payment provider error` and nothing is written (Review Focus 5). The request is `source cabinet`, `createdById parentId`, no expiry; the invoice row is created with `id: rowId`.
- `webhookUrl` passed to the provider = `${config.webhookUrl}/online-payments/webhook/${provider.kind}` or `null`.
- `destination` = `${CATEGORY_LABEL} — ${payerName}` with the Ukrainian category labels (`tuition` «Навчання», `adaptation` «Адаптація», `extra_classes` «Додаткові заняття», `meals` «Харчування»).
- `parentInvoice(parentId, id)`: load the invoice by our `id` with its request; the request's child must belong to the parent, else 404 `Invoice not found`; if `pending`, call `provider.getStatus(invoiceId)` and `applyInvoiceStatus`, then reload.
- `createLink`: `assertChildInScope(scopeKind(user), childId)` + child exists (404 `Child not found`); `newLinkKey()`; request `source link`, `linkTokenHash`, `expiresAt = linkExpiresAt(now)`, `comment`, `createdById user.id`; return `url = ${publicAppUrl}/pay/${key}`.
- `listRequests`: scope check; requests newest first with invoices (newest first) and creator names; `status` via `linkState(request, now)`.
- `cancel`: scope check through the request's child (404 `Payment request not found` when missing or outside scope); only `linkState === 'open'` → else 400 `Payment request is not open`; set `cancelled`, `cancelledAt`, `cancelledById`.
- `publicLink(key)`: find by `hashLinkKey(key)` → 404 `Payment link not found`; if `linkState` is `expired` and the DB status is still `open`, update it to `expired`; return the public view (`institution`, `payer` from the child's names, `category`, `amount`, `status`, `expiresAt`).
- `payLink(key)`: as above; `expired` → 400 `Payment link expired`; `paid`/`cancelled` → 400 `Payment request is not open`; else create an invoice exactly like the cabinet path (provider first, then the row) with `redirectUrl = ${publicAppUrl}/pay/${key}`.
- `applyInvoiceStatus(invoiceId, s)` — the core, in `$transaction`:
  1. `SELECT id FROM "PaymentInvoice" WHERE "invoiceId" = ${invoiceId} FOR UPDATE`; load the invoice with its request; missing → return.
  2. If invoice status is final → return (idempotent).
  3. `pending` → update `checkedAt` only; return.
  4. `failure` / `expired` → update status, `failureReason` (s.failureReason, or null for expired), `checkedAt`; return.
  5. `success`: if `s.amountKop !== invoice.amountKop` → `failure`, `failureReason 'amount mismatch'`; return. Else create `Payment` (fields from Global Constraints, `amount = fromKopecks(invoice.amountKop)`, `receivedAt = s.paidAt ?? now`); load the child's non-voided charges of the request's category with non-voided allocations; `suggestAllocation(charges, amount)`; when `lines` with `suggestedAmount > 0` exist, `applyAllocations(tx, payment.id, lines.map(l => ({ chargeId: l.chargeId, amount: l.suggestedAmount })).filter(a => money(a.amount).gt(0)), rootId)`; update the invoice (`success`, `paidAt`, `checkedAt`, `paymentId`, `failureReason null`) and the request (`paid`, `paidAt`) — the request is marked paid even if it was `expired`/`cancelled` meanwhile, because money arrived.
  6. Root id: `user.findUnique({ where: { login: ROOT_LOGIN } })` (cache per service instance); missing root → throw (the transaction rolls back and the next poll retries).
- `handleWebhook(providerName, raw, headers)`: provider name must equal `provider.kind` and online payments enabled, else 404; `verifyWebhook` → `null` → 401 `UnauthorizedException('Invalid signature')`; else `getStatus(invoiceId)` and `applyInvoiceStatus`.
- `testResult`: only when `config.provider === test` (else 404 `Invoice not found`); invoice must exist and be `pending` (else return its status); `TestProvider.setResult` (inject `TestProvider` optionally or cast via `provider.kind === test` and a type guard method `isTestProvider`), then `getStatus` + `applyInvoiceStatus`; return the new status.
- `syncPending(now)`: invoices `pending`; those with `invoiceExpired` → `applyInvoiceStatus(id, { status: expired, … })`; the rest → `getStatus` + `applyInvoiceStatus`; per-invoice errors are logged and skipped; returns the number processed.
- `expireRequests(now)`: `updateMany` `status open`, `expiresAt <= now` → `expired`; returns count.

- [ ] **Step 1: Failing tests** (Prisma as plain `jest.fn()` mocks; `$transaction` invokes the callback with the mock; provider as a plain object of mocks):
  - success creates one `Payment` with the exact fields, calls `applyAllocations` with the suggested lines for the category's charges only; a second call with the same success after the invoice became `success` creates nothing (mock the reload returning `status: success`); the `FOR UPDATE` raw query is issued first.
  - Review Focus 2: charges 200.00 + 100.00 of `meals`, payment 500.00 → allocations 200.00 and 100.00; `tuition` charges are not loaded (assert the `where.category`).
  - amount mismatch → invoice `failure` / `amount mismatch`, no payment.
  - failure keeps the request `open`.
  - `payLink` for an expired request → `Payment link expired`; cancelled → `Payment request is not open`; unknown key → `Payment link not found`.
  - provider throws in `createInvoice` → `BadGatewayException('Payment provider error')`, no `paymentRequest.create`/`paymentInvoice.create` call.
  - disabled config → `Online payments are disabled` for `payFromCabinet`, `createLink`, `payLink`.
  - `parentInvoice` for another family's invoice → `Invoice not found`.
  - Review Focus 4: config `{ provider: null, enabled: false }` and `{ provider: monobank, enabled: false }` → `config()` gives `enabled: false`, create paths throw `Online payments are disabled`, `testResult` throws `NotFoundException`.
  - `handleWebhook` with `verifyWebhook` → null → `UnauthorizedException`, no `getStatus`.
  - `syncPending` expires a 25-hour-old pending invoice and polls a fresh one.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify and commit** — `npx jest src/online-payments`, `npm test`, `npm run build`, eslint. Commit `feat: add online payments service`.

---

### Task 4: Controllers, scheduler, module, raw body

**Files:**
- Create: `src/online-payments/dto/online-payment.dto.ts` (`PayCategoryDto { category: FinanceCategory (IsEnum); amount: string (IsString, Matches AMOUNT_PATTERN) }`, `CreateLinkDto extends fields + comment?: string (IsOptional, IsString, MaxLength 500)`, `TestResultDto { result: 'success' | 'failure' (IsIn) }`), `src/online-payments/parent-online-payments.controller.ts`, `src/online-payments/staff-online-payments.controller.ts`, `src/online-payments/public-online-payments.controller.ts`, `src/online-payments/online-payments.scheduler.ts` (+spec), `src/online-payments/online-payments.module.ts`, `src/online-payments/online-payments.controllers.spec.ts`
- Modify: `src/app.module.ts`, `src/main.ts`

Routes:
- Parent controller `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.parent) @Controller('me')`: `POST children/:id/online-payments` (`ParseUUIDPipe` on `id`) → `payFromCabinet(user.id, id, dto)`; `GET online-payments/:invoiceId` → `parentInvoice(user.id, invoiceId)`.
- Staff controller `@UseGuards(JwtAuthGuard, RolesGuard)`: `POST children/:childId/payment-links` `@Permission(finance, edit)`; `GET children/:childId/payment-requests` `@Permission(finance, view)`; `POST payment-requests/:id/cancel` `@Permission(finance, edit)`.
- Public controller (no guards) `@Controller()`: `GET pay/:token`, `POST pay/:token/invoice`, `POST online-payments/webhook/:provider` (reads `req.rawBody` via `@Req() req: RawBodyRequest<Request>`; responds `{ ok: true }` with 200 via `@HttpCode(200)`), `POST online-payments/test/:invoiceId` (`@HttpCode(200)`), `GET online-payments/config`.
- Module providers: `OnlinePaymentsService`, `OnlinePaymentsScheduler`, `{ provide: ONLINE_PAYMENTS_CONFIG, useFactory: () => readOnlinePaymentsConfig(process.env) }`, `TestProvider`, `{ provide: PAYMENT_PROVIDER, useExisting: TestProvider }` (the monobank adapter will replace this factory later).
- Scheduler: `@Cron('*/2 * * * *')` → `syncPending()` when enabled (errors logged); `@Cron('30 0 * * *', { timeZone: 'Europe/Kyiv' })` → `expireRequests()`. Skip work when `!config.enabled`.
- `main.ts`: `NestFactory.create(AppModule, { rawBody: true })` — nothing else changes.

- [ ] **Step 1: Failing tests** — controllers spec (instantiate controllers with a mocked service): routes delegate with the right arguments; webhook passes `req.rawBody` and headers; `GET online-payments/config` returns the service value. Scheduler spec: disabled config → no service calls; enabled → `syncPending` called; an error is logged, not thrown. Guard metadata spec: staff routes carry `PERMISSION_KEY` with the right area/level (read metadata via `Reflector`), parent controller carries `ROLES_KEY` `[parent]`, public controller carries neither.
- [ ] **Step 2: Implement**, register `OnlinePaymentsModule` in `AppModule`.
- [ ] **Step 3: Verify and commit** — `npx jest src/online-payments`, `npm test`, `npm run build`, eslint. Commit `feat: add online payment routes and scheduler`.

---

### Task 5: Docs and live check

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md** — in `## Environment` add: `Optional online payments: PAYMENT_PROVIDER (test | monobank; empty disables), PAYMENT_WEBHOOK_URL (public base for webhooks; empty = polling only), PUBLIC_APP_URL (frontend base, default http://localhost:5173), INSTITUTION_NAME (default EduNest).` After `### Domain: reports` add:

```markdown
### Domain: online payments

Spec: `docs/superpowers/specs/2026-10-16-online-payments-design.md`. Code in `src/online-payments/`:

- `PaymentRequest` (child, category, amount; `cabinet` or 7-day `link` with only the SHA-256 of its key stored) has `PaymentInvoice` attempts at a `PaymentProvider` (`TestProvider` now; a monobank adapter later replaces the `PAYMENT_PROVIDER` factory). Pure rules (kopecks, expiry, payer name, link keys) live in `online-payments-calc.ts`.
- Status arrives by webhook (signature verified, then `getStatus`; the body is never trusted) or by polling every 2 minutes; both call `applyInvoiceStatus`, which locks the invoice row and is idempotent. Success creates a confirmed `Payment` (`method online`, `externalId = invoiceId`, `createdById null`) auto-allocated to the category's oldest charges (allocations by root); an amount mismatch credits nothing.
- Routes: parents `POST /me/children/:id/online-payments`, `GET /me/online-payments/:invoiceId`; staff `POST /children/:childId/payment-links`, `GET /children/:childId/payment-requests`, `POST /payment-requests/:id/cancel` (finance); public `GET /pay/:token`, `POST /pay/:token/invoice`, `POST /online-payments/webhook/:provider`, `POST /online-payments/test/:invoiceId` (test provider only), `GET /online-payments/config`. `main.ts` enables `rawBody` for webhooks.
- Manual payments accept `cash`, `bank_transfer`, `card`.
```

- [ ] **Step 2: Full verification** — `npm run build && npm test && npx eslint src/online-payments src/finance src/children`.
- [ ] **Step 3: Live check (PORT=3101, `PAYMENT_PROVIDER=test`, `PUBLIC_APP_URL=http://localhost:5173` in the server process env only)** — root login (credentials from `.env`, never printed). Use a test family: create a parent «Тест О Батько» (login `test_online_parent`, phone required) and a child «Тест О Дитина» linked to them, a manual `meals` charge 300.00 split as two charges (200.00 + 100.00) for the child; log in as the parent (change password first):
  1. `GET /online-payments/config` → `enabled: true`.
  2. `POST /me/children/<child>/online-payments` `{ category: meals, amount: '500.00' }` → `pageUrl` ends with `/pay/test/test_…`; `POST /online-payments/test/<providerInvoiceId>` `{ result: 'success' }` → `success`; `GET /children/<child>/finance` (as root): meals charges paid, meals prepayment 200.00, one online payment.
  3. Repeat the same test call → still `success`; finance unchanged (one payment).
  4. As root: `POST /children/<child>/payment-links` `{ category: meals, amount: '50.00' }` → `url`; `GET /pay/<key>` (no cookies) → `payer` = child first name + first letter of last name + ".", `status open`; `POST /pay/<key>/invoice` → `pageUrl`; mark `failure` → request still open; second invoice → `success` → `GET /pay/<key>` → `paid`; `POST /pay/<key>/invoice` → 400 `Payment request is not open`.
  5. New link → `POST /payment-requests/:id/cancel` → `GET /pay/<key>` → `cancelled`; random key → 404 `Payment link not found`.
  6. Restart the server without `PAYMENT_PROVIDER`: `GET /online-payments/config` → `enabled: false`; `POST /pay/<key>/invoice` → 400 `Online payments are disabled`; test route → 404.
  Stop the server; list created ids (they stay in the DB for the user to remove).
- [ ] **Step 4: Commit** `docs: document online payments`.

---

### Task 6: Frontend

**Repo:** `D:\IT\EduNest` (read its `CLAUDE.md` first).

**Files:**
- Create: `src/shared/api/onlinePayments.ts`, `src/pages/pay/index.ts`, `src/pages/pay/ui/PayLinkPage.tsx`, `src/pages/pay/ui/TestBankPage.tsx`, `src/pages/familyChild/ui/PayDialog.tsx`, `src/pages/familyChild/ui/PaymentReturnBanner.tsx`, `src/pages/finance/ui/PaymentLinkModal.tsx`, `src/pages/finance/ui/OnlinePaymentsTab.tsx`
- Modify: `src/shared/api/index.ts`, `src/shared/api/finance.ts` (`PaymentMethod` adds `'card'`, label «Картка»), `src/shared/api/errorMessages.ts`, `src/pages/finance/ui/CreatePaymentModal.tsx` (`manualMethods` adds `'card'`), `src/pages/familyChild/ui/ChildFinanceTab.tsx` (pay buttons, banner), `src/pages/familyChild/ui/FamilyChildPage.tsx` (open the finance tab when `?invoice=` is present), `src/pages/finance/ui/ChildFinancePage.tsx` (link button + tab), `src/app/router/index.tsx` (top-level public routes `pay/test/:invoiceId` and `pay/:token`, outside `RequireAuth`, declared before `/`), `CLAUDE.md`

**Interfaces:**
- Consumes: backend routes and shapes of Tasks 3–4.
- Produces: `onlinePaymentsApi` with `config()`, `payCategory(childId, { category, amount })`, `invoiceStatus(invoiceId)`, `createLink(childId, { category, amount, comment? })`, `requests(childId)`, `cancel(id)`, `publicLink(token)`, `payLink(token)`, `testResult(invoiceId, result)`; types `InvoiceStatus`, `LinkState`, `PaymentRequestView`, `PublicLink`.

UI rules:
- Cabinet finance tab: for each category tile with `due > 0` or always when enabled, button «Оплатити» (only when `config().enabled`); `PayDialog` with category (fixed) and amount (default = category due, `TextField` validated against `^\d{1,8}(\.\d{1,2})?$` and ≥ 1.00) → «Перейти до оплати» → `window.location.assign(pageUrl)`.
- `PaymentReturnBanner`: when `?invoice=<id>` is in the URL, show «Оплата обробляється…», poll `invoiceStatus` every 3 s up to 20 times; `success` → «Оплату зараховано» and reload the child finance; `failure`/`expired` → «Оплата не пройшла. Спробуйте ще»; still pending after 1 minute → «Статус ще не підтверджено. Оновіть сторінку пізніше». Remove the `invoice` param from the URL after a final state.
- `PayLinkPage` (`/pay/:token`, no app shell): card with institution, «Оплата за: <категорія>», «Дитина: <payer>», amount, «Оплатити» (`payLink` → redirect). States: `paid` «Сплачено. Дякуємо!», `cancelled` «Посилання скасоване», `expired` «Посилання прострочене», 404 «Посилання недійсне». After returning from the bank (the page reloads) poll `publicLink` every 3 s up to 1 minute while a payment may be processing (a session flag set before redirect), showing «Оплата обробляється…».
- `TestBankPage` (`/pay/test/:invoiceId`): title «Тестовий банк», text «Це імітація сторінки оплати», buttons «Оплатити» / «Відхилити» → `testResult` → then `window.history.back()` is NOT used; instead show «Готово, поверніться на сайт» with a link to `/` (the real return happens through polling on the origin page).
- Staff `ChildFinancePage`: button «Посилання на оплату» (with `finance: edit`) → `PaymentLinkModal` (category select, amount default = category due, comment) → shows the URL, «Копіювати» (`navigator.clipboard.writeText`), expiry date; tab «Онлайн-оплати» (`finance: view`): requests table (дата, категорія, сума, джерело «Кабінет»/«Посилання», статус, хто створив), expandable attempts (статус, сума, причина), «Скасувати» for open requests (`finance: edit`).
- Labels: request statuses `open` «Очікує оплати», `paid` «Сплачено», `cancelled` «Скасовано», `expired` «Прострочено»; invoice statuses `pending` «Обробляється», `success` «Успішно», `failure` «Відхилено», `expired` «Прострочено».
- Translations: `Online payments are disabled` «Онлайн-оплата вимкнена», `Payment link not found` «Посилання не знайдено», `Payment link expired` «Посилання прострочене», `Payment request is not open` «Запит на оплату вже закритий», `Payment provider error` «Помилка платіжної системи. Спробуйте пізніше», `Invoice not found` «Оплату не знайдено».

- [ ] **Step 1: Branch and baseline**

```bash
cd /d/IT/EduNest && git checkout main && git checkout -b feature/online-payments
npx tsc -b > "C:/Users/Nazarii/AppData/Local/Temp/claude/D--IT-backend-edu-nest/31e78eb4-44dc-4019-b870-0e93f1689d7a/scratchpad/fe-tsc-baseline-online.txt" 2>&1
```

- [ ] **Step 2: API client and labels.**
- [ ] **Step 3: Cabinet dialog, banner, tab switch.**
- [ ] **Step 4: Public pages and routes.**
- [ ] **Step 5: Staff modal, tab, card method, translations, CLAUDE.md paragraph.**
- [ ] **Step 6: Verify and commit** — per-file tsc counts equal the baseline; eslint 0 errors on touched files; `git status --short` first, add files by name.

```bash
git commit -m "feat: add online payments to cabinet and finance"
```
