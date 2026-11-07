# hostoctopus.com audit: service flows and missing pieces

Nov 8, 2026 · @ASHIF

## Summary

The live site sells sourcing well, but its other services are half-built from a visitor's side. Make My Brand is invisible: no menu item, no home section and no page, so nobody can find it. Two things need fixing this week: email to every @octopusb2b.com and @hostoctopus.com address bounces, and the home page's "verified factories" products all show "Not yet verified".

| Severity | Count | Findings |
| --- | --- | --- |
| Critical | 5 | 01 Make My Brand invisible · 04 shop connection and shipping promised but not set up · 10 3PL offers 64 warehouse countries · 13 "verified" products show "Not yet verified" · 15 company email bounces |
| Major | 10 | 02 no Dropshipping or 3PL page · 03 carrier name on home · 05 wrong "follow your request" location · 06 platform lists disagree · 07 no dropship prices or delivery times · 08 no dropship catalogue · 11 3PL steps copied from sourcing · 12 no 3PL rates or rules · 14 branding buried in the dropship form · 16 card payment promised |
| Accessibility | 2 | 20 blue link text at 4.44:1 · 21 main text-link buttons 23 px tall |
| Note | 4 | 09 "Octopus Dropship app" name · 17 sign-up ignores the chosen service · 18 Google sign-in still offered · 19 no link previews, old description |

What already works: the page is fast (48 ms server response, 1.8 s to interactive), the Dropshipping steps are clear, the wallet page explains bank transfer correctly, and only 2 of 296 text elements miss contrast.

## Scope and method

Live site www.hostoctopus.com, checked on 8 Nov 2026 in Chrome at 1512 × 861 px, as a signed-out visitor (pages fetched without cookies) and, where noted, as the owner account.

- **Pages read in full:** home, Request Center (Dropshipping, 3PL), a product page, Wallet, API and integrations, Sign up, Contact, and the 4 products in the home "Ready to order" row.
- **Route check:** 36 addresses requested; 20 answered, 16 returned "not found" (listed in the findings where they matter).
- **Measured on the home page:** colour contrast on 296 text elements, size of 81 links and buttons, page head tags, loading times.
- **Email:** mail records looked up through Google's public DNS.

Not checked: phone width, Arabic, MOQ pools and Turnkey in depth, and the signed-in customer pages on live. The browser was signed in as the owner, and staff accounts are blocked from My account ("Staff accounts cannot use My account"). The customer Wallet and Ledger were checked on staging yesterday and passed. No form was submitted.

## Home page

The home page sells five services in this order: Product sourcing, Dropshipping, MOQ pools, 3PL warehousing, Turnkey Projects. Make My Brand is not one of them, and the menu marks "Product sourcing" as the selected tab, so the site reads as a sourcing site with extras.

**01 · Critical · Make My Brand cannot be found from anywhere public.** The service exists inside the app (`/account/brand` answers "Make My Brand · Octopus B2B" after sign-in), but no visitor can reach it.

```
Menu:            Product sourcing | Dropshipping | MOQ pools | 3PL warehousing | Turnkey Projects
Home sections:   sourcing, dropshipping, pools, 3PL, shipping, turnkey, "Also on Octopus B2B", suppliers
Request Center:  Product sourcing | 3PL service | Dropshipping | Sample | QC inspection | Certification
Product page:    Request quote | Request sample | Request certification | Request 3PL | Request dropship
/make-my-brand -> 404   /brand -> 404
Text search for "make my brand", "private label", "branding" on home: 0 matches
```

FIX, so Make My Brand is highlighted on the home page:

1. **Menu:** add "Make My Brand" with a NEW badge, second after Product sourcing.
2. **Announcement bar:** rotate a Make My Brand line with the Turnkey one, for example "Make My Brand: your logo on verified products, stocked in our warehouse, shipped worldwide."
3. **Home section:** add one right after sourcing, in the same style as the others: "Your brand on proven products", with the six steps pick, brand, sample, produce, stock, ship, two example products with a "Studio preview" label, and a "Start a brand project" button.
4. **Its own page** at `/make-my-brand`, using the ADDON-39 inner-page design.
5. **Request Center:** add a Make My Brand tab.
6. **Product pages:** add a "Put your brand on this" button on verified products only.
7. **"Also on Octopus B2B":** add a Make My Brand card.

