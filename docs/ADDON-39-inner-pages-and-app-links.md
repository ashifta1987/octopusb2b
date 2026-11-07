# Add-on 39: service inner pages that lead into the separate apps

## What this add-on does

- The home page stays exactly as it is. Only the links on it change, so each service section points to its inner page.
- Each service gets inner pages in the same style as the home page: the same header, service rail, fonts (Lexend headings, Inter text, IBM Plex Mono labels), colours (navy #11133C, blue #2A6FD6, background #F5F6F8), cards, buttons and footer.
- The main buttons on those pages carry the visitor into the separate apps: the Dropship app and the 3PL app, each on its own domain, signed in through the portal (single sign-on). Sourcing stays inside My account on the portal, because only office staff use the Purchase staff app.

Design canvas: "Octopus inner pages — Dropship, 3PL, Sourcing" (10 artboards, listed below). Rules for sign-on, provisioning, billing and white-label are in the overview doc and in the Dropship Hub, 3PL Hub and Purchase Hub plan docs.

## Pages and where each button goes

| Artboard | Route | Main buttons → destination |
|---|---|---|
| Dropshipping inner page | `/dropship` | "Start 7-day free trial" → `/dropship/start` · "See plans" → `/dropship/pricing` · "Open the Dropship app" → `/apps/dropship/open` |
| Dropship plans | `/dropship/pricing` | Plan cards (Starter $49, Growth $149, Custom $299 unlimited) → `/dropship/start?plan=` |
| Dropship start | `/dropship/start` | Plan → account (sign up or signed-in) → store platform and order volume → "Open Octopus Dropship" → `/apps/dropship/open` |
| 3PL inner page | `/3pl` | "Get a 3PL quote" → `/3pl/quote` · "Shipping and DDP" → `#ddp` · "Open the 3PL app" → `/apps/3pl/open` |
| 3PL quote | `/3pl/quote` | Works without an account. Sends the request, shows reference 3Q-xxxx |
| 3PL accept quote | `/3pl/start?quote=` | Sign in or sign up, accept quote and terms → `/apps/3pl/open` |
| Product sourcing inner page | `/sourcing` | "Continue to the request" → `/sourcing/request` (prefilled) · "Track it" → `/account/sourcing` |
| My account, your apps | `/account` | App cards: Dropship (trial/active/none), 3PL (client/none), Sourcing; "Apps" switcher in the header |
| Hand-off screen | `/apps/[app]/open` | Shown for a moment while the portal sends the user to the app; a "Continue" button as fallback; login state if the session has expired |
| Phone | the same pages at 390 px | |

MOQ pools and Turnkey already have their inner pages (`/pools`, `/turnkey`); add them to the same rail and footer, nothing else changes.

## Antigravity prompt 39-A: home page links only

```
Do not change the home page layout, text, images or styles. Change only these link targets on the home page:
- Service strip cards and the "Product sourcing", "Dropshipping", "MOQ pools", "3PL warehousing", "Turnkey Projects" rail items → /sourcing, /dropship, /pools, /3pl, /turnkey (today they jump to #anchors on the home page).
- Dropship section: "Start dropshipping" → /dropship/start; "How it works" → /dropship; "Open a dropship account" → /dropship/start.
- 3PL section: "Get a 3PL quote" → /3pl/quote; "Shipping coverage" → /3pl#ddp.
- Hero RFQ card "Request quotes" → /sourcing/request with product, qty and country passed as query parameters (fixes the ADDON-36 prefill bug).
- Footer "Services" links → the same inner page routes.
Take a before/after screenshot of the home page at 1440 and 390 px and confirm they are identical apart from the hover targets.
```

## Antigravity prompt 39-B: shared inner-page layout

```
Create one shared layout for service inner pages (app/(services)/layout.tsx) that reuses the home page's existing header, service rail and footer components, the same tokens and the same class names (.wrap, .sec, .btn-*, .card, .h2, .lead, .k, .pill-*, .num). Do not create a second design system. The rail highlights the current service (aria-current="page"). Add a breadcrumb under the rail ("Home / Dropshipping / Plans").

On phones (<= 760 px) reuse the home page's mobile rules: rail scrolls sideways, grids collapse to one column, CTA buttons go full width, the bottom navigation stays.
```

## Antigravity prompt 39-C: Dropship pages

```
Build /dropship, /dropship/pricing and /dropship/start from the canvas artboards "Dropshipping inner page", "Dropship plans" and "Dropship start".

/dropship sections: hero with "Start 7-day free trial" and "See plans" and "Already a member? Open the Dropship app"; sales channels (Shopify, WooCommerce, Wix, Amazon, eBay, TikTok Shop); how it works in 4 steps; three shipping types by service name only (Express, Standard, Economy) with no carrier or partner names; 4 live products from the catalogue that are dropship-enabled ("Dropship price in the app" until a dropship price list is public); plans teaser; FAQ; CTA band.

/dropship/pricing: three plan cards, selectable, with the chosen plan summarised under them and a "Start 7-day free trial" button that passes ?plan=starter|growth|custom. Plan limits for Starter and Growth come from a plans table (stores, orders a month); until the owner fills them, show nothing rather than a made-up number. Show the Shopify App Store billing note and the per-order cost table.

/dropship/start: four steps in one page.
1. Plan (pre-selected from ?plan).
2. Account: signed out → Google or email sign-up (name, work email, company, country, password, terms) or "Log in"; signed in → show the account and "Start trial on this account". Existing customers are never enrolled without this click.
3. Store platform and rough monthly orders (stored on the entitlement for onboarding).
4. Portal creates entitlement dropship = trial (7 days), calls the Dropship app POST /provision, then shows "Open Octopus Dropship", which goes to /apps/dropship/open.
```

## Antigravity prompt 39-D: 3PL pages

```
Build /3pl, /3pl/quote and /3pl/start from the canvas artboards "3PL inner page", "3PL quote" and "3PL accept quote".

/3pl: hero with "Get a 3PL quote", "Shipping and DDP" and "Already a client? Open the 3PL app"; who it is for; 4 steps; DDP band for the Gulf (UAE, Saudi Arabia), the US and the UK by service name, transit times from the rate table (hide if empty); the six screens of the 3PL app; what you pay (storage, inbound, pick and pack, shipping, DDP); CTA band.

/3pl/quote: no login needed. Fields: product type, size range, weight range, orders a month, number of SKUs, battery or liquid, destinations, sales channels, company, name, email, phone (optional), notes. Signed-in users get company fields prefilled. On submit store a 3PL quote request, email reference 3Q-xxxx and show the success state.

/3pl/start?quote=<token>: shows the priced quote (lines and validity) from the back office, sign in or sign up, "I accept this quote and the 3PL terms", then the portal grants wms = client, calls the 3PL app POST /provision with the rate card and sends the user to /apps/3pl/open. Expired quotes show "Ask for a new quote".
```

## Antigravity prompt 39-E: sourcing inner page

```
Build /sourcing from the canvas artboard "Product sourcing inner page" in the home page style: hero with the RFQ card (product, quantity, destination → /sourcing/request with the values passed through), "Track it in My account → Sourcing", how it works in 4 steps, what you pay (RFQ fee US$ 5, sample + US$ 25 handling, deposit in escrow, balance after QC), the four offices (from the offices table), FAQ, CTA band. Sourcing never sends clients to another app: requests, quotes and purchase orders live in My account → Sourcing (ADDON-38 38-C).
```

## Antigravity prompt 39-F: app hand-off, app switcher and My account

```
1. Env: DROPSHIP_APP_URL, WMS_APP_URL (each app's own domain), OIDC client ids per app.
2. Route /apps/[app]/open (app = dropship | 3pl):
   - Not signed in → portal login with next=/apps/[app]/open, then continue.
   - Signed in but no entitlement → send to /dropship/start or /3pl/quote with a short message.
   - Signed in with entitlement → render the hand-off screen (canvas artboard "Hand-off screen") and immediately redirect to the app's /sso/callback with a one-time code (60 seconds, single use), exactly as the overview doc section 2. Show a "Continue to …" button in case the redirect is blocked.
   - Log every hand-off (user, org, app, time, result).
3. Header "Apps" switcher on every portal page for signed-in users: Octopus B2B (this site), Dropship, 3PL — only apps the company has an entitlement for, each with an external-link icon. Footer text: one login for every app; logging out here logs out of all.
4. /account dashboard: "Your Octopus apps" cards from the canvas artboard "My account, your apps":
   - Dropship: status Trial / Active / Not started, plan, trial days left or next charge, orders this month, orders waiting for top-up (from the Dropship app summary API), "Open Dropship app" and "Change plan"; not started → "Start 7-day free trial".
   - 3PL: client → units in stock, open inbounds, shipped this month, current invoice (3PL app summary API) and "Open 3PL app"; otherwise "Request 3PL access" → /3pl/quote prefilled.
   - Sourcing: open requests, purchase orders, "need you" count, "Open Sourcing" (stays in the portal).
   - Wallet balance and Top up at the top.
5. Logout anywhere ends the portal session and calls each app's back-channel logout.
6. Tests: signed-out visitor → /dropship → start trial → lands in the Dropship app signed in; signed-in client → "Open Dropship app" → no password prompt; client without 3PL → "Request 3PL access" prefilled; expired session → hand-off shows login, then continues; logout in the Dropship app logs out of the portal too.
```

## Notes

- Placeholders in the designs ([N] plan limits, [transit days], [rate], [date], [dropship app domain], [3PL app domain]) are open decisions or live data. Build them from data and hide them when empty; never ship the bracket text.
- White-label: customer pages name services (Express, Standard, Economy, DDP), never carriers, partner warehouses, suppliers or source marketplaces. Sales channels the client connects (Shopify, WooCommerce, Wix, Amazon, eBay, TikTok Shop) are allowed.
- The overview doc proposes newer brand tokens (navy #1A174A, blue #347BE1, Inter + Fredoka) for the hub apps. The portal's inner pages follow the current home page as asked; if the brand switch happens later, it changes the shared tokens once for home and inner pages together.
- Build order: 39-A and 39-B first, then 39-C, 39-D and 39-E in parallel, then 39-F once SSO and provisioning work (overview doc weeks 1–2).
