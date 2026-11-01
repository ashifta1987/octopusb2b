# QA report — 1 Nov 2026

SPEC §19 full QA cross-check (prompt 19-A), plus §17 staff login and §20 assistant. Run by the release engineer on
1 Nov 2026 against `main` at `20a3b6a` (start) → `e51be59` (end, 14 QA commits, **not pushed**).

## How this pass was run

| Item | Detail |
| --- | --- |
| App under test | Local production build (`pnpm build` + `pnpm start -p 3100`) of the working tree, rebuilt after every fix group. Production (https://octopus-b2b.vercel.app) was used for Lighthouse, health, robots/sitemap and env checks; it does **not** yet contain the QA fixes. |
| Database | The live Supabase project (also production). Every write test ran in a rolled-back transaction or was cleaned up (see "Clean-up" at the end). |
| Roles | Demo users (buyer, distributor, ops, support, finance, qc …). Staff sessions reached `aal2` with a temporary TOTP factor that was deleted after each run. `admin@` now carries the owner's own TOTP factor, so admin pages were checked with a **temporary QA admin** (`qa-admin@demo.octopusb2b.com`, lead-approved) that was deleted at the end. |
| Tools | `tsc`, ESLint, Vitest (158 tests), the 7 DB suites in `supabase/tests`, SQL audits (RLS, policies, FK indexes, ledger balance, cron), `EXPLAIN`, Playwright + axe-core (48 routes × 360/768/1024/1440 px, axe at 360 + 1440), Lighthouse 12 (mobile, simulated 4G), Newman 6, signed/unsigned webhook probes, the §20 done-when E2E. |
| Evidence | Screenshots `docs/qa/2026-11-01/<route>__<width>.png` (compare with `docs/design/<Name>.png`, mapping in the UI section); machine results `docs/qa/2026-11-01/ui-pass.json` / `ui-pass.txt`; logs in `docs/qa/2026-11-01/logs/`. |

## Summary

| Area | Checks run | Pass | Fixed | Pending | Needs-decision |
| --- | ---: | ---: | ---: | ---: | ---: |
| Functional | 13 | 5 | 1 | 4 | 3 |
| Data | 10 | 5 | 2 | 2 | 1 |
| Integrations | 9 | 4 | 0 | 3 | 2 |
| Money | 5 | 4 | 0 | 1 | 0 |
| UI vs design | 11 | 2 | 3 | 5 | 1 |
| Copy and CMS | 9 | 3 | 1 | 4 | 1 |
| Accessibility | 9 | 6 | 2 | 1 | 0 |
| SEO | 7 | 4 | 0 | 2 | 1 |
| Performance | 7 | 3 | 1 | 3 | 0 |
| Security | 8 | 5 | 1 | 1 | 1 |
| API | 8 | 5 | 0 | 1 | 2 |
| Group buy | 6 | 5 | 0 | 1 | 0 |
| Backup & restore | 6 | 2 | 0 | 1 | 3 |
| Content and branches | 4 | 3 | 0 | 1 | 0 |
| §17 Staff login | 7 | 6 | 0 | 0 | 1 |
| §20 Assistant | 2 | 2 | 0 | 0 | 0 |
| **Total** | **121** | **64** | **11** | **30** | **16** |

"Fixed" counts checks that failed and were fixed in this pass (14 commits; several commits touch more than one check).
Severity of the open items: **3 block**, **10 major**, the rest minor/polish — see the punch list.

Quality gates at the end of the pass (after the last commit): `npx tsc --noEmit -p .` ✔ · `pnpm lint` 0 errors (5 pre-existing warnings) ✔ ·
`pnpm test` 158/158 ✔ · `supabase/tests/{rls,currency,backup,backup-recovery,staff-auth,pools,assistant}` all green ✔ (pools has one new
assertion) · `pnpm build` ✔ · Newman 22 requests / 63 assertions ✔ · §20 done-when E2E 5/5 ✔.

Before → after for the automated UI checks (48 routes): axe serious/critical violations **13 rule types on 31 routes → 0**;
routes that scroll sideways at 360 px **12 → 0**; storefront mobile CLS **0.22 → 0**.

---

## 1. Functional (§4, §5, §9, §10, §10.3)

Spec: "Every role flow in §4 end to end; every state machine in §5 transitions in the right direction and refuses the wrong ones; every RPC in §9 is idempotent and runs in one transaction; every outbox event (§10) has a consumer and a retry path; scheduled jobs (§10.3) all fire."

Passed: invalid order/campaign/service/pool transitions are refused (rls, pools suites; `guard_campaign_update`, `transition_*` allow-lists); idempotency of `settle_pool`, `confirm_topup`, `system_record_tracking`, `approve_*`; outbox worker has per-consumer `job_runs`, backoff 1 m/5 m/30 m/2 h/6 h and dead-letter (`lib/api/outbox.ts`); §20 done-when E2E 5/5 (`logs/assistant-e2e.txt`); 48 routes × 7 roles render 200 with no error markers (`ui-pass.txt`).

**Major**

| ID | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FN-01 | `tests/e2e` | §11.3, §19.4 | 8 Playwright golden paths, green, with HTML trace | Only the §20 E2E exists. GP1–8 are covered at DB level by the 7 suites (rolled back), not end-to-end in a browser. They cannot be run safely against this database because it is production | `ls tests/e2e` | Provide a staging Supabase project + Vercel preview; write GP1–8 as Playwright specs seeded per run | needs-decision |
| FN-02 | `vercel.json`, `outbox_events` | §10, §10.3 | Dispatcher every 10 s | `/api/cron/outbox` runs once a day (`0 3 * * *`); there is no pg_cron dispatcher. 13 events were pending, oldest ~4 h, during the audit → emails/webhooks/PDFs go out up to 24 h late | `logs/db-audit.txt` (outbox), `vercel.json` | Vercel Pro per-minute cron, **or** pg_cron + `pg_net` POST to `/api/cron/outbox` with `CRON_SECRET` from Vault, **or** a Supabase Edge Function worker | needs-decision |
| FN-03 | pg_cron / Vercel cron | §10.3 | SLA timers (5 min), reconciliation (daily 03:00), monthly statements, FX reference rate (daily), RFQ 48 h reminder, tracking fallback (hourly) | Not scheduled. Missing: SLA escalation, reconciliation, monthly statements, FX reference fetch, 48 h RFQ reminder (`job_expire_quotes` only expires). Tracking poll runs daily, not hourly (and is a sandbox no-op) | `logs/db-audit.txt` (cron.job list), `vercel.json` | Add `job_sla_timers`, `job_reconciliation`, `job_monthly_statements`, FX reference fetch and the reminder to pg_cron (most can be SQL-only) | pending |
| FN-04 | `app/office/actions.ts` | §5, §11.3 GP3 | "The UI never updates `status` directly"; a simulated tracking event behaves like the YunExpress webhook | Sandbox "simulate tracking" updated `shipments.status` directly and inserted `tracking_events` itself: no `status_history`, no `shipment.tracking` outbox event, no customer notification. Shipment creation also skipped the outbox | code review | Route both through `system_record_tracking` (same path as the webhook) | **fixed** `6d6c05d` |
| FN-05 | `/supplier/*` | §1, §8.3 | Supplier portal "built now, opened later" (`/supplier`, `/supplier/rfqs`, `/supplier/customers`, `/supplier/integrations`, `/supplier/ads`) | No `app/supplier` routes exist (the supplier **API** exists). Flag `supplier_portal_enabled` is off, so nothing is visible today | `ls app/supplier` | Build the five screens from Supplier*.png / AdsCampaign.png before the flag can be switched on | pending |

**Minor**

| ID | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FN-06 | `app/account/ads/actions.ts` | §5 | Campaign moves go through a transition RPC with `status_history` | Customer "pause" writes `ad_campaigns.status` directly (allowed by the `guard_campaign_update` trigger, so it is safe, but no history row) | code | Call a customer-safe `transition_campaign` variant | pending |
| FN-07 | `orders` (seed) | §11.4 | "One order in each status" in seed data | Production holds 1 order (`shipped`) | `logs/db-audit.txt` | Decide whether demo data belongs in production at all; seed the full set in staging | needs-decision |

**Polish**

| ID | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FN-08 | `/pools/start` (signed out) | §9 | 307 to `/login` | 200 with a streamed `NEXT_REDIRECT` (client-side redirect) | `logs/smoke.txt` | Check the session before the Suspense boundary | pending |

## 2. Data (§6, §12, §15, §17)

Spec: "RLS on every table; `has_permission()` guards staff endpoints; `aal=aal2` enforced on staff tables; ledger journals balance per currency; no column named after one currency; no orphan rows, no unused foreign keys; soft-delete respected everywhere."

Passed: 0 public tables without RLS (`_migrations` and `idempotency_keys` have RLS and no policy = service-role only, intended); `has_permission`, `is_admin`, `is_staff`, `has_role`, `is_my_supplier` all require `aal2` (22 staff-auth checks); 0 unbalanced journals per currency; 0 currency-named columns (`grep amount_usd_cents` = 0 hits); every FK is a real constraint (no orphans possible).

| ID | Sev. | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DA-01 | major | 96 FK columns | §12 Performance | "Indexes on all foreign keys" | 96 FKs had no covering index | `logs/db-audit.txt` | Migration `20261101000120_qa_fk_indexes.sql` | **fixed** `1047c69` |
| DA-02 | minor | queue/status columns | §12, §19.1 | Filter columns indexed; `EXPLAIN` uses indexes | Tickets, KYC queue, audit log, payments, shipments … filtered by status without index | `logs/explain.txt` | Migration `20261101000121_qa_filter_indexes.sql` (21 indexes) | **fixed** `1047c69` |
| DA-06 | minor | `site_settings.finance_approval_limit_cents` | §4.6, §15.1 | Limits per role, currency-aware | One number with no currency; after a CNY switch the limit is 7× smaller in USD terms | `site_settings` | Store the limit per currency (money schema) | needs-decision |
| DA-07 | polish | `public_suppliers`, `pool_public_view` | §6 | Storefront reads only safe columns | Both are definer views by design (expose code/country/badge only) — correct, but undocumented | `logs/db-audit.txt` | Comment the intent in the migration | pending |
| DA-08 | minor | `organizations`, `products`, `suppliers` | §6 | Soft delete respected everywhere | `archived_at` exists on 3 tables; storefront queries filter it, but not every portal query was audited | code sample | Add a lint/test that every list query filters `archived_at` | pending (not fully checked) |

## 3. Integrations (§7, §10.2)

Spec: "Each adapter has sandbox + live modes, HMAC signature checks on every inbound webhook, 24-hour retry window, dead-letter queue surfaced in `/admin/integrations`, idempotency keys honoured, replay of a webhook event changes nothing."

Passed (`logs/webhooks.txt`): YunExpress and payment webhooks reject unsigned, wrong-secret, tampered and >5-minute-old signatures (401); replaying a credited top-up returns `already_credited`; a replayed tracking event (rolled-back DB test) adds no row, outbox event or ledger entry; counts of tracking events, ledger rows, journals, outbox events and credits unchanged after all replays. Dead letters are listed with retry in `/admin/integrations`. `Idempotency-Key` honoured by the API.

| ID | Sev. | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IN-02 | **block** (go-live) | adapters, Vercel env | §7, §11.6, §14 #1 #3 #8 | Live credentials tested with one real order | Production runs payment = `TestPaymentAdapter` (no live class yet), email = log adapter (no `EMAIL_API_KEY`), YunExpress sandbox (no app id/key), no `SENTRY_DSN` | `vercel env ls production` (11 vars) | Owner picks providers (§14 #1, #3) and enters credentials; Developer adds the live payment adapter | needs-decision |
| IN-03 | minor | outbox retry plan | §7 vs §10.2 | §7: retries for 24 h; §10.2: 1 m/5 m/30 m/2 h/6 h | Implemented §10.2 → last retry ≈ 8.6 h after the first failure | `lib/api/outbox-rules.ts` | Decide which section wins; if 24 h, add a 12 h + 24 h step | needs-decision |
| IN-04 | minor | `webhook_deliveries` | §19.4 | Replay last 20 outbound deliveries | 0 deliveries exist in production, so nothing to replay; Newman's signed ping and the HMAC unit tests pass | `logs/webhooks.txt` | Repeat on staging with real endpoints | pending (not checkable) |
| IN-05 | polish | dropship webhook | §7, §14 #7 | — | Not built; Dropship API is a later phase | — | Build with the Dropship API | pending (later phase) |
| IN-06 | polish | `lib/adapters/index.ts` | §12 | Secret fallback | `PAYMENT_WEBHOOK_SECRET ?? WEBHOOK_SIGNING_SECRET`: an empty string would not fall back | code | Use `||` | pending |

## 4. Money (§4.2, §4.6, §12, §15)

Spec: "Deposit %, balance %, service prices, claim windows, quote validity, group-buy minimums all read from settings; wallet never negative; maker–checker enforced; refund paths exist for every failure branch; FX rate on each document is locked."

Passed: `deposit_pct`, `claim_visible_days`/`claim_hidden_days`, `quote_validity_days`, `pool_*` and service prices come from `site_settings`/`service_prices` (no hard-coded values found in components); wallet cannot go negative, maker cannot approve own request, second finance user can (rls); currency lock + per-currency balance (currency suite); rejected paid service requests auto-refund; pool withdraw/expire refund (pools suite).

| ID | Sev. | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MO-01 | minor | `transition_order` → `cancelled` | §19.1 Money | Refund path for every failure branch | Cancelling an order after the deposit creates no refund request automatically; Finance must raise one by hand | function source | Emit a refund `finance_approvals` request on cancel-after-deposit | pending |

(The approval-limit currency question is DA-06.)

## 5. UI vs design (§8, §19.1)

Spec: "Every route in §8.3 renders the matching `docs/design/*.png` … portal sidebars collapse to a horizontal tab bar under 760 px; all CTAs reachable without horizontal scroll on a 360 px viewport; empty, loading and error states exist for every list."

Screenshots (`docs/qa/2026-11-01/`, 1440 shots are full-page, all resized to half width to keep the repo small): `home` ↔ Main.png, `products`/`c_fasteners`/`search_q_gloves` ↔ Products.png, `p_stainless-…` ↔ Product.png, `request_sourcing` ↔ Request.png, `pools` ↔ Pools.png, `login`/`signup` ↔ Auth.png, `staff_login` ↔ StaffLogin.png, `staff_workspace` ↔ StaffLogin-3-workspace.png, `account` ↔ Customer.png, `account_assistant` ↔ Assistant.png, `account_orders`/`account_rfqs`/`account_pools` ↔ CustomerOrders.png, `account_kyc` ↔ CustomerKYC.png, `account_wallet` ↔ Wallet.png, `account_ledger` ↔ Ledger.png, `account_developer` ↔ Developer.png, `account_support` ↔ Support.png, `account_ads` ↔ AdsCampaign.png, `distributor` ↔ Distributor.png, `distributor_products_new` ↔ ProductCreate.png, `distributor_products_import` ↔ BulkUpload.png, `distributor_catalog`/`admin_catalog` ↔ Catalog.png, `office` ↔ Office.png, `office_shipping` ↔ Shipping.png, `office_support` ↔ SupportDesk.png, `admin` ↔ Admin.png, `admin_finance` ↔ Finance.png, `admin_ads` ↔ AdsAdmin.png, `admin_staff` ↔ Staff.png, `admin_geography` ↔ Geo.png, `admin_services` ↔ Fees.png, `admin_wallet`/`admin_currency` ↔ WalletAdmin.png, `admin_integrations` ↔ Integrations.png, `admin_content` ↔ CMS.png, `admin_backups` ↔ Backups.png.

Passed: all 48 routes render with the design tokens/fonts and the same section order as their artboards (Main, Customer and Admin compared in detail); the portal sidebar becomes a horizontal tab bar under 760 px.

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-01 | major | 12 routes | §19.1 | No horizontal scroll at 360 px | `/staff/login` (+31 px), `/account/ledger` (+214), `/account/support` (+309), `/distributor` (+647), `/office` (+81), `/admin` (+199), `/admin/finance`, `/admin/staff` (+390), `/admin/services`, `/admin/wallet`, `/admin/integrations` (+314), `/admin/currency` scrolled sideways. Causes: `.sr-only` table headers escaping scroll regions, grid items with `min-width:auto`, non-wrapping CTA rows | `logs/ui-pass-baseline.txt` → `ui-pass.txt` | Scroll regions contain abs. children, grid children may shrink, CTAs wrap | **fixed** `bc9cd77`, `e36e4f4`, `67afa17`, `3c00751` |
| UI-02 | major | all segments | §8.4 | Loading skeleton, empty and error state for every list | No `loading.tsx`, `error.tsx`, `not-found.tsx` anywhere: a failing query showed Next's generic error, unknown URLs the default 404 | `find app -name error.tsx` (none) | Error boundaries per segment (shell stays), 404 page, portal loading skeletons | **fixed** `69a97e2` |
| UI-05 | major | `/` "What buyers say" | §8.4, §11.6 | Real content or no section | Production shows "[Customer testimonial: add real quotes after launch]" from CMS | `home__1440.png` | Owner fills `content_blocks.testimonials` or the section is hidden while empty | needs-decision |
| UI-08 | major | `/account/kyc` → `/account/addresses` | §6 (addresses), Customer.png nav | Link works | The KYC page links to `/account/addresses`, which does not exist (404, also seen in the console); "Addresses" and "Saved products" from the Customer.png sidebar are not built | `ui-pass.json` (console 404) | Build `/account/addresses` (and saved products) or drop the link — no artboard exists, so design intent is needed | pending |
| UI-03 | minor | `/account` | §20.7 item 5, Customer.png | "AI assistant" item with a **new** badge; counts on RFQs/Service requests; bell in top bar | No badge, no counts, no notification bell | `account__1440.png` vs Customer.png | Extend `lib/nav.ts` items with `badge` | pending |
| UI-04 | minor | `/admin` | Admin.png | 5 KPI cards, commission card, "Last active" column | 7 KPI cards; money wraps to two lines at 1440; no commission-rates card; staff table without last active | `admin__1440.png` vs Admin.png | Compact money in KPIs; align cards with the artboard | pending |
| UI-07 | polish | `/account` | Customer.png | Pill badges, one-line RFQ codes | "Shipped" badge squashed into a circle; RFQ codes wrapped | `account__1440.png` | `shrink-0` on badges, `nowrap` on codes | **fixed** `e2accd3` |
| UI-06 | polish | `/` | §18.4, Main.png | Pools section with 4 cards | Section is hidden when no pool is open — production has none, so the §18 home entry point is invisible | `home__1440.png` | Show the section with a "Start a pool" call to action when empty | pending |
| UI-09 | minor | `/pool/[code]`, `/supplier/*`, Invoice PDF, detail pages | §8.3 | Every route compared | Not compared: `/pool/[code]` (no pools exist), `/supplier/*` (not built), Invoice PDF vs Invoice.png, order/RFQ detail pages | — | Repeat on staging with seeded pools/orders | pending (not checked) |

## 6. Copy and CMS (§8.4, §11.6, §15.1)

Spec: "No hard-coded prices, contacts or legal text in components; every string comes from CMS … ; T&C version id is written on every order and pledge."

Grep of `app/`, `components/`, `lib/` (tests and seed excluded): **0** hard-coded prices, **0** phone numbers; e-mail/URL hits listed in CO-05; **0** `amount_usd_cents` or currency-named money columns. `terms_version_id` present on 1/1 orders; pledges require it (pools suite).

| ID | Sev. | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CO-02 | **block** | `terms_versions` v1.0 + GB-1.0 | §11.6, §14 #5, §19.2 | Reviewed legal text published | All 15 T&C sections and all 8 Group Buy Terms sections read "[Draft — paste the reviewed clause text …]", and both versions are **published** and linked from checkout/pledges | SQL on `terms_versions` | Legal supplies the text; Content editor enters it; Admin publishes v1.1 | needs-decision (Legal) |
| CO-01 | minor | `app/layout.tsx` | §8.4, §15.1 | Site description from CMS with `{currency}` | Default title/description hard-coded ("…tiered **USD** pricing…") | code | `generateMetadata` from company profile + `home.subtitle` | **fixed** `e3b8db3` |
| CO-03 | minor | header/footer, portal, error pages | §8.4 | Every string from CMS | UI chrome is in code: nav/footer labels, "Ship to: Worldwide", "© 2026 … All rights reserved.", developer page "Rate limit: 60 requests per minute…", the new error/404 copy, home pools section copy. Prices, contacts and legal text **are** from CMS | `components/store-shell.tsx:23,89–95`, `app/account/developer/page.tsx:198` | Move to `content_blocks` (keys `nav.*`, `footer.*`, `errors.*`) | pending |
| CO-04 | minor | `lib/adapters/ai.ts:68,72` | §15.1 | Currency-neutral copy | Mock AI adapter writes "tiered USD pricing" into generated SEO text | code | Use the platform currency or neutral wording | pending |
| CO-05 | polish | `lib/adapters/index.ts:93`, `lib/api/openapi.ts:379,421` | §8.4 | Contacts from config | Default e-mail sender `support@octopusb2b.com` (env fallback) and OpenAPI contact/URLs in code | grep | Read from `company_profile` / env | pending |
| CO-07 | polish | footer | §8.2 | Footer shows branches | Branch list only renders when there is more than one branch | `components/store-shell.tsx:87` | Always list branches | pending |

## 7. Accessibility (§12, WCAG 2.2 AA)

Spec: "Colour contrast ≥ 4.5:1, keyboard flow follows reading order, visible focus ring, labels on every input, status never by colour alone, tap targets ≥ 24 px, reduced-motion respected, lang attribute set, headings in order."

Result (axe-core, tags wcag2a/aa, 21a/aa, 22aa, 48 routes at 360 and 1440 px): **0 serious/critical violations** (baseline: color-contrast on 15 routes, link-in-text-block on 11, scrollable-region-focusable on 6, label-content-name-mismatch on 8, definition-list, label, button-name, aria-prohibited-attr). `lang="en"`, exactly one `h1` and no skipped heading levels on all 48 routes; `prefers-reduced-motion` honoured; 3 px `:focus-visible` outline; axe `target-size` clean; badges always carry text. Lighthouse accessibility 100 on `/`, `/products`, `/p/…`, `/pools` (local, after fixes).

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-01 | major | site-wide | §12 | Contrast ≥ 4.5:1 | Brand blue `#2A6FD6` on `#F5F6F8` = 4.47; status green `#1F9D55` = 3.5, red `#D64545` = 4.4, amber `#D98A00` = 2.8 on white (used as text and on white-text buttons); white/85 on blue; footer link 1.8:1 vs surrounding text | `logs/ui-pass-baseline.txt` | Text-safe shades `--green-ink #157A44`, `--amber-ink #9A6200`, `--red-ink #C03434`, `--blue-text #2A6ED4` (raw §8.1 tokens kept), underlined footer link. **Owner may want to confirm the darker status shades** | **fixed** `efe2055`, `e36e4f4` |
| AC-02 | major | portals | §12 | Labels/names on every control; keyboard access | Staff menu summaries' names did not include their visible text; empty tree-toggle buttons; unlabeled file input (and the drop zone was mouse-only); 9 scroll regions not keyboard-focusable; `<p>` inside `<dl>`; `aria-label` on plain divs | same | Names fixed, inputs labelled with focus ring, regions focusable with `role="region"` | **fixed** `ce23df6`, `e36e4f4` |
| AC-03 | minor | all | §12 | Keyboard order, screen reader | Automated checks only; no manual keyboard/screen-reader walk-through was done | — | One manual pass with VoiceOver/NVDA before go-live | pending (not checked) |

## 8. SEO (§12)

Spec: "Server-rendered product, category and pool pages; clean slugs; `generateMetadata`; Product, Offer, BreadcrumbList, Organization and CollectionPage JSON-LD; sitemap.xml and robots.txt; canonical URLs." 19-A target: Lighthouse SEO = 100.

Passed: product/category/pools pages are server-rendered with titles, descriptions and canonicals; JSON-LD `Product`+`AggregateOffer`+`BreadcrumbList`+`Organization` on `/p/…`, `CollectionPage`+`ItemList` on `/pools`, `Organization` on `/`, `BreadcrumbList` on lists; sitemap and robots generated. Lighthouse SEO (local, after fixes): `/` 100, `/products` 100, `/pools` 100, `/p/…` 92.

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SE-01 | minor | `/p/[slug]` | §19.4 | Lighthouse SEO 100 | 92: the product page's `generateMetadata` is dynamic, so browsers get **streamed** metadata (description ends up in `<body>`); Google/Bing crawlers get it in `<head>` (Next's `htmlLimitedBots` default) | `meta.mjs` result in this report | Either accept (crawlers are fine) or set `htmlLimitedBots: /.*/` / prerender product pages with `generateStaticParams` — trade-off TTFB vs score | needs-decision |
| SE-02 | minor | `/pool/[code]` | §18.5 item 11 | `Product`+`Offer` JSON-LD | Not checked — no pool exists in production | — | Check on staging | pending (not checked) |
| SE-03 | polish | `/robots.txt` | §12 | Valid robots | Contains the non-standard `Host:` line (one prod Lighthouse run also failed to fetch robots.txt — transient) | `curl /robots.txt` | Drop `host` from `app/robots.ts` | pending |

