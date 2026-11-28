/**
 * SAMPLE data for the My account commerce fixtures (staging only). Uses the Part 6.7 example numbers:
 * wallet US$ 4,250 available / US$ 1,180 held · PF-2026-0112 kitchen deposit US$ 2,550 paid 22 Oct · PF-2026-0118 pet
 * accessories deposit US$ 1,860 due 30 Nov · OCT-SRC-2026-0207 total US$ 4,100, deposit US$ 1,230 paid 24 Oct, balance
 * US$ 2,870 due 1 Dec · RFQ-1042 foldable pet crate quote expiring in 2 days · CO-2026-0153 US$ 2,297 paid by wallet 27 Nov.
 * Never used on live pages.
 */
import { toOrderRow, type OrderSource, type OrderRowVM } from '@/app/ods/account/orders/_lib/order-logic';
import type { OrderDetailVM } from '@/app/ods/account/orders/_lib/order-types';
import { toRequestRow, type RequestRowVM } from '@/app/ods/account/requests/_lib/request-logic';
import type { RequestDetailVM } from '@/app/ods/account/requests/_lib/loaders';
import type { WalletVM } from '@/app/ods/account/wallet/_lib/loaders';
import type { InvoiceRowWithKey } from '@/app/ods/account/invoices/_lib/loaders';
import type { SaasVM } from '@/app/ods/account/invoices/_components/saas-plans';

const o = (p: Partial<OrderSource> & Pick<OrderSource, 'id' | 'code' | 'title' | 'status' | 'total_cents'>): OrderSource => ({
  quantity: 1000,
  paid_cents: 0,
  deposit_cents: Math.round(p.total_cents * 0.3),
  currency: 'USD',
  created_at: '2026-10-18T09:00:00Z',
  updated_at: '2026-11-26T09:00:00Z',
  delivered_at: null,
  service: 'sourcing',
  pool: false,
  hasShipment: false,
  ...p,
});

export const SAMPLE_ORDER_SOURCES: OrderSource[] = [
  o({ id: 'o1', code: 'OCT-SRC-2026-0207', title: 'Baking mat set, logo, colour box', status: 'balance_pending', total_cents: 410000, deposit_cents: 123000, paid_cents: 123000, quantity: 2000, updated_at: '2026-11-27T08:00:00Z' }),
  o({ id: 'o2', code: 'OCT-SRC-2026-0213', title: 'Bamboo storage box', status: 'in_production', total_cents: 156000, paid_cents: 46800, updated_at: '2026-11-25T08:00:00Z' }),
  o({ id: 'o3', code: 'OCT-TK-2026-0031', title: 'Pet accessories range', status: 'deposit_pending', total_cents: 620000, deposit_cents: 186000, service: 'turnkey', updated_at: '2026-11-24T08:00:00Z' }),
  o({ id: 'o4', code: 'OCT-SRC-2026-0198', title: 'Glass food containers', status: 'shipped', total_cents: 234000, paid_cents: 234000, hasShipment: true, updated_at: '2026-11-22T08:00:00Z' }),
  o({ id: 'o5', code: 'OCT-PL-2026-0012', title: 'Foldable pet crate', status: 'in_production', total_cents: 112000, paid_cents: 33600, service: 'pools', pool: true, updated_at: '2026-11-20T08:00:00Z' }),
  o({ id: 'o6', code: 'OCT-SRC-2026-0187', title: 'LED desk lamp', status: 'delivered', total_cents: 124000, paid_cents: 124000, delivered_at: '2026-11-12T08:00:00Z', updated_at: '2026-11-12T08:00:00Z' }),
  o({ id: 'o7', code: 'OCT-SRC-2026-0176', title: 'Kitchen utensil set', status: 'qc', total_cents: 850000, deposit_cents: 255000, paid_cents: 255000, updated_at: '2026-11-19T08:00:00Z' }),
];
export const SAMPLE_ORDER_ROWS: OrderRowVM[] = SAMPLE_ORDER_SOURCES.map(toOrderRow);

const steps = (details: (string | undefined)[]) =>
  (['quote', 'deposit', 'production', 'qc', 'balance', 'shipping', 'delivered'] as const).map((key, i) => ({
    key,
    label: ['Quote', 'Deposit', 'Production', 'Quality check', 'Balance', 'Shipping', 'Delivered'][i],
    detail: details[i],
  }));

