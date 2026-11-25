# Octopus Dropship – design v2 (UI/UX package)

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
| states/States-*.html | All states per area | (every screen) | each step, checked in 13 |

Phone: `mobile/M_<Screen>.html` matches `screens/<Screen>.html` below 768 px.

## Shells
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