## 9. Performance (§12)

Spec: "LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on 4G throttled; images through `next/image`; no N+1 queries; `EXPLAIN` on list queries uses indexes; ISR tags revalidate on publish."

Lighthouse mobile (simulated 4G):

| Page | Prod (before fixes) perf / LCP / CLS / TBT | Local build (after fixes) perf / LCP / CLS / TBT |
| --- | --- | --- |
| `/` | 73 / 4.3 s / 0.223 / 10 ms | 91 / 3.5 s / 0 / 20 ms |
| `/products` | 92 / 2.8 s / 0 / 30 ms | 93 / 3.2 s / 0 / 20 ms |
| `/p/stainless-steel-hex-bolts-m10-40-mm-a2-70` | 93 / 2.8 s / 0 / 10 ms | 93 / 3.3 s / 0 / 20 ms |
| `/pools` | 89 / 3.5 s / 0 / 10 ms | 91 / 3.6 s / 0 / 20 ms |
| `/pool/[code]` | not measured (no pools) | not measured |

(Local numbers have no CDN, so LCP is not comparable with production; CLS is.) `EXPLAIN` uses indexes on 12/13 list queries after DA-01/02 (`logs/explain.txt`); `revalidateTag` is called on publish for products, pools, site content and currency.

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PE-02 | major | storefront | §12 | CLS < 0.1 | 0.22 on mobile: the header read the session, so it streamed into a 150 px placeholder while the real mobile header is 374 px | `logs/lighthouse-prod.txt` | Header is now static (cached CMS data); only the account links and the currency banner stream | **fixed** `e51be59` |
| PE-01 | major | `/`, `/products`, `/p/…`, `/pools` | §12 | LCP < 2.5 s | 2.8–4.3 s on production; LCP elements are text (hero h1/p) with ~2 s "element render delay" behind streamed content | same | Re-measure after deploying `e51be59`; then move the remaining page-level Suspense content into the static shell and preload the Lexend weight used by the hero | pending |
| PE-03 | minor | server components | §19.1 | No N+1 | Not systematically checked (no query tracing available) | — | Enable Supabase query logs / OTel spans on staging | pending (not checked) |
| PE-04 | polish | `AdSlot`, `Logo` | §8.4 | Images through `next/image` | Plain `<img>` (ESLint rule disabled inline) | code | Use `next/image` with the Supabase loader | pending |