export const SAMPLE_ORDER: OrderDetailVM = {
  id: '00000000-0000-4000-8000-000000000207',
  ref: 'OCT-SRC-2026-0207',
  title: 'Silicone baking mat set, logo print and colour box',
  quantity: 2000,
  currency: 'USD',
  service: 'sourcing',
  statusName: 'Balance due',
  rawStatus: 'balance_pending',
  dispute: false,
  createdAt: '2026-10-18T09:00:00Z',
  incoterm: 'FOB',
  piNumber: 'PF-2026-0121',
  rfqRef: 'RFQ-1033',
  money: { totalCents: 410000, depositCents: 123000, depositPct: 30, paidCents: 123000, balanceCents: 287000, due: { purpose: 'balance', amount: 287000 } },
  steps: steps(['Accepted 18 Oct 2026', 'Paid 24 Oct 2026', undefined, 'Report 26 Nov 2026', 'Due now', undefined, undefined]),
  current: 4,
  showPayment: true,
  payment: {
    service: 'sourcing',
    currencyCode: 'USD',
    amountCents: 287000,
    duePurpose: 'balance',
    choices: { wallet: true, online: true, protection: true, protectionWallet: true, protectionOnline: true },
    walletBalanceCents: 425000,
    walletCreditCents: 0,
    reference: 'PF-2026-0121',
    bankLines: [
      ['Bank', '[BANK NAME]'],
      ['Account name', '[ACCOUNT NAME]'],
      ['Account number', '[ACCOUNT NUMBER]'],
      ['SWIFT', '[SWIFT]'],
    ],
    bankNotes: 'Usually credited within [DAYS] business days after the money arrives.',
    providerName: '[Card provider]',
    providerSurcharge: true,
    hold: null,
    payLater: null,
    reservation: null,
  },
  items: [{ title: 'Silicone baking mat set, logo print and colour box', quantity: 2000, unit: 'units', unitCents: 205, totalCents: 410000 }],
  documents: [
    { id: 'd1', type: 'proforma_invoice', typeLabel: 'Proforma invoice', number: 'PF-2026-0121', amountCents: 410000, currency: 'USD', statusName: 'Partly paid', createdAt: '2026-10-18T09:00:00Z' },
    { id: 'd2', type: 'receipt', typeLabel: 'Receipt', number: 'RC-2026-0310', amountCents: 123000, currency: 'USD', statusName: 'Paid', createdAt: '2026-10-24T09:00:00Z' },
    { id: 'd3', type: 'qc_report', typeLabel: 'QC report', number: 'QC-2026-0044', amountCents: null, currency: 'USD', statusName: 'Sent', createdAt: '2026-11-26T09:00:00Z' },
  ],
  qc: { docId: 'd3', number: 'QC-2026-0044', date: '2026-11-26T09:00:00Z' },
  qcReached: true,
  payments: [{ id: 'p1', purpose: 'Deposit', method: 'Wallet', amountCents: 123000, currency: 'USD', statusName: 'Paid', at: '2026-10-24T09:00:00Z', reference: null }],
  shipment: null,
  tracking: [],
  shippingFailed: false,
  tickets: [{ id: 't1', code: 'TCK-0091', subject: 'Carton size for the colour box', open: false, updatedAt: '2026-11-02T09:00:00Z' }],
  timeline: [
    { id: 'e3', title: 'Quality check passed', body: '2,000 sets checked; 0 major, 3 minor issues (fixed).', at: '2026-11-26T09:00:00Z' },
    { id: 'e2', title: 'Production started', body: null, at: '2026-10-26T09:00:00Z' },
    { id: 'e1', title: 'Deposit received', body: 'US$ 1,230.00 from your wallet', at: '2026-10-24T09:00:00Z' },
  ],
  cancellable: false,
  claim: null,
  justCreated: false,
};

