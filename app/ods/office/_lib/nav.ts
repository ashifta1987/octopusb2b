/**
 * ODS T8 · Back Office navigation model (Part 7.1 sidebar, app switcher, + New, palette "Go to", G shortcuts). Pure:
 * no React, no server imports — used by the client frame, the server loader and tests/unit/ods-office-shell.test.ts.
 *
 * Every item points at TODAY's /office or /admin route (audit C5 + Appendix A.6–A.7: both base paths stay; no renames).
 * Visibility repeats today's rules exactly (StaffShell `work` + OFFICE_NAV areas + the dropship / rates / SaaS flags the
 * staff layout computes): an item the person can't open is HIDDEN — not rendered and not offered in the palette.
 * The pages still run their own requireStaff(area, action) guards; hiding is only the menu.
 *
 * ODS items that have no page yet (Invoices, Credit notes, Ledger, Audit log, My work as a grid, /office/quotes …) are
 * not listed: T9 adds them. Today's pages without an ODS menu place keep their own item, in the group the audit names.
 */

export type OfficePerms = {
  isAdmin: boolean;
  roles: string[];
  /** "area:action" strings (Session.permissions as an array, so it crosses the server → client boundary). */
  permissions: string[];
  /** Today's StaffShell: admin, finance:view, support:edit or a Dropship (DS) division member. */
  canOpenDropship: boolean;
  /** Today's staff layout (EA-1): rate cards follow step6b_rate_card_read. */
  canSeeRates: boolean;
  /** canOpenDropship or a 3PL & Shipping division member. */
  canSeeFeesDuty: boolean;
  /** Admin or a DS division manager / staff member. */
  canEditDropship: boolean;
  /** Admin or finance:view (Finance: SaaS billing). */
  canSeeSaas: boolean;
  /** Warehouse OS W7: works in a warehouse (wh_my_warehouses). */
  warehouseMember: boolean;
  /** dropship_v2_ui switch (today the Dropship staff menu only exists with it on). */
  dropshipV2Ui: boolean;
};

export type CountKey = 'queue' | 'approvals' | 'transfers' | 'moderation' | 'unread';
export type OfficeCounts = Partial<Record<CountKey, number | null>>;

export type IconKey =
  | 'dashboard' | 'inbox' | 'check' | 'users' | 'id' | 'file' | 'quote' | 'cart' | 'briefcase' | 'help' | 'bot'
  | 'pools' | 'layers' | 'clipboard' | 'sparkle' | 'truck' | 'package' | 'send'
  | 'chart' | 'pause' | 'wallet' | 'credit' | 'bank' | 'ageing' | 'report' | 'card'
  | 'box' | 'upload' | 'tags' | 'hash' | 'factory'
  | 'globe' | 'megaphone'
  | 'shield' | 'settings' | 'coins' | 'map' | 'building' | 'split' | 'plug' | 'database' | 'bell' | 'user';

export type NavRule = (p: OfficePerms) => boolean;

export type OfficeNavDef = {
  id: string;
  label: string;
  href: string;
  icon: IconKey;
  /** Who may open it (today's rule). */
  allow: NavRule;
  count?: CountKey;
  /** Path prefixes that make this item current (default: the href's path). `exact` = only that path. */
  match?: string[];
  exact?: boolean;
  /** "G then <key>" in the palette and on the keyboard. */
  g?: string;
  keywords?: string[];
};

export type OfficeGroupDef = { id: string; label: string; items: OfficeNavDef[] };

/* ───────── rules ───────── */

export const can = (p: OfficePerms, area: string, action = 'view') => p.isAdmin || p.permissions.includes(`${area}:${action}`);
export const isManager = (p: OfficePerms) => p.roles.includes('account_manager');
const area = (a: string, action = 'view'): NavRule => (p) => can(p, a, action);
const adminOnly: NavRule = (p) => p.isAdmin;
const anyStaff: NavRule = () => true;
/** StaffShell: `seesCustomers = can(customers:view) || account manager`. */
const seesCustomers: NavRule = (p) => can(p, 'customers') || isManager(p);

