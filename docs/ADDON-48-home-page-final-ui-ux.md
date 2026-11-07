# Add-on 48: Home page final UI/UX with octopus illustrations

**Replaces the layout parts of ADDON-45 (home redesign) and all of ADDON-47 (service images).** Data rules from ADDON-45 and the brand system from ADDON-46 still apply.

Screens: `design/home-final/screens/30-home-desktop.png` (1440 px), `30-home-phone.png` (390 px), `21-make-my-brand-*.png`, `00-brand-system.png`. Exact text, sizes and colours: `design/home-final/source/HomeRedesign.dc.html` (HTML with {{ }} placeholders, not code to paste). Where this text and a PNG differ, the text wins.

---

## PART 1 · Design system (from ADDON-46, summary)

| Token | Value | Use |
|---|---|---|
| Octopus Ink | `#1A174A` | Headings, dark buttons, picker card, pools and shipping panels, CTA band, footer, floating Octo button |
| Ink 2 | `#2C2870` | Hover on Ink |
| Coral Blue | `#4977BC` | Primary filled buttons (white text), step numbers, caption-chip dot |
| Coral text | `#3C66A8` | Eyebrows, links, coral text on light backgrounds, focus ring |
| On-Ink link / text / muted | `#A9C1E8` / `#C9CFE0` / `#DCE4F2` | Text on Ink |
| Aqua Pearl | `#FFFDEF` | Page and alternate section background |
| Illustration cream | `#FDF7EA` | Background behind 3D illustrations (matches the image edges) |
| Trench Black | `#231F20` | Body text |
| Muted | `#5A6475` | Secondary text |
| Lines | `#E5E2D4` (cards), `#CDC9B6` (ghost button, inputs), `#EFEDE2` (dividers) |
| Status | green `#15803D` / `#DCFCE7`; amber example pill `#92400E` / `#FEF3C7`; NEW badge `#F59E0B` with Ink text |

Type: Degular Display (headings) / Degular (text) / Futura (labels), with Figtree / Jost until licensed. H1 50/1.05 (phone 34), H2 34/1.12 (phone 25), lead 16.5/1.6, labels 11 px uppercase +0.06em.

Layout: container 1280 px, side padding 32 px (16 px phone); section padding 64 px (40 px phone); sections alternate Pearl and white with a 1 px `#E5E2D4` top line on white ones.

### Components

| Component | Spec |
|---|---|
| Button primary | Coral bg, white text, radius 10, min-height 48 (section CTAs 52, hero picker 54), hover Coral text colour bg |
| Button dark / ghost / light / outline-white | As ADDON-46 |
| Eyebrow | 28 px Ink number square (radius 8) + Coral-text label; MMB adds the NEW badge |
| Card | White, 1 px `#E5E2D4`, radius 14 |
| **Illustration card** `.ill` | Radius 24, bg `#FDF7EA`, image `object-fit: cover`, aspect 3:2, no shadow |
| **Photo** `.photo` | Radius 20, shadow `0 18px 40px rgba(26,23,74,.10)`, aspect 4:3 (strip) or 3:2 |
| **Caption chip** | Bottom-left inside the image, white 94 %, radius 999, 9×14 padding, 13.5 px 600, 8 px Coral dot (green dot when it is about safety/QC) |
| **Shade caption** | Ink gradient from transparent to 86 % at the bottom of a photo, white title 17 px + `#DCE4F2` line |
| **Floating card** | White card, radius 16, shadow `0 16px 36px rgba(26,23,74,.16)`, overlapping a picture corner by 22–26 px; inside the picture on phone |
| **Inset photo** | 46 % width, 6 px Pearl border, radius 18, overlapping the bottom-left of a picture by 28 px; hidden on phone |
| **Hero feather** | Hero illustration only: `mask-image: radial-gradient(ellipse 68% 68% at 50% 52%, #000 50%, transparent 98%)`, no frame |
| **Octo button** | Fixed bottom-right 24 px; Ink pill, 44 px Octo face on a Pearl circle, "Ask Octo", green online dot; phone: face only, 16 px from the edges |
| Step card | Card with Coral number, title 16.5 px, text 14 px muted |
| Check list | 20 px green circle tick + 15 px text |

---

## PART 2 · Images

All in `public/images/` (WebP 480 / 960 / 1536 px, 3:2, plus a 1536 px JPG). Upload to the media store (ADDON-42) under `site/services/` and `site/octo/`; every slot has a Site content key so the content team can swap it in Content Studio without a deploy.

