# Prompt — Public main page, shop and customer account panel (CH-0, CH-1, CH-2, CH-3)

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
| Link to the other | "My account ↗" in the header and the welcome strip | "Browse products ↗" at the bottom of the sidebar and on the panel home |

- After sign-in: customers → `/shop` (respect a safe same-site `?next=`); staff → `/office`; suppliers → their portal; Shopify embedded → `/shop` is not used there (`/shopify`).
- A signed-in customer opening `/`, `/login` or `/signup` goes to `/shop`.
- Links between the two areas open in their OWN NAMED TAB on desktop: the shop uses `target="octopus-shop"` and My account uses `target="octopus-account"` (no `rel=noopener` on these same-site links, so the browser reuses the open tab instead of opening copies). They have a ↗ icon and the screen-reader text "(opens in a new tab)". On phones they open in the same tab. External links keep `target="_blank" rel="noopener"`.
- Both tabs share one session. Signing out in one signs out both. Notifications and wallet numbers are the same in both.

## Logo

Use the logo files in `assets/` (see the README "Logo" section). Don't use a text logo.
- Navy mark on white headers; white mark on navy headers.
- The tagline version only at 200 px wide or more: the footer, the sign-in side panel and the My account sidebar.
- The "B2B" box stays blue on every background.
- **Logo link:**
  - On the introduction website, the logo goes to `/`. When the visitor is already signed in, it goes to `/shop`.
  - In the Shop and in **My account**, the logo goes to the **main page after login (`/shop`)**. From My account it uses `target="octopus-shop"`, so it switches to the open shop tab instead of opening a copy; on phones it opens in the same tab. Its `aria-label` is "Octopus B2B, go to the main page".
  - My account's own home is reached with **Home** in the sidebar.
- **"Go to the main page" icon in My account:** at the top right of every My account page, between "New request" and notifications, there is a shop icon button (44 px, light blue).
  - It links to `/shop` with `target="octopus-shop"`.
  - `aria-label` "Go to the main page (shop, opens in the shop tab)", and a tooltip "Go to the main page" on hover and keyboard focus.
  - On phones, the same icon sits in the header next to search and opens `/shop` in the same tab.
  - Test: clicking it brings the shop tab forward on `/shop` without opening a duplicate tab.
  - Test: click the logo in My account on desktop → the shop tab comes to the front on `/shop`, and no new tab opens if the shop tab is already open.
- Also generate the favicon and app icons from `octopus-b2b-logo-original-transparent.png`.

## Navigation system (applies to every page below)

Match these files:
- `screens/Nav_Map.html`
- `screens/Nav_Components.html`
- `screens/Nav_Phone.html`
- `states/States-Nav.html`
- the applied examples: `Nav_ProductTabs`, `Nav_AccountOrders` and `Nav_OrderDetail`, each with its `M_` version.

**Build each pattern once as a component and reuse it everywhere:**
- SectionBar (with More ▾ overflow) and MegaMenu
- Tabs (underline), FilterPills, Segmented and CardTabs
- Stepper (horizontal and vertical) and Breadcrumbs
- AccountSidebar (full and collapsed)
- BottomNav and Sheet

**Use one tab style per job, never per service:**
- Underline tabs inside one record: product, request, order, project, Warehouse.
- Pill filters on lists.
- Card tabs for the numbers at the top of Orders, Requests and Wallet.
- Segmented control for 2–3 views.
- Stepper for processes.

**Every page:**
- Tabs and filters are kept in the URL (`?tab=`, `?status=`, `?service=`, `?view=`) and read from it on load.
- A tab panel loads the first time it opens and keeps its state when you switch back.
- Each panel has its own loading, empty and error state.

**Phones:**
- Bottom bars: Shop · Categories · Pools · Cart · My account, and Home · Requests · Orders · Wallet · More.
- "More" and "Categories" open bottom sheets. Filters open a full-screen sheet.
- Back closes the open sheet first.

**Tests:**
- Arrow keys move between tabs; Home and End jump to the first and last tab.
- `?tab=documents` opens on the Documents tab.
- Filters survive a reload.
- At 1100 px, More ▾ holds the extra sections.
- Under 1200 px the sidebar collapses, and the icons keep their names and tooltips.
- No horizontal scroll at 390 px, except inside tab rows.

## 0. CH-0 — Public main page (signed out)

Match `screens/Public_Home.html` and `mobile/M_Public_Home.html`. Route `/`. Signed-in customers who open `/` go to `/shop`.

The page has these sections, in this order:

