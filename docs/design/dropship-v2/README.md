# Octopus Dropship – design v2 (UI/UX package)

> **Start here:** `NEW-THEME-MASTER-PROMPT.md` is the master prompt for switching the whole application to the new theme (ODS 1.0), end to end. It replaces the older prompts where they disagree. Tokens: `specs/ods-tokens.css`.


Open any file in a browser. This folder is the design source of truth for Antigravity.
Put it in the repo at `docs/design/dropship-v2/` (not inside `public/`).

## What is NOT UI
These are design annotations. Do not build them:
- The cream **"What changed"** boxes and orange **NEW** tags (they explain changes from design v1).
- The dashed **"Build notes for Antigravity"** boxes (they are requirements for you, not screen content).
- The "Sample data for design review only" lines.

All numbers are sample data. `[SQUARE BRACKETS]` are values that come from settings or real data. Never ship either.

## Folders
| Folder | Contents |
|---|---|
| `screens/` | 24 merchant desktop screens (1280 px) + 2 early-access screens |
| `mobile/` | Phone versions (390 px) of every merchant screen + `M_More.html` |
| `staff/` | 13 staff screens (/office/dropship and Finance) |
| `states/` | Loading, empty, error and success states for every area |
| `specs/` | `Components.html` (every component and state), `Flows.html` (the clickable journeys), `Main.html` (overview), `tokens.css` |
| `assets/` | Octopus Dropship logo (white for dark backgrounds, colour, SVG) |

