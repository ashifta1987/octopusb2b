# MASTER PROMPT — Complete Octopus Dropship (releases 1–5)

You are completing the Octopus Dropship system inside the Octopus B2B app (Next.js 16 + Supabase + Vercel; live www.hostoctopus.com; staging branch `staging`).

Before anything else, read `PROJECT-MEMORY.md` (repo root), `docs/design/dropship-v2/README.md` and `docs/design/dropship-v2/UI-RULES.md`. Replace `docs/design/dropship-v2/` with the latest design package first. They hold the rules, decisions and current state. If this prompt and the memory file disagree, stop and ask.

---

## A. How every step runs (no exceptions)

1. **Step 0 plan first.** For each step, send a SHORT plan: screens and routes, RPCs, tables and migration number, tests, the Match list, and anything you need from the owner. Then WAIT for the owner's OK. No code before the OK.
2. **Build on staging only.** Migrations are numbered in order from 221. Each has a `.down.sql`, and `check-migration-roundtrip.mjs` shows an EMPTY diff.
3. **Done means:**
   - typecheck clean and lint 0 errors;
   - ALL unit, integration and DB suites pass, plus the FULL Playwright suite (never a subset);
   - the Phase 1 crawl shows 0 white-label hits and 0 real server errors;
   - axe clean at 1280 px and 390 px;
   - ledger debit = credit, and wallet totals unchanged.
4. **Report.** For each step: what changed, files, migration, test counts, before/after, screenshots of each Match screen (desktop + mobile), and anything you're unsure of. Say plainly if something failed and how you fixed it.
5. **Release plan, then wait for "go".** Steps are released to live in the 5 releases below, not one by one.
   - Method: backup → read-only baseline → clean `git archive` + `vercel deploy --prod --skip-domain` (remote build) → `db-migrate.mjs --live` → checks → promote + revalidate → merge `main` last.
   - Any migration not in the approved plan stops the release.
6. **Never on live:**
   - signing in, or creating accounts;
   - writing data outside a release;
   - deleting data;
   - printing or committing secrets.

   Live checks use read-only SQL or rolled-back SQL with a simulated JWT. The owner checks screens himself; give him a list.
7. **Owner-blocked items.** If a step needs something only the owner can give (numbers, legal text, keys, Shopify/GoDaddy setup), stop that part, list exactly what's needed, and continue with any part that isn't blocked.
8. **Always-on rules** (from the memory file):
   - **White-label.** Buyer-facing output (tracking page, packing slips, labels, Shopify-pushed content, images and file names) never contains "Octopus", "Shenzhen", supplier/factory names or codes, Sourcing model numbers, cost or margin.
   - **Pay later** is only for `credit_eligible` orgs.
   - **No fake data shown as real.**
   - **Unknown values** (duty, weight, rate) are shown as unknown, never 0.
   - **Money** is in integer minor units, FX rate stored with each calculation, and every money movement is a balanced journal.
   - **Paused or closed merchants** can't start anything new, but keep their history, wallet, statements, support and export.
   - **Every screen** matches its design file: desktop, mobile and the states boards.

---

## B. Release 1 — Early access

**Goal:** KYC-verified customers can request Dropship, be approved, onboard, browse priced products, request products and top up their wallet. Nothing else is visible yet.

**Step EA-1 — Staff fees, shipping rates and duties** (staff half of 6b). Match: `staff/StaffFees.html`, `staff/StaffRateCards.html`, `staff/StaffDutyEntries.html`, `staff/StaffCompliance.html` (customs value policy part). New routes `/office/dropship/rates`; staff menu adds Shipping rates and Product requests.
- Fee versions: propose → second person approves → activate. History. Never edited after use.
- Shipping rate cards: carrier, service code, method (economy/standard/express), country, base, per-weight price, fuel %, remote-area fee, volumetric divisor, max weight, restricted goods (battery/liquid/magnet/powder). Publish/deactivate.
  - CSV import of a carrier price list: preview, validation and a diff. Nothing is overwritten silently.
- Duty and tax: versions + entries by country and HS prefix, duty %, tax %, de minimis + `applies_to`, source link, and status `needs_data` / `verify` / `confirmed`. Publish with two-person approval.
  - The US has no de minimis.
- Everything is audit-logged. Support has no access to rate cards. Merchants never read these tables directly.

