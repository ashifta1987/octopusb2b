/** Role-based portal navigation from one config file, filtered by permissions (SPEC §8.2). */
export type NavItem = { href: string; label: string; area?: string; action?: string; role?: string };
export type NavSection = { title?: string; items: NavItem[] };

export const CUSTOMER_NAV: NavSection[] = [{
  items: [
    { href: '/account', label: 'Dashboard' },
    { href: '/account/rfqs', label: 'RFQs' },
    { href: '/account/services', label: 'Service requests' },
    { href: '/account/orders', label: 'Orders' },
    { href: '/account/wallet', label: 'Wallet' },
    { href: '/account/ledger', label: 'Ledger & invoices' },
    { href: '/account/kyc', label: 'Company & KYC' },
    { href: '/account/ads', label: 'Advertising' },
    { href: '/account/developer', label: 'API & integrations' },
    { href: '/account/support', label: 'Help & complaints' },
  ],
}];

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
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/admin', label: 'Overview', area: 'dashboard' },
      { href: '/admin/finance', label: 'Finance', area: 'finance' },
      { href: '/admin/wallet', label: 'Wallets & payments', area: 'wallet' },
      { href: '/admin/services', label: 'Services & charges', area: 'services' },
      { href: '/admin/catalog', label: 'Categories & tags', area: 'catalog' },
      { href: '/admin/content', label: 'Site content', area: 'content' },
      { href: '/admin/ads', label: 'Advertising', area: 'ads' },
      { href: '/admin/geography', label: 'Geography', area: 'customers' },
      { href: '/admin/staff', label: 'Staff & roles', area: 'staff' },
      { href: '/admin/integrations', label: 'Integrations', area: 'integrations' },
    ],
  },
];
