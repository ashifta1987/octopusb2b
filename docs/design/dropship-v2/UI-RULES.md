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


## Navigation (one system for every service)

| Job | Pattern | Rules |
|---|---|---|
| Move between site areas | Shop: header + section bar (overflow into More ▾ under 1200 px). My account: sidebar (collapses to icons under 1200 px). Phones: bottom bar, 5 items | `aria-current="page"`; labels always visible on the bottom bar |
| Switch parts of one record | Underline tabs | 48 px; selected tab is bold with a 3 px blue bar; counts after the label; sticky; `?tab=` in the URL; tablist/tab/tabpanel; arrow keys |
| Filter a list | Pill filters with counts | 40 px; selected = navy + check mark; `aria-pressed`; result count read out with `aria-live` |
| Numbers that filter | Card tabs | ≥ 96 px; selected = 2 px blue border; 4 per row (2 on phones) |
| Switch between 2–3 views | Segmented control | 40 px; grey track, white selected segment |
| Show a process | Stepper | done = teal check; now = blue with halo; horizontal on desktop, vertical on phones; `aria-current="step"` |
| Show where you are | Breadcrumbs | every page below level 1; on phones only "‹ Parent" |
| Categories | Mega menu | opens on click; Esc closes and returns focus |

General rules:
- Never use a different tab style for a different service.
- Tabs and filters live in the URL.
- Tab panels load when first opened and keep their state when you switch back.
- Tap targets are at least 44 px.
- Focus ring: 3 px amber (#F59E0B) outline.
