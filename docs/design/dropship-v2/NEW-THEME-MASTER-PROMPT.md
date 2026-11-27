# MASTER PROMPT — Octopus B2B new theme (ODS 1.0), end to end

Version 1.0 · 27 Nov 2026 · for Antigravity
Scope: every page a visitor, customer, merchant or staff member can open on hostoctopus.com.
Design package: `docs/design/dropship-v2/`. Copy the latest `octopus-dropship-design-v2.zip` there first.

Read this whole prompt before writing code. Then read, in this order:
1. `README.md`, the index of every design file;
2. `UI-RULES.md`;
3. `PROJECT-MEMORY.md`;
4. `specs/ods-tokens.css`;
5. the boards listed under each page below ("Match:").

When this prompt and an older prompt disagree, **this prompt wins**. The older prompts are `COMPLETE-SYSTEM-PROMPT.md`, `CUSTOMER-HOME-PROMPT.md` and `BACK-OFFICE-ERP-PROMPT.md`. Keep using them only for business logic that this prompt doesn't repeat.

---

## PART 0 — What you are building

The look and navigation of the whole application change to **ODS 1.0 (Octopus Design System)**. All business logic stays.

| Area | Who | Opens in | Density | Main navigation |
|---|---|---|---|---|
| Introduction website | Visitors (signed out) | Browser tab 1 | Comfortable | Header menu + mega menu; full-screen menu on phones |
| **Shop** (main page after login) | Customers | Named tab `octopus-shop` | Comfortable | Header + section bar (More ▾ overflow); bottom bar on phones |
| **My account** (customer back office) | Customers and merchants | Named tab `octopus-account` | Comfortable | Sidebar (collapses under 1200 px); bottom bar on phones |
| **Back Office** (staff ERP) | Octopus staff | Its own tab; workspace tabs inside | **Compact** | Collapsible sidebar + browser-style workspace tabs + Ctrl K |
| Shopify embedded app | Merchants inside Shopify admin | Inside Shopify | Shopify (Polaris) | Shopify's own; ODS colours only where Shopify allows |

**What changes, old → new:**

| Old | New |
|---|---|
| Text logo | Real Octopus B2B logo files (`assets/`) |
| After login → public website | After login → **Shop** (`/shop`) in its own tab |
| Quote list | **Cart** with two parts: Buy now + Get a quote, plus Checkout |
| Mixed product rows | Six separate sections: Sourcing, MOQ pools, Dropshipping, Warehouse (3PL), Turnkey, Make My Brand |
| Different tab styles per service | One tab style **per job**, the same in every service |
| Merchant app with its own sidebar | Dropshipping lives inside My account (a sidebar group) |
| Staff pages in many layouts | One staff shell in ERP style with workspace tabs |
| Email/password only | **Continue with Google** first, work email second |

---

## PART 1 — Rules that never change (stop and ask if anything conflicts)

1. **Keep business logic.** Keep all business logic, database tables, RLS, permissions, APIs, webhooks, cron jobs and money flows. This is a new theme and navigation, not a rewrite. Never change a money calculation while restyling a page.
2. **Release method** (exactly as in PROJECT-MEMORY §2):
   1. Live backup.
   2. Read-only baseline.
   3. Clean `git archive` + `vercel deploy --prod --skip-domain`: remote build, never `--prebuilt`.
   4. `db-migrate.mjs --live`.
   5. Checks.
   6. Promote + revalidate.
   7. Merge `main` last.
3. **Before any live step:**
   - the **full** Playwright suite and **all** DB suites pass on staging;
   - any migration that isn't in the approved plan stops the release;
   - every migration has a `.down.sql`, and the round-trip diff is empty;
   - the ledger diff is 0.
4. **Never sign in to live**, and never create accounts on live. Live checks are read-only SQL, or rolled-back SQL with a simulated JWT. The owner checks screens himself.
5. **Nothing goes to live without the owner's explicit "go".** Staging first, with test accounts only.
6. **Secrets** are set by the owner in Vercel or local env files only. Never print, store or commit them, and never ask for them in chat.
7. **White-label.** Customers, merchants and buyers never see:
   - supplier or factory names or codes;
   - Sourcing model numbers;
   - cost or margin.

   That applies to pages, JSON, PDFs, exports, image file names and URLs. Staff see these only with the matching permission.
8. **Pay later is internal only** (`credit_eligible`). It never appears for other customers, not even disabled.
9. **No fake data shown as real.** Placeholders say what is coming. No stock photos of "our team", no invented testimonials, logos or "X buyers" counts.
10. **Card data only on the payment provider's page or fields.** Bank details live in Admin › Payment settings, never in code.
11. **Never delete data on live** without the owner's OK. Archive instead.
12. **Codes:**
    - `RFQ-<n>`, `SRV-`, `PF-`, `OCT-[div]-[year]-[seq]`, `CN-`, `STMT-DS-`, `DS-000001(-01)`;
    - new: `CO-` checkout, `OCT-SMP-` (sample), `OCT-STK-` (ready stock), `OCT-MMB-` (Make My Brand), `CUS-` (customer number in the Back Office).
    - Never `SR-`.
13. **Routes.** Don't rename existing routes unless the owner approves. If one is renamed, add a permanent redirect and update links and tests. The staff area keeps its current base path (`/admin` today). The designs label it `/office`; read every `/office/...` below as "the staff base path".

---

## PART 2 — ODS 1.0 design system

### 2.1 Package

- Create `packages/ui` (npm name `@octopus/ui`) **inside this repository**: tokens, components and hooks. Don't create a separate repository yet.
- **Keep the current UI stack. Do not switch frameworks.**
- Add only:
  - **TanStack Table** and **TanStack Virtual** (data grids);
  - **cmdk** (command palette);
  - **lucide-react** (icons), if not already present.
- Every component:
  - works in both densities;
  - has a story, test page or demo route at `/dev/ui`, staging only;
  - meets the accessibility rules in 2.9.

### 2.2 Tokens — replace `specs/tokens.css` with `specs/ods-tokens.css` (full file in Appendix A)

**Colours, taken from the logo.** Never use any other colours for these jobs.

| Token | Hex | Use |
|---|---|---|
| `--ods-navy` | #1A174A | Text, headings, customer sidebar, dark bands |
| `--ods-navy-dark` | #14123B | Back Office top bar, footer |
| `--ods-navy-hover` | #2E2B66 | Selected sidebar item |
| `--ods-blue` | #2A6FD1 | Primary buttons, links, selection, active tab bar |
| `--ods-blue-hover` | #1F5BB0 | Hover/pressed primary |
| `--ods-blue-tint` | #EAF1FC | Selected background, info |
| `--ods-teal` | #5FD3C9 | Accent: active sidebar marker, hero CTA on navy, avatar |
| `--ods-canvas` | #F4F6F9 | Page background |
| `--ods-surface` | #FFFFFF | Cards, panels |
| `--ods-line` | #E3E7EF | Borders, grid lines |
| `--ods-line-strong` | #C9D0DD | Inputs, secondary buttons |
| `--ods-slate` | #5B6478 | Secondary text (meets 4.5:1 on white) |
| `--ods-success` | #0B7A75 | Paid, approved, done steps |
| `--ods-warning` | #B54708 | Due soon, waiting, unsaved |
| `--ods-danger` | #B42318 | Overdue, errors, destructive |
| `--ods-focus` | #F59E0B | Focus ring, 3 px |

**The six service colours** (customer areas only, always shown with a name and icon, never colour alone):

| Service | Tint | Strong | Icon |
|---|---|---|---|
| Sourcing | #EAF1FC | #1D4E9A | box |
| MOQ pools | #E3F5F3 | #0B5F5B | users |
| Dropshipping | #F0EBFB | #5B3AA8 | truck |
| Warehouse (3PL) | #EDEFF8 | #3B4687 | package |
| Turnkey projects | #FDF1E6 | #94420A | layers |
| Make My Brand | #FCE9F1 | #A11B5A | sparkle |

**Typography:** Inter (400/500/600/700). Use tabular figures for all numbers in tables and money.

| Style | Comfortable | Compact |
|---|---|---|
| Display (hero) | 52/1.08 desktop, 34 phone | — |
| H1 page title | 28–30 / 1.2 (22–24 phone) | 20 / 1.2 |
| H2 section | 20–22 | 15 |
| Body | 15–16 / 1.6 | 13 / 1.5 |
| Table | 14 | 13 |
| Label | 12–13, 600 | 12, 600 |
| Small / meta | 12–13 | 11–12 |

**Spacing** on a 4 px base: 4, 8, 12, 16, 20, 24, 32, 48, 72, 80.
- Comfortable page padding: 24–32 px desktop, 16 px phone.
- Compact: 12–16 px.

