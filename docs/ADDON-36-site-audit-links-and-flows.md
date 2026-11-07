# Add-on: hostoctopus.com audit — links, contact routes and process flows (7 Nov 2026)

## How the audit was done

- Crawled every public page reachable from the home page while signed out: **304 URLs**, including all 25 Turnkey pages and request forms, 93 product pages, 43 category pages, pool filters, request forms, login and legal pages.
- Checked each URL's HTTP status and redirects, every in-page anchor (#…), empty or "#" links, and all 130 images.
- Opened the main journeys in a real browser (home → quote, product → quote/sample/dropship/pool, Turnkey → request, account pages) to see what the visitor actually gets after the page loads.
- Checked the email domain used on the site (DNS MX records).
- Not covered: signed-in areas (customer account, supplier/distributor portal, back office), actually submitting forms (nothing was submitted), and Google sign-in.

## What is fine

- No page returns an error: all 304 URLs answer 200. No broken images, no missing anchors, no empty "#" links.
- Pages that need an account send the visitor to /login and keep the return address (`/login?next=…`).
- The home page now runs in the agreed order (sourcing → dropshipping → MOQ pools → 3PL → Turnkey), and all 25 Turnkey pages and their request and interest forms load.

So the problem is not 404 pages. It is **links that lead nowhere useful**: dead email addresses, empty categories, wrong destinations, and forms that drop what the visitor typed.

## Findings

### Critical (visitors and leads are lost)

| # | Finding | Where | Evidence |
|---|---|---|---|
| C1 | **Every email address on the site bounces.** The domain octopusb2b.com has no mail (MX) records, so support@, foshan@, ningbo@ and yiwu@octopusb2b.com cannot receive email. | Footer of all 304 pages, Contact page, product pages | DNS lookup: octopusb2b.com returns no MX record (DNS is at GoDaddy, ns25.domaincontrol.com) |
| C2 | **The home quote form throws away what the visitor typed.** It sends `title`, `qty` and `country`; the sourcing form fills none of them, so the visitor lands on an empty form. | Home hero "Get quotes in 24 h" → /request/sourcing | `/request/sourcing?title=Handheld+fan&qty=5000&country=AE` loads with title, quantity and country empty |
| C3 | **Product "Request quote" loses the quantity.** The product is attached, but `qty=3000` from the product page is not filled into Quantity. | All 93 product pages | `/request/sourcing?product=…&qty=3000` → Quantity empty |
| C4 | **40 of 43 category pages are empty**, and 9 of the 12 categories in the top menu have no products: Fasteners, Power tools, Safety & PPE, Packaging, Hydraulics & pneumatics, Material handling, Industrial chemicals, Kitchen utensils, Plastics. All their sub-categories are empty too, and even Electrical's sub-categories (Cables & wires, Cable ties, Lighting) are empty although Electrical has 45 products. | Top menu on every page, /products sidebar | Only Electrical (45), Home & Garden (30) and Electronics (18) list products |
| C5 | **Supplier links go to the wrong place.** "Supplier login" opens the customer login (/login), but the supplier/distributor portal signs in at /staff/login. "Sell on Octopus B2B" and "Become a supplier" open /contact, which has no form, only the email addresses from C1. | Footer of every page, home "Verified suppliers" | Distributor routes redirect to /staff/login |

### High (process flows that confuse or block)

| # | Finding | Where |
|---|---|---|
| H1 | **Fee contradiction.** The home quote card says "Free", but a sourcing request costs **US$ 5.00** from the wallet. The dropship request says "Free" and, in the same box, "Charged from your wallet when you submit". (The "Free" pill came from my home design; it is corrected in the design files.) | Home hero, /request/dropship |
| H2 | **Dropshipping is set up as a quote request.** "Start dropshipping" and "Open a dropship account" open the generic request form whose next steps say "matched suppliers send USD quotes". Dropshipping needs onboarding instead: account, store connection, dropship price list, wallet top-up, and later DSers. | Home dropshipping section, product pages |
| H3 | **MOQ pools has nothing to join.** /pools shows zero open pools under six filter combinations. The home page correctly hides "Open pools", but the rail and the services card still send visitors to an empty list. | /pools |
| H4 | **Login walls without explanation.** The home cards Wallet and escrow, Octo assistant and API and integrations go straight to the login page. | Home "Also on Octopus B2B" |
| H5 | **Request forms do not say they need an account until the visitor scrolls.** Make sure what the visitor typed survives sign-in. Untested, because nothing was submitted. | All six request types |
| H6 | **The announcement bar still promotes Turnkey Projects**, not the new first priority (product sourcing). | Top of every page |
| H7 | **Login, sign-up and forgot-password pages share one heading**, "Create a free account to start sourcing.", so the login and reset pages look like sign-up. | /login, /signup, /forgot |

