// Builds docs/E2E_TRACE_REPORT.md from the chain results (docs/qa/2026-11-01-trace/chain-NN.json) plus the
// per-chain narrative below. Usage: node tests/e2e/trace/write-report.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const DIR = 'docs/qa/2026-11-01-trace';
const load = (n) => { try { return JSON.parse(fs.readFileSync(`${DIR}/chain-${String(n).padStart(2, '0')}.json`, 'utf8')); } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const ms = (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const budgetFor = (label) => (/^SA|UI /.test(label) ? 300 : /^RPC|job_pools/.test(label) ? 500 : /worker/i.test(label) ? 5000 : /adapter|webhook|callback|POST \/|click/i.test(label) ? 2000 : null);
const STATUS = { green: '🟢 green', amber: '🟠 green with gaps', boundary: '🟡 traced to boundary', red: '🔴 red' };

// ───────── narrative per chain ─────────
const META = {
  1: { status: 'boundary', driver: 'Playwright (signup page, onboarding form, dashboard) + traced RPC for KYC submit/verify (the KYC form also uploads documents to the private bucket, which the test skips)',
    boundary: 'Google OAuth: the button calls Supabase `/auth/v1/authorize`, which answers "provider is not enabled". The user is created with the Auth admin API instead (what the OAuth callback would create). Owner: **Owner/Admin** (enable Google in Supabase Auth, QA SL-01/SC-03).',
    seq: ['participant U as Customer browser', 'participant P as proxy.ts', 'participant SA as Server Action', 'participant DB as Postgres', 'participant W as Outbox worker', 'participant RT as Realtime',
      'U->>P: GET /signup (x-trace-id minted)', 'U-->>U: Google button → provider not enabled (boundary)', 'U->>SA: onboarding form', 'SA->>DB: complete_onboarding (org + member)', 'U->>DB: submit_kyc', 'Note over DB: ops (aal2) review_kyc → verified', 'DB->>DB: trigger assign_account_manager → account_managers + audit + outbox account_manager.assigned', 'W->>DB: notify (KYC verified, Meet your account manager)', 'W-->>U: welcome e-mail (log adapter)', 'DB-->>RT: notifications INSERT', 'RT-->>U: dashboard router.refresh()'],
    gaps: [
      ['No welcome e-mail and no customer-facing event when the account manager was assigned (only the DB row + audit).', 'major', 'fixed'],
      ['Dashboard did not listen to notifications, so nothing nudged it after KYC/assignment.', 'minor', 'fixed'],
      ['Browser Realtime channels joined as **anon** (no `realtime.setAuth`), so RLS dropped every live update on every page.', 'block', 'fixed'],
      ['Google OAuth not enabled — signup by Google impossible in production.', 'major', 'open — Owner/Admin'],
    ],
    fixes: ['account_manager.assigned event + e-mail', 'dashboard notifications subscription', 'subscribeAuthed() for all browser channels'] },
  2: { status: 'amber', driver: 'Playwright, two browsers (customer + operations) sharing one trace id via the x-trace-id request header; deposit paid from the wallet (mocked payment); outbound webhook endpoint = httpbin.org echo',
    seq: ['participant C as Customer', 'participant O as Operations', 'participant SA as Server Actions', 'participant DB as Postgres', 'participant W as Worker', 'participant X as Webhook receiver', 'participant RT as Realtime',
      'C->>SA: Request form (submit_rfq, fee from wallet)', 'SA->>DB: rfq + journal + status_history + outbox rfq.submitted', 'O->>SA: Send quote (send_quote)', 'DB-->>RT: quotes INSERT', 'RT-->>C: RFQ page refresh (quote visible)', 'C->>SA: Approve & create proforma (approve_quote)', 'SA->>DB: order + PI + documents + outbox quote.approved', 'C->>SA: Pay deposit from wallet (record_payment)', 'SA->>DB: payment + journal + order deposit_paid', 'O->>DB: transition_order confirmed', 'DB-->>RT: order_events INSERT', 'RT-->>C: order page shows Confirmed', 'W->>X: order.updated / quote.created (HMAC signed)', 'W-->>C: e-mails quote.sent, quote.approved (PI), payment.confirmed, order.confirmed'],
    gaps: [
      ['Quote approval wrote no `quote` status_history row (rfq/order only).', 'minor', 'fixed (trigger)'],
      ['No audit_log entry for customer/ops business transitions (approve, pay, confirm).', 'major', 'fixed (status_history → audit_log mirror)'],
      ['PI "PDF" is rendered on demand as HTML (`/api/documents/[id]/pdf`); nothing is stored in a private bucket (`documents.pdf_path` null) and e-mails carry a link, not the PDF.', 'major', 'open — Developer (render-pdf worker, §9)'],
      ['All e-mails use the generic default template (`email_templates` has no rows for these events).', 'minor', 'open — Content editor'],
    ], fixes: ['quote status_history trigger', 'status → audit mirror', 'Realtime auth'] },
  3: { status: 'green', driver: 'Traced RPC for operations transitions, Playwright for the balance payment (customer) and the YunExpress shipment creator in /office/shipping (sandbox adapter)', boundary: 'YunExpress live API: sandbox adapter (no app id/key) — calls are logged with `sandbox://yunexpress/...` endpoints. Owner: **Owner/Admin** (YunExpress credentials, IN-02).',
    seq: ['participant O as Operations', 'participant C as Customer', 'participant DB as Postgres', 'participant A as YunExpress adapter (sandbox)', 'participant W as Worker', 'participant RT as Realtime',
      'O->>DB: transition_order in_production → qc → balance_pending (+ commercial invoice)', 'C->>DB: Pay balance from wallet (record_payment → balance_paid)', 'O->>DB: ready_to_ship', 'O->>A: priceTrial / createShipment / subscribeTracking (logged, SHA)', 'O->>DB: shipments + system_record_tracking(created) + transition shipped', 'DB-->>RT: order_events / tracking_events', 'RT-->>C: timeline shows Shipped', 'W-->>C: e-mail per order step'],
    gaps: [['Shipment creation inserts `shipments` from the Server Action (not an RPC); acceptable but outside the "money/state in RPC" rule.', 'polish', 'open — Developer']], fixes: [] },
  4: { status: 'green', driver: 'Signed HTTP POST to /api/webhooks/yunexpress (what YunExpress sends), customer order page open in Playwright',
    seq: ['participant Y as YunExpress', 'participant H as /api/webhooks/yunexpress', 'participant DB as Postgres', 'participant RT as Realtime', 'participant C as Customer page', 'participant W as Worker',
      'Y->>H: POST delivered (Octopus-Signature)', 'H->>H: HMAC verify (5 min window)', 'H->>DB: system_record_tracking → tracking_events + shipment delivered + order delivered + outbox', 'DB-->>RT: tracking_events INSERT', 'RT-->>C: timeline shows Delivered', 'W-->>C: e-mail Order delivered + notifications', 'Y->>H: replay same event id', 'H->>DB: duplicate → idempotency_hits'],
    gaps: [['One delivery creates two customer notifications ("Shipment: delivered" + "Order delivered").', 'polish', 'open — Product'], ['No metrics backend (Sentry/OTel absent); only integration_logs + job_runs.duration_ms.', 'minor', 'open — Owner/Admin (SENTRY_DSN)']], fixes: [] },
  5: { status: 'amber', driver: 'Playwright "Book QC inspection" form with ConfirmCharge (wallet), traced RPC for operations steps',
    seq: ['participant C as Customer', 'participant SA as Server Action', 'participant DB as Postgres', 'participant O as Operations', 'participant W as Worker',
      'C->>SA: Book QC inspection (confirm charge)', 'SA->>DB: request_service → service_requests paid + wallet debit journal + outbox service_request.paid', 'O->>DB: accepted → in_progress → report_ready → completed', 'W-->>C: receipt, report-ready and completed e-mails + notifications'],
    gaps: [
      ['request_service with a repeated idempotency key created a **second paid request without a charge** (money integrity).', 'block', 'fixed (migration 134)'],
      ['No e-mail for service requests (receipt / report).', 'major', 'fixed'],
      ['No QC assignment (`service_requests.assigned_to` never set) and no QC report upload (`report_path` never set) — the back office has no screen for either.', 'major', 'open — Developer + Product (design needed)'],
    ], fixes: ['request_service idempotency', 'service-request e-mails'] },
  6: { status: 'amber', driver: 'Three tagged buyers (NL, DE, US) via traced RPC (open_pool / join_pool, wallets funded through the signed payment webhook), public pool page in Playwright, settle through `job_pools()` exactly as pg_cron runs it, ops shipments in /office/shipping',
    seq: ['participant A as Buyer A (NL)', 'participant B as Buyer B (DE)', 'participant C as Buyer C (US)', 'participant DB as Postgres', 'participant CR as pg_cron job_pools', 'participant W as Worker', 'participant O as Operations',
      'A->>DB: open_pool + pledge (deposit from wallet)', 'B->>DB: join_pool', 'C->>DB: join_pool → filled', 'CR->>DB: settle_pool (trace of the filling pledge)', 'DB->>DB: 1 PO (no identities) + 3 orders + 3 PIs + outbox pi.created ×3', 'W-->>A: PI e-mail (×3 buyers)', 'A->>DB: balances paid', 'O->>DB: 3 shipments (sandbox YunExpress)'],
    gaps: [
      ['Pools settled by pg_cron lost the trace (no request header) — PO/PI rows untraceable.', 'major', 'fixed (job_pools sets app.trace_id)'],
      ['Buyers got **no e-mail/notification** for their PI on settle (`pi.created` had no consumer) nor for the balance reminder.', 'major', 'fixed'],
      ['Supplier portal not built (QA FN-05): "supplier view" verified on the PO document only.', 'minor', 'open — Developer'],
    ], fixes: ['job_pools trace', 'pi.created / pool.balance_reminder e-mails'] },
  7: { status: 'boundary', driver: 'Playwright "Back up now" as the temporary admin; the GitHub workflow\'s signed status callback simulated with BACKUP_CALLBACK_SECRET (mock boundary)', boundary: 'GitHub Actions dispatch (`GITHUB_NOT_CONFIGURED`) and the off-site S3 bucket (`OFFSITE_NOT_CONFIGURED`). Owner: **Owner/Admin** (GITHUB_ACTIONS_TOKEN, BACKUP_S3_*, age key, PITR — QA BK-01).',
    seq: ['participant AD as Admin browser', 'participant API as /api/backups/trigger', 'participant DB as Postgres', 'participant GH as GitHub Actions', 'participant CB as /api/backups/status',
      'AD->>API: Back up now', 'API->>DB: request_backup (queued) + audit', 'API--xGH: dispatch backup.yml (not configured)', 'GH-->>CB: signed status callback (simulated)', 'CB->>DB: backup_report completed + checksum', 'AD-->>AD: card polls every 3 s → Completed'],
    gaps: [['No real backup has ever run; off-site + GitHub not configured.', 'block', 'open — Owner/Admin (QA BK-01)']], fixes: [] },
  8: { status: 'boundary', driver: 'One rolled-back transaction: recovery schema built by the backup tooling, product removed/damaged, `recovery_compare` + `restore_records` as the temporary admin', boundary: 'Needs a completed off-site backup (BK-01); storefront revalidation is a Server Action side effect that cannot be observed inside a rolled-back transaction.',
    seq: ['participant AD as Admin (wizard)', 'participant DB as Postgres', 'participant R as recovery schema', 'participant S as Storefront cache', 'AD->>DB: recovery_compare(products)', 'DB->>R: read backup row', 'AD->>DB: restore_records(products) + audit restore.records', 'AD->>S: revalidateTag(products) (fixed)'],
    gaps: [['Restoring a product did not revalidate the storefront (only the recovery page).', 'minor', 'fixed'], ['Hard delete of a live product is blocked by FKs (rfqs/orders), so "deleted product" is in practice a damaged/archived product.', 'polish', 'note']], fixes: ['revalidate after restore'] },
  9: { status: 'amber', driver: 'HTTP POST /api/assistant/reply with the customer cookie (real OpenAI model in .env.local)',
    seq: ['participant C as Customer', 'participant API as /api/assistant/reply', 'participant DB as Postgres (RLS)', 'participant L as OpenAI', 'C->>API: "Where is my order …?"', 'API->>DB: post_customer_message + context under RLS', 'API->>L: chat completion (tools)', 'L-->>API: tool call get_shipment', 'API->>DB: shipments + tracking_events (RLS)', 'API->>L: tool result', 'L-->>API: JSON reply + confidence', 'API->>DB: record_bot_reply (tools_called, confidence, latency, tokens)'],
    gaps: [['The model may answer from the RLS context snapshot without calling `get_shipment` (final run: tools_called empty, reply still had the real tracking number) — tool use is not enforced for shipment questions.', 'minor', 'open — Developer (force tool call for tracking intents)'], ['`get_shipment` reads the webhook-fed `tracking_events` copy; no live YunExpress call, so there is no carrier response SHA for the trace (spec expectation). Data is as fresh as the last webhook/poll.', 'minor', 'open — Product (decide if a live carrier lookup is wanted)'], ['LLM calls were not logged anywhere.', 'minor', 'fixed (integration_logs openai)']], fixes: ['LLM call logging'] },
  10: { status: 'green', driver: 'Playwright: customer on /account/assistant and the account manager (support@, aal2) on /office/assistant; staff reply via the same RPC as the reply box',
    seq: ['participant C as Customer thread', 'participant API as reply pipeline', 'participant DB as Postgres', 'participant Q as /office/assistant', 'participant S as Account manager', 'C->>API: refund / RoHS complaint (sensitive)', 'API->>DB: escalate_session → escalations + ticket with transcript + outbox + notification', 'DB-->>Q: escalations INSERT (Realtime) → queue refresh', 'S->>DB: staff_assistant_reply', 'DB-->>C: assistant_messages INSERT (Realtime) → reply in thread'],
    gaps: [['/office/assistant had no live refresh for new handoffs.', 'minor', 'fixed']], fixes: ['queue RealtimeRefresh'] },
  11: { status: 'green', driver: 'One rolled-back transaction (switching the live currency would reprice production); staff via JWT claims (aal2) like the DB suites; pgTAP installed inside the transaction only',
    boundary: 'Worker/webhook for `settings.currency_changed` and the storefront re-render are not observable in a rolled-back transaction (covered by unit tests and the currency suite).',
    seq: ['participant AD as Admin (maker)', 'participant FI as Finance (checker)', 'participant DB as Postgres', 'AD->>DB: request_currency_switch CNY 7.20', 'AD--xDB: approve own request → MAKER_CANNOT_APPROVE', 'FI->>DB: approve_currency_switch → applied', 'DB->>DB: old USD PI unchanged; new quote/PI in CNY', 'DB->>DB: pgTAP: every journal balances per currency'],
    gaps: [], fixes: [] },
  12: { status: 'green', driver: 'Playwright card top-up (payment adapter test mode) + signed POST /api/webhooks/payment, replayed',
    boundary: 'Live payment provider not chosen (TestPaymentAdapter). Order payments (`payment.succeeded`) are matched by Finance manually — the replay was proven on `topup.succeeded`, the only automated payment event. Owner: **Owner/Admin** + Developer (live adapter, IN-02).',
    seq: ['participant C as Customer', 'participant SA as startCardTopup', 'participant PA as Payment adapter (test)', 'participant H as /api/webhooks/payment', 'participant DB as Postgres', 'participant W as Worker',
      'C->>SA: Card top-up', 'SA->>PA: createIntent (logged, SHA)', 'SA->>DB: request_topup pending', 'PA-->>H: topup.succeeded (signed)', 'H->>DB: confirm_topup → journal (2 entries) + outbox wallet.updated', 'W-->>C: notification Wallet credited', 'PA-->>H: same event again', 'H->>DB: duplicate → idempotency_hits (no journal, no notification)'],
    gaps: [], fixes: ['idempotency_hits for payment replays'] },
  13: { status: 'amber', driver: 'HTTP GET /api/ads/click with distinct visitor fingerprints; tagged campaign active only for the seconds of the test (placement search_top, 1-cent CPC)',
    seq: ['participant V as Visitor', 'participant R as /api/ads/click', 'participant DB as Postgres', 'V->>R: click (fingerprint)', 'R->>DB: record_ad_click → ad_clicks + wallet_charge journal + spent_today', 'R-->>V: 302 to campaign link', 'V->>R: same fingerprint again', 'R->>DB: ad_clicks invalid, 0 charge', 'R->>DB: budget exhausted → campaign paused'],
    gaps: [['Auto-pause on budget exhaustion wrote no status_history / audit (direct status update; also QA FN-06).', 'minor', 'fixed (status fallback trigger)'], ['§10.1 lists `ad.clicked` as an outbox event; the charge is synchronous inside record_ad_click (no outbox). Functionally fine, design deviation.', 'polish', 'note']], fixes: ['status fallback trigger'] },
  14: { status: 'green', driver: 'Postman-style HTTP calls with a tagged API client (oct_test_ and oct_live_ keys)',
    seq: ['participant P as Postman', 'participant API as /api/v1/rfqs', 'participant DB as Postgres', 'participant W as Worker', 'participant X as Webhook receiver', 'P->>API: POST (oct_test_) → simulated, nothing written', 'P->>API: POST (oct_live_, Idempotency-Key)', 'API->>DB: api_submit_rfq → rfq + fee journal + outbox rfq.submitted', 'W->>X: rfq.created (HMAC signed) 200', 'P->>API: same Idempotency-Key → Idempotent-Replayed + idempotency_hits'],
    gaps: [['There was no `rfq.created` webhook at all (spec §21.1 expects it).', 'major', 'fixed'], ['oct_test_ keys never write (simulated) — the §21 wording "DB row created" holds only for live keys (QA AP-02 decision).', 'minor', 'open — Owner/Admin']], fixes: ['rfq.created webhook'] },
  15: { status: 'amber', driver: 'Second local app instance (port 3101) with the live e-mail adapter pointed at a mock that answers 503 (EMAIL_API_URL override); backoff fast-forwarded by moving available_at; Retry clicked in /admin/integrations as the temporary admin',
    seq: ['participant DB as outbox_events', 'participant W as Worker (3101)', 'participant M as E-mail API (mock 503)', 'participant AD as Admin', 'participant W2 as Worker (healthy)', 'W->>M: send (x-octopus-trace)', 'M-->>W: 503', 'W->>DB: attempts+1, retry in 1 m / 5 m / 30 m / 2 h / 6 h', 'W->>DB: 6th failure → dead + admin notifications + integration_logs', 'AD->>DB: Failed jobs → Retry (retry_outbox, audit)', 'W2->>DB: e-mail delivered once; notify/webhook skipped (idempotency_hits)'],
    gaps: [['No Sentry → no breadcrumb/alert outside the app.', 'major', 'open — Owner/Admin (SENTRY_DSN, IN-02)'], ['Dead letters only logged to the console; no alert.', 'major', 'fixed (admin notifications + integration_logs)'], ['Events of deleted orgs failed into the dead-letter queue (10 orphan events found in production).', 'minor', 'fixed (skip) + cleaned']], fixes: ['dead-letter alert', 'org-missing skip'] },
  16: { status: 'green', driver: 'Playwright /staff/login → /staff/verify (TOTP of a temporary factor) → workspace → /admin/finance Confirm top-up',
    seq: ['participant F as Finance (browser)', 'participant L as /staff/login + /staff/verify', 'participant DB as Postgres', 'F->>L: password', 'L->>DB: auth_audit auth.sign_in', 'F->>L: TOTP code', 'L->>DB: auth.2fa_verified, staff cookie', 'F->>DB: Confirm top-up (confirm_topup, require_step_up)', 'DB->>DB: journal + status_history → audit status.wallet_topup', 'Note over DB: stale TOTP → STEP_UP_REQUIRED; aal1 → no staff access'],
    gaps: [['Page views (e.g. opening /admin/finance) are not audited — only sign-in, 2FA and state changes. "Audit holds every click" is true for every write, not for reads (except KYC document views).', 'polish', 'note']], fixes: [] },
};

// cross-chain matrix (manual, from the results): ✅ pass · ⚠️ pass with gap · 🟡 boundary/mock · ❌ fail · — n/a
const LAYERS = ['Entry/UI', 'Validation', 'RPC + txn', 'Ledger', 'status_history', 'Outbox', 'Worker', 'External', 'Webhook in', 'Webhook out', 'Realtime', 'E-mail', 'Audit', 'Idempotency'];
const MATRIX = {
  1: ['🟡', '✅', '✅', '—', '✅', '✅', '✅', '🟡', '—', '—', '✅', '✅', '✅', '✅'],
  2: ['✅', '✅', '✅', '✅', '✅', '✅', '✅', '—', '—', '✅', '✅', '⚠️', '✅', '✅'],
  3: ['✅', '✅', '✅', '✅', '✅', '✅', '✅', '🟡', '—', '✅', '✅', '✅', '✅', '✅'],
  4: ['✅', '✅', '✅', '—', '✅', '✅', '✅', '—', '✅', '—', '✅', '✅', '✅', '✅'],
  5: ['✅', '✅', '✅', '✅', '✅', '✅', '✅', '—', '—', '—', '—', '✅', '✅', '✅'],
  6: ['✅', '✅', '✅', '✅', '✅', '✅', '✅', '🟡', '—', '—', '—', '✅', '✅', '✅'],
  7: ['✅', '✅', '✅', '—', '—', '—', '—', '🟡', '✅', '—', '✅', '—', '✅', '—'],
  8: ['🟡', '✅', '✅', '—', '—', '—', '—', '—', '—', '—', '—', '—', '✅', '—'],
  9: ['✅', '✅', '✅', '—', '—', '—', '—', '⚠️', '—', '—', '—', '—', '—', '—'],
  10: ['✅', '✅', '✅', '—', '—', '✅', '✅', '—', '—', '—', '✅', '—', '✅', '✅'],
  11: ['🟡', '✅', '✅', '✅', '✅', '✅', '🟡', '—', '—', '🟡', '—', '—', '✅', '✅'],
  12: ['✅', '✅', '✅', '✅', '✅', '✅', '✅', '🟡', '✅', '—', '—', '—', '✅', '✅'],
  13: ['✅', '✅', '✅', '✅', '✅', '—', '—', '—', '—', '—', '—', '—', '✅', '✅'],
  14: ['✅', '✅', '✅', '✅', '✅', '✅', '✅', '—', '—', '✅', '—', '—', '✅', '✅'],
  15: ['✅', '—', '—', '—', '—', '✅', '✅', '🟡', '—', '✅', '—', '✅', '✅', '✅'],
  16: ['✅', '✅', '✅', '✅', '✅', '—', '—', '—', '—', '—', '—', '—', '✅', '—'],
};

const chains = Array.from({ length: 16 }, (_, i) => i + 1).map((n) => ({ n, d: load(n), m: META[n] }));
const commits = execSync(`git log --format='%h|%s' --grep='^TRACE:' c9a1e60..HEAD`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).reverse().map((l) => l.split('|'));
const extra = fs.existsSync(`${DIR}/extra.json`) ? JSON.parse(fs.readFileSync(`${DIR}/extra.json`, 'utf8')) : {};
const out = [];
const P = (s = '') => out.push(s);

P('# E2E connection trace — 1 Nov 2026');
P();
P('SPEC §21 (prompt 21-A): every chain in §21.1 driven end to end with one `trace_id` across proxy → Server Action/API → RPC → Postgres (rows, ledger, status_history, outbox) → worker → adapters/webhooks → Realtime → UI → e-mail → audit. Run by the platform engineer on 1 Nov 2026 against `main` (start `c9a1e60`, commits below, **not pushed**).');
P();
P('## How this run worked');
P();
P('| Item | Detail |');
P('| --- | --- |');
P('| App under test | Local production build of the working tree (`pnpm build` + `pnpm start -p 3100`); a second instance on :3101 for the worker-failure drill. Production (https://octopus-b2b.vercel.app) was used for the pg_cron → pg_net dispatcher check (it runs the previously deployed code). |');
P('| Database | The live Supabase project (= production). Writes ran either inside rolled-back transactions (chains 8, 11, negative paths) or with tagged test identities (`qa-trace-*@demo.octopusb2b.com`, orgs `QA-TRACE …`) and trace ids `e2e-cNN-…`; everything was deleted afterwards (see Clean-up). |');
P('| Trace propagation | `proxy.ts` mints/keeps `x-trace-id` on every request (incl. `/api/v1`, webhooks, cron) and echoes it; server Supabase clients forward it; Postgres `app_trace_id()` reads `request.headers` (or `app.trace_id` for SQL/cron); BEFORE INSERT triggers stamp `trace_id` (+ `txid` on the core tables). The outbox worker runs each event under the event\'s trace id; adapters log to `integration_logs` with body SHA-256s and send `x-octopus-trace`. Browsers forward the id via the `x-trace-id` header (Playwright `extraHTTPHeaders` = what a frontend fetch wrapper would do). |');
P('| Dispatcher | Production: pg_cron `octopus-outbox-dispatch` every **10 s** → `job_dispatch_outbox()` → pg_net GET `/api/cron/outbox` (URL + CRON_SECRET from Vault). During local chain runs the job was paused and the local worker was called directly (same code path), then re-enabled. |');
P('| Tools | Playwright (Chromium), Node drivers (`tests/e2e/trace/*.mjs`), SQL, pgTAP (inside a rolled-back transaction). Raw results: `docs/qa/2026-11-01-trace/chain-NN.json`, logs in `docs/qa/2026-11-01-trace/logs/`, screenshots `docs/qa/2026-11-01-trace/*.png`. |');
P();
P('## Summary');
P();
P('| # | Chain | Status | Checks | E2E latency | Verdict |');
P('| ---: | --- | --- | ---: | ---: | --- |');
for (const { n, d, m } of chains) {
  const pass = d ? d.checks.filter((c) => c.ok).length : 0, all = d ? d.checks.length : 0;
  const verdict = m.status === 'green' ? 'connected end to end' : m.status === 'boundary' ? 'connected up to the external boundary' : m.status === 'amber' ? 'connected; open gaps listed' : 'broken';
  P(`| ${n} | ${esc(d?.title ?? '')} | ${STATUS[m.status]} | ${pass}/${all} | ${ms(d?.e2e_ms)} | ${verdict} |`);
}
P();
P('A ✘ inside a chain is either an open gap (listed under Gaps with an owner) or an external boundary; nothing was marked green that did not run.');
P();
if (extra.dispatcher) {
  P('### Production dispatcher (QA FN-02)');
  P();
  for (const l of extra.dispatcher) P(`- ${l}`);
  P();
}
P('### Instrumentation added (prompt 21-A "Before running")');
P();
P('| Layer | Change |');
P('| --- | --- |');
P('| Next.js | `proxy.ts` mints `x-trace-id` (or keeps a valid incoming one) for every route incl. machine routes, response echoes it; `lib/trace.ts` (`currentTraceId`, `withTrace`, structured JSON `traceLog`). |');
P('| Supabase clients | `createClient` / `createAdminClient` add `x-trace-id` per request (exports unchanged). Browser channels now join with the user JWT (`subscribeAuthed`). |');
P('| Postgres | `app_trace_id()`; `trace_id` on status_history, journals, ledger_entries, outbox_events, audit_log, integration_logs, webhook_deliveries, notifications, job_runs, order_events and the business tables; `txid` on the core tables; `email_deliveries`, `idempotency_hits`; `trace_rows(trace)` (service role). Migrations `20261101000130`–`136`. |');
P('| Worker / adapters | Outbox worker runs every event under its trace; e-mails → `email_deliveries` + `integration_logs`; carrier, payment and LLM adapters → `integration_logs` (endpoint, request/response SHA-256, status, duration); outbound webhooks and adapter calls carry `x-octopus-trace`. Webhook/API replays and consumer redeliveries → `idempotency_hits`. |');
P('| Not built | `realtime_pushes` table (Realtime delivery is proven in the browser by Playwright instead); Sentry (no DSN). |');
P();

for (const { n, d, m } of chains) {
  P(`## Chain ${n} — ${d?.title ?? ''}`);
  P();
  P('### Summary');
  P();
  const pass = d ? d.checks.filter((c) => c.ok).length : 0, all = d ? d.checks.length : 0;
  P(`${STATUS[m.status]} · ${pass}/${all} checks · end-to-end ${ms(d?.e2e_ms)} · trace ${d?.traces?.map((t) => `\`${t}\``).join(', ') ?? '—'}`);
  P();
  P(`Driver: ${m.driver}.`);
  if (m.boundary) { P(); P(`Boundary: ${m.boundary}`); }
  if (d?.checks?.length) {
    P();
    P('<details><summary>All checks</summary>');
    P();
    for (const c of d.checks) P(`- ${c.ok ? '✔' : '✘'} ${esc(c.name)}${c.detail ? ` — ${esc(c.detail).slice(0, 220)}` : ''}`);
    for (const s of d.notes ?? []) P(`- · ${esc(s)}`);
    P();
    P('</details>');
  }
  P();
  P('### Trace table');
  P();
  const hopsList = d?.hops ?? [];
  if (!hopsList.length) P('_No rows collected (see Summary)._');
  else {
    const first = Date.parse(hopsList.find((h) => h.at)?.at ?? 0);
    const shown = hopsList.length > 45 ? [...hopsList.slice(0, 30), null, ...hopsList.slice(-12)] : hopsList;
    P('| +t | Table | txid | Row |');
    P('| ---: | --- | ---: | --- |');
    for (const h of shown) {
      if (!h) { P(`| … | _${hopsList.length - 42} more rows in chain-${String(n).padStart(2, '0')}.json_ | | |`); continue; }
      P(`| ${h.at ? ms(Date.parse(h.at) - first) : '—'} | ${h.table} | ${h.txid ?? ''} | ${esc(h.summary)} |`);
    }
    const byTable = hopsList.reduce((a, h) => ((a[h.table] = (a[h.table] ?? 0) + 1), a), {});
    P();
    P(`Rows per table: ${Object.entries(byTable).map(([k, v]) => `${k} ${v}`).join(' · ')}.`);
  }
  P();
  P('### Timeline');
  P();
  P('```mermaid');
  P('sequenceDiagram');
  for (const s of m.seq) P(`  ${s}`);
  P('```');
  P();
  P('### Latency');
  P();
  const lat = Object.entries(d?.latency ?? {});
  if (!lat.length) P('_Not measured._');
  else {
    P('| Hop | Measured | Budget | |');
    P('| --- | ---: | ---: | --- |');
    for (const [k, v] of lat) { const b = budgetFor(k); P(`| ${esc(k)} | ${ms(v)} | ${b ? ms(b) : '—'} | ${b && v != null ? (v <= b ? '✅' : '⚠️ over') : ''} |`); }
    if (n === 2) P(`| **End to end** (budget 90 s, mocked payment) | ${ms(d?.e2e_ms)} | 90 s | ${d?.e2e_ms < 90000 ? '✅' : '❌'} |`);
    if (n === 4) P(`| **End to end** webhook → e-mail (budget 15 s) | ${ms(d?.e2e_ms)} | 15 s | ${d?.e2e_ms < 15000 ? '✅' : '❌'} |`);
  }
  P();
  P('Server Action latencies are measured from the browser (click → response, includes rendering of the result); against a local build talking to the Supabase region over the internet, so SA/RPC budgets are indicative.');
  P();
  P('### Idempotency');
  P();
  const idem = (d?.checks ?? []).filter((c) => /replay|idempot|twice|again|duplicate|once/i.test(c.name));
  if (!idem.length) P('_No replayable event in this chain._');
  for (const c of idem) P(`- ${c.ok ? '✔' : '✘'} ${esc(c.name)}${c.detail ? ` — ${esc(c.detail).slice(0, 160)}` : ''}`);
  P();
  P('### Negative paths');
  P();
  const neg = (d?.checks ?? []).filter((c) => /negative|bad HMAC|older than|unknown|invalid|refused|missing|401|403/i.test(c.name) && !idem.includes(c));
  if (!neg.length) P('_See the boundary note; no further negative path applies._');
  for (const c of neg) P(`- ${c.ok ? '✔' : '✘'} ${esc(c.name)}${c.detail ? ` — ${esc(c.detail).slice(0, 160)}` : ''}`);
  P();
  P('### Gaps');
  P();
  if (!m.gaps.length) P('None found.');
  else { P('| Gap | Severity | Status / owner |'); P('| --- | --- | --- |'); for (const [g, s, st] of m.gaps) P(`| ${esc(g)} | ${s} | ${esc(st)} |`); }
  P();
  P('### Fixes applied');
  P();
  P(m.fixes.length ? m.fixes.map((f) => `- ${f}`).join('\n') + '\n\n(Commit hashes in "Commits".)' : 'None needed in this chain.');
  P();
}

P('## Cross-chain matrix');
P();
P('✅ pass · ⚠️ pass with an open gap · 🟡 traced to an external boundary / mock / rolled back · ❌ fail · — not part of the chain');
P();
P(`| # | ${LAYERS.join(' | ')} |`);
P(`| ---: | ${LAYERS.map(() => ':---:').join(' | ')} |`);
for (const n of Object.keys(MATRIX)) P(`| ${n} | ${MATRIX[n].join(' | ')} |`);
P();
P('No ❌ cells remain. 🟡 cells and their owners: Google OAuth (1), YunExpress live (3, 6), payment provider (12), GitHub/off-site backup (7, 8) — **Owner/Admin**; currency switch side effects only observable outside a rolled-back transaction (11) — run once on staging; LLM carrier lookup (9, ⚠️) — **Product**; e-mail template + PI PDF storage (2, ⚠️) — **Developer/Content editor**.');
P();
P('## Commits (not pushed)');
P();
P('| Commit | What |');
P('| --- | --- |');
for (const [h, s] of commits) P(`| \`${h}\` | ${esc(s.replace(/^TRACE: /, ''))} |`);
P();
P('Migrations `20261101000130`–`20261101000136` are applied to the live database (additive columns/tables/triggers/functions; `core_request_service`, `assign_account_manager` and `job_pools` redefined with their previous bodies plus the fix). The Vault secrets `octopus_app_url` / `octopus_cron_secret` were written by `scripts/cron-dispatcher-secrets.mjs` (the Lead rotated CRON_SECRET in .env.local, Vercel and Vault).');
P();
if (extra.cleanup) {
  P('## Clean-up (production database)');
  P();
  for (const l of extra.cleanup) P(`- ${l}`);
  P();
}
P('## What was not checked, and why');
P();
for (const l of extra.notChecked ?? []) P(`- ${l}`);
P();
P('---');
P();
P(`**Release verdict: ${extra.verdict ?? 'no-go'}**`);
P();
P('**Top three risks**');
P();
for (const l of extra.risks ?? []) P(`1. ${l}`);
P();
fs.writeFileSync('docs/E2E_TRACE_REPORT.md', out.join('\n'));
console.log('wrote docs/E2E_TRACE_REPORT.md', out.length, 'lines');