export const SAMPLE_ORDER_DEPOSIT: OrderDetailVM = {
  ...SAMPLE_ORDER,
  id: '00000000-0000-4000-8000-000000000031',
  ref: 'OCT-TK-2026-0031',
  title: 'Pet accessories range',
  quantity: 1200,
  service: 'turnkey',
  statusName: 'Deposit due',
  rawStatus: 'deposit_pending',
  piNumber: 'PF-2026-0118',
  rfqRef: null,
  money: { totalCents: 620000, depositCents: 186000, depositPct: 30, paidCents: 0, balanceCents: 620000, due: { purpose: 'deposit', amount: 186000 } },
  steps: steps(['Accepted 20 Nov 2026', 'Due 30 Nov 2026', undefined, undefined, undefined, undefined, undefined]),
  current: 1,
  payment: { ...SAMPLE_ORDER.payment!, service: 'turnkey', amountCents: 186000, duePurpose: 'deposit', reference: 'PF-2026-0118', walletBalanceCents: 125000, choices: { wallet: true, online: false, protection: false, protectionWallet: false, protectionOnline: false } },
  items: [{ title: 'Pet accessories range', quantity: 1200, unit: 'units', unitCents: null, totalCents: null }],
  documents: [{ id: 'd5', type: 'proforma_invoice', typeLabel: 'Proforma invoice', number: 'PF-2026-0118', amountCents: 186000, currency: 'USD', statusName: 'Sent', createdAt: '2026-11-20T09:00:00Z' }],
  qc: null,
  qcReached: false,
  payments: [],
  tickets: [],
  timeline: [{ id: 'e1', title: 'Quote accepted, proforma PF-2026-0118 issued', body: null, at: '2026-11-20T09:00:00Z' }],
  cancellable: true,
  justCreated: true,
};

export const SAMPLE_ORDER_SHIPPED: OrderDetailVM = {
  ...SAMPLE_ORDER,
  id: '00000000-0000-4000-8000-000000000198',
  ref: 'OCT-SRC-2026-0198',
  title: 'Glass food containers',
  quantity: 3000,
  statusName: 'Shipped',
  rawStatus: 'shipped',
  piNumber: 'PF-2026-0102',
  rfqRef: 'RFQ-1011',
  money: { totalCents: 234000, depositCents: 70200, depositPct: 30, paidCents: 234000, balanceCents: 0, due: null },
  steps: steps(['Accepted 2 Oct 2026', 'Paid 4 Oct 2026', undefined, 'Report 10 Nov 2026', 'Paid 12 Nov 2026', 'Arrives about 9 Dec 2026', undefined]),
  current: 5,
  showPayment: false,
  payment: { ...SAMPLE_ORDER.payment!, amountCents: 0, duePurpose: null, choices: { wallet: false, online: false, protection: false, protectionWallet: false, protectionOnline: false } },
  items: [{ title: 'Glass food containers', quantity: 3000, unit: 'units', unitCents: 78, totalCents: 234000 }],
  shipment: { code: 'SHP-2026-0144', method: 'Standard', trackingNo: 'MSKU1234567', status: 'In transit', eta: '2026-12-09T00:00:00Z', parcels: 20, weightKg: 360, carrier: 'Octopus B2B shipping', location: 'Port of Singapore', updatedAt: '2026-11-26T09:00:00Z' },
  tracking: [
    { id: 'tr2', title: 'Transhipment', location: 'Port of Singapore', at: '2026-11-26T09:00:00Z' },
    { id: 'tr1', title: 'Departed', location: 'Shenzhen, Yantian', at: '2026-11-20T09:00:00Z' },
  ],
};

export const SAMPLE_ORDER_PROTECTED: OrderDetailVM = {
  ...SAMPLE_ORDER,
  statusName: 'In production',
  rawStatus: 'in_production',
  money: { ...SAMPLE_ORDER.money, due: null },
  steps: steps(['Accepted 18 Oct 2026', 'Paid 24 Oct 2026', undefined, undefined, undefined, undefined, undefined]),
  current: 2,
  payment: {
    ...SAMPLE_ORDER.payment!,
    choices: { wallet: false, online: false, protection: false, protectionWallet: false, protectionOnline: false },
    hold: { id: 'h1', heldCents: 118000, currency: 'USD', milestone: 'QC passed and shipped', statusName: 'Held', disputed: false, disputeReason: null, canDispute: true },
  },
  qc: null,
  qcReached: false,
};

