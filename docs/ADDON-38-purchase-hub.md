# Add-on 38: Purchase Hub (product sourcing): client screens in the portal, office staff app

Read first:
- Plan doc "Octopus Purchase Hub: portal plan" (decisions, flow, statuses, billing, open items)
- Overview doc "Octopus B2B portal: hub sections, SSO, billing and timeline" (SSO hand-off, portal ↔ hub API and webhooks, white-label rules, brand)
- Design canvas "Octopus Purchase Hub — UI" (9 screens, listed below)
- ADDON-33 (platform-wide SKU), ADDON-36 (audit: prefill bugs, missing account Sourcing), ADDON-37 (wallet holds and events)

## The idea in one picture

```
 Client (browser)                      Portal  hostoctopus.com                  Purchase staff app  [purchase domain]
 ─────────────────                     ───────────────────────                  ────────────────────────────────────
 /sourcing, /sourcing/request   ──►    login, wallet, invoices (HK company)     own Supabase + Vercel
 My account → Sourcing          ◄──►   calls the hub API server to server ◄──►  requests, quotes, POs, QC, factories
                                       (public view: no factory fields)          offices: Shenzhen, Foshan, Dongguan, Ningbo
                                                   │
                                                   └── events ──► 3PL Hub: inbound shipment when goods are booked to the warehouse
```

- Clients never open the staff app. Everything they see is in the portal, served from the hub's API through a public-view layer.
- Staff sign in through the portal (role `staff`, 2-factor) and land in the staff app by the SSO redirect hand-off. Separate domain, so no shared cookies.
- The hub owns requests, quotes, purchase orders, QC and factories. The portal owns users, companies, the wallet, escrow ledger and invoices.

## Screens in the design canvas

| Artboard | Route | App |
|---|---|---|
| Portal · /sourcing landing | `/sourcing` | Portal |
| Portal · request form | `/sourcing/request` (prefill from `?product=&qty=&country=`) | Portal |
| My account → Sourcing | `/account/sourcing` with tabs Requests, Purchase orders, Samples, Documents | Portal |
| Compare quotes and approve | `/account/sourcing/requests/[id]` | Portal |
| Purchase order detail | `/account/sourcing/po/[id]` (QC passed and QC failed states) | Portal |
| Phone | the four screens above at 390 px, Sourcing in the account bottom bar | Portal |
| Office inbox | `/inbox` | Staff app |
| Quote builder | `/requests/[id]/quotes` | Staff app |
| PO board and QC | `/pos` (board) and `/pos/[id]/qc` | Staff app |

Build the screens to match the canvas: navy #1A174A, blue #347BE1, Inter for text, Fredoka for headings, from the shared token file, fonts self-hosted. Buttons with white text use navy (white on #347BE1 fails contrast for normal text); blue is for accents, focus rings and large numbers.

## Statuses (one list, used by both apps)

Request: `sent` → `quoting` → `quotes_ready` → `approved` | `closed` (expired, cancelled or cannot source)

Purchase order: `deposit_paid` → `in_production` → `qc_passed` | `qc_failed` (back to `in_production`, new date) → `balance_paid` → `shipping_to_warehouse` → `at_warehouse` (closed)

Sample: `ordered` → `shipped` → `delivered`

Client-facing labels: Request sent, Quoting, Quotes ready, Approved, Closed, In production, QC passed, QC failed, Balance paid, Shipping to your warehouse, At your warehouse.

## Antigravity prompt 38-A: discovery (change nothing)

```
Read docs/ADDON-38, the Purchase Hub plan doc and the overview doc. We are building the Purchase Hub: client screens inside the portal (this repo) and a separate Purchase staff app with its own Supabase and Vercel project.

Change nothing. Report:
1. Everything that exists today for sourcing / RFQ in the portal: routes, components, tables (rfqs, quotes, sourcing_requests or similar), row counts, open requests and their statuses, and the clients who own them.
2. The current RFQ fee charge (US$ 5) and sample handling fee (US$ 25): where they are charged, which wallet ledger entries they write.
3. Whether a Purchase staff app repo or Supabase project exists already. If yes: framework, tables, auth.
4. The ADDON-36 bugs still open: home hero form dropping title, quantity and country; product page losing the quantity on "Get a quote"; My account having no Sourcing section.
5. A migration plan: which existing records move to the hub, and how existing customers are asked first (see 38-F). Wait for my approval.
```

