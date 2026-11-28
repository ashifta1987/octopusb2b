/**
 * Staging fixtures (T9 batch 2 · Orders + Support desk): SAMPLE staff data only (design review). Never used by the live
 * pages. Shapes are the live view models (OrderRow, OrderRecordData, TicketRow, TicketDetail).
 */
import { showSupplierCodes, showSupplierDocs, staffOrderStatus, orderServiceLabel, orderFigures, initials, type OrderPerms, type OrderRow } from '@/app/ods/office/orders/_lib/order-core';
import type { OrderKpis, OrderRecordData } from '@/app/ods/office/orders/_lib/types';
import type { SupportKpis, SupportPerms, TicketDetail, TicketRow, Macro } from '@/app/ods/office/support/_lib/support-core';
import type { SampleRole } from '../office-dashboard/sample-data';

export const SAMPLE_NOW = Date.parse('2026-11-27T10:00:00Z');
export const SAMPLE_LIMIT = 250_000; // US$ 2,500 (designs)
export const ORDER_ROLES: [SampleRole, string][] = [
  ['finance', 'Finance'],
  ['sales', 'Sales'],
  ['admin', 'Owner (admin)'],
];
export const isSampleRole = (r: unknown): r is SampleRole => r === 'finance' || r === 'sales' || r === 'admin';

/** Screen permissions per sample role (what orderPerms() gives those roles' permissions). */
export const SAMPLE_ORDER_PERMS: Record<SampleRole, OrderPerms> = {
  finance: { canEdit: false, canPay: true, canSeeSuppliers: true, canSeeCarrier: true, canDownloadLabels: false, canSeeTickets: false },
  sales: { canEdit: false, canPay: false, canSeeSuppliers: false, canSeeCarrier: false, canDownloadLabels: false, canSeeTickets: true },
  admin: { canEdit: true, canPay: true, canSeeSuppliers: true, canSeeCarrier: true, canDownloadLabels: true, canSeeTickets: true },
};
export const SAMPLE_SUPPORT_PERMS: Record<SampleRole, SupportPerms> = {
  finance: { canEdit: false, canEscalate: true, canSeeSuppliers: true },
  sales: { canEdit: false, canEscalate: false, canSeeSuppliers: false },
  admin: { canEdit: true, canEscalate: true, canSeeSuppliers: true },
};

type Raw = [id: string, code: string, title: string, qty: number, status: string, customer: string, country: string, total: number, paid: number, deposit: number, owner: string | null, supplier: string, updated: string, currency?: string];
const RAW: Raw[] = [
  ['5f1c0a52-0000-4000-8000-000000000001', 'OCT-SRC-2026-0207', 'Bamboo kitchen towels, custom print', 4000, 'deposit_pending', 'Anna Home Trading', 'AE', 1_840_000, 0, 552_000, 'Omar Khalid', 'SUP-0142', '2026-11-27T08:10:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000002', 'OCT-SRC-2026-0201', 'Stainless steel lunch boxes', 2500, 'in_production', 'Gulf Living LLC', 'AE', 3_125_000, 937_500, 937_500, 'Omar Khalid', 'SUP-0098', '2026-11-26T15:40:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000003', 'OCT-BR-2026-0044', 'Private-label shampoo 300 ml', 6000, 'qc', 'Nour Beauty FZE', 'AE', 2_460_000, 738_000, 738_000, 'Sara Haddad', 'SUP-0211', '2026-11-26T09:05:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000004', 'OCT-SRC-2026-0188', 'LED desk lamps, USB-C', 1200, 'balance_pending', 'Desert Office Supply', 'SA', 1_416_000, 424_800, 424_800, 'Omar Khalid', 'SUP-0077', '2026-11-25T11:30:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000005', 'OCT-POOL-2026-0019', 'Ceramic mugs 350 ml (pool)', 3000, 'ready_to_ship', 'Cafe Republic', 'KW', 690_000, 690_000, 207_000, 'Sara Haddad', 'SUP-0033', '2026-11-25T08:00:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000006', 'OCT-STK-2026-0310', 'Cotton tote bags', 5000, 'shipped', 'Green Basket Market', 'QA', 425_000, 425_000, 127_500, null, 'SUP-0154', '2026-11-24T17:20:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000007', 'OCT-SRC-2026-0150', 'Kids water bottles 500 ml', 2000, 'delivered', 'Little Steps Retail', 'OM', 980_000, 980_000, 294_000, 'Omar Khalid', 'SUP-0098', '2026-11-20T10:00:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000008', 'OCT-SRC-2026-0139', 'Phone cases, mixed models', 8000, 'disputed', 'Mobile Hub Trading', 'AE', 1_120_000, 1_120_000, 336_000, 'Sara Haddad', 'SUP-0187', '2026-11-19T13:45:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000009', 'OCT-TK-2026-0012', 'Restaurant fit-out package', 1, 'pi_issued', 'Saffron Kitchens', 'BH', 6_850_000, 0, 2_055_000, 'Sara Haddad', 'SUP-0301', '2026-11-27T07:30:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000010', 'OCT-SRC-2026-0121', 'Yoga mats 6 mm', 1500, 'cancelled', 'FitLife Stores', 'AE', 712_500, 0, 213_750, null, 'SUP-0120', '2026-11-12T09:00:00Z'],
  ['5f1c0a52-0000-4000-8000-000000000011', 'OCT-SRC-2026-0195', 'Glass food containers', 3600, 'deposit_paid', 'Anna Home Trading', 'AE', 2_052_000, 615_600, 615_600, 'Omar Khalid', 'SUP-0142', '2026-11-23T12:10:00Z', 'CNY'],
  ['5f1c0a52-0000-4000-8000-000000000012', 'OCT-DS-2026-0402', 'Pet grooming gloves', 900, 'balance_paid', 'Paws & Co', 'AE', 279_000, 279_000, 83_700, null, 'SUP-0166', '2026-11-22T16:00:00Z'],
];

