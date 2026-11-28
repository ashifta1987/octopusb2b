/**
 * ODS T8 · section menus for the two sub-apps that had their own staff shell today (pure; tests in
 * tests/unit/ods-office-shell.test.ts):
 *  - Dropshipping (today's DropshipStaffShell: /office/dropship/* and /admin/finance/saas, only with dropship_v2_ui on);
 *  - Warehouse OS (today's WarehouseStaffShell: /office/warehouse/*).
 * Inside the ODS frame their white sidebars and top bars are replaced by the OfficeSidebar + OfficeTopbar; the section
 * items move into a compact section menu above the page. Items, order, labels and visibility rules are copied from the
 * two shells (components/shell/dropship-staff-shell.tsx STAFF_ITEMS / isStaffItemActive, warehouse-staff-shell.tsx
 * ITEMS / active) — keep them in step until T9 retires the old shells.
 */
import type { OfficePerms } from './nav';

export type SectionId = 'dropship' | 'warehouse';
export type SectionItem = { href: string; label: string; current: boolean };

type DsRole = 'dropship' | 'dropship_edit' | 'fees_duty' | 'rates' | 'warehouse' | 'saas';
const DS_ITEMS: { href: string; label: string; matchPrefix: string; role: DsRole }[] = [
  { href: '/office/dropship', label: 'Products', matchPrefix: '/office/dropship', role: 'dropship' },
  { href: '/office/dropship/import', label: 'Import products', matchPrefix: '/office/dropship/import', role: 'dropship_edit' },
  { href: '/office/dropship/requests', label: 'Product requests', matchPrefix: '/office/dropship/requests', role: 'dropship' },
  { href: '/office/dropship/compliance', label: 'Duty, tax and customs', matchPrefix: '/office/dropship/compliance', role: 'fees_duty' },
  { href: '/office/dropship/rates', label: 'Shipping rates', matchPrefix: '/office/dropship/rates', role: 'rates' },
  { href: '/office/warehouse/orders?source=dropship', label: 'Fulfilment queue', matchPrefix: '/office/warehouse/orders', role: 'warehouse' },
  { href: '/office/warehouse/pack', label: 'Pack station', matchPrefix: '/office/warehouse/pack', role: 'warehouse' },
  { href: '/office/dropship/problems', label: 'Order problems', matchPrefix: '/office/dropship/problems', role: 'dropship' },
  { href: '/office/dropship/approvals', label: 'Supplier approvals', matchPrefix: '/office/dropship/approvals', role: 'dropship' },
  { href: '/office/dropship/suppliers', label: 'Suppliers', matchPrefix: '/office/dropship/suppliers', role: 'dropship' },
  { href: '/office/dropship/merchants', label: 'Merchants', matchPrefix: '/office/dropship/merchants', role: 'dropship' },
  { href: '/office/dropship/partners', label: 'Sales partners', matchPrefix: '/office/dropship/partners', role: 'dropship' },
  { href: '/office/dropship/fees', label: 'Fees and plans', matchPrefix: '/office/dropship/fees', role: 'fees_duty' },
  { href: '/office/dropship/invoicing', label: 'Invoicing', matchPrefix: '/office/dropship/invoicing', role: 'dropship' },
  { href: '/office/dropship/docs', label: 'Docs', matchPrefix: '/office/dropship/docs', role: 'dropship' },
  { href: '/office/dropship/health', label: 'System health', matchPrefix: '/office/dropship/health', role: 'dropship' },
  { href: '/admin/finance/saas', label: 'Finance: SaaS billing', matchPrefix: '/admin/finance/saas', role: 'saas' },
];
const DS_NON_CATALOG = [
  '/office/dropship/import', '/office/dropship/compliance', '/office/dropship/rates', '/office/dropship/queue', '/office/dropship/pack',
  '/office/dropship/problems', '/office/dropship/merchants', '/office/dropship/requests', '/office/dropship/fees', '/office/dropship/health',
  '/office/dropship/approvals', '/office/dropship/suppliers', '/office/dropship/partners', '/office/dropship/invoicing', '/office/dropship/docs',
  '/office/dropship/ui-kit',
];

