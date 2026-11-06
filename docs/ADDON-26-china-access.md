# Add-on: make the site reliably reachable from mainland China

> **Status (6 Nov 2026): not built yet** — owner chose ADDON-27 first. When built, step 7 (staff Google at /staff/login) does NOT apply: the owner's decision is customers may use Google, staff use email + password + 2FA only.

## Why

The site is for global buyers, not Chinese buyers — so no ICP license, no Alipay/WeChat Pay, no Simplified Chinese UI, no Baidu SEO. But the Shenzhen team has to use Admin, Finance, Support, Sourcing and the Backup & restore panel every day without a VPN. Any third-party asset blocked by the Great Firewall breaks the page even when the host itself is reachable.

## Antigravity prompt 26-A — remove every Great-Firewall-blocked dependency

```
Read docs/SPEC.md sections 8, 9, 12, and the audit findings M5 and K2. The site is for global buyers but the Shenzhen team must be able to use it reliably without a VPN. Remove every third-party dependency that is blocked in mainland China and lock the build so no new one can sneak in.

1. Self-host every web font. For each of Lexend, Inter, IBM Plex Mono, Noto Sans SC and Noto Serif SC:
   a. Download the exact weights currently used (check every page) into /apps/web/public/fonts/.
   b. Replace every <link rel="stylesheet" href="https://fonts.googleapis.com/..."> and every @import of a fonts.googleapis.com or fonts.gstatic.com URL with Next.js next/font/local declarations. Use display: 'swap' and subset the WOFF2 to the Latin + Latin Ext + (for Noto SC) Chinese Simplified ranges actually used.
   c. Delete the corresponding <link> and @import lines from every .html, .dc.html and docs/design asset. The static HTML snapshots in docs/design/html/ keep their styles but reference the local files.
   d. Verify with a build-time script: grep the output of `pnpm build` for any `googleapis.com`, `gstatic.com`, `fonts.google.com` — build fails if any match.

2. Remove or replace every other Great-Firewall-blocked third-party in the app:
   - Google Analytics / Google Tag Manager → Plausible (self-hosted or EU-hosted) OR Vercel Analytics (already works in China via Vercel).
   - Google reCAPTCHA → Cloudflare Turnstile or hCaptcha.
   - YouTube embeds → self-hosted MP4 or a Bilibili iframe.
   - Google Maps embeds → OpenStreetMap via Leaflet, or a static map image served from our own bucket.
   - Facebook/Twitter/LinkedIn JS SDKs → static HTML share links (no SDK).
   - Any `apis.google.com`, `cdnjs.cloudflare.com/ajax/libs/jquery` (Cloudflare's JS CDN is sometimes slow in China but not blocked — move critical libs to our own public/ folder).

3. Keep Supabase and Vercel as the origin. Both are reachable from mainland China (not blocked), just slow over international links. Do not move hosts for this change; see step 7 for the hosting recommendation.

4. Delete the Google Fonts URL from every page component, layout, email template and PDF renderer (company profile, invoice, QC report, name card). Use local fonts in those too, or a system-font stack for PDF-only paths.

5. Add a CI gate `scripts/no-blocked-deps.ts` that fails the build if any of these domains appears in the final HTML, JS bundle or CSS:
   - fonts.googleapis.com, fonts.gstatic.com, gstatic.com
   - www.google-analytics.com, googletagmanager.com, www.googletagmanager.com
   - www.google.com/recaptcha, www.gstatic.com/recaptcha
   - maps.googleapis.com, maps.google.com
   - youtube.com/embed, youtube-nocookie.com
   - connect.facebook.net, platform.twitter.com, platform.linkedin.com
   - fonts.cdnjs.com, ajax.googleapis.com
   - accounts.google.com/gsi/client (customer Google OAuth was removed in ADDON-22; staff OAuth at /staff/login is allowed because staff use a VPN when needed)
   The script runs on every PR and before `vercel deploy --prod`.

6. Add a site_settings row `region = 'global' | 'china_facing'` (default `global`). When set to `china_facing`:
   - The storefront footer shows WeChat ID + QR code alongside WhatsApp (and labels both).
   - The /about page "Get in touch" card shows WeChat first, WhatsApp second.
   - The name-card HTML template serves the Chinese back side only (English stays as a toggle).
   - No Chinese payment gateway is enabled — payment still goes through the global gateway chosen in K1.
   - No UI translation to Simplified Chinese. The 中文 we already have on About, the name card and the company profile stays.

7. Staff Google sign-in at /staff/login (SPEC §17) STAYS, because:
   - It is accessed only by Octopus staff.
   - Staff are allowed a company SSL VPN for business use under PRC rules for foreign-related operations.
   - A fallback email + password + 2FA path is already supported on the same page (SPEC §17.2 step 1).
   Add a notice on the Google button when the user agent / IP geolocates to mainland China: "On the office network? Sign in with Google. From outside the VPN, use email and 2FA." The notice text is a CMS entry.

8. Audit log: write `third_party_blocked` events to audit_log if any Edge Function outbound call to a blocked domain is attempted at runtime.

9. Tests:
   - Playwright golden path from a `headers: { 'Accept-Language': 'zh-CN', 'CF-IPCountry': 'CN' }` test context — every page renders with local fonts, no network request to fonts.googleapis.com or any domain in step 5.
   - axe + Lighthouse on home, products, product, pools, about, admin: no network error, no font-loading jank.
   - unit test on scripts/no-blocked-deps.ts.

Done when: the build fails loudly if any blocked domain re-enters; the Shenzhen team opens the site at 9 am local time with system fonts replaced by our fonts, no visible network errors, no hanging page.
```

## Hosting choice (this part is not code)

Even after the prompt above, request latency from Shenzhen to Vercel/Supabase (both outside mainland China) is 200–800 ms. Three paths:

1. **Do nothing on hosting.** Pages load in 1–3 s from Shenzhen, usable for the team. Cheapest. Recommended first.
2. **Move Supabase to the Hong Kong region (`ap-east-1`)**, keep Vercel. Cuts most backend latency for the Shenzhen team. One-time migration, no ICP required.
3. **Cloudflare in front of Vercel with the paid China Network add-on.** Fastest. Requires an ICP filing for the domain, which is an extra 2–4 weeks of paperwork — against the premise that you don't want China-facing operations.

My recommendation: run **26-A + option 2** (move Supabase to HK region). That gets you reliable team access from Shenzhen without stepping into the ICP process.

## What this add-on does NOT do

- No Chinese buyer features (no Alipay, no WeChat Pay, no Simplified Chinese UI, no ICP, no Baidu, no `.cn` domain).
- No change to the catalogue, to orders, to KYC rules, or to the T&C.
- Nothing is removed that only works in China — only things that **don't work in China** are removed.

Done when: every page in the app loads correctly on a mainland-China network with no VPN, no broken fonts, no timeouts from blocked assets.
