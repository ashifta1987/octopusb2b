# Antigravity prompts: marketplaces and more platforms

Do these only after the shared connector layer (Prompt 1 in CONNECTOR_PROMPTS.md) and the Shopify and WooCommerce connectors work. One platform at a time. Paste the official docs into each prompt. Never paste secrets. Details below are from general knowledge and must be checked against each platform's current developer docs.

## Important difference
Amazon, eBay, TikTok Shop, Walmart and Etsy are marketplaces. A merchant does not have a store link. They have a seller account. So the portal asks for the marketplace and country, then the merchant signs in as a seller and approves access. Most of these need your own developer or partner account approved by the platform first. Apply early, because waiting for approval is often longer than building.

## eBay
```
Add the eBay connector using the Connector interface.
Connection: eBay OAuth (authorization code grant). Store the user's access and refresh tokens encrypted and refresh them automatically. Support the production and sandbox environments through an environment setting.
Use the Sell APIs: the Inventory API to create inventory items, offers and publish listings; the Fulfillment API to fetch orders and to create shipping fulfilments with tracking; use eBay's notification service for order events, with a scheduled poll as backup.
Handle eBay category, item specifics, business policies (payment, return, shipping) and marketplace country. Do not invent calls; if a field is not in the docs, ask me. Test in the eBay sandbox first.
```

## Amazon
```
Add the Amazon connector using the Connector interface and the Selling Partner API (SP-API).
Connection: the seller authorizes our registered app (Login with Amazon authorization), we store the refresh token encrypted and exchange it for short-lived access tokens. Support multiple marketplaces and regions.
Use the Listings Items API for product listings, the Orders API for orders, Notifications for order events, and the shipment confirmation API or feed to send tracking.
Orders contain buyer personal data. Only request the restricted roles we have been approved for, use Restricted Data Tokens where required, and never store more personal data than we need.
Handle category and product approvals, and show a clear message when a listing is blocked. Test with the sandbox.
```
Before this: register as an SP-API developer, get the app approved, and expect extra review if you need buyer personal data.

## TikTok Shop
```
Add the TikTok Shop connector using the Connector interface and the TikTok Shop Partner API.
Connection: seller authorization from the Partner Center app, access and refresh tokens stored encrypted, shop and region selected during authorization.
Implement product upload (with category, attributes and images that meet TikTok's rules), order fetch and webhooks, and fulfilment with tracking. Regions have separate API hosts and rules, so use a region setting.
```
Before this: register a TikTok Shop Partner Center app and check which countries your merchants are in.

## Wix
```
Add the Wix connector. Connection: install and OAuth for our registered Wix app. Use the Wix eCommerce and Stores APIs for products, inventory and orders, and add tracking to fulfilments. Register webhooks for order events. Check which of these our Wix app permissions allow.
```

## BigCommerce
```
Add the BigCommerce connector. Connection: single-click app install with OAuth, saving the store hash and token encrypted. Use the V3 Catalog API for products and variants, the Orders API (and shipments for tracking), and webhooks for order events.
```

## Etsy
```
Add the Etsy connector. Connection: Etsy Open API OAuth 2.0 with PKCE, tokens encrypted. Create and update listings, fetch receipts (orders), and add tracking. Check Etsy's rules before building: Etsy restricts reselling and dropshipping, so listings must follow its seller policies and production partner rules.
```

## Walmart Marketplace
```
Add the Walmart connector. Connection: seller provides API credentials (client ID and secret) which we store encrypted, and we request tokens from Walmart. Implement item setup, price and inventory feeds, order fetch and acknowledge, and shipment with tracking. Walmart approves sellers, so show a "pending approval" state.
```

## Magento, PrestaShop, OpenCart (merchant-supplied keys)
```
Add a connector for [PLATFORM]. Connection: the merchant creates an API key or integration token in their store and pastes it with the store address; we test the key and store it encrypted. Use the platform's REST API for products, stock, orders and shipments. Use webhooks if available, otherwise poll every few minutes.
```

## Regional platforms
Salla, Zid, Shopee, Lazada, Nuvemshop, Flipkart, Noon: use the generic template in CONNECTOR_PROMPTS.md. For each, first confirm that the platform gives outside apps API access and how the partner approval works.

## Catch-all for platforms without an API
```
Build a file-based connector. The merchant exports orders from their platform as CSV and uploads them; we import them as orders. We export a product feed (CSV) and tracking numbers as a file the merchant uploads back. Show the file format, column mapping, row errors, and a history of imports.
```

## Update to the portal
After a marketplace connector exists, the "Marketplace seller account" card on the Connect your store screen starts the seller sign-in for that marketplace. Add a "Request this platform" counter so you can see which platform merchants ask for most.

## Reminder
Amazon, TikTok Shop, Walmart and eBay (for some features) need approval before real merchants can connect. Until approved, build and test against the sandbox.
