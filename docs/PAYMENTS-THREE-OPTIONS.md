# Payments (3 Options for Every Service) & Multi-Company Architecture

## 1. Three Payment Options Across Every Service

Every customer checkout across all 8 services (**Product Sourcing `SRC`**, **Make My Brand `MMB`**, **MOQ Pools `POOL`**, **Turnkey `TK`**, **3PL Warehousing `3PL`**, **Dropshipping `DS`**, **Advertising**, and **SaaS Subscriptions**) uses the shared `<ChooseHowToPay />` component (`components/account/choose-how-to-pay.tsx`) offering up to three options controlled by the **Finance › Payment settings** matrix (`payment_option_settings`):

1. **Option 1 — Pay now**
   - Immediate settlement via online payment aggregator (**Mock** on staging, **Stripe** and **Airwallex** when keys are set), real wallet balance, or confirmed bank transfer.
   - An online payment is confirmed **only** from a signature-verified webhook (`POST /api/webhooks/payments/{mock|stripe|airwallex}` → `confirm_aggregator_webhook`), never from a browser redirect.
2. **Option 2 — Payment protection**
   - Customer label: *"Payment protection — we hold your payment until [milestone]"* (never called "escrow" on customer screens).
   - Funded upfront via any Pay-now method and booked to the dedicated liability account `hold_prot:<org>` (**"Held (payment protection)"**), **never** Revenue.
   - Customer sees a 4-step status bar (`Paid → Held → Milestone reached → Released / Refunded`) and can click **"Open a dispute"** before release to freeze the held funds.
   - On release, `execute_escrow_action_internal` debits `hold_prot:<org>`, credits revenue/receivable, and issues the `OCT-[div]-[year]-[seq]` tax invoice **once** (`escrow_holds_one_invoice_idx`).
   - Releases or refunds above `payments.approval_threshold_cents` (default **US$ 1,000.00** = `100000` cents) require two-person Finance approval (`proposed_by <> approved_by` enforced in the database).
   - Switched **OFF** by default for **SaaS** and **Advertising**.
3. **Option 3 — Pay later (Net credit terms)**
   - Separate from wallet balance: `wallet_available()` returns real wallet funds only.
   - Requires `organizations.kyc_status = 'verified'` and an active `customer_credit_terms` row.
   - Credit limits **always** require two-person Finance approval (`constraint customer_credit_terms_two_person check ((status = 'pending_approval') or (approved_by is not null and approved_by <> proposed_by))`), whatever the amount.
   - Atomic row locking (`FOR UPDATE` on `organizations` and `customer_credit_terms`) prevents concurrent orders from exceeding the customer's credit limit.
   - **Goods (`SRC`, `MMB`, `TK`, `POOL`, `DS`):** At order confirmation, `checkout_pay_later` only **reserves** the amount in `credit_reservations`. The `OCT-` tax invoice with `due_at` and the `ar:<org>` receivable journal are issued at **shipment** (`trg_orders_pay_later`). If cancelled before shipment, the reservation is released automatically.
   - **Dropshipping:** Issues one `OCT-DS-` invoice per order at shipment, plus a weekly statement (`generate_dropship_weekly_statement`).

---

## 2. Payment Provider Adapters & Required Environment Variable Names

All adapters implement `PaymentProviderAdapter` (`lib/payments/types.ts`):
- `lib/payments/providers/mock.ts`
- `lib/payments/providers/stripe.ts`
- `lib/payments/providers/airwallex.ts`

### Exact Environment Variable Names

| Provider | Environment Variable Names | Notes |
| --- | --- | --- |
| **Mock** (Staging default) | `PAYMENT_MOCK_WEBHOOK_SECRET` | Refused when `APP_ENVIRONMENT === 'production'`. Falls back to a staging-only HMAC secret derived from `BACKUP_CALLBACK_SECRET` on staging. |
| **Stripe** | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`<br>`STRIPE_SECRET_KEY`<br>`STRIPE_WEBHOOK_SECRET` | Refuses `sk_live_` keys when `APP_ENVIRONMENT === 'staging'`. Webhook route: `/api/webhooks/payments/stripe`. |
| **Airwallex** | `AIRWALLEX_CLIENT_ID`<br>`AIRWALLEX_API_KEY`<br>`AIRWALLEX_WEBHOOK_SECRET`<br>`AIRWALLEX_ENV` | Set `AIRWALLEX_ENV=demo` on staging and `AIRWALLEX_ENV=prod` on production (refuses `prod` on staging). Webhook route: `/api/webhooks/payments/airwallex`. |

---

## 3. Multi-Company (`legal_entities`) & Per-Entity Document Counters

- Table `legal_entities` stores company legal name, registration number, tax ID, address, logo key, default currency, and `active_from` date.
- Today everything defaults to **`Shenzhen Octopus Trading Co., Ltd.`** (`00000000-0000-0000-0000-000000000001`).
- Every document (`documents`), proforma (`proforma_invoices`), bank account (`company_bank_accounts`), payment (`payments`, `document_payments`), checkout (`payment_checkouts`), and hold (`escrow_holds`) records its `legal_entity_id`.
- `document_counters` has primary key `(entity_id, series, year)` so each legal entity has its own gap-free `OCT-[div]-[year]-[seq]`, `CN-[div]-[year]-[seq]`, and `PF-[year]-[seq]` series.
- Switching the default entity is controlled by `site_settings` key `legal_entity.switch_schedule` (`null` today); historical documents retain their original `legal_entity_id` forever.
