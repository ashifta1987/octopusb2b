/**
 * ODS T6 · My account navigation model (pure; server + client + tests). PUBLIC URLs only (never /ods/...).
 *
 * API (stable — other My account builders may import it):
 *  - `ACCOUNT_PATHS`               every My account / Shop URL the frame and Home link to
 *  - `AccountNavId`                ids of the sidebar items (also used as `current`)
 *  - `AccountServiceId`            the six services of "Your services" (sourcing, turnkey, warehouse, shipping, brand, dropship)
 *  - `ACCOUNT_SERVICES`            name + start page + My account page for each service
 *  - `accountNavCurrent(path)`     → AccountNavId | undefined   which sidebar item a public path belongs to
 *  - `bottomNavCurrent(path)`      → 'home' | 'requests' | 'orders' | 'wallet' | 'more'
 *  - `buildAccountNav(input)`      → AccountNavGroupData[]   Overview · Services · Money · Account with counts and
 *                                    "Start" flags (icons are added by the client frame: functions can't cross to the client)
 *  - `MORE_SHEET_IDS`              items of the phone "More" sheet (everything not in the bottom bar)
 */

export const ACCOUNT_PATHS = {
  home: '/account',
  action: '/account/action',
  requests: '/account/requests',
  orders: '/account/orders',
  turnkey: '/account/turnkey',
  warehouse: '/account/warehouse',
  shipping: '/account/shipping',
  brand: '/account/brand',
  dropship: '/account/dropship',
  wallet: '/account/wallet',
  invoices: '/account/invoices',
  settings: '/account/settings',
  support: '/account/support',
  notifications: '/account/notifications',
  verification: '/account/settings?tab=verification',
  companyDetails: '/account/settings?tab=company',
  /** Support › new ticket (the support builder opens the new-ticket form for ?new=1). */
  newTicket: '/account/support?new=1',
  /** Today's request flow (the New request button). */
  newRequest: '/request/sourcing',
  /** Topbar search: the requests list filters by ?q= (reference or product). */
  search: '/account/requests',
  shop: '/shop',
  browse: '/shop',
} as const;

export type AccountNavId =
  | 'home' | 'action'
  | 'requests' | 'orders' | 'turnkey' | 'warehouse' | 'shipping' | 'brand' | 'dropship'
  | 'wallet' | 'invoices'
  | 'settings' | 'support';

export type AccountServiceId = 'sourcing' | 'turnkey' | 'warehouse' | 'shipping' | 'brand' | 'dropship';

/** start = today's start page for a service that is not started yet; page = its My account page. */
export const ACCOUNT_SERVICES: Record<AccountServiceId, { name: string; start: string; page: string; nav: AccountNavId }> = {
  sourcing: { name: 'Sourcing', start: '/request/sourcing', page: ACCOUNT_PATHS.requests, nav: 'requests' },
  turnkey: { name: 'Turnkey', start: '/account/turnkey/new', page: ACCOUNT_PATHS.turnkey, nav: 'turnkey' },
  warehouse: { name: 'Warehouse (3PL)', start: '/3pl/apply', page: ACCOUNT_PATHS.warehouse, nav: 'warehouse' },
  /** Parcels and tracking come with the Warehouse (3PL) service today, so its start page is the 3PL application. */
  shipping: { name: 'Shipping', start: '/3pl/apply', page: ACCOUNT_PATHS.shipping, nav: 'shipping' },
  brand: { name: 'Make My Brand', start: '/request/brand', page: ACCOUNT_PATHS.brand, nav: 'brand' },
  dropship: { name: 'Dropshipping', start: '/account/dropship', page: ACCOUNT_PATHS.dropship, nav: 'dropship' },
};
export const ACCOUNT_SERVICE_ORDER: readonly AccountServiceId[] = ['sourcing', 'turnkey', 'warehouse', 'shipping', 'brand', 'dropship'];

export type AccountNavItemData = {
  id: AccountNavId;
  label: string;
  href: string;
  count?: number;
  notStarted?: boolean;
  /** Dropshipping sub-items (T7: buildDropshipChildren() in ./dropship-nav; empty/undefined = no sub-items). */
  children?: { id: string; label: string; href: string; count?: number; ariaLabel?: string; locked?: boolean; lockedReason?: string }[];
};
export type AccountNavGroupData = { id: 'overview' | 'services' | 'money' | 'account'; label: string; items: AccountNavItemData[] };

