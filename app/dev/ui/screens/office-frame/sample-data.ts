/**
 * SAMPLE data for the staging-only Back Office frame fixture (/dev/ui/screens/office-frame). Labelled sample; never used
 * by real pages. Names, numbers and records are invented for design review.
 */
import type { WorkspaceTab } from '@octopus/ui';
import type { OfficeFrameData } from '@/app/ods/office/_lib/frame-data';
import type { PaletteRecord } from '@/app/ods/office/_lib/search-core';
import type { StaffNotification } from '@/lib/office/workspace-core';

export const SAMPLE_OFFICE: OfficeFrameData = {
  user: { id: 'sample-staff', name: 'Priya Shah', role: 'Finance, Operations', email: 'priya@example.com' },
  perms: {
    isAdmin: false,
    roles: ['finance', 'operations'],
    permissions: [
      'dashboard:view', 'customers:view', 'requests:view', 'requests:create', 'orders:view', 'orders:edit', 'finance:view', 'finance:approve', 'finance:edit',
      'wallet:view', 'wallet:approve', 'products:approve', 'suppliers:view', 'content:view', 'staff:view', 'warehouse:view', 'turnkey:view',
    ],
    canOpenDropship: true,
    canSeeRates: true,
    canSeeFeesDuty: true,
    canEditDropship: false,
    canSeeSaas: true,
    warehouseMember: false,
    dropshipV2Ui: true,
  },
  counts: { queue: 14, approvals: 3, transfers: 5, moderation: 7, unread: 4 },
  division: {
    options: [
      { code: 'SRC', name: 'Sourcing', inactive: false },
      { code: 'DS', name: 'Dropship', inactive: false },
      { code: '3PL', name: '3PL & Shipping', inactive: false },
    ],
    current: null,
    currentName: null,
  },
  staging: true,
  workspace: null,
  persistence: 'local',
  sidebarCollapsed: null,
  staffUnread: 2,
};

export const SAMPLE_NOTIFICATIONS: StaffNotification[] = [
  { id: 'n1', kind: 'approval', title: 'Second approval needed: payment US$ 3,200.00', body: 'ORD-1042 · recorded by Omar K. You can approve or reject it.', link: '/admin/approvals', refType: 'payment', refId: null, createdAt: '2026-11-27T09:30:00Z', readAt: null, forRole: 'finance' },
  { id: 'n2', kind: 'transfer', title: 'Bank transfer to confirm', body: 'Gulf Home Trading LLC · reference FT2611270042', link: '/admin/finance/transfers', refType: null, refId: null, createdAt: '2026-11-27T08:10:00Z', readAt: null, forRole: null },
  { id: 'n3', kind: 'info', title: 'Credit terms review due', body: null, link: '/admin/finance/credit', refType: null, refId: null, createdAt: '2026-11-25T12:00:00Z', readAt: '2026-11-25T13:00:00Z', forRole: null },
];

export const SAMPLE_TABS: WorkspaceTab[] = [
  { id: 'dashboard', title: 'Dashboard', href: '/office', icon: 'dashboard', pinned: true },
  { id: 's-orders', title: 'Orders', href: '/office/orders', icon: 'cart' },
  { id: 's-order', title: 'ORD-1042 · Steel water bottles', href: '/office/orders/sample-1042', icon: 'cart' },
  { id: 's-customers', title: 'Customers', href: '/admin/customers', icon: 'users' },
  { id: 's-bank', title: 'Bank reconciliation', href: '/admin/finance/transfers', icon: 'bank' },
];

const MORE: [string, string, string][] = [
  ['s-rfqs', 'Sourcing requests', '/office/rfqs'],
  ['s-rfq', 'RFQ-2208 · Bamboo cutlery sets', '/office/rfqs/sample-2208'],
  ['s-holds', 'Held payments', '/admin/finance/holds'],
  ['s-wallets', 'Wallets', '/admin/wallet'],
  ['s-cust', 'Gulf Home Trading LLC', '/admin/customers/sample-gulf'],
  ['s-products', 'Products', '/office/products'],
  ['s-recv', 'Receivables and ageing', '/admin/finance/receivables'],
];
export const SAMPLE_MANY_TABS: WorkspaceTab[] = [...SAMPLE_TABS, ...MORE.map(([id, title, href]) => ({ id, title, href }))];

export const SAMPLE_RECORDS: PaletteRecord[] = [
  { id: 'rec:customer:s1', group: 'records', kind: 'customer', label: 'Gulf Home Trading LLC', description: 'Customer · BUYER-1042 · Dubai, AE', href: '/admin/customers/sample-gulf' },
  { id: 'rec:rfq:s2', group: 'records', kind: 'rfq', label: 'RFQ-2208 · Bamboo cutlery sets', description: 'Sourcing request · submitted', href: '/office/rfqs/sample-2208' },
  { id: 'rec:order:s3', group: 'records', kind: 'order', label: 'ORD-1042 · Steel water bottles', description: 'Order · balance pending', href: '/office/orders/sample-1042' },
  { id: 'rec:invoice:s4', group: 'records', kind: 'invoice', label: 'PI-1042', description: 'Proforma invoice · opens its order', href: '/office/orders/sample-1042' },
  { id: 'act:pay:s3', group: 'actions', kind: 'action', label: 'Record payment for ORD-1042', description: 'Steel water bottles', href: '/office/orders/sample-1042' },
  { id: 'act:quote:s2', group: 'actions', kind: 'action', label: 'New quote for RFQ-2208', description: 'Bamboo cutlery sets', href: '/office/rfqs/sample-2208' },
];

export const OFFICE_FIXTURE_STATES = [
  ['default', 'Default'],
  ['collapsed', 'Sidebar collapsed'],
  ['palette', 'Command palette'],
  ['many-tabs', 'Many tabs'],
  ['unsaved', 'Unsaved changes'],
  ['shortcuts', 'Keyboard shortcuts'],
  ['alerts', 'Notifications panel'],
  ['phone', 'Phone (view at 390 px)'],
] as const;
export type OfficeFixtureState = (typeof OFFICE_FIXTURE_STATES)[number][0];