export const SAMPLE_ORDER_CANCELLED: OrderDetailVM = {
  ...SAMPLE_ORDER_DEPOSIT,
  statusName: 'Cancelled',
  rawStatus: 'cancelled',
  money: { ...SAMPLE_ORDER_DEPOSIT.money, due: null },
  current: -1,
  showPayment: false,
  payment: null,
  cancellable: false,
  justCreated: false,
};

/** Credit-eligible company (internal Pay later, Part 1 rule 8): today's Pay later option appears only here. */
export const SAMPLE_ORDER_CREDIT: OrderDetailVM = {
  ...SAMPLE_ORDER,
  payment: {
    ...SAMPLE_ORDER.payment!,
    payLater: { allowed: true, netDays: 30, availableCents: 1500000, limitCents: 2000000, unpaidCents: 300000, reservedCents: 200000, disabledReason: null },
  },
};

export const SAMPLE_ORDER_PANEL_ERRORS: OrderDetailVM = { ...SAMPLE_ORDER, payment: null, documents: null, payments: null, tickets: null, timeline: null, shippingFailed: true };

/* ───────── requests ───────── */

export const SAMPLE_REQUEST_ROWS: RequestRowVM[] = [
  { kind: 'rfq' as const, id: 'r1', ref: 'RFQ-1051', title: 'Desk organiser', quantity: 1000, unit: 'units', type: 'sourcing' as const, raw: 'quoting', quotes: 0, newQuotes: 0, created_at: '2026-11-27T08:00:00Z', order: null },
  { kind: 'rfq' as const, id: 'r2', ref: 'RFQ-1042', title: 'Foldable pet crate', quantity: 500, unit: 'units', type: 'sourcing' as const, raw: 'quoted', quotes: 3, newQuotes: 2, created_at: '2026-11-18T08:00:00Z', order: null },
  { kind: 'rfq' as const, id: 'r3', ref: 'RFQ-1033', title: 'Silicone baking mats', quantity: 2000, unit: 'sets', type: 'sourcing' as const, raw: 'accepted', quotes: 2, newQuotes: 0, created_at: '2026-10-10T08:00:00Z', order: { id: 'o1', code: 'OCT-SRC-2026-0207', status: 'balance_pending' } },
  { kind: 'service' as const, id: 'r4', ref: 'SRV-0088', title: 'Sample: LED desk lamp', quantity: 1, unit: null, type: 'sample' as const, raw: 'report_ready', quotes: 0, newQuotes: 0, created_at: '2026-11-20T08:00:00Z', order: null },
  { kind: 'rfq' as const, id: 'r5', ref: 'RFQ-1020', title: 'Ceramic mugs', quantity: 800, unit: 'units', type: 'sourcing' as const, raw: 'expired', quotes: 1, newQuotes: 0, created_at: '2026-09-02T08:00:00Z', order: null },
].map(toRequestRow);

const quote = (i: number, code: string, unit: number, moq: number, lead: number, sample: number, isNew: boolean) => ({
  id: `q${i}`,
  code,
  option: `Option ${'ABC'[i]}`,
  factory: 'Verified factory · China (Zhejiang)',
  unitCents: unit,
  quantity: 500,
  totalCents: unit * 500,
  depositCents: Math.round((unit * 500 * 30) / 100),
  currency: 'USD',
  moq,
  leadDays: lead,
  incoterm: 'FOB',
  validUntil: '2026-11-29T18:00:00Z',
  sampleCents: sample,
  notes: null,
  isNew,
  approvable: true,
  state: 'Open',
});

