# Octopus B2B — Project memory (Sourcing + Dropshipping)

Last updated: 26 Nov 2026 (staging state after EA-1 / EA-2). Read this before any work. It records what is built, what was decided and the rules that always apply.

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

- Live 27 Nov 14:45: ALL customer data wiped on the owner's explicit instruction ("wipe all customer data include money"): 8 companies, 8 customer logins, 25 journals / 50 ledger entries (ledger now empty), 6 top-ups, 5 RFQs, 12 service requests, 3 pools, 4 Turnkey leads, 5 Turnkey client projects, KYC rows + 5 KYC files. Kept: 10 suppliers, 347 products, Turnkey catalogue, settings, 2 staff. Backup backups/live-pre-customer-wipe-20261127-1442. 3 gmail logins without a company are KEPT (owner 27 Nov: "no, that is live").
- Live 27 Nov 11:45 (redesign release, NO migrations): commit b9e981b, deployment octopus-b2b-i1mdif5b7 (rollback: octopus-b2b-9h7gy6j94). Design handoff + brand guidelines: Rubik fonts, Ink/Coral/Pearl, owner's original B2B logo, six function logos, catalogue under Octopus Sourcing, announcement bar removed, people-free team band until a real team photo. Full suite green (unit 432, integration 43, DB 75/75, Playwright 260/260). Ledger/wallets unchanged. Backup backups/live-pre-redesign-20261127-1138. Note: /office/dropship/fees and /health stay closed while dropship_v2_ui is OFF on live, so the fee version can only be approved on live after the flag is switched on (or the guard is relaxed for staff).
- Live 27 Nov 01:30: migrations up to 249 (246 DS10, 247 DS12, 248 DS14 Release 6, 249 DS16 owner decisions; commit 20a8213; backup `backups/live-pre-ds14-ds16-20261127-0126`; ledger and wallets unchanged; Dropship still hidden). Earlier release (26 Nov "Turnkey + Warehouse OS"): migrations up to 245 (218 → 245 applied in order from commit fc7aba2; backup `backups/live-pre-turnkey-3pl-20261126-2008`). Turnkey v2 live with the owner's 300 projects + photos (`node scripts/seed-turnkey-catalogue.mjs --live`; 25 old projects archived). Warehouse OS live (FS-01 active, SZ-01 closed, legacy 3PL screens retired). Ledger unchanged (275,752 = 275,752), wallets unchanged (USD 252,500), RLS on all 290 tables. `dropship_v2_ui` unset = OFF; `dropship_features` inserted with merchant-only features (stores/orders/billing… OFF). Dropship 246 (DS10), 247 (DS12) and Release 6 are staging only.
- Earlier: `main` = f72c41c before this release. 0 dropship merchants, 0 rate cards, 0 fee versions, so nothing can be published on live.
- Staff data work open on live: 316 products need weight + box size; 313 HS codes need staff verification.
- Batch 1 (white-label + permissions) is live. 106 original product images are still public and backed up in the private bucket `product-media-backup`; decide on 2 Dec whether to make them private or delete them.
- Staging (not live yet): 218 Batch 2 (Payment protection / Pay now for Dropship orders), 219 demo-wipe keeps fee-history users, 220 Batch 3 (status labels, quotes, staff product requests, factory audit), 221 EA-1 (staff fees, two-person rate cards + price-list imports, duty entries with second-person confirm, customs value policy, request queue), 222 EA-2 (merchant feature list `site_settings.dropship_features`, public Dropship page). Batch 2 + 3 go live together on the owner's "go"; EA-1 + EA-2 follow with Release 1.
- Built so far: S0-fix, U1 shells, I1a item master + DS model numbers, I1b rate cards / fees / duty / 3PL stock, I2 store orders / handoffs / outbox / status map, Step 2 + 2a staff catalogue + Sourcing structured fields, Step 3 merchant catalogue / landed cost / requests / samples, Step 4 access + onboarding + staff merchants, Batch 1, Batch 2, Batch 3, EA-1, EA-2 (staging).
- Decisions 25 Nov 2026 (Release 1 Step 0 delta): in the merchant app during early access, OFF features are hidden and redirect (no "coming soon"); rule 10 still applies to staff pages and ON features. Rate cards are edited by 3PL & Shipping editors, DS editors and admins (one "3PL & Shipping" division), Finance views, Support has no access; staff never publish a card directly (proposal + second person). Duty / customs policy publish: admin, DS editors, Finance approvers, always a second person. Price lists: CSV only for now. Customs block threshold: not set yet.

## 6. Next