**Step EA-2 — Early-access merchant scope.** Match: `screens/EA_Dashboard.html`, `mobile/M_EA_Dashboard.html`, `screens/EA_PublicDropship.html`, `mobile/M_EA_PublicDropship.html`.
- A config list of merchant features. ON for now: Dashboard, Find products, Product detail, Landed cost, Requests, Wallet, Settings (basic), Support.
- OFF: Stores, Import list, Pushed, Pricing, Packing and shipping, Orders, Reports, Billing, Samples.
- OFF items are hidden from the sidebar and mobile tabs, and their routes redirect to the dashboard. No "coming soon" text.
- Mobile tabs: Home · Find · Requests · Wallet · More.
- Dashboard shows one honest line: "Store connection is the next release."
- Public `/request/dropship`: signed-out visitors see a short public page; signed-in customers go to Activate.

**Launch checklist** (send it, tick it in the release plan):
1. Batch 2 + 3 live.
2. EA-1 + EA-2 live.
3. An active fee version on live (owner's numbers).
4. Rate cards for the owner's launch countries (from the owner's real carrier price list).
5. Duty entries for those countries, confirmed.
6. The owner's number of products published on live, each with complete data and a verified HS code.
7. Privacy policy + terms published (owner gives reviewed text).
8. `dropship_v2_ui` ON.
9. Owner end-to-end test with his own company.

Rollback = flag OFF.

**Owner inputs:** processing fee (planned US$1.20 first item + US$0.40 each extra), weighing tolerance (planned 50 g / 10%), insurance (planned off), launch countries, product count, legal text, factory audit price.

---

## C. Release 2 — Connect and push

**Step 5 — Shopify connection.** Starts only after the owner has done the Shopify setup and approved the 4-test spike result (intake model; uninstall behaviour). Match: `screens/Stores.html` (inside Shopify admin), `screens/StoresWeb.html`, `mobile/M_StoresWeb.html`, `states/States-Stores.html` (disconnect dialog, reconnect, uninstall warning, late order, connecting, already linked, paused, review sandbox).
- Tables:
  - `store_connections`: merchant-readable, no secrets;
  - `store_credentials`: service role only, AES-256-GCM with `SHOPIFY_TOKEN_ENCRYPTION_KEY` and key_version;
  - OAuth state nonces;
  - webhook event dedupe.
- Embedded app at `/shopify`: App Bridge, session-token verification, OAuth / token exchange, expiring offline tokens (60 min) with refresh (90 days), proactive refresh with an advisory lock, and "Reconnect" if refresh fails.
- On connect, create the fulfillment service "Octopus Dropship" with its callback URL; save the service and location IDs. Idempotent.
- `shopify.app.toml` / `shopify.app.staging.toml` (API 2026-10, embedded, least-privilege scopes incl. `read_shipping`, plus `write_third_party_fulfillment_orders` only if the spike chose option 3) and declarative webhooks:
  - app/uninstalled, orders/paid, orders/updated, orders/cancelled;
  - fulfillment_orders fulfillment/cancellation requests;
  - app_subscriptions/update;
  - compliance topics.
- Webhooks: raw-body HMAC (401 on mismatch), dedupe, fast 200, work done through the outbox.
- Compliance:
  - `customers/redact` anonymises buyer name/phone/street;
  - `customers/data_request` prepares the data within 30 days;
  - `shop/redact` deletes store data 48 h after uninstall, except financial records.
  - Plus the daily 60-day buyer data deletion.
- Disconnect: stock to 0 at our location (automatic), "Also hide these products in my store" (opt-in), then revoke and delete credentials. Orders and invoices are kept.
- Uninstall: behave as the spike showed, warn before uninstall, and treat late orders as "Can't fulfil – refund in Shopify".
- Paused or closed merchants can't connect a new store; Disconnect stays.
- Onboarding step 4 becomes the real connection; add the store switcher (All stores / each store).
- App Review sandbox org: `is_review_sandbox` set by admin only, top-ups blocked, banner "Review sandbox – no real orders", order intake stops at awaiting payment, and an optional "Send test tracking" with no money and no documents.
- Shopify GraphQL cost limits: throttle, and retry with backoff.

