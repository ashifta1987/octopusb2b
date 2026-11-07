# Add-on 40: Make My Brand inside Octopus B2B

Read first:
- Doc "Make My Brand: integration map and launch checklist" (route, systems, sync rules, responsibilities, phases, open items)
- Design canvas "Make My Brand — clickable prototype" (13 screens) and the screen PNGs in `design/make-my-brand/screens/`
- ADDON-33 (platform-wide SKU), ADDON-37 (wallet holds, events), ADDON-38 (Purchase Hub quotes, samples, POs), ADDON-39 (inner pages, app hand-off)

## The route in one line

Verified-supplier product → customise in the studio → Make My Brand request → confirmed quote + supplier proof → sample → buy the production order (deposit, QC, balance) → stock in the Octopus warehouse → ship worldwide (per order from connected stores, or in bulk to a country). Dropship is an option only where the supplier can brand per order.

## Account manager for every customer

Every customer company is assigned one Octopus account manager (staff role `account_manager`). The manager owns the customer's work queue items, checks every quote and supplier proof before the customer sees it, and approves and sends quotes within their limit (above the amount limit or below the minimum margin, the owner approves). The customer sees the manager's name, photo and a Message button on the dashboard and every project. The customer still accepts quotes, approves artwork and samples, and pays. Reassignment is admin-only and logged; the customer is notified.

## Screens → routes

| Canvas artboard | Route | Who |
|---|---|---|
| 1 Sign up and brand profile | `/make-my-brand/start` | Customer |
| 2 Dashboard | `/account/brand` | Customer |
| 3 Discover (verified suppliers only) | `/make-my-brand/products` | Customer |
| 4 Product detail | `/make-my-brand/products/[sku]` | Customer |
| 5 Brand studio | `/account/brand/studio/[projectId]` | Customer |
| 6 Brand project (quote, artwork, sample, buy, production, documents, activity) | `/account/brand/projects/[id]` | Customer |
| 7 Warehouse stock | `/account/brand/stock` | Customer |
| 8 Ship worldwide | `/account/brand/ship/new` | Customer |
| 9 Stores and fulfilment | `/account/brand/sell` | Customer |
| 10 Orders, bulk shipments, returns | `/account/brand/orders` | Customer |
| 11 Admin work queue, integrations, activity log | `/admin/brand` | Staff |
| 12 Admin quote and artwork desk | `/admin/brand/requests/[id]` | Staff |
| 13 Phone | the same screens at 390 px | Customer |

Look: the home page's header, service rail ("Make My Brand" added after "Product sourcing"), tokens and classes (navy #11133C, blue #2A6FD6, Lexend, Inter, IBM Plex Mono). Account pages use the existing My account shell.

## Antigravity prompt 40-A: discovery and questions (change nothing)

```
Read docs/ADDON-40-make-my-brand.md, the Make My Brand doc and design/make-my-brand/screens/*.png. Change nothing.

Report:
1. What our catalogue already stores per product: variants, tier prices, MOQ, lead time, stock, sample price, HS code, battery/liquid flags, country limits, supplier id, supplier verification status. List the missing fields Make My Brand needs.
2. How a supplier is marked "verified" today (table, column, who sets it). If there is no such flag, say so.
3. Whether a catalogue API or feed exists (ADDON-37 37-C) and what it returns.
4. The state of the Purchase Hub (ADDON-38), the 3PL app and the Dropship app: what is built, what has an API, what events exist.
5. Payment provider status for the Hong Kong company.
Then list every feature from the doc's "Features blocked" table that is still blocked, with the exact missing item. Wait for my answers before 40-B.
```

## Antigravity prompt 40-B: data model

