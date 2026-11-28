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
 * /shop/* on the ODS theme (area "shop": beta companies apply here). Everything under /shop is served from app/ods/shop.
 * T5a: the CH-1 quote list (/shop/quote-list) is the cart's "Get a quote" tab → 308 /shop/cart?tab=quote. New-only pages
 * (/shop/dropship, /warehouse, /brand, /search, /pools/<id>, /turnkey/<slug>[/start]) simply 404 with the switch off.
 */
export function odsShopRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p !== '/shop' && !p.startsWith('/shop/')) return null;
  if (!/^\/shop(\/[A-Za-z0-9._~-]+)*$/.test(p)) return null;
  if (p.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  return `${ODS_INTERNAL}${p}`;
}
/** On the ODS theme: /shop/all → /shop (Part 3.3); /shop/quote-list → the cart's Get a quote tab (T5a, audit C3). */
export const ODS_SHOP_REDIRECTS: Record<string, string> = { '/shop/all': '/shop', '/shop/quote-list': '/shop/cart?tab=quote' };

/* ───────── T6 · My account (tab 3) ───────── */

/**
 * /account pages that have an ODS version (area "account": beta companies apply). Only these are rewritten to app/ods/account;
 * every other /account page (ledger, notifications, assistant, developer, pools, turnkey/new, dropship/* until T7 …) keeps
 * today's page for now.
 */
const ACCOUNT_ODS: RegExp[] = [
  /^\/account$/,
  /^\/account\/action$/,
  /^\/account\/requests(\/[A-Za-z0-9-]{1,40})?$/,
  /^\/account\/orders(\/[A-Za-z0-9-]{1,64})?$/,
  /^\/account\/wallet$/,
  /^\/account\/invoices$/,
  /^\/account\/turnkey(\/TKP-\d{5,})?$/,
  /^\/account\/warehouse$/,
  /^\/account\/shipping$/,
  /^\/account\/brand$/,
  /^\/account\/settings$/,
  /^\/account\/support(\/[0-9a-fA-F-]{36})?$/,
];
export function odsAccountRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return ACCOUNT_ODS.some((re) => re.test(p)) ? `${ODS_INTERNAL}${p}` : null;
}

/** Renamed My account pages (audit C11), for visitors on the ODS theme: old URL → new URL (308, query kept). */
export function odsAccountRedirect(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p === '/account/sourcing' || p === '/account/rfqs' || p === '/account/services') return '/account/requests';
  const m = p.match(/^\/account\/sourcing\/([A-Za-z0-9-]{1,40})$/);
  if (m) return `/account/requests/${m[1]}`;
  if (p === '/account/kyc') return '/account/settings?tab=verification';
  return null;
}

/** New-only My account URLs with the switch OFF → today's equivalent page (so links from anywhere keep working). */
export function odsAccountOffFallback(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p === '/account/action') return '/account#waiting';
  if (p === '/account/requests') return '/account/sourcing';
  const m = p.match(/^\/account\/requests\/([A-Za-z0-9-]{1,40})$/);
  if (m) return `/account/sourcing/${m[1]}`;
  if (p === '/account/settings') return '/account/kyc';
  if (p === '/account/shipping') return '/account/warehouse';
  return null;
}

/**
 * Today's warehouse portal tools (/account/warehouse?tab=send|orders|returns|…) have no ODS version yet: those tab URLs keep
 * today's page (the ODS warehouse page uses stock|inbound|outbound|fees and links to these tools).
 */
const LEGACY_WAREHOUSE_TABS = new Set(['send', 'orders', 'returns', 'integrations', 'support', 'inventory', 'invoices', 'overview']);
export function odsAccountKeepsLegacy(path: string, search: URLSearchParams): boolean {
  return path === '/account/warehouse' && LEGACY_WAREHOUSE_TABS.has(search.get('tab') ?? '');
}

/* ───────── T7 · Dropshipping inside My account ───────── */

/** Route handlers under /account/dropship (CSV / file exports) are never rewritten: they answer the same on both themes. */
const DROPSHIP_ROUTE_HANDLERS = new Set(['/account/dropship/export', '/account/dropship/export/csv', '/account/dropship/reports/csv', '/account/dropship/integrations/file/export']);

/**
 * /account/dropship pages on the ODS theme: served from app/ods/account/dropship/*, which re-exports TODAY's page modules
 * (same content, states, rules and test ids) inside the ODS My account frame (Dropshipping = a sidebar group, Part 6.6).
 */
export function odsDropshipRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p !== '/account/dropship' && !p.startsWith('/account/dropship/')) return null;
  if (DROPSHIP_ROUTE_HANDLERS.has(p)) return null;
  if (!/^\/account\/dropship(\/[A-Za-z0-9._~-]+)*$/.test(p) || p.split('/').some((s) => s === '.' || s === '..')) return null;
  return `${ODS_INTERNAL}${p}`;
}

/* ───────── T8 · Back Office (staff, compact) ───────── */

/** Staff route handlers (CSV / file exports, templates) are never rewritten. */
const OFFICE_ROUTE_HANDLERS: RegExp[] = [
  /^\/office\/dropship\/docs\/file\/[^/]+$/,
  /^\/office\/dropship\/requests\/export$/,
  /^\/office\/dropship\/import\/template$/,
  /^\/office\/dropship\/invoicing\/csv$/,
  /^\/office\/warehouse\/reports\/csv$/,
  /^\/admin\/turnkey\/reports\/export$/,
  /^\/admin\/finance\/export$/,
  /^\/admin\/import\/template$/,
  /^\/admin\/geography\/export$/,
];
/**
 * Back Office pages (/office/* and /admin/*, both kept as base paths — audit C5) on the ODS theme: served from
 * app/ods/office/* and app/ods/admin/*, which re-export today's page modules (T8) inside the compact ODS shell, until T9
 * replaces a page with its ODS version.
 */
export function odsOfficeRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (!/^\/(office|admin)(\/[A-Za-z0-9._~-]+)*$/.test(p) || p.split('/').some((s) => s === '.' || s === '..')) return null;
  if (OFFICE_ROUTE_HANDLERS.some((re) => re.test(p))) return null;
  return `${ODS_INTERNAL}${p}`;
}

/** Staff sign-in pages (/staff, /staff/login, /verify, /forgot, /set-password, /account, /workspace) on the ODS theme. */
export function odsStaffRewritePath(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return /^\/staff(\/(login|verify|forgot|set-password|account|workspace))?$/.test(p) ? `${ODS_INTERNAL}${p}` : null;
}
