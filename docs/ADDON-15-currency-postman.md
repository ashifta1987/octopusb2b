# Add-on: Postman API partner and USD ↔ CNY currency

The same text as docs/SPEC.md section 15, kept here so the two Antigravity prompts are easy to find.

## 15. Addendum: Postman API partner and USD ↔ CNY currency

Added 1 Nov 2026. Where this section conflicts with earlier text ("USD only"), this section wins.

### 15.1 Platform currency: USD or Chinese yuan (CNY)

Admin can switch the whole platform between US dollars and Chinese yuan. One currency is active at a time; USD is the default.

| Area | Rule |
| --- | --- |
| Setting | `site_settings.platform_currency` = `USD` or `CNY`. Only Admin can request a change; Finance approves (maker–checker); every change goes in the audit log |
| Storage | Every amount is `amount_minor` (bigint) + `currency` (char(3)). No column is named after a currency |
| Exchange rate | Admin sets the rate in `fx_rates` (base USD, quote CNY, `rate numeric(12,6)`, `effective_from`, `set_by`, `source` manual or reference). The daily job only fetches a reference rate to compare; billing uses only the approved rate |
| Documents | Quotes, PIs, invoices, orders, service requests and ad campaigns lock their currency and rate when created. A later switch never changes them; they are paid in their own currency |
| Catalogue | Price tiers keep the currency they were entered in (1688 suppliers often quote CNY). The storefront converts to the platform currency at the approved rate with rounding settings; the quote locks the converted amount |
| Service prices | `service_prices` holds a price per currency. With no CNY price set, the system converts from USD and marks it "converted" in Services & charges |
| Wallet | One wallet per organisation per currency (`wallets (org_id, currency)` unique). Charges use the wallet in the platform currency. On a switch, admin chooses: keep old balances spendable, or convert all balances at the switch rate through a conversion journal shown on each customer's ledger |
| Ledger | Each journal balances per currency; cross-currency moves post both legs through an `fx_conversion` account with the rate |
| Payments | The switch is blocked unless the active payment and bank adapters support CNY; Integrations shows "CNY supported" per adapter |
| Display | Code + symbol to avoid confusion with Japanese yen: "US$ 190.00", "CN¥ 1,368.00", via `Intl.NumberFormat`. Texts such as "All prices in USD" on the designs come from CMS with a `{currency}` variable |
| Reports | Finance shows each currency separately, plus a total converted at the approved rate and labelled as converted |
| API and webhooks | Amounts are `{ "amount_minor": 19000, "currency": "USD" }`; `GET /v1/settings/currency` returns the currency and current rate; webhook `settings.currency_changed` |

Switch workflow (`currency_switch_requests`: draft → pending\_approval → scheduled → applied / cancelled):

1. Admin → Settings → Currency: choose CNY, enter the rate, choose the wallet option, choose the effective time.
2. Impact preview: open quotes and PIs (they stay in USD), wallet balances, active ad budgets, services without a CNY price, payment adapter support.
3. Finance approves (the requester cannot).
4. At the effective time a job applies it: updates the setting, converts wallets if chosen, revalidates storefront caches, shows a site banner, emails customers, sends the webhook.
5. Switching back to USD uses the same flow.

UI: new screen `/admin/currency`, built in the style of `docs/design/WalletAdmin.png`; storefront top bar shows the active currency.

### 15.2 Postman as the API partner

Postman is where customers, Shopify and Wix app builders, and our own team discover, try and test the Octopus B2B API.

- **Public workspace** "Octopus B2B API" on the Postman API Network with the OpenAPI 3.1 definition, the collection "Octopus B2B API v1" (folders: Auth, Catalog, RFQs & quotes, Orders, Shipments, Wallet & ledger, Service requests, Webhooks, Settings), a separate supplier API collection, and environments Sandbox and Live (variables `base_url`, `client_id`, `client_secret`, `access_token`, `currency`, shipped empty).
- **Auth built in:** a collection-level pre-request script fetches and caches the OAuth client-credentials token; each request has tests for status code, response schema and that every amount carries a currency.
- **Examples:** saved example responses for every endpoint, generated from seed data.
- **Developer page:** "Run in Postman" button, link to the public workspace, and a download fallback on `/account/developer`.
- **Repository is the source:** on every release, CI regenerates OpenAPI from the Zod contracts and pushes the definition and collections to the workspace through the Postman API (`POSTMAN_API_KEY`, workspace and collection IDs as secrets). Nobody edits the collections by hand in Postman.
- **Testing:** the Postman CLI (or Newman) runs the collection against every Vercel preview in CI; a Postman monitor runs the sandbox collection on a schedule and alerts on failure.
- **Webhooks:** an example request and mock server show how to verify the `Octopus-Signature` header.
- **Admin:** a Postman card in Admin → Integrations with workspace and collection IDs, API key (in Vault), last sync time and result, "Sync now", and monitor status.
- **Safety:** real customer keys never go into shared Postman environments.