1. **Sticky header:** the logo; a menu with Services ▾ (lists the six services), How it works, MOQ pools, Shipping and duties and Help; Sign in (`/login?next=/shop`) and Create free account (`/signup`). On phones, a menu button opens a full-screen menu.
2. **Hero:** the headline "Source, store and sell from China. One account for all of it.", two buttons, the line "Free to join · Open to verified companies · Pay per order", and a picture of the shop's six sections.
3. **Trust strip:** verified suppliers only; quality check before you pay in full; Payment protection; one wallet, one account.
4. **Six ways to work with us:** Sourcing, MOQ pools, Dropshipping, Warehouse (3PL), Turnkey projects and Make My Brand, in the same colours and icons as the shop sections. Each card shows minimum order, how you pay and who it's best for, and links to `/services/[name]`.
5. **Comparison table:** minimum order, who holds the stock, typical time and how you pay. On phones it scrolls sideways with the first column fixed.
6. **How it works:** 4 steps.
7. **Two tabs after sign-in:** the shop and the account panel.
8. **MOQ pools explained:** a pool card labelled **Example**, plus the 4 pool rules, including that the deposit is refunded if the pool doesn't fill.
9. **Quality and payments** (dark band): quality check, Payment protection (30% deposit, balance before shipping), shipping and duties up front, and the delivery countries.
10. **FAQ:** `<details>` items.
11. **Final call to action.**
12. **Footer:** columns Services, Help, Company and Legal, plus the legal name.

Rules:
- Countries, deposit %, pool minimum and fees come from site settings. Don't hard-code them.
- No customer logos, testimonials, staff photos or "X buyers" counts until they are real and approved.
- Never mention Pay later.
- One H1, a meta description and Organization structured data.
- Tests: signed out sees this page; signed in is redirected to `/shop`; there is no horizontal scroll at 390 px; every button and link is at least 44 px tall.

## 0b. CH-0b — Sign in with Google, first-time setup and the three tabs

Match these files:
- `screens/Flow_SignInTabs.html` (how it works and what each part is called)
- `screens/Auth_SignIn.html` and `mobile/M_Auth_SignIn.html`
- `screens/Auth_Setup.html` and `mobile/M_Auth_Setup.html`
- `states/States-Auth.html`

**The three tabs:**
- Tab 1 is the introduction page `/`. It only explains the application.
- Tab 2 is the shop `/shop`, the main page after login.
- Tab 3 is My account `/account`.