**Step 6 — Import list, product editor, push, pushed products, pricing and sync.** Match: `screens/ImportList.html`, `ProductEditor.html`, `PushStore.html`, `Pushed.html`, `Pricing.html`, `states/States-Import.html` + the `M_` versions.
- Import list: add from the catalogue or a product page; bulk select; remove.
- Merchant product editor:
  - title, description (supplier-name check), images (choose and order), variants to include;
  - the merchant's own SKU (default = variant model no.);
  - price per variant with a live rule preview, compare-at price, tags/type/collections.
  - Saved as the merchant's copy; Octopus data is never changed.
- Push to Shopify:
  - a durable job queue: idempotent, resumable, progress shown;
  - `productSet` or equivalent;
  - inventory only at the Octopus Dropship location;
  - images under random names;
  - Shopify product/variant IDs stored for matching;
  - partial failures reported per product.
- Pushed products: status, last sync, errors, re-push, unlink (stock to 0 first).
- Pricing and sync page, per the design:
  - cost bands, rounding, compare-at, minimum margin (never pushed below without approval);
  - store currency + named FX source + reprice threshold;
  - live preview from `get_dropship_order_quote`;
  - "when things change" rules, approvals table, sync log.
  - The engine itself is Step 11; here, save the rules and do the first-push pricing.