**02 · Major · The menu's Dropshipping and 3PL links only jump down the home page.** They point to `/#dropshipping` and `/#warehousing`. `/dropshipping` and `/3pl` both return 404, so there is no page to share, advertise or rank in search. The inner pages designed in ADDON-39 (kit 8) are not live.

**03 · Major · The home page names the carrier.** The shipping section is labelled `GLOBAL SHIPPING · YUNEXPRESS NETWORK`. This breaks the white-label rule (customers see Octopus service names only), and the admin's Integrations panel shows that carrier as `NOT CONFIGURED`.

FIX: change the label to "Global shipping" and use the Express / Standard / Economy service names.

## Dropshipping journey

A visitor reads a clear 4-step story on the home page, then hits a request form with no prices. They are told to track the request in the wrong place. They cannot browse a dropship catalogue before signing up.

1. **Home section** (`/#dropshipping`): "You sell. We ship to your customer." and a 4-step "How dropshipping works". Clear. Two buttons with different wording go to the same form: "Start dropshipping →" and "Open a dropship account →", both `/request/dropship`.
2. **Request form** (`/request/dropship`): target markets, store platform, orders per month, branding. Fee: "Free".
3. **After submitting:** the form says "follow the request in My account › Product sourcing".

**04 · Critical · The shop connection and shipping are promised, but the admin shows them as not set up.** The site promises automatic order flow. The owner's admin panel reports both connections as not configured.

```
Home:        "Shopify, WooCommerce or our API send orders here automatically."
API page:    "Shopify and WooCommerce orders can be sent here automatically"
Admin › Integrations health:   Octopus Dropship  NOT CONFIGURED
                               YunExpress        NOT CONFIGURED
```

FIX: until both connections pass a real test order, say "Store connection: coming soon, upload orders as a sheet meanwhile", or switch the connections on first. A seller who connects a store and gets no orders through will leave.

**05 · Major · Requests are tracked in the wrong place.** The Dropshipping and 3PL forms both say `follow the request in My account › Product sourcing`. The app has `My account › Dropshipping` and `› 3PL warehouse`.

FIX: point each form to its own section.

**06 · Major · Three different lists of supported store platforms.**

```
Home how-it-works:    Shopify, WooCommerce or our API (or upload a sheet)
Request form step 3:  Shopify, WooCommerce or Wix
Request form select:  Shopify | WooCommerce | Wix | Amazon | Other
```

FIX: one list everywhere, and only platforms that actually connect. Shopify and WooCommerce first, as decided.

**07 · Major · No prices, fees or delivery times before sign-up.** The steps say product, shipping and fulfilment come out of the wallet, but nothing says how much or how fast. The app's design has a "Growth" plan, and none of that appears publicly. Sellers compare these numbers first.

FIX: on the Dropshipping page, show the plan(s), the fulfilment fee per order, and delivery days for Express, Standard and Economy to the top target countries. Write \[to be confirmed\] where a number isn't decided yet, never a made-up figure.

**08 · Major · No catalogue to browse before committing.** Step 2 of the form's own guide says "Pick from the dropship catalogue of verified factories", but no public page lists dropship-ready products. The only browse link is the general "All products".

FIX: add a "Dropship-ready" filter on `/products`, showing cost to ship to a chosen country, and link to it from the Dropshipping page.

**09 · Note · Product pages call it a separate app.** "Sell this product through our Octopus Dropship app". Since the decision on 7 Nov, Dropshipping is a section of the same app. Use "Dropshipping".

## 3PL logistics journey

The 3PL offer is one paragraph on the home page and a form. It never says where the warehouses are, and the form implies Octopus has one in 64 countries.

