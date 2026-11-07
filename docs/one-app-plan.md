# Octopus B2B: one app with Sourcing, Dropshipping, 3PL and Make My Brand

Exported from the Claude doc of the same name, 7 Nov 2026.

## Summary and decisions

This plan replaces the separate-app plan and the earlier add-on prompts for these services. Nothing has been sent to Antigravity for Dropshipping, 3PL or Make My Brand yet, so the build starts here.

**Decided on 7 Nov:**

- **One application.** Sourcing, Dropshipping, 3PL warehouse and Make My Brand are sections of Octopus B2B (hostoctopus.com). There is no separate hub and no separate apps.
- **One Supabase project and one Vercel project**, the ones the site already uses. No new domains, no single sign-on between apps, no webhooks between apps.
- **One sign-in.** A customer signs in once and sees every service their company has switched on.
- **Customers and staff are kept apart.** Customers use My account (`/account`); Octopus staff use Admin (`/admin`). A staff account cannot act as a customer.
- **One look:** the home page style (navy #11133C, blue #2A6FD6, Lexend headings, Inter text). The home page itself does not change.
- **The existing Dropship and Octopus WMS designs are kept** and moved into this look and into the My account and Admin layouts.
- **Every customer has one Octopus account manager**, shown in every section.

## Map of the one app

```
Public site: home page (unchanged) and service pages ──► My account
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ My account (customers)       │  │ Admin (Octopus staff)        │
│ Account home · Sourcing      │  │ Customers, managers          │
│ Dropshipping · 3PL warehouse │  │ Purchase desk · Dropship ops │
│ Make My Brand · Wallet       │  │ Warehouse + scanner          │
│                              │  │ Brand quote desk · Audit     │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               ▼                                 ▼
 Shared, built once: sign-in and roles · company services · wallet and holds · approvals ·
 audit log · account managers · notifications · product catalogue · background jobs · private files
 One Supabase project, one Vercel project, one domain: hostoctopus.com
 Outside: seller stores (Shopify, WooCommerce) · bank transfer (USD, Hong Kong account) · carriers · verified suppliers
```

The service pages lead into My account. Each section of My account has a matching staff section in Admin. Wallet, approvals, account managers and the audit log are built once and used by every section.

## Shared parts every section uses

| Shared part | What it does | Used by |
| --- | --- | --- |
| **Sign-in and roles** | The existing sign-in. Customer roles: owner, buyer, viewer. Staff roles: account manager, warehouse, buyer, finance, owner. Two-factor sign-in for staff. | All |
| **Company services** | A list of services switched on for each company (sourcing, dropship, warehouse, brand) with plan and start date. The menu shows only switched-on sections; the rest show a "Start" card. | All |
| **Wallet and holds** | One US dollar wallet per company. A section places a hold before work starts, then captures or releases it. Top-ups are US dollar bank transfers (TT) to the company's Hong Kong account, quoting the company's own wallet reference; finance confirms each transfer in Admin before the wallet is credited. No card payments. | Dropship, 3PL, Make My Brand, Sourcing |
| **Invoices** | Every invoice and receipt from the Hong Kong company, one number series, lines from any section. | All billing |
| **Account managers and approvals** | One manager per customer. The account manager sets the limits for each of their customers in Admin; anything above the manager's own approval limit goes to the owner. | Make My Brand, Sourcing, 3PL |
| **Product catalogue** | The existing catalogue, with price, stock and read time. Products Octopus lists directly are the verified-supplier products; only these appear in Make My Brand. | Dropship, Make My Brand, Sourcing |
| **Notifications** | Email and in-app messages from one template set, in the white-label voice. | All |
| **Audit log** | Append-only record of every price, status, approval, wallet move and role change. | All |
| **Background jobs** | Scheduled tasks: store sync, tracking updates, hold expiry, low-stock alerts, storage billing. | Dropship, 3PL, Make My Brand |
| **Private files** | Private storage for logos, brand files and documents; links expire after 10 minutes. | Make My Brand, Sourcing |

## Each section: screens and data

| Section | Customer screens (My account) | Staff screens (Admin) | Its own tables |
| --- | --- | --- | --- |
| **Account home** `/account` | "Waiting for you" across all sections, wallet, account manager, services switched on | Customers list, company services, manager assignment, approval limits | (shared tables) |
| **Sourcing** `/account/sourcing` | Requests, quotes, orders, inspection reports | Purchase desk: inbox, request detail, quote builder, suppliers, purchase orders, quality checks | sourcing requests, supplier quotes, purchase orders, inspections |
| **Dropshipping** `/account/dropship` | Dashboard, Stores, Catalogue, Import list, Import editor, Orders, Pricing rules, Settings | Dropship operations: catalogue manager, fulfilment, shipping services | store connections, imported products, pricing rules, store orders, shipments |
| **3PL warehouse** `/account/warehouse` | Stock by SKU, inbound shipments (ASN), outbound orders, storage and handling bills | Control tower, inbound and receiving, inventory, fulfilment and packing, clients and billing, integrations; phone scanner at `/scan` | warehouses, bins, client SKUs, ASNs, stock moves, pick and pack jobs, charges |
| **Make My Brand** `/account/brand` | Set-up, Dashboard, Discover (verified only), Product, Studio, Project, Stock, Ship worldwide, Stores, Orders | My customers queue, quote and artwork desk | brand profiles, brand files, projects, quotes, artwork versions, samples, branded SKUs, bulk shipments |

Stock is one set of tables. Dropship own stock, 3PL client stock and Make My Brand branded stock all live in the warehouse tables with an owner company, so there is one count per bin.

Rules that hold in every section:

- **No sample data shown as live.** Live values carry a "Catalogue" tag and the time they were read; anything else carries "Example" and cannot be ordered or charged.
- **White-label.** Customer screens show Octopus service names only (Express, Standard, Economy, DDP Gulf, DDP US, DDP UK), never carrier, supplier or marketplace names. Staff screens may show them.
- **Staff-only fields** (supplier cost, margin, factory details) sit in staff-only tables and never reach a customer screen or API reply; a test fails if they do.

## Database, routes and code layout

One Supabase project with one schema per section, so the tables stay tidy without splitting the database:

```
core      companies, users, roles, company_services, wallet_ledger, wallet_holds,
          invoices, account_managers, approval_limits, approvals, notifications, audit_log
public    the existing catalogue (Octopus-listed products = verified suppliers), suppliers, orders
sourcing  requests, supplier_quotes, purchase_orders, inspections
dropship  stores, imported_products, pricing_rules, store_orders, shipments
wms       warehouses, bins, skus, asns, stock_moves, pick_jobs, charges
brand     profiles, assets, projects, quotes, artwork_versions, samples, branded_skus, bulk_shipments
```

Row-level security on every table: a customer sees only rows of their own company; staff see rows by role, and account managers see only their customers. Staff-only tables have no customer policy at all.

One Next.js app, one Vercel project:

```
app/(public)/            home page (unchanged), /sourcing, /dropshipping, /3pl, /make-my-brand
app/account/             account home, wallet, invoices, manager
app/account/sourcing/    app/account/dropship/   app/account/warehouse/   app/account/brand/
app/admin/               customers, approvals, integrations, audit
app/admin/sourcing/      app/admin/dropship/     app/admin/warehouse/     app/admin/brand/
app/scan/                warehouse phone scanner
app/api/webhooks/        store and carrier webhooks (signature checked, each event recorded once)
lib/core/                wallet, approvals, audit, notifications, roles
lib/sourcing/ lib/dropship/ lib/wms/ lib/brand/
components/shell/        top bar, section menu, account manager card
components/ui/           home page tokens and parts
```

Sections call each other through functions in `lib/`, never by reaching into another section's tables from a page.

## Build order, what this replaces, open items

**Build order (Antigravity prompt set ADDON-41).** Stop after each step for a check with screenshots against the designs.

1. **41-A Report only:** what exists today, what each step changes, and what is blocked by the open items.
2. **41-B Shared parts:** account shell and section menu, company services, separate staff roles, account managers and approval limits, wallet holds, invoices, notifications, audit log.
3. **41-C Warehouse section** (3PL): stock, inbound, outbound, billing, staff screens and scanner. Built first because Dropship and Make My Brand use its stock.
4. **41-D Dropshipping section.**
5. **41-E Make My Brand section**, using the ADDON-40 data model in the `brand` schema.
6. **41-F Sourcing section and Purchase desk**, using the ADDON-38 screens and statuses.
7. **41-G Outside connections:** stores, carriers, bank transfer confirmation.
8. **41-H End-to-end test** with real sample orders on staging: one Dropship order, one 3PL inbound and dispatch, one Make My Brand project from quote to stock to shipment.

**What this replaces**

| Earlier add-on | Status now |
| --- | --- |
| ADDON-37 separate B2B, Dropship and 3PL apps | Dropped. No separate apps, no sign-on between apps |
| ADDON-38 Purchase Hub | Screens and statuses kept; built as the Sourcing section and Admin Purchase desk in 41-F |
| ADDON-39 inner pages | Kept. "Open" buttons go to `/account/<section>` instead of another app; the `/apps/[app]/open` route is not needed |
| ADDON-40 Make My Brand | Kept as written (it was already inside Octopus B2B); built in 41-E |
| ADDON-33 to 36 | Site work; not affected |

**Answered on 7 Nov**

- **Payment:** wallet top-ups by US dollar bank transfer to the Standard Chartered Bank (Hong Kong) account of Shenzhen Octopus Trading Co., Ltd. The bank details are entered once in Admin › Payment settings and shown to signed-in customers; they are not written into the code. Transfers are credited after finance confirms them.
- **Verified suppliers:** every product Octopus lists directly counts as verified. Products listed any other way are not.
- **Approval limits:** each account manager sets the limits for their own customers in Admin.
- **Store platforms:** Shopify and WooCommerce first.

**Still open**

1. Warehouse details (own or partner, bins, docks) and the carrier accounts behind each service name. Shipping labels are blocked until then.
2. Pricing rules for Dropship, 3PL storage and handling, and Make My Brand margins.
3. Target countries for launch.
4. Each account manager's own approval limit, above which the owner approves.