### Medium (quality, SEO, mobile)

| # | Finding | Where |
|---|---|---|
| M1 | The six request types (sourcing, dropship, 3PL, sample, QC, certification) share one heading, "Tell us what you need. We'll find who can deliver it." | /request/* |
| M2 | Product web addresses contain internal notes ("p13-humidifier-**new-for-october**-…", also P11, P12, P15) and some are cut mid-word ("…white-or-black-o"). | 4 + ~15 product URLs |
| M3 | Many duplicate page titles for filter variants (pools filters, Atlas categories, request?product=…). These need canonical tags or noindex. | /pools?…, /turnkey/atlas?…, /request/*?product |
| M4 | Small tap targets on phones (links under 32 px high): search 16, category 15, products 14, home 7, about 6. | Mobile |
| M5 | "Staff login" is linked in the public footer of every page, next to "Supplier login". Visitors cannot tell which to use. | Footer |
| M6 | "Talk to a sourcing lead" on Turnkey pages opens the same request form (`&talk=1`) instead of WhatsApp or a call booking. | 25 Turnkey pages |

## Owner actions (not code)

1. **Email (C1), today.** Either create mailboxes for octopusb2b.com (Google Workspace, Zoho Mail or Tencent Exmail) and add their MX records at GoDaddy, or change the addresses in Settings → Company & branches to a working inbox (for example ceooctopusb2b@gmail.com) until the mailboxes exist. Then send a test email to each address.
2. **Pools (H3).** Start 2–3 real pools on products buyers ask for (for example the Bowijie fans, with a real MOQ and close date), so the pools page is not empty.
3. **Categories (C4).** Decide which industrial categories you will fill soon. The others get hidden until they have products (prompt 36-A).

## Antigravity prompt 36-A: dead ends (contact, categories, supplier entry)

```
Read docs/ADDON-36. Fix the dead ends found in the live audit.

1. Contact addresses (C1): all emails, phone numbers and WhatsApp links come from site_settings / Company & branches, never hard-coded. Add an admin check "Email deliverability" that looks up the MX record of every configured address's domain and shows a red warning in the back office when there is none.
2. Categories (C4):
   - The top rail, the /products sidebar, the footer and the sitemap list only categories with at least one live product (counting sub-categories). Order by live product count.
   - A category with no live products returns the page with an empty state: "We don't list <category> yet. Tell us what you need and we'll source it." with a "Request this product" button (→ /request/sourcing?category=<slug>). It is excluded from the sitemap and gets <meta name="robots" content="noindex">.
   - Electrical's sub-categories must show their products: assign the 45 Electrical products to sub-categories (cables to Cables & wires, chargers to a new "Chargers & power" sub-category) in a reviewed migration. List the proposed mapping first and wait for approval.
3. Supplier entry (C5):
   - New page /suppliers ("Sell on Octopus B2B"): what Octopus offers suppliers, requirements (business licence, factory photos, product list), the process (apply → KYC → first products → live) and an application form (company name, unified social credit code, city, categories, contact, website/1688 store, product sheet upload). Submissions create a supplier_applications row and appear in the back office KYC queue.
   - "Sell on Octopus B2B" and "Become a supplier" link to /suppliers. "Supplier login" links to the supplier/distributor sign-in (/staff/login, renamed in the UI to "Supplier and staff sign-in"). Remove "Staff login" from the public footer (M5).
4. Pools empty state (H3): when no pool is open, /pools shows "No pools are open right now", explains how pools work in 3 steps, offers "Start a pool on a product" (→ /products?pool=1, which shows a "Start pool" button on each card) and "Get notified when a pool opens" (email capture). The filter chips are hidden while there are no pools.
5. Home cards (H4): Wallet and escrow, Octo assistant and API and integrations link to public explainer pages (/wallet, /assistant, /developers), each with a "Sign in to use it" button, instead of jumping to /login.
6. Tests: a crawler test (see 36-D) proves no rail or footer link points to an empty category, and every "Sell on Octopus" link lands on /suppliers.
```

## Antigravity prompt 36-B: request flows keep the visitor's input and show the real fee

```
1. Prefill (C2, C3): every /request/<type> page reads these query parameters and fills the form: product (attach the product, as now), qty → quantity, title → title, country → destination_country (ISO-2), city → destination_city, category → category. Unknown parameters are ignored. Add the same for /request/sample (qty), /request/dropship (product list), /request/3pl (product). The home hero form keeps its field names (title, qty, country).
2. Keep input through sign-in (H5): when a signed-out visitor fills a request form and clicks "Sign in to submit", save the form to sessionStorage under the request type and restore it after login/sign-up (the ?next= return already works). Show the sign-in notice at the top of the form as well as at the button.
3. Fees (H1): the fee box on each request type and the home quote card read the fee from the fee settings. If the fee is 0, show "Free" and hide "Charged from your wallet". If the fee is above 0, show "RFQ fee US$ X, charged from your wallet when you submit". Never show both texts.
4. Headings (M1): each request type has its own H1 and one-line intro, e.g. Sourcing: "Tell us the product. We'll find the factory." · Dropshipping: "Start dropshipping with Octopus B2B" · 3PL: "Store your stock near your buyers" · Sample: "Order a sample before you buy in bulk" · QC: "Book a quality inspection" · Certification: "Get your product certified for your market". The shared "Request Center" tabs stay.
5. Dropshipping (H2): replace the RFQ-style steps on /request/dropship with a dropship onboarding: (1) create account, (2) choose products from the dropship catalogue, (3) connect your store (Shopify/WooCommerce/Wix, or DSers once ADDON-35 is live), (4) top up the wallet, (5) orders ship automatically. The form becomes "Dropship setup" and creates a dropship_onboarding record, not an RFQ. Free.
6. Auth pages (H7): /login H1 "Log in to Octopus B2B", /signup "Create a free account", /forgot "Reset your password", /staff/forgot "Reset your staff password".
7. "Talk to a sourcing lead" (M6) opens WhatsApp with a prefilled message naming the project and tier, with the form as a fallback link.
8. Tests (Playwright): home hero → sourcing form shows the typed title, quantity and country; product Request quote → quantity equals the MOQ; a signed-out user fills the form, signs in and finds the values restored; fee text never shows "Free" together with a charge.
```

## Antigravity prompt 36-C: announcement, URLs and SEO

```
1. Announcement bar (H6): use the CMS text from ADDON-34 34-B ("Source any product from verified China factories…"); the Turnkey text becomes a secondary rotating message if the CMS has more than one.
2. Product slugs (M2): slugs are built from the public product title only (never from internal notes or import labels), lowercase, max 80 characters, cut at a word boundary, followed by the short SKU (e.g. /p/humidifier-p13-1-3l-integrated-handle-cn-gd-bwj-p13). Keep the old slugs in product_slug_history and 301-redirect them. Re-generate slugs for products whose slug contains "new-for", "october" or ends mid-word; list them first.
3. Duplicate titles (M3): filter and query variants (/pools?…, /turnkey/atlas?category=…, /search?…, /request/*?product=…) get <link rel="canonical"> to the clean URL; /request/* and /login?next=… get noindex. Atlas category views get their own title ("Self-service businesses · Project Atlas").
4. Mobile tap targets (M4): every link and button is at least 44 × 44 px on phones (pad the hit area; keep the visual size), per ADDON-34 34-A.
```

## Antigravity prompt 36-D: automatic link and flow checks in CI

```
Add `pnpm audit:links` (Playwright + node) that runs on every deploy preview and nightly on production:
- Crawl from / while signed out (same-origin links, max 2 variants per query-string pattern, max 600 URLs). Fail on any 4xx/5xx, any redirect loop, any image that fails to load, any #anchor that does not exist, any link with href "#" or "javascript:".
- Fail if a rail/footer/sitemap link points to a category with zero live products, or if any page shows an email address whose domain has no MX record.
- Journey checks: home hero quote → prefilled sourcing form; product → Request quote (qty = MOQ), Request sample, Start pool (→ login with next); Turnkey project → Request package form; /pools empty state or pool cards; /suppliers form visible; Supplier login → supplier sign-in.
- Signed-in journeys with test accounts (test DB only): customer wallet, request submit and listing, supplier portal products, back-office moderation.
- Output a CSV report (url, status, final url, title, h1, issue) as a build artifact, and post the failures to the back office "Site health" page.
```

## Recheck plan

After the fixes are deployed, I can re-run the same crawl and journeys and compare against this list: 304 URLs, 5 critical, 7 high, 6 medium.