1. **Home section** (`/#warehousing`): "Your stock, stored near your buyers", 4 promises (receive and inspect, store by SKU, pick and pack same or next working day, returns), one button "Get a 3PL quote →". Unlike Dropshipping, there is no "How it works".
2. **Request form** (`/request/3pl`): what will we store, warehouse country, orders per month, storage type, sales channels. Fee: "Free".
3. **"What happens next"** on the form.

**10 · Critical · The form offers 64 warehouse countries.** "Warehouse country" lists Afghanistan to Zimbabwe, including Somalia, Yemen and Sudan. Nothing on the site says where Octopus actually stores goods. A buyer who picks "Saudi Arabia" will expect a warehouse there.

```
Warehouse country *   64 options: Afghanistan, Algeria, Angola, Australia, Bahrain, Bangladesh, Brazil … Yemen, Zambia, Zimbabwe
Home copy:            "Your stock, stored near your buyers"
```

FIX: list only the warehouses Octopus runs or partners with, each with city and what it handles (for example China, Shenzhen; \[UAE, Dubai – to be confirmed\]). Add a "Not listed? Ask us" option, and name the warehouses on the 3PL page.

**11 · Major · The 3PL steps are copied from sourcing.** Step 3 of "What happens next" reads `Quoted: Matched suppliers send USD quotes you can compare`. Suppliers do not quote for warehousing; Octopus does.

FIX: use 3PL steps: Submitted, Rates sent, Accepted, Send your first inbound notice, Goods received and counted, Live: orders ship from stock.

**12 · Major · No rates, service levels or inbound rules.** No storage price, pick-and-pack fee, minimum volume, cut-off time, accepted goods or inbound instructions appear before the form. The "same or next working day" promise has no cut-off time attached.

FIX: a 3PL page with a rate table (\[rate\] where not decided), the cut-off time, accepted and refused goods, an inbound checklist (labels, cartons, ASN), and how stock appears in My account › 3PL warehouse.

Finding 05 (wrong "follow your request" location) applies here too.

## Make My Brand journey

There is no public journey to audit: a visitor cannot start Make My Brand from anywhere (finding 01). Branding is only a dropdown inside the Dropshipping form, and the products that would feed Make My Brand are not shown as verified.

**13 · Critical · Every product in the home page's "Ready to order from verified factories" row shows "Not yet verified".** You decided that products Octopus lists directly count as verified, and Make My Brand allows only verified products. Today a visitor reads the opposite on the product page.

```
Home heading:  "Ready to order from verified factories"
Product page:  "Supplier OCT-1140 · China · Manufacturer · Not yet verified"
4 of 4 products in that row: "Not yet verified"
```

FIX: mark every Octopus-listed supplier as verified in the catalogue data (this is a data fix, not a design fix), and show a "Verified by Octopus" badge. Keep "Not yet verified" only for products listed by suppliers themselves.

**14 · Major · Branding is buried in the Dropshipping form.** `/request/dropship` asks "Branding: Standard packaging | White label | Custom packaging and inserts". That is the start of Make My Brand, but it ends in a dropship request, with no artwork, sample, stock or bulk-shipping steps.

FIX: a separate Make My Brand request: product (from the verified catalogue), branding method, quantity, packaging, logo upload (kept private), target markets and stores. It leads into `/account/brand`. The Dropshipping form keeps only "Your packing slip".

**What the public Make My Brand flow needs (designed in kit 9, not live):**

1. A page explaining the route: pick, brand, sample, produce, stock in our warehouse, ship worldwide, with one account manager.
2. A verified-only catalogue with branding options per product.
3. A studio preview labelled "Illustrative preview. Not approved artwork."
4. A quote confirmed before any payment, paid by bank transfer to the wallet.
5. A sign-up that starts as a brand project.

## Sourcing, sign-up, account and cross-site

**15 · Critical · Email to every company address bounces.** Neither domain has a mail (MX) record, so mail to the addresses on the footer and Contact page cannot be delivered. Your own admin shows the same warning ("No MX record: mail to this domain bounces").

