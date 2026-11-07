/** Role-based portal navigation from one config file, filtered by permissions (SPEC §8.2). */
export type NavItem = { href: string; label: string; area?: string; action?: string; role?: string };
export type NavSection = { title?: string; items: NavItem[] };

/** Customer account menu, ordered by service priority (7 Nov 2026): Product sourcing comes first after the dashboard. */
export const CUSTOMER_NAV: NavSection[] = [
  {
    items: [
      { href: '/account', label: 'Dashboard' },
      { href: '/account/sourcing', label: 'Product sourcing' },
      { href: '/account/sourcing?type=dropship', label: 'Dropshipping' },
      { href: '/account/pools', label: 'MOQ pools' },
      { href: '/account/sourcing?type=3pl', label: '3PL' },
      { href: '/account/turnkey', label: 'Turnkey projects' },
      { href: '/account/orders', label: 'Orders' },
      { href: '/account/wallet', label: 'Wallet' },
      { href: '/account/assistant', label: 'Assistant' },
      { href: '/account/developer', label: 'API' },
      { href: '/account/kyc', label: 'Settings' },
    ],
  },
  {
    title: 'More',
    items: [
      { href: '/account/ledger', label: 'Ledger & invoices' },
      { href: '/account/support', label: 'Help & complaints' },
    ],
  },
];

export const DISTRIBUTOR_NAV: NavSection[] = [{
  items: [
    { href: '/distributor', label: 'Suppliers' },
    { href: '/distributor/products', label: 'Products' },
    { href: '/distributor/products/new', label: 'Create product' },
    { href: '/distributor/products/import', label: 'Bulk upload' },
    { href: '/distributor/catalog', label: 'Categories & tags' },
    { href: '/distributor/rfqs', label: 'RFQs' },
  ],
}];

export const OFFICE_NAV: NavSection[] = [
  {
    title: 'Back office',
    items: [
      { href: '/office', label: 'Queues', area: 'dashboard' },
      { href: '/office/kyc', label: 'KYC review', area: 'customers' },
      { href: '/office/products', label: 'Moderation', area: 'products', action: 'approve' },
      { href: '/office/rfqs', label: 'RFQs & quotes', area: 'requests' },
      { href: '/office/services', label: 'Service requests', area: 'requests' },
      { href: '/office/orders', label: 'Orders', area: 'orders' },
      { href: '/office/shipping', label: 'Shipping', area: 'orders' },
      { href: '/office/support', label: 'Support desk', area: 'support' },
      { href: '/office/assistant', label: 'Assistant queue', area: 'assistant' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/admin/reports', label: 'Reports', area: 'dashboard' },
      { href: '/admin/customers', label: 'Customers', area: 'customers' },
      { href: '/admin/finance', label: 'Finance', area: 'finance' },
      { href: '/admin/wallet', label: 'Wallets & payments', area: 'wallet' },
      { href: '/admin/settings/payment', label: 'Payment settings', area: 'finance', action: 'edit' },
      { href: '/admin/currency', label: 'Currency', area: 'finance' },
      { href: '/admin/services', label: 'Services & charges', area: 'services' },
      { href: '/admin/pools', label: 'Group buying', area: 'orders' },
      { href: '/admin/catalog', label: 'Categories & tags', area: 'catalog' },
      { href: '/admin/content', label: 'Site content', area: 'content' },
      { href: '/admin/ads', label: 'Advertising', area: 'ads' },
      { href: '/admin/geography', label: 'Geography', area: 'customers' },
      { href: '/admin/suppliers', label: 'Suppliers', area: 'suppliers' },
      { href: '/admin/import', label: 'Bulk import', area: 'products', action: 'edit' },
      { href: '/admin/turnkey', label: 'Turnkey projects', area: 'turnkey' },
      { href: '/admin/hs-codes', label: 'HS codes', area: 'products', action: 'approve' },
      { href: '/admin/staff', label: 'Staff & roles', area: 'staff' },
      { href: '/admin/assistant', label: 'Assistant', area: 'assistant', action: 'configure' },
      { href: '/admin/integrations', label: 'Integrations', area: 'integrations' },
      { href: '/admin/backups', label: 'Backup & restore', area: 'backups' },
    ],
  },
];

