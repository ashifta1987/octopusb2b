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
| `screens/` | 24 merchant desktop screens (1280 px) |
| `mobile/` | Phone versions (390 px) of every merchant screen + `M_More.html` |
| `staff/` | 10 staff screens (/office/dropship and Finance) |
| `states/` | Loading, empty, error and success states for every area |
| `specs/` | `Components.html` (every component and state), `Flows.html` (the clickable journeys), `Main.html` (overview), `tokens.css` |
| `assets/` | Octopus Dropship logo (white for dark backgrounds, colour, SVG) |

## Screens, routes and build steps
| File | Screen | Route | Build step |
|---|---|---|---|
| screens/Activate.html | Start dropshipping | /account/dropship (when not switched on) | 3 |
| screens/Onboarding.html | Onboarding (4 steps) | /account/dropship/onboarding | 3, 4 |
| screens/Dashboard.html | Dashboard | /account/dropship | 3 |
| screens/Catalog.html | Find products | /account/dropship/catalogue | 2 |
| screens/ProductDetail.html | Product detail | /account/dropship/catalogue/[id] | 2 |
| screens/LandedCost.html | Landed cost calculator | /account/dropship/landed-cost | 2, 6b |
| screens/RequestProduct.html | Request a product | /account/dropship/requests | Integration phase 1, 12 |
| screens/SampleOrder.html | Order a sample | /account/dropship/sample | 12 |
| screens/ImportList.html | Import list | /account/dropship/catalogue?list=1 | 5 |
| screens/ProductEditor.html | Product editor | /account/dropship/import/[id] | 5 |
| screens/PushStore.html | Push to store | /account/dropship/push | 5 |
| screens/Pushed.html | Pushed products | /account/dropship/pushed | 5, 6 |
| screens/Pricing.html | Pricing and sync | /account/dropship/pricing | 6 |
| screens/PackingShipping.html | Packing and shipping | /account/dropship/packing | 6b |
| screens/StoresWeb.html | Stores | /account/dropship/stores | 4 |
| screens/Stores.html | App inside Shopify admin | /shopify (embedded) | 4 |
| screens/Orders.html | Orders | /account/dropship/orders | 7 |
| screens/OrderDetail.html | Order detail and problems | /account/dropship/orders/[id] | 7, 11 |
| screens/TrackPage.html | Buyer tracking page | /t/[token] (public) | 10 |
| screens/Wallet.html | Wallet | /account/wallet (shared) | 8 |
| screens/Billing.html | Plan and billing | /account/dropship/billing | 12, 12b |
| screens/Reports.html | Reports | /account/dropship/reports | 12 |
| screens/Settings.html | Settings | /account/dropship/settings | 12 |
| screens/Support.html | Support | /account/dropship/support | 11, 12 |
| staff/StaffCatalog.html | Products and HS review | /office/dropship | 2 |
| staff/StaffImport.html | Import products (5-step wizard, from Sourcing) | /office/dropship/import | 2, Integration phase 1 |
| staff/StaffProductEdit.html | Staff product editor | /office/dropship/products/[id] | 2 |
| staff/StaffCompliance.html | Duty, tax and customs | /office/dropship/compliance | 2, 10 |
| staff/StaffQueue.html | Fulfilment queue and exceptions | /office/dropship/queue | 9, 11 |
| staff/StaffPackStation.html | Pack station and label | /office/dropship/pack/[order] | 9, 10 |
| staff/StaffMerchants.html | Merchants and access requests | /office/dropship/merchants | 3, 9 |
| staff/StaffFees.html | Fees, internal charges, plans | /office/dropship/fees | 6b, 12 |
| staff/StaffHealth.html | System health | /office/dropship/health | 9 |
| staff/FinanceSaaS.html | SaaS billing: plan-fee switch and 30-day trial | /admin/finance/saas | 12b |
| states/States-*.html | All states per area | (every screen) | each step, checked in 13 |

Phone: `mobile/M_<Screen>.html` matches `screens/<Screen>.html` below 768 px.

## Shells
- **Merchant sidebar:** groups Sell (Dashboard, Find products, Import list, Orders), Set up (Pricing and sync, Packing and shipping, Stores), Money (Wallet, Plan and billing, Reports), Account (Settings, Support). Store switcher at the top; active item has a teal inset bar and `aria-current="page"`.
- **Top bar (every page):** search (orders, products, DS model no.), notifications with count, help, account.
- **Phone:** top bar with logo, store and notifications; bottom tabs Home, Find, Orders, Wallet, More.
- **Staff menu:** Products, Import products, Product editor, Duty tax and customs, Fulfilment queue, Pack station, Merchants, Fees and plans, System health, Finance: SaaS billing.
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
- Plan fees are free until Finance switches them on; then a 30-day free trial; Shopify merchants approve in Shopify.
