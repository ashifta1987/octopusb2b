> **Implementation note (6 Nov 2026).** Built ahead of ADDON-26/28 (self-hosted fonts and PWA bottom nav come with those).
> - `/` order: announcement bar (all storefront pages, `home.announcement` + `home.announcement_enabled`) → header → rail (All categories · Turnkey Projects New · Group buys · Request a quote · Dropship & 3PL · | · categories) → banner grid (rotating CMS lead banner, Group-buy and Dropship · 3PL side banners) → stats strip → Live on the platform → Turnkey section → 10-card feature grid → `#global-shipping` → featured → pools → verified suppliers + sponsored slot → reviews → CTA + Octo card.
> - Migration `20261101000158_home_rebuild.sql`: `home_banners` (CMS, up to 3 rotate every 7 s, pause on hover/focus, no auto-rotation with reduced motion), `banner_events` + `log_banner_event()` (impressions / clicks / region, CTR shown in Admin → Site content → **Home page**), `home.feature_cards`, `home.show_placeholders` (false), `home.china_offices`.
> - **Owner rule kept (1 Nov 2026): only real figures.** The design's 220+ / 30+ hubs / 1M+ / 100+ carrier numbers appear only after an Admin enters them in `site_settings.logistics_stats`; until then the shipping band and the "Countries shipped" tile use live data or hide. "China offices" = active branches. Stat tiles without a real value are hidden.
> - Sections with no real data are hidden (live cards, featured, pools, suppliers, reviews). Suppliers with `identity_status <> 'ok'` (Bowijie OCT-1132) never appear as verified. The open-project card shows only a real lead in `contacted`/`quoted` status.
> - **Demo data:** until the ADDON-24 wipe is run, demo suppliers/products/RFQs are still "real rows" to the page (they are filtered only by the wipe).
> - Header keeps Sign in + Register for signed-out visitors (the design shows only "My account").
> - Tests: `tests/e2e/home.mjs` (1440 / 820 / 390). Visual-regression (2 %) and Lighthouse / axe gates not run yet.

# Add-on: rebuild the storefront home page (Turnkey banner + all features)

## Why

The home page now has to sell three things instead of one: the marketplace (products, RFQ, group buys), the logistics service (dropshipping, 3PL, YunExpress to 220+ countries) and the new Turnkey Projects line. The old page led with products only. The redesign puts a Turnkey banner first, adds an announcement bar and a stats strip, shows every platform feature in one grid, and keeps the verified-supplier and testimonial sections.

Design files (in the kit): `design/Main.dc.html`, `design/Main.png` (desktop), `design/Main-mobile.png` (390 px). Logo files: `design/assets/octopus-logo.png` (colour) and `octopus-logo-white.png` (dark backgrounds, footer).

## Antigravity prompt 32-A — rebuild `/` to match the new design

