# Prompt — Shop + customer account panel after login (CH-1, CH-2, CH-3)

Follow PROJECT-MEMORY.md and docs/design/dropship-v2/UI-RULES.md. First replace docs/design/dropship-v2/ with the latest design package.

For each part:
1. Send a Step 0 plan: screens, queries/RPCs, migrations, tests. Wait for my OK.
2. Build on staging only, then run the full suite.
3. Report with screenshots next to each design file.
4. Nothing goes live without my "go".

## The idea: two areas, two tabs, one sign-in

| | Tab 1: Shop (main page after login) | Tab 2: Account panel (customer back office) |
|---|---|---|
| Route | `/shop`, `/shop/products`, `/shop/products/[slug]`, `/shop/pools`, `/shop/turnkey` | `/account` and its pages |
| Purpose | See and buy all our products: sourcing products, MOQ pools, turnkey projects, dropshipping products, Make My Brand, samples | Run the business: things waiting, orders, money, invoices, warehouse, shipping, team |
| Layout | Shop header + section bar (no sidebar) | Sidebar + top bar |
| Link to the other | "My account panel ↗" in the header and the welcome strip | "Browse products ↗" at the bottom of the sidebar and on the panel home |

- After sign-in: customers → `/shop` (respect a safe same-site `?next=`); staff → `/office`; suppliers → their portal; Shopify embedded → `/shop` is not used there (`/shopify`).
- A signed-in customer opening `/`, `/login` or `/signup` goes to `/shop`.
- Links between the two areas open in a NEW TAB on desktop: `target="_blank" rel="noopener"`, a ↗ icon, and screen-reader text "(opens in a new tab)". On phones they open in the same tab.
- Both tabs share one session. Signing out in one signs out both. Notifications and wallet numbers are the same in both.

## 1. CH-1 — Shop (tab 1)

Match `screens/Shop_Home.html`, `mobile/M_Shop_Home.html`, `screens/Shop_Products.html`, `mobile/M_Shop_Products.html`.

- **Header (every shop page):**
  - logo → `/shop`;
  - big search (products, MOQ pools, turnkey projects);
  - **Quote list** with count;
  - notifications;
  - **My account panel ↗**.
  - Section bar: All categories ▾, Sourcing products, MOQ pools, Turnkey projects, Dropshipping, Make My Brand, Samples, New arrivals, plus the wallet balance.
- **Shop home, top to bottom:**
  1. Welcome strip: "N things are waiting for you" + Open my account panel ↗.
  2. Shop by category tiles.
  3. Recommended sourcing products: price per unit, MOQ, lead time, "Verified supplier"; Request quote / Sample.
  4. MOQ pools: pool price vs normal, progress (`role="progressbar"`), closes in, minimum share; Join pool.
  5. Turnkey projects: what's included, from price, timeline, MOQ.
  6. Dropshipping products: names and images only + Request access until the company has dropship on, then landed cost.
  7. New arrivals.
  8. "Put your brand on it" + "Request a product we don't list".
  9. Recently viewed.
  10. Footer.
- **Products page:**
  - filters: price, MOQ, lead time, verified, customisable, samples, in MOQ pool; sort.
  - **Product page:** price by quantity table, MOQ, lead time, sample, material, customisation; Request quote / Order a sample / Add your brand.
  - **Request form**, pre-filled: quantity with MOQ check, target price, ship to, customisation, notes, files → creates RFQ-<n> (sourcing fee rule from settings). Samples → SRV-.
- **Quote list (new):** customers add several products and send one request for all of them. Table `quote_list_items` (company, product, qty, notes).
- **Phone:** compact header with search, bottom tabs Shop · Categories · Pools · Quote list · Account (Account opens the panel in the same tab).
- **Data:** the same customer-safe queries as the public site. No supplier names, codes, cost or margin anywhere; product images and file names carry no supplier or factory codes. Each rail loads on its own (Suspense) with its own empty state. Rails are personalised by the company's categories, past requests and viewed products, with popular items as the fallback.

## 2. Roles and security (both tabs)

- Every number and item respects the person's role (Owner, Buyer, Warehouse, Store manager, Accounts) and the company's services.
- Pay later never appears unless the company is `credit_eligible`.
- 2-step code for withdrawals, bank-detail changes, team changes and store connections.

## 3. CH-2 — Account panel: home and all pages (tab 2)

Match `screens/CustomerHome.html`, `mobile/M_CustomerHome.html`, `states/States-CustomerHome.html` for the panel home (Waiting for you, Wallet, Browse products ↗, Your services, In progress, Account manager), then each page below. Build after CH-1 is approved. Same rules: plan first, staging, full suite, screenshots per design file. Each page has a phone version (`mobile/M_<file>.html`); tables scroll sideways on the phone.

