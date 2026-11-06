> **Implementation note (6 Nov 2026).** Built ahead of ADDON-26/28 at the owner's request (fonts and PWA come later).
> - Migration `20261101000157_turnkey_projects.sql`: `turnkey_projects / packages / equipment / hubs / project_sources / leads / atlas_signals`, RLS, `submit_turnkey_lead()` (service role; region = `turnkey_region_for(country)`, round-robin `turnkey_pick_assignee()` among sourcing agents with that `profiles.region`, else triage pool + every Admin notified), `log_turnkey_signal()`, private bucket `turnkey-floorplans` (signed uploads, 20 MB), permission area `turnkey`.
> - Catalogue seeded from `docs/design/turnkey/TurnkeyProject_*.dc.html`: 25 projects (4 live), 75 tiers, 140 equipment lines, 32 "sourced from" cards, 12 hubs (the spec lists 12 names incl. Jinan; the design map shows 11). **is_seed = false** — the catalogue is the owner's product line, so the ADDON-24 wipe keeps it. Budgets are the design's rough planning figures.
> - The design only itemises the middle tier of each project. Starter / Pro tiers show budget, space, items and lead time with "itemised list comes with your quote" until Admin adds lines in `/admin/turnkey/<project>`.
> - Routes: `/turnkey`, `/turnkey/atlas`, `/turnkey/<id>`, `/<id>/request` (live), `/<id>/interest`, `/turnkey/confirmation/<lead>`, `/admin/turnkey` (leads kanban + assignment, projects, signals, sourcing-team regions), `/admin/turnkey/<id>` (project, packages, equipment with ↑/↓ reorder), `/account/turnkey`. Header rail "Turnkey Projects · New", footer column, sitemap.
> - Rate limits: interest 5/IP/day + 3/email/day, quote 2/IP/hour, uploads 10/IP/hour, signals 60/IP/min.
> - **Not built yet:** Cloudflare Turnstile (ADDON-26), PWA offline cache / web push / bottom nav (ADDON-28), the AI assistant creating leads and the assistant-panel triage row, Arabic copy, AED/SAR/NGN tag line, imperial toggle, spec-PDF download, per-project OG images, lead → RFQ escalation UI (`turnkey_leads.rfq_id` column exists).
> - Tests: `tests/unit/turnkey.test.ts`, `tests/e2e/turnkey.mjs` (1440 + 360 px, cleans up after itself). Lighthouse / axe gates not run yet.

# Add-on: Turnkey Projects — a new area of Octopus B2B

## Why

A good share of your Middle East, Africa and South Asia buyers don't want 400 SKUs — they want one complete working business shipped in a container: a gym fit-out, a water bottling line, a padel court, a car wash. Octopus B2B is well placed for this because every turnkey project reduces to the same four things you already do: layout & specification, factory sourcing in China, QC inspection, one consolidated shipment.

This add-on ships Turnkey Projects as a new top-level area next to Categories, Group buys and RFQs.

## What ships

- **Turnkey hub** at `/turnkey` — headline, "Start with these five" strip, 4 live modules with View packages, 21 register-interest modules.
- **Project Atlas** at `/turnkey/atlas` — all 25 businesses, filter by category, sort by budget or lead time, dark hero with a map of the 11 Chinese factory hubs; tapping a hub filters the list.
- **4 live project pages** at `/turnkey/<slug>` — Gym, Laundry, Vending, Robotic Café — each with 3 package tiers, equipment list, budget, revenue + payback model, "Request this package" form.
- **21 register-interest pages** — same layout as live pages but with "Register interest" instead of packages, so you measure demand before building packages.
- **Admin surface** under `/admin/turnkey` — add projects, publish packages, edit equipment lists, review register-interest signals, convert a project from register-interest to live when demand justifies it.
- **Mobile flow** per ADDON-28: Hub → Package picker → Quote form → Confirmation, with bottom nav and sticky CTA.

## The 25 projects, as given