/** Dashboard = today's /office Queues (dashboard:view); people without it (e.g. account managers) land on /admin. */
export const dashboardHref = (p: OfficePerms) => (can(p, 'dashboard') ? '/office' : '/admin');

/* ───────── sidebar (Part 7.1 order, today's routes) ───────── */

export const TOP_ITEMS: OfficeNavDef[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/office', icon: 'dashboard', allow: anyStaff, exact: true, g: 'D', keywords: ['queues', 'home'] },
  // ODS T9: My work is the grid page /office/my-work (today's work queue, same guard as /admin); /admin stays today's page
  // and keeps this item current.
  {
    id: 'my-work', label: 'My work', href: '/office/my-work', icon: 'inbox', allow: anyStaff, count: 'queue', exact: true, match: ['/office/my-work', '/admin'],
    g: 'W', keywords: ['work queue', 'tasks'],
  },
  // ODS T9: the ONE approvals home /office/approvals (money approvals for Finance + a link to today's price approvals,
  // /admin/approvals, which stays reachable and keeps this item current). Who sees it: today's /admin/approvals rule
  // (admin, account manager, approvals:view) or Finance (finance:view), the page's own guard.
  {
    id: 'approvals', label: 'Approvals', href: '/office/approvals', icon: 'check', count: 'approvals', g: 'A', match: ['/office/approvals', '/admin/approvals'],
    allow: (p) => p.isAdmin || isManager(p) || can(p, 'approvals') || can(p, 'finance'), keywords: ['approve', 'limits', 'price approvals', 'second approver'],
  },
];

