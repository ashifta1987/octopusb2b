# Octopus B2B – Master Build Spec

Version: 1 Nov 2026 (rev. 4, adds sections 15–17) · Owner: Shenzhen Octopus Trading Co. Ltd.

## 0. How to use this with Antigravity

Keep this document in the code repository as the single source of truth, then build in 11 phases (section 13), one Antigravity prompt per phase. One giant prompt makes agents cut corners; phases with a spec file do not.

1. Export this doc as Markdown and save it as `docs/SPEC.md` in a new, empty Git repository.
2. The design screens are already in `docs/design/` (one PNG per screen, static HTML in `docs/design/html/`, index in `docs/design/README.md`) (design reference: [B2B Marketplace UI canvas](https://claude.ai/artifact/2T29FAYzuDhhecwknxPS3W)).
3. Open the repository folder in Antigravity and use **Planning mode**.
4. Paste the **Phase 0** prompt from section 13. Review the plan Antigravity proposes, then approve it.
5. When a phase is done: run its checks, commit, and let Vercel build a preview. Then paste the next phase.
6. To change a feature later: edit `docs/SPEC.md` first, then ask Antigravity to apply that change.

Rules every phase follows:

- `docs/SPEC.md` wins over anything else, including earlier chat with the agent.
- No prices, fees, texts, contact details or legal wording in code. They live in the database and admin screens.
- Every permission is enforced in the database (Row Level Security) and in server code, never only by hiding buttons.
- Every integration sits behind an adapter so the provider can change without touching business logic.
- Every money movement is a ledger entry written in one database transaction, with an idempotency key.

## 1. Product overview and scope

Octopus B2B is a global wholesale marketplace for industrial supplies, priced in USD by default (admin can switch the whole platform to Chinese yuan, CNY: section 15), where Octopus is the seller on every order. Under the Terms and Conditions the buyer contracts with Shenzhen Octopus Trading Co. Ltd., not with the factory, so invoices, payments and claims all run through Octopus.

**Launch mode:** the supplier self-service portal is switched off. Distributors (Octopus staff or trusted partners) manage suppliers, create and upload products, and answer RFQs for them. The supplier portal is built now and opened later with one admin switch.

**Revenue streams**

| Stream | How it is charged |
| --- | --- |
| Order margin / commission | Difference between supplier cost and buyer price, or a commission % per category |
| Service fees | RFQ fee, sample handling, QC inspection, certification, any new service; set in Services & charges |
| Advertising | Pay per valid click, deducted from the advertiser's wallet |
| Fulfilment | Margin on 3PL and Octopus Dropship orders |

**Company details** (seed data; editable in Site content › Company & branches)

| Field | Value |
| --- | --- |
| Legal entity | Shenzhen Octopus Trading Co. Ltd. |
| Head office | Building 4, West 10th Floor, C103, SEG Science Park, 3012 Huaqiang North Road, Li Village Community, Huaqiang North Street, Futian District, Shenzhen, Guangdong, China |
| Address (Chinese) | 广东省深圳市福田区华强北街道荔村社区华强北路3012号赛格科技园4栋西10层C座C103 |
| Contact person | Shameer Abdul Vahab |
| Phone / WhatsApp | +86 188 2652 7644 |
| Support email | support@octopusb2b.com |
| Website | octopusb2b.com |
| Brand | Octopus B2B, "Global Sourcing, Simplified"; navy #11133C, blue #2A6FD6 (logo blue #337BE1), Lexend + Inter + IBM Plex Mono |

**In version 1:** storefront, sign-up with Google or email, customer KYC, RFQ to order, proforma and commercial invoices, ledger, wallet, services (sample, QC, certification, 3PL request, dropship request), YunExpress shipping and tracking, back office, finance and approvals, distributor panel, categories and tags, product creation with AI tools, Excel bulk upload, CMS with Terms versions and branches, advertising, support desk, public API with Postman collection, all admin settings.

**Built but switched off at launch:** supplier self-service portal, supplier API logins.

**Later phases:** Octopus Dropship live connection, 1688 and Alibaba.com product import, Shopify and Wix apps, marketplace channels, more carriers, Chinese and Arabic languages.

## 2. Tech stack and architecture

One Next.js (React, TypeScript) app on Vercel serves the storefront and every portal; Supabase is the database, auth, storage, realtime and background worker. Next.js is used instead of plain Vite because public product pages must be server-rendered for Google; it is still React.

| Layer | Choice | Used for |
| --- | --- | --- |
| Front end | Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form + Zod, TanStack Table | All pages; server components for public pages, client components for portals |
| Hosting | Vercel (production + preview per pull request), Vercel Cron for light schedules | App, API routes, image optimisation, edge caching |
| Database | Supabase Postgres with Row Level Security, SQL migrations via Supabase CLI | All data, permissions, money ledger |
| Auth | Supabase Auth: Google OAuth, email + password with 6-digit OTP, staff two-factor | All roles |
| Files | Supabase Storage: public bucket (product media), private buckets (KYC, certificates, invoices, tickets) with signed URLs | Photos, PDFs, uploads |
| Server logic | Next.js Route Handlers and Server Actions (user-facing), Supabase Edge Functions (webhooks, integrations, AI, jobs), Postgres functions (money, state changes) | Business rules |
| Background | Supabase Cron (pg\_cron) + Supabase Queues (pgmq) + an outbox table | Events, retries, schedules |
| Realtime | Supabase Realtime | Live quotes, tracking, tickets, approvals |
| Documents | Server-side PDF generation (e.g. @react-pdf/renderer), stored in Storage | Invoices, statements, POs, receipts |
| Email | Transactional email provider on octopusb2b.com (decision open) | Notifications, documents |
| Monitoring | Sentry, Vercel Analytics, Supabase logs, uptime checks | Errors, speed, availability |
| Tests | Vitest, pgTAP for RLS, Playwright end-to-end | Quality gates in CI |

Code layout (monorepo is not needed):

```text
app/(store)/…        public storefront, SEO pages
app/(auth)/…         sign up, log in, onboarding
app/account/…        customer portal
app/distributor/…    distributor panel
app/supplier/…       supplier portal (off at launch)
app/office/…         back office
app/admin/…          admin
app/api/v1/…         public REST API
lib/adapters/…       carrier, payment, bank, email, ai, dropship, source adapters
lib/domain/…         state machines, pricing, permissions
supabase/migrations  schema, RLS, functions
supabase/functions   edge functions (webhooks, workers, ai)
docs/SPEC.md         this document
```

![System architecture](design/diagrams/architecture.png)

```mermaid
flowchart TB
  subgraph Clients
    SF[Storefront] ; PO[Portals: customer, distributor, supplier] ; BO[Back office and admin] ; API[API clients: Shopify, Wix, Postman]
  end
  subgraph Vercel["Vercel - Next.js App Router"]
    RSC[Server Components: reads with RLS, ISR] ; SA[Server Actions: Zod-validated writes] ; RH[Route handlers: /api/v1 and /api/supplier/v1]
  end
  subgraph Supabase
    AUTH[Auth: Google, email OTP, staff 2FA] ; PG[(Postgres: RLS, RPC, ledger, outbox)] ; ST[Storage] ; RT[Realtime]
    EF[Edge Functions + pgmq workers: email, PDF, notify, carrier, dropship, AI, webhooks]
  end
  subgraph Partners["Partners via adapters"]
    YUN[YunExpress] ; PAY[Payment and bank] ; MAIL[Email, WhatsApp] ; DROP[Octopus Dropship] ; AI[AI image and text] ; SRC[1688 / Alibaba later]
  end
  Clients --> Vercel --> Supabase
  PG -- outbox events --> EF
  EF -- calls through adapters --> Partners
  Partners -- webhooks in --> EF
```

Browsers and API clients reach Next.js on Vercel. Every money or status change runs as one Postgres transaction, and partners are called only by Edge Function workers through adapters.

## 3. Roles and permissions

Permissions are data: each role has a matrix of areas × actions (view, create, edit, delete, approve, export) that Admin edits in Staff & roles, enforced by RLS and server checks.

| Role | Who | Can | Never |
| --- | --- | --- | --- |
| Visitor | Anyone | Browse catalogue, see indicative prices, read pages | RFQ, order, tier prices beyond the first, documents |
| Customer | Buyer company user | Profile + KYC, RFQs, quotes, orders, services, wallet, ledger, support, API keys (live after KYC) | See supplier names, cities, contacts or costs |
| Distributor | Octopus staff or partner | Manage assigned suppliers and their on/off switches, categories and tags, create and bulk-upload products, AI tools, answer RFQs on behalf | See suppliers not assigned to them, finance, customer KYC documents |
| Supplier | Factory or wholesaler (portal off at launch) | Own products, RFQ replies, POs, labels, payouts, customers who ordered from them (contacts after payment), ads | See other suppliers, Octopus margins |
| Operations | Back office | Supplier and customer KYC review, product moderation, request matching, orders and logistics, shipments | Approve money |
| Finance | Back office | Payments, matching, refunds ≤ limit, payouts preparation, statements, reconciliation | Approve their own requests |
| Support | Back office | Support desk, replies, resolutions up to credit note request | Change prices or approve money |
| Sourcing agent | Back office | RFQs, sourcing requests, AI tools | Finance, staff |
| QC coordinator | Back office | Samples, QC inspections, certifications, certificate checks | Finance, staff |
| Content editor | Back office | Pages, templates, Terms drafts, branches | Publish legal pages, products, finance, customer data |
| Admin | Owner | Everything, including master switches, approvals over limits, staff and roles | — |
| Advertiser | Supplier or partner | Campaigns, budgets, ad stats | Anything else |
| API client | Customer's app or platform | Scoped endpoints with OAuth client credentials | Endpoints outside its scopes |

Permission areas: Dashboard & reports, Customers & KYC, Suppliers & verification, Products & moderation, Categories & tags, RFQs & service requests, Orders & logistics, Samples/QC/certification, Wallet & payments, Finance & approvals, Services & charges, Advertising, Integrations & API, Site content, Support desk, Staff & roles, AI product tools, Audit log.

Visibility rules that cross roles:

- Buyers see suppliers only as code + country + verified badge (e.g. "Supplier OCT-1101 · CN").
- Suppliers see buyers by city and country at RFQ stage; full contact details only after the order is paid (admin setting).
- Back office, finance and admin see everything they have a permission for; every view of KYC documents or customer contacts is logged.

## 4. User flows

Each flow names the screens (canvas artboards) it passes through. Build and test them as end-to-end journeys, not page by page.

### 4.1 Buyer: discover → order → deliver (golden path)

1. **Discover.** Home → mega-menu or "All categories" → Products page (50+ items, filters: category, price, MOQ, certifications, Octopus Dropship, ready to ship) → Product detail (tiers, key facts, services row, certificates, 12 recommended products).
2. **Sign up.** Any action (RFQ, sample, add to quote) opens Auth: Google or email OTP → Create profile (name, company, country, phone, business type) is required before anything else.
3. **KYC.** Customer → KYC: company registration, address, contact, ID document. Status: pending → verified. Live API keys and payouts to wallet unlock after verification; browsing and RFQs work before it.
4. **Request.** Request Center (sourcing/RFQ, 3PL, dropship, sample, QC, certification) or the product's service buttons. RFQ fee shown before submit and charged from the wallet (or card if the wallet is off).
5. **Quote.** Back office (or supplier later) sends quotes; customer compares in Orders → RFQ detail; realtime status updates.
6. **Approve.** Customer approves one quote → system creates a proforma invoice (PI, e.g. PI-2026-0998) → PDF + email to customer, finance and the assigned distributor.
7. **Deposit.** Customer pays the 30% deposit (bank transfer reference, card or wallet). Finance matches it → order status "Confirmed" → written confirmation emailed (T&C: contract formed on confirmation).
8. **Production & QC.** Supplier/distributor posts updates; optional QC inspection with a report attached; balance invoice issued before shipment.
9. **Ship.** Balance paid → Shipping creates a YunExpress order, label and tracking number.
10. **Track.** Customer Orders → live tracking timeline (webhook-driven, with a cron fallback); email/WhatsApp notifications at key events.
11. **Deliver & close.** Delivered → claim window starts (7 days visible defects, 30 days hidden defects per T&C) → feedback prompt → ledger shows the order fully settled.
12. **Claim (if needed).** Help & complaints → ticket with photos → Support desk → resolution (credit note, refund, replacement) → approval in Finance if money moves.

### 4.2 Buyer: services and wallet

1. Wallet → top up (bank transfer to virtual account, or card through the payment partner) → pending until confirmed → balance credited.
2. Choose a service (sample, QC, certification, 3PL, dropship, RFQ) → price from the Services & charges table → confirmation dialog showing the deduction → wallet debited in one transaction → service request created.
3. Ledger shows every debit and credit, running balance, downloadable statement (PDF/CSV) and an email copy.
4. If Admin turns the wallet off, the same services are paid by card/invoice and the Wallet page shows a notice.

### 4.3 Distributor

1. Log in → Distributor panel → list of assigned suppliers with switches (portal login, product upload, RFQ replies, listings live, AI tools).
2. Add a product: Create product (title, 4-level category, tags, tiers, specs, certificates, Octopus Dropship tag) → AI tools: enhance photo, make poster, fix SEO → Submit for moderation.
3. Or Bulk upload: download the Excel template → upload → row-by-row validation report → fix errors → import as drafts → submit.
4. Manage categories and tags (create, rename, merge, reorder up to 4 levels).
5. Answer RFQs on behalf of assigned suppliers; see the customer's city and country, and full contacts once the order is paid.

### 4.4 Supplier (when the portal opens)

1. Invite from distributor/admin → set password + 2FA → verification documents.
2. Products (own only, if "product upload" is on) → RFQ inbox → quote → PO received → production updates → print label → payouts.
3. Product import & API: connect a 1688/Alibaba source or push products through the supplier API.
4. Advertise: create a campaign → budget → pay per click from the wallet.

### 4.5 Back office

1. Office dashboard queues: KYC to review, products to moderate, RFQs to assign, service requests, shipments with exceptions, tickets near SLA.
2. Each queue item opens a detail page with actions that move its state (approve, reject with reason, assign, request info).
3. Shipping: create YunExpress orders from paid orders, price trial, print labels, watch exceptions.
4. Support desk: tickets by priority and SLA, macros, internal notes, link to order, escalate to finance.

### 4.6 Finance

1. Incoming payments → match to PI/top-up → confirm.
2. Approvals queue: refunds, credit notes, payouts, manual adjustments. Maker–checker: the requester cannot approve; amounts over the limit need Admin.
3. Revenue dashboard by stream (product margin, service fees, RFQ fees, ads, shipping margin) → export PDF/CSV and email.
4. Monthly: statements generated, reconciliation report, period close.

### 4.7 Admin

1. Overview KPIs → drill down into any panel.
2. Settings: services & charges (edit prices, add services), wallet on/off and price list, supplier portal on/off, contacts visibility rule.
3. Staff & roles: create users, assign roles, edit the permission matrix, force 2FA, deactivate.
4. Site content: pages, banners, T&C (15 sections) with drafts → review → publish/schedule → version history; company details and branches.
5. Integrations: YunExpress credentials and mode, Octopus Dropship, 1688/Alibaba sources, email, payment, webhooks.
6. Customer geography: map and table by country, KYC status, revenue.

### 4.8 Advertiser

1. Ads → new campaign → placement (home banner, category banner, product page side, search top) → target categories/countries → creative upload → daily budget and max CPC.
2. Moderation by back office → live → clicks charged from wallet per click (fraud filtered) → stats per day.
3. Budget exhausted → paused until the next day or top-up.

### 4.9 API client (Shopify, Wix, own systems, Postman)

1. Customer → API credentials → create app → test keys (oct\_test\_…) work in sandbox immediately; live keys (oct\_live\_…) after KYC.
2. Download the OpenAPI file and Postman collection → get a token with client credentials → call products, quotes, orders, tracking, wallet balance.
3. Register a webhook URL → receive signed events (order.updated, shipment.tracking, quote.created) → verify the HMAC signature.

## 5. Workflow design (state machines)

Every business object has a `status` column backed by a Postgres enum and a single transition function `transition_<object>(id, to_status, actor, reason)`. The function checks the allowed transition, the actor's permission and preconditions, writes a row to `status_history`, and inserts an outbox event (§10). The UI never updates `status` directly.

| Object | States (in order) | Who moves it | Side effects |
| --- | --- | --- | --- |
| RFQ | draft → submitted → assigned → quoting → quoted → accepted / expired / cancelled | Customer, sourcing agent, distributor | RFQ fee debited on submit; 48 h reminder; expiry after validity |
| Quote | draft → sent → viewed → approved / rejected / expired / superseded | Sourcing agent, distributor, supplier | Approve creates PI; validity 30 days (setting) |
| Proforma invoice / order | pi\_issued → deposit\_pending → deposit\_paid → confirmed → in\_production → qc → balance\_pending → balance\_paid → ready\_to\_ship → shipped → delivered → closed; cancelled / disputed branches | System, finance, operations | PDFs and emails at each money step; confirmation letter on confirmed; claim window opens on delivered |
| Payment | initiated → pending → matched → confirmed / failed / refunded | Payment partner webhook, finance | Ledger entries only on confirmed |
| Shipment | draft → priced → created → label\_ready → picked\_up → in\_transit → out\_for\_delivery → delivered; exception / returned | Shipping staff, YunExpress webhooks | Tracking events to customer timeline and notifications |
| Service request (sample, QC, certification, 3PL, dropship) | requested → paid → accepted → in\_progress → report\_ready → completed / rejected / refunded | Customer, QC coordinator, operations | Fee from Services & charges; refund on rejection |
| KYC | not\_started → submitted → in\_review → verified / rejected / more\_info | Customer, operations | Unlocks live API keys and wallet withdrawals |
| Product listing | draft → submitted → in\_review → live / rejected → paused / archived | Distributor, supplier, operations | Live only if supplier switch "listings live" is on; ISR revalidate on change |
| Certificate | uploaded → verified → expiring (30 days) → expired / rejected | Uploader, QC coordinator | Tag hidden on product when expired |
| Support ticket | new → open → waiting\_customer → waiting\_internal → resolved → closed; reopened | Customer, support | SLA timers; CSAT survey on resolved |
| Finance approval | requested → approved / rejected → executed | Maker, checker, admin over limit | Executes the ledger entry or payout |
| Payout (supplier) | scheduled → approved → sent → settled / failed | Finance | Bank adapter call; remittance PDF |
| Ad campaign | draft → in\_review → active → paused (budget/manual) → ended / rejected | Advertiser, back office | Daily budget reset; click charges |
| Wallet top-up | initiated → pending → credited / failed | Customer, payment partner, finance | Ledger credit |
| Wallet withdrawal | requested → approved → sent → completed / rejected | Customer, finance | Needs KYC verified; maker–checker |
| T&C / page version | draft → in\_review → scheduled → published → superseded | Content editor, admin | Published version id stored on every order |

Rules:

- Timers (quote validity, SLA, claim windows, certificate expiry) are columns like `expires_at` plus a scheduled job that moves expired items, never a client timer.
- Every money-moving transition calls the ledger function inside the same database transaction.
- Each order stores `terms_version_id` so disputes use the terms the buyer accepted.

The order lifecycle diagram below shows the golden path and the money checkpoints.

![Order lifecycle](design/diagrams/order-lifecycle.png)

```mermaid
stateDiagram-v2
  [*] --> quote_approved
  quote_approved --> pi_issued: PDF + email
  pi_issued --> deposit_paid: 30% deposit, finance matches
  deposit_paid --> confirmed: written confirmation
  confirmed --> in_production
  in_production --> qc: optional QC report
  qc --> balance_paid: balance before shipping
  balance_paid --> shipped: YunExpress label
  shipped --> delivered: claim window opens (7/30 days)
  delivered --> closed: after claim window
  pi_issued --> cancelled
  delivered --> disputed
  closed --> [*]
```

The cancelled and disputed branches leave this path from the order states in the table above. Every move runs through `transition_order()`.

## 6. Data model (Supabase Postgres)

Conventions: `uuid` primary keys, `created_at`/`updated_at`, `created_by`; money stored as `amount_minor` (`bigint`: cents for USD, fen for CNY) plus `currency` (`char(3)`), never a column named after one currency (section 15.1); human codes generated by sequences (OCT-1101, RFQ-0998, QT-0998-1, PI-2026-0998, ORD-…, SHP-…, TKT-…); soft delete with `archived_at`; RLS enabled on every table. Generate TypeScript types with `supabase gen types`.

| Group | Tables | Notes |
| --- | --- | --- |
| Identity & orgs | profiles, organizations, org\_members, roles, permissions, role\_permissions, staff\_assignments, kyc\_submissions, kyc\_documents, addresses | profiles.id = auth.users.id; profile row required before app access; KYC docs in private bucket |
| Suppliers | suppliers (code, country, legal name, contacts), supplier\_switches (portal\_login, product\_upload, rfq\_replies, listings\_live, ai\_tools), distributor\_suppliers, supplier\_verifications | `public_suppliers` view exposes only code, country, badge |
| Catalog | categories (parent\_id, level 1–4, slug, sort), tags, product\_tags, products, product\_variants, price\_tiers, product\_media, product\_specs, certificates, product\_certificates, product\_flags (octopus\_dropship, ready\_to\_ship), recommendations | Check constraint level ≤ 4; full-text search column + trigram index |
| Imports & AI | import\_jobs, import\_rows (row errors), source\_connections (1688, Alibaba), source\_products, ai\_jobs (photo\_enhance, poster, seo\_fix), ai\_outputs | Bulk upload and sync write here first, then to products |
| Trade | rfqs, rfq\_items, quotes, quote\_items, proforma\_invoices, orders, order\_items, order\_events, documents (type, number, pdf\_path, emailed\_at) | Approve quote → PI → order; documents table drives PDF download + email for every role |
| Services & fees | services (code, name, active), service\_prices (amount, unit, effective\_from), service\_requests, service\_reports | Admin edits prices; history kept by effective\_from |
| Logistics | carriers, carrier\_accounts, shipments, shipment\_parcels, tracking\_events, rate\_quotes | YunExpress is first carrier row |
| Money | ledger\_accounts, ledger\_entries (double-entry, journal\_id), journals, wallets, wallet\_transactions, payments, payment\_intents, bank\_accounts, virtual\_accounts, refunds, credit\_notes, payouts, finance\_approvals, fx\_rates | Balances computed from entries; no direct updates |
| Content | site\_settings (key/value, feature flags), pages, page\_sections, content\_blocks, content\_versions, terms\_versions (15 sections), company\_profile, branches, email\_templates, banners | Every text on the site comes from here |
| Integrations & API | integrations (type, mode sandbox/live, encrypted config), api\_clients, api\_keys (hashed), api\_scopes, webhook\_endpoints, webhook\_deliveries, idempotency\_keys, rate\_limits | Secrets in Supabase Vault |
| Support | tickets, ticket\_messages, ticket\_attachments, sla\_policies, feedback, csat\_responses | Linked to order/shipment/service |
| Advertising | ad\_campaigns, ad\_creatives, ad\_placements, ad\_impressions, ad\_clicks, ad\_charges, ad\_daily\_budgets | Click charge posts a ledger entry |
| System | outbox\_events, job\_runs, notifications, notification\_preferences, status\_history, audit\_log | Audit log is append-only |

Key RLS policies:

- Customers: `org_id in (select org_id from org_members where user_id = auth.uid())`.
- Distributors: suppliers and products where `supplier_id in distributor_suppliers for auth.uid()`.
- Suppliers: own rows; customer contacts only through the `supplier_customer_view`, which returns contacts when the order is paid and the admin setting allows it.
- Staff: `has_permission(auth.uid(), '<area>', '<action>')` security-definer function.
- Storefront: anonymous `select` only on live products, public categories, `public_suppliers` and published content.

## 7. Integration design

Every outside service sits behind an adapter interface in `packages/integrations`, so a new carrier, marketplace or dropship app is a new adapter plus an `integrations` row, with no changes to business code. Each adapter has a `sandbox` and `live` mode, reads its credentials from Supabase Vault, logs every call to `integration_logs`, and is called only from Edge Functions or queue workers, never from the browser.

```ts
interface CarrierAdapter {
  priceTrial(input: RateRequest): Promise<RateQuote[]>;
  createShipment(input: ShipmentRequest): Promise<ShipmentResult>; // tracking no.
  getLabel(shipmentId: string): Promise<Blob>;
  cancel(shipmentId: string): Promise<void>;
  subscribeTracking(trackingNo: string): Promise<void>;
  parseWebhook(req: Request): Promise<TrackingEvent[]>;
}
interface DropshipAdapter { pushProduct(p): Promise<string>; createOrder(o): Promise<string>; syncStock(ids): Promise<void>; parseWebhook(req): Promise<DropshipEvent[]>; }
interface SourceAdapter  { search(q): Promise<SourceProduct[]>; getProduct(id): Promise<SourceProduct>; syncPrices(ids): Promise<void>; }
interface ChannelAdapter { publish(p): Promise<string>; importOrders(since): Promise<ChannelOrder[]>; }
interface PaymentAdapter { createIntent(i): Promise<Intent>; refund(r): Promise<void>; parseWebhook(req): Promise<PaymentEvent[]>; }
interface BankAdapter    { createVirtualAccount(org): Promise<VA>; listIncoming(since): Promise<BankTxn[]>; sendPayout(p): Promise<PayoutResult>; }
```

| Integration | Adapter | Direction | Phase | Notes |
| --- | --- | --- | --- | --- |
| YunExpress | CarrierAdapter | Out + tracking webhook in | v1 (P6) | App ID/key, sandbox token; price trial, create order, labels, tracking subscription; hourly cron fallback |
| Other carriers (DHL, FedEx, 4PX, Cainiao) | CarrierAdapter | Out + in | Later | Same interface; carrier chosen by rules or cheapest price trial |
| Payment partner (e.g. Stripe, Airwallex) | PaymentAdapter | Out + webhook in | v1 (P5) | Cards, top-ups; the partner holds funds (licensing) |
| Bank / virtual accounts (e.g. Airwallex, Wise Business) | BankAdapter | In + out | v1 manual, API later | Manual matching first; API matching and payouts later |
| Transactional email (e.g. Resend, Postmark) | EmailAdapter | Out | v1 | Templates from CMS; PDF attachments; from support@octopusb2b.com |
| WhatsApp Business | MessageAdapter | Out | Later | Order and tracking notifications, opt-in |
| AI text & image | AiAdapter | Out | v1 (P2) | Photo enhance/background removal, poster generation, SEO title/description fix; usage metered per org |
| Octopus Dropship | DropshipAdapter | Out + webhook in | v1 tag, API later (P9) | "Request dropship" creates a service request now; push products and orders once its API exists |
| 1688 Open Platform | SourceAdapter | In | Later (P9) | Official AppKey only, respect rate limits; no scraping |
| Alibaba.com | SourceAdapter | In | Later | Official partner API only |
| Shopify, Wix, WooCommerce | ChannelAdapter / public API | In + out | Later | Apps built on the public API; customer installs and connects keys |
| Other marketplaces (Amazon, Noon, etc.) | ChannelAdapter | Out | Later | Same pattern |
| Google OAuth | Supabase Auth | In | v1 (P1) | Plus email OTP; staff require 2FA |
| Sentry / logging | — | Out | v1 | Frontend + Edge Functions |

### Public API (for customers, Shopify, Wix, Postman)

- Base URL `https://api.octopusb2b.com/v1`; versioned path; JSON; OpenAPI 3.1 file generated from Zod schemas and published with a Postman collection.
- Auth: OAuth 2 client credentials (`client_id` + `client_secret` → bearer token, 1 hour). Keys prefixed `oct_test_` (sandbox data) and `oct_live_` (after KYC). Secrets shown once, stored hashed.
- Scopes: `catalog:read`, `quotes:write`, `orders:read`, `orders:write`, `shipments:read`, `wallet:read`, `webhooks:manage`.
- Endpoints: products and categories (search, detail, tiers), RFQs and quotes, orders (create from quote, status), shipments and tracking, wallet balance and ledger, service requests, webhooks.
- `Idempotency-Key` header required on POST; rate limit per client (e.g. 60/min) with `429` and `Retry-After`; errors in RFC 7807 problem format.
- Webhooks: `order.updated`, `quote.created`, `shipment.tracking`, `service_request.updated`, `wallet.updated`; signed with HMAC-SHA256 header `Octopus-Signature: t=…,v1=…`; retries with backoff for 24 hours; delivery log and "resend" button in the Developer page.

### Supplier API

- Base URL `https://api.octopusb2b.com/supplier/v1`, same auth model, supplier scopes: `products:write`, `inventory:write`, `rfqs:read`, `quotes:write`, `orders:read`.
- Used for bulk product sync, stock and price updates, and quoting from the supplier's own ERP. Writes still pass moderation and the supplier switches.

## 8. UI implementation

The design screens are the visual source of truth: one PNG per screen in `docs/design/` (e.g. `docs/design/Product.png`) and the same screen as static HTML with all its CSS in `docs/design/html/` (e.g. `docs/design/html/Product.html`) for exact spacing, colours and copy. Phase prompts reference them by name.

### 8.1 Design tokens (Tailwind theme + CSS variables)

| Token | Value | Use |
| --- | --- | --- |
| `--navy` | #11133C | Header, sidebars, headings |
| `--blue` | #2A6FD6 | Primary buttons, links, focus ring |
| `--ink` / `--muted` | #1A1D2E / #5B6175 | Body and secondary text |
| `--line` / `--surface` | #E3E6EE / #F6F7FA | Borders, page background |
| Status | green #1F9D55, amber #D98A00, red #D64545 | Badges and alerts (always with a text label) |
| Fonts | Lexend (headings), Inter (body), IBM Plex Mono (codes, amounts, API keys) | `next/font` self-hosted |
| Radius / spacing | 6 px controls, 10 px cards; 4 px grid | shadcn/ui defaults adjusted |

### 8.2 Layouts

- **Storefront layout:** top bar (language, currency USD or CNY from settings, help), header with logo, search with category select, account and quote cart; mega-menu; footer from CMS (company details, branches, links). Ad slots are a reusable `<AdSlot placement="…" />` server component.
- **Portal layout** (customer, supplier, distributor, back office, admin): left sidebar with role-based nav from one config file filtered by permissions; turns into a horizontal scrolling tab bar under 760 px. Content max width 1280 px; sticky summary panels (`.stick`) on detail pages become static on mobile.
- **Shared components:** DataTable (TanStack: server pagination, filters, column picker, CSV export), StatusBadge (driven by the state machine enums), Timeline (order and tracking events), MoneyField (cents in, formatted in the record's currency out), DocumentButton (Download PDF + Email me), ConfirmCharge dialog (shows price and wallet balance before any deduction), FileDrop, EmptyState, PermissionGate.
- **Forms:** React Hook Form + Zod, the same schema shared with the server action; inline errors; autosave drafts for product create and CMS.

### 8.3 Route ↔ artboard inventory

| Route | Artboard | Role |
| --- | --- | --- |
| `/` | Main | Public |
| `/products`, `/c/[...slug]`, `/search` | Products | Public |
| `/p/[slug]` | Product | Public |
| `/request/[type]` | Request | Public → login |
| `/login`, `/signup`, `/onboarding` | Auth | Public |
| `/legal/[slug]`, `/about`, `/contact` | (CMS pages) | Public |
| `/account` | Customer | Customer |
| `/account/orders`, `/account/orders/[id]`, `/account/rfqs/[id]` | CustomerOrders | Customer |
| `/account/kyc` | CustomerKYC | Customer |
| `/account/wallet` | Wallet | Customer |
| `/account/ledger` | Ledger | Customer |
| `/account/developer` | Developer | Customer |
| `/account/support` | Support | Customer |
| `/supplier`, `/supplier/rfqs` | Supplier | Supplier |
| `/supplier/customers` | SupplierCustomers | Supplier |
| `/supplier/integrations` | SupplierAPI | Supplier |
| `/supplier/ads`, `/account/ads` | AdsCampaign | Advertiser |
| `/distributor` | Distributor | Distributor |
| `/distributor/products/new`, `/products/[id]/edit` | ProductCreate | Distributor, supplier, admin |
| `/distributor/products/import` | BulkUpload | Distributor, supplier, admin |
| `/distributor/catalog`, `/admin/catalog` | Catalog | Distributor, admin |
| `/office` | Office | Back office |
| `/office/shipping` | Shipping | Operations |
| `/office/support` | SupportDesk | Support |
| `/admin` | Admin | Admin |
| `/admin/finance` | Finance | Finance, admin |
| `/admin/ads` | AdsAdmin | Admin |
| `/admin/staff` | Staff | Admin |
| `/admin/geography` | Geo | Admin |
| `/admin/services` | Fees | Admin |
| `/admin/wallet` | WalletAdmin | Admin |
| `/admin/integrations` | Integrations | Admin |
| `/admin/content` | CMS | Content editor, admin |
| PDF template | Invoice | All (documents) |

### 8.4 UI rules

- No hard-coded text, prices, contacts or legal copy in components: read from `site_settings`, `content_blocks`, `service_prices` and `company_profile`.
- Storefront and customer portal render suppliers only through `<SupplierCode />` (code + country + badge).
- Every list has loading skeleton, empty state and error state; every destructive or paid action has a confirm dialog.
- Images through `next/image` with Supabase Storage loader; product images WebP, max 1600 px.

## 9. Front-end ↔ back-end integration

One rule decides where code runs: **reads** in Server Components, **simple writes** in Server Actions, **money and state changes** in Postgres functions (RPC), **outside services and long work** in Edge Functions or queue workers.

| Concern | Where | How |
| --- | --- | --- |
| Page data | Next.js Server Components | `createServerClient` (@supabase/ssr) with the user's cookie, so RLS applies; typed with generated `Database` types |
| Public catalogue pages | Server Components + ISR | `revalidate` 300 s; `revalidateTag('product:<id>')` on publish; anonymous client reads only public views |
| Forms and simple writes | Server Actions | Zod-validate → call Supabase → `revalidatePath` → return a typed result: ok with data, or an error code |
| Money and status changes | Postgres RPC (security definer) | `approve_quote`, `wallet_debit_for_service`, `record_payment`, `transition_order`, `approve_finance_request`: one transaction, ledger + status + outbox event |
| Integrations and webhooks | Supabase Edge Functions | `/functions/v1/yunexpress-webhook`, `payment-webhook`, `dropship-webhook`, `ai-tools`, `send-email`, `render-pdf`; verify signatures; idempotent |
| Public & supplier API | Next.js Route Handlers under `app/api/v1` (deploy as `api.octopusb2b.com`) | Token check → scope check → rate limit → same RPCs the UI uses |
| Live updates | Supabase Realtime | Subscribe to `order_events`, `tracking_events`, `ticket_messages`, `notifications` filtered by org; client components only |
| Files | Supabase Storage | Public bucket: product media, banners. Private buckets: KYC, documents (PDFs), QC reports, tickets; downloads through 60 s signed URLs created server-side |
| PDFs | Edge Function `render-pdf` | HTML template (matches the Invoice artboard) → PDF; stored in `documents`; same file for download and email |
| Settings & flags | `site_settings` table | Cached per request with `unstable_cache` + tag; flags: `wallet_enabled`, `supplier_portal_enabled`, `supplier_sees_contacts_after_paid`, `ads_enabled` |
| Auth & session | Supabase Auth + Next middleware | Middleware refreshes the session, redirects to `/onboarding` if no profile, and guards `/office` and `/admin` by role |
| Errors | Sentry (Next + Edge) | User-facing messages from a code → text map in CMS |

Typed contract between front and back end:

```ts
// packages/contracts/order.ts — shared by form, server action, RPC wrapper and public API
export const ApproveQuote = z.object({ quoteId: z.string().uuid(), acceptTermsVersionId: z.string().uuid() });

// app/(portal)/account/orders/actions.ts
'use server';
export async function approveQuote(input: z.infer<typeof ApproveQuote>) {
  const data = ApproveQuote.parse(input);
  const supabase = await createServerClient();
  const { data: pi, error } = await supabase.rpc('approve_quote', { p_quote_id: data.quoteId, p_terms_version_id: data.acceptTermsVersionId });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/orders');
  return { ok: true, data: pi }; // PI number + document id; PDF and email happen async via outbox
}
```

Environment variables (Vercel + Supabase secrets): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `SENTRY_DSN`, `EMAIL_API_KEY`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, `YUNEXPRESS_APP_ID`, `YUNEXPRESS_APP_KEY`, `AI_API_KEY`, `WEBHOOK_SIGNING_SECRET`. Integration credentials entered in Admin → Integrations go to Supabase Vault, not env vars.

## 10. Workflow orchestration

Business transactions never call outside services directly. They write an **outbox event** in the same database transaction; a dispatcher fans it out to queues; workers do the slow or external work and can retry safely.

```
UI / API → Server Action → RPC (one transaction: rows + ledger + status_history + outbox_events)
                                   │
                   pg_cron every 10 s → dispatch_outbox() → pgmq queues
                                   │
      Edge Function workers: email · pdf · notify · carrier · dropship · ai · webhooks_out · search_index
                                   │
                 result rows (documents, shipments, deliveries) + new events if needed
```

### 10.1 Events and consumers

| Event | Consumers (queues) |
| --- | --- |
| `rfq.submitted` | notify (assign queue, customer receipt), webhooks\_out |
| `quote.sent` | email, notify (realtime), webhooks\_out |
| `quote.approved` | pdf (PI), email (PI to customer + finance), notify distributor |
| `payment.confirmed` | ledger already posted; pdf (receipt), email, order transition check |
| `order.confirmed` | pdf (confirmation letter), email, notify supplier/distributor |
| `order.ready_to_ship` | carrier (create YunExpress shipment + label) |
| `shipment.tracking` | notify (email/WhatsApp at key events), webhooks\_out, timeline |
| `service_request.paid` | notify QC/ops queue, email receipt |
| `product.published` | search\_index, revalidate storefront tags, dropship (if tagged and API on) |
| `document.created` | email (if "email me" or automatic rule) |
| `ticket.created` / `ticket.replied` | notify support, SLA timer start, email customer |
| `ad.clicked` | ad charge (dedupe + fraud filter) → ledger, budget check |
| `terms.published` | revalidate legal pages, notify active customers |

### 10.2 Reliability rules

- **Idempotency:** each consumer stores `(event_id, consumer)` in `job_runs`; reprocessing is a no-op. Incoming webhooks dedupe by provider event id; API POSTs by `Idempotency-Key`.
- **Retries:** exponential backoff (1 min, 5 min, 30 min, 2 h, 6 h); after 5 failures the message moves to a dead-letter queue and appears in Admin → Integrations → Failed jobs with a "retry" button.
- **Ordering:** per-aggregate ordering by `aggregate_id` + sequence; consumers ignore stale events.
- **Observability:** every job writes duration and outcome; Sentry alert on dead letters and webhook signature failures.

### 10.3 Scheduled jobs (pg\_cron)

| Job | Schedule | Action |
| --- | --- | --- |
| Outbox dispatcher | every 10 s | Move new events to queues |
| Tracking fallback | hourly | Poll YunExpress for shipments without updates in 12 h |
| FX rates | daily 00:05 UTC | Store a reference USD↔CNY rate for admin to compare; billing uses only the rate admin approved (section 15.1) |
| Quote & RFQ expiry | every 15 min | Expire quotes past validity; RFQ 48 h no-reply reminder |
| SLA timers | every 5 min | Escalate tickets and queue items near or past SLA |
| Certificate expiry | daily | Mark expiring (30 days) / expired; hide tags; notify owners |
| Claim windows | daily | Close orders whose 7/30-day windows ended |
| Monthly statements | 1st of month 02:00 | Generate ledger statements PDF + email |
| Reconciliation | daily 03:00 | Compare payments/bank lines vs ledger; report mismatches to finance |
| Ads budget reset | daily 00:00 UTC | Reset daily spend; reactivate paused-by-budget campaigns |
| T&C scheduled publish | every 5 min | Publish versions whose `publish_at` passed |
| 1688 / source sync | every 6 h (later) | Refresh prices and stock within rate limits |
| Cleanup | daily | Expire signed URLs, old idempotency keys, temp uploads |

## 11. End-to-end integration, testing and deployment

### 11.1 Environments

| Environment | Frontend | Database | Integrations |
| --- | --- | --- | --- |
| Local | `pnpm dev` | `supabase start` (Docker) with `supabase/seed.sql` | All adapters in mock mode |
| Preview | Vercel preview per pull request | Staging Supabase project (or Supabase branching) | Sandbox: YunExpress test token, payment test keys, email to a test inbox |
| Production | Vercel production, domains octopusb2b.com and api.octopusb2b.com | Production Supabase project, PITR backups | Live credentials from Vault |

### 11.2 Pipeline (GitHub Actions)

1. Lint, typecheck, unit tests (Vitest) on every push.
2. `supabase db lint` + pgTAP tests (RLS and RPC rules) against a fresh local database.
3. Playwright E2E on the Vercel preview URL with seeded staging data.
4. On merge to `main`: `supabase db push` to staging, then manual approval → production migration → Vercel promotes the build.
5. Migrations are forward-only SQL files in `supabase/migrations`; never edit the production schema by hand.

### 11.3 What to test

- **pgTAP (database):** a customer cannot read another org's orders; storefront role cannot read `suppliers.legal_name`; supplier sees buyer contacts only after payment; ledger journals always balance; invalid state transitions are rejected; wallet cannot go negative; maker cannot approve own request.
- **Vitest (units):** price tier selection, fee calculation, Zod contracts, adapter mappers (YunExpress payload ↔ internal), webhook signature verification, PDF numbering.
- **Playwright golden paths:**
  1. Visitor → Google/email signup → profile → KYC submit.
  2. Customer RFQ (fee from wallet) → staff quote → approve → PI PDF downloaded and emailed → deposit recorded → confirmed.
  3. Balance paid → YunExpress sandbox shipment → simulated tracking webhook → customer timeline updates live → delivered.
  4. Sample + QC service purchase with wallet on; same with wallet off (card).
  5. Distributor bulk upload Excel with 2 bad rows → error report → fix → publish → product live on storefront with supplier code only.
  6. Admin edits a service price and a T&C section → publish → storefront shows the new values.
  7. Ticket → support reply → refund request → finance approval → ledger credit.
  8. API: Postman/Newman run of the collection with a test key, including webhook delivery and signature check.
- **Contract tests:** run each adapter against its sandbox nightly; alert on schema drift.

### 11.4 Seed data

`seed.sql` creates: one of each role (admin, finance, ops, support, distributor, content editor, customer, supplier), 4-level categories, 60 products across 6 suppliers (OCT-1101…), all services with prices, a published T&C version, company profile and Shenzhen branch, one order in each status, sample tickets and ad campaigns.

### 11.5 Monitoring

Sentry (errors and performance), Vercel Analytics (Core Web Vitals), Supabase logs and advisors, uptime check on `/api/health` and each webhook endpoint, daily digest of dead-letter jobs and reconciliation mismatches to the admin email.

### 11.6 Go-live checklist

- All T&C blanks filled and legal review done; published version linked from checkout.
- Live payment and YunExpress credentials tested with one real small order.
- DNS, SSL, email domain (SPF, DKIM, DMARC) for support@octopusb2b.com.
- RLS advisor clean; service-role key only on server; staff 2FA enforced.
- Backups (PITR) on; restore drill done once.
- Privacy policy, cookie banner, data export/delete flow in place.
- Supplier portal flag off; wallet flag set as decided; ad slots filled with house ads.

## 12. Security, performance, SEO and accessibility

| Area | Requirement |
| --- | --- |
| Access control | RLS on every table; `has_permission()` for staff; service-role key only in server code and Edge Functions; storefront reads only public views |
| Authentication | Google OAuth + email OTP for customers; staff and finance require TOTP 2FA; session refresh in middleware; lock after 5 failed attempts |
| Secrets | Vercel env vars for platform keys; integration credentials in Supabase Vault; API secrets hashed; keys rotatable from the UI |
| Money safety | Double-entry ledger; amounts in integer cents; maker–checker approvals; limits per role; daily reconciliation; no card data stored (payment partner handles PCI) |
| Audit | Append-only `audit_log` for logins, permission changes, price changes, money approvals, KYC document views, customer contact views, content publishes |
| API protection | Rate limits per key and IP, input validation with Zod, CORS allow-list, webhook HMAC verification, replay window 5 minutes |
| Uploads | Type and size limits, image re-encode, virus scan hook for documents, private buckets with signed URLs |
| Privacy | Privacy policy and cookie consent; data export and account deletion request; KYC retention period setting; GDPR/PIPL-aware processing records |
| Performance | LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on 4G; ISR for catalogue; image CDN; paginated tables (server side); indexes on all foreign keys and filter columns; search with Postgres full-text + trigram |
| SEO | Server-rendered product and category pages; clean slugs; `generateMetadata` from product SEO fields; Product, Offer, BreadcrumbList and Organization JSON-LD; sitemap.xml and robots.txt generated; canonical URLs; hreflang when languages are added |
| Accessibility | WCAG 2.2 AA: contrast ≥ 4.5:1, keyboard navigation, visible focus, labels on every input, status never by colour alone, tap targets ≥ 24 px, reduced-motion respected |
| Resilience | PITR backups, tested restore, dead-letter queues, feature flags to switch off a failing integration, status page for incidents |

## 13. Build phases with Antigravity prompts

Run one phase at a time in Planning mode. Paste the prompt, review the plan Antigravity proposes, let it build, then check every "Done when" item before moving on. Each prompt assumes this spec is saved as `docs/SPEC.md` and the artboard PNGs are in `docs/design/`.

### P0 — Project setup and design system

```
Read docs/SPEC.md sections 2, 8 and 11. Set up a pnpm monorepo: apps/web (Next.js App Router, TypeScript strict, Tailwind, shadcn/ui), packages/contracts (Zod), packages/integrations (adapter interfaces only), supabase/ (CLI project with migrations and seed.sql). Add the design tokens from section 8.1 as CSS variables and Tailwind theme, fonts Lexend/Inter/IBM Plex Mono with next/font. Build the Storefront layout and Portal layout from section 8.2 (sidebar becomes horizontal tabs under 760px) and the shared components: DataTable, StatusBadge, Timeline, MoneyField, DocumentButton, ConfirmCharge, FileDrop, EmptyState, PermissionGate. Add Sentry, ESLint, Prettier, Vitest, Playwright and a GitHub Actions workflow as in section 11.2. Do not build features yet.
```

Done when: `pnpm dev` and `supabase start` run; a component gallery page shows every shared component; CI passes on an empty PR; preview deploys on Vercel.

### P1 — Auth, profiles, roles, KYC

```
Read docs/SPEC.md sections 3, 4.1 steps 2–3, 6 (Identity & orgs) and 12. Create migrations for profiles, organizations, org_members, roles, permissions, role_permissions, staff_assignments, kyc_submissions, kyc_documents, addresses, audit_log, with RLS. Add has_permission(user, area, action). Implement Supabase Auth with Google OAuth and email OTP; middleware that refreshes the session and sends users without a profile to /onboarding (create profile: name, company, country, phone, business type). Build /account/kyc (match docs/design/CustomerKYC.png) with uploads to a private bucket and the KYC state machine from section 5. Staff 2FA (TOTP) required for /office and /admin. Write pgTAP tests for the RLS rules in section 11.3.
```

Done when: Google and email signup work; no profile → forced onboarding; KYC submit → reviewer approves in a basic queue; pgTAP RLS tests pass.

### P2 — Catalog, product creation, AI tools, bulk upload, certificates

```
Read docs/SPEC.md sections 4.3, 5 (Product listing, Certificate), 6 (Suppliers, Catalog, Imports & AI) and 7 (AI). Create the tables with RLS, including categories with 4 levels (check constraint), tags, price_tiers, certificates, product_flags (octopus_dropship, ready_to_ship), supplier_switches and the public_suppliers view (code, country, badge only). Build: /distributor (match Distributor.png) with supplier list and on/off switches; /distributor/products/new (ProductCreate.png) with tiers, specs, certificates, Octopus Dropship tag, autosave, and AI buttons Enhance photo, Make poster, Fix SEO calling an Edge Function ai-tools via AiAdapter; /distributor/products/import (BulkUpload.png) with an Excel template download, upload, row validation report and import as drafts; /distributor/catalog and /admin/catalog (Catalog.png) for categories and tags. Moderation queue for back office. Respect supplier switches everywhere.
```

Done when: a distributor creates a product with AI-fixed SEO, bulk-imports 50 rows with an error report, and moderation publishes it; a switched-off supplier cannot upload.

### P3 — Storefront, CMS and SEO

```
Read docs/SPEC.md sections 4.1 step 1, 8.3, 8.4 and 12 (SEO, Performance). Build / (Main.png), /products and /c/[...slug] (Products.png: 50+ items, filters for category, price, MOQ, certifications, Octopus Dropship, ready to ship; server pagination), /p/[slug] (Product.png: tiers, key facts card, full-width services row with Sourcing, 3PL, Dropship, Sample, QC, Certification buttons, certificate tags, Octopus Dropship tag, 12 recommended products), /request/[type] (Request.png). Show suppliers only with <SupplierCode/>. Build site_settings, pages, content_blocks, content_versions, terms_versions (15 sections), company_profile and branches, and /admin/content (CMS.png) with draft → review → publish/schedule and version history. All text, contacts and the footer come from CMS. Add ISR with revalidateTag, generateMetadata, JSON-LD, sitemap and robots.
```

Done when: Lighthouse ≥ 90 on home and product pages; editing a T&C section or a branch in CMS updates the site after publish; no supplier names appear in storefront HTML.

### P4 — RFQ → quote → proforma → order, ledger and documents

```
Read docs/SPEC.md sections 4.1 steps 4–8, 5 (RFQ, Quote, Order, Payment), 6 (Trade, Money), 9 and 10. Create trade and ledger tables. Implement Postgres functions submit_rfq, send_quote, approve_quote (creates PI with number PI-YYYY-####, stores terms_version_id), record_payment, transition_order, all writing status_history, double-entry ledger entries and outbox_events in one transaction. Build the outbox dispatcher (pg_cron + pgmq) and Edge Function workers for pdf (render the Invoice.png layout) and email. Build /account/orders and RFQ/quote detail (CustomerOrders.png) with realtime updates, /account/ledger (Ledger.png) with statement PDF/CSV, and DocumentButton (download PDF or email me) for every document type and every role. Deposit 30% and balance amounts come from settings.
```

Done when: Playwright golden path 2 passes; PI PDF matches the Invoice artboard; ledger journals balance in pgTAP; replaying an outbox event sends no duplicate email.

### P5 — Services, charges, wallet and payments

```
Read docs/SPEC.md sections 4.2, 5 (Service request, Wallet), 6 (Services & fees, Money) and 7 (Payment, Bank). Build services and service_prices with /admin/services (Fees.png: edit price per service, add new services, effective dates). Build wallets with wallet_debit_for_service RPC (never negative, ConfirmCharge dialog first), top-ups through PaymentAdapter (test mode) and manual bank transfer matching, /account/wallet (Wallet.png), and /admin/wallet (WalletAdmin.png) with the wallet ON/OFF switch and price list. When wallet_enabled is false, services are paid by card/invoice. RFQ fee, sample, QC, certification, 3PL and dropship requests all use this path. Payment webhook Edge Function with signature check and idempotency.
```

Done when: golden path 4 passes with wallet on and off; changing a price in Admin changes the next charge; payment webhook replay is ignored.

### P6 — YunExpress shipping and live tracking

```
Read docs/SPEC.md sections 4.1 steps 9–10, 5 (Shipment), 7 (CarrierAdapter, YunExpress) and 10.3. Implement YunExpressAdapter (price trial, create order, label, cancel, tracking subscription, webhook parse) in sandbox mode with credentials from Vault. Build /office/shipping (Shipping.png): create shipment from ready_to_ship orders, compare rates, print labels, exceptions list. Edge Function yunexpress-webhook writes tracking_events; hourly fallback poll. Customer order page shows a live Timeline via Realtime and sends notifications at key events.
```

Done when: golden path 3 passes in sandbox; a second carrier can be added by writing only a new adapter class.

### P7 — Back office, support desk, finance approvals and payouts

```
Read docs/SPEC.md sections 4.5, 4.6, 5 (Ticket, Finance approval, Payout) and 10.3. Build /office (Office.png) with queues for KYC, moderation, RFQ assignment, service requests, shipment exceptions and tickets near SLA. Build /account/support (Support.png: complaints and feedback with photos, linked to order) and /office/support (SupportDesk.png: priority, SLA, macros, internal notes, escalate to finance, CSAT). Build /admin/finance (Finance.png): incoming payments matching, approvals with maker–checker and limits, refunds, credit notes, supplier payouts via BankAdapter (manual mode), revenue by stream, exports PDF/CSV and email, reconciliation report.
```

Done when: golden path 7 passes; a maker cannot approve their own request; SLA escalation fires in a test with a shortened timer.

### P8 — Admin: overview, staff, geography, integrations, advertising

```
Read docs/SPEC.md sections 3, 4.7, 4.8, 6 (Advertising) and 7. Build /admin (Admin.png) KPIs; /admin/staff (Staff.png) with user creation, role assignment and an editable permission matrix including Distributor and Content editor roles; /admin/geography (Geo.png) map and table by country, KYC status and revenue; /admin/integrations (Integrations.png) for YunExpress, payment, email, Octopus Dropship, 1688/Alibaba sources and webhooks with sandbox/live mode, test connection and failed jobs retry. Build advertising: AdSlot placements on every page type, /account/ads and /supplier/ads (AdsCampaign.png), /admin/ads (AdsAdmin.png) with moderation, CPC pricing, daily budgets, click dedupe and charges to wallet and ledger.
```

Done when: a new staff user with the Content editor role can edit but not publish legal pages; an ad click charges once and stops at the daily budget.

### P9 — Public API, supplier API, webhooks, Octopus Dropship, sources

```
Read docs/SPEC.md sections 4.9 and 7 (Public API, Supplier API, Dropship, Source). Build route handlers under app/api/v1 and app/api/supplier/v1 with OAuth client credentials, oct_test_/oct_live_ keys, scopes, rate limits, Idempotency-Key and RFC 7807 errors, reusing the same RPCs as the UI. Generate OpenAPI 3.1 from Zod and a Postman collection. Build /account/developer (Developer.png) for apps, keys, webhook endpoints, delivery log and resend; outbound webhooks signed with HMAC-SHA256. Build /supplier/integrations (SupplierAPI.png). Add OctopusDropshipAdapter (request dropship creates a service request; push product/order when the API is configured) and a 1688 SourceAdapter stub using the official Open Platform only. Supplier portal stays behind supplier_portal_enabled.
```

Done when: the Postman collection runs green with Newman in CI; a webhook receiver verifies signatures; turning the supplier portal flag on exposes /supplier for invited suppliers only.

### P10 — Hardening, E2E and go-live

```
Read docs/SPEC.md sections 11 and 12. Complete all Playwright golden paths, pgTAP tests and adapter contract tests. Run Supabase security and performance advisors and fix every finding. Add rate limits, upload scanning hook, audit log coverage, cookie consent, data export/delete, uptime checks and dead-letter alerts. Check WCAG 2.2 AA with axe on every route in section 8.3 and Core Web Vitals targets. Produce a go-live checklist report against section 11.6.
```

Done when: every item in section 11.6 is ticked; one real small order runs end to end in production.

## 14. Open decisions

These do not block P0–P3. Decide them before the phase shown, then update the setting or adapter. The code reads all of them from configuration.

| # | Decision | Options | Needed by |
| --- | --- | --- | --- |
| 1 | Payment provider (cards, top-ups) | Stripe, Airwallex, other HK-licensed partner | P5 |
| 2 | Bank / virtual account provider and who holds wallet funds (licensing) | Airwallex, Wise Business, HK bank with API; or keep wallet as prepaid service credit only | P5 |
| 3 | Transactional email provider and sending domain | Resend, Postmark, Amazon SES | P4 |
| 4 | Billing email for documents (separate from support@octopusb2b.com?) | e.g. billing@ or accounts@octopusb2b.com | P4 |
| 5 | T&C blanks (company registration no., bank details, liability cap, insurance, governing details) and legal review | Fill in CMS → Terms | Before go-live |
| 6 | Deposit, quote validity and claim windows | T&C values: 30% deposit, 30-day validity, 7/30-day claims (the sample quotation used 100% advance and 7 days) | P4 |
| 7 | Octopus Dropship API (endpoints, auth, events) | Share its docs; until then "Request dropship" is a manual service request | P9 |
| 8 | YunExpress account: live app ID/key, products/channels, pickup or drop-off | Apply with YunExpress Shenzhen | P6 |
| 9 | Distributors: internal staff only, or external partners with commission | Affects permissions, payouts and contracts | P2 |
| 10 | Supplier sees buyer contacts after payment: default on or off | Admin setting | P4 |
| 11 | AI provider for image and text tools, and monthly usage limits per org | Image model + LLM; cost per use or free quota | P2 |
| 12 | Languages beyond English (e.g. Arabic, Spanish, Chinese) | Adds i18n routing and RTL | After launch |
| 13 | 1688 / Alibaba access | Apply for official Open Platform AppKey and partner access | P9 / later |

Also decide: (14) payment and bank partners that can collect and pay out in CNY, needed before the first switch to CNY; (15) the Postman account, workspace and plan for Shenzhen Octopus Trading. Both are covered in section 15.

## 15. Addendum: Postman API partner and USD ↔ CNY currency

Added 1 Nov 2026. Where this section conflicts with earlier text ("USD only"), this section wins.

### 15.1 Platform currency: USD or Chinese yuan (CNY)

Admin can switch the whole platform between US dollars and Chinese yuan. One currency is active at a time; USD is the default.

| Area | Rule |
| --- | --- |
| Setting | `site_settings.platform_currency` = `USD` or `CNY`. Only Admin can request a change; Finance approves (maker–checker); every change goes in the audit log |
| Storage | Every amount is `amount_minor` (bigint) + `currency` (char(3)). No column is named after a currency |
| Exchange rate | Admin sets the rate in `fx_rates` (base USD, quote CNY, `rate numeric(12,6)`, `effective_from`, `set_by`, `source` manual or reference). The daily job only fetches a reference rate to compare; billing uses only the approved rate |
| Documents | Quotes, PIs, invoices, orders, service requests and ad campaigns lock their currency and rate when created. A later switch never changes them; they are paid in their own currency |
| Catalogue | Price tiers keep the currency they were entered in (1688 suppliers often quote CNY). The storefront converts to the platform currency at the approved rate with rounding settings; the quote locks the converted amount |
| Service prices | `service_prices` holds a price per currency. With no CNY price set, the system converts from USD and marks it "converted" in Services & charges |
| Wallet | One wallet per organisation per currency (`wallets (org_id, currency)` unique). Charges use the wallet in the platform currency. On a switch, admin chooses: keep old balances spendable, or convert all balances at the switch rate through a conversion journal shown on each customer's ledger |
| Ledger | Each journal balances per currency; cross-currency moves post both legs through an `fx_conversion` account with the rate |
| Payments | The switch is blocked unless the active payment and bank adapters support CNY; Integrations shows "CNY supported" per adapter |
| Display | Code + symbol to avoid confusion with Japanese yen: "US$ 190.00", "CN¥ 1,368.00", via `Intl.NumberFormat`. Texts such as "All prices in USD" on the designs come from CMS with a `{currency}` variable |
| Reports | Finance shows each currency separately, plus a total converted at the approved rate and labelled as converted |
| API and webhooks | Amounts are `{ "amount_minor": 19000, "currency": "USD" }`; `GET /v1/settings/currency` returns the currency and current rate; webhook `settings.currency_changed` |

Switch workflow (`currency_switch_requests`: draft → pending\_approval → scheduled → applied / cancelled):

1. Admin → Settings → Currency: choose CNY, enter the rate, choose the wallet option, choose the effective time.
2. Impact preview: open quotes and PIs (they stay in USD), wallet balances, active ad budgets, services without a CNY price, payment adapter support.
3. Finance approves (the requester cannot).
4. At the effective time a job applies it: updates the setting, converts wallets if chosen, revalidates storefront caches, shows a site banner, emails customers, sends the webhook.
5. Switching back to USD uses the same flow.

UI: new screen `/admin/currency`, built in the style of `docs/design/WalletAdmin.png`; storefront top bar shows the active currency.

### 15.2 Postman as the API partner

Postman is where customers, Shopify and Wix app builders, and our own team discover, try and test the Octopus B2B API.

- **Public workspace** "Octopus B2B API" on the Postman API Network with the OpenAPI 3.1 definition, the collection "Octopus B2B API v1" (folders: Auth, Catalog, RFQs & quotes, Orders, Shipments, Wallet & ledger, Service requests, Webhooks, Settings), a separate supplier API collection, and environments Sandbox and Live (variables `base_url`, `client_id`, `client_secret`, `access_token`, `currency`, shipped empty).
- **Auth built in:** a collection-level pre-request script fetches and caches the OAuth client-credentials token; each request has tests for status code, response schema and that every amount carries a currency.
- **Examples:** saved example responses for every endpoint, generated from seed data.
- **Developer page:** "Run in Postman" button, link to the public workspace, and a download fallback on `/account/developer`.
- **Repository is the source:** on every release, CI regenerates OpenAPI from the Zod contracts and pushes the definition and collections to the workspace through the Postman API (`POSTMAN_API_KEY`, workspace and collection IDs as secrets). Nobody edits the collections by hand in Postman.
- **Testing:** the Postman CLI (or Newman) runs the collection against every Vercel preview in CI; a Postman monitor runs the sandbox collection on a schedule and alerts on failure.
- **Webhooks:** an example request and mock server show how to verify the `Octopus-Signature` header.
- **Admin:** a Postman card in Admin → Integrations with workspace and collection IDs, API key (in Vault), last sync time and result, "Sync now", and monitor status.
- **Safety:** real customer keys never go into shared Postman environments.

### 15.3 Antigravity prompts for this addendum

When to run them: if P4 and P5 are not built yet, add "Also apply docs/SPEC.md section 15.1" to the P4 and P5 prompts, then run 15-A after P5 to finish the admin screen and tests. If they are already built, run 15-A now. Run 15-B with or right after P9.

**Prompt 15-A — Admin currency switch (USD ↔ CNY)**

```
Read docs/SPEC.md section 15.1 (it overrides earlier "USD only" text) and sections 5, 6 (Money) and 9. Make the platform currency switchable between USD and CNY:
1. Migration: replace every amount_usd_cents column with amount_minor bigint + currency char(3) (backfill 'USD'); add currency and fx_rate_id to quotes, proforma_invoices, orders, service_requests and ad_campaigns; make wallets unique on (org_id, currency); create fx_rates and currency_switch_requests; add site_settings platform_currency and currency_rounding; add an fx_conversion ledger account and a check that every journal balances per currency.
2. Postgres functions: current_platform_currency(), convert_amount(amount_minor, from_currency, to_currency, fx_rate_id), request/approve/apply for currency_switch_requests (draft -> pending_approval -> scheduled -> applied/cancelled) with maker-checker approval, audit log and a pg_cron job that applies scheduled switches.
3. Update approve_quote, wallet_debit_for_service, record_payment and ad click charges to lock currency and rate and to use the wallet in the platform currency. Block a switch when the active payment adapter does not support CNY.
4. Build /admin/currency in the style of docs/design/WalletAdmin.png: current currency, rate history, new-rate form, switch wizard with impact preview (open quotes and PIs, wallet balances, ad budgets, services without CNY price), wallet option keep or convert, effective time, approval status.
5. MoneyField and every price use Intl.NumberFormat with the record's currency (US$ / CN¥). Replace "All prices in USD" texts with CMS text using a {currency} variable. Show the active currency in the storefront top bar and a banner after a switch.
6. PDFs, statements, emails, finance reports (per currency plus a labelled converted total) and the public API ({amount_minor, currency}, GET /v1/settings/currency, webhook settings.currency_changed) follow these rules.
Tests: pgTAP that journals balance per currency, old documents keep their currency after a switch, and a maker cannot approve their own switch. Playwright on staging: switch USD -> CNY and check storefront prices, a new quote and PI, a wallet charge, a PDF, then switch back.
```

Done when: after a switch to CNY, new quotes and invoices are in CNY at the approved rate; an older USD PI can still be paid in USD; ledger and statements balance per currency; switching back to USD works.

**Prompt 15-B — Postman API partner**

```
Read docs/SPEC.md sections 7 (Public API, Supplier API) and 15.2. Make Postman our official API partner:
1. Generate OpenAPI 3.1 from the Zod contracts in packages/contracts and, from it, two Postman collections (public v1 and supplier v1) with the folders in 15.2, saved examples from seed data, a collection-level pre-request script that fetches and caches the OAuth client-credentials token, and tests for status, schema and a currency on every amount. Add Sandbox and Live environments with empty secret values.
2. Add scripts/postman-sync.ts and a GitHub Actions job that, on each release, pushes the OpenAPI definition and both collections to our Postman workspace through the Postman API using POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID and the collection IDs from repository secrets.
3. Run the public collection with the Postman CLI (or Newman) against every Vercel preview and fail the build on errors.
4. Add a webhook-verification example request and a mock-server example for the Octopus-Signature header.
5. On /account/developer (docs/design/Developer.png) add a "Run in Postman" button, a link to the public workspace and a download fallback. On /admin/integrations (docs/design/Integrations.png) add a Postman card: workspace and collection IDs, API key stored in Supabase Vault, last sync time and result, Sync now, monitor status.
The repository is the source of truth: never edit the collections by hand in Postman.
```

Done when: a release updates the public Postman workspace automatically; a new developer can fork the collection, add sandbox keys and list products within 5 minutes; CI fails when an endpoint breaks its schema.

## 16. Addendum: data backup and restore

Added 1 Nov 2026. Admin can back up all data on demand or on a schedule, download it, and restore ("reinstall") all of it or only selected records. This section extends sections 11 and 12.

### 16.1 Three layers of backup

| Layer | What it covers | How often | Where it is kept | Used for |
| --- | --- | --- | --- | --- |
| 1. Supabase managed backups + point-in-time recovery (PITR add-on) | The whole Postgres database | Continuous (PITR) and daily | Inside Supabase | Fast rollback of the production database to a minute in the past |
| 2. Octopus own backups | Database dump (schema, data, roles) + every Storage bucket (product media, KYC, PDFs, QC reports, ticket files) | Nightly 02:00 China time, plus "Back up now" | Off-site object storage at a different provider (e.g. Cloudflare R2, AWS S3 or Backblaze B2), encrypted | Full restore to a new project, disaster recovery, downloads, partial restores |
| 3. Business data exports | Readable files per module: customers and KYC status, suppliers, products and categories, orders, invoices, ledger, wallet, services, tickets, CMS content | On demand, and monthly | Download (signed URL) and off-site storage | Accounting, audits, moving data, re-importing records |

Why layer 2 matters: Supabase database backups do not include the files in Storage, and depending only on the hosting provider is a single point of failure.

Retention (admin setting): 14 daily, 8 weekly, 12 monthly backups; exports 12 months. Targets: lose at most 24 hours of data from layer 2 (minutes with PITR); be back online within 4 hours.

### 16.2 How backups run

- A GitHub Actions workflow `backup.yml` (scheduled and `workflow_dispatch`) runs `supabase db dump` for roles, schema and data, and syncs every Storage bucket with `rclone`. It compresses and encrypts each file with a public key (the private key is held offline by the owner), uploads to the off-site bucket, and writes a manifest: file list, sizes, SHA-256 checksums, row counts per table, ledger totals per currency, and the migration version.
- "Back up now" in the admin panel calls an Edge Function that starts the workflow through the GitHub API. The workflow reports progress back to the `backups` table.
- Integration secrets in Supabase Vault are encrypted with the project's own key and cannot be decrypted in another project. After a full restore to a new project, admin re-enters integration credentials. The restore checklist shows which ones.

### 16.3 Restore ("reinstall all the data")

| Type | When | How |
| --- | --- | --- |
| Point-in-time rollback | Bad change in the last days (e.g. wrong bulk update) | Supabase PITR to a chosen minute, run by the owner from the Supabase dashboard following the runbook |
| Full restore | Disaster, move to a new Supabase project or region, rebuild staging | Workflow `restore.yml` restores the chosen backup into a target project, re-applies newer migrations, restores Storage, runs checks, then the app is pointed at it |
| Partial restore | A product, customer, order or CMS page was deleted or damaged | The backup is loaded into a separate `recovery` schema; admin compares records side by side and restores selected rows through an RPC that writes the audit log. Money records are never overwritten; corrections go through finance adjustments |
| Re-import from exports | Load customers, products or categories into a fresh system, or from another system | Upload the export file; reuses the bulk-upload validation and row-error report |

Restore workflow (`restore_requests`: draft → verifying → verified → pending\_approval → approved → running → completed / failed / cancelled):

1. Admin picks a backup and the restore type, and writes a reason.
2. **Verify first:** the backup is restored into a scratch project. Checks: checksums match the manifest, row counts match, every ledger journal balances per currency, the migration version is known.
3. Second approver: Finance for anything touching money, otherwise another Admin. The requester cannot approve. Both re-enter 2FA.
4. For a full restore to production: maintenance mode on (storefront shows a notice, API returns `503` with `Retry-After`, queues pause), restore runs in a GitHub protected environment that also needs manual approval, migrations are re-applied, caches revalidated, the search index rebuilt, queues resumed, then maintenance mode off.
5. After the restore: compare checks again, email admins the report, and record everything in the audit log.

### 16.4 Admin screen: Backup & restore (`/admin/backups`)

- **Status:** last successful backup, next scheduled run, off-site storage used, PITR on/off, the last restore drill and its result.
- **Backups table:** time, type (scheduled/manual), what is included (database, storage), size, checksum check, status. Actions: download (admin only, 2FA re-check, link valid 10 minutes), verify, restore.
- **Back up now** button with a progress bar.
- **Restore wizard:** choose backup → choose type (full / partial by module and records / to staging) → verification results → approval → run → report.
- **Data exports:** choose modules, date range, format (Excel, CSV, JSON), then download, and optionally email the link to the admin.
- **Settings:** schedule, retention, off-site storage connection (test connection), encryption key fingerprint, alert email.
- Permission area "Backups & restore" in the roles matrix: view, back up, download, export, request restore, approve restore. Admin only by default.

Data model additions: `backups` (kind, trigger, status, started\_at, finished\_at, size\_bytes, location, manifest jsonb, migration\_version, created\_by), `backup_files`, `restore_requests`, `restore_checks`, `data_exports`, `recovery` schema, `site_settings.maintenance_mode`.

Monitoring: alert the admin email and Sentry if a nightly backup is missing or fails; a monthly automatic restore drill restores the latest backup into a scratch project and posts the checks to the admin panel.

### 16.5 Antigravity prompt

Run this after P7 (finance approvals exist) and before P10. If the app is already live, run it now.

**Prompt 16-A — Backup and restore**

```
Read docs/SPEC.md section 16 (backup and restore) and sections 6, 10, 11 and 12. Build the backup and restore system:
1. Migrations: backups, backup_files, restore_requests (draft -> verifying -> verified -> pending_approval -> approved -> running -> completed/failed/cancelled), restore_checks, data_exports, a recovery schema, site_settings.maintenance_mode and backup settings (schedule, retention). Add the permission area "Backups & restore" with actions view, backup, download, export, request_restore, approve_restore. Everything admin-only by default, with RLS and audit log.
2. GitHub Actions backup.yml (cron 18:00 UTC = 02:00 China time, plus workflow_dispatch): supabase db dump for roles, schema and data; rclone sync of every Storage bucket; compress; encrypt with the public key from secrets (age); upload to the off-site S3-compatible bucket; write a manifest with SHA-256 checksums, row counts per table, ledger totals per currency and the migration version; report status to the backups table through a secured Edge Function. Apply retention (14 daily, 8 weekly, 12 monthly).
3. GitHub Actions restore.yml (workflow_dispatch, GitHub protected environment needing manual approval): restore a chosen backup into a target project, re-apply newer migrations, restore Storage, run checks (checksums, row counts, ledger balanced per currency), and post results to restore_checks. Support target = scratch, staging or production. For production: turn maintenance mode on first, pause queues, then revalidate caches, rebuild search, resume queues and turn maintenance mode off.
4. Edge Functions: backup-trigger and restore-trigger (start the workflows through the GitHub API; admin role and a recent 2FA check required), backup-status (signed callback from the workflows), backup-download (10-minute signed URL, audited).
5. Partial restore: load the chosen tables from a backup into the recovery schema; a side-by-side compare screen; RPC restore_records(table, ids, reason) that copies selected rows back, never overwrites ledger or payment rows, and writes the audit log.
6. Data exports: per module (customers, suppliers, products, categories, orders, invoices, ledger, wallet, services, tickets, CMS) as Excel, CSV or JSON, built by a queue worker, stored privately, downloadable by signed URL and optionally emailed. Re-import uses the existing bulk-upload validation.
7. Maintenance mode: storefront and portals show a CMS notice; API returns 503 with Retry-After; outbox dispatcher pauses.
8. Build /admin/backups to match docs/design/Backups.png and docs/design/html/Backups.html: status cards, backups table with download/verify/restore, Back up now with progress, restore wizard with verification results and approvals, data exports, and settings (schedule, retention, off-site storage test, key fingerprint, alert email).
9. Monitoring: alert if no successful backup in 26 hours; monthly restore drill into a scratch project with results shown in the panel.
10. Write docs/RUNBOOK-restore.md: full disaster recovery step by step (new Supabase project, migrations, restore, Storage, re-enter Vault secrets for each integration, Vercel env vars, DNS, checks).
Tests: pgTAP for permissions and that restore_records refuses ledger rows; a CI job that backs up the staging database and restores it into a scratch database and compares counts and ledger totals.
```

Done when: the nightly backup appears in the panel with a valid checksum; "Back up now" works; a restore drill into scratch passes all checks; a deleted product is recovered through partial restore; the runbook rebuilds staging from a backup without help.

## 17. Addendum: staff and back-office login

Added 1 Nov 2026. Staff do not use the customer login. They have their own sign-in page at `/staff/login` (design: `docs/design/StaffLogin.png`, steps `StaffLogin-2-verify.png` and `StaffLogin-3-workspace.png`, HTML `docs/design/html/StaffLogin.html`). Links to it sit at the bottom of the customer login page ("Octopus staff? Back office login") and in the storefront footer ("Staff login").

### 17.1 Who signs in here

Operations, Finance, Support, Sourcing agent, QC coordinator, Content editor, Distributor and Admin (section 3). Suppliers keep their own portal login when the supplier portal opens. Customers use `/login`.

### 17.2 Sign-in flow

1. **Sign in:** "Sign in with Google", allowed only for `@octopusb2b.com` accounts, or work email and password. No self sign-up: accounts exist only after Admin invites them in Staff & roles.
2. **Two-step verification (required):** a 6-digit code from an authenticator app (TOTP through Supabase Auth MFA). On first sign-in the staff member scans a QR code and saves 10 backup codes. "Trust this computer for 12 hours" is optional.
3. **Choose workspace:** cards for only the areas the person's role allows (Back office, Shipping, Support desk, Finance, Admin, Distributor panel, Site content). If a person has only one area, they go straight to it. A workspace switcher sits in the top bar of every staff page.

### 17.3 Rules

| Rule | Detail |
| --- | --- |
| Invitation only | Admin creates the staff user, sets role(s) and office; the invite email has a 24-hour link to set a password. Deactivating a user ends all their sessions at once |
| Separate from customers | A staff email cannot hold a customer account. Middleware sends anyone without a staff role away from `/office`, `/admin`, `/distributor` and `/staff` |
| 2FA everywhere | Every staff session must reach Supabase assurance level `aal2`. RLS policies for staff tables check `auth.jwt()->>'aal' = 'aal2'` as well as `has_permission()` |
| Lockout | 5 wrong passwords or codes lock the account for 15 minutes and notify Admin |
| Sessions | Idle timeout 30 minutes, maximum 12 hours. Sensitive actions (money approvals, restore, KYC document download, role changes) ask for the code again if it is older than 10 minutes |
| Reset | Forgot password sends a reset link. Lost phone: only an Admin can reset someone's 2FA, and that is logged |
| Optional IP rule | Admin can limit Admin and Finance sign-ins to office IP addresses (setting) |
| Audit | Every sign-in, failure, lockout, 2FA reset and workspace switch goes in the audit log with IP and device |

Admin screen changes: Staff & roles gets columns for 2FA status, last sign-in and active sessions, with actions Invite, Resend invite, Reset 2FA, End sessions and Deactivate. A "Security" panel holds the lockout, session and IP settings.

### 17.4 Antigravity prompt

Run this together with P1 (auth), or now if P1 is already built.

**Prompt 17-A — Staff and back-office login**

```
Read docs/SPEC.md sections 3, 12 and 17. Build a separate staff sign-in for the back office:
1. Route /staff/login matching docs/design/StaffLogin.png, StaffLogin-2-verify.png and StaffLogin-3-workspace.png (exact styles in docs/design/html/StaffLogin.html). Step 1: Google sign-in restricted to the octopusb2b.com domain, or email + password. Step 2: TOTP code with Supabase Auth MFA (enrol with QR code and 10 backup codes on first sign-in; optional trust this computer for 12 hours). Step 3: workspace cards built from the user's roles and permissions; skip this step when only one area is allowed.
2. Staff are invitation-only: from /admin/staff (docs/design/Staff.png) Admin invites a user, sets roles and office; the invite email has a 24-hour set-password link. Add columns 2FA status, last sign-in, active sessions and actions Resend invite, Reset 2FA, End sessions, Deactivate. Add a Security panel: lockout (5 attempts, 15 minutes), idle timeout 30 minutes, maximum session 12 hours, optional office IP allow-list for Admin and Finance.
3. Middleware: /office, /admin, /distributor and /staff/* require a staff role and aal2; otherwise redirect to /staff/login. Customers who open these paths go to /login. A staff email cannot create a customer account.
4. RLS: staff policies check has_permission() and auth.jwt()->>'aal' = 'aal2'. Add a step-up check that asks for a fresh code (older than 10 minutes) before money approvals, restores, KYC document downloads and role changes.
5. Add a workspace switcher and the user menu (profile, change password, 2FA devices, sign out) to the portal top bar for staff.
6. Link to /staff/login from the customer login page ("Octopus staff? Back office login") and the storefront footer ("Staff login"), as in docs/design/Auth.png and Main.png.
7. Audit log entries for sign-in, failure, lockout, 2FA reset, session end and workspace switch, with IP and device.
Tests: Playwright for invite -> set password -> enrol 2FA -> choose workspace; a customer cannot open /office; staff without aal2 cannot read staff tables (pgTAP); lockout after 5 failures.
```

Done when: an invited staff member can sign in with password and code and land in their workspace; a customer is turned away from `/office` and `/admin`; resetting 2FA and ending sessions works from Staff & roles.

Sources for the spec: Octopus B2B Terms & Conditions draft (PDF), the sample quotation/proforma (image), the design canvas, and the requirements gathered in this conversation.