### 15.3 Antigravity prompts for this addendum

When to run them: if P4 and P5 are not built yet, add "Also apply docs/SPEC.md section 15.1" to the P4 and P5 prompts, then run 15-A after P5 to finish the admin screen and tests. If they are already built, run 15-A now. Run 15-B with or right after P9.

**Prompt 15-A — Admin currency switch (USD ↔ CNY)**

```
Read docs/SPEC.md section 15.1 (it overrides earlier "USD only" text) and sections 5, 6 (Money) and 9. Make the platform currency switchable between USD and CNY:
1. Migration: replace every amount_usd_cents column with amount_minor bigint + currency char(3) (backfill 'USD'); add currency and fx_rate_id to quotes, proforma_invoices, orders, service_requests and ad_campaigns; make wallets unique on (org_id, currency); create fx_rates and currency_switch_requests; add site_settings platform_currency and currency_rounding; add an fx_conversion ledger account and a check that every journal balances per currency.
2. Postgres functions: current_platform_currency(), convert_amount(amount_minor, from_currency, to_currency, fx_rate_id), request/approve/apply for currency_switch_requests (draft -> pending_approval -> scheduled -> applied/cancelled) with maker-checker approval, audit log and a pg_cron job that applies scheduled switches.
3. Update approve_quote, wallet_debit_for_service, record_payment and ad click charges to lock currency and rate and to use the wallet in the platform currency. Block a switch when the active payment adapter does not support CNY.
4. Build /admin/currency in the style of docs/design/WalletAdmin.png: current currency, rate history, new-rate form, switch wizard with impact preview (open quotes and PIs, wallet balances, ad budgets, services without CNY price), wallet option keep or convert, effective time, approval status.
5. MoneyField and every price use Intl.NumberFormat with the record's currency (US$ / CN¥). Replace "All prices in USD" texts with CMS text using a {currency} variable. Show the active currency in the storefront top bar and a banner after a switch.
6. PDFs, statements, emails, finance reports (per currency plus a labelled converted total) and the public API ({amount_minor, currency}, GET /v1/settings/currency, webhook settings.currency_changed) follow these rules.
Tests: pgTAP that journals balance per currency, old documents keep their currency after a switch, and a maker cannot approve their own switch. Playwright on staging: switch USD -> CNY and check storefront prices, a new quote and PI, a wallet charge, a PDF, then switch back.
```

Done when: after a switch to CNY, new quotes and invoices are in CNY at the approved rate; an older USD PI can still be paid in USD; ledger and statements balance per currency; switching back to USD works.

**Prompt 15-B — Postman API partner**

```
Read docs/SPEC.md sections 7 (Public API, Supplier API) and 15.2. Make Postman our official API partner:
1. Generate OpenAPI 3.1 from the Zod contracts in packages/contracts and, from it, two Postman collections (public v1 and supplier v1) with the folders in 15.2, saved examples from seed data, a collection-level pre-request script that fetches and caches the OAuth client-credentials token, and tests for status, schema and a currency on every amount. Add Sandbox and Live environments with empty secret values.
2. Add scripts/postman-sync.ts and a GitHub Actions job that, on each release, pushes the OpenAPI definition and both collections to our Postman workspace through the Postman API using POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID and the collection IDs from repository secrets.
3. Run the public collection with the Postman CLI (or Newman) against every Vercel preview and fail the build on errors.
4. Add a webhook-verification example request and a mock-server example for the Octopus-Signature header.
5. On /account/developer (docs/design/Developer.png) add a "Run in Postman" button, a link to the public workspace and a download fallback. On /admin/integrations (docs/design/Integrations.png) add a Postman card: workspace and collection IDs, API key stored in Supabase Vault, last sync time and result, Sync now, monitor status.
The repository is the source of truth: never edit the collections by hand in Postman.
```

Done when: a release updates the public Postman workspace automatically; a new developer can fork the collection, add sandbox keys and list products within 5 minutes; CI fails when an endpoint breaks its schema.