export const NAV_GROUPS: OfficeGroupDef[] = [
  {
    id: 'sales', label: 'Sales', items: [
      { id: 'customers', label: 'Customers', href: '/admin/customers', icon: 'users', allow: seesCustomers, g: 'C', keywords: ['companies', 'buyers'] },
      { id: 'kyc', label: 'KYC review', href: '/office/kyc', icon: 'id', allow: area('customers'), keywords: ['verification', 'kyc'] },
      { id: 'rfqs', label: 'Sourcing requests', href: '/office/rfqs', icon: 'file', allow: area('requests'), g: 'R', keywords: ['rfq', 'rfqs'] },
      // Quotes are made and listed on the sourcing request (no quotes page yet — T9 adds /office/quotes)
      { id: 'quotes', label: 'Quotes', href: '/office/rfqs?f=to_quote', icon: 'quote', allow: area('requests'), match: [], g: 'Q', keywords: ['quote', 'to quote'] },
      { id: 'orders', label: 'Orders', href: '/office/orders', icon: 'cart', allow: area('orders'), g: 'O', keywords: ['order', 'ord'] },
      { id: 'services', label: 'Service requests', href: '/office/services', icon: 'briefcase', allow: area('requests'), keywords: ['samples', 'qc', 'audit'] },
      { id: 'support', label: 'Support desk', href: '/office/support', icon: 'help', allow: area('support'), keywords: ['tickets', 'complaints'] },
      { id: 'assistant-queue', label: 'Assistant queue', href: '/office/assistant', icon: 'bot', allow: area('assistant') },
    ],
  },
  {
    id: 'services', label: 'Services', items: [
      { id: 'pools', label: 'MOQ pools', href: '/admin/pools', icon: 'pools', allow: area('orders'), g: 'P', keywords: ['group buying', 'pools'] },
      { id: 'turnkey', label: 'Turnkey projects', href: '/admin/turnkey', icon: 'layers', allow: area('turnkey'), g: 'T' },
      { id: 'inspections', label: 'My inspections', href: '/office/turnkey/inspect', icon: 'clipboard', allow: area('turnkey_qc', 'edit'), keywords: ['turnkey qc'] },
      { id: 'brand', label: 'Make My Brand', href: '/admin/brand-projects', icon: 'sparkle', allow: seesCustomers, keywords: ['brand projects'] },
      { id: 'dropship', label: 'Dropshipping', href: '/office/dropship', icon: 'truck', allow: (p) => p.canOpenDropship, g: 'S', keywords: ['dropship catalogue'] },
      // B2B shipments has its own item (Shipping), so it is excluded from Warehouse (longest match wins)
      { id: 'warehouse', label: 'Warehouse (3PL)', href: '/office/warehouse', icon: 'package', allow: area('warehouse'), g: 'H', keywords: ['warehouse os', '3pl'] },
      { id: 'shipping', label: 'Shipping', href: '/office/warehouse/b2b-shipments', icon: 'send', allow: area('orders'), keywords: ['b2b shipments'] },
    ],
  },
  {
    id: 'accounts', label: 'Accounts', items: [
      // ODS T9: Accounts › Invoices (Part 7.4, new ODS page; Finance viewers, like today's receivables)
      { id: 'invoices', label: 'Invoices', href: '/office/accounts/invoices', icon: 'file', allow: area('finance'), g: 'I', keywords: ['invoice', 'record payment', 'receivables'] },
      { id: 'finance', label: 'Finance overview', href: '/admin/finance', icon: 'chart', allow: area('finance'), exact: true, g: 'F', keywords: ['payments', 'record payment', 'invoices'] },
      { id: 'holds', label: 'Held payments', href: '/admin/finance/holds', icon: 'pause', allow: area('finance'), keywords: ['payment protection'] },
      { id: 'wallets', label: 'Wallets', href: '/admin/wallet', icon: 'wallet', allow: area('wallet'), g: 'L', keywords: ['top-ups'] },
      { id: 'credit', label: 'Credit terms', href: '/admin/finance/credit', icon: 'credit', allow: area('finance') },
      { id: 'bank', label: 'Bank reconciliation', href: '/admin/finance/transfers', icon: 'bank', count: 'transfers', allow: area('wallet', 'approve'), keywords: ['bank transfers'] },
      { id: 'receivables', label: 'Receivables and ageing', href: '/admin/finance/receivables', icon: 'ageing', allow: area('finance') },
      { id: 'reports', label: 'Financial reports', href: '/admin/reports', icon: 'report', allow: area('dashboard'), exact: true, keywords: ['reports'] },
      { id: 'saas', label: 'SaaS billing', href: '/admin/finance/saas', icon: 'card', allow: (p) => p.canSeeSaas },
    ],
  },
  {
    id: 'catalogue', label: 'Catalogue', items: [
      { id: 'products', label: 'Products', href: '/office/products', icon: 'box', count: 'moderation', allow: area('products', 'approve'), g: 'M', keywords: ['moderation'] },
      { id: 'import', label: 'Bulk import', href: '/admin/import', icon: 'upload', allow: area('products', 'edit') },
      { id: 'catalog', label: 'Categories and tags', href: '/admin/catalog', icon: 'tags', allow: area('catalog') },
      { id: 'hs-codes', label: 'HS codes', href: '/admin/hs-codes', icon: 'hash', allow: area('products', 'approve') },
      { id: 'suppliers', label: 'Suppliers', href: '/admin/suppliers', icon: 'factory', allow: area('suppliers'), g: 'U' },
    ],
  },
  {
    id: 'website', label: 'Website', items: [
      { id: 'content', label: 'Pages and banners', href: '/admin/content', icon: 'globe', allow: area('content'), keywords: ['site content', 'cms'] },
      { id: 'ads', label: 'Advertising', href: '/admin/ads', icon: 'megaphone', allow: area('ads') },
    ],
  },
  {
    id: 'admin', label: 'Admin', items: [
      { id: 'staff', label: 'Users and roles', href: '/admin/staff', icon: 'shield', allow: area('staff'), keywords: ['staff'] },
      { id: 'payment-settings', label: 'Payment settings', href: '/admin/settings/payment', icon: 'settings', allow: area('finance', 'edit'), keywords: ['bank details'] },
      { id: 'dropship-settings', label: 'Dropship features', href: '/admin/settings/dropship', icon: 'settings', allow: area('staff', 'edit') },
      { id: 'currency', label: 'Currency', href: '/admin/currency', icon: 'coins', allow: area('finance') },
      { id: 'geography', label: 'Geography', href: '/admin/geography', icon: 'map', allow: area('customers') },
      { id: 'service-charges', label: 'Services and charges', href: '/admin/services', icon: 'settings', allow: area('services') },
      { id: 'company', label: 'Company', href: '/admin/company', icon: 'building', allow: adminOnly },
      { id: 'divisions', label: 'Divisions', href: '/admin/divisions', icon: 'split', allow: adminOnly },
      { id: 'division-reports', label: 'Reports by division', href: '/admin/reports/divisions', icon: 'report', allow: adminOnly },
      { id: 'assistant-settings', label: 'Assistant settings', href: '/admin/assistant', icon: 'bot', allow: area('assistant', 'configure') },
      { id: 'integrations', label: 'Integrations', href: '/admin/integrations', icon: 'plug', allow: area('integrations') },
      { id: 'backups', label: 'Backup and restore', href: '/admin/backups', icon: 'database', allow: area('backups') },
    ],
  },
];

