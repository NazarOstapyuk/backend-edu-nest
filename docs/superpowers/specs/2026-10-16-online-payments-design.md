# Online payments design

Date: 2026-10-16. Status: approved in brainstorming, awaiting spec review.

Part 4 of the roadmap (last part). Builds on the finance ledger (`docs/superpowers/specs/2026-10-11-finance-design.md`), which already keeps tuition, adaptation, extra classes and meals as separate categories and reserves `PaymentMethod.online`, `PaymentStatus.pending/failed` and `Payment.externalId` for this part.

## Goal

Parents pay by card online, from the parent cabinet or from a payment link an admin sends them, per finance category. Successful payments become ordinary confirmed `Payment`s allocated to the category's oldest charges. A built-in test provider imitates the bank now; a monobank acquiring adapter (the same API the toddler bot uses: `invoice/create`, `invoice/status`, webhook with `X-Sign`) plugs in later without changing the rest. Cash, bank transfer and card payments entered by hand keep working, with a new manual method «Картка».

## Decisions

| Topic | Decision |
|---|---|
| Scope now | Full online flow with a test provider; real monobank adapter later (Q1 B) |
| What parents pay | A category's debt, amount editable (partial or prepayment), auto-allocated to the oldest charges of that category (Q2 A) |
| Payment link | Random unguessable key, single use, cancellable, valid 7 days; public page shows institution, «Ім'я П.», category, amount (Q3 B) |
| Status channels | Webhook (signature verified, status re-queried from the provider) plus polling of pending invoices; both call one idempotent function (approach 1) |
| Manual card | New `PaymentMethod.card` for card payments entered by staff |

## Data model

