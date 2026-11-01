# Add-on: end-to-end connection trace

The same text as docs/SPEC.md section 21. Instruments every layer with a shared trace_id, then drives every chain in the system end-to-end (UI click → RPC → DB → outbox → worker → external API → webhook → DB → Realtime → UI → email → audit log) and proves every handoff fires exactly once. Produces docs/E2E_TRACE_REPORT.md with timeline diagrams and latency per hop. Run after 19-A and before go-live.

## 21. Addendum: end-to-end connection trace

Added 1 Nov 2026. Where section 19 asks "does each piece work?", this addendum asks "do all the pieces connect to each other correctly through every path?". It traces each live request from the browser click all the way through Server Action → Zod → RPC → database transaction (rows + ledger + status\_history + outbox) → dispatcher → pgmq worker → Edge Function → external API → webhook back → database → Realtime → UI update → email/notification → audit log entry → metric. The report proves every handoff happens, passes the right data, is idempotent, is logged, and lands in the UI the user is watching.

Run this after section 19 (prompt 19-A) and before go-live.

### 21.1 Chains to trace end-to-end

| # | Chain | Starts at | Ends at |
| --- | --- | --- | --- |
| 1 | **Signup → KYC → account manager assigned** | Google OAuth button on `/signup` | `account_managers` row + welcome email + Realtime nudge on dashboard |
| 2 | **RFQ → Quote → PI → Deposit → Confirmed order** | "Request quote" on `/p/[slug]` | Order row confirmed + PI PDF + 3 emails + status\_history + ledger entries + outbox fan-out |
| 3 | **In production → QC → Balance → Shipped** | Operations marks "in production" | Shipment row + YunExpress tracking + email + Realtime timeline update |
| 4 | **YunExpress tracking webhook → Timeline** | Carrier POSTs `delivered` event | `tracking_events` row + Realtime push + customer email + metric |
| 5 | **Service request (QC day)** | "Request QC" with wallet pay | QC assignment + report PDF + wallet debit journal + email |
| 6 | **Group-buy pool: open → join → fill → settle** | "Start pool" / "Join pool" | `settle_pool` outcome: 1 PO + N PIs + N emails + N shipments; supplier identity hidden |
| 7 | **Backup now → upload → UI card updates** | "Back up now" in `/admin/backups` | Backup row with checksum + file in off-site bucket + status card refresh |
| 8 | **Partial restore of deleted product** | "Restore selected" wizard | Product row back + audit entry + storefront ISR revalidation |
| 9 | **AI assistant message → tool-call → reply** | Customer sends message on `/account/assistant` | Edge Function call + context fetch under RLS + tool (`get_shipment`) + LLM + reply + `assistant_messages` row + confidence log |
| 10 | **Escalation → Support ticket → staff reply** | Octo escalates (sensitive topic) | `escalations` row + Support ticket + Realtime nudge in `/office/assistant` + staff reply visible to customer in-thread |
| 11 | **Currency switch USD → CNY** | Admin requests switch | Approved → scheduled → applied: storefront prices in CNY, old USD PIs unchanged, ledger journals balance per currency |
| 12 | **Payment webhook replay** | Replay a `payment.confirmed` event | No duplicate ledger row, no second email, idempotency log entry |
| 13 | **Ad click → ledger** | Click a Sponsored card | 1 click row + 1 charge journal + budget tick, duplicate click within window deduped |
| 14 | **Public API `POST /v1/rfqs`** | Postman call with `oct_test_` key | DB row created + response with id + webhook `rfq.created` signed and delivered |
| 15 | **Outbox event with worker failure** | Simulated 5xx in email worker | Backoff schedule honoured + 5 retries + dead-letter + alert + admin "retry" button works |
| 16 | **Staff login → workspace → money action** | Priya signs in with 2FA | Fresh code required for restore / money approval; audit log holds every click |

### 21.2 For each chain the trace records

- **Entry** (route, method, user, timestamp).
- **Validation** (Zod schema name, parsed payload hash).
- **RPC call** (name, args hash, Postgres txid).
- **Database mutations** inside that txid (table · op · PK) and the `status_history` row.
- **Ledger entries written** with debit/credit, account, currency, amount\_minor, journal id balance check.
- **Outbox events written** (type, aggregate id, payload hash).
- **Dispatcher pickup** (queue, msg id, latency).
- **Worker** (Edge Function name, duration, success).
- **External call** (adapter, endpoint, request body SHA, response code, response body SHA).
- **Inbound webhook** (if any): HMAC verified, event id, idempotency check result.
- **Realtime push** (channel, event name, received by client confirmed by Playwright).
- **UI update** (DOM assertion in Playwright, screenshot).
- **Email / notification** (template id, recipient hash, SES/Resend message id).
- **Audit log entry** (actor, action, before/after hashes).
- **Metrics** (counter increment, timer).
- **End-to-end latency**.

### 21.3 Deliverable

`docs/E2E_TRACE_REPORT.md` with: a one-page summary table (chain · status · e2e latency · verdict), one section per chain with the full trace in a tidy table and a timeline diagram, a "Gaps" list (missing event, broken handoff, duplicate side effect, missing audit row, slow link), fixes applied, and a release verdict.

