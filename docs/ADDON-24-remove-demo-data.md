# Add-on: remove demo data; prepare the database for real data

> **Owner decisions (6 Nov 2026):** keep `admin@demo.octopusb2b.com` until a real admin exists (the other 7 demo staff + the demo buyer go); keep the real customer signups and merge the two "SOUTHFIELD BIOCHEM PVT LTD" companies; delete supplier OCT-1131 "aviora" and its 2 products; keep the category tree (only hand-typed lowercase names are capitalised). The paused "QA-TRACE campaign" left by the trace suite is removed too. Implementation: migrations 149–151, `pnpm db:backup`, `pnpm db:wipe-demo`, test `supabase/tests/demo-wipe.test.mjs`.

## Why

The audit (M9, C4, M7) shows demo rows mixed into every live figure: "Ningbo Hengda Fastener Co. (demo)", 8 staff on `@demo.octopusb2b.com`, top-up `DEMO-TOPUP-1`, two SOUTHFIELD duplicate customers, one supplier with lowercase name and a personal Gmail address. We're ready to enter real suppliers, real products and real staff.

## Antigravity prompt 24-A — delete the demo dataset and lock the seed out of production

```
Read docs/SPEC.md sections 6, 11, 12, and the audit findings M9, C4, M7, K7, K9. The app is going from demo to real data. Delete every row Octopus seeded for demo use, make sure the seeder cannot run in production, and leave an empty, verifiable dataset the owner can fill from the admin screens.

1. Tag the seed. Audit every row inserted by supabase/seed.sql and the TypeScript seed files. Add a column `is_seed boolean not null default false` to these tables (if not already present): organizations, suppliers, products, categories, tags, orders, proforma_invoices, service_requests, wallets, wallet_transactions, payments, ledger_entries, support_tickets, pools, pool_pledges, ad_campaigns, assistant_sessions, assistant_messages, backups. Set is_seed=true on every row the seed inserted. Back-fill from the seed files; never guess.

2. Build a one-command cleanup. Add supabase/migrations/<timestamp>_wipe_seed.sql and a wrapper script `pnpm db:wipe-demo` that:
   a. Refuses to run unless `NODE_ENV=production`-vs-staging check passes and the operator confirms with the exact string `DELETE DEMO DATA FOR <project-ref>`.
   b. In one transaction, deletes rows where `is_seed=true` in the correct dependency order (pledges before pools, entries before journals, items before orders, messages before sessions, etc.).
   c. Resets every sequence that drives a human code (OCT-, RFQ-, QT-, PI-, ORD-, SHP-, TKT-, POOL-, EX-, BK-, RS-) so the next real record starts at 1001.
   d. Verifies: `select count(*) from <each table> where is_seed=true` returns 0; `select sum(amount_minor) from ledger_entries` = 0; every wallet balance = 0; no open pools, no open escalations.
   e. Writes an audit_log entry "demo_data_wiped" with the operator's user id, counts per table and timestamp.

3. Lock the seed out of production. In seed.sql and every seed TS file, add a top-of-file guard that raises if `current_setting('app.environment', true)` is 'production'. Remove any `supabase db reset` call from CI that could re-seed production. In Supabase dashboard, confirm migrations run in `prod`, seed does not.

4. Staff cleanup. Remove the 8 `@demo.octopusb2b.com` users and their roles. Keep only the real staff admin created the owner knows. End every active session for the removed users.

5. Settings and defaults flipped for a real launch:
   - site_settings `wallet.default_credit_minor` = 0 (fixes audit C3).
   - site_settings `wallet.default_credit_requires_kyc` = true.
   - site_settings `pool.enabled` = true but with the demo pools gone.
   - site_settings `supplier_portal_enabled` = false (per K7 until decided).
   - Categories: remove any seeded category with 0 products; fix casing to Title Case ("Kitchen utensils", "Plastics").

6. Owner-facing admin flow. On /admin, add a one-time banner: "Demo data cleared on <date> by <admin>. Add your first supplier to get started." with a "Create first supplier" button to /admin/suppliers/new. Hide the banner once the suppliers table has at least one is_seed=false row.

7. Guardrail on every dashboard. Any query that reports GMV, revenue, ledger totals, pool activity or counts filters rows with `where is_seed = false` as a WHERE clause, not as a client-side filter. Add a pgTAP test that the Overview query returns zero on a fresh wipe.

8. Tests:
   - pgTAP: db:wipe-demo deletes every is_seed=true row and nothing else; refuses without the confirmation string.
   - Playwright: after wipe, /admin shows the empty-state banner, Overview numbers all read 0, Customers list is empty, Suppliers list is empty, Products list is empty.
   - Playwright: admin can create a first supplier manually, upload one product, and the storefront reflects it within one revalidate.

9. Rollback plan: before running db:wipe-demo for real, run `pnpm db:backup` (per SPEC §16) so the demo state can be restored to a scratch project if anything in the audit was mislabeled.

Done when: Overview, Finance, Customers, Suppliers, Products, Pools, Support and Assistant all read empty; no `@demo.octopusb2b.com` user exists; the first real supplier the owner creates appears correctly on the storefront; the seed cannot run in production.
```

Before you run it, **take a backup** (`pnpm db:backup` per SPEC §16 or Supabase dashboard → PITR) so the demo state can be restored if we flagged something by mistake.