export const SAMPLE_REQUEST: RequestDetailVM = {
  kind: 'rfq',
  id: '00000000-0000-4000-8000-000000001042',
  ref: 'RFQ-1042',
  title: 'Foldable pet crate',
  typeLabel: 'Product sourcing',
  statusName: 'Quote ready',
  createdAt: '2026-11-18T08:00:00Z',
  unit: 'units',
  steps: [
    { label: 'Sent', status: 'done' },
    { label: 'Quoting', status: 'done' },
    { label: 'Quote ready', status: 'current' },
    { label: 'Accepted', status: 'upcoming' },
    { label: 'Ordered', status: 'upcoming' },
  ],
  details: [
    ['Product', 'Foldable pet crate'],
    ['Quantity', '500 units'],
    ['Destination', 'United Arab Emirates, Dubai'],
    ['Incoterm', 'FOB'],
    ['Expires', '29 Nov 2026'],
  ],
  lines: [],
  quotes: [quote(0, 'Q-2026-0611', 1180, 500, 25, 3500, true), quote(1, 'Q-2026-0612', 1260, 300, 20, 3000, true), quote(2, 'Q-2026-0613', 1090, 1000, 35, 4000, false)],
  expiresSoon: { code: 'Q-2026-0611', until: '2026-11-29T18:00:00Z' },
  order: null,
  messages: [
    { id: 'm1', fromStaff: false, body: 'Can the crate fold flat for shipping?', at: '2026-11-19T08:00:00Z' },
    { id: 'm2', fromStaff: true, body: 'Yes — all three options fold to 9 cm. Option B has a washable tray.', at: '2026-11-19T12:00:00Z' },
  ],
  files: [{ id: 'f1', name: 'crate-reference.jpg', kind: 'Photo', fromStaff: false, at: '2026-11-18T08:00:00Z' }],
  docs: [],
  fee: null,
  depositPct: 30,
  termsVersion: 'v3.2',
  hasNewQuotes: true,
  timeline: [
    { id: 'q2', title: 'Option C received', body: 'Q-2026-0613', at: '2026-11-25T08:00:00Z' },
    { id: 'm2', title: 'Message from the sourcing team', at: '2026-11-19T12:00:00Z' },
    { id: 'sent', title: 'Request RFQ-1042 sent', at: '2026-11-18T08:00:00Z' },
  ],
};

export const SAMPLE_REQUEST_QUOTING: RequestDetailVM = {
  ...SAMPLE_REQUEST,
  ref: 'RFQ-1051',
  title: 'Desk organiser',
  statusName: 'Quoting',
  steps: [
    { label: 'Sent', status: 'done' },
    { label: 'Quoting', status: 'current' },
    { label: 'Quote ready', status: 'upcoming' },
    { label: 'Accepted', status: 'upcoming' },
    { label: 'Ordered', status: 'upcoming' },
  ],
  quotes: [],
  expiresSoon: null,
  messages: [],
  files: [],
  hasNewQuotes: false,
  fee: { cents: 2500, currency: 'USD', label: 'Sourcing request fee' },
};

export const SAMPLE_REQUEST_ACCEPTED: RequestDetailVM = {
  ...SAMPLE_REQUEST,
  ref: 'RFQ-1033',
  title: 'Silicone baking mats',
  statusName: 'Accepted',
  steps: ['Sent', 'Quoting', 'Quote ready', 'Accepted', 'Ordered'].map((label) => ({ label, status: 'done' as const })),
  quotes: SAMPLE_REQUEST.quotes.slice(0, 2).map((q, i) => ({ ...q, approvable: false, isNew: false, state: i === 0 ? 'Accepted' : 'Not selected' })),
  expiresSoon: null,
  order: { ref: 'OCT-SRC-2026-0207', statusName: 'Balance due' },
  docs: [{ id: 'd1', number: 'PF-2026-0121', type: 'Proforma invoice', at: '2026-10-18T09:00:00Z' }],
  hasNewQuotes: false,
};

export const SAMPLE_REQUEST_CLOSED: RequestDetailVM = {
  ...SAMPLE_REQUEST,
  ref: 'RFQ-1020',
  title: 'Ceramic mugs',
  statusName: 'Closed',
  steps: [
    { label: 'Sent', status: 'done' },
    { label: 'Quoting', status: 'done' },
    { label: 'Quote ready', status: 'done' },
    { label: 'Accepted', status: 'upcoming' },
    { label: 'Ordered', status: 'upcoming' },
  ],
  quotes: SAMPLE_REQUEST.quotes.slice(0, 1).map((q) => ({ ...q, approvable: false, isNew: false, state: 'Expired' })),
  expiresSoon: null,
  hasNewQuotes: false,
};