## 10. Security (§12, §17)

Spec: "RLS advisor clean; staff 2FA enforced; service role key only on server; webhook signatures verified; rate limits per key and IP; `Idempotency-Key` on POST; audit log entries for logins, KYC document views, money approvals, role changes, pool settles, restore requests, price changes."

Passed: no `'use client'` file imports the service-role client; `SUPABASE_SERVICE_ROLE_KEY` is server-only; staff `aal2` everywhere (see §17); webhook signatures (Integrations); 429 + `Retry-After` after 36 calls/min and RFC 7807 bodies; POST without `Idempotency-Key` → 400 `IDEMPOTENCY_KEY_REQUIRED`; audit entries exist for sign-in/failures/workspace switch, KYC views (`view.kyc_submissions`), role changes (`user_roles.*`, `role_permissions.*`), money approvals, restore requests, price changes (`service_prices` trigger).

| ID | Sev. | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-02 | major | `pools` | §19.1, §12 Audit | Audit entry for pool settles | `settle_pool` and `expire_pool` wrote no audit row (only `cancel_pool` did) | function source | Trigger `trg_audit_pool_status` (migration `…122`) + test assertion | **fixed** `a644638` |
| SC-03 | major | Supabase dashboard | §11.6, §12, §17.3 | RLS advisor clean; Auth URL config; invite link 24 h; Google OAuth (domain-restricted); PITR | Not reachable from the repo: Supabase advisors need a management token; Auth site URL/redirects and invite expiry are dashboard settings; Google provider not enabled. SQL equivalents of the advisor checks pass | — | Owner runs the Security Advisor, sets Auth URLs + 24 h invite expiry, enables Google (octopusb2b.com) and PITR | needs-decision |
| SC-04 | polish | `lib/supabase/server.ts` | §12 | Service role only on server | Module has no `import 'server-only'` (it imports `next/headers`, which already blocks client bundling) | code | Add the guard (vitest already stubs `server-only`) | pending |

