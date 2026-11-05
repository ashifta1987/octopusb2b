# Add-on: remove "Advertising" from the customer sidebar

> **Implementation note (6 Nov 2026, owner decision):** there is no `/supplier/ads` screen yet, so instead of deleting the campaign screen it was moved to `app/account/ads/campaign-manager.tsx` (not routed) for the future supplier portal. `/account/ads` redirects to `/account?notice=not-in-account`. Admin moderation at `/admin/ads` is unchanged.

## Why

Customers come to Octopus B2B to buy, not to advertise. Advertising is for the sellers — suppliers (when the supplier portal opens), distributors on behalf of suppliers, the external Advertiser role, and the back-office / admin roles that moderate and price it. SPEC.md §3 already restricts the `Advertising` role and area to those users; the customer sidebar was just carrying a stray link.

The customer-portal design files (`docs/design/Customer.png`, `docs/design/Assistant.png`, and their HTML snapshots) show the correct customer sidebar — there is no "Advertising" item in either.

## Antigravity prompt 23-A — remove Advertising from the customer sidebar and guard the route

```
Read docs/SPEC.md sections 3 and 8.3, and docs/design/html/Customer.html and docs/design/html/Assistant.html. Remove the "Advertising" item from the CUSTOMER portal sidebar — customers don't advertise; only suppliers, distributors, the Advertiser role and admin do (and they already see it from their own portals / Admin → Advertising).

1. In the customer sidebar config (the one rendered on /account, /account/orders, /account/wallet, /account/ledger, /account/kyc, /account/developer, /account/support, /account/pools and /account/assistant), delete the "Advertising" entry. The customer sidebar should contain exactly: Dashboard · AI assistant · RFQs · Service requests · Orders · Group buys · Wallet · Ledger & invoices · Company & KYC · API & integrations · Help & complaints — match docs/design/html/Customer.html.

2. If the project also has a route like app/account/ads/page.tsx or app/account/advertising/page.tsx, delete the folder and its tests. Any import or usage from the customer area goes with it.

3. The Advertiser experience stays available to users who have the Advertiser role (SPEC §3) under /supplier/ads (docs/design/AdsCampaign.png) and to admin at /admin/ads (docs/design/AdsAdmin.png). Do NOT remove either of those routes or change the role permissions.

4. Middleware: the customer-portal layout must not redirect or link to any /ads path for a user whose roles do not include Advertiser, Supplier, Distributor or Admin. A customer who types /account/ads directly should land on the dashboard with a one-line notice ("That area isn't part of your account."), not a 404 stack trace.

5. Playwright: a signed-in customer without the Advertiser role sees no "Advertising" link in the sidebar at any viewport (360, 768, 1440) and navigating to /account/ads redirects to /account.

Done when: the customer dashboard matches docs/design/Customer.png (no "Advertising" in the sidebar), the supplier and admin ad screens still work, and the Playwright assertion is green.
```

Paste that prompt into Antigravity. It's a small, targeted change — no migration, no new UI.
