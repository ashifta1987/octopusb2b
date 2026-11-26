/**
 * Release 1 · EA-2: merchant feature keys, labels and the routes each one owns. Shared by server code (route guard,
 * dashboard) and client code (sidebar, phone tabs, More page). Turning a feature on needs no layout change.
 */
export type DropshipFeatureKey =
  | 'dashboard' | 'find' | 'product_detail' | 'landed_cost' | 'requests' | 'wallet' | 'settings' | 'support'
  | 'stores' | 'import_list' | 'pushed' | 'pricing' | 'packing' | 'orders' | 'reports' | 'billing' | 'samples';

export type DropshipFeatures = Record<DropshipFeatureKey, boolean>;

export const DROPSHIP_FEATURES: { key: DropshipFeatureKey; label: string; routes: string[]; locked?: boolean }[] = [
  { key: 'dashboard', label: 'Dashboard', routes: [], locked: true },
  { key: 'find', label: 'Find products', routes: ['/account/dropship/catalogue'] },
  { key: 'product_detail', label: 'Product detail', routes: [] },
  { key: 'landed_cost', label: 'Landed cost calculator', routes: ['/account/dropship/landed-cost'] },
  { key: 'requests', label: 'Product requests', routes: ['/account/dropship/requests'] },
  { key: 'wallet', label: 'Wallet', routes: ['/account/dropship/wallet'], locked: true },
  { key: 'settings', label: 'Settings (basic)', routes: ['/account/dropship/settings'] },
  { key: 'support', label: 'Support', routes: ['/account/dropship/support'], locked: true },
  { key: 'stores', label: 'Stores and integrations', routes: ['/account/dropship/stores', '/account/dropship/integrations'] },
  { key: 'import_list', label: 'Import list', routes: ['/account/dropship/import', '/account/dropship/push'] },
  { key: 'pushed', label: 'Pushed products', routes: ['/account/dropship/pushed'] },
  { key: 'pricing', label: 'Pricing and sync', routes: ['/account/dropship/pricing'] },
  { key: 'packing', label: 'Packing and shipping', routes: ['/account/dropship/packing'] },
  { key: 'orders', label: 'Orders', routes: ['/account/dropship/orders'] },
  { key: 'reports', label: 'Reports', routes: ['/account/dropship/reports'] },
  { key: 'billing', label: 'Plan and billing', routes: ['/account/dropship/billing'] },
  { key: 'samples', label: 'Sample orders', routes: ['/account/dropship/sample'] },
];

/** The early-access set: what a missing setting means (live-safe). */
export const EARLY_ACCESS_DEFAULTS: DropshipFeatures = {
  dashboard: true, find: true, product_detail: true, landed_cost: true, requests: true, wallet: true, settings: true, support: true,
  stores: false, import_list: false, pushed: false, pricing: false, packing: false, orders: false, reports: false, billing: false, samples: false,
};

export const ALL_ON: DropshipFeatures = Object.fromEntries(DROPSHIP_FEATURES.map((f) => [f.key, true])) as DropshipFeatures;

/** Which feature owns a merchant path (and ?list=1 for the import list). null = always available (dashboard, onboarding, more, export). */
export function featureForPath(path: string, search?: URLSearchParams | null): DropshipFeatureKey | null {
  const p = path.split('?')[0].replace(/\/$/, '');
  const query = search ?? new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
  if (p === '/account/dropship/catalogue' && query.get('list') === '1') return 'import_list';
  if (p.startsWith('/account/dropship/catalogue/')) return 'product_detail';
  for (const f of DROPSHIP_FEATURES) {
    if (f.routes.some((r) => p === r || p.startsWith(r + '/'))) return f.key;
  }
  return null;
}

/** Early access = store connection not released yet (the design's EA_Dashboard version). */
export const isEarlyAccess = (f: DropshipFeatures) => !f.stores;