**Radius:**
- Comfortable: controls 8–10, cards 12–16, pills 999.
- Compact: 6 everywhere, status pills 4.

**Shadows:** cards `0 1px 2px rgba(26,23,74,.05)`; menus and drawers `0 12px 32px rgba(26,23,74,.14)`; dialogs `0 16px 40px rgba(26,23,74,.18)`. Nothing else.

**Sizes:**

| Size | Comfortable | Compact |
|---|---|---|
| Buttons and inputs | 44 px | 32 px |
| Table rows | 52 px | 36 px |
| Table header | 44 px | 34 px |
| Tap targets | ≥ 44 px always on phones | — |

**Breakpoints:** phone < 768, tablet 768–1199, desktop ≥ 1200. Content max width 1240 (customer), fluid (staff).

**Motion:** 150–200 ms ease-out for menus, drawers and tab indicators. Respect `prefers-reduced-motion`. No decorative animation, no glassmorphism, no gradients except the hero, the shop welcome bar and the sign-in panel.

**Densities:** `<html data-density="comfortable|compact">`. Customer areas are comfortable; staff areas are compact. Components read density from tokens, never from separate code.

**Z-index scale:** base 0, sticky 10, dropdown 20, drawer 30, modal 40, toast 50, palette 60.

### 2.3 Logo (`assets/`)

| File | Where |
|---|---|
| `octopus-b2b-logo-mark.png` (navy, no tagline) | White headers: introduction header, sign-in on phones, setup |
| `octopus-b2b-logo-mark-white.png` | Navy headers: Shop header, phone headers, Back Office top bar |
| `octopus-b2b-logo-white.png` (with tagline) | Footer, sign-in side panel, My account sidebar (≥ 200 px wide only) |
| `octopus-b2b-logo.png` | Large white areas only |
| `octopus-b2b-logo-original-transparent.png` | Source for the favicon, apple-touch-icon and PWA icons (generate 16, 32, 180, 192, 512) |

Rules:
- Never redraw or recolour the logo; the B2B box stays blue. `alt="Octopus B2B"`.
- The logo is always a link:
  - on the introduction site, to `/` (or `/shop` when signed in);
  - in the Shop, to `/shop`;
  - in **My account, to `/shop` with `target="octopus-shop"`**;
  - in the Back Office, to `/office`.

### 2.4 Icons

Use Lucide at 14 px (compact), 16–18 px (comfortable) and 20–22 px (phone bottom bar), with a 1.9 stroke. Icons next to text are `aria-hidden`. Icon-only buttons need an `aria-label` and a tooltip.

### 2.5 Components (build once in `@octopus/ui`, reuse everywhere)

**Navigation**

| Component | Where | Must have |
|---|---|---|
| `PublicHeader` | Introduction site | Logo; Services ▾ (mega menu with the six services); How it works; MOQ pools; Shipping and duties; Help; Sign in; **Continue with Google**. Sticky. Phones: Sign in + menu button opening a full-screen menu. Signed in: "Go to my shop ↗" |
| `ShopHeader` | Shop | Logo; search (products, pools, projects); **Cart** with count; notifications; **My account ↗** (`target="octopus-account"`) |
| `SectionBar` | Shop | All categories ▾ (mega menu); Sourcing products; MOQ pools; Turnkey projects; Dropshipping; Warehouse (3PL); Make My Brand; Samples; New arrivals; wallet balance. Selected item: bold with a 3 px blue underline. Under 1200 px, items that don't fit move into **More ▾ (count)** |
| `MegaMenu` | Introduction site and Shop | Opens on click. Four columns plus one promoted box. Esc closes and returns focus |
| `AccountSidebar` | My account | Logo with tagline (→ `/shop`); company switcher; groups Overview, Services, Money, Account; red counts; selected item has a 3 px teal bar; services not started show "Start"; **Browse products ↗** at the bottom. 248 px, collapsing to 72 px icons with tooltips under 1200 px. The choice is remembered |
| `AccountTopbar` | My account | Search (requests, orders, invoices); New request; **shop icon "Go to the main page"** (`target="octopus-shop"`); notifications; help; user menu |
| `OfficeTopbar` | Back Office | Logo; app switcher; Ctrl K search button; + New ▾; notifications; help; user name and role |
| `OfficeSidebar` | Back Office | 232/56 px; groups Sales, Services, Accounts, Catalogue, Website, Admin; groups collapse; counts; Ctrl B |
| `Workspace` | Back Office | Browser-style tabs (rules in Part 7) |
| `BottomNav` | Phones | Shop: Shop · Categories · Pools · Cart · My account. My account: Home · Requests · Orders · Wallet · More. Back Office: Home · Approvals · Search · Alerts. 60 px, labels always visible, badges, selected = blue with a top bar |
| `Sheet` | Phones | Bottom sheet (More, Categories) and full-screen sheet (Filters, menus). Drag handle, close button; Back closes; focus is trapped |
| `Breadcrumbs` | Every page below level 1 | `nav aria-label="Breadcrumb"`; the last item is bold and not a link. Phones show only "‹ Parent" |

**Tabs and selection — one style per job, never per service**

| Component | Use for | Spec |
|---|---|---|
| `Tabs` (underline) | Parts of ONE record: product, request, order, project, Warehouse, customer | 48 px (36 compact); selected = navy bold + 3 px (2 compact) blue bar; counts after the label; sticky under the page header; tablist/tab/tabpanel; arrow keys, Home/End; `?tab=` in the URL; lazy panels that keep their state |
| `FilterPills` | Filtering lists, category chips, the shop jump bar | 40 px (28 compact chips); selected = navy fill + check mark; counts; `aria-pressed`; the result count is read out with `aria-live` |
| `Segmented` | 2–3 views: Sea/Air, List/Board, Month/Quarter/Year | Grey track, white selected segment with a shadow; 40 px (32 compact) |
| `CardTabs` | Numbers that filter: top of Orders, Requests, Wallet | ≥ 96 px; selected = 2 px blue border + light blue; 4 per row (2 on phones) |
| `Stepper` | Order progress, pool, Turnkey, checkout, verification | Done = teal check; now = blue with halo; next = grey outline; horizontal on desktop, vertical on phones; `aria-current="step"` |
| `JumpBar` | Shop main page | Sticky pill links to the six sections, with counts; focus moves to the section heading |

**Content and data**

| Component | Spec |
|---|---|
| `Card`, `Panel` | Comfortable cards 12–16 radius with 20–24 padding. Compact panels: 6 radius, 40 px header, 12 padding |
| `ServiceSection` | Coloured section for one service: left 6 px bar, icon tile, name + count, one-line explainer, "See all …", 4 items (sideways scroll on phones) |
| `ProductCard` variants | `SourcingCard` (from price, MOQ, delivery; Request quote + Add to cart); `PoolCard` (pool vs normal price, progress bar, closes in, join from; Join pool); `DropshipCard` (your price, no minimum, landed cost; Add to import list; no price without access → Request access); `ServiceCard` (3PL: rates or [RATE]; Get a quote); `TurnkeyCard` (from, timeline, includes; View project); `BrandCard` (from, MOQ, proof time; Brand it) |
| `KpiStrip` | One bordered row of 4–5 figures (compact), or KPI cards (comfortable) |
| `DataTable` (comfortable) | 52 px rows; on phones it becomes stacked cards, never a sideways-scrolling table for main lists |
| `OctopusDataGrid` (compact) | Specs in Part 7 |
| `StatusPill` | Dot + text. One shared list of status names (Appendix C) |
| `Money` | Always `US$ 1,234.56`; tabular figures; negatives as `−US$ 420.00`; never a bare number in money columns |
| `Timeline`, `ActivityFeed` | Dot + title + date/actor |
| `EmptyState`, `ErrorState`, `Skeleton` | Every list, panel and tab has all three |

**Forms and overlays**

| Component | Spec |
|---|---|
| `Field` | Label above (12–13 px, 600), required `*`, hint below, error below in danger red with an icon. Never use placeholder text as a label |
| `Input`, `Select`, `Textarea`, `NumberInput` (right-aligned), `QuantityStepper` (− value +), `DateInput`, `FileDrop` | 44/32 px |
| `RadioCards` | Payment, shipping and address choices. Selected = 2 px blue border + tint |
| `Drawer` | Right side; 380 px (mini-cart, comfortable) or 460 px (compact edit); Ctrl S saves, Esc closes with the unsaved-changes guard |
| `Modal` | Only to confirm something that can't be undone. The destructive button is red and named after the action ("Cancel invoice", not "OK") |
| `Toast` | Navy, bottom; Undo where possible; `role="status"` |
| `Tooltip` | On hover and focus; 300 ms delay |
| `CommandPalette` | Staff: Ctrl K. Later, customers: "/" opens search |
| `ContextMenu` | Right-click or ⋯ on grid rows |

