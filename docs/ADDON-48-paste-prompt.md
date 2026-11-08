# Home page final UI/UX: paste this into Antigravity (ADDON-48)

This kit **replaces kit 15** (ADDON-47) and the layout parts of kit 13 (ADDON-45). Kit 14 (ADDON-46 brand system) must be done first.

Put these in the repo first (all in this zip):
- `docs/ADDON-48-home-page-final-ui-ux.md`: design system, components, every image slot with alt text, the page section by section, responsive rules, quality bar, prompts 48-A to 48-E
- `public/images/services/`: 19 service pictures as WebP (480 / 960 / 1536 px) + JPG
- `public/images/octo/`: the Octo assistant face (512 PNG, 96 / 192 WebP)
- `design/home-final/screens/`: home desktop 1440 px and phone 390 px, Make My Brand page, brand system
- `design/home-final/source/`: exact layout (HTML with {{ }} placeholders, not code to paste)

Then paste:

```
ROLE: Rebuild the home page "/" (and one card on "/make-my-brand") to match design/home-final/screens/30-home-desktop.png and 30-home-phone.png, following docs/ADDON-48-home-page-final-ui-ux.md. Work on STAGING. Where the doc and a PNG differ, the doc wins.

UI/UX in short:
- Brand: Octopus Ink #1A174A, Coral Blue #4977BC (filled buttons only), Coral text #3C66A8, Aqua Pearl #FFFDEF page, Trench Black #231F20 text; Degular Display / Degular / Futura (Figtree / Jost until licensed). Tokens from ADDON-46 only.
- Hero: H1 + search + ticks on the left, the 3D octopus warehouse illustration feathered into the page on the right; the "What do you want to do?" picker below as a full-width Ink card with 5 tabs.
- Every service section in the owner's order (Dropshipping, Make My Brand, Product sourcing, MOQ pools, Turnkey Projects, 3PL & shipping) leads with its own 3D octopus illustration, alternating sides, with a caption chip. Real photos support it: packing photo next to the catalogue, factory-QC inset on sourcing, a 4-photo 3PL strip (stored, packed, dispatched, returns checked).
- How you pay gets the wallet-and-safe octopus; account manager gets the headset photo with a floating manager card; FAQ gets a sticky "Still have a question?" card; final CTA gets the van octopus.
- Octo assistant: floating "Ask Octo" button bottom-right with the Octo face, also on the "Also on" card and in the FAQ card.
- Every picture comes from the media store through a Site content key (swap in Content Studio without a deploy), next/image, WebP, alt text from the doc, lazy except the hero picture.
- Phone: hero picture and decorative photos hidden, rows become swipe strips, floating cards sit inside the picture, Octo button shows the face only.
- Quality: Lighthouse mobile ≥ 90, LCP < 2.5 s, CLS < 0.05, contrast ≥ 4.5:1, targets ≥ 44 px, no example numbers or [brackets] on live, no real staff names under photos.

Work in order and stop after each step for my check: 48-A report → 48-B images and content keys → 48-C components (/dev/ui) → 48-D build the page (two stops) → 48-E checks.
After each step: list changed files and show desktop and phone screenshots next to the PNGs.
Staging first. Do not touch live customer data.
```

## Still needed from you

- 3PL rates and delivery days (shipping panel), open pools data, turnkey business count, manager reply time.
- Degular / Futura web licences and the logo SVG (from kit 14).
