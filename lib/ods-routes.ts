/**
 * ODS T3: which public URLs the new theme serves, and the old URLs that move. Pure (proxy.ts + unit tests).
 *
 * When the ods_theme_v1 switch is on for a visitor, proxy.ts REWRITES these public URLs to the ODS route tree under
 * app/ods/* (the browser keeps the public URL). When it is off, nothing is rewritten and today's pages answer exactly as
 * before. The internal /ods/* paths are never served directly (proxy answers 404).
 */
export const ODS_INTERNAL = '/ods';

/** /services/<name> pages (Part 3.1). Turnkey keeps /turnkey (owner decision D4) and gets the ODS service layout there. */
export const ODS_SERVICE_PAGES = ['sourcing', 'pools', 'dropship', 'warehouse', 'brand'] as const;
export type OdsServicePage = (typeof ODS_SERVICE_PAGES)[number] | 'turnkey';
/** Legal pages with the ODS document layout. Other /legal/* slugs (e.g. group-buy) keep today's pages. */
export const ODS_LEGAL_PAGES = ['terms', 'privacy', 'cookies', 'refunds'] as const;
const INFO_PAGES = ['/how-it-works', '/shipping', '/help'];

/** Public URL → internal ODS path, or null when the ODS theme has no page for it. */
export function odsRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p === '/') return ODS_INTERNAL;
  if (p === '/login' || p === '/signup') return `${ODS_INTERNAL}/login`;
  if (p === '/turnkey') return `${ODS_INTERNAL}/turnkey`;
  if (INFO_PAGES.includes(p)) return `${ODS_INTERNAL}${p}`;
  if (p === '/welcome/setup') return `${ODS_INTERNAL}/welcome/setup`;
  let m = p.match(/^\/services\/([a-z]+)$/);
  if (m && (ODS_SERVICE_PAGES as readonly string[]).includes(m[1])) return `${ODS_INTERNAL}/services/${m[1]}`;
  m = p.match(/^\/legal\/([a-z]+)$/);
  if (m && (ODS_LEGAL_PAGES as readonly string[]).includes(m[1])) return `${ODS_INTERNAL}/legal/${m[1]}`;
  m = p.match(/^\/invite\/([A-Za-z0-9_-]{1,128})$/);
  if (m) return `${ODS_INTERNAL}/invite/${m[1]}`;
  return null;
}

/**
 * URLs that only exist in the ODS theme. With the switch off:
 *   /welcome/setup → /onboarding (today's profile form, query kept), /invite/<token> → the Dropship team join page;
 *   /services/*, /how-it-works, /shipping, /help → no rewrite, so the normal 404.
 */
export function odsOffFallback(path: string): string | null {
  if (path === '/welcome/setup') return '/onboarding';
  if (/^\/invite\/[^/]+$/.test(path)) return '/account/dropship/join';
  return null;
}

/** Old service landing pages → /services/* (308), only when the switch is "all" (owner-approved renames, audit C11). */
const LEGACY: Record<string, string> = {
  '/sourcing': '/services/sourcing',
  '/pools': '/services/pools',
  '/3pl': '/services/warehouse',
  '/make-my-brand': '/services/brand',
};
export function odsLegacyRedirect(path: string): string | null {
  return LEGACY[path.length > 1 ? path.replace(/\/+$/, '') : path] ?? null;
}

/** Direct requests to the internal tree are refused (404). */
export const isOdsInternalPath = (path: string) => path === ODS_INTERNAL || path.startsWith(`${ODS_INTERNAL}/`);

/* ───────── T4 · Shop (tab 2) ───────── */

/**
 * /shop/* on the ODS theme (area "shop": beta companies apply here). Everything under /shop is served from app/ods/shop
 * except the CH-1 quote list (/shop/quote-list), which stays until the T5 cart replaces it. New-only pages
 * (/shop/dropship, /warehouse, /brand, /search, /pools/<id>, /turnkey/<slug>[/start]) simply 404 with the switch off.
 */
export function odsShopRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p !== '/shop' && !p.startsWith('/shop/')) return null;
  if (p === '/shop/quote-list' || p.startsWith('/shop/quote-list/')) return null;
  if (!/^\/shop(\/[A-Za-z0-9._~-]+)*$/.test(p)) return null;
  if (p.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  return `${ODS_INTERNAL}${p}`;
}
/** /shop/all → /shop (Part 3.3), on the ODS theme. */
export const ODS_SHOP_REDIRECTS: Record<string, string> = { '/shop/all': '/shop' };
