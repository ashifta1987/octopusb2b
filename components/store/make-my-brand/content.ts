/**
 * ADDON-44-D — Make My Brand shared content (home section 2 and /make-my-brand).
 * Copy is CMS-overridable (content_blocks `mmb.*`). Numbers come ONLY from site_settings:
 *   brand.methods      JSON { pad|laser|uv|box|inserts: { moq?: number, days?: string } }   → "To be confirmed" when empty
 *   brand.am_reply_hours  number                                                          → hidden when empty
 *   brand.example_qty  JSON { F8|G1000|S7: number }                                       → quantity row hidden when empty
 *   demo.addon44       true on staging while demo values are loaded → EXAMPLE pills on those numbers
 * Images in /public/mmb are kit artwork, always shown with the Studio preview label.
 */
import type { IconName, Step } from '@/components/ds';

type Settings = Record<string, unknown>;

/** Where "Start a brand project" goes (ADDON-44-F wizard). */
export const BRAND_START_HREF = '/request/brand';
export const BRAND_PAGE_HREF = '/make-my-brand';

export const MMB_STEPS: Step[] = [
  { title: 'Pick a verified product', body: 'Choose from products Octopus lists directly, all from suppliers we have verified.', tag: 'You' },
  { title: 'Add your brand', body: 'You send your logo and pick a branding method. We prepare the artwork proof and your quote.', tag: 'You' },
  { title: 'Approve proof and sample', body: 'You approve the proof, then a physical sample, and accept the quote before you pay.', tag: 'You' },
  { title: 'We produce and check', body: 'The factory produces your order and we inspect it against the approved sample.', tag: 'Octopus' },
  { title: 'Stocked in our warehouse', body: 'Your branded goods are kept as your stock in the Octopus warehouse.', tag: 'Octopus' },
  { title: 'Shipped worldwide', body: 'Send stock in bulk to one country, or ship order by order from your online store.', tag: 'Octopus' },
];
/** Short version for the home page cards. */
export const MMB_STEPS_SHORT: Step[] = [
  { title: 'Pick a verified product', body: 'Only products Octopus lists directly.' },
  { title: 'Add your brand', body: 'Logo print, engraving or a branded box.' },
  { title: 'Approve proof and sample', body: 'Nothing is made until you approve both.' },
  { title: 'We produce and check', body: 'The factory makes it and we run QC.' },
  { title: 'Stocked in our warehouse', body: 'Kept as your stock, ready to ship.' },
  { title: 'Shipped worldwide', body: 'In bulk, or order by order from your store.' },
];

export type BrandMethod = { key: string; name: string; body: string; icon: IconName; moq: number | null; days: string | null };
const METHODS: Omit<BrandMethod, 'moq' | 'days'>[] = [
  { key: 'pad', name: 'Pad or silk print', body: 'Your logo printed in one or more colours on the product surface.', icon: 'tag' },
  { key: 'laser', name: 'Laser engraving', body: 'A permanent mark cut into metal, wood or hard plastic.', icon: 'shield' },
  { key: 'uv', name: 'UV print', body: 'Full-colour artwork printed directly onto the product.', icon: 'doc' },
  { key: 'box', name: 'Branded colour box', body: 'Retail packaging printed with your brand, artwork and product details.', icon: 'box' },
  { key: 'inserts', name: 'Inserts and manuals', body: 'Thank-you cards, warranty cards and user manuals in your name.', icon: 'doc' },
];
function obj(v: unknown): Record<string, Record<string, unknown>> {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return v && typeof v === 'object' ? (v as Record<string, Record<string, unknown>>) : {};
}
export function brandMethods(settings: Settings): BrandMethod[] {
  const s = obj(settings['brand.methods']);
  return METHODS.map((m) => {
    const v = s[m.key] ?? {};
    const moq = Number(v.moq);
    return { ...m, moq: Number.isFinite(moq) && moq > 0 ? moq : null, days: typeof v.days === 'string' && v.days.trim() ? v.days.trim() : null };
  });
}
export function replyHours(settings: Settings): number | null {
  const n = Number(settings['brand.am_reply_hours']);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function exampleQty(settings: Settings, key: string): number | null {
  const n = Number((obj(settings['brand.example_qty']) as unknown as Record<string, unknown>)[key]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export const isDemo = (settings: Settings) => settings['demo.addon44'] === true;

export const EXAMPLES = [
  { key: 'F8', src: '/mmb/F8.jpg', product: 'Handheld fan F8', method: 'Pad print + colour box', alt: 'Handheld fan with the example brand Nova Breeze' },
  { key: 'G1000', src: '/mmb/G1000.jpg', product: 'Neck fan G1000', method: 'UV print', alt: 'Neck fan with the example brand Nova Breeze' },
  { key: 'S7', src: '/mmb/S7.jpg', product: 'Aroma diffuser S7', method: 'Laser engraving + inserts', alt: 'Aroma diffuser with the example brand Nova Breeze' },
] as const;
export const EXAMPLE_BRAND = 'Nova Breeze';

/** Spec [21] example quote — always labelled EXAMPLE. Amounts in US cents. */
export const EXAMPLE_QUOTE = {
  rows: [
    ['Product', 'Handheld fan F8 for your brand', 1731000],
    ['Branding', 'Pad print logo on each unit', 36000],
    ['Packaging', 'Branded colour box', 126000],
    ['Sample', 'Branded sample for your approval', 16000],
    ['Inspection', 'QC inspection before goods leave the factory', 4500],
  ] as [string, string, number][],
  total: 1913500,
  deposit: 574050,
  balance: 1339450,
};

export const SHIPPING_SERVICES = ['Express', 'Standard', 'Economy', 'DDP Gulf', 'DDP US', 'DDP UK'];

export const usd = (cents: number) => `US$ ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtInt = (n: number) => n.toLocaleString('en-US');