## 11. API (§7, §15.2)

Spec: "OpenAPI 3.1 matches reality; Postman collection runs green with Newman; `oct_test_` and `oct_live_` scopes behave; `GET /v1/settings/currency` returns the active currency and rate; webhook signatures verify; `429` with `Retry-After`."

Passed (`logs/newman.txt`, `logs/api-probes.txt`): Newman public collection 22 requests, 63 assertions (status, OpenAPI schema, "every amount carries a currency"), 0 failures, using a temporary `oct_test_` client for the buyer org (deleted afterwards); `/v1/settings/currency` → `USD`, rate 7.1, `fx_rate_id`; signed webhook ping verified; 429 + `Retry-After: 34`; unauthenticated → 401 `application/problem+json`.

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AP-02 | major | `/api/v1/*` with `oct_test_` | §7, §19.4 | Test keys use sandbox data; "`oct_test_` keys cannot read `oct_live_` data" | A test key reads the org's real orders and wallet (`GET /orders` returned ORD-2202); writes are simulated | `logs/api-probes.txt` | Decide: separate sandbox dataset per org, or document "test keys = read-only live + simulated writes" in the spec | needs-decision |
| AP-04 | minor | Postman workspace | §15.2 | Release pushes collections | `POSTMAN_API_KEY`, workspace and collection ids not configured | `vercel env ls`, `postman.yml` | Owner creates the workspace and adds the secrets | needs-decision |
| AP-03 | minor | supplier collection | §7 | Newman run of the supplier collection | Not run: supplier API logins are off and no supplier client exists | — | Run on staging with a supplier client | pending (not checked) |

