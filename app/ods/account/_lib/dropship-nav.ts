import { ALL_ON, isEarlyAccess, type DropshipFeatureKey, type DropshipFeatures } from '@/lib/dropship-features-shared';

/**
 * ODS T7 · the Dropshipping group of the My account sidebar (Part 6.6). Pure (server + client + tests). PUBLIC URLs.
 *
 * Same visibility rules as today's merchant shell (components/shell/dropship-merchant-shell.tsx + dropship-shell-switcher.tsx
 * + account-shell.tsx, left unchanged):
 *  - the group only has sub-items when today's merchant shell would be shown: dropship_v2_ui ON and a company
 *    (`v2`). OFF → no sub-items (today: AccountShell + "Coming soon");
 *  - every item is hidden while its early-access feature is off (site_settings.dropship_features → getDropshipFeatures());
 *    "Product requests" only in early access (isEarlyAccess = stores off), like the EA_Dashboard menu;
 *  - company never enabled (dropshipEverEnabled false) → "Dashboard" reads "Start dropshipping" and every other item is
 *    shown locked (aria-disabled, "Activate dropshipping"), exactly like today's locked menu;
 *  - no role filter in today's menu (each page checks the person's role itself), so none here.
 * Part 6.6 order: Dashboard · Find products · Import list · Pushed products · Orders · Pricing and sync · Packing and
 * shipping · Stores · Billing · Reports · Settings. Today's "Integrations" page belongs to Stores (same feature `stores`).
 * Wallet and Support stay in the group (T7 decision): today's Dropship wallet adds the Dropship order-payment panel
 * (Held for protected orders, How new orders are paid) and Dropship support links tickets to store orders — neither is on
 * Money › Wallet / Account › Support yet, so their accessible names say "Dropshipping wallet" / "Dropshipping support".
 */

export type DropshipNavKey =
  | 'dashboard' | 'find' | 'requests' | 'import_list' | 'pushed' | 'orders' | 'pricing' | 'packing' | 'stores'
  | 'billing' | 'reports' | 'settings' | 'wallet' | 'support';

type Def = { key: DropshipNavKey; label: string; href: string; feature: DropshipFeatureKey; earlyAccessOnly?: boolean; ariaLabel?: string };

export const DROPSHIP_HOME = '/account/dropship';

export const DROPSHIP_NAV: readonly Def[] = [
  { key: 'dashboard', label: 'Dashboard', href: DROPSHIP_HOME, feature: 'dashboard' },
  { key: 'find', label: 'Find products', href: '/account/dropship/catalogue', feature: 'find' },
  { key: 'requests', label: 'Product requests', href: '/account/dropship/requests', feature: 'requests', earlyAccessOnly: true },
  { key: 'import_list', label: 'Import list', href: '/account/dropship/catalogue?list=1', feature: 'import_list' },
  { key: 'pushed', label: 'Pushed products', href: '/account/dropship/pushed', feature: 'pushed' },
  { key: 'orders', label: 'Orders', href: '/account/dropship/orders', feature: 'orders' },
  { key: 'pricing', label: 'Pricing and sync', href: '/account/dropship/pricing', feature: 'pricing' },
  { key: 'packing', label: 'Packing and shipping', href: '/account/dropship/packing', feature: 'packing' },
  { key: 'stores', label: 'Stores', href: '/account/dropship/stores', feature: 'stores' },
  { key: 'billing', label: 'Billing', href: '/account/dropship/billing', feature: 'billing' },
  { key: 'reports', label: 'Reports', href: '/account/dropship/reports', feature: 'reports' },
  { key: 'settings', label: 'Settings', href: '/account/dropship/settings', feature: 'settings' },
  { key: 'wallet', label: 'Wallet', href: '/account/dropship/wallet', feature: 'wallet', ariaLabel: 'Dropshipping wallet' },
  { key: 'support', label: 'Support', href: '/account/dropship/support', feature: 'support', ariaLabel: 'Dropshipping support' },
];

export const DROPSHIP_LOCKED_REASON = 'Activate dropshipping';

/** One sub-item of the Dropshipping group (ids are `ds-<key>` so they never clash with the main sidebar ids). */
export type DropshipNavChild = {
  id: `ds-${DropshipNavKey}`;
  key: DropshipNavKey;
  label: string;
  href: string;
  ariaLabel?: string;
  locked?: boolean;
  lockedReason?: string;
};

export type DropshipNavInput = {
  /** dropship_v2_ui ON and the person has a company (today's v2ShellEnabled). */
  v2: boolean;
  /** dropshipEverEnabled(company_services.dropship) (today's dropshipEnabled). */
  enabled: boolean;
  features?: DropshipFeatures;
};

export function buildDropshipChildren({ v2, enabled, features = ALL_ON }: DropshipNavInput): DropshipNavChild[] {
  if (!v2) return [];
  const ea = isEarlyAccess(features);
  return DROPSHIP_NAV.filter((d) => features[d.feature] && (!d.earlyAccessOnly || ea)).map((d) => {
    const home = d.key === 'dashboard';
    const child: DropshipNavChild = { id: `ds-${d.key}`, key: d.key, label: home && !enabled ? 'Start dropshipping' : d.label, href: d.href };
    if (d.ariaLabel) child.ariaLabel = d.ariaLabel;
    if (!enabled && !home) {
      child.locked = true;
      child.lockedReason = DROPSHIP_LOCKED_REASON;
    }
    return child;
  });
}

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);

/**
 * Which Dropshipping sub-item a PUBLIC path belongs to — today's isMerchantItemActive() rules, plus: Integrations →
 * Stores, the product editor (/import/<id>) and Push to store → Import list (today these pages had no current item).
 * `children` = the visible sub-items: a key that is not visible (feature off / locked) → undefined, so the frame marks
 * the Dropshipping item itself as current.
 */
export function dropshipNavCurrent(
  path: string | null | undefined,
  search: string | URLSearchParams | null | undefined,
  children: readonly DropshipNavChild[],
): DropshipNavChild['id'] | undefined {
  const p = (path ?? '').split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (!under(p, DROPSHIP_HOME) || !children.length) return undefined;
  const q = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : search ?? new URLSearchParams();
  const list = q.get('list') === '1';
  const visible = new Set(children.filter((c) => !c.locked).map((c) => c.key));
  const ea = visible.has('requests');
  const pick = (k: DropshipNavKey) => (visible.has(k) ? (`ds-${k}` as const) : undefined);

  if (ea && under(p, '/account/dropship/requests')) return pick('requests');
  if (p === '/account/dropship/catalogue' && list) return pick('import_list');
  if (under(p, '/account/dropship/import') || under(p, '/account/dropship/push')) return pick('import_list');
  if (
    p === '/account/dropship/catalogue' ||
    p.startsWith('/account/dropship/catalogue/') ||
    p === '/account/dropship/landed-cost' ||
    p === '/account/dropship/requests' ||
    p === '/account/dropship/sample'
  ) return pick('find');
  if (p === DROPSHIP_HOME || p === '/account/dropship/onboarding') return pick('dashboard');
  if (under(p, '/account/dropship/integrations')) return pick('stores');
  const hit = DROPSHIP_NAV.find((d) => d.key !== 'dashboard' && !d.href.includes('?') && under(p, d.href));
  return hit ? pick(hit.key) : undefined;
}
