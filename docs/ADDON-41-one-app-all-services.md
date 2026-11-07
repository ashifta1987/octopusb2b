# Add-on 41: one Octopus B2B app with Sourcing, Dropshipping, 3PL warehouse and Make My Brand

Read first:
- Doc "Octopus B2B: one app with Sourcing, Dropshipping, 3PL and Make My Brand" (export it as Markdown to `docs/one-app-plan.md`): decisions, map, shared parts, sections, schemas, routes, build order, open items.
- `design/one-app/screens/*.png` (match them) and `design/one-app/source/*.dc.html` (exact copy, colours and sizes; HTML with `{{ }}` placeholders, not code to paste).
- `docs/ADDON-38-purchase-hub.md` (Sourcing statuses and screens), `docs/ADDON-39-inner-pages-and-app-links.md` (service pages), `docs/ADDON-40-make-my-brand.md` (Make My Brand data model and screens).

This add-on replaces ADDON-37. There is no hub, no separate apps, no single sign-on between apps and no webhooks between apps. Everything is built inside the existing Next.js app, on the existing Supabase project and the existing Vercel project.

## What the customer and staff get

| Area | Route | Who | Design board |
|---|---|---|---|
| Home page | `/` | Everyone | unchanged |
| Service pages | `/sourcing`, `/dropshipping`, `/3pl`, `/make-my-brand` | Everyone | ADDON-39 kit |
| My account home | `/account` | Customer | 01 Main |
| Sourcing | `/account/sourcing/...` | Customer | ADDON-38 kit |
| Dropshipping | `/account/dropship` (dashboard), `/stores`, `/catalogue`, `/import`, `/orders`, `/pricing`, `/settings` | Customer | 02 Dropship, 03 DropshipOrders |
| 3PL warehouse | `/account/warehouse` (stock), `/inbound`, `/outbound`, `/returns`, `/bills` | Customer | 04 Warehouse |
| Make My Brand | `/account/brand/...` (routes in ADDON-40) | Customer | 05 Brand + ADDON-40 kit |
| Wallet and invoices | `/account/wallet`, `/account/invoices` | Customer | 01 Main (wallet card) |
| Admin work queue | `/admin` | Staff | 06 AdminHome |
| Admin warehouse | `/admin/warehouse` (control tower), `/inbound`, `/inventory`, `/fulfilment`, `/clients` | Warehouse staff | 07 AdminWarehouse |
| Purchase desk | `/admin/sourcing` | Buyers | 08 AdminPurchase |
| Make My Brand desk | `/admin/brand/...` (ADDON-40) | Account managers | ADDON-40 kit |
| Scanner | `/scan` (phone, installable) | Warehouse staff | 09 Scanner |
| Phone views | every route works at 390 px | Customer | 10 Phone |

## Hard rules for every prompt below