### 2.6 Writing style for every screen

- Plain English, sentence case, short.
- Buttons say what happens: "Pay balance US$ 2,870.00", "Send quote request · 3 products".
- Errors say what happened and what to do next. Never blame the user, never use technical codes.
- Disabled buttons always show **why**, next to them.
- No "Coming soon" on live pages that work; placeholders say what is coming and when it is known.

### 2.7 Money, dates, numbers

- US$ everywhere for customers (AED and other currencies come later).
- Dates show as `27 Nov 2026`, or `27 Nov` within the current year; time as `18:00 (Dubai time)`.
- Customers see their own time zone. Staff see theirs, plus UTC in the audit log.

### 2.8 URL state

Tabs, filters, sort, view and page live in the URL (`?tab=`, `?status=`, `?service=`, `?view=`, `?sort=`, `?page=`). Back and Forward work, and links can be shared.

### 2.9 Accessibility (blocking — a release fails if these fail)

- WCAG 2.2 AA:
  - contrast ≥ 4.5:1 for text and ≥ 3:1 for UI;
  - focus ring 3 px #F59E0B on every focusable element;
  - full keyboard use;
  - landmarks (`header`, `nav`, `main`, `footer`);
  - one H1 per page.
- Tap targets ≥ 44 px (comfortable).
- No information shown by colour alone.
- `aria-current` for navigation; `aria-live` for result counts and toasts.
- Labels on all inputs.
- Run axe on every page in Playwright, with 0 serious or critical issues.

### 2.10 Performance

- LCP < 2.5 s on 4G for `/`, `/shop` and `/account`. CLS < 0.1.
- JS per route < 200 KB gzip (customer areas).
- Images: next/image with width/height, lazy below the fold.
- Each shop section and each dashboard panel loads on its own. One failing section never blanks the page.

---

## PART 3 — Site map and routes (all pages, end to end)

The "Design" column lists the files to match. Each has an `M_` phone version where one exists in `mobile/`.

### 3.1 Introduction website (signed out) — tab 1

| Route | Page | Design |
|---|---|---|
| `/` | Introduction (main page) | `screens/Public_Home.html`, `mobile/M_Public_Home.html` |
| `/services/sourcing`, `/pools`, `/dropship`, `/warehouse`, `/turnkey`, `/brand` | One page per service | Use the Public_Home section and card patterns (Part 4.1) |
| `/how-it-works`, `/shipping`, `/help` | Info pages | Same patterns |
| `/request/dropship` | Public Dropship page (early access) | `screens/EA_PublicDropship.html` |
| `/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/refunds` | Legal pages | Plain document layout. Real text comes from the owner; until then, honest placeholders |

### 3.2 Sign-in

| Route | Page | Design |
|---|---|---|
| `/login?next=` | Sign in with Google or work email | `screens/Auth_SignIn.html`, `mobile/M_Auth_SignIn.html` |
| `/auth/callback` | Code exchange → setup or next | — |
| `/welcome/setup` | First-time company setup | `screens/Auth_Setup.html`, `mobile/M_Auth_Setup.html` |
| `/invite/[token]` | Accept a team invite | `states/States-Auth.html` |
| Flow and naming | — | `screens/Flow_SignInTabs.html` |

### 3.3 Shop — tab 2 (`target="octopus-shop"`)

| Route | Page | Design |
|---|---|---|
| `/shop` | **Main page after login** | `screens/Shop_Main.html`, `mobile/M_Shop_Main.html` |
| `/shop/all` | Redirect → `/shop` | — |
| `/shop/products` | Sourcing products: filters + grid | `screens/Shop_Products.html` |
| `/shop/products/[slug]?tab=` | Product page with tabs | `screens/Nav_ProductTabs.html` (tabs) + `screens/Shop_ProductPage.html` (content per tab) |
| `/shop/pools`, `/shop/pools/[id]` | MOQ pools and join | `screens/Shop_Pools.html` |
| `/shop/dropship` | Dropshipping catalogue (gated) | Uses the merchant Catalog (`screens/Catalog.html`) in shop layout |
| `/shop/warehouse` | Warehouse (3PL) services | `ServiceCard` grid + `Segmented` Storage / Fulfilment |
| `/shop/turnkey`, `/shop/turnkey/[slug]`, `/shop/turnkey/[slug]/start` | Turnkey | `screens/Shop_Turnkey.html` |
| `/shop/brand` | Make My Brand options | `BrandCard` grid |
| `/shop/search?q=&type=` | Search results | Pill type filters + six-section result groups |
| `/shop/cart` | Cart: Buy now / Get a quote / Saved for later | `screens/Cart_Page.html`, `mobile/M_Cart_Page.html` |
| `/shop/checkout` | Checkout | `screens/Cart_Checkout.html` |
| `/shop/checkout/done?co=` | Order placed | `screens/Cart_Done.html` |
| States | — | `states/States-Shop.html`, `states/States-Cart.html` |

### 3.4 My account — tab 3 (`target="octopus-account"`)

| Route | Page | Design |
|---|---|---|
| `/account` | Home | `screens/CustomerHome.html`, `mobile/M_CustomerHome.html`, `states/States-CustomerHome.html` |
| `/account/action` | Action needed | `screens/C_Action.html` |
| `/account/requests`, `/account/requests/[RFQ-n]` | Sourcing requests (+ detail with underline tabs) | `screens/C_Sourcing.html` |
| `/account/orders`, `/account/orders/[ref]?tab=` | Orders (+ detail) | `screens/Nav_AccountOrders.html`, `screens/Nav_OrderDetail.html` (replace `C_Orders.html`) |
| `/account/turnkey`, `/account/turnkey/[id]` | Turnkey projects | `screens/C_Turnkey.html` (detail = stepper + tabs, like the order detail) |
| `/account/warehouse?tab=` | Warehouse: Stock · Inbound · Outbound · Fees | `screens/C_Warehouse.html` |
| `/account/shipping` | Shipping | `screens/C_Shipping.html` |
| `/account/brand?tab=` | Make My Brand: Proofs · Files · Orders | `screens/C_Brand.html` |
| `/account/dropship/*` | **Dropshipping merchant app** (Part 6) | `screens/` Activate … Support, `EA_Dashboard` |
| `/account/wallet` | Wallet | `screens/C_Wallet.html` |
| `/account/invoices` | Invoices and documents | `screens/C_Invoices.html` |
| `/account/settings?tab=` | Team and settings (vertical tabs) | `screens/C_Team.html` |
| `/account/support` | Support: Open · Closed | `screens/Support.html` pattern |
| Navigation | — | `screens/Nav_Map.html`, `screens/Nav_Components.html`, `screens/Nav_Phone.html`, `states/States-Nav.html` |

### 3.5 Back Office (staff, base path `/admin`, shown as `/office`)

| Route | Page | Design |
|---|---|---|
| `/office` | Dashboard | `backoffice/ERP_Dashboard.html` |
| `/office/my-work`, `/office/approvals` | My work, Approvals | Dashboard "My work" panel as a full page (grid) |
| `/office/customers`, `/office/customers/[id]` | Customers, customer record | `backoffice/ERP_Customer.html`, plus `staff/Staff_CustomerFinance.html` content |
| `/office/rfqs`, `/office/quotes`, `/office/orders` | Sales | Grid pattern from `ERP_Invoices` |
| `/office/pools`, `/turnkey`, `/brand`, `/dropship`, `/warehouse`, `/shipping` | Services | Grid + record pattern. Existing staff boards: `staff/StaffQueue`, `StaffPackStation`, `StaffMerchants`, `StaffRequests`, `StaffRateCards`, `StaffDutyEntries` |
| `/office/accounts/invoices` | Invoices | `backoffice/ERP_Invoices.html` |
| `/office/accounts/payments`, `/wallets`, `/credit-notes`, `/ledger`, `/bank`, `/reports` | Accounts | Grid pattern; `staff/FinanceSaaS`, `StaffFees` |
| `/office/catalogue/products`, `/suppliers` | Catalogue | `staff/StaffCatalog`, `StaffImport`, `StaffProductEdit`, `StaffCompliance` |
| `/office/website` | Pages and banners | Grid + drawer editing |
| `/office/admin/roles`, `/settings`, `/audit`, `/health` | Admin | Grid pattern; `staff/StaffHealth` |
| Components and states | — | `backoffice/ERP_Components.html`, `backoffice/ERP_States.html`, `backoffice/M_ERP_Approvals.html`, `states/States-Staff.html` |

---

## PART 4 — Page specs: introduction website and sign-in

### 4.1 `/` Introduction (main page) — Match: `Public_Home`, `M_Public_Home`

