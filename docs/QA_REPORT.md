# Octopus B2B — Website Audit Report

*Source: Claude Cowork audit, Nov 6 2026 · signed in as Demo Admin · 1126×797 desktop plus 390 px mobile check on 6 pages · **read-only**: nothing was clicked, saved or confirmed.*

## Scope and summary

`hostoctopus.com` is functionally sound — all 26 admin routes load — but it is not launch-ready: there are no backups, a pending top-up can be credited twice, and the storefront promises services that are not yet connected.

- **Covered:** storefront home (`/`), Back office (9 pages: Queues, KYC, Moderation, RFQs, Service requests, Orders, Shipping, Support desk, Assistant queue) and Admin (17 pages: Overview, Customers, Finance, Wallets, Currency, Services, Group buying, Categories, Site content, Advertising, Geography, Suppliers, Staff, Assistant, Integrations, Backup & restore).
- **Not covered:** keyboard focus order, customer and supplier portals beyond the home page, checkout flow, email content.

| Severity | Count |
| --- | --- |
| Critical | 6 |
| Major | 9 |
| Configuration needed | 9 |
| Accessibility, copy and polish | 12 |

---

## Critical findings

*These six can lose money or data, or misrepresent the business to buyers; fix them before taking real customers.*

| # | Page | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| **C1** | Backup & restore | No backup has ever completed and point-in-time recovery is off. | "Last backup: None yet", "0 backups", "Supabase PITR add-on not enabled". Integrations log: `backups out 500 backup missing: no successful backup in 26 h` on 03 Nov and 05 Nov. | Finish the backup workflow and storage target, run "Back up now", enable PITR, do one restore drill. |
| **C2** | Wallets, Finance | The same bank top-up is pending twice and both can be confirmed, crediting US$ 1,000 for one US$ 500 transfer. | Two rows: 01 Nov 03:37, SOUTHFIELD BIOCHEM, ref `OCT-32E10092`, +US$ 500.00, each with its own Confirm button. The ref equals the customer ID (`32e10092`), so every transfer from that customer shares it. | Make top-up creation idempotent; give each top-up a unique reference; block confirming a second row with the same ref and amount. |
| **C3** | Wallets | Customers who have not started KYC get US$ 1,000 credit, and one already used it. | "Only KYC-verified customers get the default" is unticked. Sanford and both SOUTHFIELD accounts: KYC "Not started", limit US$ 1,000.00. One SOUTHFIELD wallet is at −US$ 30.00 after a group-buy deposit (JRN-000686). | Tick the KYC-only box (settings change), or set default credit to 0 until KYC is verified. |
| **C4** | Customers | SOUTHFIELD BIOCHEM PVT LTD exists as two customers that look identical in every dropdown. | BUYER-1083 and BUYER-1071, both in IN, both CHALISSERY, both 01 Nov 2026. Finance and Wallet dropdowns list the name twice with nothing to tell them apart. | Merge the accounts; show buyer code in dropdowns; block duplicate company registration numbers. |
| **C5** | Storefront home | The home page promises partners and services that are not connected. | "POWERED BY YUNEXPRESS · OFFICIAL LOGISTICS PARTNER" — YunExpress shows "Not configured", Sandbox. "carrier updates pushed to your buyer's email" — Transactional email "Not configured". "Connects to Shopify, Amazon, WooCommerce" and warehouses in "US, EU, UK, GCC and South-East Asia" — Dropship "Not configured". "Up to 50% saved with bulk tiers" — the 4 featured products save 25.6–26.3%. | Remove or soften each claim until the integration is live and any partner agreement is signed. |
| **C6** | Staff & roles | Two-factor sign-in is not enforced for staff who handle money. | Finance, Operations, QC, Support and Content editor show 2FA "Not set up" while Active, though the invite text says "Two-step verification is set up at first sign-in". Operations has 31 open sessions, Finance 14. | Force 2FA setup at next sign-in for every role; end stale sessions. |

---

## Major findings

*These nine don't stop work, but they give wrong numbers, miss customers or make the product look unfinished.*