## 12. Group buy (§18)

Spec: "`/pools` lists only open pools, filters and sort work; `/pool/[code]` shows participants from the public view (code + country only); `settle_pool` creates one PI per pledge, one aggregate PO, three shipments; `expire_pool` refunds every deposit; supplier never sees buyer identities."

Passed (pools suite, rolled back): open from the product, three buyers in NL/DE/US, pledge minimum, withdraw-before-fill refund, currency-mismatch rejection, fill → `settle_pool` creates 3 PIs once and is idempotent, one aggregate PO, defaulted deposit applied to shortfall, expire refunds, escrow empty afterwards, supplier sees only aggregate, public view codes + countries only, Group buy switch blocks new pools; **new**: settle is audited exactly once. `/pools` query filters `status='open'` and `deadline > now`; empty state renders.

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GB-01 | minor | `/pools`, `/pool/[code]` | §19.4 | Two pools in parallel in the UI; three shipments | Not checked live: production has no pools and creating them would post committed ledger entries; shipment creation per buyer is an Ops step after balance payment and is not covered by the suite | — | Run the 18-A Playwright golden path on staging | pending (not checked) |

## 13. Backup & restore (§16)

Spec: "Nightly backup present, checksum verified, off-site; 'Back up now' works; partial restore refuses ledger rows; monthly restore drill into scratch passes; export files are deterministic byte-wise."