**Signing in:**
1. On `/`, "Continue with Google" and "Sign in" are links to `/login?next=/shop` with `target="octopus-shop"`. The click opens tab 2 directly, so no pop-up is involved.
2. `/login` has "Continue with Google" (use Google's official button), or work email. It calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin + '/auth/callback?next=/shop' } })`.
3. `/auth/callback` exchanges the code. If the user has no company yet, they go to `/welcome/setup`; otherwise they go to `next`.
4. `/welcome/setup` asks once for company name, country, phone (WhatsApp), role and which of the six services they want (optional). It creates the company and the owner membership in one transaction, then goes to `/shop`. Invited users skip it. It does not ask for KYC.

**Moving between tabs:**
- Shop header "My account ↗" uses `target="octopus-account"`. My account's "Browse products ↗" uses `target="octopus-shop"`.
- Same-site named targets have no `rel=noopener`, so the existing tab is reused.

**Sign-out and returning visitors:**
- Signing out sends a message on BroadcastChannel `octopus-auth`. Other tabs show the "You signed out" overlay.
- When the visitor is signed in, tab 1 replaces Sign in with "Go to my shop ↗".

**Accounts and email:**
- A verified email that already has an account signs in to that same account; don't create a duplicate.
- One login per person. Teammates join through invites from My account › Team. If the invite email doesn't match the Google account, show the mismatch state.

**Phones:** no target attribute; everything happens in the same tab.

**Tests:**
- Google sign-in on staging with a test Google account.
- A first sign-in shows setup; the second sign-in skips it.
- "My account ↗" clicked twice leaves one tab.
- Signing out in tab 3 shows the overlay in tab 2.
- A cancelled Google sign-in shows the cancelled state.
- An invite opened with the wrong email shows the mismatch state.
- No live sign-ins during release checks.

## 1. CH-1 — Shop (tab 2, the main page after login)

**The main page after login is `/shop`. Match `screens/Shop_Main.html` and `mobile/M_Shop_Main.html`.** It replaces the earlier `Shop_Home` and `Shop_AllProducts` designs. `/shop/all` redirects to `/shop`. Keep those two files only for card details.

The page, from top to bottom:
1. **Header:** search, **Cart** (with count), notifications and **My account ↗** (`target="octopus-account"`).
2. **Section bar:** All categories, Sourcing products, MOQ pools, Turnkey projects, Dropshipping, Warehouse (3PL), Make My Brand, Samples, New arrivals, and the wallet balance.
3. **Welcome bar:**
   - a greeting by time of day, with the company name and the wallet balance;
   - up to 3 waiting items, taken from the same list as My account › Action needed. Each opens My account in its tab. If nothing is waiting, the bar says "You're all set";
   - **Open My account ↗**.
4. **Category chips:** one choice filters all six sections at once.
5. **Jump bar.**
6. **The six separate sections:** Sourcing, MOQ pools, Dropshipping, Warehouse (3PL), Turnkey, Make My Brand. Products are not mixed. The service picked first during setup moves to the top.
7. **Recently viewed.**
8. **"Can't find what you need? Request a product."**

The rest of this part describes the other shop pages.


Match `screens/Shop_Home.html`, `mobile/M_Shop_Home.html`, `screens/Shop_Products.html`, `mobile/M_Shop_Products.html`. Then the detailed shop pages:

- **All products, one page** `/shop/all`: match `screens/Shop_AllProducts.html` and `mobile/M_Shop_AllProducts.html`. Products are **not mixed**. The page has 6 separate sections in a fixed order: Sourcing products, MOQ pools, Dropshipping, Warehouse (3PL), Turnkey projects, Make My Brand.
  - Each section has its own colour, icon, name, count and one-line explanation, then 4 items, then "See all" to that type's own page (/shop/products, /shop/pools, /shop/dropship, /shop/warehouse, /shop/turnkey, /shop/brand).
  - Each section's cards use that type's buttons: Request quote + Add to list; Join pool; Add to import list; View project; Brand it.
  - At the top: Category, Ships to and Sort, which apply to every section, and a jump bar that stays at the top while scrolling and moves focus to the chosen section.
  - Each section loads on its own; one failing section shows "Couldn't load this section · Try again". An empty section says "No [type] in this category yet" and is never hidden without a message.
  - Dropshipping prices only with Dropship access. Closed or full pools are not listed. No supplier names.
  - **Warehouse (3PL)** cards are services, not products: storage (pallet/shelf per month), receiving and quality check, pick-pack-ship, kitting and labelling. Rates come from the 3PL rate settings and show [RATE] until the owner sets them. "Get a quote" opens the 3PL quote form, prefilled with the service. The customer's stock and fees live in the account panel › Warehouse.
  - The shop menu bar now includes **Warehouse (3PL)** (between Dropshipping and Make My Brand), and the shop footer links to it.
  - On phones, each section's cards scroll sideways.
- **Product page** `/shop/products/[slug]`: match `screens/Shop_ProductPage.html` and `mobile/M_Shop_ProductPage.html`. It has:
  - a price calculator: the customer types a quantity and sees the tier, unit price, total and the next tier;
  - below MOQ, the page says so and disables Request quote;
  - the shipping estimate comes from the rate cards; if there is none, show "Quoted at order";
  - specifications, customisation options with their minimums, questions and similar products;
  - three actions: Request quote, Add to cart and Order a sample;
  - "Ships from" shows the country only; no supplier names, codes or factory photos with logos.
- **MOQ pools** `/shop/pools` and `/shop/pools/[id]`: match `screens/Shop_Pools.html` and `mobile/M_Shop_Pools.html`.
  - Joining places a wallet hold of [POOL DEPOSIT %].
  - If the pool fills, the balance invoice is issued. If it doesn't fill, the hold is released to the wallet automatically on the closing date and the customer is notified.
  - Show the buyer count, never other buyers' names. Closing times are in the customer's time zone.
- **Turnkey** `/shop/turnkey` and `/shop/turnkey/[slug]`: match `screens/Shop_Turnkey.html` and `mobile/M_Shop_Turnkey.html`.
  - The page has the ready projects, the project page and the start form.
  - Sending the form creates a Turnkey request in the panel and notifies the account manager. Nothing is charged before the proforma is approved.
  - The deposit rule comes from settings.
- **Shopping cart** `/shop/cart`: match `screens/Cart_Page.html` and `mobile/M_Cart_Page.html`. **One cart replaces the Quote list.**
  - One cart per company, shared by its team, saved across devices. The header and the phone bottom bar show **Cart** with the total item count.
  - Underline tabs: **Buy now · Get a quote · Saved for later**.
  - **Buy now** holds fixed-price items, paid at checkout:
    - samples;
    - ready stock in our warehouse (quantity stepper, tier prices, minimum);
    - MOQ pool joins (a deposit is held; the % comes from pool settings; refunded if the pool doesn't fill);
    - Make My Brand options;
    - warehouse (3PL) services at rate-card prices.
  - **Get a quote** holds factory-made products. Each line has quantity, target price and customisation, plus one note box for all lines. "Send quote request" creates one RFQ with one line per product; if the RFQ model has no lines, it creates one RFQ per product, grouped in the panel. Tell me which one before building. Send is disabled while any line is below its MOQ, with the reason next to the button. The lines leave the cart once sent.
  - "Add to cart" opens a **side panel** from the right with a confirmation, the first lines, the subtotal, **Checkout** and **View cart**.
  - Prices and stock are re-checked when the cart opens and at checkout; any change is shown. Pools that close move to Get a quote.
- **Checkout** `/shop/checkout`: match `screens/Cart_Checkout.html` and `mobile/M_Cart_Checkout.html`. Four steps on one page (Delivery → Shipping → Payment → Review); finished steps fold up with "Change".
  - **Delivery:** saved addresses, or add one. Services and designs need no shipping.
  - **Shipping:** chosen **per parcel**. Samples go by express courier; ready stock by sea or air. Prices come from the rate cards, or "Quoted at order" when there is no rate. Pool items ship when the pool fills.
  - **Payment:**
    - **Wallet**, paid instantly. If the balance is short, show "Wallet + card".
    - **Card** through the payment provider. Store only the provider's payment reference, **never card numbers**. Show any card fee before payment.
    - **Bank transfer:** issue a PF- proforma; the bank details come from Admin › Payment settings; stock is held 3 days.
    - **Payment protection:** money is held and released per order after the QC passes. Only for ready stock, branding and services.
    - Pool deposits are always held.
  - **Review:** terms checkbox, then **Place order · pay [total]**. Totals are recalculated on the server; if anything changed, show the change and ask again.
  - Checkout needs a verified company. If the company isn't verified, the cart is kept and the page shows "Verify in My account ↗".
- **Order placed** `/shop/checkout/done`: match `screens/Cart_Done.html` and `mobile/M_Cart_Done.html`.
  - One checkout number (CO-) and one order per type, linked to it: OCT-SMP- (samples), OCT-STK- (ready stock), the pool hold, OCT-MMB- (Make My Brand) and SRV- (services).
  - Each line has "View ↗", which opens My account. There's a receipt PDF and an email.
  - Quote items stay in the cart.
- **Cart states:** match `states/States-Cart.html`: side panel, empty cart, price changed, not enough stock, pool closed, not verified, wallet not enough, card declined, waiting for bank transfer, quote sent, saved for later.
- **States**: match `states/States-Shop.html`: categories menu, no results ("Request this product"), loading skeleton, one failing section, company not verified (can browse and request, can't pay), below MOQ, pool full, and the added-to-cart toast.
- Tests: quantity → tier price; below MOQ blocks Request quote and Send; pool join creates a hold, and a pool that doesn't fill releases it (rolled-back test); the cart's Get a quote part sends one request; checkout totals match the server; wallet, card (provider test mode on staging only), bank transfer and Payment protection each create the right orders and ledger entries in a rolled-back test; an unverified company can't reach payment; no supplier names in any shop HTML.

- **Header (every shop page):**
  - logo → `/shop`;
  - big search (products, MOQ pools, turnkey projects);
  - **Cart** with count;
  - notifications;
  - **My account ↗**.
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
- **Cart (new):** one cart per company with Buy now and Get a quote parts (see Shopping cart above). Tables `carts`, `cart_items`.
- **Phone:** compact header with search, bottom tabs Shop · Categories · Pools · Cart · My account (My account opens the panel in the same tab).
- **Data:** the same customer-safe queries as the public site. No supplier names, codes, cost or margin anywhere; product images and file names carry no supplier or factory codes. Each rail loads on its own (Suspense) with its own empty state. Rails are personalised by the company's categories, past requests and viewed products, with popular items as the fallback.

## 2. Roles and security (both tabs)

- Every number and item respects the person's role (Owner, Buyer, Warehouse, Store manager, Accounts) and the company's services.
- Pay later never appears unless the company is `credit_eligible`.
- 2-step code for withdrawals, bank-detail changes, team changes and store connections.

## 3. CH-2 — My account: home and all pages (tab 3)

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
- **Named-tab links**: clicking "My account ↗" twice gives one My account tab, not two; "Browse products ↗" returns to the existing shop tab; on phones they open in the same tab.
- **One session:** signing out in one tab signs out the other.
- **Shop:** filters, sort, product page tiers, request form (MOQ check, RFQ created), cart (Buy now checkout; Get a quote → one request), dropship rail gated.
- **Panel:** each page and state; role filtering (a Warehouse-only member sees only 3PL); company switcher.
- **Staff panel:** reminder rules, hold shipment, permissions (Support can't see credit), audit log.
- **No supplier/cost leaks** in HTML, JSON or file names.
- **axe** at 1280 and 390 px.
- **Full** Playwright + DB suites; ledger diff 0.
