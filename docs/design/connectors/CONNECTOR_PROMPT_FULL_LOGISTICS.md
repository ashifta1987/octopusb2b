# Full Antigravity prompt: connectors, store-link portal, marketplaces and carriers

Paste everything inside the box into Antigravity as one prompt. It tells Antigravity to work in phases and stop after each phase, so you can test before it continues. Put your API docs in a folder named `docs/` in the project first (one file per platform or carrier), so it reads the real documentation. Never paste secrets into the prompt.

```
You are working on my EXISTING app "Octopus Dropship" (React + TypeScript, Supabase, Vercel). First read the whole codebase and tell me in simple words what already exists (tables, screens, auth, orders, wallet, staff panel). Extend it. Do not rewrite or delete working parts. I am new to coding, so explain each step in simple words, and tell me exactly how to test it.

GOAL
Octopus Dropship connects directly to merchants' sales channels (no App Store listing) and to my logistics partners. Merchants only share their store link or sign in as a seller. Octopus imports orders, fulfils them, and sends tracking back.

HARD RULES
1. Multi-tenant: every merchant row has merchant_id and row level security. Staff have a separate role and can see all merchants.
2. White-label: merchants and buyers never see supplier, source or carrier account names, keys or prices. Use "Product cost" and "Processing".
3. Secrets (client secrets, tokens, carrier keys) live only in Supabase Edge Functions and environment variables. Encrypt stored tokens. Never log them. Never send them to the browser.
4. Money in minor units with a currency code.
5. Declared customs value is always the price the customer paid, copied from the store order and locked. Never the merchant's cost price.
6. Do not invent API calls, fields, endpoints or signing rules. Read the official documentation in docs/. If something is missing, stop and ask me.
7. Verify every webhook signature. Handle rate limits with backoff.
8. Work in the phases below. After each phase: summarise what you built, list files changed, tell me how to test, and WAIT for my "continue".
9. Match the designs in the design/ folder for screens (ConnectPortal, Integrations, ConnectChannel, AdminLabel, AdminDocs, AdminCompliance, AdminQueue, TrackPage). Font Inter, no emoji, navy #1A174A, button blue #2A6FD1, 44px touch targets.

PHASE 1 - CONNECTOR FOUNDATION (no platform yet)
- Tables: store_connections (merchant_id, platform, store_url, store_name, status pending/connected/error/disconnected, credentials_encrypted, scopes, last_sync_at, last_error), connection_events (audit log), connector_requests (platform requested by merchants, with counts).
- TypeScript interface Connector: detect(url), startConnect, finishConnect, testConnection, pushProduct, pullOrders(since), sendTracking, syncStock, syncPrice, disconnect.
- A registry mapping platform name to connector.
- Our own internal formats: Product, Variant, Order, OrderLine, Shipment, TrackingEvent. Connectors translate to and from these. The rest of the app uses only internal formats.
- A scheduled function that pulls orders for each connected store every few minutes with backoff, and sets connection status and last_error.
- Orders only become dropship orders if their lines match pushed products. Keep the existing order states and write every change to the order event log.

PHASE 2 - STORE LINK PORTAL
- Screen "Connect your store": the merchant pastes a store link. Edge Function detect-platform(url) normalises the URL, uses a short timeout, blocks private and internal IP ranges, and checks for Shopify (.myshopify.com, headers, /products.json), WooCommerce (/wp-json/wc/), Wix, BigCommerce, Magento, PrestaShop and others. Return the platform or "unknown".
- Show: found (next-step button), not recognised (platform dropdown, "Request this platform", file import option), connected, could not connect.
- A "Marketplace seller account" card for platforms with no store link: choose marketplace and country, then sign in as a seller.
- A link alone gives no access. The merchant always approves access on their own store. Create a pending connection when they continue.

PHASE 3 - SHOPIFY (custom distribution, no App Store)
- OAuth with GraphQL Admin API only. Edge Functions /connect/shopify/start (signed state, scopes for products, orders, fulfilments, inventory) and /connect/shopify/callback (verify HMAC and state, exchange code, save token encrypted).
- Webhooks: orders/create, orders/updated, orders/cancelled, app/uninstalled and the mandatory privacy webhooks, signatures verified.
- pushProduct (productSet), pullOrders, sendTracking (fulfillmentCreate on FulfillmentOrders), syncStock, syncPrice.
- Client ID and secret only from environment variables. I will create the app in the Shopify Dev Dashboard and generate an install link per merchant store.

PHASE 4 - WOOCOMMERCE
- Start the connection with WooCommerce's authentication endpoint so the merchant approves read and write access on their own store; our callback receives the keys over HTTPS and stores them encrypted. Use the REST API for products, orders, and order notes or shipment tracking. Register order webhooks with signature checks.

PHASE 5 - MORE STORE PLATFORMS (one at a time, ask me before each)
Wix (OAuth app, eCommerce APIs), BigCommerce (single-click app OAuth, V3 API), Magento, PrestaShop and OpenCart (merchant pastes API key and store address, we test and encrypt it). Add a file-based fallback connector for platforms with no API (CSV orders in, product feed and tracking file out).

PHASE 6 - MARKETPLACES (one at a time, ask me before each, sandbox first)
- eBay: OAuth, Sell Inventory API for listings, Fulfillment API for orders and tracking, notifications with scheduled polling as backup, business policies and category rules per country.
- Amazon: Selling Partner API with seller authorization, Listings Items API, Orders API, notifications, shipment confirmation. Restricted buyer data needs Restricted Data Tokens and approved roles; store as little personal data as possible.
- TikTok Shop: Partner API seller authorization, region setting, product upload, orders, fulfilment with tracking.
- Walmart (seller credentials, feeds, order acknowledge, shipment) and Etsy (OAuth with PKCE; respect its dropshipping and production partner rules).
Show "pending approval" states where the platform must approve the seller or my developer app.

PHASE 7 - CARRIER LAYER
- Tables (staff only): carrier_accounts (carrier, environment test/live, credentials_encrypted, enabled), carrier_services (service code, countries, weight limit), shipments (order_id, carrier, service, tracking_number, label_url, status, cost, declared_value_snapshot), shipment_events, tracking_company_map (carrier, shopify company name, tracking URL template).
- Interface Carrier: validateCredentials, listServices, getRates, createShipment(order, parcel, customs), getLabel, cancelShipment, getTracking, parseWebhook. Registry by carrier name.
- Customs validation before any shipment: declared value = customer price paid, locked; block if below the Compliance threshold percent of the store price; require English description, HS code, quantity, unit value, origin country and weight per item; require battery, liquid and magnetic flags; save a snapshot of the store order with the shipment.
- A scheduled tracking job that polls active shipments, stores events, and moves the order through Handed to carrier, In transit, Delivered, Exception.

PHASE 8 - YUNEXPRESS AND 4PX
- Implement each as a Carrier using the official docs in docs/. Test environment first. Save label PDFs to Supabase Storage. Map carrier statuses to ours. Support duties paid by sender or receiver and the IOSS number.
- Connect the AdminLabel screen: staff enters parcel weight and size, chooses carrier and service, runs customs validation, creates the shipment, downloads the label, and generates the commercial invoice and the branded packing slip. Mark Label created. When staff marks Handed to carrier, send tracking to the merchant's store using tracking_company_map (4PX uses its Shopify name; YunExpress uses "Other" with our branded tracking link until verified in a test store).
- Never create a second shipment for the same order without a warning. Show clear errors and a Retry button.

PHASE 9 - STAFF AND BUYER SCREENS
- Staff: Connector health (per platform: merchants connected, failures in 24 hours, last error, connections in error with Retry and Contact merchant), Carrier accounts and services, carrier errors in System health, and a requested-platforms list.
- Buyer: public tracking page showing the Octopus-branded timeline from shipment_events, with a friendly message when there are no events.

PHASE 10 - TESTS AND LAUNCH CHECKS
- For each platform and carrier: a test with a development store or sandbox covering connect, push a product, receive an order, send tracking, sync stock, disconnect.
- Review row level security with two merchant accounts to confirm one cannot see the other's data.
- Confirm no token or key appears in logs, responses or the browser.
- Give me a checklist of everything I must create myself (developer accounts, apps, redirect URLs, test stores, carrier test credentials, approvals) with where to put each secret.

Start now with: read the codebase, summarise it, list anything in this plan that conflicts with what already exists, and propose the Phase 1 changes. Then wait for my "continue".
```

## Before you paste it
1. Put the official API docs for each platform and carrier in a `docs/` folder in your project.
2. Copy the design files into a `design/` folder (from the zip).
3. Create the developer apps yourself: Shopify Dev Dashboard, Wix, TikTok Shop partner app, eBay, Amazon developer registration, and test or sandbox accounts for YunExpress and 4PX.
4. Put secrets only in Vercel and Supabase settings.
5. Apply early for Amazon, TikTok Shop and Walmart approval.

## While it runs
- Say "continue" only after you test the phase.
- Commit to GitHub after each phase that works.
- If it asks a question about an API field, check the official docs or ask the platform or carrier.