| Slot (Site content key) | File | Alt text |
|---|---|---|
| `home.hero.image` | `3d-3pl-logistics` | The Octopus mascot storing, packing and loading parcels onto a delivery truck |
| `home.dropship.image` | `3d-dropshipping` | The Octopus mascot taking an order from a phone and delivering the parcel to a customer's door |
| `home.dropship.photo` | `dropshipping` | An Octopus packer placing a product in a box at the Shenzhen warehouse |
| `home.brand.image` | `make-my-brand-3d` | The Octopus mascot stamping a logo onto a product box, with colour swatches and packaging |
| `home.sourcing.image` | `product-sourcing-3d` | The Octopus mascot comparing three factory quotes with a magnifying glass |
| `home.sourcing.inset` | `factory-quality-control` | Quality inspection of products at the factory |
| `home.pools.image` | `3d-moq-pooling` | The Octopus mascot gathering boxes from several buyers onto one shared pallet |
| `home.turnkey.image` | `turnkey-projects-3d` | The Octopus mascot loading a gym machine, a vending machine and a coffee kiosk into a shipping container |
| `home.3pl.strip.1` | `logistics` | Stock arriving and being stored on warehouse shelves |
| `home.3pl.strip.2` | `3pl-service` | A warehouse team member scanning a parcel before packing |
| `home.3pl.strip.3` | `logistics-vehicle` | Parcels being loaded into a van for dispatch |
| `home.3pl.strip.4` | `returns-dropship-shirt` | A warehouse team member checking a returned product and noting its condition |
| `home.pay.image` | `wallet-escrow-3d` | The Octopus mascot guarding a safe with a wallet, coins and a shield |
| `home.manager.photo` | `customer-care-phone` | An Octopus account manager on a call with a customer |
| `home.faq.photo` | `back-office` | An Octopus support team member answering a customer call |
| `home.cta.image` | `3d-transportation` | The Octopus mascot loading parcels into a van with a route to the customer |
| `mmb.manager.photo` | `brand-consulting` | An Octopus brand consultant going through colour swatches and packaging samples with a customer |
| `octo.face` | `octo/octo-face-*` | (decorative, alt="") |
| reserved | `product-sourcing`, `after-sales` | for the sourcing and returns pages later |

Rule of thumb: **every numbered service section leads with its 3D octopus**; real-world photos are supporting proof (packing, factory QC, the 3PL strip, people you talk to).

---

## PART 3 · Page, section by section (owner's order)

1. **Announcement bar** (Ink): NEW + Make My Brand line + "See how it works →". Rotates with the Turnkey line.
2. **Header** (white): logo 42 px, search, My account. **Service rail** (sticky): Dropshipping · Make My Brand NEW · Product sourcing · MOQ pools · Turnkey Projects · 3PL & shipping | All categories.
3. **Hero** (Pearl): left = eyebrow, H1 "From the factory to your customer. **One account.**" (second sentence Coral text), lead, big search (56 px), 4 ticks; right = `home.hero.image` feathered (560 px column). **Service picker** below, full width Ink card, radius 22: title "What do you want to do?" + helper line; 5 tabs in one row (56 px, white = selected, `aria-pressed`, arrow keys); body two columns: left service label, promise (19 px white), 3 numbered steps; right fields (Source tab only: Product, Quantity, Destination country), fact line on 8 % white, primary button full width 54 px. Tab in URL `?do=`.
4. **One account, the whole route**: 5 stage cards with arrows (unchanged).
5. **Service sections**, each: eyebrow number + H2 + lead (≤ 2 lines) + ticks + primary and ghost button, with the 3D picture on the opposite side (alternating):
   1. **Dropshipping** (Pearl): text | `home.dropship.image` + chip "Your store → our warehouse → your customer's door". Row 2: catalogue preview (3 products, cost / suggested price / profit, shipping pill, EXAMPLE when not live) | `home.dropship.photo` with shade "Packed with your packing slip / Your brand on the parcel, never our prices". Row 3: 4 steps.
   2. **Make My Brand** (white): `home.brand.image` with floating "Studio preview" card (F8 thumbnail, "Handheld fan F8 · your logo", "Illustrative preview. Not approved artwork.") | text with 3 proof points. Then 4 steps.
   3. **Product sourcing** (Pearl): text + RFQ fee line + office chips (Shenzhen · HQ, Foshan, Yiwu, Ningbo) | `home.sourcing.image` with `home.sourcing.inset` and chip "Real factory checks before you pay". Then 4 steps.
   4. **MOQ pools** (white): `home.pools.image` + chip "Many buyers, one factory order" | text, 4 small steps, ticks, buttons. Row 2: Ink panel "Open pools closest to filling": 3 pool cards side by side (thumb, name, factory minimum, progress bar, committed / MOQ, closing date, price, Join pool) from live data.
   5. **Turnkey Projects** (Pearl): text, category chips, "See all [count] businesses →" | `home.turnkey.image` + chip "Machines, fit-out and spares in one container". Row 2: 5 business cards in one row (Gym fit-out, Coin and app laundry, Vending network, Robotic café kiosk, Water-bottling plant) from the turnkey data.
   6. **3PL & shipping** (white, last service): heading + lead; **photo strip of 4** (`home.3pl.strip.1–4`: Received and stored · Picked, scanned, packed · Dispatched worldwide · Returns checked, each with number and one line); then warehouse card (China · Shenzhen) + second-location card | Ink shipping panel (YunExpress network, Express / Standard / Economy from the rate table); buttons.