```
Category                 Project                                     Hub(s)
───────────────────────  ──────────────────────────────────────────  ─────────────────────
Self-service / automated Touchless car wash                          Shenyang, Qingdao
Self-service / automated EV charging hub                             Shenzhen, Zhejiang
Self-service / automated Purified water + ice vending                Guangdong
Self-service / automated Smart parcel lockers & power-bank rental    Shenzhen
Self-service / automated Claw machines / FEC                         Panyu, Guangzhou
Food & hospitality       Bubble tea / ice cream / bakery             Guangzhou
Food & hospitality       Cloud kitchen                               Guangzhou, Foshan
Food & hospitality       Container café / container shops            Guangdong, Shandong
Food & hospitality       Hotel / serviced-apartment FF&E             Foshan, Chaozhou
Leisure & sport          Indoor playground / trampoline park         Wenzhou, Yongjia
Leisure & sport          Padel / pickleball court                    (multiple)
Leisure & sport          VR / 5D cinema zone                         Guangzhou
Small factories          Water bottling plant                        Zhangjiagang
Small factories          Paper cup / tissue making                   Ruian, Fujian
Small factories          Concrete block / paver making               Fujian, Shandong
Small factories          Plastic injection / recycling line          Ningbo, Zhangjiagang
Small factories          Laser engraving / signage / print shop      Jinan
Small factories          Feed pellet / flour mill                    Zhengzhou, Henan
Infrastructure           Cold rooms & cold storage                   Zhejiang, Shandong
Infrastructure           Solar + battery backup                      Jiangsu, Zhejiang
Infrastructure           Mini-mart fit-out                           (multiple)
Live modules             Gym                                         (live)
Live modules             Laundry                                     (live)
Live modules             Vending                                     (live)
Live modules             Robotic café                                (live)

Start with these five:
1. Water bottling plant        4. Trampoline park
2. Concrete block making       5. Touchless car wash
3. Padel / pickleball court
```

## Antigravity prompt 31-A — build Turnkey Projects end to end