Passed (backup + backup-recovery suites): partial restore refuses ledger/payment rows (`MONEY_RECORDS_NOT_RESTORABLE`), maker–checker with Finance for money-touching restores, recovery compare/restore of a deleted product.

| ID | Sev. | Route / table | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BK-01 | **block** (go-live) | `backups`, GitHub Actions, Vercel env | §11.6, §16 | Nightly off-site backup < 26 h old with checksum; "Back up now" works; restore drill passed in the last 30 days; PITR on | `backups` has **0 rows** and `restore_requests` 0: `backup.yml`/`restore-drill.yml` cannot run (no `GITHUB_ACTIONS_TOKEN`, `BACKUP_S3_*`, age public key; production env has only `GITHUB_REPO`); "Back up now" returns `GITHUB_NOT_CONFIGURED`; PITR status unknown | `logs/db-audit.txt`, `vercel env ls` | Owner: off-site bucket + keys, GitHub secrets, enable PITR; Developer: run the first backup and a drill, confirm the panel | needs-decision |
| BK-02 | minor | `data_exports` | §16.1 | Exports deterministic byte-wise | Not checked: building an export writes files into the production `exports` bucket | — | Check on staging (export twice, compare SHA-256) | pending (not checked) |

## 14. Content and branches (§4.7, §11.3 GP6)

Spec: "Branches, company details, services and charges, Terms (15 sections + Group Buy), banners all editable in CMS and reflected on the storefront; publish schedules fire."

Passed: content editor cannot publish legal pages (rls); T&C has 15 sections and Group Buy Terms its own versioned kind; `octopus-terms-publish` ran 41 times in 24 h without failure; footer/company/branches/services read from `company_profile`, `branches`, `service_prices`.

| ID | Sev. | Route | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CB-01 | minor | `/admin/content` → storefront | §11.3 GP6 | Edit → publish → storefront updates | Not exercised live (it would change production content); code calls `revalidateTag('site-content')` on publish | code | Part of GP6 on staging | pending (not checked) |

The legal text itself is CO-02 (block).

## 15. §17 Staff login

Passed (`logs/staff-login-ui.txt` + staff-auth suite): a customer e-mail at `/staff/login` gets "This is the staff portal — use Customer login"; a staff password-only session lands on step 2 and `/office` sends it back to verify; wrong password shows "4 attempts left before the account is locked"; 5 failures lock for 15 min, Admin is notified and it is audited with IP/device; customers opening `/office` or `/admin` end at `/login`; step-up (`STEP_UP_REQUIRED`) on money approvals, 2FA reset and role changes.

| ID | Sev. | Area | SPEC | Expected | Actual | Evidence | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SL-01 | major | Supabase Auth | §17.2, §17.3 | Google sign-in for @octopusb2b.com; invite link valid 24 h | Google provider not enabled; invite expiry is a dashboard setting (default differs) | — | Owner enables Google and sets OTP/invite expiry to 24 h (tracked with SC-03) | needs-decision |

## 16. §20 Assistant

Passed: done-when E2E (real tracking answer, refund → handoff + ticket with transcript, staff reply arrives live) 5/5; assistant DB suite green. The missing "new" badge in the sidebar is UI-03.

---

## Punch list

Ordered block → major → minor → polish. Status: fixed | pending | needs-decision.

