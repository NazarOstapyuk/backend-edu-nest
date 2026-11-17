# Cash desk («Каса») design

## Intent

The customer (TODDLER: kindergarten + primary school) wants full control of physical cash. Administrators take cash from parents, spend it, hand it to the director or owner, and recount it at the end of a shift. The manager must be able to open the CRM at any moment and see how much cash the responsible employee should hold right now and the result of the last physical recount, with every movement attributed to a person and nothing deletable.

Success: the manager sees the expected balance, today's income/expenses/transfers, the last counted amount and the difference; every closed shift has a report; discrepancies, big withdrawals, payment voids/corrections and unclosed shifts show up in the CRM without anyone telling them.

## Goals

- Cash desks with shifts: open (accept the cash), operate, recount by denominations, close with explanation of any difference.
- Cash payments of children are recorded once (the existing child payment) and land in the open shift automatically.
- Withdrawals: expenses of the institution and transfers to people (director, owner, other staff) kept apart; transfers need confirmation by the recipient.
- Split by direction: kindergarten / school / shared, one physical balance.
- No deletes; mistakes fixed by voiding inside an open shift or by a correction entry, all visible to the manager.
- Separate rights for operating the desk and for controlling it.
- In-CRM alerts for the manager (no email/Telegram/push).
- Cash report in the reports page with Excel export.

## Non-goals

- Receipt photos (no file storage yet; added later with an external storage decision).
- Notifications outside the CRM.
- Salary paid in cash (payroll payments) moving through the desk.
- Refunds linked to a child's finance card (a refund is recorded as an expense with the child named in the comment).
- Desk-to-desk transfers, multiple currencies.

## Anti-goals

- Entering the same cash payment twice (once in the child card, once in the desk).
- Any way for an administrator to change a closed shift or remove an operation.
- Counting transfers to the director as institution expenses.

## Decisions

### Rights

Two new permission areas, added to `PermissionArea` and to positions like every other area:

- `cash`: `view` sees the cash page (current state of desks, operations of open and closed shifts, shift reports); `edit` opens and closes shifts, records expenses and transfers, voids entries of an open shift. This is the administrator.
- `cash_control`: `view` gets the cash report, the alerts (dashboard key `cash` + menu badge) and can acknowledge alerts; `edit` adds correction entries and manages desks (create, rename, deactivate, settings). This is the manager. Root has everything as usual.

Desks are not tied to institutions; access scope does not filter desks. Child payments keep their existing scope rules.

### Data

`CashDesk { id, name unique, isActive, largeAmount Decimal (default 5000.00), closeBy String "HH:mm" (default "20:00"), createdAt }`. A migration creates one desk «Каса».

`CashShift { id, deskId, openedById, openedAt, openingExpected Decimal, openingCounted Decimal, openingNote String?, closedAt?, closedById?, closingExpected Decimal?, closingCounted Decimal?, denominations Json?, closingNote String?, totals Json? }`. At most one open shift per desk (partial unique index on `deskId` where `closedAt IS NULL`). `totals` is a snapshot at close: income, expenses, transfers, corrections, per direction.

`CashEntry { id, deskId, shiftId, kind CashEntryKind, amount Decimal (always positive), direction CashDirection, expenseCategory CashExpenseCategory?, paymentId String? unique, recipientId String?, transferStatus CashTransferStatus?, transferNote String?, confirmedAt?, sign Int? (correction only: +1 / -1), correctsId String?, comment String?, createdById, createdAt, voidedAt?, voidedById?, voidReason? }`.

- `CashEntryKind`: `income` (from a cash child payment), `expense`, `transfer`, `correction`.
- `CashDirection`: `kindergarten`, `school`, `shared`.
- `CashExpenseCategory`: `household` (господарські потреби), `materials` (закупівля матеріалів), `supplier` (оплата постачальнику), `refund` (повернення коштів батькам), `other`.
- `CashTransferStatus`: `pending` («Очікує отримання»), `confirmed`, `disputed` («Не отримано»).

`CashAlert { id, deskId, shiftId?, entryId?, type CashAlertType, amount Decimal?, createdAt, acknowledgedAt?, acknowledgedById? }` with types `shift_closed`, `discrepancy`, `large_withdrawal`, `payment_void`, `correction`, `transfer_disputed`, `opening_discrepancy`. The «unclosed shift» alert is computed live, not stored.

Payment gets `payerName String?`, `periodFrom Date?`, `periodTo Date?`. `FinanceCategory` gets `individual_lessons`, `deposit`, `events`, `other` (enum values added in their own migration, before any use). «Абонемент садка» / «Абонемент школи» is `tuition` split by direction in reports, not a new category.

Amounts are `Decimal(10,2)`, compared and summed with the existing `money`/`sumMoney` helpers.

### Balance

- Expected balance of an open shift = `openingCounted` + non-voided `income` − `expense` − `transfer` ± `correction` (by `sign`).
- Opening a shift: `openingExpected` = last closed shift's `closingCounted` (0 for the first shift). The opener confirms with a count (denominations or a total, same input as closing); a difference needs `openingNote` and creates an `opening_discrepancy` alert. This records the handover: previous `closedById` handed over, `openedById` accepted.
- Closing: the server computes `closingExpected`, the client sends denominations (counts per value), the server computes `closingCounted`. A non-zero difference requires `closingNote` (min 5 chars) and creates a `discrepancy` alert; every close creates `shift_closed`. After close the shift and its entries are read-only for everyone.
- Denominations in UAH: 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.10 (notes and coins of the same value are one row).
- Direction is stored on each entry. Income: from the child's group institution type (`kindergarten` → kindergarten, `school_class` → school), `shared` when the child has no group. Expense, transfer, correction: chosen by the user, default `shared`.