| Design file | Page | Route | Must do |
|---|---|---|---|
| `screens/C_Action.html` | Action needed | /account/action | Every item waiting for the company across services, filter by service, one action each, "Done recently" with who did it. |
| `screens/C_Sourcing.html` | Sourcing requests | /account/sourcing, /account/sourcing/[code] | List with status chips; selected request: progress stepper, quotes side by side (price/unit, MOQ, lead time, sample), choose option → proforma (PF-) with deposit; sample first; ask a question; decline (closes, notifies staff, no charge). Codes RFQ-<n>, SRV-. "Verified supplier" only. |
| `screens/C_Orders.html` | Orders | /account/orders, /account/orders/[id] | One list for Sourcing, Turnkey, Warehouse and Shipping orders with payment + status; detail: timeline, total/paid/balance, Pay balance, QC report, invoice, help. Pay now / Payment protection; Pay later only if credit eligible. |
| `screens/C_Turnkey.html` | Turnkey projects | /account/turnkey, /account/turnkey/[id] | Project cards with stage + progress; detail: milestones, payments (deposit/balance from settings), documents with upload. |
| `screens/C_Warehouse.html` | Warehouse (3PL) | /account/warehouse | Stock (on hand, reserved, available, low stock), inbound shipments (confirm details), outbound order, fee list from settings. Only the company's own items. |
| `screens/C_Shipping.html` | Shipping | /account/shipping | Quote (from, to, weight, box → services, days, price from rate cards incl. markup), parcels list, tracking timeline. Unknown route = "No price for this route". |
| `screens/C_Brand.html` | Make My Brand | /account/brand, /account/brand/[id] | Stage bar, proof preview, comments, Approve proof / Request changes (logged), brand details, history. |
| `screens/C_Wallet.html` | Wallet | /account/wallet | Available / held / invoices due; bank transfer details from Admin › Payment settings with the company reference; transactions with running balance; statement download; withdraw and bank changes need a 2-step code. |
| `screens/C_Invoices.html` | Invoices and documents | /account/invoices | PF-, OCT-[div]-, CN-, STMT-DS- with type, service, date, amount, status, PDF; issuer from the legal entity; download all. |
| `screens/C_Team.html` | Team and settings | /account/settings, /account/team | Team list, invite with role per service (Owner, Buyer, Warehouse, Store manager, Accounts), company details (locked after verification), notifications, security; invites/role changes need a 2-step code; staff emails can't be customer members; can't remove the last owner. |

**Sidebar:** Overview (Home, Action needed), Services (Sourcing requests, Orders, Turnkey projects, Warehouse (3PL), Shipping, Make My Brand, Dropshipping), Money (Wallet, Invoices), Account (Team and settings, Support), company switcher at the top, and a blue **"Browse products ↗"** button at the bottom that opens the shop in a new tab.

**Navigation:**
- The sidebar active item and `aria-current` follow the page.
- Phone tabs: Home (home, action), Requests (sourcing), Orders, Wallet (wallet, invoices), More (everything else).
- Every page has loading, empty and error states and a clear empty state for new companies.
- Sample numbers in the designs are examples only.


## 4. CH-3 — Staff panel: customer finance and follow-up

Match `staff/Staff_CustomerFinance.html`. Route `/office/customers/[id]` (extend the existing admin customer page; don't duplicate it).

- **Header:**
  - company, customer since, country, account manager;
  - badges: KYC, services, Pay later eligibility (staff only), overdue;
  - buttons: Add follow-up, Send payment reminder, Open as customer (read-only, with no sign-in as the customer and no changes).
- **Tabs:** Overview, Finance, Follow-ups, Requests and orders, Documents, Notes.
- **Money tiles:** wallet available, held, due in 7 days, overdue (red), paid in last 90 days.
- **Money due table:** document, service, amount, due, status, reminders sent, action (Remind now / Hold shipment).
  - Automatic reminders 3 days before, on the due date and 7 days after (settings).
  - "Remind now" is at most once per day, logged.
  - "Hold shipment" blocks shipping until paid; releasing it is logged.
- **Payments received** with "Match a payment" (bank transfers by reference).
- **Credit and limits:** Finance only. Pay later eligibility, holds, adjustments over US$ 1,000 need a second Finance approver.
- **Follow-ups:**
  - tasks with due date, linked item, owner, status; Done / Edit / Accept;
  - suggested tasks from real events: quote expiring, money due or overdue, low stock, no activity for 30 days.
- **Activity and notes:** timeline of calls, emails, quotes and reminders; add a note, or a note + follow-up.
- **New tables:** `follow_up_tasks`, `customer_notes`, reminder log. All audit-logged.
- **Access:** Support sees status and notes but not credit settings or adjustments. Account managers see their own customers; admin and Finance see all.


## 5. Tests

- **Sign-in redirects:**
  - a customer lands on `/shop`; staff on `/office`; suppliers on their portal;
  - a safe `?next=` is followed and an unsafe one is ignored;
  - a signed-in customer opening `/` lands on `/shop`.
- **New-tab links** exist with `rel=noopener` and the screen-reader text; on phones they open in the same tab.
- **One session:** signing out in one tab signs out the other.
- **Shop:** filters, sort, product page tiers, request form (MOQ check, RFQ created), quote list (several products → one request), dropship rail gated.
- **Panel:** each page and state; role filtering (a Warehouse-only member sees only 3PL); company switcher.
- **Staff panel:** reminder rules, hold shipment, permissions (Support can't see credit), audit log.
- **No supplier/cost leaks** in HTML, JSON or file names.
- **axe** at 1280 and 390 px.
- **Full** Playwright + DB suites; ledger diff 0.