function dsActive(matchPrefix: string, path: string) {
  if (matchPrefix === '/office/dropship') {
    if (path === '/office/dropship' || path === '/office/dropship/new') return true;
    return path.startsWith('/office/dropship/') && !DS_NON_CATALOG.some((p) => path === p || path.startsWith(`${p}/`));
  }
  return path === matchPrefix || path.startsWith(`${matchPrefix}/`);
}

function dsVisible(role: DsRole, p: OfficePerms) {
  const warehouseMember = p.isAdmin || p.warehouseMember;
  switch (role) {
    case 'warehouse': return p.canOpenDropship && warehouseMember;
    case 'saas': return p.canSeeSaas;
    case 'rates': return p.canSeeRates;
    case 'fees_duty': return p.canSeeFeesDuty || p.canOpenDropship;
    case 'dropship_edit': return p.canOpenDropship && p.canEditDropship;
    default: return p.canOpenDropship;
  }
}

const WH_ITEMS: { href: string; label: string; adminOnly?: boolean; open?: boolean }[] = [
  { href: '/office/warehouse', label: 'Dashboard' },
  { href: '/office/warehouse/orders', label: 'Orders' },
  { href: '/office/warehouse/pick', label: 'Picking' },
  { href: '/office/warehouse/pack', label: 'Packing station' },
  { href: '/office/warehouse/dispatch', label: 'Dispatch and freight' },
  { href: '/office/warehouse/b2b-shipments', label: 'B2B shipments', open: true },
  { href: '/office/warehouse/multi-parcel', label: 'Multi-parcel packing' },
  { href: '/office/warehouse/putaway', label: 'Putaway and pallets' },
  { href: '/office/warehouse/counts', label: 'Counts and lots' },
  { href: '/office/warehouse/materials', label: 'Materials' },
  { href: '/office/warehouse/labels', label: 'Label centre' },
  { href: '/office/warehouse/inbound', label: 'Inbound' },
  { href: '/office/warehouse/dock', label: 'Dock appointments' },
  { href: '/office/warehouse/transfers', label: 'Transfers' },
  { href: '/office/warehouse/evidence', label: 'Evidence' },
  { href: '/office/warehouse/scale', label: 'Scale check' },
  { href: '/office/warehouse/carriers', label: 'Carriers and rules' },
  { href: '/office/warehouse/clients', label: 'Clients' },
  { href: '/office/warehouse/rates', label: 'Rates' },
  { href: '/office/warehouse/invoices', label: 'Client invoices', open: true },
  { href: '/office/warehouse/exceptions', label: 'Exceptions' },
  { href: '/office/warehouse/returns', label: 'Returns' },
  { href: '/office/warehouse/reports', label: 'Reports' },
  { href: '/office/warehouse/users', label: 'Users and roles' },
  { href: '/office/warehouse/locations', label: 'Locations', adminOnly: true },
];

const whActive = (href: string, path: string) => (href === '/office/warehouse' ? path === href : path === href || path.startsWith(`${href}/`));

/** Which section menu a path shows (null = none). Dropship needs dropship_v2_ui, as today. */
export function sectionFor(path: string, p: Pick<OfficePerms, 'dropshipV2Ui'>): SectionId | null {
  if (path === '/office/warehouse' || path.startsWith('/office/warehouse/')) return 'warehouse';
  if (p.dropshipV2Ui && (path === '/office/dropship' || path.startsWith('/office/dropship/') || path.startsWith('/admin/finance/saas'))) return 'dropship';
  return null;
}

export const SECTION_LABEL: Record<SectionId, string> = { dropship: 'Dropshipping', warehouse: 'Warehouse OS' };

export function sectionItems(section: SectionId, path: string, p: OfficePerms): SectionItem[] {
  if (section === 'dropship') {
    return DS_ITEMS.filter((i) => dsVisible(i.role, p)).map((i) => ({ href: i.href, label: i.label, current: dsActive(i.matchPrefix, path) }));
  }
  const member = p.isAdmin || p.warehouseMember;
  return WH_ITEMS.filter((i) => (!i.adminOnly || p.isAdmin) && (member || i.open)).map((i) => ({ href: i.href, label: i.label, current: whActive(i.href, path) }));
}
