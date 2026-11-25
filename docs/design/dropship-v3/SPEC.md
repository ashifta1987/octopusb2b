# Octopus Dropship – UI/UX and flow specification (v3)

Use this file as the project memory for Antigravity. The `design/` folder has one HTML file per screen (51 screens). Live canvas: https://claude.ai/artifact/VaAA7Bj2CKNsa1UEGudHjs

## 1. Product in one paragraph
A multi-merchant dropshipping SaaS with a public Shopify app. Merchants import products, set prices, push them to their stores, and orders flow back. Octopus fulfils from its own China warehouse or from partner suppliers. Merchants never see supplier or source names (white-label). Plans: Starter $49, Growth $149, Custom $299.

## 2. Four kinds of user
| User | Where | Purpose |
|---|---|---|
| Merchant | Main app | Find, price and push products. Track orders. Pay from wallet. |
| Staff | Staff panel | Approve products, fulfil orders, labels and customs, compliance, invoicing, support. |
| Supplier | Supplier portal | Submit products, update price and stock, ship orders. |
| Sales partner | Staff-managed | Brings merchants, earns commission. No login screens designed yet. |
| Buyer | Tracking page | Sees order tracking under the Octopus brand. |

## 3. Sitemap
**Merchant app (sidebar):** Dashboard, Find products (Catalog, Product detail, Landed cost), Import list, Pushed products, Product editor, Orders (Order detail, Order states), Pricing and sync, Stores, Integrations (Connect a channel), Wallet, Reports, Plan and billing (Change plan, Billing details), Settings, Support. Also: Sign up, Onboarding, Request a product, Order a sample, Store switcher, Mobile layout, States and edge cases, Interaction states, Customer tracking page.

**Staff panel (sidebar):** Fulfilment queue, Catalog manager (New product), Approvals, Suppliers, Warehouse, Labels and customs (Shipping documents), Merchants, Sales partners, Plans and limits, System health, Support desk, Compliance, Invoicing.

**Supplier portal (sidebar):** Products, Add product, Bulk upload, Orders to ship. Sign in screen.

## 4. Design system
Font Inter. No emoji. Navy #1A174A, button blue #2A6FD1, logo blue #2F7BE0, success teal #0B7A75, page background #F4F6F9, border #E3E8EF, muted text #52607A. Badges: ok, warn, bad, info, neutral. Buttons: primary, secondary, ghost, minimum height 44px. Cards: white, 14px radius, 24px padding. Tables scroll sideways on narrow screens. Forms: label above field, 44px fields. Platform names are text, not logos. Square-bracket placeholders (for example [HS CODE]) are values still to be supplied.

## 5. Key flows

### 5.1 Merchant onboarding
Sign up, verify email, business details, connect first store (Shopify OAuth), choose plan, land on Dashboard. If the store connection fails, show the reconnect state and let the merchant skip.

### 5.2 Connect a channel
Integrations page, pick a channel, channel-specific approval (Shopify install, WooCommerce store address and access approval, TikTok Shop region and seller sign-in, Wix and eBay sign-in), test, done. Plan limits the number of connected stores. Amazon is a waiting list. Channel settings: sync stock, sync prices, send tracking, cancel on store cancel, test, reconnect, disconnect (products stay in the store).

### 5.3 Product to store
Find products, Product detail (shipping and duties table), add to Import list, edit (title, images, variants, price) in Product editor, pricing rules apply, push to store, Pushed products shows result and retry. Block publishing if a product lacks images, weight or HS code. Scheduled job syncs stock and price.

### 5.4 Order lifecycle
Store order arrives by webhook, only lines matching pushed products are kept. Wallet is charged product cost plus shipping. If funds are short the order waits as Awaiting payment, and releases in date order after top-up.
- Merchant labels: Awaiting payment, Processing, Shipped, Delivered, On hold, Cancelled, Refunded.
- Staff states, own warehouse: Paid, Pick, Pack, Label created, Handed to carrier, In transit, Delivered.
- Staff states, partner: Paid, Ordered from partner, Partner shipped, In transit, Delivered.
- Side states: On hold (for example address problem), Cancelled (until packed or until partner ships), Refunded, Returned or lost.
Every change is written to an order event log. Staff states map to merchant labels.

