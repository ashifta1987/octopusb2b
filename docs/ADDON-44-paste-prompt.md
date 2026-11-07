# Make My Brand on the home page, dropship catalogue, audit fixes: paste this into Antigravity

Put these in the repo first (all in this zip):
- `docs/hostoctopus-audit-2026-11-08.md`: the audit (findings 01–21)
- `docs/ADDON-44-make-my-brand-on-home-dropship-catalogue-audit-fixes.md`: prompts 44-A to 44-F
- `design/audit-fixes/screens/*.png`: 7 screens at 1440 px and 390 px
- `design/audit-fixes/source/*.dc.html` and `assets/`: exact text, colours and sizes (HTML with {{ }} placeholders, not code to paste)

Kits 8 (service inner pages) and 9 (Make My Brand screens) still apply and are referred to.

Then paste:

```
Fix the findings in docs/hostoctopus-audit-2026-11-08.md and build the screens in design/audit-fixes/screens/*.png, following docs/ADDON-44-make-my-brand-on-home-dropship-catalogue-audit-fixes.md.

What this adds:
- Make My Brand made visible: menu item (2nd, NEW badge), announcement bar line, home section 2 that explains it, "Also on" card, its own page /make-my-brand, a Request Center tab /request/brand, and "Put your brand on it" on verified product pages.
- Dropshipping › Catalogue (/account/dropship/catalogue): only products available for dropshipping to the seller's chosen country, and a dropship product page with cost per shipping type, your price and profit, push to store, sample.
- Audit fixes: Verified by Octopus, wallet-only payment wording, real 3PL warehouse list, correct 3PL steps, correct "follow your request" places, one store-platform list, no carrier names, honest "coming soon" where connections are not live.

Hard rules:
1. The home page layout stays; only add what boards 20 and 21 show.
2. Make My Brand and the dropship catalogue show only verified products (products Octopus lists directly are verified), enforced in a database view.
3. No supplier names or codes, carrier names, or Octopus cost and margin on customer or public pages.
4. Payment: Octopus wallet, topped up by bank transfer. No card payments anywhere.
5. Example numbers in the designs are examples. Text in [brackets] is an open decision or live data: fill it from settings or the database, or hide it. Never invent prices, rates, MOQs or delivery days.

Work in order and stop after each step for my check: 44-A (report only, plus what is blocked) → 44-B quick copy and data fixes → 44-C Make My Brand on home and its page → 44-D dropship catalogue and product page → 44-E public product page and Request Center → 44-F accessibility and checks.
After each step: list changed files, show desktop and phone screenshots next to the matching PNG, and list anything you could not match or that is blocked.
Staging first. Do not touch live customer data.
```

## Screens in this kit

| PNG | Screen | Route |
|---|---|---|
| 20 | Home page with Make My Brand | `/` |
| 21 | Make My Brand public page | `/make-my-brand` |
| 22 | Dropshipping › Catalogue | `/account/dropship/catalogue` |
| 23 | Dropshipping › product page | `/account/dropship/catalogue/[id]` |
| 24 | Public product page (fixed) | `/p/[slug]` |
| 25 | Request Center › 3PL (fixed) | `/request/3pl` |
| 26 | Request Center › Make My Brand (new) | `/request/brand` |

## You, not Antigravity

1. Email: create the mailboxes and add MX, SPF and DKIM records for octopusb2b.com (and hostoctopus.com if used). Mail to every company address bounces today.
2. Send: the real warehouse list, dropship plan and fees, 3PL rates and cut-off time, delivery days per service, and Make My Brand MOQs and extra days per method.
3. Decide: Google sign-in for customers, yes or no.