export function sampleOrderRows(withSupplier: boolean): OrderRow[] {
  return RAW.map(([id, code, title, qty, status, customer, country, total, paid, deposit, owner, supplier, updated, currency]) => {
    const s = staffOrderStatus(status);
    const row: OrderRow = {
      id,
      code,
      title,
      quantity: qty,
      status,
      statusName: s.name,
      step: s.step,
      attention: s.attention,
      service: orderServiceLabel(code),
      customer,
      customerId: `c0ffee00-0000-4000-8000-0000000000${id.slice(-2)}`,
      country,
      currency: currency ?? 'USD',
      ...orderFigures({ total_cents: total, paid_cents: paid, deposit_cents: deposit }),
      owner: owner ? { name: owner, initials: initials(owner) } : null,
      updatedAt: updated,
      createdAt: '2026-10-01T08:00:00Z',
    };
    if (withSupplier) row.supplierCode = supplier;
    return row;
  });
}

export const SAMPLE_ORDER_KPIS: OrderKpis = { active: 9, awaiting: 2, production: 4, ready: 1, disputed: 1 };

export const ORDER_STATES = ['default', 'pay', 'second-approver', 'step-up', 'ready', 'delivered', 'disputed', 'cancelled', 'loading', 'error'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const STATUS_FOR: Partial<Record<OrderState, string>> = { ready: 'ready_to_ship', delivered: 'delivered', disputed: 'disputed', cancelled: 'cancelled' };

export function sampleOrderRecord(role: SampleRole, state: OrderState): OrderRecordData {
  const perms = SAMPLE_ORDER_PERMS[role];
  const status = STATUS_FOR[state] ?? 'deposit_pending';
  const done = ['ready_to_ship', 'delivered', 'disputed'].includes(status);
  const paid = done ? 1_840_000 : status === 'cancelled' ? 0 : 0;
  const f = orderFigures({ total_cents: 1_840_000, paid_cents: paid, deposit_cents: 552_000 });
  const err = state === 'error';
  const docs = [
    { id: 'd0c00000-0000-4000-8000-000000000001', number: 'PI-2026-0207', type: 'proforma_invoice', supplier: false, amountMinor: 1_840_000, currency: 'USD', status: done ? 'paid' : 'awaiting_payment', createdAt: '2026-11-20T09:00:00Z' },
    { id: 'd0c00000-0000-4000-8000-000000000002', number: 'OC-2026-0207', type: 'confirmation', supplier: false, amountMinor: null, currency: null, status: 'issued', createdAt: '2026-11-20T09:05:00Z' },
    { id: 'd0c00000-0000-4000-8000-000000000003', number: 'PO-2026-0207', type: 'purchase_order', supplier: true, amountMinor: 1_288_000, currency: 'USD', status: 'issued', createdAt: '2026-11-21T10:00:00Z' },
  ];
  return {
    id: '5f1c0a52-0000-4000-8000-000000000001',
    code: 'OCT-SRC-2026-0207',
    title: 'Bamboo kitchen towels, custom print',
    status,
    service: 'Sourcing',
    customer: { id: 'c0ffee00-0000-4000-8000-000000000001', name: 'Anna Home Trading', country: 'AE', city: 'Dubai', kycStatus: 'verified' },
    quantity: 4000,
    unitPriceMinor: 420,
    shippingMinor: 160_000,
    ...f,
    depositMinor: 552_000,
    depositPct: 30,
    currency: 'USD',
    incoterm: 'CIF Jebel Ali',
    quoteCode: 'Q-2026-0388',
    rfqCode: 'RFQ-2026-0412',
    createdAt: '2026-11-20T08:55:00Z',
    deliveredAt: status === 'delivered' || status === 'disputed' ? '2026-11-25T12:00:00Z' : null,
    claimVisibleUntil: status === 'delivered' || status === 'disputed' ? '2026-12-02T12:00:00Z' : null,
    claimHiddenUntil: status === 'delivered' || status === 'disputed' ? '2027-02-23T12:00:00Z' : null,
    supplier: perms.canSeeSuppliers ? { code: 'SUP-0142', legalName: 'Ningbo Greenleaf Textiles Co., Ltd.', country: 'CN' } : null,
    documents: err ? null : docs.filter((d) => showSupplierDocs(perms.canSeeSuppliers) || !d.supplier),
    supplierDocsHidden: !showSupplierDocs(perms.canSeeSuppliers),
    payments: err
      ? null
      : done
        ? [
            { id: 'p0000000-0000-4000-8000-000000000001', purpose: 'deposit', method: 'bank_transfer', amountMinor: 552_000, currency: 'USD', reference: 'FT2611AE0091', status: 'confirmed', createdAt: '2026-11-21T09:30:00Z' },
            { id: 'p0000000-0000-4000-8000-000000000002', purpose: 'balance', method: 'bank_transfer', amountMinor: 1_288_000, currency: 'USD', reference: 'FT2611AE0174', status: 'confirmed', createdAt: '2026-11-24T10:10:00Z' },
          ]
        : [],
    shipments: err
      ? null
      : status === 'delivered' || status === 'disputed'
        ? [{ id: 's0000000-0000-4000-8000-000000000001', code: 'SHP-2026-0098', trackingNo: 'YT2611000123', status: 'delivered', carrier: perms.canSeeCarrier ? 'YunExpress' : null, serviceCode: perms.canSeeCarrier ? 'YE-SEA' : null, labelUrl: perms.canDownloadLabels ? '#label' : null, packingSlip: false, createdAt: '2026-11-22T08:00:00Z' }]
        : [],
    events: err
      ? null
      : [
          { id: 'e1', kind: 'status', title: 'Proforma issued', body: 'PI-2026-0207 sent to the customer', createdAt: '2026-11-20T09:00:00Z' },
          { id: 'e2', kind: 'status', title: 'Deposit pending', body: null, createdAt: '2026-11-20T09:10:00Z' },
          ...(status === 'cancelled' ? [{ id: 'e3', kind: 'status', title: 'Cancelled', body: 'Customer changed the design', createdAt: '2026-11-22T11:00:00Z' }] : []),
          ...(done ? [{ id: 'e4', kind: 'payment', title: 'Balance paid', body: 'FT2611AE0174', createdAt: '2026-11-24T10:10:00Z' }] : []),
        ],
    tickets: !perms.canSeeTickets ? 'restricted' : err ? null : [{ id: '7c000000-0000-4000-8000-000000000001', code: 'TCK-2026-0311', subject: 'Can we change the print colour?', status: 'waiting_internal', priority: 'normal', updatedAt: '2026-11-26T14:00:00Z' }],
    payFresh: perms.canPay ? state !== 'step-up' : null,
  };
}

/* ───────── support ───────── */

export const SUPPORT_STATES = ['list', 'ticket', 'empty', 'error', 'loading', 'no-permission'] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

export const SAMPLE_TICKETS: TicketRow[] = [
  { id: '7c000000-0000-4000-8000-000000000002', code: 'TCK-2026-0315', subject: '2 cartons crushed in transit', category: 'complaint', priority: 'urgent', status: 'open', slaDueAt: '2026-11-27T08:00:00Z', customer: 'Little Steps Retail', assignee: 'Lina Farah', assignedToMe: true, orderId: '5f1c0a52-0000-4000-8000-000000000007', orderCode: 'OCT-SRC-2026-0150', updatedAt: '2026-11-27T07:40:00Z' },
  { id: '7c000000-0000-4000-8000-000000000003', code: 'TCK-2026-0314', subject: 'Wrong colour on 300 phone cases', category: 'complaint', priority: 'high', status: 'waiting_internal', slaDueAt: '2026-11-27T13:00:00Z', customer: 'Mobile Hub Trading', assignee: null, assignedToMe: false, orderId: '5f1c0a52-0000-4000-8000-000000000008', orderCode: 'OCT-SRC-2026-0139', updatedAt: '2026-11-27T06:15:00Z' },
  { id: '7c000000-0000-4000-8000-000000000001', code: 'TCK-2026-0311', subject: 'Can we change the print colour?', category: 'question', priority: 'normal', status: 'waiting_internal', slaDueAt: '2026-11-28T10:00:00Z', customer: 'Anna Home Trading', assignee: 'Omar Khalid', assignedToMe: false, orderId: '5f1c0a52-0000-4000-8000-000000000001', orderCode: 'OCT-SRC-2026-0207', updatedAt: '2026-11-26T14:00:00Z' },
  { id: '7c000000-0000-4000-8000-000000000004', code: 'TCK-2026-0309', subject: 'Great packaging, thank you', category: 'feedback', priority: 'low', status: 'new', slaDueAt: '2026-11-30T10:00:00Z', customer: 'Cafe Republic', assignee: null, assignedToMe: false, orderId: null, orderCode: null, updatedAt: '2026-11-25T18:00:00Z' },
];
export const SAMPLE_SUPPORT_KPIS: SupportKpis = { open: 14, overdue: 2, mine: 1, csat: { avg: '4.6', n: 38 }, macros: 3 };
export const SAMPLE_MACROS: Macro[] = [
  { id: 'm1', title: 'Photos please', body: 'Could you send photos of the cartons and the damaged items, with the shipping label visible?' },
  { id: 'm2', title: 'Refund timing', body: 'Approved refunds reach your wallet within 2 working days.' },
  { id: 'm3', title: 'Thanks', body: 'Thank you for letting us know — we are on it.' },
];

export function sampleTicket(perms: SupportPerms): TicketDetail {
  return {
    id: '7c000000-0000-4000-8000-000000000002',
    code: 'TCK-2026-0315',
    orgId: 'c0ffee00-0000-4000-8000-000000000007',
    orderId: '5f1c0a52-0000-4000-8000-000000000007',
    subject: '2 cartons crushed in transit',
    category: 'complaint',
    priority: 'urgent',
    status: 'open',
    slaDueAt: '2026-11-27T08:00:00Z',
    csat: null,
    createdAt: '2026-11-26T19:20:00Z',
    customer: { name: 'Little Steps Retail', country: 'OM', kycStatus: 'verified' },
    order: { id: '5f1c0a52-0000-4000-8000-000000000007', code: 'OCT-SRC-2026-0150', status: 'delivered', ...(showSupplierCodes(perms.canSeeSuppliers) ? { supplierCode: 'SUP-0098' } : {}), deliveredAt: '2026-11-20T10:00:00Z', claimVisibleUntil: '2026-11-27T10:00:00Z', claimHiddenUntil: '2027-02-18T10:00:00Z' },
    assignee: 'Lina Farah',
    assignedToMe: true,
    messages: [
      { id: 'tm1', author: 'Hana Said', isStaff: false, internal: false, body: 'Two cartons arrived crushed. About 400 bottles are dented. Photos attached.', attachments: 3, createdAt: '2026-11-26T19:20:00Z' },
      { id: 'tm2', author: 'Lina Farah', isStaff: true, internal: true, body: 'Checked the packing record — cartons left the warehouse intact. Carrier claim likely.', attachments: 0, createdAt: '2026-11-27T06:30:00Z' },
      { id: 'tm3', author: 'Lina Farah', isStaff: true, internal: false, body: 'Thank you, Hana. We are checking with the carrier and will come back today with a resolution.', attachments: 0, createdAt: '2026-11-27T06:35:00Z' },
    ],
    warehouse: null,
    dropship: null,
    escCurrency: 'USD',
  };
}
