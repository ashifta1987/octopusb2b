# Add-on 44: Make My Brand on the home page, dropship catalogue and product page, audit fixes

Source: the audit doc "hostoctopus.com audit: service flows and missing pieces" (8 Nov 2026), findings 01–21. Export it as Markdown to `docs/hostoctopus-audit-2026-11-08.md`.

Screens in this kit (`design/audit-fixes/screens/*.png`, source in `design/audit-fixes/source/*.dc.html`):

| PNG | Screen | Route | Fixes |
|---|---|---|---|
| 20 | Home page with Make My Brand (menu, announcement bar, section 2, "Also on" card) | `/` | 01 |
| 21 | Make My Brand public page | `/make-my-brand` | 01, 14 |
| 22 | Dropshipping › Catalogue (only dropship-available products) | `/account/dropship/catalogue` | 08 |
| 23 | Dropshipping › product page | `/account/dropship/catalogue/[id]` | 07, 08 |
| 24 | Public product page (Verified by Octopus, 4 service choices, wallet-only payment) | `/p/[slug]` | 09, 13, 16, 01 |
| 25 | Request Center › 3PL (real warehouses, right steps, right follow-up place) | `/request/3pl` | 05, 10, 11, 12 |
| 26 | Request Center › Make My Brand (new, 3 steps) | `/request/brand` | 01, 14 |

## Hard rules

1. The home page layout stays as it is. Only add what boards 20–21 show: the menu item, announcement bar line, the Make My Brand section (as section 2, others renumbered) and the "Also on" card.
2. Make My Brand and the dropship catalogue show ONLY products whose supplier is verified. Products Octopus lists directly are verified. Enforce it in a database view, not only in the UI.
3. The dropship catalogue shows only products allowed to ship to the seller's chosen country; costs include shipping and duties to that country. Blocked products show why.
4. Customer and public pages never show supplier names or codes, carrier names, Octopus cost or margin.
5. Payment wording everywhere: "paid from your Octopus wallet; top up by bank transfer". No card payment anywhere.
6. Never present example data as live; numbers in the designs are examples. Text in [brackets] is an open decision or live data: fill it from settings or the database, or hide it. Never ship brackets or invented prices, rates, MOQs or delivery days.
7. Staging first. Stop after each prompt for my check, with desktop and phone screenshots next to the matching PNG.

## Prompt 44-A: report only (change nothing)

```
Read docs/ADDON-44-make-my-brand-on-home-dropship-catalogue-audit-fixes.md, docs/hostoctopus-audit-2026-11-08.md and the screens. Change nothing.
Report:
1. Where the supplier "verified" status is stored, how many products are listed by Octopus directly, and how many of those show "Not yet verified" today.
2. Which products have dropship data today (shipping cost per country and service, weight, restrictions), and what is missing to show board 23.
3. Where the home page sections, menu, announcement bar and "Also on" cards come from (code or Site content), so the Make My Brand additions can be edited without a deploy.
4. Where the 3PL warehouse country list comes from, and where the Request Center step lists and "follow the request" lines live.
5. Everything in this add-on blocked by missing data (warehouse list, rates, MOQs, delivery days, fees).
```

## Prompt 44-B: quick fixes (copy and data)

```
1. Catalogue: mark every supplier of a product Octopus lists directly as verified; show "Verified by Octopus" (board 24); keep "Not yet verified" only for supplier-listed products. Report how many changed.
2. Product page payment line: "Prices in US dollars, paid from your Octopus wallet. Top up by bank transfer — no card payments."
3. "Octopus Dropship app" → "Dropshipping" everywhere.
4. Home shipping label: "Global shipping" (no carrier name); service names Express / Standard / Economy.
5. Request Center "follow the request" line: each form names its own section (Dropshipping, 3PL warehouse, Make My Brand, Sourcing).
6. 3PL "What happens next": Submitted → Rates sent → Accepted → Send your first inbound notice → Goods received and counted → Live.
7. One store-platform list: Shopify, WooCommerce, or upload a sheet. Remove Wix, Amazon, Other until they connect.
8. Until the store connection and carrier pass a real test order, wherever automatic order flow is promised show "Store connection: coming soon — upload orders as a sheet meanwhile".
```

## Prompt 44-C: Make My Brand on the home page and its own page