### Integration with child payments

- `POST /children/:id/payments` with `method: cash` requires `cashDeskId`; the desk must have an open shift (400 `No open cash shift`). In the same transaction an `income` entry is created in that shift. Non-cash payments never touch the desk and are reported separately.
- Voiding a cash payment: if its entry's shift is open, the entry is voided with the same reason; if the shift is closed, a `correction` entry with `sign -1` and `correctsId` is created in the open shift of the same desk (400 `No open cash shift` when none). Both create a `payment_void` alert.
- Online payments (provider) are non-cash and unchanged.
- Cash payments recorded before this feature have no entry; voiding them does not touch any desk.

### Operations

- Expense / transfer: amount > 0, direction, comment (expense: category required, comment required for `other`; transfer: recipient = active staff user, not the creator). Amount ≥ desk `largeAmount` creates `large_withdrawal`. Amount may exceed the expected balance? No: 400 `Not enough cash` (the balance cannot go negative).
- Void entry: only `cash: edit`, only while the shift is open, reason required; income entries are voided only through the payment void. Voided entries stay in lists, struck through.
- Correction: `cash_control: edit`, open shift required, sign, amount, direction, reason (comment required), optional `correctsId`; creates `correction` alert.
- Transfer confirmation: the recipient (any staff role, no permission area needed) confirms or disputes with a note. Disputed creates `transfer_disputed`. Status does not change the balance: the money left the desk when the transfer was recorded.
- Every mutation goes through the existing audit log (routes are audited automatically; add Ukrainian labels on the frontend).

### API (backend module `src/cash`)

- `GET /cash/desks` (cash view) desks with current state: open shift (opener, openedAt), opening, income/expense/transfer/correction totals, expected, last closed shift (counted, difference, closedAt, closedBy), per-direction totals.
- `POST /cash/desks`, `PATCH /cash/desks/:id` (cash_control edit).
- `POST /cash/desks/:id/shifts` open (cash edit) `{ denominations?, counted?, note? }`.
- `GET /cash/shifts?deskId&from&to&userId` (cash view) list; `GET /cash/shifts/:id` report: shift, all entries with payment/child/group/payer/category, totals.
- `POST /cash/shifts/:id/close` (cash edit) `{ denominations, note? }`.
- `POST /cash/desks/:id/entries` (cash edit) expense or transfer; `POST /cash/desks/:id/corrections` (cash_control edit).
- `POST /cash/entries/:id/void` (cash edit) `{ reason }`.
- `GET /cash/transfers/mine` (staff) pending transfers to me; `POST /cash/entries/:id/confirm`, `POST /cash/entries/:id/dispute` `{ note }` (recipient only).
- `GET /cash/alerts` and `POST /cash/alerts/:id/ack`, `POST /cash/alerts/ack-all` (cash_control view).
- `GET /reports/cash` (cash_control view): filters period, desk, employee, child, group, kind (kindergarten/school), category, direction, entry kind; sheets: operations, by category (payments cash and non-cash), by expense category, by direction, by employee, shifts with differences. Excel via the existing writer.
- Dashboard: `cash` key for cash_control view (unacknowledged alerts + unclosed shifts: open shift from an earlier Kyiv day, or today after `closeBy`), `cashTransfers` key for any staff with pending transfers to them.

### Frontend

- `pages/cash`, menu «Каса» in section «Гроші», area `cash` (also shown with `cash_control`). Tabs: «Зараз», «Зміни», «Налаштування» (cash_control edit).
- «Зараз»: per desk a card: responsible person and since when, big expected balance, tiles «На початок зміни», «Надходження», «Видатки», «Передано», «Останній перерахунок» (amount, time, difference coloured), per-direction mini table. Actions: «Відкрити зміну» / «Прийняти оплату» (child picker → the existing payment form with method cash and the desk preselected), «Видати кошти» (expense), «Передати кошти» (transfer), «Закрити зміну». Below, operations of the open shift with void.
- Count dialog (open and close): one row per denomination with a number input, live total, expected, difference, explanation field required when the difference is not zero.
- «Зміни»: list of shifts with filters; a shift opens its report (header: desk, opened/closed by and when, opening, totals, expected, counted, difference with explanation, denominations; all operations) with «Завантажити Excel».
- Payment form (`CreatePaymentModal`): new fields «Платник» (required in the UI), «Період з/по» (optional), new categories; method cash shows «Каса» (desks with an open shift; one = preselected and hidden; none = warning and the form cannot be saved with cash). Payment lists show the payer and period.
- Recipient: «Очікують отримання» block on the Today page (`cashTransfers`) with «Отримав» / «Не отримав».
- Manager: «Потребує уваги» rows for `cash` alerts with «Переглянуто», menu badge with the count.
- Reports: new tab «Каса».
- Positions editor gets the two new areas with labels «Каса» and «Контроль каси».

## Approaches considered

1. **Ledger of entries + shifts (chosen).** Every movement is an immutable entry, balance is computed from entries of the open shift plus the last counted amount, closed shifts keep a snapshot. Audit-friendly and matches "no deletes, corrections with history".
2. **Running balance column on the desk updated on each operation.** Simpler reads, but the balance can drift from the operations and corrections are hard to explain; rejected.
3. **Cash only as a report over child payments + a separate expenses list, no shifts.** Cheapest, but no recount, handover or closed reports, which are the core of the request; rejected.

## Left to the builder

- Exact shape of response DTOs and calc helpers (keep pure calc in `cash-calc.ts` with unit tests, like other modules).
- Excel sheet layout details following the existing reports.
- UI details within the brand rules in the frontend `CLAUDE.md`.
