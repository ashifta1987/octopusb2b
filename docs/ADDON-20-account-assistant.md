# Add-on: AI account assistant (Octo) and dedicated account manager

The same text as docs/SPEC.md section 20. Each customer gets a two-layer account team: Octo, an AI assistant answering from their own data, and a dedicated human account manager who takes over on sensitive topics or when Octo cannot help. Screen design: docs/design/Assistant.png and docs/design/html/Assistant.html; dashboard card on docs/design/Customer.png.

## 20. Addendum: AI assistant "Octo" and dedicated human account manager

Added 1 Nov 2026. Every customer gets a two-layer account team: **Octo**, an AI assistant that answers from the customer's own data in seconds, and a **dedicated human account manager** (back-office staff) who takes over when the bot cannot help or the customer asks.

Design: `docs/design/Assistant.png` + `html/Assistant.html`. Entry card on the customer dashboard (`docs/design/Customer.png`) and "AI assistant" item in the customer sidebar on every portal page.

### 20.1 Who the bot is and is not

| Can | Cannot |
| --- | --- |
| Read the customer's own profile, KYC status, RFQs, quotes, orders, service requests, wallet balance and ledger (last 90 days), saved products, pool pledges, shipment tracking | Read other customers' data, supplier legal names, Octopus margins, back-office queues, or any staff data |
| Open an RFQ, sample request or QC service request *as a draft for the customer to confirm* | Submit anything without the customer clicking Confirm |
| Explain tier prices, incoterms, current T&C and policy versions | Change prices, T&C, service charges or wallet rules |
| Give a shipment ETA from YunExpress, send tracking by email | Promise delivery dates outside the carrier's own window |
| Suggest products, pools and services based on past orders | Give legal, tax or import-compliance advice |
| Draft messages for human review | Approve money, refunds, credit notes, discounts, payouts, KYC decisions |
| Explain safeguards, handle most how-to questions | Make statements that bind Octopus; only the human account manager can |

Octo reads the same tables customers can see, through the same RLS. Each session logs every tool call it makes (`assistant_messages.tools_called`), so a human can replay how an answer was formed.

### 20.2 Escalation triggers

Any one of these moves the conversation to the human account manager:

- Customer asks for a human ("talk to someone", "my account manager", "escalate").
- Topic matches a sensitive-topic list in settings: refunds, credit notes, discounts, dispute, QC failure, legal, tax, customs, complaint, cancel, data request.
- Bot confidence drops below the threshold (default 60%, settings) on three consecutive turns.
- Customer sentiment turns negative (model signal).
- Octo is asked to do something only a staff member can approve.
- Customer is on a VIP tier flagged by Admin.
- Outside the account manager's office hours and the customer picked "wait for human" instead of "let Octo try".

The handoff writes an `escalations` row (reason, confidence, excerpt), opens a Support ticket with the full transcript attached, and notifies the assigned account manager (and their team queue) through Realtime, email and WhatsApp.

### 20.3 Assigning the dedicated account manager

- **Automatic:** on KYC verification, assign from the Sourcing team pool by round-robin, balanced by current workload and matched by language and region (customer country → team mapping in settings).
- **Admin override** in `/admin/customers/[id]` with reason, logged.
- **Backup:** if the primary is away (status "out of office"), the team queue picks it up; the primary resumes on return.
- **Visibility:** customer sees their account manager's name, team, hours and SLA on `/account/assistant` and in the dashboard card.
- One account manager may hold many customers; typical cap 50 active customers per manager (setting).

### 20.4 Data model

- `account_managers` (customer\_user\_id PK, staff\_user\_id, team, assigned\_at, assigned\_by, primary bool, out\_of\_office bool)
- `assistant_sessions` (id, customer\_user\_id, started\_at, ended\_at, channel, escalation\_id nullable)
- `assistant_messages` (session\_id, author `bot|customer|staff`, content, confidence numeric(5,2), tools\_called jsonb, hidden\_from\_customer bool for staff notes)
- `escalations` (session\_id, reason enum, confidence, requested\_at, taken\_by\_staff\_id, taken\_at, resolved\_at, outcome)
- `assistant_feedback` (message\_id, thumbs\_up bool, note)
- Settings: `assistant_enabled`, `assistant_confidence_threshold`, `assistant_sensitive_topics[]`, `assistant_vip_customer_ids[]`, `assistant_team_country_map{}`, `assistant_max_customers_per_manager`.

Views: `assistant_session_mine_view` (customer scope), `assistant_queue_view` (staff: own customers + unassigned escalations).

### 20.5 UI

- **Customer dashboard** `docs/design/Customer.png`: new "Your account team" card between KPIs and the Sponsored ad, showing Octo + Priya (sample names) and an "Open assistant" button.
- **Dedicated page** `/account/assistant` matching `docs/design/Assistant.png`: left/center the conversation (bot bubbles blue, customer bubbles navy, staff bubbles green, system handoff notices amber); right rail with the account team card, "What Octo knows about you" with a privacy opt-out, "When Octo hands off" list, and recent conversations.
- **Everywhere else:** a floating assistant bubble bottom-right on every customer portal page opens a 420 px drawer with the same conversation; it reads the current page URL so Octo can offer context-specific help ("This is RFQ-1042, do you want to compare the three quotes?").
- **Back office:** `/office/assistant` queue in Support Desk — shows the staff member's assigned customers, open escalations with SLA counter, and conversations where Octo flagged itself as low-confidence. Staff can type a reply directly into the thread; Octo stays visible as a side rail with fact lookups the staff can insert into their message with one click. Customer identity visible to the assigned staff only; audit log entry on every open.
- **Admin:** `/admin/assistant` with on/off switch, settings in §20.4, team–country map, customer→account-manager assignments table with reassign, VIP flag, out-of-office toggle; reports on bot resolution rate, escalation rate, satisfaction and SLA.