| # | ID | Sev. | Area | Route / table | SPEC | Expected → actual (short) | Evidence | Suggested fix | Status |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | CO-02 | block | Copy | `terms_versions` | §11.6 | Reviewed T&C → all 23 sections are "[Draft …]" placeholders, published | SQL | Legal text, publish v1.1 | needs-decision |
| 2 | BK-01 | block | Backup | `backups` | §16, §11.6 | Nightly off-site backup + drill → 0 backups, workflows unconfigured | `logs/db-audit.txt` | Secrets, bucket, PITR, first backup + drill | needs-decision |
| 3 | IN-02 | block | Integrations | adapters | §11.6 | Live payment/e-mail/YunExpress → all sandbox/log | `vercel env ls` | Choose providers, add credentials, live payment adapter | needs-decision |
| 4 | FN-02 | major | Functional | outbox | §10 | Every 10 s → once a day | `vercel.json` | Per-minute cron or pg_net | needs-decision |
| 5 | FN-01 | major | Functional | `tests/e2e` | §11.3 | 8 golden paths → none (DB-level only) | — | Staging + Playwright specs | needs-decision |
| 6 | AP-02 | major | API | `/api/v1` | §7 | Test keys sandbox-only → read live data | `logs/api-probes.txt` | Decide sandbox model | needs-decision |
| 7 | UI-05 | major | UI/Copy | `/` | §8.4 | Real testimonials → placeholder text live | `home__1440.png` | Fill CMS or hide | needs-decision |
| 8 | SC-03 | major | Security | Supabase dashboard | §11.6 | Advisor, Auth URLs, PITR → not verifiable from repo | — | Owner checklist | needs-decision |
| 9 | SL-01 | major | Staff login | Supabase Auth | §17.2 | Google + 24 h invite → not configured | — | Owner settings | needs-decision |
| 10 | FN-03 | major | Functional | cron | §10.3 | SLA/reconciliation/statements/FX/reminder jobs → missing | `logs/db-audit.txt` | Add jobs | pending |
| 11 | PE-01 | major | Performance | storefront | §12 | LCP < 2.5 s → 2.8–4.3 s | `logs/lighthouse-prod.txt` | Deploy `e51be59`, then static-shell work | pending |
| 12 | UI-08 | major | UI | `/account/addresses` | §6 | Working link → 404 | `ui-pass.json` | Build page or drop link | pending |
| 13 | FN-05 | major | Functional | `/supplier/*` | §1, §8.3 | Built-but-off portal → not built | — | Build 5 screens | pending |
| 14 | FN-04 | major | Functional | shipments | §5 | No direct status writes → direct writes | code | via `system_record_tracking` | fixed `6d6c05d` |
| 15 | DA-01 | major | Data | 96 FKs | §12 | Indexed → unindexed | `logs/db-audit.txt` | migration 120 | fixed `1047c69` |
| 16 | UI-01 | major | UI | 12 routes | §19.1 | No sideways scroll at 360 → scrolled | `ui-pass.txt` | layout fixes | fixed `bc9cd77` `e36e4f4` `67afa17` `3c00751` |
| 17 | UI-02 | major | UI | all | §8.4 | Loading/error/404 states → none | — | boundaries + skeletons | fixed `69a97e2` |
| 18 | AC-01 | major | A11y | site-wide | §12 | Contrast 4.5:1 → 2.8–4.47 | `logs/ui-pass-baseline.txt` | text-safe shades | fixed `efe2055` `e36e4f4` |
| 19 | AC-02 | major | A11y | portals | §12 | Names/labels/keyboard → 7 axe rule types failing | same | fixes | fixed `ce23df6` `e36e4f4` |
| 20 | PE-02 | major | Performance | storefront | §12 | CLS < 0.1 → 0.22 | `logs/lighthouse-prod.txt` | static header | fixed `e51be59` |
| 21 | SC-02 | major | Security | pools | §19.1 | Pool settles audited → not audited | function source | trigger + test | fixed `a644638` |
| 22 | DA-06 | minor | Data/Money | approval limit | §15.1 | Per-currency limit → single number | `site_settings` | money schema change | needs-decision |
| 23 | IN-03 | minor | Integrations | outbox retries | §7/§10.2 | 24 h → ≈ 8.6 h | code | pick one | needs-decision |
| 24 | FN-07 | minor | Functional | seed | §11.4 | Order per status → 1 order | SQL | staging seed | needs-decision |
| 25 | SE-01 | minor | SEO | `/p/[slug]` | §19.4 | SEO 100 → 92 (streamed metadata) | Lighthouse | config trade-off | needs-decision |
| 26 | AP-04 | minor | API | Postman | §15.2 | Auto sync → no secrets | env | Owner secrets | needs-decision |
| 27 | FN-06 | minor | Functional | ad pause | §5 | Transition RPC → direct update | code | RPC | pending |
| 28 | DA-08 | minor | Data | soft delete | §6 | Audited everywhere → partly | — | lint/test | pending |
| 29 | IN-04 | minor | Integrations | deliveries | §19.4 | Replay 20 → none exist | logs | staging | pending |
| 30 | MO-01 | minor | Money | order cancel | §19.1 | Auto refund request → manual | code | emit request | pending |
| 31 | UI-03 | minor | UI | `/account` | §20.7 | New badge/counts/bell → missing | screenshot | nav badges | pending |
| 32 | UI-04 | minor | UI | `/admin` | Admin.png | Layout drift | screenshot | align | pending |
| 33 | UI-09 | minor | UI | pool/supplier/PDF | §8.3 | Compared → not checked | — | staging | pending |
| 34 | CO-01 | minor | Copy | layout | §8.4 | CMS metadata → hard-coded USD | code | generateMetadata | fixed `e3b8db3` |
| 35 | DA-02 | minor | Data | filter cols | §12 | Indexed → unindexed | `logs/explain.txt` | migration 121 | fixed `1047c69` |
| 36 | CO-03 | minor | Copy | UI chrome | §8.4 | From CMS → in code | grep | content_blocks | pending |
| 37 | CO-04 | minor | Copy | AI mock | §15.1 | Neutral → "USD" | code | fix copy | pending |
| 38 | AC-03 | minor | A11y | all | §12 | Manual SR/keyboard pass → not done | — | manual pass | pending |
| 39 | SE-02 | minor | SEO | `/pool/[code]` | §18.5 | JSON-LD checked → no data | — | staging | pending |
| 40 | PE-03 | minor | Performance | queries | §19.1 | No N+1 → not checked | — | tracing | pending |
| 41 | AP-03 | minor | API | supplier collection | §7 | Newman → not run | — | staging | pending |
| 42 | GB-01 | minor | Group buy | pools UI | §19.4 | Live parallel pools → not checked | — | staging | pending |
| 43 | BK-02 | minor | Backup | exports | §16.1 | Deterministic → not checked | — | staging | pending |
| 44 | CB-01 | minor | Content | CMS → storefront | §11.3 | Live edit/publish → not checked | — | staging | pending |
| 45 | UI-07 | polish | UI | `/account` | Customer.png | Pills/one-line codes | screenshot | css | fixed `e2accd3` |
| 46 | FN-08 | polish | Functional | `/pools/start` | §9 | 307 → streamed redirect | `logs/smoke.txt` | session check first | pending |
| 47 | DA-07 | polish | Data | definer views | §6 | Documented | — | comment | pending |
| 48 | IN-05 | polish | Integrations | dropship webhook | §7 | Later phase | — | later | pending |
| 49 | IN-06 | polish | Integrations | payment secret | §12 | `||` fallback | code | one-char fix | pending |
| 50 | UI-06 | polish | UI | `/` pools | §18.4 | Section visible → hidden when empty | screenshot | empty CTA | pending |
| 51 | CO-05 | polish | Copy | adapters/openapi | §8.4 | Config → code | grep | env/CMS | pending |
| 52 | CO-07 | polish | Copy | footer | §8.2 | Branches listed → only when >1 | code | always list | pending |
| 53 | SE-03 | polish | SEO | robots | §12 | Standard → `Host:` line | curl | remove | pending |
| 54 | PE-04 | polish | Performance | AdSlot/Logo | §8.4 | next/image → `<img>` | code | next/image | pending |
| 55 | SC-04 | polish | Security | server client | §12 | `server-only` guard → missing | code | add import | pending |

