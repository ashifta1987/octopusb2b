ROLE: Apply the Octopus B2B brand to the whole app and add the new images. STAGING only. Look, images and links only; no data or logic change. Reference pictures: design/home-desktop.jpg, design/home-phone.jpg, design/brand-guide.jpg. If a file or route below is missing, don't invent it: use the fallback and list it.

FILES (in the repo):
public/brand/ octopus-b2b-logo.png|.webp (light bg), octopus-b2b-logo-white.png|.webp (dark bg), octopus-icon-ink-512.png, favicon-32.png, apple-touch-icon-180.png
public/images/octo/octo-face.webp
public/images/services/*.webp (1200×800, 3:2): 3d-3pl-logistics, 3d-dropshipping, make-my-brand-3d, product-sourcing-3d, 3d-moq-pooling, turnkey-projects-3d, wallet-escrow-3d, 3d-transportation, dropshipping, factory-quality-control, logistics, 3pl-service, logistics-vehicle, returns-dropship-shirt, customer-care-phone, back-office, brand-consulting, product-sourcing, after-sales
Use next/image (it makes the smaller sizes). Lazy-load all except the hero picture.

BRAND (all pages, /account, /admin, /scan, /studio, /dev, emails, PDFs):
- CSS variables + Tailwind, no hex in components: ink #1A174A, ink-2 #2C2870, coral #4977BC (filled buttons, white text), coral-text #3C66A8 (links/text, focus ring; never #4977BC for small text), pearl #FFFDEF (page bg), black #231F20 (body), muted #5A6475, line #E5E2D4, line-strong #CDC9B6, fill #EFEDE2, tint #E4EBF6, ill-bg #FDF7EA; on ink: #A9C1E8 links, #C9CFE0 text. Status colours unchanged.
- Old → new: #11133C→ink, #2A6FD6→coral, #1E58B0/#1D4ED8→coral-text, #F5F6F8→pearl, #3B4556→black, #E2E5EA→line, #EEF0F4→fill, #E6EFFC→tint.
- Fonts: Degular Display (headings), Degular (text), Futura PT (labels); until licensed use Figtree 400–800 + Jost 600 via next/font. H1 50px (phone 34), H2 34px (phone 25), body 16/1.6.
- Buttons radius 10, min 48px; cards white, 1px line, radius 14; targets ≥ 44px.
- Logo full lockup only, never recoloured; header 42px (phone 36), footer 48px (white version); favicon/manifest from public/brand; theme-color #1A174A.
- Header white, announcement bar + footer ink, sections alternate pearl/white, one coral button per section.

IMAGE STYLE: 3D pictures in a card (radius 24, bg ill-bg) with a caption chip (white pill bottom-left, coral dot). Photos radius 20 with soft shadow. Floating white cards overlap picture corners (inside the picture on phone). Hero picture has soft faded edges (radial mask), no frame.

HOME "/" (in this order):
1 Ink announcement bar · header · sticky rail: Dropshipping, Make My Brand (NEW), Product sourcing, MOQ pools, Turnkey Projects, 3PL & shipping
2 Hero: H1 "From the factory to your customer. One account." + search + ticks | 3d-3pl-logistics. Below: full-width ink card "What do you want to do?" with 5 tabs (Dropship, Put my brand on it, Source a product, Share a factory order, Store and ship).
3 Route: 5 stage cards.
4 Services, picture side alternates:
  Dropshipping: 3d-dropshipping; then catalogue preview + dropshipping photo ("Packed with your packing slip").
  Make My Brand: make-my-brand-3d + floating "Studio preview" card.
  Product sourcing: product-sourcing-3d + factory-quality-control as a small inset photo; office chips Shenzhen HQ, Foshan, Yiwu, Ningbo.
  MOQ pools: 3d-moq-pooling; then ink panel with 3 open pools side by side.
  Turnkey Projects: turnkey-projects-3d; then 5 business cards in a row.
  3PL & shipping: photo strip logistics, 3pl-service, logistics-vehicle, returns-dropship-shirt (Received and stored · Picked, scanned, packed · Dispatched worldwide · Returns checked); then warehouse card + ink shipping panel.
5 Ready to order (4 verified products) · How you pay: wallet-escrow-3d + 4 steps · Account manager: customer-care-phone + floating manager card · Also on (Octo card uses octo-face) · FAQ + sticky card with back-office photo and WhatsApp · Ink CTA with 3d-transportation · footer.
6 Floating "Ask Octo" button bottom-right with octo-face (opens the Octo assistant).
/make-my-brand: brand-consulting photo in the account manager card; same rail order.
Phone (≤760px): hide hero picture, packing photo, QC inset, pay picture, FAQ card, CTA picture; card rows swipe sideways.
Alt text: describe what each picture shows; no staff names.

LINKS (fallback in brackets):
Rail: /dropshipping (/#dropshipping), /make-my-brand, /sourcing (/#sourcing), /pools (/#moq-pools), /turnkey (/#turnkey), /3pl (/#warehousing).
Start dropshipping → /account/dropship/catalogue (signed out /signup?service=dropship) · Start a brand project → /request/brand · Request quotes → /request/sourcing · Browse products → /products · See open pools → /pools · Start a pool → /pools/new (/request/sourcing?type=pool) · See all businesses → /turnkey · Talk about a project → /contact?topic=turnkey · Get a 3PL quote → /request/3pl · Check shipping → /shipping (/request/3pl#rates) · Product cards → /p/[slug] · Message manager → /account/messages · Book a call → /account/messages?book=call · Create account → /signup · WhatsApp → https://wa.me/8618826527644 · Footer: /login, /signup, /account, /about, /contact, /supplier/apply, /login?role=staff, /terms, /privacy.

RULES: no supplier names, Octopus cost or margin on customer pages; carrier only "YunExpress network" after a passed test shipment; example numbers keep the EXAMPLE label; never invent prices, rates or days; Lighthouse mobile ≥ 90, CLS < 0.05, no contrast failures, no sideways scroll at 390–1440px.

STEPS (stop after each; show desktop + phone screenshots):
1 Report: missing files, missing routes, where colours/fonts/logos are set today.
2 Colour tokens, fonts, buttons, logo, favicon, headers, footers.
3 Recolour every screen to the tokens (public, /account, /admin, /scan, /studio, /dev, emails).
4 Upload images to the media store with a Site content key per slot (swappable in Content Studio).
5 Build the home page and /make-my-brand as above, with all links.
6 Checks + link check (every link works or uses its fallback). Show me before going live.