```
Read docs/SPEC.md, docs/ADDON-23 (customer sidebar), ADDON-24 (demo data), ADDON-26 (China-safe), ADDON-27 (bulk import), ADDON-28 (PWA & mobile), ADDON-29 (template) and docs/design/TurnkeyProjects.md (this file's mirror in docs/design/). Ship Turnkey Projects as a new area of the app.

1. Schema (migration `<timestamp>_turnkey_projects.sql`):

   a. table turnkey_projects
      project_id text pk              -- slug, e.g. 'water-bottling'
      title text not null
      category text not null          -- 'self-service' | 'food' | 'leisure' | 'small-factory' | 'infrastructure' | 'fit-out'
      short_reason text                -- 'Steady demand, simple revenue model, ships in 1 container'
      starting_budget_usd int          -- rough planning figure, shown as 'From $X'
      lead_time_days int               -- rough, e.g. 90
      best_markets text[]              -- ['UAE', 'KSA', 'Nigeria']
      factory_hub_ids text[]           -- ids from turnkey_hubs, e.g. ['CN-JS-ZJG']
      status text not null default 'register-interest'   -- 'register-interest' | 'live' | 'archived'
      is_starter_pick boolean default false               -- the "Start with these five"
      starter_rank int                                    -- 1..5 when is_starter_pick
      hero_image_path text
      overview_md text                 -- long description shown on the project page
      four_tests jsonb                 -- {equipment_share: 0.7, ships_in_container: true, simple_revenue: true, non_expert_buyer: true}
      created_at timestamptz, updated_at timestamptz
      is_seed boolean default false

   b. table turnkey_packages (for projects with status='live')
      package_id uuid pk
      project_id references turnkey_projects
      tier_name text                   -- 'Starter' | 'Standard' | 'Pro'
      tier_rank int                    -- 1 | 2 | 3
      starting_budget_usd int
      starting_budget_notes text
      capacity_label text              -- '500 bottles/hour', '2 padel courts', '8-machine gym'
      lead_time_days int
      monthly_revenue_low int, monthly_revenue_high int
      payback_months_low int, payback_months_high int
      summary_md text
      is_active boolean default true

   c. table turnkey_equipment (line items inside a package)
      line_id uuid pk
      package_id references turnkey_packages
      sort_order int
      name text, quantity int, unit text
      spec_md text
      supplier_hint text               -- optional; links to suppliers.supplier_id when known
      supplier_id text references suppliers(supplier_id)
      budget_usd int
      notes text

   d. table turnkey_hubs                -- the 11 Chinese factory hubs
      hub_id text pk                   -- 'CN-GD-SZ' (Shenzhen), 'CN-JS-ZJG' (Zhangjiagang)...
      name text, province text, country text default 'CN'
      lat numeric, lng numeric
      known_for text                   -- 'Electronics, small appliances'
      sort_rank int

   e. table turnkey_leads               -- 'Request this package' and 'Register interest'
      lead_id uuid pk
      kind text                        -- 'quote' | 'interest'
      project_id, package_id (nullable for interest-only)
      buyer_user_id (nullable for logged-out leads)
      company_name text, contact_name text, email text, phone text, country text
      preferred_delivery_term text     -- 'FOB', 'CIF <port>', 'DAP <city>'
      target_open_date date
      floor_plan_storage_path text
      message text
      status text default 'new'        -- new | contacted | quoted | won | lost
      assigned_to uuid                 -- sourcing staff user
      created_at timestamptz

   f. table turnkey_atlas_signals       -- heatmap of what buyers filter / tap
      id uuid pk
      project_id, hub_id (one of)
      event text                       -- 'view' | 'filter' | 'tap_hub' | 'interest'
      country_from text, ts timestamptz default now()

   RLS: public read on turnkey_projects, turnkey_packages, turnkey_equipment, turnkey_hubs (storefront). Leads and signals writeable by anonymous (rate-limited), readable only by Sourcing, Admin, Finance.

2. Seed data from docs/design/TurnkeyProjects.md:
   - 25 turnkey_projects (4 live, 21 register-interest).
   - 11 turnkey_hubs with approximate coordinates (Zhangjiagang, Ruian, Jinan, Zhengzhou, Shenzhen, Guangzhou, Foshan, Chaozhou, Wenzhou, Shenyang, Qingdao, Ningbo).
   - For each live project, 3 turnkey_packages (Starter, Standard, Pro) and their equipment lines seeded from the design canvas.
   - Starter picks: water-bottling (1), block-making (2), padel-court (3), trampoline-park (4), car-wash (5).
   - All seed rows carry is_seed=true (per ADDON-24) so they are wiped on first production load.

3. Routes
   - /turnkey                  — Hub (list)
   - /turnkey/atlas            — Project Atlas with hub map
   - /turnkey/<project_id>     — Project page (packages for live, register-interest for others)
   - /turnkey/<project_id>/request   — Request-this-package quote form (live only)
   - /turnkey/<project_id>/interest  — Register-interest form (register-interest only)
   - /turnkey/confirmation/<lead_id> — Confirmation with reference number and next steps
   - /admin/turnkey            — admin list of projects, packages, leads

4. UI, matching the design canvas:

   Turnkey hub (/turnkey)
   - Sticky top header + bottom-nav on mobile per ADDON-28. Top menu adds "Turnkey Projects" between Categories and Group buy.
   - Headline: "Open a business, one container."
   - "Start with these five" — a swipeable horizontal strip of 5 cards (water bottling, block making, padel, trampoline, car wash) on mobile; grid on desktop.
   - The four live modules as feature cards with their 3 packages and View packages CTA.
   - Six-step process band (Specify → Quote → Sample → QC → Ship → Install & train).
   - Trust points (offices, QC checks, certifications) + contact band with a WhatsApp + WeChat shortcut.

   Project Atlas (/turnkey/atlas)
   - Dark hero with a vector map of China and the 11 hub dots. Dot size = number of projects. Tapping a hub filters the list and opens a bottom panel saying what that hub is known for.
   - "Start with these five" strip under the map.
   - Filter chips by category with a project count; a Clear filters link.
   - All 25 project cards with category badge, short reason, starting budget (From $X), lead time (~X days), factory hub(s), best markets. Live modules show a Live pill; starter picks show a Top pick pill.
   - Four tests for a good turnkey project at the bottom.
   - Mobile: swipeable top-five strip, map in a tab, filter chips above the list, bottom-nav sticks.

   Project page (live: /turnkey/gym, /turnkey/laundry, /turnkey/vending, /turnkey/robotic-cafe)
   - Package tabs (Starter · Standard · Pro). Equipment list, budget, monthly revenue range, payback period update as the tab switches.
   - Right rail (desktop) / sticky bottom bar (mobile) with Request this package button that opens the quote form.
   - Related hubs and the exact factory hub where this package sources from.

   Project page (register-interest: 21 of them)
   - Same layout, but instead of the package tabs it shows an estimated line capacity picker (e.g. water bottling: 500/1000/2000 BPH) with rough starting budgets and a Register interest button.
   - A "Packaging now" tag and a short note that packages go live once 10 interest signals are logged.

   Quote form (live) / Interest form (register-interest)
   - Fields: company name, contact name, email, phone, country, preferred delivery term (FOB, CIF <port>, DAP <city>, with the port/city a free-text field conditional on CIF/DAP), target open date (date picker), floor plan upload (optional, pdf/dwg/jpg/png ≤ 20 MB), message.
   - Submit creates a turnkey_leads row and sends:
     * an email to the buyer with the reference number;
     * a notification to the assigned sourcing staff (round-robin, see step 6) via the push/email/WeChat channels per ADDON-28;
     * a row in the AI assistant conversation so Octo can follow up automatically.

   Confirmation
   - Reference number, next steps, a timeline card (we reply within 24h · sample quote in 5 days · QC schedule once PO is signed).

5. Admin (/admin/turnkey)
   - Projects table (status, starter-pick, interest count, lead count, published packages).
   - Toggle a project live when it has enough interest signals (recommend 10+).
   - Package editor: tier name, budget, capacity, revenue, payback, summary + equipment lines with drag-to-reorder.
   - Leads kanban: new → contacted → quoted → won/lost. Assign to a sourcing staff. A lead drops into the admin assistant panel for Octo to triage.
   - Signals dashboard: which projects get the most views, which hubs buyers tap, by country — informs which 21 projects to build packages for next.

6. Lead routing and notifications
   - Sourcing staff carry a `region` tag (MENA, Africa, Europe, Indian subcontinent, SEA, Americas). Leads auto-assign by country → region → round-robin inside that region.
   - If no sourcing staff available, lead sits in a pool that admin triages.
   - Email templates are stored in CMS (per ADDON-26 no Google Fonts) and use local fonts from ADDON-28.
   - WhatsApp + WeChat links on the confirmation page carry a prefilled message with the reference number.

7. Interactions with existing surfaces
   - The customer portal gets a new "My turnkey projects" item under More (per ADDON-28 bottom nav), listing the user's quote and interest requests.
   - The AI assistant (ADDON-23's /account/assistant) can create turnkey leads on behalf of the user ("I want a water-bottling plant in Nigeria for 500 BPH") by filling the form from the chat.
   - RFQs and turnkey leads stay separate tables but can be linked: a lead can escalate to an RFQ for a specific equipment line when the buyer is ready to buy items individually.
   - Group buys don't apply here (turnkey is bespoke).

8. SEO and content
   - Each live project has a dedicated page title, meta description and Open Graph image rendered from the design canvas.
   - A static /sitemap.xml includes /turnkey, /turnkey/atlas and every project.
   - Server-side render every project page (no client-only content) so Googlebot sees the full copy.

9. Internationalisation
   - Copy is centralised in a CMS block per project. English is the default; Arabic translations go on a per-project basis as they're produced.
   - Budgets show in USD with an optional "Approx. in AED / SAR / NGN" tag line.
   - Measurements metric by default; a toggle can switch to imperial for sq ft and lb.

10. Mobile and PWA
    - Every Turnkey route works in the PWA from ADDON-28 (offline cache the Hub and Atlas; project pages are network-first with a 2 s fallback to cached copy).
    - Bottom nav keeps the Turnkey entry visible on relevant screens.
    - Floor-plan upload uses the same `capture="environment"` + document-scan flow as KYC.

11. Rate limits and anti-abuse
    - Interest form: 5 submissions per IP per day; 3 per email per day.
    - Quote form: 2 per hour per IP (higher limit because quotes are serious).
    - Cloudflare Turnstile (per ADDON-26) on both forms.

12. Tests
    - Vitest: starter-pick ranks 1–5 enforced unique; status enum enforced; four_tests schema valid.
    - Playwright (desktop + 360-px mobile):
      - Open /turnkey → tap "Start with these five" → scroll → tap Water bottling → see register-interest page → submit → confirmation with reference number.
      - Open /turnkey/atlas → tap the Zhangjiagang hub → list filters to water-bottling + plastic injection → tap a category chip → list narrows → Clear filters → full list again.
      - Open /turnkey/gym → switch between Starter/Standard/Pro → each tab shows the right equipment and budget → tap Request this package → submit → confirmation.
      - Submit an interest for an unauthenticated user → confirmation shows reference number → admin sees the lead in /admin/turnkey with correct auto-assignment.
    - Lighthouse mobile ≥ 80 on /turnkey and /turnkey/atlas (budget from ADDON-28).
    - Accessibility (axe) ≥ 95 on every new page at 360 px.

Done when: /turnkey, /turnkey/atlas and the 4 live project pages are published; 21 register-interest pages collect leads; admin can review, assign and promote projects to live; the Atlas map and hub-filter work on mobile; a buyer can complete an interest request in under 2 minutes on a phone; the admin sees the lead within 5 seconds.
```

## Sequencing with the other add-ons

- ADDON-26 (China fonts) **before** this — so the project pages use local fonts.
- ADDON-27 (bulk import) is unrelated; can run before or after.
- ADDON-28 (mobile + PWA) **before** this — so the mobile flow uses the bottom nav, sticky CTAs, bottom-sheet forms, and web push for lead notifications.
- ADDON-29 (template columns) is unrelated.
- ADDON-30 (Dubai DC) doesn't block this; ship Turnkey on the current stack first.

## What to decide while this is being built

1. **The budgets on the 21 register-interest projects.** The starting figures on the design canvas are rough planning numbers. Get a one-line quote from a supplier in each hub before you publish the page, otherwise you're committing to a number you may not hit.
2. **How many interest signals before you build packages.** The prompt uses 10 as a default. If you want to validate demand faster or slower, change the number in step 5.
3. **Who takes the leads.** Assign at least one sourcing staff per region (MENA, Africa, Indian subcontinent, SEA, Europe) before you go live, otherwise leads sit in the triage pool.