- `PaymentMethod` gains `card`. `CreatePaymentDto.method` accepts `cash`, `bank_transfer`, `card` (not `online`).
- `PaymentRequest`: `id`, `childId`, `category` (`FinanceCategory`), `amount` Decimal(10,2), `source` (`cabinet` | `link`), `status` (`open` | `paid` | `cancelled` | `expired`), `linkTokenHash` (nullable, unique; SHA-256 hex of the link key), `comment` (nullable, ≤ 500), `expiresAt` (nullable; links only), `createdById` (User, nullable, `SetNull`), `createdAt`, `paidAt` (nullable), `cancelledAt`/`cancelledById` (nullable). Indexes: `childId`, `status`.
- `PaymentInvoice`: `id`, `requestId`, `provider` (`test` | `monobank`), `invoiceId` (unique, provider's id), `pageUrl`, `amountKop` Int, `status` (`pending` | `success` | `failure` | `expired`), `failureReason` (nullable), `paidAt` (nullable, provider time), `checkedAt` (nullable), `paymentId` (nullable, unique → `Payment`), `createdAt`. Indexes: `requestId`, `status`.
- Money: `amount` Decimal in code; `amountKop = amount × 100` as an integer computed from the Decimal (never JS float arithmetic).

## Flow

1. **Cabinet.** A parent opens a child's finance and presses «Оплатити» next to a category. Amount defaults to the category's debt, editable, ≥ 1.00 and matching `AMOUNT_PATTERN`. Backend creates a `PaymentRequest` (`source cabinet`, no expiry) and a `PaymentInvoice`, returns `pageUrl`; the browser goes there.
2. **Link.** An admin creates a link for a child, category, amount (defaults to the category's debt) and optional comment. Backend creates a `PaymentRequest` (`source link`, `expiresAt = now + 7 days`) and returns `url = ${PUBLIC_APP_URL}/pay/<key>` once (the key itself is never stored). The payer opens the page and presses «Оплатити»: an invoice is created then (each press is a new attempt).
3. **Status.** Webhook or polling calls `applyInvoiceStatus(invoiceId, providerStatus)` in one transaction:
   - lock the invoice row (`SELECT … FOR UPDATE`); if already `success` → no-op;
   - `success`: if the provider amount ≠ `amountKop` → `failure` with `failureReason = 'amount mismatch'`, nothing is credited; otherwise create `Payment` (`method online`, `status confirmed`, `category` of the request, `amount`, `reference = invoiceId`, `externalId = invoiceId`, `receivedAt = paidAt`, `createdById null`, note `Онлайн-оплата`), allocate it with `suggestAllocation` to that category's oldest open charges (remainder stays a prepayment), set invoice `success` + `paymentId`, request `paid` + `paidAt`;
   - `failure` / `expired`: set on the invoice; the request stays `open`;
   - `pending`: only `checkedAt` changes.
4. Two successful invoices for one request (two tabs) both become `Payment`s — money received is always recorded; the second is a prepayment visible on the card.
5. Requests past `expiresAt` become `expired` (nightly job, and lazily when opened). `open` requests can be cancelled by staff (`cancelled`); cancelling does not affect invoices already paid.
6. Polling: every 2 minutes, `pending` invoices created in the last 24 hours are re-queried via `getStatus`; older `pending` invoices become `expired`. The parent's status endpoint also re-queries a pending invoice on demand.

## Backend

- Module `src/online-payments/` (registered in `AppModule`), reusing `src/finance/` (`suggestAllocation`, allocation helpers, `money`, `AMOUNT_PATTERN`).
- `PaymentProvider` interface:
  - `createInvoice({ amountKop, reference, destination, redirectUrl, webhookUrl }) → { invoiceId, pageUrl }`
  - `getStatus(invoiceId) → { status: 'pending' | 'success' | 'failure' | 'expired', amountKop: number | null, paidAt: Date | null, failureReason: string | null }`
  - `verifyWebhook(rawBody: Buffer, headers) → { invoiceId } | null`
- `TestProvider`: stores nothing outside the DB; `pageUrl = ${PUBLIC_APP_URL}/pay/test/<invoiceId>`; its status is driven by `POST /online-payments/test/:invoiceId`; `verifyWebhook` is not used.
- Configuration (`.env`, all optional): `PAYMENT_PROVIDER` (`test` | `monobank`; empty disables online payments → 400 `Online payments are disabled`), `PAYMENT_WEBHOOK_URL` (public base for webhooks; empty → polling only), `PUBLIC_APP_URL` (frontend base; default `http://localhost:5173`), `INSTITUTION_NAME` (default `EduNest`). The webhook route needs the raw body: enable Nest `rawBody: true` in `main.ts` (CORS, ValidationPipe, cookies, JWT untouched).
- Pure rules in `online-payments-calc.ts` (status transitions, Decimal ↔ kopecks, expiry, payer display name «Олена І.», link key generation/hash), tested without mocks.

## API

Parent (`@Roles(Role.parent)`, `assertOwnChild`, 404 `Child not found`):
- `POST /me/children/:id/online-payments` `{ category, amount }` → `{ pageUrl }`.
- `GET /me/online-payments/:invoiceId` → `{ status, amount, category, paidAt }` (only invoices of the parent's children; 404 `Invoice not found`); re-queries the provider when `pending`.

Staff (`@Permission(finance, edit)` to create/cancel, `view` to list; scope via the child's group):
- `POST /children/:childId/payment-links` `{ category, amount, comment? }` → `{ id, url, expiresAt }`.
- `GET /children/:childId/payment-requests` → requests (newest first) with their invoices and the creator's name.
- `POST /payment-requests/:id/cancel` → the updated request (400 `Payment request is not open`).

Public (no guard):
- `GET /pay/:token` → `{ institution, payer, category, amount, status, expiresAt }`.
- `POST /pay/:token/invoice` → `{ pageUrl }` (400 `Payment request is not open`, 400 `Payment link expired`).
- `POST /online-payments/webhook/:provider` → 200 always after verification; invalid signature → 401, nothing changes.
- `POST /online-payments/test/:invoiceId` `{ result: 'success' | 'failure' }` → `{ status }`; 404 unless `PAYMENT_PROVIDER=test`.
- `GET /online-payments/config` → `{ enabled }`.

Redirects: cabinet invoices return to the child's finance page in the cabinet with `?invoice=<id>`; link invoices return to `/pay/<token>`.

Security: link keys are 32 random bytes (base64url), stored only as SHA-256; unknown and other-family keys answer the same 404 `Payment link not found`; public responses never include ids, debts or contacts; the webhook body is never trusted (signature, then `getStatus`). Audit events of public and webhook routes have no actor.

## Frontend

- Parent cabinet, child finance: «Оплатити» per category (shown when `GET /online-payments/config` says enabled); dialog with category and amount (default = debt, min 1.00) → «Перейти до оплати». On return with `?invoice=` a banner «Оплата обробляється…» polls every 3 s up to 1 minute, then «Оплату зараховано» (finance reloads) or «Оплата не пройшла. Спробуйте ще».
- Public page `/pay/:token` (no login, no sidebar): institution, «Оплата за: <категорія>», «Дитина: <payer>», amount, «Оплатити»; states «Сплачено», «Посилання недійсне», «Посилання скасоване», «Посилання прострочене», «Оплата обробляється…».
- Test bank page `/pay/test/:invoiceId`: amount and «Оплатити» / «Відхилити».
- Staff, child finance card: «Посилання на оплату» dialog (category, amount defaulting to the category's debt, comment) → link with «Копіювати» and expiry; tab «Онлайн-оплати» with requests, statuses, attempts and «Скасувати».
- Manual payment form: method «Картка» added.
- New messages translated: `Online payments are disabled`, `Payment link not found`, `Payment link expired`, `Payment request is not open`, `Payment provider error`, `Invoice not found`.

## Errors (new messages)

| Status | Message |
|---|---|
| 400 | `Online payments are disabled` |
| 404 | `Payment link not found` |
| 400 | `Payment link expired` |
| 400 | `Payment request is not open` |
| 502 | `Payment provider error` |
| 404 | `Invoice not found` |

## Testing

- `online-payments-calc.spec.ts` (no mocks): kopecks (`1250.50` ↔ `125050`, no float drift), transitions, expiry, payer name, key hash.
- Service specs: `applyInvoiceStatus` idempotent (second success creates no second payment); success creates a confirmed `Payment` allocated to the category's oldest charges; amount mismatch credits nothing; failure keeps the request open; expired/cancelled request refuses a new invoice; another family's child → 404; bad webhook signature → 401 and no change; test endpoint → 404 when the provider is not `test`; provider error → 502 `Payment provider error`.
- Live check on a scratch port with `PAYMENT_PROVIDER=test`: cabinet payment lowers the category debt and allocates; link payment; repeated success call leaves the balance unchanged; expired and cancelled links.

## Out of scope

The real monobank adapter (next task, once a merchant token and a public webhook address exist), refunds, fees, fiscal receipts (ПРРО), sending links via Viber/Telegram/SMS.