**Purpose:** explain the application. Every main button is **Continue with Google**, which opens the Shop tab.

**Layout, top to bottom:**
1. **PublicHeader**, sticky.
2. **Hero** (navy gradient):
   - pill "For companies buying from China";
   - H1 "Source, store and sell from China. **One account for all of it.**" (the second sentence in teal);
   - a one-paragraph summary of the six services;
   - buttons **Continue with Google** (teal on navy, link `/login?next=/shop`, `target="octopus-shop"`) and **See how it works** (anchor);
   - small line "Free to join with your Google account · Opens the shop in a new tab";
   - on the right (desktop only), a picture of the shop with its six coloured sections.
3. **Trust strip**: verified suppliers only; quality check before you pay in full; Payment protection; one wallet, one account.
4. **Six ways to work with us**: 3×2 cards (1 column on phones). Each card: coloured top bar, icon, name, one line, Minimum order / You pay / Best for, and a link to `/services/[name]`.
5. **Comparison table**: rows Minimum order, Who holds stock, Typical time, You pay; columns are the six services. On phones it scrolls sideways with the first column fixed, plus a hint "Swipe the table sideways".
6. **How it works**: four numbered steps.
7. **After you sign in: two tabs, one login**: two browser-window cards (Shop, My account).
8. **MOQ pools explained**: a pool card labelled **Example**, plus the four pool rules.
9. **Quality and payments** (navy band): quality checked, safe payments, shipping and duties up front; delivery countries from settings, plus "More countries on request".
10. **FAQ** (`<details>`).
11. **Final call to action**: "Start with one product. Grow into all six."
12. **Footer**: logo with tagline; columns Services, Help, Company, Legal; legal name; "English · US$".

**Data:** site settings (countries, deposit %, pool minimum, fee text). No numbers are hard-coded.

**Signed-in visitor:** the header shows "Signed in as Anna · Go to my shop ↗", and Continue buttons go straight to `/shop`.

**SEO:** title "Octopus B2B — Source, store and sell from China"; meta description; Organization JSON-LD; OpenGraph image; one H1; indexable.

**Tests:**
- signed out sees the page;
- signed in sees "Go to my shop";
- every CTA links to `/login?next=/shop` with `target="octopus-shop"`;
- no horizontal scroll at 390 px except inside the comparison table;
- axe clean.

### 4.2 `/services/[name]` (six pages)

- Hero in the service colour: name, one line, Continue with Google.
- "How it works" with 3–4 steps.
- "What you pay": text from settings, no invented prices.
- Example cards, labelled **Example**.
- FAQ, then the final CTA.
- Same header and footer.

### 4.3 `/login` — Match: `Auth_SignIn`, `M_Auth_SignIn`

- **Desktop:** left navy panel (520 px) with the logo (tagline), "One account for all six.", the list of the six services with icons, and "Free to join · Open to verified companies".
- **Right side:**
  - H1 "Sign in or create your account";
  - one line "Use your work Google account. New here? The same button creates your free account.";
  - **Google's official "Sign in with Google" button** (use Google's asset and branding rules);
  - a divider "or";
  - Work email and **Continue with email** (magic link, or your current email method);
  - the terms line: "We only use your Google name, email and photo.";
  - an info box: "After you sign in, the shop opens here. Your account panel opens in its own tab from My account ↗."
- **Phones:** logo header, then the same form.
- **Behaviour:** `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin + '/auth/callback?next=' + next } })`. `next` must be a same-site path (validate it; never redirect off-site).
- **States** (`States-Auth`): cancelled, failed, session expired, invite, wrong Google account for an invite.

### 4.4 `/auth/callback`

- Exchange the code.
- If the user has no company membership → `/welcome/setup?next=`; otherwise → `next`.
- An existing verified email signs in to the same account (identity linking). Never create a duplicate person.
- Log `auth.sign_in` (method, success or failure) without tokens.

### 4.5 `/welcome/setup` — Match: `Auth_Setup`, `M_Auth_Setup`

- Header with the logo and "Step 1 of 1".
- A card with the avatar, name and email "signed in with Google".
- H1 "Welcome, Anna. Tell us about your company".
- Fields:
  - company name, required;
  - country, required, from launch countries + Other;
  - phone (WhatsApp), required, E.164 validation;
  - your role (Owner / director, Buyer, Store manager, Other);
  - **What would you like to do?**: six check cards in the service colours, optional.
- An info box: "Verify your company later. You can browse and send requests now. We ask for your trade licence before your first payment."
- Button **Go to the shop**: creates the company and the owner membership in **one transaction**, saves the interests, then goes to `/shop`.
- Invited users skip this page.

### 4.6 Sign-in states and tab behaviour — Match: `Flow_SignInTabs`, `States-Auth`

- **Named tabs:** introduction → Shop uses `target="octopus-shop"`; Shop → My account uses `target="octopus-account"`; My account → Shop (logo, shop icon, Browse products) uses `target="octopus-shop"`.
- These same-site links have **no `rel="noopener"`**, so the open tab is reused. External links keep `target="_blank" rel="noopener"`.
- **Phones (< 768 px):** no target attribute; everything opens in the same tab.
- **Sign-out:** broadcast on `BroadcastChannel('octopus-auth')`. Other tabs show "You signed out" with a Sign in button, and the introduction tab swaps back to Sign in.

---

## PART 5 — Page specs: Shop (tab 2)

### 5.1 Shop frame (every `/shop/*` page)

- **ShopHeader**, 68 px navy:
  - white logo mark (→ `/shop`);
  - search, placeholder "Search all products, MOQ pools and turnkey projects", with suggestions after 2 characters (products, pools, projects, categories);
  - **Cart (count)** → `/shop/cart`, which opens the mini-cart drawer on hover/click on desktop;
  - notifications;
  - **My account ↗**.
- **SectionBar**, 44 px white, with More ▾ overflow.
- **Footer:** service links, Help, Terms, Privacy, legal name.
- **Phones:** header with the logo, cart icon (count) and bell; search below; `BottomNav` Shop · Categories (sheet) · Pools · Cart (count) · My account.

### 5.2 `/shop` — Main page after login — Match: `Shop_Main`, `M_Shop_Main`

1. **Welcome bar** (navy gradient card):
   - "Good morning / afternoon / evening, Anna" (by local time);
   - "Anna Home Trading · Wallet US$ 4,250.00 available";
   - up to **3 waiting tiles**, from the same list as My account › Action needed, most urgent first. Each has an icon, title and one line, and opens My account in its tab. If nothing is waiting, the bar says "You're all set";
   - **Open My account ↗** (teal).
2. **Category chips** (scroll sideways): one choice filters all six sections at once and is kept in the URL.
3. **JumpBar**, sticky.
4. **Six ServiceSections**, in this fixed order: Sourcing → MOQ pools → Dropshipping → Warehouse (3PL) → Turnkey → Make My Brand.
   - The service the customer picked first during setup moves to the top.
   - Each section shows 4 cards (sideways scroll on phones) and "See all …".
   - Dropshipping without access shows the note "Prices and landed cost show after Dropship access is approved" and Request access.
   - The Warehouse section note: "Rates are confirmed in your quote. Your stock and fees show in My account › Warehouse."
5. **Recently viewed** (4 cards; Clear).
6. **"Can't find what you need?"** → Request a product.

**Data:**
- company, wallet balance, top 3 action items;
- per section, the top 4 by sort, filtered by category and ships-to;
- counts per type;
- recently viewed.