| # | Page | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| **M1** | Storefront home | Featured products show placeholder boxes instead of photos. | 5 elements read "Photo" or "Product photo"; only 2 real images on the page (both logos). | Upload product images; hide the card image slot when none exists. |
| **M2** | Overview, Finance | A US$ 30 pool forfeit is reported as order revenue, so Overview totals disagree. | Overview: GMV US$ 1,400.00 vs "Revenue by stream → Orders US$ 1,430.00". Finance (Nov): "Orders US$ 30.00, Pool forfeit US$ 0.00", but journal JRN-000690 is tagged `pool_forfeit`, US$ 30.00. | Map the `pool_forfeit` stream to its own revenue line; recheck the Overview query. |
| **M3** | Support desk | A high-priority complaint has waited 114 hours with no owner. | TKT-1001 "Carton damaged on arrival", High, "Overdue 114 h · assigned —", status New. | Assign it now; auto-assign new tickets by team; alert when a High ticket passes its SLA. |
| **M4** | Integrations, Overview | Users are being locked out of their accounts. | Log: `email out 200 auth.lockout` at 15:02, 15:42 and 15:45 on 05 Nov. Overview audit log: "Alex Buyer · sign in" 5 times between 22:41 and 22:43. | Check the lockout threshold and the sign-in flow; log only failed attempts, not repeats. |
| **M5** | Integrations | System emails are only simulated, so customers receive nothing. | Transactional email: "Not configured", Sandbox. The log still shows lockout, `pool.balance_reminder` and ad-hoc emails as 200. | Connect a live email provider before launch; flag sandbox sends in the log. |
| **M6** | Advertising | Ad impressions are not being counted. | "Impressions 0" next to "Paid clicks 3" for the House ad on home_banner. A QA campaign ("QA test — please ignore") is also listed. | Fix the impression tracker; end and hide the QA campaign. |
| **M7** | Suppliers | One live supplier has inconsistent master data. | "aviora" (lowercase), country CN, city "Kozikode" (Kozhikode is in India), contact on a personal Gmail address, "1 live / 2". | Correct the name, country and city; require a company email before going live. |
| **M8** | Wallets & payments | The "Wallet system" heading cannot be seen. | Text rgb(17,19,60) on background rgb(17,19,60): contrast 1:1 (WCAG 1.4.3 needs 4.5:1). | Make the banner heading white. |
| **M9** | All dashboards | Demo data is mixed into the live figures. | All GMV comes from "Ningbo Hengda Fastener Co. (demo)"; 6 of 7 suppliers end in "(demo)"; 8 staff accounts on `@demo.octopusb2b.com`; top-up `DEMO-TOPUP-1` is credited. | Remove the seed data, or flag it and leave it out of reports, before launch. |

---

## Configuration needed before launch

*Most of this is settings, not code: 6 of the 8 integrations are not configured, and a few business rules are still on defaults.*

| # | Area | Current state | What to decide or set |
| --- | --- | --- | --- |
| **K1** | Payments | Payment partner (Stripe / Airwallex): "Not configured". Only manual bank transfer, card and PayPal recording. | Connect a gateway, or state on the storefront that payment is by bank transfer only. |
| **K2** | Shipping | YunExpress "Not configured", Sandbox; the Shipping page shows "Simulate event" buttons. | Add live credentials, switch to Live, hide the simulate buttons outside Sandbox. |
| **K3** | Product sources and dropship | 1688, Alibaba.com and Octopus Dropship all "Not configured", mode Off. | Set up the ones you will use; turn off related storefront promises for the rest. |
| **K4** | API partner | Postman API Network: "Never synced", no monitor. | Add the workspace and collection IDs, or hide this card until needed. |
| **K5** | Currency | Approved rate 7.1 CNY/USD since 30 Oct; reference rate "daily job not run yet". All CNY service prices are "CONVERTED". | Schedule the reference-rate job; set explicit CNY prices if you sell in CNY. |
| **K6** | Account managers | Team–country map has only the Default team; 3 of 4 customers are "Unassigned". | Map India and the Netherlands to teams so new customers get an account manager. |
| **K7** | Supplier portal | Master switch OFF; all 7 suppliers "Portal login Off". | Decide whether suppliers manage their own listings at launch. |
| **K8** | Service prices | 3PL and Dropship are US$ 0.00 ("Free · quoted later"). | Per spec these are free quote; show "Quoted" instead of US$ 0.00 in the wallet price list. |
| **K9** | Categories | "kitchen utensils" and "plastics" are lowercase; "plastics" has 0 products; Fasteners has no default HS code; Fasteners shows 10 products but its subcategories add up to 9. | Fix casing, hide empty categories, add HS codes, check the one uncategorised fastener. |

---

## Accessibility, copy and polish

*These are small, quick fixes that make the admin feel finished and cut down on data-entry mistakes.*