6. **Ready to order**: 4 verified products (unchanged).
7. **How you pay** (white): `home.pay.image` + green chip "Your money waits in escrow until QC and shipping" | heading, lead, 4 steps in 2×2, "No card payments…" line.
8. **Your own account manager** (Pearl): text, ticks, "Message your manager" + "Book a call" | `home.manager.photo` with floating manager card ([Manager name] when signed in, generic for visitors, "Your contact").
9. **Also on Octopus B2B**: 7 cards; the Octo assistant card uses the Octo face (44 px) as its icon.
10. **FAQ** (Pearl): questions (left, 1.5 fr) | sticky card (right): `home.faq.photo`, "Still have a question?", WhatsApp button, "Or ask Octo, our assistant, any time" with the face.
11. **Final CTA**: Ink band, text + "Create a free account" + "Chat on WhatsApp" | `home.cta.image` (16 px radius tile).
12. **Footer** (Ink, white logo) and **floating Octo button** (opens the Octo assistant).

**Make My Brand page** (`/make-my-brand`): account manager card = `mmb.manager.photo` (left half, cover) | text, manager line and the 6-point checklist; service rail in the owner's order.

---

## PART 4 · Responsive and interaction

| Breakpoint | Behaviour |
|---|---|
| ≥ 1101 px | As the desktop PNG |
| 761–1100 px | Two-column splits stack (picture after text); picker body one column; turnkey cards 2 per row; 3PL strip 2×2; pay steps 2×2 |
| ≤ 760 px | Hero picture hidden; picker tabs scroll sideways (150 px each); step rows, product, pool, business and 3PL photo cards become scroll strips (260 px, scroll-snap); hidden: dropship packing photo, QC inset, pay illustration, FAQ side card, CTA illustration; floating cards sit inside the picture; Octo button shows the face only |

- Floating cards and chips never cover a button or text link; on hover nothing moves (no parallax, no auto-playing motion). Respect `prefers-reduced-motion`.
- Images: `next/image`, width/height 1536×1024, `sizes` per slot (hero `(min-width:1100px) 560px, 0px`; section pictures `(min-width:1100px) 600px, 100vw`; strip `(min-width:1100px) 300px, 260px`), WebP, lazy except the hero picture (`priority`).

## PART 5 · Quality bar

- Lighthouse mobile ≥ 90 in all four; LCP < 2.5 s (LCP = H1), CLS < 0.05, INP < 200 ms; first-load images ≤ 150 KB; page height about 13,700 px at 390 px.
- Contrast ≥ 4.5:1 (caption chips are Ink on 94 % white; shade text is white on ≥ 70 % Ink).
- Every image has alt text from Part 2 (decorative Octo face alt=""); every target ≥ 44 px; focus ring 3 px `#3C66A8`.
- Honesty: these are illustrations of each service. No real staff names under the photos; the account manager card shows the real manager only when signed in. Example numbers keep their EXAMPLE pill; [brackets] are filled from data or hidden.
- No supplier names, Octopus cost or margin; carrier name only "YunExpress network" and only once that connection has passed a test shipment.

---

## Prompts

### 48-A · Report only
```
Read docs/ADDON-48-home-page-final-ui-ux.md and the PNGs in design/home-final/screens. Change nothing.
Report: what on "/" and "/make-my-brand" differs from the PNGs today, whether the media store and Site content keys exist, which slots in Part 2 have no key yet, and what data is missing (rates, pools, turnkey count, manager reply time).
```

### 48-B · Images and content keys
```
Upload public/images/services/* and public/images/octo/* to the media store (site/services, site/octo). Create the Site content keys in Part 2 with file and alt text, editable in Content Studio › Media. Stop and list the keys.
```

### 48-C · Components
```
Build the components in Part 1 (illustration card, photo, caption chip, shade caption, floating card, inset photo, hero feather, Octo button, Ink picker) as reusable components using the ADDON-46 tokens. Show them on a /dev/ui page (staff only) at 1440 and 390 px.
```

### 48-D · Build the page
```
Build "/" in the order of Part 3 and the Make My Brand change, wired to the existing data and the Site content keys, with the responsive rules in Part 4. Stop after the hero + sections 1–3, then after the rest, each time with desktop and phone screenshots next to 30-home-desktop.png and 30-home-phone.png.
```

### 48-E · Checks
```
Run Part 5: Lighthouse mobile, Web Vitals, contrast, keyboard through the picker tabs and FAQ, 390 / 768 / 1280 / 1440 px with no sideways scroll, no floating card over a button, no example number or bracket on live. Staging first; show me before going live.
```
