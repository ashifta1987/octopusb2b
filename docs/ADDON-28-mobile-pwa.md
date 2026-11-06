# Add-on: mobile-optimise the site and ship it as a PWA

## Why

B2B buyers check RFQs and orders from their phones between meetings. Factory contacts work on Android handsets from the floor. A single responsive web app that installs to the home screen, works offline for cached pages and can push updates covers both — no App Store, no Play Store, no China app-market gap, no second codebase.

Scope prioritises the **Buyer portal** (storefront, RFQs, orders, wallet, assistant, group buys, support, KYC) and the **Supplier portal** (once ADDON-24 flips `supplier_portal_enabled=true`). Back-office (Admin / Finance / Sourcing) keeps working on mobile but isn't the design target.

## Antigravity prompt 28-A — responsive polish + PWA + web push

```
Read docs/SPEC.md sections 3, 8 (storefront), 8.3 (customer portal), 14 (supplier portal), ADDON-23 (customer sidebar) and ADDON-26 (fonts and China accessibility). Mobile-optimise the site end to end and ship it as an installable PWA. Priority audiences: buyers first, suppliers second. Back-office can stay desktop-first for now.

1. Responsive design targets
   - Breakpoints: 360 (iPhone SE class), 390 (iPhone 15), 414 (iPhone Pro Max), 768 (tablet), 1024, 1360. Every buyer-portal and supplier-portal screen must work from 360 px up.
   - Base font-size on inputs: 16px (prevents iOS Safari zoom on focus).
   - Tap targets: 44 × 44 CSS px minimum (WCAG 2.5.5 + Apple HIG).
   - Safe-area insets: `padding-bottom: env(safe-area-inset-bottom)` on bottom navs and sticky CTAs so iPhone home-bar doesn't overlap.
   - Hit-test: no interactive element within 8 px of another.
   - Line length: 60–75 ch on mobile reading surfaces (product description, assistant messages, policy pages).
   - No horizontal scroll at any breakpoint except where it is a deliberate gesture (category rail on home, image carousel on PDP).

2. Buyer portal mobile layout
   - Replace the sidebar on viewports < 768 px with a bottom nav of 5 items: Home · RFQs · Orders · Pools · More. "More" opens a sheet with Wallet · Ledger · Assistant · Company & KYC · API · Help.
   - Sticky top header (brand + search icon + account icon) that collapses on scroll.
   - Product list → one card per row (image left, title + price right); the desktop grid returns at ≥ 768 px.
   - Product detail → tabbed scroll sections (Overview · Specs · Suppliers · Shipping · Reviews) with a sticky bottom CTA: Price · Add to RFQ · Chat supplier.
   - Filters move to a bottom-sheet drawer triggered by a Filters pill; applying closes the sheet.
   - RFQ, order and ledger tables → stacked cards on mobile with primary field as the heading and secondary fields as a definition list.
   - Modals above 90 vh become bottom sheets with a grab handle; the keyboard never covers the submit button (use `visualViewport` to resize).
   - Images: next/image with `sizes="(max-width: 768px) 100vw, 50vw"`, AVIF then WebP fallback.
   - Chat (Assistant): bubble layout already mobile-ready; ensure the composer sticks above the on-screen keyboard and the scroll stays pinned to the newest message.

3. Supplier portal mobile layout (behind supplier_portal_enabled; build the layout, don't ship it until the flag flips)
   - Same bottom-nav pattern with 5 items: Quotes · Orders · Pools · Finance · More.
   - Quote form must work one-handed on a 390-px phone: numeric inputs with inputmode and pattern set; MOQ + price + variant selectable without scrolling past the CTA.
   - Product bulk-edit (ADDON-27 flow) is desktop-only — on mobile it shows a notice "Please open on a laptop to upload the catalogue" and a Copy-link button.
   - Image upload uses capture="environment" so a factory contact can shoot a product photo directly from the page.

4. Progressive Web App
   - `app/manifest.webmanifest` with name, short_name, start_url `/`, scope `/`, display `standalone`, theme_color, background_color, icons at 192 / 384 / 512 / 1024 (maskable + any), screenshots for Android install prompt (one buyer and one supplier).
   - Separate manifests per audience are a maintenance trap; use one manifest and let the install prompt land on `/` for a buyer and on `/supplier` for a supplier (detected from role at manifest-resolution time via a short redirect from `/pwa/supplier/start`).
   - Service worker with Workbox: cache-first for fonts and static assets (hashed), stale-while-revalidate for the app shell, network-first with a 2 s timeout for API calls (fall back to a last-known-good JSON in IndexedDB for /account, /orders list and /rfqs list).
   - Offline fallback: /offline page explains what still works (reading cached orders, drafting an RFQ that syncs when back online).
   - Install prompt: a tasteful bottom banner (`beforeinstallprompt` on Android, "Add to Home Screen" instructions sheet on iOS) shown at most once per 7 days per user, suppressed if the user has dismissed it twice.
   - Update flow: when a new SW activates, show a non-blocking toast "New version available — refresh" with a button that calls `skipWaiting` + `clients.reload`.

5. Web push notifications
   - VAPID keys stored in Supabase Vault, not in env files.
   - Subscription stored in `web_push_subscriptions` (user_id, endpoint, p256dh, auth, user_agent, created_at, revoked_at).
   - Permission is requested only in response to a user action (toggle in /account/settings → Notifications), never on page load.
   - Events that push: RFQ reply, quote accepted/rejected, order status change (confirmed, packed, shipped, delivered, exception), pool fill reached, wallet top-up confirmed, KYC approved/rejected, support ticket replied, assistant handoff happened.
   - Each event has a user-level mute toggle. Default-on for RFQ reply, order status and assistant handoff; default-off for everything else.
   - On click, push opens the deep link (`/rfqs/<id>`, `/orders/<id>`, etc.) in the installed PWA or the browser tab if the PWA isn't installed.
   - China fallback: web push via the browser's own push service works on iOS Safari 16.4+ in China, but Android Chrome push goes through FCM which is blocked in mainland China. For a user whose last IP geolocates to CN on an Android browser, fall back to in-app bell + email + WeChat Work webhook if a WeChat Work contact is on file for that supplier. UI copy: "We'll notify you by email and WeChat when a RFQ reply arrives."

6. Performance budget on 4G mid-tier Android (Moto G Power class), Lighthouse mobile:
   - LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1
   - Transfer ≤ 180 KB JS + 60 KB CSS on the home page; ≤ 220 KB JS on PDP.
   - First-load JS for the buyer bundle ≤ 220 KB gzipped.
   - Lighthouse PWA ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, Performance ≥ 80 on 4G Moto G Power.
   - A performance gate in CI fails the build if any of these regress by more than 10 %.

7. Accessibility checks that matter more on mobile
   - Focus-visible is never removed; it's styled to be ≥ 2 px with 3:1 contrast against both backgrounds the input sits on.
   - Screen-reader labels on every icon-only button (bottom nav, close, share, filter, add-to-RFQ).
   - Reduced-motion: no auto-play animations, no scroll-jack, no parallax.
   - Dark mode: respects `prefers-color-scheme` and offers an in-app override under /account/appearance.
   - Language toggle (EN / 中文 subset we already have on About and the name card) is visible on mobile too.

8. Mobile-specific defects to fix across the current designs (go through them explicitly):
   - Home: category rail scrolls horizontally with scroll-snap; cards are 160 px wide on phone.
   - Home: the Global Shipping stats band wraps to 2×2 at 360 px.
   - PDP: tabbed scroll with a sticky CTA bar; the "Request a sample" and "Add to RFQ" buttons never overlap the bottom home-bar.
   - RFQ list: card layout with status pill in the top-right; swipe-right exposes a Delete action (uses `pointer` events, not `touchstart`).
   - RFQ create: the quantity + unit + target-price trio stacks vertically on mobile, not inline.
   - Pools detail: progress bar sticks to the top on scroll; pledges list uses infinite scroll.
   - Wallet: balance card goes full-width; top-up CTA sits at the bottom with the amount keypad using inputmode="decimal".
   - Ledger: filters go into a bottom sheet; the table becomes a card list; a one-tap "Export CSV" is in the sheet's footer.
   - Assistant: composer uses auto-grow up to 6 lines; "Hand to a human" button is in the header, not inside the drawer.
   - KYC upload: each document is one card with a capture="environment" button and a visible progress bar; a user can abandon a document and come back later.
   - Account & company: pages split into tabs (Overview · Addresses · Contacts · Legal); each tab fits in one phone screen.

9. Tests
   - Playwright golden path on 360, 390, 768, 1024 viewports: install PWA, open offline, cached pages render, an RFQ reply push is received.
   - axe-core on every buyer-portal and supplier-portal page at 360 px.
   - Lighthouse CI per the budget in step 6.
   - Manual check list: iPhone 13 Safari, iPhone 15 Pro Safari, Pixel 7 Chrome, mid-range Android (Moto G Power) Chrome, iPad Safari, Samsung Internet. The list lives at docs/manual-mobile-check.md.

Done when: every priority page (Buyer portal + Supplier portal) is fully usable at 360 px without horizontal scroll, the site installs to the home screen on iOS and Android, offline opens the shell and shows cached data, a user can opt into push and receive an RFQ-reply notification, Lighthouse mobile ≥ 90 PWA / ≥ 80 Performance on 4G.
```

## What this doesn't do

- No native iOS or Android app. If you later need one capability only native offers (barcode scanning on the warehouse floor, say), wrap *just that module* in Expo and keep everything else on the PWA.
- No separate mobile codebase — one Next.js app, one deploy, one URL. The PWA is a layer on top.
- No change to what the back-office sees on a laptop. Admin / Finance / Sourcing stay desktop-first; they'll get phone usability but not phone-first design.

## Suggested sequence

Run **ADDON-26 (China fonts + CI gate) before 28-A**, otherwise the PWA will bake a `fonts.googleapis.com` dependency into the service-worker cache and you'll see broken text from mainland China. After 28-A lands, **the buyer portal is ready to publish**; the supplier mobile layout stays dark behind `supplier_portal_enabled=false` until you decide to open it.