```
Build boards 20 and 21:
- Menu: "Make My Brand" with a NEW badge, second after Product sourcing.
- Announcement bar: rotate the Make My Brand line with the Turnkey line (both editable in Site content).
- Home section 2 "Your brand on proven products": lead, 6 steps, two example product cards with "Studio preview" labels and "Illustrative preview. Not approved artwork.", 3 proof points, buttons "Start a brand project" (→ /request/brand) and "See how it works" (→ /make-my-brand). Renumber the following sections.
- "Also on Octopus B2B": Make My Brand card first.
- /make-my-brand: hero, how it works, what you can brand (methods with MOQ and extra days from settings, [to be confirmed] when empty), example projects (labelled Example), account manager, the example cost breakdown labelled "Example quote", where your stock goes (service names only), FAQ, CTA.
- Footer Services column: add Make My Brand.
- SEO: title, description and Open Graph tags for / and /make-my-brand.
```

## Prompt 44-D: dropship catalogue and dropship product page

```
Build boards 22 and 23 inside My account › Dropshipping:
- /account/dropship/catalogue: only verified products with dropship data that can ship to the chosen country (database view dropship.v_catalogue(country)). Filters: search, Customers in (country), shipping type (Express / Standard / Economy), category, sort, "In our warehouse now". Cards: Verified by Octopus, shipping type + days, cost incl. shipping and duties, suggested price from the seller's pricing rule, profit, Add to import list / Added. Blocked products greyed with the reason.
- /account/dropship/catalogue/[id]: gallery, variants with stock, Customers in (country), "Cost to you per order" table per shipping type (product, shipping and duties, fulfilment fee, total, days), Your price with live profit and margin, Add to import list, Push to my store (connected stores), Order a sample, "What your customer sees" (title, bullets, description to push), Shipping and restrictions, Packing (your packing slip, no Octopus prices), Returns (from settings), and a "Make it your brand" card linking to /request/brand?product=[id].
- Side menu: Catalogue links to the new page; dashboard "Browse catalogue" too.
- Test: a product whose supplier is not verified, or that cannot ship to the chosen country, never appears; no supplier or carrier name and no Octopus cost appear in any response for these routes.
```

## Prompt 44-E: public product page and Request Center

```
1. /p/[slug] (board 24): "Verified by Octopus" with the short explanation; supplier shown as "Octopus verified factory · [province]" (no supplier code to the public); "What do you want to do with this product?" with 4 cards: Buy in bulk (RFQ), Put your brand on it (Make My Brand, only on verified products), Dropship it, Store it near your buyers (3PL); services row; wallet-only payment line.
2. /request/3pl (board 25): warehouse choice = only real locations from config (radio cards with city and what it handles) + "Not listed? Ask us"; rates shown as text from settings, [to be confirmed] when empty; "Before you ship to us" checklist; corrected steps; follow-up in My account › 3PL warehouse.
3. /request/brand (board 26): new Request Center tab "Make My Brand" (NEW), 3-step form (product → brand → delivery and stores), private logo upload (private bucket, 10-minute signed links), summary, "Free · your account manager sends a quote with the final price, delivery date, duties and shipping before you pay anything", creates a brand project in My account › Make My Brand and notifies the customer's account manager.
4. Dropship request form: the "Branding" dropdown becomes "Your packing slip" only; branding goes to the Make My Brand request.
5. /signup?service=dropship|3pl|brand|sourcing opens that section after sign-up.
```

## Prompt 44-F: accessibility and checks

```
1. Blue text on white → #1E58B0 (4.5:1 or better); #2A6FD6 stays for filled buttons with white text.
2. Main text-link buttons get a 44 px tall hit area.
3. Re-run: every page in this add-on at 1440 and 390 px, no horizontal scroll, no broken image, no "{{" or "[" left in rendered text on live, contrast checks pass.
4. Report what is still blocked by missing data.
```

## Not for Antigravity (owner actions)

- Create mailboxes for @octopusb2b.com (and @hostoctopus.com if used) and add MX, SPF and DKIM records at the domain's DNS provider (audit finding 15). Until then, show WhatsApp as the main contact.
- Send the real warehouse list, dropship plan and fees, 3PL rates and cut-off time, delivery days per service, Make My Brand MOQs and extra days per method.
- Decide whether customers may sign in with Google (ADDON-22 said no; it is live today).