1. Owner "go" for the Batch 2 + 3 live release (218 → 219 → 220; set the Factory audit price).
2. Release 1 launch checklist: Batch 2+3 live, EA-1 + EA-2 live (221, 222), active fee version (owner's numbers), rate cards for the launch countries, confirmed duty entries, N products published with complete data + verified HS, privacy policy + terms published, `dropship_v2_ui` ON, owner end-to-end test. Rollback = flag OFF.
3. Step 5 Shopify: waiting on the owner (GoDaddy DNS for staging, Shopify CLI login, staging app in the Dev Dashboard, secrets in Vercel). Then the 4-test spike on a development store, then the Step 5 plan.
4. Releases 2–5 per the master prompt, each with a Step 0 plan and its Match list.

## 7. Shopify decisions

- Public app (unlisted at first), created in the Shopify Dev Dashboard; config and webhooks in `shopify.app.toml` / `shopify.app.staging.toml` via CLI. Embedded (App Bridge, session tokens). API version 2026-10.
- Scopes (least privilege): read/write_products, read_locations, read/write_inventory, read_shipping, read_orders, read/write_assigned_fulfillment_orders, read/write_fulfillments; plus write_third_party_fulfillment_orders if the spike confirms option 3.
- Order intake: expected option 3 — on orders/paid our app submits and accepts the fulfillment request only for items at the "Octopus Dropship" location (store-wide auto-fulfill would mark the merchant's own items fulfilled). Confirm with the spike.
- Expiring offline tokens (60 min) + 90-day refresh tokens, encrypted with `SHOPIFY_TOKEN_ENCRYPTION_KEY` (separate keys for staging and production).
- Protected customer data Level 2: name, address, phone only.
- Disconnect: stock to 0 first (automatic), hiding listings is an opt-in tick box, then delete credentials. Compliance webhooks handled; shop data deleted 48 h after uninstall except financial records.
- App Review: privacy policy needed first (live `/legal/privacy` is still a placeholder); review demo org with $0 wallet, top-ups blocked, no fake money on live.

## 8. Owner decisions still open

Weighing tolerance, insurance (on/off), plan limits (prices stay unset), 3PL rate amounts, Turnkey terms text, duty-difference policy, carrier display names, which company invoices (SZ vs HK) and prefixes, the full privacy policy text (legal review).

## 9. Owner to-do

Second 2FA phone; Resend app emails (launch blocker); pay Google Workspace (support@ mailbox must work); GitHub off-site backup failing since 10 Nov; Stripe/Airwallex live keys once the HK company exists; YunExpress live keys (`YUNEXPRESS_MODE=live`, `YUNEXPRESS_CUSTOMER_NO`, `YUNEXPRESS_API_SECRET`, `YUNEXPRESS_WEBHOOK_SECRET`); switch on credit_eligible for group/test companies; Shopify setup above.

## 10. Programme decisions (26 Nov 2026, approved)

- Three pieces of work: Turnkey rebuilt to `docs/design/turnkey-v2/`; 3PL & logistics replaced by Warehouse OS (`docs/design/warehouse-os/`, Foshan); Octopus Dropship completed.
- D1: Dropship design v2 + master prompt stay the source of truth for Releases 2–5; v3-only screens (`docs/design/dropship-v3/`: supplier portal, partners, extra channels, admin plans/invoicing/docs) become Release 6; v3 Warehouse/Label boards are replaced by Warehouse OS; plan prices stay unset until confirmed.
- D2 order: Warehouse OS W0–W4 first (Turnkey alongside), then Dropship Releases 2–3 on top, then W5–W7, then Dropship 4–5.
- D3 Turnkey leads are kept and moved into new projects at "Enquiry"; old catalogue tables archived as legacy, never dropped. D4 `/turnkey` URL kept, old URLs redirect. D5 2× admin approval applies to service fees only; deposit % from settings. D6 inspector offline mode later.
- D7 carrier rules and client rates: two-person rule, admin approves. D8 3PL client plans are separate from the Dropship processing fee. D9 3PL clients are existing KYC organisations plus the 3PL application. D10 B2B order shipping moves into Warehouse OS; `/office/shipping` retired in W7. D11 default warehouse becomes Foshan (FS-01); stock moves only by new movements.
- Warehouse OS and Turnkey uploads are text descriptions; board exports (HTML/PNG) requested for Match checks.

## 11. Owner decisions (26 Nov 2026, evening) — settings, never hard-coded

**Turnkey**
- Deposit 30% of the quote; 50% for custom/branded orders. Balance due before shipment.
- Legal name: Shenzhen Octopus Trading Co., Ltd. (via `legal_entities`; switch to the HK entity later).
- Terms text: owner provides it (until then "provided on request").

**3PL client rates** — structure confirmed, amounts still blank: receiving per carton, storage per CBM per month, pick & pack per order + per extra item, packaging, returns. Until filled: "not set", nothing billed.

**Dropship**
- Processing fee: US$1.20 first item + US$0.40 each extra item (a fee version, published with the two-person rule).
- Plan prices: unset; `saas_billing_settings` stays OFF.
- Shipping: rate cards = YunExpress cost. The merchant's shipping line = cost + shipping markup 10% (a setting; changing it needs two people).
- Launch countries: AE, SA, GB, US. US = DDP, no de minimis.
- Privacy policy + terms: owner provides reviewed text.
- Email: Resend. Owner sets up the domain (SPF/DKIM in GoDaddy) and puts the key in Vercel. Sender no-reply@hostoctopus.com, reply-to support@hostoctopus.com. Env vars: `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.
- Refund rules:
  - Cancel before packing: full wallet refund. After packing: not cancellable.
  - Lost: no tracking movement for 15 days → reship or wallet refund.
  - Damaged or wrong item: photos within 7 days of delivery → reship or refund.
  - Buyer remorse: the merchant's own policy; the merchant pays return shipping.
  - Re-weigh disputes: within 7 days.
  - Refunds go to the wallet by default.
  - Claims over US$1,000 need a second Finance approver.

**Release 6 (supplier direct shipping)**
- Packing slip: Dropship orders carry the merchant's brand only (no supplier, no prices, no "Octopus"). B2B Sourcing orders use the Octopus slip.
- Two-person approval for a new supplier approval and for any supplier bank-detail change. Routine product updates need one approver.
- Supplier price changes:
  - Decreases are auto-approved.
  - Increases up to 3% are auto-approved and staff are notified.
  - Above 3%, or over 5% in total within 30 days, staff review.
  - Already-quoted prices never change.


## 12. Owner decisions (27 Nov, afternoon)
- CH-1 Shop: the built defaults stand (owner: "you can delete the 5 shop questions"): sourcing fee charged once per quote-list request; "customisable"/"samples" are staff-ticked product tags; wallet visible in the Shop bar like /account; turnkey cards say timeline/MOQ "in your quote"; staff opening / see the public website.
- The 3 company-less gmail logins on live stay.
- 27 Nov 19:24: NEW THEME = ODS 1.0 (docs/design/dropship-v2/NEW-THEME-MASTER-PROMPT.md wins over older prompts). Owner chose the FULL ODS palette and font (Inter, navy #1A174A, blue #2A6FD1, teal #5FD3C9, canvas #F4F6F9), replacing the Rubik + Ink/Coral/Pearl look live today. Work in steps T0–T11 behind flag ods_theme_v1; T0 (route audit) first, then wait for "go" before T1. Rule from the prompt: never sign in to or create accounts on live from now on.
- 27 Nov 19:24: next live release = homepage Dropship card fix + C0 (250) + 251 tables, with the Shop switched OFF on live (shop_enabled). The quote-list Shop stays on staging; ODS replaces it with the Cart.
- 27 Nov 20:21: owner "t1" = GO for ODS T1 with all six T0 recommendations: ODS logo files added (function logos only on service heroes later, no per-area logo swap); flag ods_theme_v1 (off|staff|beta|all, tokens scoped under [data-theme=ods]); packages/ui as tsconfig alias @octopus/ui; signed-in visitors on / see the intro page with "Go to my shop"; route renames with 308s (/services/*, Turnkey keeps /turnkey; /onboarding → /welcome/setup; /account/sourcing → /account/requests); teal accent used.
- 27 Nov 20:44: owner "go t2, no need to ask permission, go ahead": continue the ODS steps (T2 onwards) on staging without asking between steps; report each step with screenshots and tests. Live releases still follow the release method with full suite green.

- Live 27 Nov 23:58 (commit b1488f6, deployment octopus-b2b-m6ct0q7qv; rollback octopus-b2b-i1mdif5b7): migrations 250 (C0 connector foundation) + 251 (CH-1 tables) applied; homepage Dropship card shows Open now; Shop OFF on live (shop_enabled unset → /shop redirects to /account). Full suite on production build: unit 509, integration 43, DB 77/77, Playwright 273/274 (the one was a test bug, fixed). Backup backups/live-pre-c0-ch1-20261127-2352. Checks read-only (no live sign-in per ODS rule 4).
- 28 Nov 04:15: Owner: card provider (T5b checkout), Shopify connector and Google sign-in are done LAST, after ODS go-live (owner is setting up Google OAuth himself). Second Finance user: yes; the owner adds it on live via Admin > Staff (we never create live accounts). Restart pending Dropship work + connectors that need no keys (store-link portal, WooCommerce, key-paste platforms, CSV connector, carrier layer, connector health, tracking page); migrations 260+ for connectors, 257–259 reserved for ODS.
