import 'server-only';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Website image slots (owner list: website_image_list.md). Each slot names the owner's file in
 * public/images/design/new/. Until that file exists, the closest existing photo is shown instead, so dropping a file
 * into the folder later needs no code change (the folder is read once when the server starts or the site is built).
 */
export type SiteImage = { src: string; alt: string; width: number; height: number; supplied: boolean };

const NEW_DIR = path.join(process.cwd(), 'public', 'images', 'design', 'new');
const present: Set<string> = (() => {
  try { return new Set(readdirSync(NEW_DIR)); } catch { return new Set(); }
})();

const D = (f: string) => `/images/design/${f}`;
const S = (f: string) => `/images/services/${f}`;
const T = (f: string) => `/images/turnkey-team/${f}`;

type Slot = { file: string; fallback: string; alt: string; w: number; h: number };
const HERO = { w: 1920, h: 1280 }, PHOTO = { w: 1536, h: 1024 }, SQUARE = { w: 1024, h: 1024 }, SHARE = { w: 1200, h: 630 };

const SLOTS = {
  // 1. Homepage
  'home-hero': { file: 'home-hero.webp', fallback: D('10-product-sourcing-hero-image.webp'), alt: 'An Octopus account manager showing a buyer product samples and quotes.', ...HERO },
  'step-find': { file: 'step-find.webp', fallback: D('11-product-sourcing-education-image-1.webp'), alt: 'Factory samples being compared on a table.', ...SQUARE },
  'step-brand': { file: 'step-brand.webp', fallback: D('15-make-my-brand-education-image-1.webp'), alt: 'A logo printed on a product and its box.', ...SQUARE },
  'step-stock': { file: 'step-stock.webp', fallback: S('logistics-1536.webp'), alt: 'Cartons stored on racks in the warehouse.', ...SQUARE },
  'step-sell': { file: 'step-sell.webp', fallback: D('04-homepage-service-card-dropshipping.webp'), alt: 'An online store on a laptop next to packed orders.', ...SQUARE },
  'step-ship': { file: 'step-ship.webp', fallback: S('3pl-service-1536.webp'), alt: 'A parcel being scanned at the dispatch table.', ...SQUARE },
  'home-qc': { file: 'home-qc.webp', fallback: T('07-production-and-qc.webp'), alt: 'A quality inspector measuring a finished product with calipers.', ...PHOTO },
  'home-team': { file: 'home-team.webp', fallback: T('10-six-person-china-team.webp'), alt: 'The Octopus team in China in matching navy shirts.', ...PHOTO },
  'share-home': { file: 'share-home.jpg', fallback: D('01-homepage-service-card-product-sourcin.webp'), alt: 'Octopus B2B: from the factory to your customer.', ...SHARE },
  // 3. Product sourcing
  'sourcing-hero': { file: 'sourcing-hero.webp', fallback: D('10-product-sourcing-hero-image.webp'), alt: 'A buyer and an Octopus sourcing agent comparing product samples and supplier quotes.', ...HERO },
  'sourcing-audit': { file: 'sourcing-audit.webp', fallback: T('12-audit-with-checklist.webp'), alt: 'An Octopus auditor checking a factory with a checklist.', ...PHOTO },
  'sourcing-samples': { file: 'sourcing-samples.webp', fallback: D('11-product-sourcing-education-image-1.webp'), alt: 'Hands checking the stitching and finish of a product sample.', ...PHOTO },
  'sourcing-quote': { file: 'sourcing-quote.webp', fallback: D('13-product-sourcing-education-image-3.webp'), alt: 'A quote sheet with unit price, quantity and lead time.', ...PHOTO },
  'share-sourcing': { file: 'share-sourcing.jpg', fallback: D('10-product-sourcing-hero-image.webp'), alt: 'Product sourcing with Octopus B2B.', ...SHARE },
  // 4. Make My Brand
  'brand-hero': { file: 'brand-hero.webp', fallback: D('14-make-my-brand-hero-image.webp'), alt: 'A branded handheld fan and its packaging box on a desk beside a laptop showing the logo design.', ...HERO },
  'brand-logo-closeup': { file: 'brand-logo-closeup.webp', fallback: D('15-make-my-brand-education-image-1.webp'), alt: 'Two identical products side by side, one plain and one with a brand label and box.', ...PHOTO },
  'brand-packaging': { file: 'brand-packaging.webp', fallback: D('16-make-my-brand-education-image-2.webp'), alt: 'Hands unboxing a branded package.', ...PHOTO },
  'brand-studio': { file: 'brand-studio.webp', fallback: S('brand-consulting-1536.webp'), alt: 'An Octopus brand consultant going through colour swatches and packaging samples.', ...PHOTO },
  'share-brand': { file: 'share-brand.jpg', fallback: D('14-make-my-brand-hero-image.webp'), alt: 'Make My Brand with Octopus B2B.', ...SHARE },
  // 5. MOQ pools
  'pools-hero': { file: 'pools-hero.webp', fallback: D('18-moq-pools-hero-image.webp'), alt: 'Entrepreneurs around a table looking at one product sample together.', ...HERO },
  'pools-pallet': { file: 'pools-pallet.webp', fallback: D('20-moq-pools-education-image-2.webp'), alt: 'Stacked cartons with labels for several buyers.', ...PHOTO },
  'pools-escrow': { file: 'pools-escrow.webp', fallback: D('21-moq-pools-education-image-3.webp'), alt: 'A phone showing a pool filling up.', ...PHOTO },
  'share-pools': { file: 'share-pools.jpg', fallback: D('18-moq-pools-hero-image.webp'), alt: 'MOQ pools with Octopus B2B.', ...SHARE },
  // 6. Dropshipping
  'dropship-hero': { file: 'dropship-hero.webp', fallback: D('22-dropshipping-hero-image.webp'), alt: 'An online seller checking a store dashboard on a laptop, with packed parcels behind.', ...HERO },
  'dropship-pack': { file: 'dropship-pack.webp', fallback: S('dropshipping-1536.webp'), alt: 'A packer placing a product in a box for a single order.', ...PHOTO },
  'dropship-parcel': { file: 'dropship-parcel.webp', fallback: D('24-dropshipping-education-image-2.webp'), alt: 'A plain parcel with a customer label on a packing table.', ...PHOTO },
  'share-dropship': { file: 'share-dropship.jpg', fallback: D('22-dropshipping-hero-image.webp'), alt: 'Dropshipping with Octopus B2B.', ...SHARE },
  // 7. 3PL and logistics
  '3pl-hero': { file: '3pl-hero.webp', fallback: D('26-3pl-and-logistics-hero-image.webp'), alt: 'A warehouse aisle with tall shelves and a worker scanning a parcel.', ...HERO },
  '3pl-receive': { file: '3pl-receive.webp', fallback: S('logistics-1536.webp'), alt: 'Received stock being shelved in the warehouse.', ...PHOTO },
  '3pl-pick': { file: '3pl-pick.webp', fallback: S('3pl-service-1536.webp'), alt: 'An order being scanned before packing.', ...PHOTO },
  '3pl-weigh': { file: '3pl-weigh.webp', fallback: D('27-3pl-and-logistics-education-image-1.webp'), alt: 'A packer sealing a carton and applying a label.', ...PHOTO },
  '3pl-returns': { file: '3pl-returns.webp', fallback: S('returns-dropship-shirt-1536.webp'), alt: 'A returned product being checked.', ...PHOTO },
  'share-3pl': { file: 'share-3pl.jpg', fallback: D('26-3pl-and-logistics-hero-image.webp'), alt: '3PL and logistics with Octopus B2B.', ...SHARE },
  // 8. Turnkey
  'turnkey-hero': { file: 'turnkey-hero.webp', fallback: T('09-handover-cafe-handshake.webp'), alt: 'Project handover with a handshake at a finished café.', ...HERO },
  'turnkey-visit': { file: 'turnkey-visit.webp', fallback: D('47-turnkey-catalogue-promo-thumbnail-visit-china.webp'), alt: 'A guided factory visit in China.', ...SQUARE },
  'turnkey-container': { file: 'turnkey-container.webp', fallback: T('08-shipment-container-loading.webp'), alt: 'Pallets being checked at a shipping container.', ...PHOTO },
  'share-turnkey': { file: 'share-turnkey.jpg', fallback: D('30-turnkey-projects-overview-hero-image.webp'), alt: 'Turnkey projects from China with Octopus B2B.', ...SHARE },
  // 9. Log in and sign up
  'auth-side': { file: 'auth-side.webp', fallback: D('48-log-in-side-image.webp'), alt: 'A small-business owner smiling at a laptop in a bright workspace with product boxes.', ...PHOTO },
  'auth-side-signup': { file: 'auth-side-signup.webp', fallback: D('03-homepage-service-card-moq-pools.webp'), alt: 'Buyers looking at a product sample together.', ...PHOTO },
  // 10. About and contact
  'about-team': { file: 'about-team.webp', fallback: T('10-six-person-china-team.webp'), alt: 'The Octopus team in China.', ...HERO },
  'about-office': { file: 'about-office.webp', fallback: D('26-3pl-and-logistics-hero-image.webp'), alt: 'Inside the Octopus warehouse in Foshan.', ...PHOTO },
  'contact-office': { file: 'contact-office.webp', fallback: T('02-enquiry-showroom-reception.webp'), alt: 'Octopus staff welcoming a visitor at reception.', ...PHOTO },
} satisfies Record<string, Slot>;

export type SlotKey = keyof typeof SLOTS;

/** The owner's file when it is in public/images/design/new/, otherwise the fallback photo. */
export function siteImage(key: SlotKey, alt?: string): SiteImage {
  const s: Slot = SLOTS[key];
  const has = present.has(s.file);
  return { src: has ? `/images/design/new/${s.file}` : s.fallback, alt: alt ?? s.alt, width: s.w, height: s.h, supplied: has };
}

/** Open Graph / Twitter image for a page (1200 × 630 share file, else the page's fallback photo). */
export function shareImage(key: Extract<SlotKey, `share-${string}`>) {
  const img = siteImage(key);
  // the fallback photos are not 1200 × 630, so their size is left for the crawler to read
  return img.supplied ? { url: img.src, width: img.width, height: img.height, alt: img.alt } : { url: img.src, alt: img.alt };
}
