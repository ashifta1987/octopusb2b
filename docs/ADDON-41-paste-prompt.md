# One Octopus B2B app: paste this into Antigravity

This kit replaces the separate-app plan (ADDON-37). Sourcing, Dropshipping, 3PL warehouse and Make My Brand are built as sections of the existing Octopus B2B app, on the existing Supabase project and the existing Vercel project.

Put these in the repo first (all in this zip):
- `docs/one-app-plan.md`: the master plan (decisions, map, shared parts, sections, schemas, routes, build order, open items)
- `docs/ADDON-41-one-app-all-services.md`: prompts 41-A to 41-H
- `docs/ADDON-38-purchase-hub.md`, `docs/ADDON-39-inner-pages-and-app-links.md`, `docs/ADDON-40-make-my-brand.md`: section details the prompts refer to
- `design/one-app/screens/*.png`: the screens at 1440 px and 390 px
- `design/one-app/source/*.dc.html` and `assets/`: the design source with exact text, colours and sizes

Then paste:

```
We are adding four services to the existing Octopus B2B app (hostoctopus.com) as sections of the same app: Sourcing, Dropshipping, 3PL warehouse and Make My Brand. Customers use them inside My account (/account); Octopus staff use Admin (/admin) and the warehouse scanner (/scan). There is NO separate app, NO new Supabase project, NO new Vercel project, NO new domain and NO single sign-on between apps. Every customer company has one Octopus account manager who handles their work and sets the limits for each of their customers; above the manager's own approval limit the owner approves. Products Octopus lists directly are the verified-supplier products, and only these can be used in Make My Brand.

Read first: docs/one-app-plan.md, docs/ADDON-41-one-app-all-services.md, then design/one-app/screens/*.png (match them) and design/one-app/source/*.dc.html (exact copy and styles; HTML with {{ }} placeholders, not code to paste). For Sourcing and Make My Brand details also read docs/ADDON-38 and docs/ADDON-40; for the public service pages docs/ADDON-39.

Hard rules:
1. Do not change the home page. Use its header, tokens and classes for every new page.
2. One app, one Supabase project (one schema per section: core, sourcing, dropship, wms, brand), one Vercel project.
3. Customers only reach /account/*; staff only reach /admin/* and /scan. A staff account cannot act as a customer. Account managers see only their customers. Row-level security on every table.
4. Never present example data as live. Live values show a "Catalogue" tag and read time; anything else shows "Example" and cannot be ordered or charged.
5. Money only through the wallet (hold, capture, release, refund). No card payments. Top-ups are US dollar bank transfers to our Hong Kong bank account; the wallet is credited only when finance confirms the transfer in Admin. Bank details are entered in Admin › Payment settings, never written in code.
6. Staff-only fields (supplier cost, margin, factory details, carrier names) never reach a customer page or API reply. Add a test that fails if they do.
7. White-label customer pages: service names only (Express, Standard, Economy, DDP Gulf, DDP US, DDP UK).
8. Every price, status, approval, wallet move and role change writes to core.audit_log (append-only).
9. Text in [brackets] in the designs is an open decision or live data. Fill it from the database or hide it; never ship the brackets.

Work in order and stop after each step for my check: 41-A (report only, plus the list of blocked features) → 41-B shared parts → 41-C 3PL warehouse → 41-D Dropshipping → 41-E Make My Brand → 41-F Sourcing and Purchase desk → 41-G outside connections → 41-H end-to-end test with real sample orders.
After each step: list changed files and migrations, show desktop and phone screenshots next to the matching PNG, and list anything you could not match or that is blocked.
Use staging and test accounts only. Do not touch live customer data.
```

## Screens in this kit

| PNG | Screen | Route |
|---|---|---|
| 01 | My account home: waiting for you across services, wallet, account manager, your services | `/account` |
| 02 | Dropshipping dashboard | `/account/dropship` |
| 03 | Dropshipping orders with detail panel | `/account/dropship/orders` |
| 04 | 3PL warehouse: my stock, inbound, outbound, bills | `/account/warehouse` |
| 05 | Make My Brand overview | `/account/brand` |
| 06 | Admin work queue for an account manager | `/admin` |
| 07 | Admin warehouse control tower | `/admin/warehouse` |
| 08 | Admin purchase desk | `/admin/sourcing` |
| 09 | Warehouse scanner (phone) | `/scan` |
| 10 | My account on a phone | `/account` at 390 px |

Files ending `-phone.png` show the same page at 390 px. The other Make My Brand screens are in kit 9 and the service pages in kit 8; both still apply, with "Open" buttons now going to `/account/<section>`.

## Answered on 7 Nov

- Payment: US dollar bank transfer to the Standard Chartered Bank (Hong Kong) account of Shenzhen Octopus Trading Co., Ltd. Enter the details in Admin › Payment settings after step 41-B.
- Verified suppliers: every product Octopus lists directly.
- Limits: each account manager sets them for their own customers.
- Store platforms: Shopify and WooCommerce first.

## Still needed from you (blocked until sent)

1. Warehouse details and carrier accounts behind each service name.
2. Pricing rules: Dropshipping, 3PL storage and handling, Make My Brand margins.
3. Target countries for launch.
4. Each account manager's own approval limit, above which the owner approves.
