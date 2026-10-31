# Add-on: group buying (MOQ pools)

The same text as docs/SPEC.md section 18, kept here so the Antigravity prompt is easy to find. Screen design: docs/design/Pool.png, docs/design/Pools.png and docs/design/html/*.html; entry points on docs/design/Main.png and docs/design/Product.png.

## 18. Addendum: group buying (MOQ pools)

Added 1 Nov 2026. Buyers who cannot afford the full MOQ on their own can share it. A buyer opens a pool on a product, other buyers join by pledging a quantity and paying a 10% deposit; when the pool fills, Octopus places one order with the supplier and ships each buyer separately. If it does not fill by the deadline, deposits are refunded. Octopus is still the merchant of record (T&C §1.1).

Design: `docs/design/Pool.png` + `html/Pool.html`. Entry points on `docs/design/Main.png` ("Group buying pools" section with 4 cards) and `docs/design/Product.png` (card "MOQ too big? Join a group buy" after the Request quote button).

### 18.1 Rules

| Rule | Value (admin setting) |
| --- | --- |
| Who can start a pool | Any customer with a verified profile; KYC not required to join, but required to withdraw refunds to bank |
| Deposit | 10% of the pool-price value of your pledge, held by Octopus in escrow (service credit on the ledger) |
| Minimum pledge | 100 pcs (per product; override per product) |
| Pool size | Capped at 25 buyers to keep logistics simple |
| Deadline | 7 days default, 3–30 days range, chosen by starter |
| Starter rate | No special rate; starter opens the pool for others |
| Target quantity | The product's base MOQ by default. A pool starter may raise it to reach a lower tier (e.g. 2 × MOQ to unlock tier 2) |
| Pool price | The tier price at the current filled quantity, recomputed on every join. Everyone pays the final tier price when the pool fills |
| Backing out before fill | Allowed; deposit refunded in full to wallet. Logged |
| Backing out after fill | Not allowed: deposit forfeited and used to cover the shortfall |
| Supplier anonymity | Supplier sees pool as a single order with aggregate quantity. Other pool members see each other only by buyer code and country |
| Shipping | Each buyer gets their own shipment to their own address via YunExpress. Freight charged per buyer at balance time |
| QC | One shared QC inspection; report shared with every buyer |
| Claims | Each buyer has their own 7/30-day claim window on their own shipment (T&C) |
| Terms | Separate "Group Buy Terms" (CMS, versioned). Every pool stores the version joined |

### 18.2 State machine

`pools`: `open → locked (waiting for balance payments) → confirmed (one order placed) → shipped → completed`; branches `expired` (deadline passed, below target) and `cancelled` (admin). `pool_pledges`: `pending (deposit) → paid → confirmed (balance paid) → shipped → delivered`; branches `withdrawn` (before fill), `defaulted` (balance unpaid in 48 h, deposit forfeited to cover shortfall). Transitions are RPCs that write `status_history`, ledger entries and outbox events.

### 18.3 Data model

- `pools` (id, code `POOL-####`, product\_id, variant\_id, starter\_user\_id, target\_qty, filled\_qty, deadline\_at, status, pool\_price\_minor, currency, qc\_included, terms\_version\_id)
- `pool_pledges` (id, pool\_id, buyer\_user\_id, qty, deposit\_minor, balance\_minor, address\_id, status, joined\_at, confirmed\_at)
- `pool_events` (append-only timeline for the detail page)
- Views: `pool_public_view` (buyer codes + countries only), `pool_pledge_mine_view`.

When a pool fills, `settle_pool(pool_id)` RPC: creates one PI per pledge at the final pool price, consumes the deposit, moves pledge to `confirmed`, creates one supplier PO for the aggregate, posts ledger entries, writes outbox events (`pool.filled`, `pi.created×N`, `po.created`). If deadline passes under target, `expire_pool` refunds every deposit to the buyer's wallet.

### 18.4 UI

- **Home page** `docs/design/Main.png`: new section "MOQ too big? Pool with other buyers" with 4 open-pool cards (name, progress bar, filled/need, closes-in, per-piece price, saving) and a "See all open pools" link to `/pools`.
- **Pools listing** `docs/design/Pools.png` + `html/Pools.html` at route `/pools`: dedicated page with hero (headline + saving stats), filters (category, closes-in, fill status, supplier country, minimum pledge), sort (closing soonest, highest saving, most filled, newest, buyers joined), grid/list toggle, pool cards with photo, status badge, progress bar, filled/target, buyers joined, pool price, saving, countdown, Join button, and a 4-step How-it-works explainer. The page is linked from the main nav, the home page section, the storefront footer and the product-detail pool card.
- **Product detail** `docs/design/Product.png`: card after the quote CTA. If a pool is open, shows progress + "Join this pool"; else "Start a pool".
- **Pool detail** `docs/design/Pool.png` route `/pool/[code]`: hero, progress with tier markers, participants, how it works, join form (pledge, address, deposit, pay from wallet or card), pool starter card, safeguards.
- **Customer portal** `/account/pools`: My pledges with status, deposit paid, balance due, countdown; reuse CustomerOrders table.
- **Admin** `/admin/pools`: list all pools with status, filled %, deposit held; actions cancel, extend deadline, force-settle; a global "Group buy" ON/OFF switch and the rules in §18.1 as settings.

### 18.5 Antigravity prompt

Run after P4 (quote → PI → order) and P5 (wallet) are built.

**Prompt 18-A — Group buying (MOQ pools)**

```
Read docs/SPEC.md sections 4, 5, 6, 10 and 18. Build group buying (MOQ pools):
1. Migrations: pools, pool_pledges, pool_events; status enums; add `pool_id` to proforma_invoices and orders; add `pool_minimum_pledge` to products; create pool_public_view (buyer_code + country only) and pool_pledge_mine_view with RLS. Add site_settings pool_enabled, pool_deposit_pct (default 10), pool_min_pledge_default (100), pool_max_buyers (25), pool_min_days (3), pool_max_days (30), pool_default_days (7). Admin-only toggles.
2. Postgres functions and transitions: open_pool(product_id, target_qty, deadline, min_pledge, address_id), join_pool(pool_id, qty, address_id, pay_source), withdraw_pledge(pledge_id), settle_pool(pool_id) that is called by cron when filled_qty >= target_qty — creates one PI per pledge at the final pool price (uses section 15 currency), consumes the escrow deposit, creates one aggregate PO to the supplier with status confirmed-after-balance-paid, posts double-entry ledger entries, writes outbox events pool.filled, pi.created×N, po.created, with 48h balance timer; expire_pool refunds every deposit. All inside one transaction, idempotent.
3. Cron: pool-close-watcher every 5 minutes to call settle_pool or expire_pool; pool-balance-reminder at T+24h and T+36h.
4. Build /pool/[code] matching docs/design/Pool.png and html/Pool.html — hero, progress bar with tier markers, participants table from pool_public_view (codes + country only), How it works, join form with Zod validation, ConfirmCharge dialog for the deposit.
5. Build /pools matching docs/design/Pools.png and html/Pools.html — dedicated listing of all open pools with hero stats (open-pool count, deposit %, max buyers, typical deadline, max saving), left-side filters (category, closes-in, fill status, supplier country, minimum pledge), sort control (closing soonest, highest saving, most filled, newest, buyers joined), server-paginated grid cards with photo, category chip, status badge (hot/warm/cool), progress bar, filled/target, buyers joined, pool price, saving, countdown, Join button. Add a "How group buying works" explainer section with the 4 steps. Add /pools to the main nav and storefront footer.
6. Edit /p/[slug] (docs/design/Product.png) to add the "MOQ too big? Join a group buy" card after the Request quote CTA, showing the top open pool if any, else a "Start a pool" button.
7. Edit / (docs/design/Main.png) to add the "MOQ too big? Pool with other buyers" section with 4 open-pool cards and a link to /pools.
8. Build /account/pools (My pledges) listing status, countdowns and "Pay balance" when due; include in the Customer sidebar.
9. Build /admin/pools with the ON/OFF switch, rule settings, pool list with filters, and admin actions (cancel with refund, extend deadline, force-settle, manually mark defaulted).
10. Add Group Buy Terms as a new CMS terms section (versioned, acceptance recorded on every pledge). Supplier anonymity holds: supplier sees the aggregate PO only; the pool detail page shows other buyers only by code and country.
11. SEO: /pools gets its own metadata and a `CollectionPage` JSON-LD; each /pool/[code] gets `Product` + `Offer` JSON-LD. Both are server-rendered with ISR and `revalidateTag('pools')` on any pool change.
Tests: pgTAP that two pledges in a currency-mismatched pool are rejected, that settle_pool is idempotent, and that a defaulted buyer's deposit is applied to shortfall before refund to remaining buyers. Playwright golden path: user A opens a pool, users B and C join from /pools after filtering by category, the pool fills, all three receive PI emails, pay balances, one aggregate PO goes to the supplier and three separate shipments go out.
```

Done when: a pool opens from `/p/[slug]`, three users from different countries join, the pool fills, each user receives a PI at the lower tier price, balances are paid, and the supplier side shows one PO with the aggregate quantity but no customer identities.