## Antigravity prompt 38-B: staff app, data model and API

```
Create the Purchase staff app (Next.js 15, its own Supabase project and Vercel project, domain from env PURCHASE_APP_URL). No sign-up and no password screen: sign-in is the portal's OpenID Connect hand-off (authorization code with PKCE) exactly as the overview doc section 2 describes. Accept only role staff (2-factor done at the portal). Each staff user belongs to one or more offices.

Tables (all with created_at, updated_at, audit log):
- offices(id, name, city, product_groups text[]): seed Shenzhen, Foshan, Dongguan, Ningbo. Product groups left empty for the owner to fill.
- requests(id 'SR-xxxxx', org_id, user_id, product_name, category_id, quantity, unit, target_price_minor, currency, destination_country, delivery 'octopus_warehouse'|'own_address', warehouse_id, wants_sample, notes, links text[], status, office_id, owner_staff_id, reply_due_at, rfq_charge_ref, source_product_sku null, created_at)
- request_photos(request_id, storage_path, position)
- factories(id 'F-xxxx', office_id, legal_name, contact_name, phone, wechat, address, score, notes): STAFF ONLY.
- quotes(id, request_id, label 'A'|'B'|'C', factory_id STAFF ONLY, factory_cost_minor STAFF ONLY, cost_currency 'CNY', fx_rate STAFF ONLY, margin_pct STAFF ONLY, client_unit_price_minor, currency 'USD', moq, lead_time_days, incoterm, sample_price_minor, valid_until, deposit_pct default 30, note_to_client, status 'draft'|'sent'|'chosen'|'closed')
- purchase_orders(id 'PO-xxxx', request_id, quote_id, org_id, quantity, total_minor, deposit_minor, balance_minor, status, ready_date, new_qc_date, warehouse_id, inbound_ref null)
- po_lines(po_id, sku, quantity, cartons): sku = platform-wide SKU from ADDON-33. Create the SKU through the portal's products API when the product is new; never invent SKUs here.
- qc_inspections(id, po_id, inspector_staff_id, result 'passed'|'failed', checks jsonb [{name, result}], note_to_client, report_path, photos text[], inspected_at)
- samples(id 'SM-xxxx', request_id, quote_id, status, tracking_ref)
- messages(id, request_id, author 'client'|'staff', staff_id null, body, internal boolean): internal notes never leave the staff app.

Row-level security: staff see rows of their offices; admins see all. STAFF ONLY columns live in a separate schema or are excluded by a view.

Hub API under /api/v1 (server to server, called only by the portal; HMAC signature over body + timestamp, 5-minute window, idempotent on Idempotency-Key, every call logged):
- POST /requests                     create from the portal form (portal has already charged the RFQ fee; pass rfq_charge_ref)
- GET  /requests?org_id=&status=     list for My account
- GET  /requests/{id}                detail with quotes in PUBLIC VIEW
- POST /requests/{id}/messages       client message
- POST /quotes/{id}/sample           client orders a sample (portal has charged it; pass charge_ref)
- POST /quotes/{id}/approve          creates the PO (portal has moved the deposit to escrow; pass escrow_ref)
- GET  /pos?org_id=, GET /pos/{id}   PO list and detail in PUBLIC VIEW, with timeline, QC result, photos and report link
- POST /pos/{id}/confirm-ok          client confirms goods are OK to ship (before balance)
- POST /pos/{id}/balance-paid        portal reports the balance moved to escrow; pass escrow_ref

PUBLIC VIEW = one server-side serializer that returns only client-safe fields. Factory, factory cost, fx rate, margin and internal notes can never appear in it. Add a unit test that fails if any STAFF ONLY column name appears in a public-view response.

Events from the hub to the portal (signed, retried 24 h, idempotent): request.status_changed, quotes.ready, sample.status_changed, po.status_changed, qc.completed, message.created. The portal sends the client email and in-app notification for each.
```

## Antigravity prompt 38-C: portal pages and My account → Sourcing