/** Pages reachable from the top bar (bell, avatar menu) rather than the sidebar — still offered under "Go to". */
export const EXTRA_GOTO: OfficeNavDef[] = [
  { id: 'notifications', label: 'Notifications', href: '/admin/notifications', icon: 'bell', allow: anyStaff, count: 'unread', g: 'N', keywords: ['inbox', 'alerts'] },
  { id: 'my-account', label: 'My staff account', href: '/staff/account', icon: 'user', allow: anyStaff, keywords: ['profile', 'password', '2fa'] },
  { id: 'workspaces', label: 'All workspaces', href: '/staff/workspace', icon: 'dashboard', allow: anyStaff },
];

export const ALL_NAV: OfficeNavDef[] = [...TOP_ITEMS, ...NAV_GROUPS.flatMap((g) => g.items)];

/* ───────── resolved (serialisable) nav ───────── */

export type ResolvedNavItem = { id: string; label: string; href: string; icon: IconKey; count?: number; hidden: boolean; g?: string; keywords?: string[] };
export type ResolvedNav = { top: ResolvedNavItem[]; groups: { id: string; label: string; items: ResolvedNavItem[] }[] };

const resolve = (d: OfficeNavDef, p: OfficePerms, counts: OfficeCounts): ResolvedNavItem => ({
  id: d.id,
  label: d.label,
  href: d.id === 'dashboard' ? dashboardHref(p) : d.href,
  icon: d.icon,
  count: d.count ? (counts[d.count] ?? undefined) || undefined : undefined,
  hidden: !d.allow(p),
  g: d.g,
  keywords: d.keywords,
});

/** Sidebar data with `hidden` set from today's rules. Groups whose items are all hidden disappear in OfficeSidebar. */
export function buildOfficeNav(p: OfficePerms, counts: OfficeCounts = {}): ResolvedNav {
  // without dashboard:view the Dashboard IS today's work queue (/admin), so "My work" would be the same page twice
  const sameAsDashboard = dashboardHref(p) === '/admin';
  return {
    top: TOP_ITEMS.map((d) => resolve(d, p, counts)).map((i) => (i.id === 'my-work' && sameAsDashboard ? { ...i, hidden: true } : i)),
    groups: NAV_GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.items.map((d) => resolve(d, p, counts)) })),
  };
}

/** Current sidebar item for this person (people whose Dashboard is /admin see Dashboard current there). */
export function currentSidebarId(pathname: string, p: OfficePerms): string | undefined {
  const id = currentNavId(pathname);
  return id === 'my-work' && dashboardHref(p) === '/admin' ? 'dashboard' : id;
}

/** Only what the person may open (sidebar + top-bar pages), for the palette "Go to" group and the G shortcuts. */
export function gotoItems(p: OfficePerms, counts: OfficeCounts = {}): ResolvedNavItem[] {
  return [...ALL_NAV, ...EXTRA_GOTO].map((d) => resolve(d, p, counts)).filter((i) => !i.hidden);
}