## Commits made in this pass (not pushed)

| Commit | What |
| --- | --- |
| `1047c69` | Index every FK (96) and 21 queue/status filter columns — migrations `20261101000120`, `20261101000121` (DA-01, DA-02) |
| `6d6c05d` | Shipment create + sandbox tracking through `system_record_tracking` (FN-04) |
| `e3b8db3` | Default title/description from CMS with `{currency}` (CO-01) |
| `69a97e2` | Error boundaries, 404 page, portal loading skeletons (UI-02) |
| `efe2055` | AA contrast: text-safe status shades and brand blue, underlined footer link (AC-01) |
| `ce23df6` | Accessible names, labelled file inputs, focusable scroll regions, valid `<dl>` (AC-02) |
| `bc9cd77` | 360 px: scroll regions contain sr-only headers, quote CTA wraps, office grid, staff login column (UI-01) |
| `e36e4f4` | 360 px admin grids, home CTA contrast, ARIA on ads bars (UI-01, AC-01, AC-02) |
| `a644638` | Audit every automatic pool state change — migration `20261101000122` + pools test assertion (SC-02) |
| `e2accd3` | Badges never squash; RFQ codes don't wrap (UI-07) |
| `67afa17` | Admin activity + finance journal lists stack at 360 px (UI-01) |
| `3c00751` | Admin period filter wraps at 360 px (UI-01) |
| `e51be59` | Storefront header in the static shell — CLS 0.22 → 0 (PE-02) |
| (this report) | `docs/QA_REPORT.md`, `docs/qa/2026-11-01/**` |

Migrations `20261101000120`–`122` are applied to the live database (additive indexes and one audit trigger; no data changed).

## What could not be checked, and why

- Browser golden paths, live group-buy pools, CMS edit → storefront, exports, outbound webhook replay, `/pool/[code]`: they would commit money/content rows to the production database; there is no staging project.
- Supabase Security/Performance Advisors, Auth URL configuration, invite expiry, Google provider, PITR: dashboard only, no management token in the repo.
- Supplier portal screens and the supplier Newman collection: not built / no supplier client.
- Lighthouse on production reflects the deployment **before** this pass (fixes are committed locally, not pushed).
- Manual keyboard / screen-reader walk-through: only automated axe checks were run.

## Clean-up (production database)

Removed after use: every temporary TOTP factor created for demo staff (deleted by id; the owner's factor on `admin@` was not touched), the unverified enrolment factor step 2 may create for `qc@` (none was created), the temporary QA admin `qa-admin@demo.octopusb2b.com` (MFA factors, `user_roles`, `profiles`, auth user), the temporary Newman API client and key, probe rows in `integration_logs`, the lockout counter after the wrong-password probe. Kept (append-only by design): `audit_log` rows for the QA admin's role grant and the sign-ins/workspace switches of the test sessions. All other write tests ran inside rolled-back transactions.

---

**Verdict: no-go for release** — three block items are open (legal text, backups, live integrations); none of them can be fixed in code alone.

**Top three risks**

1. **Placeholder legal terms are published and accepted on every order and pledge** (CO-02) — disputes would run on "[Draft …]" text. Owner: **Legal** (text) with **Owner/Admin** (publish).
2. **No backups and no tested restore** (BK-01) — a bad migration or deletion today is unrecoverable beyond whatever Supabase keeps by default. Owner: **Owner/Admin** (bucket, secrets, PITR) with **Developer** (first backup, drill).
3. **Integrations are sandbox-only and the outbox runs once a day** (IN-02, FN-02) — no real payments or e-mails, and every notification/PDF/webhook can be up to 24 h late. Owner: **Owner/Admin** (providers, credentials, Vercel plan) with **Developer** (live payment adapter, dispatcher cadence).

**Shortest path to green**

1. Legal delivers the 15 T&C + 8 Group Buy sections → Content editor enters them → Admin publishes v1.1 / GB-1.1 (closes CO-02).
2. Owner creates the off-site bucket + age key, adds `GITHUB_ACTIONS_TOKEN`, `BACKUP_S3_*`, `BACKUP_CALLBACK_SECRET` to GitHub/Vercel, enables PITR; Developer runs "Back up now" and one restore drill into scratch (closes BK-01).
3. Owner picks payment and e-mail providers and the YunExpress account; Developer adds the live payment adapter, sets the dispatcher to ≤ 1 min (Vercel Pro cron or pg_net), adds the missing §10.3 jobs; one real small order end to end (closes IN-02, FN-02, FN-03).
4. Push the 14 QA commits, deploy, re-run Lighthouse; fix `/account/addresses`, fill or hide testimonials, decide AP-02 and SE-01.
5. Stand up staging and run the 8 golden paths + the group-buy path there; then repeat this report.