export const SAMPLE_REQUEST_SERVICE: RequestDetailVM = {
  ...SAMPLE_REQUEST,
  kind: 'service',
  ref: 'SRV-0088',
  title: 'Sample: LED desk lamp',
  typeLabel: 'Sample',
  statusName: 'Accepted',
  steps: [
    { label: 'Sent', status: 'done' },
    { label: 'In review', status: 'done' },
    { label: 'Accepted', status: 'done' },
    { label: 'Done', status: 'current' },
  ],
  details: [
    ['Product', 'LED desk lamp'],
    ['Quantity', '1'],
    ['Destination country', 'United Arab Emirates'],
  ],
  quotes: [],
  expiresSoon: null,
  hasNewQuotes: false,
  fee: { cents: 3500, currency: 'USD', label: 'Sample fee' },
};

export const SAMPLE_REQUEST_PANEL_ERRORS: RequestDetailVM = { ...SAMPLE_REQUEST, messages: null, files: null };

/* ───────── wallet ───────── */

export const SAMPLE_WALLET_VM: WalletVM = {
  orgId: 'sample-org',
  walletEnabled: true,
  summary: { reference: 'AH-7K2Q', availableCents: 425000, onHoldCents: 118000, pendingCents: 25000 },
  bank: {
    lines: [
      ['Bank', '[BANK NAME]'],
      ['Account name', '[ACCOUNT NAME]'],
      ['Account number', '[ACCOUNT NUMBER]'],
      ['SWIFT', '[SWIFT]'],
    ],
    notes: 'Usually credited within [DAYS] business days after the money arrives.',
  },
  bankFailed: false,
  transactions: [
    { id: 't5', at: '2026-11-27T10:00:00Z', memo: 'Checkout CO-2026-0153 paid by wallet', journal: 'JR-2026-0912', creditCents: 0, debitCents: 229700, balanceCents: 425000, currency: 'USD' },
    { id: 't4', at: '2026-11-26T10:00:00Z', memo: 'Funds added (bank transfer)', journal: 'JR-2026-0905', creditCents: 500000, debitCents: 0, balanceCents: 654700, currency: 'USD' },
    { id: 't3', at: '2026-11-21T10:00:00Z', memo: 'Parcel to Riyadh', journal: 'JR-2026-0871', creditCents: 0, debitCents: 2410, balanceCents: 154700, currency: 'USD' },
    { id: 't2', at: '2026-11-20T10:00:00Z', memo: 'Sample SRV-0088', journal: 'JR-2026-0866', creditCents: 0, debitCents: 3500, balanceCents: 157110, currency: 'USD' },
    { id: 't1', at: '2026-10-22T10:00:00Z', memo: 'Kitchen deposit PF-2026-0112', journal: 'JR-2026-0712', creditCents: 0, debitCents: 255000, balanceCents: 160610, currency: 'USD' },
  ],
  holds: [{ id: 'h1', at: '2026-11-10T10:00:00Z', service: 'Make My Brand', ref: 'OCT-MMB-2026-0009', amountCents: 118000, statusName: 'Held', capturedCents: 0 }],
  transfers: [
    { id: 'w2', at: '2026-11-27T09:00:00Z', claimedCents: 25000, receivedCents: null, note: null, bankRef: null, statusName: 'Pending', rejectReason: null },
    { id: 'w1', at: '2026-11-25T09:00:00Z', claimedCents: 500000, receivedCents: 500000, note: null, bankRef: 'FT2611-88', statusName: 'Paid', rejectReason: null },
  ],
  due: {
    totalUsdCents: 473000,
    otherCurrencies: [],
    items: [
      { id: 'o1', kind: 'order', ref: 'OCT-SRC-2026-0207', cents: 287000, currency: 'USD', href: '/account/orders/OCT-SRC-2026-0207#payment' },
      { id: 'o3', kind: 'order', ref: 'OCT-TK-2026-0031', cents: 186000, currency: 'USD', href: '/account/orders/OCT-TK-2026-0031#payment' },
    ],
  },
  range: { from: '2026-10-27', to: '2026-11-27' },
};

export const SAMPLE_WALLET_NEW: WalletVM = {
  ...SAMPLE_WALLET_VM,
  summary: { reference: 'AH-7K2Q', availableCents: 0, onHoldCents: 0, pendingCents: 0 },
  transactions: [],
  holds: [],
  transfers: [],
  due: { totalUsdCents: 0, otherCurrencies: [], items: [] },
};

