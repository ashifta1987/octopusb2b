# UI/UX rules for Octopus Dropship (design v2)

These apply to every step. Read with README.md.

```text
UI/UX RULES FOR OCTOPUS DROPSHIP (design v2). These apply to every step from now on.

1. Design source of truth: docs/design/dropship-v2/. Open the HTML files in a browser. README.md lists every screen, its route and its build step. When a step builds a screen, match its file: layout, order of sections, wording, buttons, states. If design v1 (docs/design/dropship/) differs, v2 wins.
2. NOT UI: the cream "What changed" boxes, the orange NEW tags, the dashed "Build notes for Antigravity" boxes and the "Sample data" lines are design annotations. Do not build them. The build notes are requirements for you.
3. Tokens: specs/tokens.css (colours, badge colours, radius 8/12, touch size 44px, content max width 1240px, Inter). Map them into the app's existing styling approach. No new colours.
4. Components (build once, reuse everywhere; match specs/Components.html):
   Button (primary, secondary, danger, text link; hover, keyboard focus ring, loading, disabled with the reason shown next to it), Input/Select/Textarea with label, hint and error, Checkbox, Radio card, Switch (role="switch"), Filter chip (aria-pressed), Badge (ok, warn, bad, info, neutral, each with an icon AND words), Card with icon heading, Table card (scroll box, header #F7F9FC, row hover), Notice (info, ok, warn, bad), Toast, Dialog, Empty state, Skeleton, Stepper, Timeline, Price breakdown (Product, Processing, Shipping, Duties and tax, Landed: always in that order), Page header with icon tile, Top bar (search, notifications with count, help, account).
5. Shells:
   - Merchant (/account/dropship/*): sidebar in 4 groups (Sell, Set up, Money, Account) with icons, store switcher, active item with a teal inset bar and aria-current="page"; top bar on every page; content max 1240px centred.
   - Phone (below 768px): top bar with logo, store and notifications; bottom tabs Home, Find, Orders, Wallet, More (More lists the other pages); in early access Home, Find, Requests, Wallet, More; tables scroll sideways; grids stack. Match mobile/*.html.
   - Staff (/office/dropship/* and /admin/finance/saas): staff menu with icons as on staff/*.html, same top bar.
6. Icons: line icons 16–20px, stroke about 1.9, currentColor, aria-hidden. Use lucide-react (ISC licence) if it is not in the repo yet; the name map is in README.md. No emoji anywhere.
7. States: every screen has loading (skeleton after 300 ms), empty, error and success states, as on states/*.html. A disabled button always shows why next to it.
8. Accessibility: text contrast at least 4.5:1, real buttons, links and inputs with labels, aria-current on the active page, visible focus ring (2px white + 2px blue), 44px touch targets, errors name the field and say how to fix it.
9. Data: the design's numbers are samples. Never ship sample data or [PLACEHOLDERS]. Show empty states when there is no data; bracketed values come from settings I fill in.
10. Business rules shown in the design are binding:
    - white-label: no supplier or factory names, no Sourcing model no., no Octopus cost or margin on merchant or buyer screens;
    - Pay later is never shown to customers, not even disabled;
    - DS model numbers on products and variants;
    - Processing is its own line on every price, and duties are set only on Packing and shipping;
    - plan fees follow Finance › SaaS billing.
11. For every step: show me desktop (1280px) and phone (390px) screenshots of each screen you built, next to the design file name, and list every difference with the reason.
```