### 21.4 Antigravity prompt

**Prompt 21-A — End-to-end connection trace**

```
Act as a senior platform engineer running the end-to-end connection audit on Octopus B2B. Read docs/SPEC.md fully, including sections 15–20, and docs/QA_REPORT.md if present.

Before running: enable structured JSON logs on every layer and give every request a `trace_id` propagated through headers:
1. Add a Next.js middleware that mints `x-trace-id` on every incoming request if absent, writes it into a request-scoped AsyncLocalStorage, and sets it on every Supabase client call via custom header `x-trace-id`.
2. Add Postgres helper `app.trace_id()` set from the request header; every RPC inserts `trace_id` into `status_history`, `ledger_entries`, `outbox_events` and `audit_log`.
3. Every Edge Function reads the header, logs it on every structured log line, and forwards it to adapters as a custom header (`x-octopus-trace`).
4. Every adapter writes outbound request body SHA, response code and response body SHA to `integration_logs(trace_id, adapter, endpoint, ...)`.
5. Every outbound webhook delivery and every email send stores `trace_id` with the delivery row.
6. The browser receives the `x-trace-id` in a response header; the frontend puts it on every follow-up fetch so a user action and its background work share one id.

For each chain in docs/SPEC.md section 21.1, in that order:
1. Write (or reuse) a Playwright script that drives the chain end to end against the Vercel preview with seeded data. The script captures the initial `trace_id` from the response header and polls until the chain's end-state assertion holds (DOM + email received at a test inbox + Realtime event seen). Mock external services only where sandbox cannot provide them (payment success, QC report upload); otherwise use real sandbox calls.
2. After the chain finishes, pull all rows carrying that `trace_id`: `status_history`, `ledger_entries`, `outbox_events`, `integration_logs`, `webhook_deliveries`, `email_deliveries`, `realtime_pushes`, `audit_log`.
3. Reconstruct the chain into a trace record with the fields in §21.2. For every expected handoff in section 21.1 verify it fired exactly once; for every optional branch verify the branch taken matches the test input. Any missing, duplicated, out-of-order or malformed link is a gap.
4. Measure elapsed time per hop and total. Flag any hop over the budget (SA 300 ms, RPC 500 ms, adapter 2 s, worker 5 s, end-to-end for #2 under 90 s with mocked payment, #4 under 15 s).
5. Idempotency: replay the key event with the same event id (payment webhook, YunExpress webhook, outbox dispatcher). Prove no second ledger entry, no second email, no second Realtime push; the replay writes an `idempotency_hits` row with the same `trace_id` family.
6. Negative paths for each chain: simulate a 5xx from the external, a schema error from the LLM, a webhook with a bad HMAC, a pool that under-fills, a staff member without aal2. Each must land in a controlled failure state visible to the right role.
7. Record every change you made during instrumentation as part of this audit (migrations, middleware, log lines) with the commit hash.

Specific proofs this run must produce:
- Chain 2 (RFQ → Confirmed) completes end-to-end with one `trace_id` present in: 1 rfq row, 1 quote, 1 proforma invoice, 2 status_history rows (quote.approved, order.deposit_paid), 2 ledger entries that balance in USD (or CNY if that is the active currency), 1 PI PDF stored in the private bucket, 2 emails delivered, 1 outbound webhook `order.updated` signed with HMAC, 1 Realtime push to the customer dashboard that Playwright asserts in-DOM.
- Chain 6 (group buy): three browsers (A, B, C) join a pool from different countries; `settle_pool` runs once; the trace shows 1 PO row + 3 PI rows + 3 emails + 3 shipments; supplier view queries show the aggregate PO only; buyer rows in the pool participants view show `buyer_code + country` only, not names.
- Chain 9 (assistant): assistant Edge Function logs the exact tools called (`get_shipment`); the YunExpress response SHA is in `integration_logs` for the same `trace_id`; the reply row carries the confidence score.
- Chain 11 (currency switch): quotes created before the switch keep their currency and FX rate; new PIs after the switch carry the new currency; a pgTAP assertion runs: every journal still balances per currency.
- Chain 12 (replay): second POST of the same `payment_intent_id` returns 200 with no side effects and an `idempotency_hits` row.
- Negative paths produce an entry in `/admin/integrations → Failed jobs` with a visible retry button, and a Sentry breadcrumb carrying the `trace_id`.

Write the report to docs/E2E_TRACE_REPORT.md with today's date in the title. Use these sections per chain: Summary → Trace table → Timeline (Mermaid `sequenceDiagram`) → Latency → Idempotency → Negative paths → Gaps → Fixes applied. End with a one-page cross-chain matrix (rows: chains, columns: layers), coloured pass/fail; a one-line release verdict (go / no-go); and the three top risks.

If any gap cannot be closed safely alone (schema change touching money, destructive migration, external credentials, design intent ambiguous), stop at a short write-up for that chain and ask.
```

Done when: `docs/E2E_TRACE_REPORT.md` exists for today's date, every chain in §21.1 is green end-to-end with a shared `trace_id`, idempotency replays are no-ops, and the cross-chain matrix shows no red cells (or the red cells are listed with named owners).
