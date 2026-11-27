# Octopus B2B — Project memory (Sourcing + Dropshipping)

Last updated: 25 Nov 2026. Read this before any work. It records what is built, what was decided and the rules that always apply.

---

## 1. The project

- Company: Shenzhen Octopus Trading Co., Ltd. (default legal entity `SZ-OCTOPUS`). A Hong Kong company is planned and will hold the main bank account (Airwallex + Stripe later).
- App: Next.js 16 + Supabase + Vercel. Live: https://www.hostoctopus.com. Staging: `staging` branch (Vercel preview, protected) and `staging.hostoctopus.com` (Shopify-only paths; everything else blocked by WAF).
- Divisions: Sourcing (SRC), 3PL, Shipping (SHIP), Make My Brand (MMB), Dropshipping (DS), Finance (FIN), Support (SUP). One app, one database. Do not split into separate apps.
- Design package: `docs/design/dropship-v2/` (`screens/`, `mobile/`, `staff/`, `states/`, `specs/`, `README.md`, `UI-RULES.md`). Every build step has a "Match:" list of design files. Early access, staff rates/duty/requests and store-connection states have their own boards (EA_*, StaffRateCards, StaffDutyEntries, StaffRequests, States-Stores).
- Master build prompt: `docs/design/dropship-v2/COMPLETE-SYSTEM-PROMPT.md` (releases 1–5).

## 2. Rules that always apply

1. Staging first. Nothing goes to live without the owner's explicit "go" and a release plan.
2. Release method: live backup (`db-backup.mjs --live`) → read-only baseline (ledger debit/credit, wallets, key counts) → clean `git archive` + `vercel deploy --prod --skip-domain` (remote build; never `--prebuilt`, never pull prod env to disk) → `db-migrate.mjs --live` → checks → `vercel promote` + revalidate → merge `main` last.
3. Before ANY live step: the FULL Playwright suite + all DB suites pass on staging. A subset is not enough. Any migration not in the approved plan stops the release.
4. Every migration has a `.down.sql`; `check-migration-roundtrip.mjs` up → down diff must be EMPTY. Ledger diff = 0; wallet totals unchanged.
5. Rollback: promote the previous deployment and fix forward. Down files only within the first hour, only if that migration itself failed, and never if it would delete issued financial documents (STMT-DS, OCT-, CN-, PF-).
6. Never sign in to live with any account and never create accounts on live. Live checks = read-only SQL or rolled-back SQL with a simulated JWT. The owner checks screens himself.
7. Secrets (API secrets, encryption keys, `.env*`) are set by the owner in Vercel/local files only. Never print, store or commit them.
8. White-label: customers, merchants and buyers never see supplier/factory names or codes, Sourcing model numbers, Octopus cost or margin — on pages, JSON, PDFs, exports, image file names or URLs. Staff see supplier/cost only with the right permission (`suppliers:view`, cost/finance), not by role name.
9. Pay later is internal only (Octopus group companies and test accounts, `organizations.credit_eligible`, set by admin with a reason). Never shown to other customers, not even disabled.
10. No fake data shown as real. Placeholder pages say what is coming.
11. Card data only on the payment provider's hosted page. Bank details live in Admin › Payment settings, not in code.
12. Never delete data on live without the owner's OK. Archive / mark `is_seed` instead.

## 3. Architecture decisions

- One owner per kind of data: Sourcing = suppliers and purchase cost; shared `item_master` = HS code, origin, weight, box size, restricted flags; 3PL = stock (`warehouse_stock` + append-only `warehouse_stock_movements`); Shipping = rate cards, labels, tracking; DS = listings, store orders; Finance = money, holds, invoices, legal entities; Support = one shared ticket desk.
- `item_master`: one row per physical sellable unit. `products.item_id` and `dropship_variants.item_id` point to it; a Dropship product made from a Sourcing product reuses the same item. HS code has one writer (item_master); `hs_verified` only by an explicit staff action. Missing weight/box = `needs_data`, never 0.
- Cross-division work: `division_handoffs` + `domain_events` outbox (pg_cron every minute, retries, dead-letter) + `status_mappings` table (with target: order / request / brand_project / ticket).
- Shipments, escrow holds and payment checkouts point to either a B2B order or a store order (`order_id` XOR `store_order_id`).

## 4. Business rules