| # | Where | Issue | Fix |
| --- | --- | --- | --- |
| **P1** | Wallets → Platform settings | "Finance approval limit (cents)" is set to 100000. Two extra or missing zeros change it 100-fold. | Accept dollars and convert. |
| **P2** | Wallets → Credit facility | Both Credit limit fields accept any text, while Platform settings fields only accept numbers. | Use a number field with min 0. |
| **P3** | Overview | "1 orders", "Rfq fees", "Qc", and "Sept" next to Jun/Jul/Aug. | "1 order", "RFQ fees", "QC", "Sep". |
| **P4** | Wallets, Overview | Amounts break across two lines ("US$ / 260.10", "+US$ / 500.00"). | Add `white-space: nowrap` to money values. |
| **P5** | Assistant | "US$0.0006" has no space; elsewhere it is "US$ 0.90". | Use one shared currency formatter. |
| **P6** | RFQs, Support desk | Tabs and statuses are lowercase ("open", "to quote", "waiting customer"); KYC tabs use capitals ("To review"). | Use sentence case everywhere. |
| **P7** | Customers vs Geography | KYC states are named differently: "In review / Submitted / More info" vs "Pending review". | Use one set of KYC state names. |
| **P8** | Assistant vs Assistant queue | "Escalate after 3 bot turns" vs "Conversations with 2+ low-confidence bot turns". | Read both labels from the same setting. |
| **P9** | Overview | "Open queue →", "Support desk →", "Manage →", "Finance & revenue →" are 17–20 px tall (WCAG 2.5.8 needs 24 px). | Add vertical padding. |
| **P10** | All admin pages | Two `<main>` landmarks: the hidden workspace picker stays mounted at 0×0 px. | Unmount it after a workspace is chosen. |
| **P11** | Overview, Integrations | Logs show raw IDs and JSON ("Auth · sign in — b0233250-…", `{"kind":"assistant.daily_metrics",…}`). | Show readable summaries and hide IDs behind a details toggle. |
| **P12** | Overview | First load: server response 1,732 ms, page ready 4,878 ms. Later loads took 190–470 ms. | Cache the dashboard queries or load the charts after the page appears. (Re-measure on Vercel preview in production mode; cold-start Next dev is always slow.) |

---

## What works well

*The foundations are strong. Keep these as they are:*

- **Routes:** all 26 sidebar destinations return 200 OK in 190–470 ms; no dead links.
- **Ledger integrity:** "USD · Balanced ✓ Debits US$ 4,169.90 · Credits US$ 4,169.90 · 15 journals · 0 unbalanced"; wallet total US$ 260.10 matches the sum of balances.
- **Controls:** maker–checker on refunds, Admin approval above US$ 1,000, a 2FA re-check on sensitive actions, KYC document links that expire after 60 s with every view logged, and versioned legal pages that need Admin approval to publish.
- **Accessibility basics:** all 59 controls on Overview have accessible names; switches use `role=switch` with `aria-checked`; headings run cleanly H1 → H2; apart from M8, no contrast failures among 196 text elements.
- **Mobile:** no horizontal page overflow at 390 px on the 6 pages tested.
- **Explanatory copy:** clear and honest, e.g. "Wallet top-ups are customer money, not revenue" and the per-page purpose lines.

---

## Where to start

*This list is ordered by impact vs effort. The first five are settings changes or single-record fixes you can do today.*

- [ ] Tick "Only KYC-verified customers get the default" (C3) — one click.
- [ ] Resolve the duplicate SOUTHFIELD top-up: confirm only one of them (C2).
- [ ] Assign and answer TKT-1001 (M3).
- [ ] Make the "Wallet system" heading white (M8).
- [ ] Fix the copy: "1 order", "RFQ", "QC", "Sep", category casing (P3, K9).
- [ ] Get backups running, enable point-in-time recovery, do one restore drill (C1).
- [ ] Force 2FA for all staff roles and end stale sessions (C6).
- [ ] Edit the home page claims to match what is live (C5).
- [ ] Merge the duplicate SOUTHFIELD customers and show buyer codes in dropdowns (C4).
- [ ] Make top-ups idempotent with a unique reference per transfer (C2).
- [ ] Connect live email, then payments and YunExpress (M5, K1, K2).
- [ ] Map the pool forfeit to its own revenue line (M2).
- [ ] Fix ad impression tracking and remove the QA campaign (M6).
- [ ] Investigate the account lockouts (M4).
- [ ] Add product photos, then remove demo data before launch (M1, M9).
- [ ] Polish items P1–P12.

---

*Audit source document: `Octopus_B2B___Website_Audit_Report.pdf`, read-only.*
