# Addendum brief — SPEC §15 (currency USD ↔ CNY + Postman)

Read docs/AGENT_BRIEF.md first (all rules still apply: own paths only, no package.json edits/installs, no next dev/build, no git commit, tsc + eslint on your files).
Then read docs/SPEC.md section 15 (15.1 currency, 15.2 Postman).

## Already done by the lead (DB is migrated on the live project — read supabase/migrations/20261101000060_currency.sql)
- Columns: every money record has `currency char(3)` ('USD'|'CNY'); `*_cents` columns are generic MINOR units of that row's currency.
  Renamed: service_prices.amount_usd_cents → amount_minor, service_requests.fee_usd_cents → fee_minor, rfqs.fee_usd_cents → fee_minor.
  Locked currency + fx_rate_id on quotes, proforma_invoices, orders, service_requests, ad_campaigns. Also currency on payments, wallet_topups,
  wallet_withdrawals, documents, finance_approvals, payouts, price_tiers, products, shipments, ad_clicks, ledger_accounts, ledger_entries.
- `fx_rates(id, base 'USD', quote 'CNY', rate numeric (CNY per 1 USD), effective_from, set_by, source 'manual'|'reference', note)` — billing uses latest manual.
- site_settings: platform_currency ("USD"/"CNY"), currency_rounding, currency_switch_banner (null or {from,to,rate,applied_at,wallet_option}).
  content_blocks: "All prices in {currency}" (replace `{currency}` with the active code via `withCurrency()`).
- SQL functions: current_platform_currency(), current_fx_rate_id(), convert_amount(minor, from, to, fx_rate_id?), service_price_info(code, currency?) → (amount_minor, currency, converted), current_service_price(code, currency?), my_wallet_balance(p_currency?) (defaults to platform currency), view `wallets` (org_id, currency, account_id, balance_minor; security_invoker).
  Currency switch: set_fx_rate(p_rate, p_note, p_effective_from) [admin], currency_switch_impact(p_to) → jsonb, request_currency_switch(p_to, p_rate, p_wallet_option 'keep'|'convert', p_effective_at, p_note) [admin], approve_currency_switch(p_id) [finance:approve, not requester; applies immediately if effective_at <= now], cancel_currency_switch(p_id, p_reason); table currency_switch_requests (status draft|pending_approval|scheduled|applied|cancelled, impact jsonb, requested_by, approved_by, …). pg_cron applies scheduled switches every 5 min. Applying emits outbox event `settings.currency_changed`.
  payment_supports_currency(code) reads integrations.config.currencies (payment + email rows have ["USD","CNY"]).
  Reporting RPCs now return a trailing `currency` column: admin_wallet_balances(), admin_revenue_by_stream() (+ net_converted_minor in platform currency), admin_ledger_check() (one row per currency), admin_geography() (gmv converted to platform currency, + currency).
  All business RPCs (submit_rfq, request_service, send_quote, approve_quote, record_payment, request_topup, confirm_topup, finance approvals, ad clicks) already lock/use the right currency.
- Shared helpers (use them):
  - `lib/format.ts`: `money(minor, currency, {compact})` → "US$ 190.00" / "CN¥ 1,368.00"; `asCurrency()`, `CURRENCIES`, `CURRENCY_PREFIX`, `convertMinor(minor, from, to, rate, step)`, `withCurrency(text, cur)`. `usd()` is deprecated (= money(x,'USD')) — replace usages in your files with money(x, row.currency).
  - `components/ui.tsx`: `<Money cents currency={row.currency} />` (currency defaults to USD — ALWAYS pass the record's currency).
  - `lib/currency.ts`: `getCurrencyContext()` → { currency, rate, fxRateId, rateFrom, rounding, banner } (cached, tags 'currency' + 'site-content'); `toPlatform(ctx, minor, fromCurrency)`.
  - After changing currency settings/rates call `revalidateTag('currency','max')` and `revalidateTag('site-content','max')` (+ 'products', 'service-prices').
- Tests: `node supabase/tests/currency.test.mjs` (switch flow) and `node supabase/tests/rls.test.mjs` must stay green.

Rule of thumb: display every stored amount with ITS OWN currency column. Catalogue prices (price_tiers.currency) are converted to the platform currency for display with toPlatform(). Aggregates across currencies: show per currency + a total converted to the platform currency at the approved rate, labelled "converted".

