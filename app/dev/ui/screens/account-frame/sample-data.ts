import type { AccountFrameData, InProgressRow, ManagerView, ServiceTileView, WaitingRowView, WalletView } from '@/app/ods/account/_lib/types';

/**
 * SAMPLE data for the staging-only My account fixtures (Part 6.7 example data — "Use these only in fixtures and
 * stories, never on live"). Not imported by any real page.
 */

export const SAMPLE_FRAME: AccountFrameData = {
  user: { name: 'Anna K.', email: 'anna@example.com' },
  company: { id: 'sample-org', name: 'Anna Home Trading' },
  companies: [{ id: 'sample-org', name: 'Anna Home Trading' }],
  counts: { action: 5, requests: 1, orders: 1 },
  unread: 4,
  started: { sourcing: true, turnkey: true, warehouse: true, shipping: true, brand: true, dropship: false },
};

export const SAMPLE_FRAME_NEW: AccountFrameData = {
  ...SAMPLE_FRAME,
  counts: { action: 0, requests: 0, orders: 0 },
  unread: 0,
  started: { sourcing: false, turnkey: false, warehouse: false, shipping: false, brand: false, dropship: false },
};

export const SAMPLE_WAITING: WaitingRowView[] = [
  { id: 'q-1042', type: 'review', service: 'Sourcing', ref: 'RFQ-1042', what: 'Quote for RFQ-1042 · Foldable pet crate', detail: 'Foldable pet crate · RFQ-1042 · valid until 29 Nov', due: { text: 'Expires in 2 days', urgent: true }, action: 'Review quote', href: '/account/requests/RFQ-1042' },
  { id: 'o-0207', type: 'pay', service: 'Sourcing', ref: 'OCT-SRC-2026-0207', what: 'Balance for order OCT-SRC-2026-0207 · Kitchen storage set', detail: 'Total US$ 4,100.00 · deposit US$ 1,230.00 paid 24 Oct · balance US$ 2,870.00 due 1 Dec', due: { text: 'Due 1 Dec', urgent: false }, action: 'Pay balance', href: '/account/orders/OCT-SRC-2026-0207' },
  { id: 'o-pf0118', type: 'pay', service: 'Sourcing', ref: 'PF-2026-0118', what: 'Deposit for proforma PF-2026-0118 · Pet accessories range', detail: 'US$ 1,860.00 deposit', due: { text: 'Due 30 Nov', urgent: false }, action: 'Pay deposit', href: '/account/orders/PF-2026-0118' },
  { id: 'p-proof', type: 'approve', service: 'Make My Brand', ref: null, what: 'Packaging proof v2', detail: 'Approve or comment on the new packaging artwork.', due: { text: 'No due date', urgent: false }, action: 'Approve or comment', href: '/account/brand?tab=proofs' },
  { id: 'kyc', type: 'reply', service: 'Account', ref: null, what: 'Company verification needs more information', detail: 'Upload a clearer copy of your business licence.', due: { text: 'No due date', urgent: false }, action: 'Add information', href: '/account/settings?tab=verification' },
];

export const SAMPLE_WALLET: WalletView = { available: 4250, held: 1180, invoicesDue: 1860, pendingTransfers: 0 };

export const SAMPLE_TILES: ServiceTileView[] = [
  { id: 'sourcing', name: 'Sourcing', status: 'on', summary: '2 open requests · 1 quote ready', href: '/account/requests' },
  { id: 'turnkey', name: 'Turnkey', status: 'on', summary: '1 project', href: '/account/turnkey' },
  { id: 'warehouse', name: 'Warehouse (3PL)', status: 'on', summary: 'Switched on', href: '/account/warehouse' },
  { id: 'shipping', name: 'Shipping', status: 'on', summary: 'Parcels and tracking from your warehouse', href: '/account/shipping' },
  { id: 'brand', name: 'Make My Brand', status: 'on', summary: 'Switched on', href: '/account/brand' },
  { id: 'dropship', name: 'Dropshipping', status: 'not-started', summary: 'Not started · Request access', href: '/account/dropship' },
];

export const SAMPLE_IN_PROGRESS: InProgressRow[] = [
  { id: 'r-1051', ref: 'RFQ-1051', title: 'Bamboo cutting boards', href: '/account/requests/RFQ-1051', service: 'Sourcing', status: 'Quoting', nextStep: 'Quotes on the way' },
  { id: 'o-0213', ref: 'OCT-SRC-2026-0213', title: 'Ceramic dinner set', href: '/account/orders/OCT-SRC-2026-0213', service: 'Sourcing', status: 'In production', nextStep: 'Quality check' },
  { id: 'o-0207', ref: 'OCT-SRC-2026-0207', title: 'Kitchen storage set', href: '/account/orders/OCT-SRC-2026-0207', service: 'Sourcing', status: 'Balance due', nextStep: 'Pay the balance' },
  { id: 'r-1042', ref: 'RFQ-1042', title: 'Foldable pet crate', href: '/account/requests/RFQ-1042', service: 'Sourcing', status: 'Quote ready', nextStep: 'Review the quotes' },
];

export const SAMPLE_MANAGER_UNSET: ManagerView = { name: null, title: null, replyTime: null };
export const SAMPLE_MANAGER: ManagerView = { name: null, title: null, replyTime: 'within 1 business day' };