```
Read docs/ADDON-31 (Turnkey), ADDON-28 (mobile + PWA), ADDON-26 (no Google-hosted assets) and design/Main.dc.html + design/Main.png + design/Main-mobile.png. Rebuild the storefront home page at `/` to match the design exactly, using real data where it exists and the design's placeholders where it does not yet.

1. Page order (top to bottom)
   a. Announcement bar (dark): "New · Turnkey Projects — …" with a link to /turnkey/atlas. CMS-editable text; can be switched off in site_settings `home.announcement_enabled`.
   b. Sticky header: real Octopus B2B logo (colour PNG, 44 px high), search, "My account". Nothing else in the header.
   c. Category rail: All categories · Turnkey Projects (with a "New" pill) · Group buys · Request a quote · Dropship & 3PL · divider · product categories (from the categories table; horizontally scrollable).
   d. Banner grid: one large lead banner + two stacked side banners.
      - Lead banner = Turnkey Projects. Headline, body, two buttons (Explore Turnkey Projects → /turnkey, Project Atlas → /turnkey/atlas), container illustration, and a live "open project" card. The open-project card shows the newest real turnkey_leads row with status in progress; if none exists, hide the card (never show invented data).
      - Side banner 1 = Group buy (links to /pools). Show the real pool closest to filling in its footer.
      - Side banner 2 = Dropship · 3PL (links to #global-shipping).
      - Banners are managed from /admin/cms → Home banners (title, body, CTA label, CTA link, image/colour theme, start/end date, order). Up to 3 lead banners rotate every 7 s with pause-on-hover and reduced-motion respected; the slide dots in the design reflect that. Default: the Turnkey banner only.
   e. Stats strip (6 tiles): products, verified suppliers, turnkey projects, countries shipped, China offices, bulk saving. Values come from live counts (products published, suppliers verified, turnkey_projects status != archived) except "countries" (220+, from site_settings) and "offices" (4).
   f. "Live on the platform": newest open RFQ (anonymised: city + country only, top 3 quotes), the open pool closest to closing, one featured product. Hide any card whose source has no real row.
   g. Turnkey Projects section: "Start with these five" = turnkey_projects where is_starter_pick order by starter_rank; below it a strip of live packages with their From-prices.
   h. "Everything you need, in one platform": the 10-card feature grid in the design (RFQ, Group buy, Turnkey Projects [highlighted, New pill], Dropshipping, 3PL & global shipping, QC inspection, Certification, Wallet & escrow, AI account manager, API & integrations). Card order and visibility are CMS-controlled.
   i. Global shipping band (id="global-shipping"): 220+ countries, 30+ hubs, 1M+ parcels/day, 100+ service lines (YunExpress), country pills, three explainer cards.
   j. Featured products (4), Group buy strip (3 open pools), Verified suppliers (3 + 1 sponsored slot), What buyers say, Can't find what you need? + Octo card, footer.
2. Data rules (important — the demo data has been removed per ADDON-24)
   - Never render seed or placeholder rows on production. If a section has no real data, hide it, except Verified suppliers and What buyers say, which keep their bracketed placeholders only when `site_settings.home.show_placeholders = true` (default false in production).
   - Supplier cards show only suppliers with status = 'active' and kyc_status = 'verified'. A supplier in 'needs_identity_review' (e.g. Bowijie until the legal name is settled) must not appear.
   - Sponsored slot only shows an approved, in-date ad campaign and always carries the "Ad" label and "Why am I seeing this?" link.
3. Responsive (per ADDON-28)
   - ≥1100 px: as designed. 761–1100 px: banner grid becomes one column with the two side banners side by side; feature grid 3 columns; stats 3 columns.
   - ≤760 px: single column; the "Start with these five" cards become a horizontal swipe strip with scroll-snap (220 px cards); feature grid 2 columns (1 column at ≤480 px); the category rail scrolls horizontally; the container illustration is hidden; no horizontal page scroll at 360 px.
4. Assets and performance
   - Logos from /public/brand (self-hosted). Fonts self-hosted per ADDON-26. No Google-hosted assets.
   - LCP element is the banner headline (text), not an image. Banner images (when set in CMS) use next/image with width/height and AVIF/WebP.
   - Lighthouse mobile ≥ 80 performance, ≥ 95 accessibility, per ADDON-28.
5. Analytics: log banner impressions and clicks (banner_id, position, user region) to a banner_events table so the CMS can show click-through per banner.
6. Tests
   - Playwright (1440, 820, 390): the page renders every section with seed data absent; sections with no data are hidden, not empty; header contains only logo, search, My account; Turnkey banner CTA goes to /turnkey; no horizontal scroll; the five-card strip scrolls sideways at 390.
   - Playwright: a supplier with status needs_identity_review never appears in Verified suppliers.
   - axe: zero serious violations at 1440 and 390.
   - Visual regression against design/Main.png and design/Main-mobile.png with a 2 % tolerance (placeholders masked).

Done when: `/` matches the design at 1440, 820 and 390 px, the Turnkey banner leads the page and is editable from /admin/cms, no demo or unverified-supplier data appears, and the Playwright + axe + Lighthouse gates are green.
```

## Notes

- The Turnkey banner is designed as slide 1 of a rotating set. Only slide 1 is designed; the CMS lets you add more later (for example a seasonal promotion or a new project launch).
- Run after ADDON-26 (fonts) and ADDON-28 (mobile) so the page is built on self-hosted fonts and the bottom navigation.
