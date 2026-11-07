# UI/UX + build prompt for Antigravity: Make My Brand on the home page, dropship catalogue, audit fixes

This one prompt carries both the design (look, layout, components, copy, states) and the build instructions. Paste the block below into Antigravity. The screen PNGs in `design/audit-fixes/screens/` are the visual reference; this text is the spec. Where text and PNG differ, the text wins.

```
ROLE: You are building 7 screens on Octopus B2B (hostoctopus.com, Next.js + Supabase + Vercel) on the STAGING branch. Match the UI/UX spec below exactly, then wire the data. Stop after each step for my check with desktop (1440 px) and phone (390 px) screenshots next to design/audit-fixes/screens/<nn>-*.png.

======================================================================
PART 1 · DESIGN SYSTEM (use these tokens everywhere; add them to the shared theme, not per page)
======================================================================

COLOURS
  navy        #11133C   headings, body text, dark buttons, footer, announcement bar
  blue        #2A6FD6   filled primary buttons (white text), active tab underline, step numbers
  blue-text   #1E58B0   ANY blue text or link on white (contrast 4.5:1+). Never #2A6FD6 for text.
  bg          #F5F6F8   page background
  surface     #FFFFFF   cards, header
  border      #E2E5EA   card and divider lines
  muted       #5A6475   secondary text (passes 4.5:1 on white)
  body-2      #3B4556   long body text
  soft-blue   #E6EFFC   light blue fills (pills, highlighted rows)
  green       #15803D on #DCFCE7   verified / available / live
  amber       #92400E on #FEF3C7   "Example" pill, warnings
  orange      #9A3412 on #FFEDD5   "needs you" items
  new-badge   #11133C text on #F59E0B   the NEW badge
  red         #991B1B on #FEE2E2   errors, not available

TYPE
  Headings: Lexend. H1 public hero 50px/1.05 weight 800, letter-spacing -0.03em (phone 32px).
            H1 account pages 30px/1.15 800. H2 section 34px/1.12 800 (phone 25px). H3 card 16.5–18px 700.
  Body: Inter 15–16.5px, line-height 1.55–1.6. Small 13–14px.
  Labels ("k"): IBM Plex Mono 11px 600, uppercase, letter-spacing .06em, colour muted.
  Pills: IBM Plex Mono 11px 600 uppercase, padding 5px 10px, radius 999px.
  Money and ids: tabular numbers; ids (SKU, MB-0042) in IBM Plex Mono.

SPACING AND SHAPE
  Public container .wrap: max-width 1280px, side padding 32px (16px under 760px). Section padding 64px top/bottom (40px on phone).
  Cards: white, 1px border #E2E5EA, radius 14px. Inner padding 18–20px.
  Buttons: radius 10px, font Inter 600 15px. Public min-height 48px (hero 52px); account pages 44px; small 38px.
     primary = blue bg + white text · dark = navy bg + white · ghost = white bg + #C5CCD6 border, navy text · light (on navy) = white bg + navy text.
  Every clickable thing is at least 44px tall. Text links that are a section's main action get padding to 44px.
  Focus ring: 3px solid #1D4ED8, offset 2px, on every interactive element.
  Icons: 18–20px stroke icons (2px), never emoji.

COMPONENTS (build once, reuse)
  AnnouncementBar · navy strip, 13.5px white text, centred: [NEW badge] text + blue link (#9CC2FF on navy).
  PublicHeader · white, logo (42px tall), search field with navy 1.5px border and navy search button, "My account" ghost button.
  ServiceRail · white strip under header, pill links 14px: Product sourcing · Make My Brand [NEW] · Dropshipping · MOQ pools · 3PL warehousing · Turnkey Projects | All categories. Active = navy pill, white text. Scrolls sideways on phone.
  SectionEyebrow · numbered square (28px navy, white number, radius 8) + mono label + optional pill.
  StepCard · numbered square in blue + bold title + 1–2 line text. Rows of 6 on desktop, 2 per row tablet, 1 per row phone.
  ServiceChoiceCard · icon, title, one line, one button. Used on the product page (4 in a row, 2×2 tablet, stacked phone).
  VerifiedBadge · green pill "✓ VERIFIED BY OCTOPUS" + optional one-line explanation.
  ShippingTypePill · Express (blue on soft-blue), Standard (#166534 on #DCFCE7), Economy (#8A4B00 on #FEF3C7). Always the word, never colour alone.
  ExamplePill · amber "EXAMPLE" on any block whose numbers are not live.
  AccountShell · header (logo, search, STAGING badge on preview only, wallet balance chip, bell, avatar + name + company · role), service tabs (Home, Sourcing, Dropshipping, 3PL warehouse, Make My Brand, Wallet and invoices; active = 3px blue underline), side menu 236px (group labels in mono; active item navy fill white text), main padding 28px 32px. Phone: side menu becomes a horizontal scroll row under the tabs.
  StudioPreviewLabel · navy pill "STUDIO PREVIEW" top-left on the image + caption "Illustrative preview. Not approved artwork." under it. Mandatory on every branded mock-up.
  FAQ · native details/summary rows, 54px tall, white card.

CONTENT RULES (UI copy)
  Plain words, sentence case, no exclamation marks. Prices "US$ 1,234.56". Delivery "5–10 days".
  Customer and public pages never show supplier names or codes, carrier names, or Octopus cost/margin.
  Payment wording everywhere: "Paid from your Octopus wallet. Top up by bank transfer — no card payments."
  Unknown values: render from settings; when empty show nothing or "To be confirmed" — never a made-up number, never square brackets on live.

======================================================================
PART 2 · SCREENS (layout, components, copy, states)
======================================================================

[20] HOME PAGE "/" — keep every existing section; add only:
  1. AnnouncementBar (rotates with the Turnkey line, both editable in Site content):
     "Make My Brand: your logo on verified products, stocked in our warehouse, shipped worldwide." Link "See how it works →" → /make-my-brand
  2. ServiceRail: insert "Make My Brand" + NEW badge as item 2.
  3. NEW SECTION 2 right after the sourcing hero (renumber later sections 3, 4, 5):
     Eyebrow: [2] MAKE MY BRAND [NEW]
     H2: "Your brand on proven products."
     Lead (max 620px): "Pick a product from our verified suppliers and we put your logo on it, on the product and on the box. We produce and check it, keep it as your stock in our warehouse, and ship it worldwide, in bulk to one country or order by order from your online store."
     6 StepCards: 1 Pick a verified product · 2 Add your brand · 3 Approve proof and sample · 4 We produce and check · 5 Stocked in our warehouse · 6 Shipped worldwide.
     Two-column row: left = 2 product cards (product photo, StudioPreviewLabel, brand name over the photo, caption "<product> · <method>"); right = 3 proof points with icons (Verified suppliers only / One account manager / Price confirmed before you pay), buttons [Start a brand project →] (primary → /request/brand) and [See how it works] (ghost → /make-my-brand), small line "Paid from your US dollar wallet, topped up by bank transfer."
     Background white; section separated by a 1px border.
  4. "Also on Octopus B2B" grid: first card spans 2 columns, navy background: "Make My Brand [NEW] — Your logo on verified products, stocked in our warehouse and shipped worldwide. See how it works →" with a product photo on the right.
  5. Footer Services column: add "Make My Brand". Remove any "Apps" column naming separate apps.
  6. Shipping section label: "Global shipping" (no carrier name).
  Phone: steps stack 1 per row, product cards 1 per row, CTA buttons full width.

[21] MAKE MY BRAND PAGE "/make-my-brand"
  Breadcrumb "Home / Make My Brand". ServiceRail item active.
  Hero (2 columns, gradient white → #F2F7FE): eyebrow, H1 "Put your brand on products made by verified factories.", lead, buttons [Start a brand project →] [Talk to an account manager], trust line (3 ticks: Verified suppliers only · Price confirmed before you pay · One account manager). Right: large product photo with StudioPreviewLabel.
  How it works: 6 StepCards, each with "You:" or "Octopus:" tag showing who does the step.
  What you can brand: cards for Pad or silk print · Laser engraving · UV print · Branded colour box · Inserts and manuals; each shows "Minimum quantity" and "Typical extra time" from settings.
  Example projects: 3 cards (photo, product, method, quantity, ExamplePill).
  Your account manager: avatar initials, name from the customer's assignment (public page: generic "Your own account manager"), what they do, reply time from settings.
  What it costs: table of an EXAMPLE quote — Product US$ 17,310 · Branding 360 · Packaging 1,260 · Sample 160 · Inspection 45 · Total US$ 19,135; Deposit to start US$ 5,740.50; Balance before shipping US$ 13,394.50. Header ExamplePill and caption "Example quote — your price is confirmed in your own quote before you pay."
  Where your stock goes: two cards (Order by order from your store · In bulk to a country) with service names Express / Standard / Economy / DDP Gulf / DDP US / DDP UK.
  FAQ (5): minimum order · how long · who owns the artwork files (you; kept private) · sample first · how to pay (bank transfer to wallet, no cards).
  Final navy CTA band: "Start a brand project" [light button].

[22] DROPSHIPPING › CATALOGUE "/account/dropship/catalogue" (AccountShell, Dropshipping tab, side menu "Catalogue" active)
  Title row: H1 "Catalogue" + line "Only products available for dropshipping to your markets are shown · Verified suppliers only · Prices include shipping and duties to the country you choose" + [Import list (n)] ghost button.
  Filter card: Search · "Customers in" select · Sort select (Fastest delivery, Best profit, Lowest cost, Newest) · chip group Shipping type (All, Express, Standard, Economy; selected = navy) · Category select · toggle "In our warehouse now". Result count line under it.
  Grid: auto-fill columns min 240px, gap 16px. ProductCard: square image (or neutral tile with box icon), VerifiedBadge, ShippingTypePill + "5–10 days", title (2 lines max, link to product page), stock line, three rows Your cost (incl. shipping) / Suggested price (bold) / Profit (green, with %), button [Add to import list] → toggles to [Added ✓] (soft style).
  Blocked product: image at 50% opacity, grey note "Not available to <country>: <reason>", no add button, sorted to the end.
  States: loading = 8 grey card skeletons; empty = "No products ship to <country> with these filters" + [Clear filters].
  Phone: filters collapse into a [Filters] button opening a sheet; grid 1 column (2 at ≥ 480px).

[23] DROPSHIP PRODUCT PAGE "/account/dropship/catalogue/[id]"
  Breadcrumb Dropshipping › Catalogue › <product>.
  Top row, 2 columns: LEFT gallery card (main image 1:1, 3 thumbnails, caption "Photo n of N · all photos go to your store"). RIGHT: category label, H1 product name, badges (VerifiedBadge · In our warehouse · Express available), one line "Ships Express to <country> in 5–10 days. From US$ x per order, shipping and duties included.", card with variant chips (colour dot + name; selected = navy) and stock for the selected variant, "Customers in" select with a note whether it can ship there.
  Second row, 2 columns: LEFT card "Cost to you per order" — table with radio per row: Shipping type · Ships from · Product · Shipping and duties · Fulfilment fee · Total (bold) · Delivery; selected row soft-blue with a 3px blue left bar; footnote on wallet charging and mixed orders. RIGHT card "Your price" (2px navy border): Your cost, Suggested retail (+ "Pricing rules" link), number input "Your selling price (US$)", live box Profit per order (green, large) and Margin %, note "Before your store's channel and payment fees.", buttons [Add to import list] (primary, full width), [Push to my store] (dark) opens inline checklist of connected stores, [Order a sample] (ghost).
  Below: card "What your customer sees" (title, bullet points, description — badge "Editable later in the import editor"; no supplier, Octopus name or price in the listing). Three cards: Shipping and restrictions · Packing (your packing slip, plain outer box, no Octopus prices) · Returns (from settings). Navy band "Want your logo on this product? Start a Make My Brand project" → /request/brand?product=<id>.
  Behaviour: changing country or shipping type recalculates every number; price input recalculates profit instantly; a variant out of stock disables Add.

[24] PUBLIC PRODUCT PAGE "/p/[slug]"
  Gallery + title + VerifiedBadge with line "Octopus checked this factory: licence, site visit, QC record". Supplier shown as "Octopus verified factory · <province>" (no code, no name). Tier price table, MOQ, sample price.
  Block "What do you want to do with this product?" — 4 ServiceChoiceCards: Buy in bulk [Request quote] (RFQ fee) · Put your brand on it [NEW] [Start a brand project] (only if verified) · Dropship it [Add to my dropship catalogue] · Store it near your buyers [Get a 3PL quote].
  Services row: Sample · QC inspection · Certification. Payment line (wording above). Specs table. More from this factory.
  Products from unverified suppliers: show "Not yet verified" in amber and hide "Put your brand on it".

[25] REQUEST CENTER › 3PL "/request/3pl"
  Request Center tabs (pills, scroll on phone): Product sourcing · Make My Brand [NEW] · Dropshipping · 3PL service (active) · Sample request · QC inspection · Certification.
  Two columns: LEFT form card: What will we store · Warehouse = radio cards, one per real location from config (city, country, what it handles), plus "Not listed? Ask us" (reveals a country field) · Orders per month · Storage type (radio chips) · Sales channels (chips) · Anything else. Fee box: "3PL request · Free to submit" + rates text from settings. Line "You get a reference number right away and can follow it in My account › 3PL warehouse." Button [Send request].
  RIGHT: "What happens next" vertical stepper: Submitted → Rates sent → Accepted → Send your first inbound notice → Goods received and counted → Live: orders ship from stock. Card "Before you ship to us" checklist (cartons labelled with SKU and reference · inbound notice created in My account · accepted and refused goods · same-day cut-off time).
  Errors: inline under each field, red text + icon; submit disabled only while sending, never silently.

[26] REQUEST CENTER › MAKE MY BRAND "/request/brand"
  Same Request Center tabs (Make My Brand active). Progress bar with 3 labelled steps; Back / Next buttons; Next disabled until the step is valid, with the reason shown.
  Step 1 Product: grid of verified product tiles (radio), or "I have a product link" field; quantity; target markets (chips).
  Step 2 Brand: branding method radio cards; packaging radio cards; logo upload drop zone (SVG, AI, PDF, PNG ≥ 2000px) with the line "Your files are private: only you, your account manager and the approved proof go to the factory."; brand colours (Pantone or hex fields).
  Step 3 Delivery and stores: where the stock goes (radio cards: Octopus warehouse for order-by-order shipping · Bulk to a country + country select); stores (Shopify · WooCommerce · Not yet); note; summary with [Edit] per section; fee box "Make My Brand request · Free · Your account manager sends a quote with the final price, delivery date, duties and shipping before you pay anything."; [Send request]; line "Follow it in My account › Make My Brand."
  Side card: Your account manager + the 6 steps.
  After send: success panel with reference MB-xxxx and [Open my brand project].

GLOBAL UX RULES FOR ALL 7 SCREENS
  - Works at 390, 768, 1280 and 1440 px with no sideways page scroll; wide tables scroll inside their card.
  - Every image has alt text; decorative icons aria-hidden; form fields have visible labels.
  - Contrast ≥ 4.5:1 for text (use blue-text for links), ≥ 3:1 for borders of inputs and buttons.
  - Loading = skeletons in the shape of the content, never a blank screen.
  - Every empty state says what to do next and offers the button to do it.

======================================================================
PART 3 · BUILD STEPS (stop after each one)
======================================================================

44-A Report only, change nothing: where supplier "verified" lives and how many Octopus-listed products show "Not yet verified"; which products have dropship data (cost per country and service, weight, restrictions); where home sections, menu, announcement bar and "Also on" cards come from; where the 3PL warehouse list, Request Center steps and "follow the request" lines live; what is blocked by missing data.
44-B Shared design system: add the tokens and components of PART 1 to the theme and component library; show a staging page /dev/ui listing every component in every state.
44-C Quick fixes: Octopus-listed suppliers → verified (report how many changed); payment wording; "Octopus Dropship app" → "Dropshipping"; "Global shipping" label; each Request Center form names its own My account section; 3PL steps; one store-platform list (Shopify, WooCommerce, upload a sheet); "Store connection: coming soon — upload orders as a sheet meanwhile" wherever automatic order flow is promised until a real test order passes.
44-D Screens 20 and 21 (home additions, /make-my-brand), with title, description and Open Graph tags.
44-E Screens 22 and 23 (dropship catalogue and product page) on a database view dropship.v_catalogue(country): verified suppliers only, allowed to ship to that country. Test that no supplier or carrier name or Octopus cost appears in any response.
44-F Screens 24, 25, 26 (product page, 3PL request, Make My Brand request: creates a brand project, private logo storage with 10-minute signed links, notifies the account manager). /signup?service=… opens that section after sign-up.
44-G Checks: all 7 screens at 390 and 1440 px next to the PNGs; contrast and 44px targets; no "{{", "[" or example numbers on live; list anything blocked.
```

## Blocked until you send

- Real warehouse locations (for screen 25)
- Dropship plan and fees, delivery days per service (screens 22–23)
- 3PL rates and cut-off time (screen 25)
- Make My Brand minimum quantities and extra days per branding method (screen 21)
- Google sign-in for customers: yes or no