1. Do not change the home page. Use its header, tokens and classes for every new page (navy #11133C, blue #2A6FD6, background #F5F6F8, border #E2E5EA, muted #5A6475, Lexend headings, Inter text, IBM Plex Mono labels).
2. One app, one Supabase project, one Vercel project. Do not create new projects, domains or sign-in systems.
3. Customers and staff are separate. Customers only reach `/account/*`; staff only reach `/admin/*` and `/scan`. A staff account cannot act as a customer. Account managers see only their own customers.
4. Never present example data as live. Live values show a "Catalogue" tag and the time they were read; anything else shows "Example" and cannot be ordered or charged.
5. Money goes through the wallet only: hold, capture, release, refund. No card payments. Top-ups are US dollar bank transfers (TT) to the company's Hong Kong bank account; the wallet is credited only when finance confirms the transfer in Admin. The bank details live in Admin › Payment settings, never in code or in the repository.
6. Staff-only fields (supplier cost, margin, factory details, carrier names) live in staff-only tables or columns that customers cannot read. Add a test that fails if any customer page or API reply contains them.
7. White-label on customer pages: Octopus service names only (Express, Standard, Economy, DDP Gulf, DDP US, DDP UK); no carrier, supplier or marketplace names.
8. Every price, status, approval, wallet move and role change writes a row to `core.audit_log` (append-only; no update or delete policy).
9. Text in [brackets] in the designs is an open decision or live data. Fill it from the database or hide it; never ship the brackets.
10. Work on staging with test accounts. Do not touch live customer data. Stop after each prompt for my check.

After each prompt: list changed files and migrations, show desktop (1440 px) and phone (390 px) screenshots next to the matching PNG, and list anything you could not match or that is blocked.

---

## Prompt 41-A: report only (change nothing)

```
Read docs/one-app-plan.md and docs/ADDON-41-one-app-all-services.md, then the code. Change nothing.
Report:
1. Current routes under /account and /admin, the layout files that wrap them, and how sign-in and roles work today (tables, middleware, policies).
2. Existing tables that overlap with the plan: companies/profiles, users and roles, products and suppliers, orders, wallet or payments, any inventory or warehouse tables. Products that Octopus lists directly are the verified-supplier products: report which field tells them apart from products listed any other way (for example by suppliers), or say that none exists yet.
3. Which Supabase schemas exist, and whether row-level security is on for every table.
4. For each prompt 41-B to 41-H: the files and tables it will add or change.
5. A list of features blocked by the open items in the plan (warehouse and carrier details, pricing rules, target countries, each account manager's own approval limit), each with what is needed to unblock it.
```

## Prompt 41-B: shared parts

```
Build the shared parts every section uses. No section screens yet.

Database (migration in schema core, row-level security on every table):
- company_services(company_id, service enum('sourcing','dropship','warehouse','brand'), status enum('off','trial','on','paused'), plan text, started_at, ended_at)
- staff_roles(user_id, role enum('account_manager','warehouse','buyer','finance','owner'), office text)  -- separate from customer roles
- customer_roles(user_id, company_id, role enum('owner','buyer','viewer'))
- account_managers(company_id unique, manager_user_id, assigned_at, assigned_by)
- approval_limits(manager_user_id, max_amount_usd numeric, min_margin_pct numeric, approver_role text default 'owner')  -- the manager's own ceiling, set by the owner
- customer_limits(company_id, max_order_usd numeric, max_month_usd numeric, min_margin_pct numeric, set_by, set_at)  -- set by the customer's account manager in Admin, within the manager's own ceiling
- payment_settings(one row: beneficiary, bank_name, account_number, swift, bank_code, branch_code, bank_address, currency 'USD', updated_by)  -- editable by finance and owner only; customers read it through a view after sign-in
- bank_transfers(id, company_id, wallet_reference, amount_usd_claimed, slip_path (private bucket), status enum('submitted','confirmed','rejected'), amount_usd_received, bank_ref, confirmed_by, confirmed_at, reject_reason)
- each company gets a unique wallet_reference (for example OCT-48213) that customers quote on every transfer
- approvals(id, company_id, service, ref_type, ref_id, amount_usd, margin_pct, reason, requested_by, status enum('pending','approved','declined'), decided_by, decided_at, note)
- wallet_ledger(id, company_id, kind enum('topup','hold','capture','release','refund','adjustment'), amount_usd, service, ref_type, ref_id, hold_id, created_by, created_at)  -- append-only
- wallet_holds(id, company_id, amount_usd, service, ref_type, ref_id, status enum('open','captured','released','expired'), expires_at)
- invoices(id, number unique, company_id, issuer 'Hong Kong company', total_usd, status, pdf_path, issued_at) and invoice_lines(invoice_id, service, description, qty, unit_usd, amount_usd, ref_type, ref_id)
- notifications(id, company_id, user_id, service, title, body, link, read_at)
- audit_log(id, at, actor_user_id, actor_kind enum('customer','staff','system'), company_id, service, action, ref_type, ref_id, before jsonb, after jsonb)  -- insert only
- webhook_inbox(id, source, external_event_id unique per source, received_at, signature_ok bool, processed_at, error)  -- every incoming webhook is checked and recorded once
Functions in lib/core: placeHold, captureHold, releaseHold, refund (each idempotent on ref, fails with INSUFFICIENT_FUNDS), requestApproval (auto-approves inside the customer's limits and the manager's ceiling, otherwise creates a pending approval: the manager for customer limits, the owner above the manager's ceiling), confirmTransfer (finance only: writes a topup ledger row for the amount actually received and a receipt), audit(), notify().
Wallet balance = topups + refunds + releases − holds − captures (computed from the ledger, never stored by hand).

Layouts (match design board 01 Main and the admin header in boards 06–08):
- /account layout: header (logo, search, "Prototype · example data" only in staging, wallet balance, notifications, user), service tabs (Home, Sourcing, Dropshipping, 3PL warehouse, Make My Brand, Wallet and invoices), section side menu, account manager card. Tabs for services that are off show the service page's "Start" card instead.
- /admin layout: navy header with white logo and "Admin · staff only", admin tabs (Work queue, Customers, Purchase desk, Dropship operations, Warehouse, Make My Brand desk, Integrations and audit).
- Middleware: /account/* needs a customer role; /admin/* and /scan need a staff role; anything else → sign-in or 403.
Pages: /account home (board 01: Waiting for you across services with filter, account manager, wallet card, your services, recent activity), /account/wallet (bank details, wallet reference, upload transfer slip, history), /account/invoices, /admin home (board 06), /admin/customers (company services, manager assignment, customer limits set by the manager), /admin/finance/transfers (confirm or reject submitted transfers), /admin/settings/payment (bank details, finance and owner only).
Tests: a customer cannot read another company's rows; a customer cannot read staff_roles, approval_limits or any staff-only column; an account manager cannot read companies they do not manage; audit_log rejects update and delete.
```

## Prompt 41-C: 3PL warehouse section (build before Dropshipping and Make My Brand; both use its stock)

```
Schema wms, row-level security on: warehouses, zones, bins, skus(owner_company_id, service enum('dropship','warehouse','brand'), sku, name, barcode, weight_g, dims_mm), stock(bin_id, sku_id, on_hand, reserved), asns(id, owner_company_id, number, status enum('draft','in_transit','at_dock','receiving','qc_hold','put_away','closed'), eta), asn_lines(asn_id, sku_id, expected, received, variance_decision enum('keep','return') null), stock_moves(append-only: receive, put_away, pick, adjust, return, with actor and reason), outbound_orders(id, owner_company_id, source enum('dropship','brand','warehouse','sourcing'), service_name, status), pick_jobs, pack_jobs, charges(owner_company_id, month, kind enum('storage','handling','packing','other'), qty, rate_usd, amount_usd, invoiced bool).
One count per bin: dropship own stock, 3PL client stock and Make My Brand branded stock all live here with owner_company_id.
Customer pages (board 04 Warehouse): My stock (available, reserved, inbound, zone, last count), Inbound notices (create ASN; when received with a variance, the customer chooses keep or return — writes asn_lines.variance_decision and audit), Outbound orders (service names only), Returns, Bills and rates (rates come from the pricing rules; until they are set show [Rate] and block billing).
Staff pages (board 07 AdminWarehouse): control tower (orders due by section, carrier cut-offs, exceptions, zones and docks), inbound and receiving with QC checklist, inventory with counts and adjustments (reason required), fulfilment and packing waves, clients and billing (monthly charges → invoice lines → wallet capture through lib/core), integrations.
Scanner /scan (board 09): pick, receive, put away, count; large targets; works offline for a pick route and syncs when back online.
Carrier names appear only on staff pages. Labels are blocked until carrier accounts are given (open item); show "Label: blocked, carrier account missing" instead of a fake label.
```

## Prompt 41-D: Dropshipping section

```
Schema dropship, row-level security on: stores(company_id, platform enum('shopify','woocommerce'), name, domain, status, token stored encrypted server-side only, last_sync_at), imported_products(company_id, product_id from the catalogue, store_id, title, price_rule_id, pushed_at), pricing_rules(company_id, tiers jsonb, rounding), store_orders(company_id, store_id, number, customer_paid_usd, cost_usd, status enum('on_hold','awaiting_payment','processing','partially_shipped','shipped','delivered','needs_attention','cancelled'), hold_id), shipments(order_id, service_name enum('Express','Standard','Economy'), status, tracking_ref, outbound_order_id).
Order flow: store webhook (signature checked, event recorded once in core.webhook_inbox) → store_order → 60-minute hold window (customer can edit or cancel in their store) → lib/core placeHold (or "awaiting payment" if the wallet is short) → wms.outbound_orders for Express stock, or a purchase order for Standard/Economy → shipped → tracking pushed to the store → captureHold.
Customer pages (boards 02 and 03): dashboard, stores, catalogue (only products allowed for the customer's markets; cost includes shipping and duties to the chosen country), import list and editor, orders with detail panel, pricing rules, settings.
Staff pages: catalogue manager, fulfilment queue, shipping services (map service names to carriers — staff only).
Shopify and WooCommerce first; other platforms are blocked until you confirm them.
```

## Prompt 41-E: Make My Brand section

```
Build ADDON-40 prompts 40-B to 40-D inside this app, with these changes:
- Tables go in schema brand (not public). Staff-only tables (project_quotes cost and margin) have no customer policy.
- Approvals use core.approvals, core.customer_limits and core.approval_limits; payments use lib/core holds and captures; activity goes to core.audit_log.
- Discover and every Make My Brand list show only products Octopus listed directly (the verified-supplier products). Enforce it in a database view, not only in the UI.
- Branded stock goes into wms.skus with service 'brand'; shipments use wms.outbound_orders.
- The section lives under /account/brand and /admin/brand with the shared layouts from 41-B.
Match board 05 Brand for the overview and the ADDON-40 kit for the other screens.
```

## Prompt 41-F: Sourcing section and Purchase desk

```
Build ADDON-38 inside this app: customer pages under /account/sourcing, staff Purchase desk under /admin/sourcing (board 08 AdminPurchase).
Schema sourcing, row-level security on: requests, supplier_quotes (staff only: unit cost CNY, MOQ, lead time, sample cost), customer_quotes (what the customer sees: price, delivery, validity), purchase_orders, inspections.
Customer price = cost converted at the day's rate + margin. Below the manager's minimum margin or above the amount limit → core.approvals before release. The customer never sees cost or margin.
Make My Brand and Dropshipping can create a sourcing request through lib/sourcing.createRequest (for example MB-0051).
When goods are bought for stock, create a wms ASN automatically.
```

## Prompt 41-G: outside connections

```
1. Bank transfer top-ups: the customer opens Add funds, sees the bank details and their wallet reference, transfers US dollars and uploads the slip. Finance sees the transfer in /admin/finance/transfers, checks the bank statement, enters the amount actually received and confirms (wallet credited, receipt issued, audit row) or rejects with a reason. No card payments anywhere. Do not connect to the bank or to any collection service's login; ask me before adding any automatic matching.
2. Store connections: Shopify and WooCommerce apps or keys, webhooks for orders, product push, tracking push. Tokens encrypted, read only on the server.
3. Carriers behind each service name: rates, labels, tracking (blocked until accounts are given).
4. Background jobs (Vercel cron or Supabase scheduled functions): store sync every [N] minutes, tracking updates, hold expiry, low-stock alerts, monthly storage billing, failed webhook retries for 24 hours.
5. Admin › Integrations and audit: status of each connection, last success, failures with retry button, and audit search.
```

## Prompt 41-H: end-to-end test with real sample orders (staging)

```
With test accounts and test stores only:
1. Wallet top-up: submit a test transfer with a slip on staging, confirm it as finance, check the ledger, receipt and audit rows.
2. Dropshipping: a Shopify test order → hold → pick and pack → tracking in the store → capture → invoice line.
3. 3PL: create an ASN, receive it with a variance, customer chooses keep, put away, ship one outbound order, run monthly billing.
4. Make My Brand: MB project from quote (over the limit → owner approval) → artwork approval → sample → production → stock in wms → bulk shipment.
5. Sourcing: request → supplier quotes → customer quote below minimum margin → approval → purchase order → ASN.
For each, list every audit_log row written, every wallet ledger row, and confirm no staff-only field appeared in any customer response. Report anything that did not match the designs.
```