const pathOf = (href: string) => href.split(/[?#]/)[0];

/**
 * The current sidebar item for a public path: longest matching prefix wins (so /office/warehouse/b2b-shipments is
 * Shipping, not Warehouse; /admin/finance/saas is SaaS billing). `exact` items only match their own path.
 */
export function currentNavId(pathname: string, defs: OfficeNavDef[] = [...ALL_NAV, ...EXTRA_GOTO]): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: { id: string; len: number } | undefined;
  for (const d of defs) {
    const prefixes = d.match ?? [pathOf(d.href)];
    for (const pre of prefixes) {
      const hit = d.exact ? path === pre : path === pre || path.startsWith(`${pre}/`);
      if (hit && (!best || pre.length > best.len)) best = { id: d.id, len: pre.length };
    }
  }
  return best?.id;
}

/** Nav label for a path (tab titles before the page's own <title> arrives). */
export function navLabelFor(pathname: string): string | undefined {
  const id = currentNavId(pathname);
  return [...ALL_NAV, ...EXTRA_GOTO].find((d) => d.id === id)?.label;
}

/* ───────── app switcher (Part 7.1: Back Office, Accounts, Warehouse OS, Website admin) ───────── */

export type OfficeAppDef = { id: 'backoffice' | 'accounts' | 'warehouse' | 'website'; label: string; href: string; allow: NavRule; prefixes: string[] };

export const OFFICE_APPS: OfficeAppDef[] = [
  { id: 'backoffice', label: 'Back Office', href: '/office', allow: anyStaff, prefixes: [] },
  { id: 'accounts', label: 'Accounts', href: '/admin/finance', allow: area('finance'), prefixes: ['/admin/finance', '/admin/wallet', '/admin/currency', '/admin/settings/payment'] },
  // the Warehouse OS shell opens for warehouse staff (warehouse:view) and people who work in a warehouse (W7)
  { id: 'warehouse', label: 'Warehouse OS', href: '/office/warehouse', allow: (p) => can(p, 'warehouse') || p.warehouseMember, prefixes: ['/office/warehouse'] },
  { id: 'website', label: 'Website admin', href: '/admin/content', allow: area('content'), prefixes: ['/admin/content', '/admin/ads'] },
];

export function appsFor(p: OfficePerms): { id: string; label: string; href: string }[] {
  return OFFICE_APPS.filter((a) => a.allow(p)).map((a) => ({ id: a.id, label: a.label, href: a.id === 'backoffice' ? dashboardHref(p) : a.href }));
}

export function currentAppId(pathname: string, p: OfficePerms): string {
  const allowed = OFFICE_APPS.filter((a) => a.allow(p));
  const hit = allowed.find((a) => a.prefixes.some((pre) => pathname === pre || pathname.startsWith(`${pre}/`)));
  return hit?.id ?? 'backoffice';
}

/* ───────── + New ▾ (per role; each opens today's create flow) ───────── */

export type NewItemDef = { id: string; label: string; href: string; allow: NavRule; description: string };

export const NEW_ITEMS: NewItemDef[] = [
  { id: 'new-quote', label: 'Quote', href: '/office/rfqs?f=to_quote', allow: area('requests', 'create'), description: 'Pick a sourcing request to quote' },
  { id: 'new-payment', label: 'Payment', href: '/admin/finance', allow: area('finance', 'approve'), description: 'Record a payment against an order' },
  { id: 'new-supplier', label: 'Supplier', href: '/admin/suppliers?new=1', allow: area('suppliers', 'edit'), description: 'Add a supplier record' },
  { id: 'new-import', label: 'Product import', href: '/admin/import', allow: area('products', 'edit'), description: 'Upload a product sheet' },
  { id: 'new-dropship-product', label: 'Dropship product', href: '/office/dropship/new', allow: (p) => p.dropshipV2Ui && p.canOpenDropship && p.canEditDropship, description: 'Add a product to the Dropship catalogue' },
  { id: 'new-staff', label: 'Staff member', href: '/admin/staff', allow: area('staff', 'edit'), description: 'Invite a team member' },
];

export function newItemsFor(p: OfficePerms) {
  return NEW_ITEMS.filter((n) => n.allow(p)).map(({ id, label, href, description }) => ({ id, label, href, description }));
}

/* ───────── density and phone rules ───────── */

/**
 * Warehouse floor screens (scanner / handheld) and the turnkey inspector keep COMFORTABLE density inside the compact
 * frame (audit C13): 44 px controls. The ODS tree wraps these segments with data-density="comfortable".
 */
export const COMFORTABLE_PREFIXES = [
  '/office/warehouse/pick',
  '/office/warehouse/pack',
  '/office/warehouse/multi-parcel',
  '/office/warehouse/putaway',
  '/office/warehouse/counts',
  '/office/warehouse/scale',
  '/office/warehouse/dock',
  '/office/warehouse/receive',
  '/office/turnkey/inspect',
];
export const isComfortablePath = (path: string) => COMFORTABLE_PREFIXES.some((pre) => path === pre || path.startsWith(`${pre}/`));

/**
 * Part 7.8: on a phone the Back Office is Approvals, search and read-only records; editing shows "Open this on a
 * computer". These are today's editor / settings screens (forms are the whole page). Everything else stays browsable
 * on a phone as it is, and the floor screens are made for handhelds, so they never show the notice.
 */
export const DESKTOP_EDITING_PREFIXES = [
  '/office/dropship/new',
  '/office/dropship/import',
  '/office/dropship/compliance',
  '/office/dropship/rates',
  '/office/dropship/fees',
  '/office/dropship/test-order',
  '/admin/import',
  '/admin/content',
  '/admin/catalog',
  '/admin/hs-codes',
  '/admin/settings',
  '/admin/staff',
  '/admin/currency',
  '/admin/geography',
  '/admin/services',
  '/admin/company',
  '/admin/divisions',
  '/admin/integrations',
  '/admin/assistant',
  '/admin/backups',
  '/admin/ads',
  '/admin/turnkey/settings',
];
/** Product editor: /office/dropship/<id> (not the sub-sections, which are lists). */
const DROPSHIP_SECTIONS = ['import', 'requests', 'compliance', 'rates', 'queue', 'problems', 'pack', 'merchants', 'fees', 'health', 'approvals', 'suppliers', 'partners', 'invoicing', 'docs', 'ui-kit', 'products', 'test-order', 'new'];
export function isDesktopEditingPath(path: string): boolean {
  if (isComfortablePath(path)) return false;
  if (DESKTOP_EDITING_PREFIXES.some((pre) => path === pre || path.startsWith(`${pre}/`))) return true;
  const m = path.match(/^\/office\/dropship\/([^/]+)$/);
  return !!m && !DROPSHIP_SECTIONS.includes(m[1]);
}

/** Phone BottomNav (Part 7.8): Home · Approvals · Search · Alerts. Approvals = the ODS approvals home (T9). */
export const PHONE_APPROVALS_HREF = '/office/approvals';
export function phoneNavCurrent(pathname: string): 'home' | 'approvals' | 'alerts' | undefined {
  if (pathname === '/office' || pathname === '/admin') return 'home';
  if (pathname.startsWith('/admin/approvals') || pathname.startsWith('/office/approvals')) return 'approvals';
  if (pathname.startsWith('/admin/notifications')) return 'alerts';
  return undefined;
}

/** Role line under the name (today's StaffShell wording). */
export function roleLabel(p: Pick<OfficePerms, 'isAdmin' | 'roles'>): string {
  if (p.isAdmin) return 'Owner';
  if (p.roles.includes('account_manager')) return 'Account manager';
  const r = p.roles.map((x) => x.replace(/_/g, ' '));
  return r.length ? r.map((x) => x[0]!.toUpperCase() + x.slice(1)).join(', ') : 'Staff';
}

/** Internal Back Office link? (Ctrl / middle-click opens it in a workspace tab instead of a browser tab.) */
export function isOfficeHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  const p = pathOf(href);
  if (!/^\/(office|admin)(\/|$)/.test(p)) return false;
  // file / CSV route handlers (never pages): let the browser handle them
  return !/\/(export|csv|template|file)(\/|$)/.test(p);
}