```
Build the client side in the portal from the design canvas artboards "Portal · /sourcing landing", "Portal · /sourcing/request form", "My account → Sourcing", "Compare quotes and approve", "Purchase order detail" and "Phone". All data comes from the Purchase Hub API (38-B) through the portal's server; nothing is read from the hub in the browser.

1. /sourcing: landing as designed (hero with a short request form, how it works in 4 steps, what you pay, escrow band, the four offices, warehouse handover, FAQ, CTA). Office product groups come from the hub's offices table; show nothing if empty. Add Sourcing as the first item of the top navigation.
2. /sourcing/request:
   - Signed-out visitors can fill the form; "Send" asks them to sign in and keeps every field (save the draft, restore after login via next=).
   - Prefill from ?product=&qty=&country= and from the hero form. This fixes the ADDON-36 bugs: the hero form and the product page "Get a quote" button must pass title, quantity and country, and the form must show the "Filled in from" banner.
   - Fields: product name, category, quantity + unit, target unit price (optional), destination country, delivery (my Octopus warehouse | my own address), photos (up to 8, uploaded to portal storage then copied to the hub), links, specs and notes, "I want a sample".
   - Summary panel: pay now US$ 5.00 (RFQ fee) from the wallet; if the wallet is short, offer top-up and keep the form.
   - On send: charge the RFQ fee (38-E), then POST /requests, then go to My account → Sourcing with the new request on top.
3. /account/sourcing with tabs Requests, Purchase orders, Samples, Documents, and the four counters (Waiting for you, With our office, In production, At your warehouse). Add Sourcing to the account sidebar under Orders, and to the phone bottom bar.
4. /account/sourcing/requests/[id]: request summary, up to three quote cards side by side (label A/B/C, unit price, total, MOQ, lead time, incoterm, sample price, note, tags such as "Best price", "Fastest", "Needs 5,000 pcs"), Order sample, Choose. The approve panel shows total, deposit now (deposit_pct of the quote), balance after QC, wallet balance and shortfall, a terms checkbox, Top up and "Approve and pay deposit". Messages with the buyer under it. Quotes past valid_until show as expired and cannot be approved.
5. /account/sourcing/po/[id]: QC section (photos, checks, report PDF), progress timeline with the statuses above, payments card. "Pay balance" stays disabled until QC passed AND the client ticks "I have seen the QC photos and report"; on QC failed show the reason and the new date and keep the balance locked.
6. White-label: no factory names, cities of factories, carrier names or source marketplaces anywhere on these pages, in emails or in PDFs. Quotes are "from the Shenzhen office" (or the request's office), never from a factory.
7. Phone (390 px): list cards instead of tables, stacked quote cards with a sticky "Approve" bar, sticky "Pay balance" bar, sticky "Send request" bar, all touch targets at least 44 px.
```

## Antigravity prompt 38-D: staff app screens

```
Build the staff app screens from the design canvas artboards "Staff app · office inbox", "Staff app · quote builder" and "Staff app · PO board and QC".

1. Header: Octopus logo, "Purchase · Staff", office switcher (only the user's offices), user menu. Sidebar: Inbox (count of new), Quotes, PO board, QC, Factories, Reports.
2. Inbox: filter chips All, New, Mine, Due soon; list with product, request id, client code (C-xxxx, never the client's card or wallet details), status and reply timer (reply_due_at; red when overdue). Detail pane: all request fields, photos, links, notes; actions Assign to me, Ask the client (creates a client-visible message), Cannot source (closes the request; refund rule from config, see 38-E), Start quotes.
3. Quote builder: up to three quote columns. Staff-only box (dashed, labelled "Staff only"): factory picker, factory cost in CNY, margin with − / + steps. FX rate at the top (default from a daily rate table, editable). Client price = cost ÷ rate × (1 + margin), rounded to the cent, shown live. Client fields: MOQ, lead time, incoterm, sample price, valid until, deposit %, note to the client. A "What the client will see" table under it built from the PUBLIC VIEW serializer, so staff see exactly what goes out. Save draft; "Send N quotes to the client" sets status quotes_ready and fires quotes.ready.
4. PO board: columns Deposit paid, In production, QC, Balance due, To warehouse, At warehouse; cards show PO, product, client code, quantity, factory code, next date; late cards marked. Selecting a card opens it below or in a drawer.
5. QC: checks (quantity counted, function test on sampled units, logo and print, packaging and carton marks; admins can add checks per category), Pass/Fail per check, up to 12 photos, report PDF upload, note for the client. Any fail → "Mark QC failed and set a new date" (status qc_failed, new_qc_date, client sees the note). All pass → "Mark QC passed and ask the client for the balance" (status qc_passed, event qc.completed).
6. Factories: list and form for the office's factories (staff only).
7. Reports: requests per office, reply time, quote-to-approval rate, POs late, QC fail rate.
```