## Screens, routes and build steps
| File | Screen | Route | Build step (master prompt) |
|---|---|---|---|
| screens/Activate.html | Start dropshipping | /account/dropship (when not switched on) | 4 |
| screens/Onboarding.html | Onboarding (4 steps) | /account/dropship/onboarding | 4 |
| screens/Dashboard.html | Dashboard | /account/dropship | EA-2, 13 |
| screens/Catalog.html | Find products | /account/dropship/catalogue | 3 |
| screens/ProductDetail.html | Product detail | /account/dropship/catalogue/[id] | 3 |
| screens/LandedCost.html | Landed cost calculator | /account/dropship/landed-cost | 3 |
| screens/RequestProduct.html | Request a product | /account/dropship/requests | 3 |
| screens/SampleOrder.html | Order a sample | /account/dropship/sample | 3 (off in early access) |
| screens/ImportList.html | Import list | /account/dropship/catalogue?list=1 | 6 |
| screens/ProductEditor.html | Product editor | /account/dropship/import/[id] | 6 |
| screens/PushStore.html | Push to store | /account/dropship/push | 6 |
| screens/Pushed.html | Pushed products | /account/dropship/pushed | 6, 11 |
| screens/Pricing.html | Pricing and sync | /account/dropship/pricing | 6, 11 |
| screens/PackingShipping.html | Packing and shipping | /account/dropship/packing | 6b |
| screens/StoresWeb.html | Stores | /account/dropship/stores | 5 |
| screens/Stores.html | App inside Shopify admin | /shopify (embedded) | 5 |
| screens/Orders.html | Orders | /account/dropship/orders | 7, 8 |
| screens/OrderDetail.html | Order detail and problems | /account/dropship/orders/[id] | 10 |
| screens/TrackPage.html | Buyer tracking page | /t/[token] (public) | 9 |
| screens/Wallet.html | Wallet | /account/dropship/wallet | 8 (early access: top-up) |
| screens/Billing.html | Plan and billing | /account/dropship/billing | 12, 12b |
| screens/Reports.html | Reports | /account/dropship/reports | 13 |
| screens/Settings.html | Settings | /account/dropship/settings | 13 |
| screens/Support.html | Support | /account/dropship/support | 10 |
| staff/StaffCatalog.html | Products and HS review | /office/dropship | 2 |
| staff/StaffImport.html | Import products (5-step wizard, from Sourcing) | /office/dropship/import | 2 |
| staff/StaffProductEdit.html | Staff product editor | /office/dropship/[id] | 2 |
| staff/StaffCompliance.html | Duty, tax and customs | /office/dropship/compliance | EA-1 |
| staff/StaffQueue.html | Fulfilment queue and exceptions | /office/dropship/queue | 9 |
| staff/StaffPackStation.html | Pack station and label | /office/dropship/pack/[order] | 9 |
| staff/StaffMerchants.html | Merchants and access requests | /office/dropship/merchants | 4 |
| staff/StaffFees.html | Fees, internal charges, plans | /office/dropship/fees | EA-1, 12 |
| staff/StaffHealth.html | System health | /office/dropship/health | 13 |
| staff/FinanceSaaS.html | SaaS billing: plan-fee switch and 30-day trial | /admin/finance/saas | 12b |
| screens/EA_Dashboard.html | Dashboard, early access version | /account/dropship | EA-2 |
| screens/EA_PublicDropship.html | Public Dropship page (signed out) | /request/dropship | EA-2 |
| staff/StaffRateCards.html | Shipping rates (rate cards, price-list import, approval, test quote) | /office/dropship/rates | EA-1 |
| staff/StaffDutyEntries.html | Duty and tax entries (country + HS prefix, de minimis, approval) | /office/dropship/compliance | EA-1 |
| staff/StaffRequests.html | Product requests queue and landed quote | /office/dropship/requests | Batch 3 (align), 3 |
| states/States-Stores.html | Store connection states (disconnect, reconnect, uninstall, sandbox) | /account/dropship/stores, /shopify | 5 |
| screens/CustomerHome.html | Customer account panel home (back office, tab 2): waiting for you, wallet, services, in progress, account manager | /account | CH-2 |
| screens/Shop_Home.html | Shop: main page after login (all products, pools, turnkey, dropship; quote list; 'My account panel ↗') | /shop | CH-1 |
| screens/Shop_Products.html | Shop: products, filters, product page, request a quote | /shop/products, /shop/products/[slug] | CH-1 |
| screens/Public_Home.html | Public main page (signed out): six ways to work with us, comparison, how it works, two tabs after sign-in, MOQ pools, quality and payments, FAQ | / | CH-0 |
| mobile/M_Public_Home.html | Public main page (phone) | / | CH-0 |
| screens/Shop_Main.html | **Customer main page after login** (welcome bar with 3 waiting items, category chips, jump bar, six separate sections, recently viewed). Replaces Shop_Home and Shop_AllProducts | /shop | CH-1 |
| mobile/M_Shop_Main.html | Customer main page after login (phone) | /shop | CH-1 |
| screens/Nav_Map.html | Navigation: full site map of the 3 tabs and which navigation pattern each page uses | all | NAV |
| screens/Nav_Components.html | Navigation components with states, sizes and keyboard rules (section bar + overflow, mega menu, underline tabs, pill filters, segmented, card tabs, stepper, breadcrumbs, sidebar, bottom bar) | all | NAV |
| screens/Nav_Phone.html | Phone navigation: full-screen menu, Categories sheet, More sheet, Filters sheet | all (< 768 px) | NAV |
| states/States-Nav.html | Navigation states: overflow open, lazy loading, tab error, empty tab, keyboard focus, no results, collapsed sidebar, phone tabs | all | NAV |
| screens/Nav_ProductTabs.html / mobile/M_Nav_ProductTabs.html | Product page with underline tabs + Sea/Air segmented | /shop/products/[slug]?tab= | NAV |
| screens/Nav_AccountOrders.html / mobile/M_Nav_AccountOrders.html | My account › Orders: card tabs, pill filters, List/Board | /account/orders | NAV |
| screens/Nav_OrderDetail.html / mobile/M_Nav_OrderDetail.html | Order detail: stepper + underline tabs | /account/orders/[ref] | NAV |
| screens/Flow_SignInTabs.html | How sign-in with Google and the three tabs work, and what each part is called | /, /login, /shop, /account | CH-0b |
| screens/Auth_SignIn.html | Sign in with Google (or work email) | /login | CH-0b |
| mobile/M_Auth_SignIn.html | Sign in (phone) | /login | CH-0b |
| screens/Auth_Setup.html | First-time company setup | /welcome/setup | CH-0b |
| mobile/M_Auth_Setup.html | First-time company setup (phone) | /welcome/setup | CH-0b |
| states/States-Auth.html | Sign-in states: already signed in, cancelled, failed, signed out in another tab, expired, invite, wrong email, phone | /login, all tabs | CH-0b |
| screens/Cart_Page.html / mobile/M_Cart_Page.html | Shop: **cart** with two parts: Buy now (samples, ready stock, pool deposits, Make My Brand, warehouse services) and Get a quote (factory products → one RFQ); Saved for later. Replaces the Quote list | /shop/cart | CART |
| screens/Cart_Checkout.html / mobile/M_Cart_Checkout.html | Checkout: Delivery → Shipping (per parcel) → Payment (wallet, card, bank transfer, Payment protection) → Review | /shop/checkout | CART |
| screens/Cart_Done.html / mobile/M_Cart_Done.html | Order placed: one checkout, one order number per type | /shop/checkout/done | CART |
| states/States-Cart.html | Cart states: side panel after Add to cart, empty, price changed, stock reduced, pool closed, not verified, wallet not enough, card declined, waiting for bank transfer, quote sent, saved for later | /shop/cart, /shop/checkout | CART |
| screens/Shop_AllProducts.html | Shop: all products and services on one page in 6 separate sections (Sourcing, MOQ pools, Dropshipping, Warehouse (3PL), Turnkey, Make My Brand), jump bar, See all per section | /shop/all | CH-1 |
| screens/Shop_ProductPage.html | Shop: full product page (gallery, price tiers, quantity price calculator, specs, customise, questions, similar) | /shop/products/[slug] | CH-1 |
| screens/Shop_Pools.html | Shop: MOQ pools list, pool page, join form, refund rule, timeline | /shop/pools, /shop/pools/[id] | CH-1 |
| screens/Shop_Turnkey.html | Shop: Turnkey ready projects, project page (included, price, 6 steps), start form | /shop/turnkey, /shop/turnkey/[slug] | CH-1 |
| states/States-Shop.html | Shop states (categories menu, no results, loading, section error, company not verified, below MOQ, pool full, added toast) | /shop/* | CH-1 |
| staff/Staff_CustomerFinance.html | Staff: customer finance and follow-up (money due, reminders, payments, credit, follow-up tasks, notes) | /office/customers/[id] | CH-3 |
| screens/C_Action.html | Action needed | /account/action | CH-2 |
| screens/C_Sourcing.html | Sourcing requests and quote comparison | /account/sourcing | CH-2 |
| screens/C_Orders.html | Orders across services + order detail | /account/orders | CH-2 |
| screens/C_Turnkey.html | Turnkey projects: milestones, payments, documents | /account/turnkey | CH-2 |
| screens/C_Warehouse.html | Warehouse (3PL): stock, inbound, fees | /account/warehouse | CH-2 |
| screens/C_Shipping.html | Shipping: quote, parcels, tracking | /account/shipping | CH-2 |
| screens/C_Brand.html | Make My Brand: proof review | /account/brand | CH-2 |
| screens/C_Wallet.html | Wallet: balance, bank transfer, transactions | /account/wallet | CH-2 |
| screens/C_Invoices.html | Invoices and documents | /account/invoices | CH-2 |
| screens/C_Team.html | Team and settings: roles, company, security | /account/settings | CH-2 |
| states/States-CustomerHome.html | Customer home states (new customer, KYC, empty, loading, error, company switcher, limited role) | /account | CH-1 |
| states/States-*.html | All states per area | (every screen) | each step, checked in 13 |

Phone: `mobile/M_<Screen>.html` matches `screens/<Screen>.html` below 768 px.

## Shells
- **Customer account shell (all services):** sidebar Overview (Home, Action needed), Services (Sourcing requests, Orders, Turnkey projects, Warehouse (3PL), Shipping, Make My Brand, Dropshipping), Money (Wallet, Invoices), Account (Team and settings, Support); company switcher at the top; 'Browse products ↗' at the bottom opens the shop in a new tab. The shop header has 'My account panel ↗' (new tab). Phone tabs: Home, Requests, Orders, Wallet, More (mobile/M_CustomerHome.html). The Dropship area keeps its own sidebar inside /account/dropship.
- **Merchant sidebar:** groups Sell (Dashboard, Find products, Import list, Orders), Set up (Pricing and sync, Packing and shipping, Stores), Money (Wallet, Plan and billing, Reports), Account (Settings, Support). Store switcher at the top; active item has a teal inset bar and `aria-current="page"`.
- **Top bar (every page):** search (orders, products, DS model no.), notifications with count, help, account.
- **Phone:** top bar with logo, store and notifications; bottom tabs Home, Find, Orders, Wallet, More. In early access the tabs are Home, Find, Requests, Wallet, More (see mobile/M_EA_Dashboard.html).
- **Early access sidebar:** Sell (Dashboard, Find products, Product requests), Money (Wallet), Account (Settings, Support). Hidden features redirect to the dashboard; no "coming soon" labels (screens/EA_Dashboard.html).
- **Staff menu:** Products, Import products, Product editor, Product requests, Duty tax and customs, Shipping rates, Fulfilment queue, Pack station, Merchants, Fees and plans, System health, Finance: SaaS billing.
- **Content width:** max 1240 px, centred.

## Icons (lucide-react names, or nearest equivalent)
| Design | lucide-react | Design | lucide-react |
|---|---|---|---|
| grid | LayoutGrid | search | Search |
| list | List | cart | ShoppingCart |
| tag | Tag | box / package | Box / Package |
| store | Store | wallet | Wallet |
| chart | BarChart3 | card | CreditCard |
| gear | Settings | help | CircleHelp |
| plus | Plus | check | Check |
| x | X | alert | TriangleAlert |
| info | Info | stop | CircleX |
| clock | Clock | refresh | RefreshCw |
| upload | Upload | download | Download |
| truck | Truck | link | Link |
| pencil | Pencil | eye | Eye |
| globe | Globe | shield | Shield |
| users / user | Users / User | bell | Bell |
| file | FileText | arrow | ArrowRight |
| sparkle | Sparkles | code | Code |
| image | Image | scale | Scale |
| percent | Percent | home | House |
| more | Ellipsis | dollar | DollarSign |
| send | Send | layers | Layers |
| activity | Activity | flag | Flag |
| lock | Lock | | |

16–20 px, stroke about 1.9, `currentColor`, `aria-hidden="true"`. Status badges: ok = Check, warn = TriangleAlert, bad = CircleX, info = Info. No emoji anywhere.

## Business rules the UI must show
- White-label: merchants and buyers never see supplier or factory names, Sourcing model numbers, Octopus cost or margin.
- Pay later is only for Octopus group companies and test accounts; never shown to customers, not even disabled.
- Dropship model numbers: DS-000001, variants DS-000001-01; generated, locked, never reused.
- Every price shows Processing as its own line; duties (DDP or DAP) are set only on Packing and shipping.
- Request codes: Sourcing requests show the real RFQ code (e.g. RFQ-1042); sample/service requests use SRV-. "SR-" is never used.
- Dropship product requests are free (service price dropship_request = 0, Finance can change it).
- Sample orders: wallet only, 1–3 units, processing fee included, refused when duty for a DDP route is unknown; listed on the weekly STMT-DS statement.
- Stock is shown to merchants as a label only (In stock, Low stock, Out of stock, Extended), never a number.
- A paused or closed merchant can't start anything new, but keeps orders in progress, wallet, withdrawals, statements, support and data export.
- Dropship access needs KYC-verified company + staff approval; losing KYC pauses Dropship automatically.
- No label prints until staff approve the merchant's return/brand profile, and the item's HS code is verified.
- Placeholder pages say honestly what is coming; never blank, never fake numbers.
- Plan fees are free until Finance switches them on; then a 30-day free trial; Shopify merchants approve in Shopify.


## Logo (Octopus B2B)

The files are in `assets/`:

| File | Use |
|---|---|
| octopus-b2b-logo-mark.png | Navy, no tagline. For headers on white (introduction page, sign-in on phones, setup). |
| octopus-b2b-logo-mark-white.png | White, no tagline. For headers on navy (shop header, phone headers). |
| octopus-b2b-logo.png | Navy, with "Global Sourcing, Simplified". Only at 200 px wide or more. |
| octopus-b2b-logo-white.png | White, with tagline. For the footer, the sign-in side panel and the My account sidebar. |
| octopus-b2b-logo-original.jpg / -original-transparent.png | The owner's original file, full size. |

Rules:
- Never redraw or recolour the logo; the blue "B2B" box stays blue on every background.
- `alt="Octopus B2B"`.
- The logo is always a link:
  - on the introduction website, it goes to `/`;
  - in the Shop, it goes to the main page after login, `/shop`;
  - in My account, it ALSO goes to the main page after login, `/shop`, switching to the shop tab (`target="octopus-shop"`). On phones it opens in the same tab.
- In My account, "Home" in the sidebar is the way to My account's own home.
- Use the tagline version only at 200 px wide or more.


## Back Office (staff) in ERP style — `backoffice/`

| File | Screen | Route |
|---|---|---|
| backoffice/ERP_Dashboard.html | Staff dashboard: KPI strip, My work, money in/out, receivables ageing, pools closing, activity | /office |
| backoffice/ERP_Invoices.html | Accounts › Invoices: KPI strip, status tabs, filter chips, saved views, dense grid, bulk bar, Record payment drawer | /office/accounts/invoices |
| backoffice/ERP_Customer.html | Customer record (360): header, underline tabs, company, money, open items, orders, activity | /office/customers/[id] |
| backoffice/ERP_Components.html | ODS 1.0 compact: colours from the logo, two densities, buttons and inputs, workspace tabs, data grid, status pills, shortcuts, drawer/dialog/menu/toast | — |
| backoffice/ERP_States.html | Command palette, unsaved changes, too many tabs, loading, empty, no permission, second approver, collapsed sidebar | — |
| backoffice/M_ERP_Approvals.html | Phone: approvals only | /office/approvals |

Build prompt: `BACK-OFFICE-ERP-PROMPT.md`.