```
Add schema `brand` (Supabase, row-level security on every table; customers see only their company's rows, staff by role):

- account_managers(company_id pk, staff_id, assigned_at, assigned_by): exactly one current manager per customer company; history kept in activity_log. Staff with role account_manager see only their customers' rows unless they are also admin.
- approval_limits(role, max_quote_minor, min_margin_pct): an account manager may approve and send a quote only within these; otherwise it goes to the owner's approval queue.
- messages(id, company_id, project_id null, author_type enum('customer','staff'), author_id, body, attachments jsonb, created_at): customer ↔ account manager thread per project and per company.
- brand_profiles(id, company_id, name, invoice_name, colours jsonb [{hex, pantone}], markets text[], channels text[], default_fulfilment enum('undecided','dropship','3pl','hybrid'), created_at)
- brand_assets(id, profile_id, kind enum('logo','logo_alt','packaging','other'), storage_path, mime, is_vector bool, width_px, height_px, uploaded_by, created_at): files in a PRIVATE storage bucket; signed URLs that expire in 10 minutes; only the owner company and staff can read; suppliers never get the raw files, only approved proofs.
- branding_methods(id, product_id, method enum('laser','pad_print','uv_print','screen_print','embroidery','emboss','packaging_box','insert','label'), placements text[], max_w_mm, max_h_mm, max_colours, setup_fee_minor, unit_fee_minor, extra_moq, extra_days, active, source enum('supplier_confirmed','staff_estimate'))
- packaging_options(id, product_id, kind, moq, unit_fee_minor, setup_fee_minor, extra_days)
- projects(id 'MB-xxxx', company_id, profile_id, product_id, variant_id, method_id, placement, logo_asset_id, logo_colours jsonb, logo_size enum('s','m','l'), packaging_option_id, quantity, notes, fulfilment enum, status enum('draft','requested','quoted','artwork','sample','awaiting_payment','in_production','qc','to_warehouse','in_stock','closed','cancelled'), purchase_request_id null (ADDON-38), created_at, updated_at)
- project_quotes(id, project_id, version, lines jsonb [{label, qty, unit_minor, amount_minor}], total_minor, currency, moq, production_days, payment_terms, valid_until, status enum('draft','sent','accepted','expired','superseded'), staff_cost jsonb STAFF ONLY, margin_pct STAFF ONLY, approved_by STAFF ONLY)
- artwork_versions(id, project_id, version, kind enum('studio_preview','supplier_proof'), file_path, specs jsonb {pantone[], w_mm, h_mm, position}, status enum('pending','approved','changes_requested'), customer_comment, decided_by, decided_at)
- samples(id, project_id, quote_id, status, tracking_ref, verdict enum('approved','rejected') null, verdict_note)
- stock_skus(id, company_id, project_id, brand_sku, octopus_sku (ADDON-33), warehouse_id): stock levels themselves stay in the 3PL app.
- shipments(id 'SH-xxxx', company_id, kind enum('bulk','orders_csv'), country, address jsonb, importer_of_record, service enum('air_express','air_freight','sea_freight'), incoterm enum('DDP','DAP'), lines jsonb, quote_minor null, status, documents jsonb)
- activity_log(id, actor_type, actor_id, company_id, entity, entity_id, action, before jsonb, after jsonb, reason, created_at): append-only; write on every price, status, approval and permission change.

Catalogue rule: Make My Brand only lists products whose supplier is verified AND that have at least one active branding method AND ship to at least one of the customer's markets. Enforce it in a database view (brand.v_brandable_products), not only in the UI.
```

## Antigravity prompt 40-C: customer screens (phase 2, example data allowed but labelled)

```
Build artboards 1 to 10 and the phone layouts from the canvas, in the home page style.

Rules on every screen:
- Every number shows its source. Values from the live catalogue carry a "Catalogue" tag with the read time. Anything else carries an "Example" tag, cannot be added to an order, and is excluded from totals that are charged.
- The studio preview always shows "Illustrative preview. Not approved artwork." Only an approved supplier proof can be produced.
- Each project shows one status timeline (Request sent, Quote, Artwork, Sample, Pay order, Production, QC, To warehouse, In stock) and one "Your turn" or "Octopus is working on it" line.

Screens:
1. Start: uses the portal session; brand name, invoice name, logo upload (SVG/AI/EPS/PDF preferred, PNG ≥ 2000 px accepted with a warning), brand colours with optional Pantone, markets, channels, default fulfilment.
2. Dashboard: "Your account manager" card (name, photo, office, reply time, Message, Book a call); "Waiting for you" list (artwork, quotes, store errors, order holds) with one button each; brand projects table with stage, progress, next step and fulfilment; last-7-days panel; stores panel.
3. Discover: verified-supplier products only (from the view in 40-B); filters for category, branding method, MOQ with branding, fulfilment, ships to my markets; save (heart) and a Saved view.
4. Product: supplier code and verification checks, variants, tier table, MOQ, HS code, production time, sample price, stock, shipping limits (battery, liquid, blocked markets), branding options table, "Customise with my brand", "Ask for a plain sample first", and the 6-step route.
5. Studio: variant, method, placement, logo size, logo colour (not for laser), packaging, quantity (never below the highest applicable MOQ), notes; illustrative preview of product and box; estimate with source tags; "Save draft" and "Send Make My Brand request".
6. Project: account manager strip under the title (who runs the project, Message); tabs Quote (lines, MOQ, production days, terms, validity, accept or ask), Artwork (proof versions, checklist, approve or request changes with a comment), Sample (timeline and verdict), Buy and pay (destination: keep as stock in the Octopus warehouse, the default, or ship everything to my country; deposit and balance; wallet or card), Production (status, weekly photos, QC report), Documents, Activity.
7. Warehouse stock: counters; stock by SKU (brand SKU and Octopus SKU, available, reserved, damaged, incoming, days of stock); inbound records with count and damage photos; low-stock alert and auto reorder draft; storage rates from the 3PL rate card.
8. Ship worldwide: bulk to one address or single orders CSV; country (DDP for UAE, Saudi Arabia, UK, US; DAP elsewhere, with the right importer of record); lines from stock with cartons, weight and volume; service options with estimates; battery notice and documents; "Get final shipping quote" (price and date confirmed before payment).
9. Sell: stores (Shopify, WooCommerce, order API key, wholesale) with sync state and reconnect; fulfilment per product: 3PL from our warehouse (default), dropship (only when the supplier allows per-order branding), hybrid with the threshold from settings.
10. Orders: customer orders with source, destination, fulfilled by, status, Octopus tracking link, holds with a fix button; bulk shipments; returns with the brand owner's decision buttons.
```