## Antigravity prompt 38-E: payments, escrow and invoices

```
All money moves in the portal (overview doc section 4). Use the wallet API from ADDON-37 (holds, captures, releases, refunds) and add an escrow ledger.

1. RFQ fee: US$ 5.00 captured from the wallet when the client sends a request. Receipt from the Hong Kong company in Documents. Config flags (admin → Fees): rfq_fee_minor = 500, rfq_fee_credit_to_first_po (default false), rfq_refund_if_cannot_source (default false), rfq_refund_after_days (empty). These three are open decisions; build them as settings, not code.
2. Sample: sample_price from the quote + sample handling fee US$ 25.00 (existing fee setting), captured when the client orders the sample.
3. Deposit: on approve, move deposit_minor from the client wallet into escrow account escrow:PO-xxxx (ledger entries in the same transaction), then call POST /quotes/{id}/approve with the escrow_ref. If the hub call fails, reverse the move. Deposit invoice from the Hong Kong company.
4. Balance: allowed only when the PO is qc_passed and the client has confirmed OK. Move balance_minor into the same escrow account, call POST /pos/{id}/balance-paid. Balance invoice.
5. Release to the factory: finance users (role staff + finance permission) release escrow in the back office with a two-person approval: release_deposit (default: at the start of production) and release_balance (default: after the balance is paid). The release moment is an open decision: keep it as a setting per PO with these defaults.
6. Refunds: cancelled before production → deposit back to the wallet; QC failed twice → admin decides, partial or full refund from escrow.
7. Our margin is inside client_unit_price. Never show it, never add a commission line.
8. Finance report: escrow balance per PO, releases, refunds, fees by month.
```

## Antigravity prompt 38-F: handover to the 3PL Hub, existing customers, tests

```
1. Handover: when a PO with delivery 'octopus_warehouse' moves to shipping_to_warehouse, the hub emits purchase_order.ready_to_ship (PO id, org_id, warehouse_id, lines with SKU, quantity, cartons, expected date) through the portal events (ADDON-37 37-D). The 3PL Hub creates an inbound shipment and returns inbound_ref. On inbound.received (counted quantities, damages) the hub sets the PO to at_warehouse and closes it; the client sees the inbound number on the PO page and the stock in the Warehouse section (and in Dropship if they sell from it). For delivery 'own_address' the PO closes when the shipment is delivered.
2. Existing customers: email every client with an open sourcing request from the old flow: "We have moved sourcing to a new My account → Sourcing section. Move your open requests?" with Yes / Keep as is. Move only on Yes (copy into the hub with the same ids where possible, keep payments where they are). The rest finish in the old flow. Log every answer.
3. Tests on preview deployments with test accounts and test data only, cleaned up afterwards:
   - Signed-out visitor fills the request form from a product page, signs in, the fields are still there, sends, US$ 5 is charged once (double click = one charge).
   - Staff picks up the request, builds three quotes, sends; the client sees them without any factory field (inspect the API response too).
   - Client orders a sample from quote B: sample price + US$ 25 charged.
   - Client approves quote A with too little wallet balance → top-up → approve; deposit lands in escrow; PO created.
   - QC failed → client sees the note and new date, balance locked; QC passed → client confirms OK → pays balance.
   - PO to warehouse → 3PL inbound created → inbound.received → PO closed, stock visible.
   - Security: a client cannot read another org's requests; a staff user of Ningbo cannot open a Shenzhen PO; the CI white-label check finds no factory or carrier names on any client page or PDF.
```

## Build order and notes

- 38-A → 38-B → 38-C and 38-D in parallel → 38-E → 38-F. SSO and provisioning (overview doc, weeks 1–2) must work before 38-B can sign staff in.
- Open decisions are built as settings with defaults, so the build does not wait for them: deposit % (default 30 on each quote), RFQ fee credit and refund rule, escrow release moment, the fourth office (brief says Dongguan, the live site lists Yiwu: the offices table makes this a data change), the staff app domain.
- Mock data in the designs (product names, prices, client codes, factory codes, dates) is example data only.
- The SKU from ADDON-33 is the key shared with the 3PL and Dropship hubs. Public SKUs use the neutral code, never the supplier abbreviation.