export const SAMPLE_WALLET_ERRORS: WalletVM = { ...SAMPLE_WALLET_VM, summary: null, transactions: null, holds: null, transfers: null, due: null, bank: null, bankFailed: true };
export const SAMPLE_WALLET_OFF: WalletVM = { ...SAMPLE_WALLET_VM, walletEnabled: false, bank: null, bankFailed: false };

/* ───────── invoices ───────── */

const inv = (p: Partial<InvoiceRowWithKey> & Pick<InvoiceRowWithKey, 'id' | 'type' | 'typeLabel' | 'number' | 'statusName'>): InvoiceRowWithKey => ({
  service: 'Sourcing',
  forRef: null,
  createdAt: '2026-11-22T09:00:00Z',
  dueAt: null,
  amountCents: 0,
  currency: 'USD',
  payableCents: 0,
  idempotencyKey: null,
  ...p,
});

export const SAMPLE_INVOICES: InvoiceRowWithKey[] = [
  inv({ id: 'i7', type: 'receipt', typeLabel: 'Receipt', number: 'CO-2026-0153', statusName: 'Paid', service: 'Wallet top-up', amountCents: 229700, createdAt: '2026-11-27T09:00:00Z' }),
  inv({ id: 'i1', type: 'proforma_invoice', typeLabel: 'Proforma invoice', number: 'PF-2026-0118', statusName: 'Sent', service: 'Turnkey', forRef: 'OCT-TK-2026-0031', amountCents: 186000, dueAt: '2026-11-30T00:00:00Z', payableCents: 186000, idempotencyKey: 'wallet:sample:0000000000000000' }),
  inv({ id: 'i2', type: 'commercial_invoice', typeLabel: 'Invoice', number: 'OCT-SRC-2026-0207', statusName: 'Partly paid', forRef: 'OCT-SRC-2026-0207', amountCents: 410000, createdAt: '2026-11-25T09:00:00Z' }),
  inv({ id: 'i3', type: 'commercial_invoice', typeLabel: 'Invoice', number: 'OCT-SHP-2026-0044', statusName: 'Paid', service: 'Shipping', amountCents: 2410, createdAt: '2026-11-21T09:00:00Z' }),
  inv({ id: 'i4', type: 'credit_note', typeLabel: 'Credit note', number: 'CN-2026-0007', statusName: 'Credit note', amountCents: 12000, createdAt: '2026-11-18T09:00:00Z' }),
  inv({ id: 'i5', type: 'proforma_invoice', typeLabel: 'Proforma invoice', number: 'PF-2026-0112', statusName: 'Paid', service: 'Sourcing', forRef: 'OCT-SRC-2026-0176', amountCents: 255000, createdAt: '2026-10-22T09:00:00Z' }),
  inv({ id: 'i6', type: 'statement', typeLabel: 'Statement', number: 'STMT-DS-2026-10', statusName: 'Sent', service: 'Dropshipping', amountCents: null, createdAt: '2026-11-01T09:00:00Z' }),
];

/* ───────── SaaS plans panel ───────── */

export const SAMPLE_SAAS: SaasVM = {
  plans: [
    { code: 'DS-GROWTH-M', service: 'dropship', name: 'Dropshipping Growth', description: 'Up to 500 pushed products and 2 stores.', billing_interval: 'monthly', price_cents: 4900, currency: 'USD' },
    { code: '3PL-STD-Y', service: 'warehouse', name: 'Warehouse Standard', description: 'Inventory dashboard and inbound planning.', billing_interval: 'annual', price_cents: 49000, currency: 'USD' },
  ],
  subscriptions: [{ id: 's1', plan_code: 'DS-STARTER-M', status: 'active', payment_option: 'pay_now', current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z' }],
  creditEligible: false,
  creditAvailableCents: 0,
  netDays: 30,
  hasOnlineProvider: true,
};

/** Credit-eligible company: today's panel adds Pay later (Net N); the annual plan exceeds the sample available credit. */
export const SAMPLE_SAAS_CREDIT: SaasVM = { ...SAMPLE_SAAS, creditEligible: true, creditAvailableCents: 20000 };