### 20.6 Privacy, safety and audit

- The customer opts in once to "use chat history to improve answers"; opt-out stops training signals and anonymises old sessions.
- Octo never claims to be human. Every bot bubble carries the "Octo" avatar; every human bubble carries the staff initials and name.
- No PII leaks across customers: Octo's context is scoped by `customer_user_id` and enforced by the same RLS used in the UI.
- Prompts to the LLM are built from fetched rows only, never raw SQL; sensitive fields are redacted before the LLM call.
- Every bot action that would change state is a tool-call that the customer must confirm; actions are logged in `audit_log`.
- All inbound and outbound bot calls go through a rate limit (per customer, per minute); dead-letter and model-timeout handling route to a human with a notice.

### 20.7 Antigravity prompt

Run after P7 (Support desk exists). If the back office is already live, run it now.

**Prompt 20-A — Octo (AI account assistant) and dedicated account manager**

```
Read docs/SPEC.md section 20 and sections 3, 6, 7, 10 and 12. Build the two-layer account team — bot assistant "Octo" and dedicated human account manager:
1. Migrations: account_managers, assistant_sessions, assistant_messages, escalations, assistant_feedback with RLS as in §20.4. Add site_settings assistant_enabled, assistant_confidence_threshold (0.60), assistant_sensitive_topics (jsonb list), assistant_vip_customer_ids, assistant_team_country_map, assistant_max_customers_per_manager (50). Add an "Assistant" permission area in the role matrix (view, reply, take_over, close, reassign, configure).
2. Edge Function POST /functions/v1/assistant-reply: takes {session_id, message}, builds a context payload from the customer's own rows (profile, KYC status, open RFQs, orders, service requests, wallet balance, last 90 days ledger, saved products, pool pledges, shipment tracking) via Supabase with the user's JWT so RLS applies, calls the configured AI provider (adapter from §7: AiAdapter), returns {reply, confidence, tools_called, should_escalate}. Available tools: get_shipment(tracking), list_quotes(rfq_id), list_pools(product_id), draft_rfq(input), draft_service_request(input), get_terms_section(id). All tool outputs quoted into the reply; sensitive fields redacted. Enforce a per-customer rate limit (20 messages/min) and a 20s model timeout; on timeout escalate.
3. Build /account/assistant matching docs/design/Assistant.png and html/Assistant.html — full conversation (bot blue, customer navy, staff green, system amber), right rail with Your account team card, "What Octo knows about you" with privacy opt-out, "When Octo hands off" list, recent conversations.
4. Add a floating assistant bubble (bottom-right, 420 px drawer) to the customer portal layout. Opens the same conversation and reads window.location to pass page context.
5. Edit /account (docs/design/Customer.png) to add the "Your account team" card between KPIs and the Sponsored ad; add "AI assistant" with a "new" badge to the sidebar.
6. Escalation RPC escalate_session(session_id, reason, excerpt): writes an escalations row, opens a Support ticket (section 7) with the transcript attached, assigns to account_managers.staff_user_id (or team queue if out-of-office), broadcasts Realtime notify to the staff member, and queues an email/WhatsApp notice. Triggered by the Edge Function on sensitive topic, low confidence (threshold setting, 3-turn window), negative sentiment, or explicit customer request. The customer sees an amber system message "Octo handed this to <name>".
7. Build /office/assistant (back-office queue) — add to the back-office nav. Shows my active customers, open escalations with SLA counter, Octo-flagged low-confidence conversations. Opening a conversation reveals the full history, lets staff reply inline, and shows Octo in a side rail that can draft facts (shipment, quote list, wallet balance) for the staff to insert with one click. Full customer identity visible to the assigned staff member; every open writes an audit_log row.
8. Assignment: assign_account_manager(customer_id) RPC runs on KYC verification; picks a Sourcing-team staff from assistant_team_country_map for the customer's country, balanced by current workload, respecting assistant_max_customers_per_manager. Admin reassignment in /admin/customers/[id] with reason, logged. Out-of-office toggle on the staff profile routes to the team queue.
9. Build /admin/assistant — ON/OFF switch, confidence threshold, sensitive-topics list editor, team–country map editor, assignments table with filter and reassign, VIP flag, reports (bot resolution rate, escalation rate, satisfaction, SLA, cost per conversation).
10. Observability: log every tool_call with latency and token count; a daily cron computes resolution and escalation metrics; alert if resolution rate drops under 70% or escalation SLA breaches rise above 5%.
Tests: pgTAP that a customer can only read their own assistant_messages; a staff member can only read sessions of their assigned customers; escalations surface in the correct queue. Playwright: open a session, ask three refund-related questions, verify the handoff after the first (sensitive topic), verify a Support ticket is created, verify the account manager can reply inline, verify the amber system message appears in the customer view.
```

Done when: a customer opens `/account/assistant`, asks a shipment question and gets an answer with real tracking data; asks for a refund and is handed to their account manager with a Support ticket opened and the transcript attached; the account manager replies from `/office/assistant` and the customer sees the reply in the same thread without reloading.