- Payments: Pay now (aggregator / wallet / bank transfer), Payment protection (hold, released 7 days after delivery; invoice issued on release), Pay later (internal only).
- Codes: Sourcing requests `RFQ-<n>` (e.g. RFQ-1042); service/sample requests `SRV-`; never `SR-`. Dropship model numbers `DS-000001`, variants `DS-000001-01`, generated, locked, never reused. Documents: `PF-` proforma, `OCT-[div]-[year]-[seq]` invoice, `CN-` credit note, `STMT-DS-` weekly Dropship statement.
- Landed cost = product + processing + shipping + duties (if DDP). Processing fee charged once per order (first item + each extra item). Combined parcel billed weight = max(total actual weight, total box volume ÷ divisor), rounded up to 100 g; divisor default 5000, stored per carrier service. Weighing tolerance 50 g / 10%, 7-day dispute window.
- Duties: DDP/DAP set only on Packing and shipping; US defaults to DDP. The US has NO de minimis (suspended for all countries since 29 Aug 2025; indefinitely for all modes since 24 Jun 2026). Unknown duty = "not known yet", never 0. Duty entries per country + HS prefix, with `de_minimis_applies_to` (duty / duty_and_tax).
- Dropship access: KYC-verified company → access request → staff approve/reject with reason. Access status on / paused / off (no "trial"). Losing KYC pauses automatically. Paused/closed: no new activity; orders in progress, wallet, withdrawals, statements, support and export keep working.
- Seller profile (brand + return address) must be staff-approved before any label. Labels are also refused while the item's HS code is unverified or the product needs review.
- Product requests from merchants are free (`dropship_request` = 0). Sample orders: wallet only, 1–3 units, processing fee applies, refused if DDP duty unknown, shown on STMT-DS.
- Stock shown to merchants as labels only. Volume price tiers are per order, USD only.
- Plan fees (SaaS): `saas_billing_settings.enabled = false` until Finance's two-person switch (Step 12b); then 30-day free trial, one per organisation; Shopify merchants billed through Shopify's Billing API.
- Unpaid store orders expire after 3 days (configurable). Buyer name/phone/address deleted 60 days after delivery, except what invoices must keep. Buyer email is never stored.

## 5. Where things stand

- Live: migrations up to 217. `main` = f72c41c. `dropship_v2_ui` OFF (customers see "Coming soon"). 0 dropship merchants, 0 rate cards, 0 fee versions, so nothing can be published on live.
- Staff data work open on live: 316 products need weight + box size; 313 HS codes need staff verification.
- Batch 1 (white-label + permissions) is live. 106 original product images are still public and backed up in the private bucket `product-media-backup`; decide on 2 Dec whether to make them private or delete them.
- Staging: migration 218 (Batch 2: Payment protection / Pay now for Dropship orders) at 300d310. Release it together with Batch 3 (unless Batch 3 touches payments).
- Built so far: S0-fix, U1 shells, I1a item master + DS model numbers, I1b rate cards / fees / duty / 3PL stock, I2 store orders / handoffs / outbox / status map, Step 2 + 2a staff catalogue + Sourcing structured fields, Step 3 merchant catalogue / landed cost / requests / samples, Step 4 access + onboarding + staff merchants, Batch 1, Batch 2.

## 6. Next

1. Batch 3 from the Sourcing/Dropship audit: list the 18 remaining white-label findings (customer-facing first), fix the stale payments test rollback, honest placeholders on blank pages (e.g. `/account/dropship/pricing`), the factory-audit request type in `/admin/services`, status label consistency. Then release Batch 2 + 3 together.
2. Step 5 Shopify: waiting on the owner (GoDaddy DNS for staging, Shopify CLI login, staging app in the Dev Dashboard, secrets in Vercel). Then the 4-test spike on a development store, then the Step 5 plan.
3. Steps 6, 6b, 7–8, 9, 10, 11, 12 + 12b, 13 — each with its Match list.

## 7. Shopify decisions

- Public app (unlisted at first), created in the Shopify Dev Dashboard; config and webhooks in `shopify.app.toml` / `shopify.app.staging.toml` via CLI. Embedded (App Bridge, session tokens). API version 2026-10.
- Scopes (least privilege): read/write_products, read_locations, read/write_inventory, read_shipping, read_orders, read/write_assigned_fulfillment_orders, read/write_fulfillments; plus write_third_party_fulfillment_orders if the spike confirms option 3.
- Order intake: expected option 3 — on orders/paid our app submits and accepts the fulfillment request only for items at the "Octopus Dropship" location (store-wide auto-fulfill would mark the merchant's own items fulfilled). Confirm with the spike.
- Expiring offline tokens (60 min) + 90-day refresh tokens, encrypted with `SHOPIFY_TOKEN_ENCRYPTION_KEY` (separate keys for staging and production).
- Protected customer data Level 2: name, address, phone only.
- Disconnect: stock to 0 first (automatic), hiding listings is an opt-in tick box, then delete credentials. Compliance webhooks handled; shop data deleted 48 h after uninstall except financial records.
- App Review: privacy policy needed first (live `/legal/privacy` is still a placeholder); review demo org with $0 wallet, top-ups blocked, no fake money on live.

## 8. Owner decisions still open

Processing fee amount, weighing tolerance, insurance (on/off), plan prices and limits, duty-difference policy, carrier display names, which company invoices (SZ vs HK) and prefixes, the full privacy policy text (legal review).

## 9. Owner to-do

Second 2FA phone; Resend app emails (launch blocker); pay Google Workspace (support@ mailbox must work); GitHub off-site backup failing since 10 Nov; Stripe/Airwallex live keys once the HK company exists; YunExpress live keys (`YUNEXPRESS_MODE=live`, `YUNEXPRESS_CUSTOMER_NO`, `YUNEXPRESS_API_SECRET`, `YUNEXPRESS_WEBHOOK_SECRET`); switch on credit_eligible for group/test companies; Shopify setup above.