```
Google public DNS, 8 Nov 2026:
  octopusb2b.com   MX -> no answer
  hostoctopus.com  MX -> no answer
Published on the site: support@octopusb2b.com, foshan@octopusb2b.com, ningbo@octopusb2b.com, yiwu@octopusb2b.com
```

FIX: create the mailboxes (Google Workspace, Zoho or your Dubai server) and add the MX, SPF and DKIM records at your domain's DNS provider. Until then, make WhatsApp (+86 188 2652 7644) the main contact on the footer and Contact page.

**16 · Major · Product pages promise card payment.** Product pages say `Prices in USD, payable from your wallet or by card.` The Wallet page and your decision say bank transfer only ("Top up by bank transfer … Your wallet is credited once the transfer is matched").

FIX: change it to "payable from your wallet (top up by bank transfer)".

**17 · Note · Sign-up doesn't ask what the visitor came for.** `/signup` asks only for email and password, then everyone lands in the same account. Someone who clicked "Start dropshipping" has to find their way back.

FIX: carry the service from the button (`/signup?service=dropship`) and open that section after sign-up. Ask one optional question: "What do you want to do first?"

**18 · Note · Google sign-in is still offered to customers.** `/signup` shows "Continue with Google". ADDON-22 asked to remove Google sign-in for customers. Please confirm which you want now.

**19 · Note · Shared links show no preview, and the search description is out of date.** The home page has 0 Open Graph tags, so links pasted in WhatsApp or LinkedIn show no image or title. The search description still describes only RFQs: `Compare tiered USD pricing, send one RFQ to several suppliers, and track every order from quote to delivery.`

FIX: add title, description and image Open Graph tags on every page. Rewrite the description to name sourcing, dropshipping, 3PL and Make My Brand.

## Accessibility, speed and technical

The home page is fast and close to the accessibility bar. Two small fixes take it over.

**20 · Accessibility (WCAG 2.2 SC 1.4.3) · The blue link text is just below the contrast minimum.** Blue `rgb(42, 110, 212)` on white measures 4.44:1; normal-size text needs 4.5:1.

```
"YOUR ACCOUNT TEAM"      11px  4.44:1  (needs 4.5)
"Open the assistant →"   16px  4.44:1  (needs 4.5)
```

FIX: darken the text blue one step, to the #1E58B0 already used for hover, which passes. Keep #2A6FD6 for filled buttons, where the text is white.

**21 · Accessibility (SC 2.5.8, and below the 44 px usual for touch) · Main buttons styled as text links are 23 px tall.** 34 of 81 controls on the home page are under 24 px high.

```
"Open a dropship account →"   202 x 23
"Start a sourcing request →"  194 x 23
"See all 25 businesses →"     176 x 23
```

They may pass on the spacing exception, but these are the main next steps for each service. FIX: give them a 44 px tall hit area (padding), or make the main one in each section a real button.

**Measured, no action needed:**

| Check | Result |
| --- | --- |
| Server response (home) | 48 ms |
| Ready to use (DOMContentLoaded) | 1.8 s |
| Requests on load | 51 |
| Horizontal overflow at 1512 px | none |
| Images without alt text | 0 of 15 |
| H1 headings | 1 |
| Page language set | `en` |
| Canonical link | set |
| Structured data blocks | 1 |

## What works

Keep these as they are; the fixes above build on them.

- **Speed:** 48 ms server response and 1.8 s to interactive on the home page.
- **Contrast:** only 2 of 296 text elements miss the minimum, both by 0.06.
- **The sourcing hero:** it states the promise, the 3 steps, the RFQ fee (US$ 5.00) and a quote form in the first screen.
- **Dropshipping steps:** "How dropshipping works" gives 4 concrete steps and says the full cost is shown before each order is confirmed.
- **Wallet page:** it already says top-ups are by bank transfer and are credited once matched, matching your decision.
- **Admin warnings:** the admin catches real problems itself (the bounced-email warning, integrations not configured). They are just not acted on yet.
- **Signed-in customer area (staging):** Wallet, Ledger and Invoices match each other to the cent after yesterday's two rounds of fixes.
- **Images and headings:** every image has alt text, and each page has one H1.