## Antigravity prompt 40-D: admin screens

```
Build artboards 11 and 12. Staff roles: owner, admin, account_manager, warehouse, finance, support. Each queue and action is limited to its role; every action writes activity_log.

Account managers: the work queue opens on "My customers" (only companies assigned to them), with "All managers" for admins and the owner. The account manager prices quotes with supplier input, checks proofs, and presses "Approve and send to customer" when the quote is within approval_limits; otherwise the button becomes "Send to owner for approval" and the quote lands in the owner's queue. Customers and managers screen: assign or reassign a manager (admin only, logged, customer notified by email and in-app).

11. Work queue: counters for quotes to price, artwork to check, samples, payments to match, shipping exceptions, returns, sync errors; list per queue oldest first with age, owner and the main action; integrations health (per connection: status, last good event, queued events, retry button); activity log.
12. Quote desk: customer files (vector check, private), studio settings and notes, MOQ check against product, branding and packaging MOQs; supplier feasibility box (STAFF ONLY: method possible, max size, MOQ, lead time, proof upload); price builder per line with supplier cost in CNY, FX rate, margin per line (step buttons), customer unit and amount, delivery to the warehouse at cost, sample at cost plus the handling fee; payment terms and validity; approval rule from settings (amount limit and minimum margin → owner approval); preview of what the customer sees (customer columns only); "Ask supplier for another quantity", "Save draft", "Send quote".
Also: Customers and brands, Products (verified only; toggle Make My Brand on/off), Suppliers (verification status and evidence), Branding methods editor, Pricing and margins settings, Purchase orders, 3PL inventory view, Shipping exceptions, Returns, Support cases, Roles and access.
```

## Antigravity prompt 40-E: real catalogue, Purchase Hub and payments (phase 3)

```
Only after 40-A answers confirm the catalogue API, the Purchase Hub and the payment provider:
1. Read products, variants, prices, MOQ and stock from the catalogue API or feed; keep a read time per value; react to product.updated / product.archived by warning affected projects.
2. A Make My Brand request creates a Purchase Hub request (ADDON-38 POST /requests) carrying the project id, studio settings and the private logo link for staff. Quotes, proofs, samples and POs come back as events and fill project_quotes, artwork_versions and samples.
3. Payments: sample and deposit and balance through the portal wallet API (ADDON-37 holds and captures) or the provider's hosted checkout. Never collect or store card numbers. Idempotent on the provider's payment id. Invoices from the Hong Kong company.
4. The production order's delivery is "Octopus warehouse" by default: when QC passes and the balance is paid, emit purchase_order.ready_to_ship so the 3PL app creates the inbound (ADDON-38 38-F).
```

## Antigravity prompt 40-F: stores, 3PL, shipping, returns, reports (phase 4)

```
1. Stores through the Dropship app's connections (Shopify, WooCommerce) and our own order API with per-company keys. Orders keyed on the store order id; duplicates ignored.
2. Stock and orders through the 3PL app: stock.changed updates stock views; customer orders route to stock (3PL), to the supplier (dropship, only when allowed) or by the hybrid rule.
3. Bulk shipments: rate request to the 3PL app, final quote and date confirmed before payment, documents (commercial invoice, packing list, battery declaration where needed).
4. Tracking back to the store; Octopus tracking page only; carrier names never shown to customers.
5. Returns: return.requested / return.received, inspection result, brand owner's decision (refund, replace, restock), supplier claim for faulty units within the agreed window.
6. Reports: orders, units, stock days, landed cost per unit, returns rate, per product and market.
7. Sync safety: signed webhooks, 5-minute timestamp window, inbox table for duplicates, retries for 24 h, failures in the admin Integrations screen with retry, plain-language message to the customer on the affected item.
```

## Antigravity prompt 40-G: test with real sample orders before launch

```
On a staging copy with real but small orders:
1. A test customer completes the profile, picks a verified-supplier product, sends a request.
2. The assigned account manager prices it, checks and sends the proof; the customer requests a change, then approves v2. A second quote above the limit goes to the owner for approval.
3. Sample paid and delivered; the customer approves it.
4. Production deposit paid; QC report uploaded; balance paid; inbound counted into stock.
5. A Shopify test order ships from stock with tracking back to Shopify.
6. A bulk shipment to a DDP country is quoted, paid and delivered with documents.
7. A return is received, inspected and restocked.
8. Duplicate webhooks, a revoked store token and a failed payment each show up correctly and recover.
Report each step with screenshots and the activity log lines it produced.
```

## Notes

- Example values in the designs (Nova Breeze, quotes, Pantone codes, stock numbers, staff names) are prototype data. Text in [brackets] is an open decision or live data still to come.
- Responsibility for compliance, customs, returns and customer service per market is proposed in the doc, section 5. Do not hard-code it; keep it in settings per market so it can change after legal review.