**Step 6b (merchant half) — Packing and shipping.** Match: `screens/PackingShipping.html`, `mobile/M_PackingShipping.html`.
- Duty mode per country (DDP/DAP), set ONLY here; US default DDP.
- Packaging: standard, protective, branded (from the merchant's MMB stock at 3PL), insert cards. Show fees from the active fee version.
- Shipping rate mapping: read the store's delivery profile rate names (`read_shipping`) → economy / standard / express, with a default and a fallback.

---

## D. Release 3 — Orders and shipping

**Step 7 — Store order intake**, using the model the owner approved after the spike (expected: on orders/paid, the app submits + accepts the fulfillment request only for fulfillment orders at our location).
- Only Octopus lines are stored. Mixed carts are flagged "+N items not from Octopus".
- Dedupe on (org, channel, external order id). Hourly catch-up job for missed webhooks.
- Holds with exact reasons: high risk (Shopify risk), address failed, stock shortage.
- Address change before packing is applied; after packing it becomes a problem flow.
- Cancellation requests: accepted before packing (release stock, refund), rejected after.
- Unpaid orders expire after 3 days (setting): the request is released back to the merchant in Shopify, never charged.
- Quote locked at intake: fee / rate / duty version IDs, FX, billed weight.

**Step 8 — Paying for orders.** Match: `screens/Orders.html`, `screens/Wallet.html`, `states/States-Orders.html`, `states/States-Money.html`, `M_Orders`, `M_Wallet`.
- Orders page: wallet bar (Available, Held, Add funds), filter chips, payment column.
- Payment options:
  - auto-pay from wallet (merchant setting);
  - "Charge and ship" per order or in bulk;
  - Payment protection (held until 7 days after delivery);
  - Pay later only for `credit_eligible`.
- Not enough funds → "Awaiting payment · N days left".
- Every charge is a balanced journal and appears on the OCT-DS invoice / STMT-DS statement under the right legal entity.

**Step 9 — Fulfilment.** Match: `staff/StaffQueue.html`, `staff/StaffPackStation.html`, `screens/TrackPage.html`, `mobile/M_TrackPage.html`.
- Staff queue tabs: Paid to assign, Sourcing, Packing, Handed over, Exceptions. SLA timer that pauses while waiting on the merchant.
- Extended-catalogue items → Sourcing handoff (PO to supplier) → inbound at 3PL → ready to pick.
- Pack station, 5 steps:
  1. scan;
  2. pick (stock movement);
  3. pack (packaging + inserts);
  4. weigh: within tolerance → OK; above it → re-weigh charge with a 7-day dispute window;
  5. label: YunExpress via the adapter. Sender/return = the merchant's approved profile. Refused if the seller profile isn't approved, an HS code is unverified, or the product needs review. Customs snapshot locked.
- 3PL staff read order lines + ship-to address only through a SECURITY DEFINER RPC for orders handed to 3PL.
- Handover scan → picked_up → tracking sent to Shopify (fulfillmentCreate with the carrier tracking + the `/t/[token]` link).
- Buyer tracking page `/t/[token]`: merchant brand only, milestones, carrier display name, buyer first name + city + country only. noindex, rate-limited.
- Needs the YunExpress live keys for live (owner).

**App Review preparation** (after Release 3 works on a development store):
- production app config;
- listing text, icon, screenshots;
- privacy policy link;
- protected data answers;
- review demo org;
- reviewer test steps.

The owner submits.

---

## E. Release 4 — Problems and sync

**Step 10 — Order problems and support.** Match: `screens/OrderDetail.html`, `screens/Support.html`, `M_OrderDetail`, `M_Support`.
- Cancel (rules by stage).
- Address edit before label.
- Lost/damaged claim stepper: reship or refund to wallet; over US$1,000 needs a second Finance approver.
- Returns: to the merchant return address or 3PL, with refund rules.
- Re-weigh disputes within 7 days.
- Tickets linked to the store order; one shared support desk.

**Step 11 — Auto-sync engine** (pg_cron + advisory locks + domain events, throttled):
- stock (3PL + supplier) → Shopify inventory at our location;
- cost changes from Sourcing → reprice by the merchant's rules or send for approval;
- FX daily with threshold;
- out-of-stock rules;
- supplier loses verification → product paused;
- sync log, and errors shown in Pushed and Staff health.

---

## F. Release 5 — Billing and reports

**Step 12 — Plan and billing.** Match: `screens/Billing.html`, `M_Billing`.
- Plans, prices and limits from the owner. "Free while plan fees are off".
- Shopify merchants: `appSubscriptionCreate` with trialDays (test mode on staging) + app_subscriptions/update webhook.
- Non-Shopify merchants: billed through the Octopus wallet channel.
- Limits enforced when billing is on.

**Step 12b — Finance plan-fee switch.** Match: `staff/FinanceSaaS.html`.
- Two-person on/off for `saas_billing_settings` (the only one).
- 30-day trial, one per organisation; 7-day grace.
- Overrides: `free_forever` only for `credit_eligible` orgs.
- Audit-logged.

**Step 13 — Dashboard, reports, settings, staff health.** Match: `screens/Dashboard.html`, `Reports.html`, `Settings.html`, `staff/StaffHealth.html`, `M_Dashboard`, `M_Reports`, `M_Settings`, `M_More`.
- Real dashboard counts.
- Reports: sales in USD at the locked FX, cost lines, refund rate, delivery days, 12-week profit, top products, CSV.
- Settings: team roles, notifications (email once Resend is live), branding, data export, close Dropshipping.
- Staff health: outbox and dead letters, webhook failures, token refresh failures, sync errors, cron runs.

---

## G. UI/UX (every step)

- Follow `UI-RULES.md`. Every screen matches its design file: layout, section order, wording, states. The cream "What changed" boxes, NEW tags, dashed build notes and "Sample data" lines are annotations, not UI.
- Never ship sample numbers or [PLACEHOLDERS]. Bracketed values come from settings or owner input; when missing, show an empty state.
- One component library: buttons, inputs, selects, checkboxes, radio cards, switches, badges with icons, tables that scroll sideways, cards, notices, dialogs, steppers, timelines, skeletons, toasts (see `specs/Components.html`).
- Shells: merchant sidebar and top bar; in early access the trimmed sidebar and tabs from `EA_Dashboard`; staff menu as on the staff boards (incl. Product requests and Shipping rates).
- Every screen has loading, empty, error and success states (`states/*.html`). A disabled button always says why.
- Accessibility: contrast 4.5:1, labels on every field, `aria-current` on the active page, visible focus ring, 44 px touch targets, dialogs trap focus and close with Escape. axe clean at 1280 and 390 px.
- Money in the merchant's view always shows US$ with two decimals, and Processing as its own line.
- The existing staff Product requests page (built in Batch 3) is aligned to `staff/StaffRequests.html` in EA-1.
- In each step report: desktop and phone screenshots next to the design file name, and every difference with its reason.

## H. Also

- Remaining audit batches (4–6): list what's left and fold each item into the step it belongs to. Report where each went.
- Each time a release goes live, update `PROJECT-MEMORY.md` (state, decisions, next) in the same commit.

## I. Start now

1. Send the Step 0 plan for EA-1 + EA-2 (Release 1), with the owner inputs still missing.
2. In the same message, give a one-page overview of releases 2–5: steps, migration ranges, owner blockers per release.
3. Wait for the owner's OK.