export type AccountNavInput = {
  counts: { action: number; requests: number; orders: number };
  /** true = the company uses this service (no "Start"). */
  started: Record<AccountServiceId, boolean>;
  dropshipChildren?: AccountNavItemData['children'];
};

export function buildAccountNav({ counts, started, dropshipChildren }: AccountNavInput): AccountNavGroupData[] {
  return [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { id: 'home', label: 'Home', href: ACCOUNT_PATHS.home },
        { id: 'action', label: 'Action needed', href: ACCOUNT_PATHS.action, count: counts.action || undefined },
      ],
    },
    {
      id: 'services',
      label: 'Services',
      items: [
        { id: 'requests', label: 'Sourcing requests', href: ACCOUNT_PATHS.requests, count: counts.requests || undefined, notStarted: !started.sourcing },
        { id: 'orders', label: 'Orders', href: ACCOUNT_PATHS.orders, count: counts.orders || undefined },
        { id: 'turnkey', label: 'Turnkey projects', href: ACCOUNT_PATHS.turnkey, notStarted: !started.turnkey },
        { id: 'warehouse', label: 'Warehouse (3PL)', href: ACCOUNT_PATHS.warehouse, notStarted: !started.warehouse },
        { id: 'shipping', label: 'Shipping', href: ACCOUNT_PATHS.shipping, notStarted: !started.shipping },
        { id: 'brand', label: 'Make My Brand', href: ACCOUNT_PATHS.brand, notStarted: !started.brand },
        {
          id: 'dropship',
          label: 'Dropshipping',
          href: ACCOUNT_PATHS.dropship,
          notStarted: !started.dropship,
          children: dropshipChildren?.length ? dropshipChildren : undefined,
        },
      ],
    },
    {
      id: 'money',
      label: 'Money',
      items: [
        { id: 'wallet', label: 'Wallet', href: ACCOUNT_PATHS.wallet },
        { id: 'invoices', label: 'Invoices', href: ACCOUNT_PATHS.invoices },
      ],
    },
    {
      id: 'account',
      label: 'Account',
      items: [
        { id: 'settings', label: 'Team and settings', href: ACCOUNT_PATHS.settings },
        { id: 'support', label: 'Support', href: ACCOUNT_PATHS.support },
      ],
    },
  ];
}

const PREFIXES: [RegExp, AccountNavId][] = [
  [/^\/account\/action(\/|$)/, 'action'],
  [/^\/account\/(requests|sourcing|rfqs|services)(\/|$)/, 'requests'],
  [/^\/account\/orders(\/|$)/, 'orders'],
  [/^\/account\/turnkey(\/|$)/, 'turnkey'],
  [/^\/account\/warehouse(\/|$)/, 'warehouse'],
  [/^\/account\/shipping(\/|$)/, 'shipping'],
  [/^\/account\/brand(\/|$)/, 'brand'],
  [/^\/account\/dropship(\/|$)/, 'dropship'],
  [/^\/account\/(wallet|ledger)(\/|$)/, 'wallet'],
  [/^\/account\/invoices(\/|$)/, 'invoices'],
  [/^\/account\/(settings|kyc|developer)(\/|$)/, 'settings'],
  [/^\/account\/support(\/|$)/, 'support'],
];

/** Sidebar item for a PUBLIC path (`/account/orders/OCT-…` → orders). Notifications etc. → undefined. */
export function accountNavCurrent(path: string | null | undefined): AccountNavId | undefined {
  const p = (path ?? '').split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (p === '/account') return 'home';
  return PREFIXES.find(([re]) => re.test(p))?.[1];
}

/** Bottom bar item for a PUBLIC path: Home · Requests · Orders · Wallet · More (everything else lives in More). */
export function bottomNavCurrent(path: string | null | undefined): 'home' | 'requests' | 'orders' | 'wallet' | 'more' | undefined {
  const id = accountNavCurrent(path);
  if (!id) return undefined;
  if (id === 'home' || id === 'requests' || id === 'orders' || id === 'wallet') return id;
  return 'more';
}

/** The phone More sheet: every sidebar item that is not in the bottom bar (+ Browse products, New request, Sign out). */
export const MORE_SHEET_IDS: readonly AccountNavId[] = ['action', 'turnkey', 'warehouse', 'shipping', 'brand', 'dropship', 'invoices', 'settings', 'support'];