**States** (`States-Shop`):
- one section loading (skeleton);
- one section failed ("Couldn't load MOQ pools · Try again"), with the others still showing;
- empty category ("No [type] in this category yet");
- company not verified (banner "Verify in My account ↗"; can browse and request, can't pay).

**Tests:**
- the welcome tiles match `/account/action`;
- the category filter applies to all sections;
- one failing section doesn't blank the page;
- the setup choice reorders the sections;
- no supplier names anywhere in the HTML or JSON.

### 5.3 `/shop/products` — Match: `Shop_Products`

- Left filters (256 px): Category, Price, Minimum order, Ships to, Delivery, Verified supplier, Samples available, Customisable.
- Active filter chips with Clear all.
- Result count (`aria-live`); sort.
- Grid of 3 per row (1 per row on phones, with a "Filters (n)" full-screen sheet).
- Cards: SourcingCard.
- "Show more" or pagination; Request a product.

### 5.4 `/shop/products/[slug]` — Match: `Nav_ProductTabs`, `Shop_ProductPage`

1. Breadcrumbs.
2. Gallery (main image + 4 thumbnails; on phones, swipe with dots).
3. Badges: Verified supplier, Customisable, Samples available.
4. H1.
5. **Price tiers** table.
6. **Price calculator:** quantity → tier, unit price, total, next tier. Below MOQ: "Minimum order 500 sets" and Request quote disabled, with the reason.
7. MOQ, delivery time, sample price.
8. Shipping estimate with **Segmented Sea | Air**, from the rate cards, or "Quoted at order".
9. Actions: **Request quote** (creates an RFQ directly), **Add to cart** (goes to the cart's Get a quote part for factory products, or Buy now for ready stock), **Order a sample** (Buy now).
10. **Sticky underline tabs:** Details · Specifications · Customise · Shipping and duties · Questions (n) · Similar products.
    - Specifications is a table (key/value list on phones).
    - Customise is RadioCards with minimums, plus "Add your brand with Make My Brand".
    - Questions uses `<details>`.
    - Similar products loads lazily.

**White-label:** "Ships from China" only (no city or factory); no factory photos with logos. Certification documents are sent on request, never public links.

### 5.5 `/shop/pools` and `/shop/pools/[id]` — Match: `Shop_Pools`

**List:** pills Open · Closing soon · Almost full · Filled · My pools; sort; PoolCards.

**Pool page:**
- image; pool price vs normal price; target; closing time (customer's time zone);
- progress bar (`role="progressbar"` with values); buyer **count** only, never names;
- **Join form:**
  - units, from the minimum, in steps;
  - product total;
  - "Pay now ([deposit %] deposit, held)";
  - balance "When the pool fills, before shipping";
  - info "What if the pool doesn't fill? Your deposit returns to your wallet on the closing date.";
- **Join pool** adds a pool line to the cart (Buy now) and opens the mini-cart;
- timeline.

**Full or closed:** "This pool is full", Notify me.

### 5.6 `/shop/turnkey`, `/shop/turnkey/[slug]`, `/start` — Match: `Shop_Turnkey`

- **Ready projects:** TurnkeyCards.
- **Project page:** "What's included" table, Price card ("from"), and How it works (6 steps).
- **Start form:** products, quantity, budget, sell in, brief, files (FileDrop, 20 MB each), the info "Nothing is charged until you approve the proforma", Send project request, Save draft. Sending creates a Turnkey request in My account and notifies the account manager.

### 5.7 `/shop/dropship`, `/shop/warehouse`, `/shop/brand`, `/shop/search`

Grids of the matching card type, using the same filter and empty-state patterns.

- **Dropship:** gated. Without access → Request access; never show prices.
- **Warehouse:** `Segmented` Storage | Fulfilment; ServiceCards; Get a quote opens the 3PL quote form, prefilled.
- **Brand:** BrandCards; Brand it opens the Make My Brand start form.
- **Search:** results grouped into the six sections, with pill type filters.

### 5.8 Cart — `/shop/cart` — Match: `Cart_Page`, `M_Cart_Page`, `States-Cart`

- **One cart per company**, shared by its team and saved across devices. Header count = all lines.
- Ships-to line ("Ships to Dubai, United Arab Emirates · Change").
- **Underline tabs:** Buy now (n) · Get a quote (n) · Saved for later (n).

**Buy now** (fixed price, paid at checkout):
- Line types: Sample, Ready stock, MOQ pool (deposit held), Make My Brand, Warehouse service.
- Each line: type tag, image, name, sub-line, QuantityStepper (min, step), unit price, line total, a green note (next tier / held deposit / proof time / rate card), Save for later, Remove.

**Get a quote** (factory products):
- Each line: quantity, target price (optional), customisation select.
- Below-MOQ warning with "Raise it or join a pool".
- One notes box.
- **Send quote request · n products** creates one RFQ (one line per product; if the RFQ model has no lines, one RFQ per product, grouped — tell the owner which before building). The lines leave the cart.
- Send is disabled while any line is below MOQ, with the reason shown.

**Summary card** (sticky): subtotal by type; shipping "Chosen at checkout"; "Duty and VAT: on arrival, about US$ …" (an estimate from duty entries, or "not known yet"); **Checkout · n items**.

**Mini-cart drawer** (380 px): confirmation "… added", the first lines, "+ n more", the Get a quote count, the subtotal, Checkout, View cart.

**Phones:** stacked lines; a checkout bar fixed at the bottom (subtotal + Checkout).

**Re-checks** when the cart opens and at checkout:
- price changed → warning + update;
- stock reduced → quantity lowered + "Ask for a quote for the rest";
- pool closed → line moved to Get a quote.

### 5.9 Checkout — `/shop/checkout` — Match: `Cart_Checkout`, `M_Cart_Checkout`

- Requires a verified company; otherwise the "Verify your company to pay" state (cart kept).
- **Stepper:** Delivery → Shipping → Payment → Review. One page; finished steps fold up with "Done · Change".

1. **Delivery:** RadioCards of saved addresses; Add an address. Note that services and designs need no shipping, and pool items ship when the pool fills.
2. **Shipping per parcel:**
   - samples → Express courier (price, 3–5 days, door to door);
   - ready stock → Sea (LCL) or Air (price, days, duties on arrival);
   - prices from rate cards, or "Quoted at order".
3. **Payment** (RadioCards):
   - **Wallet:** balance, "enough for this order", paid instantly. If short → "Wallet + card".
   - **Card:** through the payment provider (hosted or embedded fields). Store only the provider's reference; show any card fee before payment.
   - **Bank transfer:** PF- proforma, bank details from Admin › Payment settings, stock held 3 days.
   - **Payment protection:** money held, released per order after the QC passes. Only for ready stock, branding and services.
   - Note: pool deposits are always held.
4. **Review:** summary of lines and totals; terms checkbox (Terms of sale + refund rules); **Place order · pay US$ …**.

**Server:**
- Recalculate everything at Place order. If anything changed, show the change and ask again.
- Use an idempotency key per checkout.
- Create one `CO-` checkout and one order per type, linked: `OCT-SMP-`, `OCT-STK-`, pool hold, `OCT-MMB-`, `SRV-`.
- Ledger entries balance.

**Card provider:** the owner chooses it (Stripe / Checkout.com / Airwallex). Test mode on staging only.

### 5.10 `/shop/checkout/done` — Match: `Cart_Done`

- Success header with "Thank you, Anna. Your order is placed.", the CO number, amount, method and date.
- Buttons: Track in My account ↗, Continue shopping, Download receipt (PDF).
- "Your n orders": each type tag + number + what + next step + View ↗ (`target="octopus-account"`).
- Note "n products are still waiting for a quote".
- The same content goes by email to the buyer and the company owner.
- **Bank transfer variant:** "Waiting for your transfer": amount, deadline, PF reference, bank details, Download proforma.

---

## PART 6 — Page specs: My account (tab 3)

### 6.1 Frame (every `/account/*` page) — Match: `CustomerHome`, `Nav_Components`

- **AccountSidebar** (navy), from top to bottom:
  1. logo with tagline (→ `/shop`, `target="octopus-shop"`);
  2. company switcher;
  3. **Overview:** Home, Action needed (count);
  4. **Services:** Sourcing requests, Orders, Turnkey projects, Warehouse (3PL), Shipping, Make My Brand, Dropshipping (expands into its own sub-items, see 6.6);
  5. **Money:** Wallet, Invoices;
  6. **Account:** Team and settings, Support;
  7. **Browse products ↗** at the bottom.
- **AccountTopbar:** search ("Search my requests, orders and invoices"); New request; **shop icon** (light blue, tooltip "Go to the main page"); notifications (count); help; avatar and name.
- **Phones:** navy header with the logo (→ `/shop`), shop icon, search and bell; BottomNav Home · Requests · Orders · Wallet · More (sheet with the rest + Browse products).

### 6.2 `/account` Home — Match: `CustomerHome`, `M_CustomerHome`, `States-CustomerHome`

- "Good afternoon, Anna" + company + Verified pill.
- **Waiting for you (n):** table of What / Service / Due / Action (Review quote, Pay deposit, Approve or comment).
- **Wallet card:** available, held, invoices due; Add funds, Invoices.
- **Browse products card:** Open the shop ↗.
- **Your services:** six status tiles (Sourcing, Turnkey, Warehouse, Shipping, Make My Brand, Dropshipping); not started = "Start".
- **In progress:** table of Reference / Service / Status / Next step; See all orders.
- **Your account manager:** name (from staff data; `[Account manager name]` until it's set), "Replies within 1 business day", Message, Open a ticket.

**States:** brand-new customer (3-step start), not verified, loading, error per panel.

### 6.3 `/account/action` — Match: `C_Action`

Pill filters (All · Pay · Approve · Review · Reply) + a list of cards with due dates and one action each, sorted by due date.

### 6.4 `/account/requests` and `/[RFQ-n]` — Match: `C_Sourcing`

- **List:** CardTabs (All · Quoting · Quote ready · Accepted · Closed) + pills by service + table (stacked on phones).
- **Detail:** header (RFQ number, status, products), Stepper (Sent → Quoting → Quote ready → Accepted → Ordered), underline tabs Overview · Quotes (n) · Messages (n) · Files · Timeline.
- **Accept quote** adds the quoted lines to the cart's Buy now part, or creates a proforma per the existing flow.

### 6.5 `/account/orders` and `/[ref]` — Match: `Nav_AccountOrders`, `Nav_OrderDetail` (+ `M_`)

- **List:**
  - CardTabs: All 24 · Waiting for you 3 · In production 5 · Shipped 9;
  - FilterPills by service with counts;
  - Segmented List | Board (Board groups orders by status in columns);
  - sort;
  - table: Order, Products, Service, Status, Total, plus an action button matching the next step (Pay balance, Pay deposit, View, Track, View pool, Reorder);
  - pagination;
  - on phones: stacked cards and a Filters sheet.
- **Detail:**
  - "‹ Orders" on phones; breadcrumbs on desktop;
  - header with the number, status pill, product line, and the primary button for the current step (e.g. "Pay balance US$ 2,870.00") + Message us;
  - **Stepper:** Quote → Deposit → Production → Quality check → Balance → Shipping → Delivered, with dates. Steps depend on the service;
  - **sticky underline tabs:** Overview · Items (n) · Documents (n) · Payments (n) · Shipping · Messages (n) · Timeline;
  - **Overview:** Payment card (total, deposit paid, balance due, Pay balance, Pay with Payment protection); Items table; QC card (summary, photos, Open QC report PDF); What happens next (timeline); Shipping card;
  - **Documents:** proformas, invoices, the QC report and the packing list as PDFs. Supplier documents are never shown.

### 6.6 Dropshipping inside My account — Match: `screens/` Activate, Onboarding, Dashboard, Catalog, ProductDetail, LandedCost, RequestProduct, SampleOrder, ImportList, ProductEditor, PushStore, Pushed, Orders, OrderDetail, TrackPage, Wallet, Billing, Reports, Pricing, PackingShipping, StoresWeb, Stores, Settings, Support, EA_Dashboard, EA_PublicDropship (+ `M_` + `States-*`)

- Keep every behaviour from `COMPLETE-SYSTEM-PROMPT.md` (releases 1–5): early access, Shopify connect and push, orders, problems and sync, billing.
- **Navigation change only:** the old merchant sidebar becomes the **Dropshipping group** in the AccountSidebar:
  - Dashboard · Find products · Import list · Pushed products · Orders · Pricing and sync · Packing and shipping · Stores · Billing · Reports · Settings;
  - the merchant wallet uses Money › Wallet (one wallet);
  - Support uses Account › Support.
- On phones the group opens from More.
- Restyle with ODS comfortable tokens. Same content, states and rules (landed cost, white-label, DDP/DAP, US no de minimis, sample rules, seller profile approval).
- `TrackPage` (the buyer tracking page) uses **the merchant's brand only**, never Octopus.
- `Stores` (inside Shopify admin) follows Shopify's embedded app rules.

### 6.7 Other My account pages

- `/account/turnkey` — `C_Turnkey`. Detail: stepper (Brief → Design and quotes → Samples → Production → QC → Shipping) + tabs (Overview · Quotes · Samples · Files · Messages · Timeline).
- `/account/warehouse` — `C_Warehouse`: tabs Stock · Inbound · Outbound · Fees. Stock is shown as labels where required, with low-stock pills.
- `/account/shipping` — `C_Shipping`: shipments list with tracking, pill filters.
- `/account/brand` — `C_Brand`: tabs Proofs (approve or comment) · Files · Orders.
- `/account/wallet` — `C_Wallet`:
  - CardTabs Available / Held / Invoices due;
  - Segmented Month / Quarter / Year;
  - transactions table;
  - Add funds (bank transfer details from settings, or card through the provider);
  - withdraw (per the existing rules).
- `/account/invoices` — `C_Invoices`: pill filters (All · Due · Paid · Credit notes · Statements), PDF download, statement download.
- `/account/settings` — `C_Team`: vertical tabs Company · Team · Addresses · Notifications · Security · Verification (KYC). Team invites by email; roles. One login per person.
- `/account/support`: underline tabs Open · Closed; new ticket; ticket thread.

**Example data for design review** (the same numbers everywhere):

| Item | Value |
|---|---|
| Wallet | US$ 4,250 available, US$ 1,180 held |
| PF-2026-0112 | Kitchen deposit, US$ 2,550, paid 22 Oct |
| PF-2026-0118 | Pet accessories deposit, US$ 1,860, due 30 Nov |
| OCT-SRC-2026-0207 | Total US$ 4,100; deposit US$ 1,230 paid 24 Oct; balance US$ 2,870 due 1 Dec |
| RFQ-1042 | Foldable pet crate quote, expires in 2 days |
| CO-2026-0153 | US$ 2,297 paid by wallet on 27 Nov |

Use these only in fixtures and stories, **never on live**.

---

## PART 7 — Page specs: Back Office (staff ERP, compact)

### 7.1 Frame — Match: `ERP_Invoices`, `ERP_Components`, `ERP_States`

- `<html data-density="compact">`.
- **OfficeTopbar**, 48 px navy-dark:
  - white logo mark;
  - divider;
  - **app switcher "Back Office ▾"** (Back Office, Accounts, Warehouse OS, Website admin — only the apps the role allows);
  - **command button** "Search customers, RFQs, orders, invoices… or type a command [Ctrl][K]", centred, up to 520 px;
  - **+ New ▾** (invoice, payment, quote, customer, product…, per role);
  - notifications (count);
  - help;
  - avatar + name + role.
- **OfficeSidebar**, 232 px navy:
  - Dashboard; My work (count);
  - **Sales:** Customers, Sourcing requests (count), Quotes, Orders;
  - **Services:** MOQ pools (count), Turnkey projects, Make My Brand, Dropshipping, Warehouse (3PL), Shipping;
  - **Accounts:** Invoices (count), Payments, Wallets, Credit notes, Ledger, Bank reconciliation (count), Financial reports;
  - **Catalogue:** Products, Suppliers;
  - **Website:** Pages and banners;
  - **Admin:** Users and roles, Settings, Audit log.
  - Groups collapse (remembered); a 3 px teal bar marks the current page; "« Collapse sidebar Ctrl B" (56 px icons with tooltips).
  - Items the role can't open are **hidden** (and removed from the palette).

**Workspace tabs** (`Workspace`), 36 px strip:
- **Tabs:** Dashboard is pinned (icon only, can't close). Every other tab has an icon, title (ellipsis, max 210 px) and ✕.
- **Active tab:** white with a 2 px blue top bar.
- **Unsaved changes:** an amber dot replaces ✕. Closing asks Save and close / Discard / Cancel. The same check runs on route change and browser unload.
- **New tab** "+" opens the palette.
- **Overflow:** "n more ⌄" lists hidden tabs with ✕, plus "Close all except pinned".
- **Limit:** at most 12 open; opening the 13th asks to close the oldest unpinned tab.
- **Opening records:** Ctrl+click or middle-click on any record opens it in a new tab. Enter on a grid row opens the record in the current tab; Ctrl+Enter opens it in a new one.
- **Keys:** Ctrl Tab = next tab, Alt W = close.
- **Persistence:** each tab is a real route. Open tabs, order, pins, and per-tab filters and scroll are saved per user (localStorage + a `workspace_tabs` row) and restored after a reload.

**Command palette** (Ctrl K, cmdk):
- groups: Records (customers, RFQs, quotes, orders, invoices, payments, products, suppliers), Actions ("Record payment for …", "New quote for …"), Go to (pages, with shortcuts like G I);
- footer hints ↑↓ ↵ Ctrl↵;
- respects permissions; recent items first.

**Keyboard shortcuts** (Help › Keyboard shortcuts lists them):

| Keys | Action |
|---|---|
| Ctrl K | Command palette |
| Ctrl B | Collapse or expand the sidebar |
| Ctrl S | Save |
| Esc | Close |
| Alt W | Close the current tab |
| Ctrl Tab | Next tab |
| N | New record |
| / | Focus the grid search |
| J / K | Next / previous row |
| Enter | Open the selected row |

### 7.2 OctopusDataGrid — Match: `ERP_Invoices`, `ERP_Components` §5

- **Layout:** 36 px rows, sticky 34 px header, the first data column frozen with a divider.
- **Numbers:** right-aligned with tabular figures; currency in the header ("Amount (US$)").
- **Columns:** sort (header click; arrow shows direction), resize, reorder, show/hide; density toggle.
- **Views:** **saved views** (personal and shared, e.g. "Finance · to chase").
- **Filters:** filter chips (✕ to remove) + "+ Add filter" → advanced filter panel (field / operator / value; AND/OR groups).
- **Selection:** row checkboxes → **bulk bar** (navy): "n selected · balance US$ …", actions, Clear selection.
- **Row actions:** ⋯ or right-click → context menu (Open in new tab, Open in drawer, Copy number, actions, destructive last in red).
- **Data loading:** server-side sort, filter and pagination; virtualise above 200 rows; page sizes 25/50/100.
- **Export:** CSV/XLSX that respects filters and **permissions** (no cost or supplier columns without the permission).
- **States:** loading skeleton rows (header stays); "No results for these filters" with Clear filters and Save as view; error with Retry.

### 7.3 `/office` Dashboard — Match: `ERP_Dashboard`

- Page head "Good evening, Priya · Finance · date", Customise.
- **KpiStrip:** Cash in bank, Receivables, Payables, Customer wallets, Waiting for approval (per role; Sales sees pipeline figures instead).
- **My work (n):** task grid (checkbox, title + detail, due, status, Open), See all.
- **Money in and out · last 8 weeks:** bar chart with a legend and a unit select. The chart needs a text alternative.
- **Receivables ageing:** stacked bar + table 0–30 / 31–60 / 61–90 / 90+.
- **MOQ pools closing soon:** progress + date.
- **Recent activity.**
- Widgets are chosen by role; each panel loads and fails on its own.

### 7.4 Accounts › Invoices — Match: `ERP_Invoices`

- **Page head:** breadcrumbs, H1, "All services · US$ · updated 2 min ago"; Import, Export, New invoice.
- **KpiStrip:** Receivables, Overdue, Due in 7 days, Paid this month, Held (Payment protection).
- **Status tabs:** All · Draft · Sent · Partly paid · Overdue · Paid · Credit notes.
- **Filter bar:** search, chips, saved view select, columns, density, refresh.
- **Grid columns:** checkbox, Invoice no. (frozen), Customer, Service, Issued, Due (red when overdue), Amount, Paid, Balance, Status, Owner, ⋯.
- **Bulk bar:** Send reminder, Record payment, Export, Mark as…
- **Record payment drawer** (460 px):
  - header (number, status, open in tab, close);
  - tabs Record payment · Details · Activity (n);
  - summary box (customer, total, paid, balance due);
  - fields: Amount (required, right-aligned), Date received, Method, Bank account, Bank reference (required, "must match the bank statement line"), Note;
  - warning "Payments over US$ 2,500 need a second approver";
  - footer: Save payment, Cancel, shortcut hints.

### 7.5 Customer record — Match: `ERP_Customer`, `staff/Staff_CustomerFinance`

- **Header:** initials, name, status pill, CUS number, city, since date; account manager, owner, services; Message, New quote, Actions ▾.
- **Tabs:** Overview · Orders (n) · Invoices (n) · Wallet · RFQs (n) · Documents (n) · Team (n) · Activity · Notes (n).
- **Overview:**
  - **Company** (key/value + Edit);
  - **Money:** wallet available, held, invoices due, paid in the last 12 months, **Credit (Finance only)**, last payment; Statement;
  - **Open items** (pills + links);
  - **Recent orders** grid;
  - **Activity** + note box with @mentions.
- Follow-ups and reminders from `Staff_CustomerFinance` go under Activity / Notes.

### 7.6 All other staff modules

Move each existing staff page into the shell **one module at a time**, using the grid + record + drawer patterns. Keep the logic and permissions.

- **List pages:** KpiStrip (optional) + status tabs + filter bar + grid.
- **Record pages:** header + stepper (if it's a process) + underline tabs + panels.
- **Quick edits** in the drawer; long forms as full pages.

Existing boards to restyle compact:
- StaffCatalog, StaffImport, StaffProductEdit, StaffCompliance;
- StaffQueue, StaffPackStation, StaffHealth;
- StaffMerchants, StaffFees, FinanceSaaS;
- StaffRateCards, StaffDutyEntries, StaffRequests.

### 7.7 Money safety

- **Two-person approval** for money actions above the limit in settings (US$ 2,500 in the designs): payments, refunds, credit notes, supplier payments, wallet adjustments, Pay-later switches.
  - The person who recorded an action **cannot approve it**.
  - "Second approver needed" state.
  - **The owner must add a second Finance user before go-live.**
- Audit log for every money and permission action: who, when, before and after, IP.
- Staff see supplier names, cost and margin only with `suppliers:view` / finance permissions. Never in customer outputs.

### 7.8 Phone — Match: `M_ERP_Approvals`

- `/office` on a phone shows **Approvals** (cards with Approve / Reject, 44 px), search and read-only records.
- Editing shows "Open this on a computer".
- BottomNav Home · Approvals · Search · Alerts.

---

## PART 8 — Data additions (proposed — check the current schema first; each migration has a `.down.sql` and RLS)

| Table / change | Purpose | RLS |
|---|---|---|
| `company_interests (company_id, service, created_at)` | Setup choices → section order, account manager follow-up | Company members read; owner writes |
| `carts (id, company_id unique, ship_to_country, updated_at)` | One cart per company | Company members |
| `cart_items (id, cart_id, kind enum[sample, stock, pool, brand, service, quote], ref_id, qty, unit_price_snapshot, target_price, customisation, saved_for_later bool, created_by)` | Cart lines | Company members; prices re-read from source at checkout |
| `checkouts (id 'CO-…', company_id, totals jsonb, method enum[wallet, card, bank, protection, wallet_card], status, idempotency_key unique, provider_ref)` | One checkout → many orders | Company members read; server writes |
| `orders.checkout_id` (nullable FK) | Link orders to the checkout | Existing order RLS |
| `workspace_tabs (user_id, tabs jsonb, updated_at)` | Back Office tabs restore | Owner only |
| `saved_views (id, user_id, scope enum[personal, shared], page, filters jsonb, columns jsonb, sort jsonb)` | Grid views | Owner; shared = role |
| `approvals (id, kind, ref_id, amount, requested_by, approved_by, status, reason, created_at, decided_at)` with a check `approved_by <> requested_by` | Two-person rule | Finance roles |
| `ui_prefs (user_id, sidebar_collapsed, density_override, …)` | Remembered UI choices | Owner only |

- Do not touch ledger structures. Money posting stays in the existing functions.
- Add DB tests for:
  - RLS (members only);
  - the approval self-check;
  - the checkout idempotency;
  - ledger balance after checkout, in a rolled-back test.

---

## PART 9 — How to switch to the new theme (release plan)

Use the feature flag **`ods_theme_v1`** with values off / staff / beta companies / all. When it's on, an area uses the new shell and tokens; when it's off, the old theme is unchanged. Remove the old theme only after the owner approves, 2 weeks after "all".

**Do one step at a time.** Each step runs on staging, then is reported with screenshots against the Match files and the test results, then waits for the owner's "go":

| Step | Scope | Done when |
|---|---|---|
| **T0 · Audit** | List every current route, its layout, its components and which design file it maps to. Flag routes with no design. **No code changes.** | Route table delivered to the owner |
| **T1 · Tokens + logo** | `@octopus/ui` tokens, both densities, fonts, icons, logo files, favicons. No page changes yet (flag off) | `/dev/ui` shows all tokens; axe clean |
| **T2 · Components** | All Part 2.5 components with states, in `/dev/ui` | Every component has default / hover / focus / selected / disabled / loading / error, in both densities |
| **T3 · Introduction + sign-in** | `/`, `/services/*`, `/login`, `/auth/callback`, `/welcome/setup`, invites, named tabs, BroadcastChannel sign-out | Part 4 tests pass; Google sign-in works on staging with a test Google account |
| **T4 · Shop** | Shop frame, `/shop`, products, product page, pools, turnkey, dropship, warehouse, brand, search | Part 5.1–5.7 tests pass |
| **T5 · Cart + checkout** | Cart, mini-cart, checkout, done, all cart states; card provider in **test mode on staging only** | Ledger balance, idempotency, every payment method in rolled-back tests |
| **T6 · My account** | Frame, home, action, requests, orders (+ detail), turnkey, warehouse, shipping, brand, wallet, invoices, settings, support | Part 6 tests pass |
| **T7 · Dropship inside My account** | Move the merchant app into the Dropshipping sidebar group; restyle | All existing Dropship tests still pass, unchanged |
| **T8 · Back Office shell** | Topbar, sidebar, workspace tabs, palette, shortcuts, grid, drawer, approvals | Part 7.1–7.2 tests pass |
| **T9 · Back Office screens** | Dashboard, Invoices, Customer record, then every module one by one | Each module's old tests pass inside the new shell |
| **T10 · Phones + polish** | All `M_` boards; performance budgets; full axe sweep | No horizontal scroll at 390 px (except tab rows and comparison tables); LCP budget met |
| **T11 · Go live** | Owner's "go", then the release method in Part 1 | Flag → beta companies → all |

---

## PART 10 — Tests (Playwright + DB)

- **Every page:** renders for each role; axe 0 serious/critical; no horizontal scroll at 390 and 1280 px (except the allowed areas); one H1; title set; keyboard focus visible.
- **Navigation:**
  - named tabs reuse the open tab (clicking "My account ↗" twice leaves one tab);
  - the logo and shop icon in My account go to `/shop`;
  - the phone opens everything in the same tab;
  - `?tab=` deep links work;
  - filters survive a reload;
  - More ▾ appears at 1100 px;
  - the sidebar collapses under 1200 px with tooltips.
- **Sign-in:**
  - Google on staging;
  - setup only the first time;
  - invite email mismatch state;
  - signing out in one tab shows the overlay in the others;
  - `next` can't redirect off-site.
- **Shop:**
  - section filter and order;
  - a failing section is isolated;
  - price calculator tiers and the below-MOQ block;
  - pool join → cart line → hold; a pool that doesn't fill releases the hold (rolled back);
  - white-label scan of HTML, JSON and PDFs for supplier names and codes.
- **Cart and checkout:**
  - each line type;
  - re-check states (price, stock, pool);
  - each payment method; wallet + card split;
  - idempotent Place order; totals match the server; one order per type;
  - the bank transfer path; the KYC block; card test mode only.
- **My account:** card tabs + pills combine; order detail tabs load lazily and keep state; documents never include supplier files.
- **Back Office:**
  - workspace open / close / pin / reorder / restore / 13th tab / unsaved guard;
  - palette search and Ctrl Enter;
  - saved views; bulk total; export columns follow permissions;
  - Record payment under and over the limit; self-approval blocked; ledger balanced;
  - shortcuts;
  - phone approvals work and editing is blocked.
- **Visual:** screenshot every page at 1280/1440 and 390 px. Attach them to the step report next to the Match file.

---

## PART 11 — Report format after every step

1. What changed: routes, components, migrations (with `.down.sql`).
2. Test results: full suite counts, axe results, performance numbers.
3. Screenshots next to each Match file. List any difference and why.
4. Anything blocked, and the owner decision needed.
5. A rollback note for this step.

---

## PART 12 — Owner decisions still open (ask; don't guess)

- **Card payment provider:** Stripe, Checkout.com or Airwallex (needs the HK company).
- **Pool deposit %** (30% in the designs), pool minimums and steps.
- **3PL rates** (the designs show `[RATE]`), processing fee, shipping markup.
- **Two-person approval limit** (US$ 2,500 in the designs) and **a second Finance user**.
- **Launch countries** shown on the introduction site.
- Legal texts: Terms of sale, refund rules, privacy policy, cookies.
- Whether the staff base path stays `/admin` (recommended) or moves to `/office`, with redirects.
- RFQ with lines vs one RFQ per product (cart Get a quote).
- Resend app emails (needed for receipts, invites and sign-in emails).

---

## Appendix A — `specs/ods-tokens.css`

```css
:root{
  /* brand (from the logo) */
  --ods-navy:#1A174A; --ods-navy-dark:#14123B; --ods-navy-hover:#2E2B66;
  --ods-blue:#2A6FD1; --ods-blue-hover:#1F5BB0; --ods-blue-tint:#EAF1FC;
  --ods-teal:#5FD3C9;
  /* neutrals */
  --ods-canvas:#F4F6F9; --ods-surface:#FFFFFF; --ods-line:#E3E7EF; --ods-line-strong:#C9D0DD; --ods-slate:#5B6478; --ods-text:#1A174A;
  /* status */
  --ods-success:#0B7A75; --ods-success-tint:#E3F5F3;
  --ods-warning:#B54708; --ods-warning-tint:#FFF4E5;
  --ods-danger:#B42318;  --ods-danger-tint:#FDECEA;
  --ods-info:#1D4E9A;    --ods-info-tint:#EAF1FC;
  --ods-focus:#F59E0B;
  /* services */
  --svc-sourcing:#1D4E9A; --svc-sourcing-tint:#EAF1FC;
  --svc-pools:#0B5F5B;    --svc-pools-tint:#E3F5F3;
  --svc-dropship:#5B3AA8; --svc-dropship-tint:#F0EBFB;
  --svc-3pl:#3B4687;      --svc-3pl-tint:#EDEFF8;
  --svc-turnkey:#94420A;  --svc-turnkey-tint:#FDF1E6;
  --svc-brand:#A11B5A;    --svc-brand-tint:#FCE9F1;
  /* type */
  --ods-font:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
  /* shadows */
  --ods-shadow-card:0 1px 2px rgba(26,23,74,.05);
  --ods-shadow-pop:0 12px 32px rgba(26,23,74,.14);
  --ods-shadow-dialog:0 16px 40px rgba(26,23,74,.18);
  /* z */
  --z-sticky:10; --z-dropdown:20; --z-drawer:30; --z-modal:40; --z-toast:50; --z-palette:60;
  --ods-content-max:1240px;
}
/* comfortable = customer areas (default) */
:root, [data-density="comfortable"]{
  --ods-text-body:15px; --ods-text-table:14px; --ods-text-label:13px; --ods-h1:28px; --ods-h2:21px;
  --ods-control-h:44px; --ods-row-h:52px; --ods-head-h:44px;
  --ods-radius-control:8px; --ods-radius-card:14px; --ods-radius-pill:999px;
  --ods-pad-page:32px; --ods-pad-card:20px; --ods-gap:16px;
  --ods-tab-h:48px; --ods-tab-bar:3px;
}
/* compact = staff apps */
[data-density="compact"]{
  --ods-text-body:13px; --ods-text-table:13px; --ods-text-label:12px; --ods-h1:20px; --ods-h2:15px;
  --ods-control-h:32px; --ods-row-h:36px; --ods-head-h:34px;
  --ods-radius-control:6px; --ods-radius-card:6px; --ods-radius-pill:4px;
  --ods-pad-page:16px; --ods-pad-card:12px; --ods-gap:12px;
  --ods-tab-h:36px; --ods-tab-bar:2px;
}
@media (max-width:767px){ :root{ --ods-pad-page:16px; --ods-h1:24px; } }
*:focus-visible{ outline:3px solid var(--ods-focus); outline-offset:2px; }
.num, td.num{ font-variant-numeric:tabular-nums; text-align:right; }
@media (prefers-reduced-motion:reduce){ *{ animation:none!important; transition:none!important; } }
```

## Appendix B — Component checklist (each component, in both densities)

- [ ] Default, hover, focus-visible, active/selected, disabled (with the reason next to it), loading, error, empty.
- [ ] Keyboard: Tab order; Enter/Space; arrows where it's a group; Esc closes.
- [ ] Screen reader: name, role, state (`aria-selected` / `pressed` / `current` / `expanded`); `aria-live` for changes.
- [ ] Phone behaviour: stack, sheet or sideways scroll — defined and tested.
- [ ] RTL-safe: logical CSS properties (`margin-inline-start`, etc.), so Arabic can come later.
- [ ] No hard-coded colours or sizes; tokens only.

## Appendix C — Shared status names

Use exactly these names everywhere: pages, emails, exports.

| Area | Statuses |
|---|---|
| Requests | Draft · Sent · Quoting · Quote ready · Accepted · Closed |
| Orders | Waiting for payment · Deposit due · In production · Quality check · Balance due · Shipped · Delivered · Cancelled |
| Invoices | Draft · Sent · Partly paid · Overdue · Paid · Cancelled · Credit note |
| Pools | Open · Closing soon · Almost full · Filled · Closed (not filled) |
| Payments | Pending · Paid · Held · Released · Refunded · Failed |
| Approvals | Waiting · Approved · Rejected |
| Company | Not verified · Verification pending · Verified · Paused |

Pill colours:
- success = Paid, Approved, Verified, Delivered, Released;
- info = Sent, Open, In production, Quoting;
- warning = Partly paid, Waiting, Deposit due, Balance due, Closing soon;
- danger = Overdue, Failed, Rejected;
- neutral = Draft, Cancelled, Closed;
- 3PL indigo = Held.

## Appendix D — Index of design files

See `README.md` for the full table: `screens/`, `mobile/`, `states/`, `staff/`, `backoffice/`, `specs/`, `assets/`.

The three starting pages are on the design canvas page "Start here: the 3 main pages": `Public_Home`, `Shop_Main` and `CustomerHome`.

Start with **T0 · Audit**. Send the route table and wait for the owner's "go" before T1.