### 5.5 Labels, customs and documents (own warehouse)
Staff opens pick and label, enters parcel weight and size, picks carrier (YunExpress or 4PX) and service, duties paid by sender or receiver, IOSS number if used. Declared customs value per item is the price the customer paid, copied from the store order and locked. The label is blocked if declared value is below the Compliance threshold percent of the store price. A snapshot of the store order is saved with each label. Outputs: carrier label, commercial invoice (with HS code and description), branded packing slip.

### 5.6 Tracking back to the store
When a tracking number exists, send fulfilment with tracking to the store. 4PX uses its Shopify tracking company name. YunExpress is sent as Other with the branded tracking link (verify in a test store). Order becomes Shipped, buyer gets an email, buyer tracking page shows the Octopus brand.

### 5.7 Staff product entry
Catalog manager, New product: basic info (name, category, brand, model number, SKU, barcode, description), variants (own SKU, barcode, cost, stock, weight), images and video, package weight and size, customs and safety (HS code, origin, battery, liquid, magnetic, certificates), sourcing and price (internal). Checklist blocks publishing without images, weight and size, HS code.

### 5.8 Supplier submission and approval
Supplier signs in (accounts are created after staff approve an application). Adds a product with the same form plus minimum order, lead time and price validity, or uploads a spreadsheet (download template, upload, fix row errors, submit good rows). Staff reviews in Approvals: checklist, note to supplier, approve, ask for changes, or reject. Stock updates and small price changes can auto approve. New products and anything touching customs data are always reviewed. Approved products enter the catalog with the supplier as an internal source.

### 5.9 Supplier order shipping
Supplier sees orders to ship with the buyer's shipping address but never the merchant name. Chooses carrier, enters tracking, downloads the Octopus packing slip, marks shipped. This feeds the partner path in 5.4. Suppliers must not add their own invoice, logo or contact details.

### 5.10 Sales partners
Staff invites a partner, tracks merchants brought and commission earned, sets commission rules. Partner login screens and payouts are not designed yet.

### 5.11 Wallet and billing
Merchant tops up the wallet (balance, ledger with adjustments). Subscription billing and invoices are in Plan and billing. Staff Invoicing sets the legal entity, tax ID, currency, number prefixes and the wallet top-up treatment.

### 5.12 Compliance
Staff Compliance holds the customs value policy, HS code review queue, versioned duty and tax rate table per destination, carrier tracking-name mapping, and data completeness. EU: flat duty per item category on parcels up to EUR 150 from 1 July 2026 to 1 July 2028. US: low-value duty-free treatment suspended.

## 6. Rules that apply everywhere
1. Every record belongs to a merchant (or supplier) and is protected by row-level security. Staff have a separate role.
2. Merchant-facing screens and APIs never show supplier or source names. Use "Product cost" and "Processing".
3. Secrets (store tokens, carrier keys) live only on the server.
4. Money is stored in minor units with a currency code.
5. Declared customs value is the price the customer paid, never cost price.
6. Touch targets are at least 44px. Show loading, empty and error states on every list.
7. Sample data in the designs is for review only.

## 7. Data tables (starting list)
merchants, merchant_users, stores, products, product_variants, import_list, pushed_products, price_rules, orders, order_items, order_events, shipments, wallet_ledger, plans, staff_users, suppliers, supplier_users, supplier_submissions, product_documents, hs_codes, duty_rates, carrier_tracking_map, invoice_settings, partners, partner_commissions.

## 8. Build order
1. Database and auth. 2. App shell and onboarding. 3. Shopify connection. 4. Catalog, import list, editor. 5. Push to store. 6. Pricing and sync. 7. Orders in. 8. Wallet. 9. Staff panel and queue. 10. Labels and documents. 11. Tracking back to the store. 12. Compliance and invoicing. 13. Plans and billing. 14. Supplier portal and approvals. 15. Other channels, one at a time. 16. Reports, polish and launch checks.

## 9. Not designed yet
Supplier applications screen (staff), supplier payouts, sales partner login and payouts, notification and email templates, staff roles and permissions screen.

## 10. Open items before launch
Customs value rule per destination (carrier or customs broker). Shopify tracking names for 4PX and YunExpress (test). Invoicing entity and wallet tax treatment (accountant). HS codes and duty or tax rates (carrier or broker). Platform API support for each channel (confirm before building). Shopify App Store requirements (billing, privacy webhooks, review).