## Where to start

Ranked by impact against effort. The first four are hours of work, not days.

| # | Fix | Findings | Effort | Who |
| --- | --- | --- | --- | --- |
| 1 | Create mailboxes and add MX, SPF and DKIM records; WhatsApp as main contact until then | 15 | 1 hour | You, at the DNS provider |
| 2 | Mark Octopus-listed suppliers as verified | 13 | 1 hour | Data |
| 3 | Copy fixes: "follow your request" location, card payment, carrier name, 3PL steps, one platform list, app name | 03, 05, 06, 09, 11, 16 | 2 hours | Antigravity |
| 4 | 3PL warehouse list: real locations only | 10 | 1 hour + your list | You + Antigravity |
| 5 | Shop connection and shipping: switch on and test, or say "coming soon" | 04 | 1 hour (wording) | Antigravity |
| 6 | Make My Brand on the home page, menu, Request Center, product pages, own page | 01, 14 | 2–3 days | Antigravity (kit 8 + kit 9 designs) |
| 7 | Dropshipping and 3PL pages of their own, with prices and delivery times | 02, 07, 08, 12 | 2–3 days | You (numbers) + Antigravity |
| 8 | Contrast, tap sizes, link previews, description, sign-up by service | 17–21 | 1 day | Antigravity |

**Still needed from you:** the real warehouse locations, dropship plan and fees, 3PL rates and cut-off time, delivery days per service, and a yes or no on Google sign-in.

**Paste into Antigravity (staging first, live only after my check):**

```
Read docs/hostoctopus-audit-2026-11-08.md (exported from the Claude doc "hostoctopus.com audit"). Work on staging only, then stop for my check.

Step 1, copy and data (findings 03, 05, 06, 09, 11, 13, 16):
- Home shipping label: "Global shipping" (no carrier name); use Express / Standard / Economy.
- Dropship and 3PL request pages: "follow the request in My account > Dropshipping" / "> 3PL warehouse".
- One store-platform list everywhere: Shopify, WooCommerce, or upload a sheet. Remove Wix, Amazon, Other until they connect.
- Product pages: "Octopus Dropship app" -> "Dropshipping"; "payable from your wallet or by card" -> "payable from your wallet (top up by bank transfer)".
- 3PL "What happens next": Submitted, Rates sent, Accepted, Send your first inbound notice, Goods received and counted, Live.
- Catalogue: every product Octopus lists directly is from a verified supplier; show "Verified by Octopus". Report how many products changed.

Step 2, honest capability (findings 04, 10):
- Until the store connection and carrier pass a real test order, show "Store connection: coming soon, upload orders as a sheet meanwhile" wherever automatic order flow is promised.
- 3PL "Warehouse country": only the locations in config warehouses (I will give the list), plus "Not listed? Ask us".

Step 3, Make My Brand visible (findings 01, 14), using design kits 8 and 9:
- Menu item "Make My Brand" (NEW badge) second after Product sourcing; home section after sourcing; announcement bar rotation; /make-my-brand page; Request Center tab; "Put your brand on this" on verified product pages; "Also on Octopus B2B" card.
- Dropship form keeps only "Your packing slip"; branding moves to the Make My Brand request.

Step 4, pages of their own (findings 02, 07, 08, 12): /dropshipping and /3pl from kit 8; menu links go there instead of /#anchors. Prices, fees and delivery days come from settings; show [to be confirmed] where a value is empty, never invented numbers.

Step 5 (findings 17-21): link blue on white -> #1E58B0; 44px hit area on main text-link buttons; Open Graph tags on every page; new site description; /signup?service= opens that section after sign-up.

After each step: list changed files, desktop and phone screenshots, and anything blocked.
```
