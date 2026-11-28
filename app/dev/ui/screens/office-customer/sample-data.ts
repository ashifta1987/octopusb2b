/**
 * SAMPLE data for the staging-only Customer record fixture (/dev/ui/screens/office-customer). Labelled sample; never used by
 * real pages. Names and figures follow the ERP_Customer board (invented for design review). Visibility comes from the REAL
 * pure mapping (customerPerms + panelVisibility), so the fixture shows exactly what each role would see.
 */
import {
  activeServices, customerPerms, invoiceBalanceCents, invoiceStatusName, moneySummary, openItems, formatCents, currencyLabel, shortDate,
  type CustomerPerms, type PanelVisibility, type SessionLike, type MoneySummary,
} from '@/app/ods/admin/customers/_lib/customer-logic';
import { panelVisibility } from '@/app/ods/admin/customers/_lib/customer-logic';
import type {
  AccountManagerVM, ActivityTabVM, CompanyVM, CreditVM, CustomerActionsVM, CustomerHeaderVM, DocumentsTabVM, InvoiceRowVM, OrderRowVM, OverviewVM, PanelData, RfqRowVM, TeamTabVM, WalletTabVM,
} from '@/app/ods/admin/customers/_lib/types';

export const NOW = '2026-11-27T12:00:00Z';
export const ROLES = [
  ['finance', 'Finance'],
  ['sales', 'Sales'],
  ['account-manager', 'Account manager'],
  ['admin', 'Admin'],
] as const;
export type SampleRole = (typeof ROLES)[number][0];
export const STATES = [
  ['default', 'Default'],
  ['loading', 'Loading'],
  ['error', 'Error per panel'],
  ['empty', 'New customer (empty)'],
  ['second-approver', 'Second approver needed'],
] as const;
export type SampleState = (typeof STATES)[number][0];

const AM_ID = 'sample-am-ravi';
const ME = 'sample-staff-me';

export function sampleSession(role: SampleRole): SessionLike {
  switch (role) {
    case 'finance':
      return { userId: ME, isAdmin: false, roles: ['finance'], permissions: ['customers:view', 'finance:view', 'finance:approve', 'wallet:view', 'orders:view', 'requests:view', 'support:view'] };
    case 'sales':
      return { userId: ME, isAdmin: false, roles: ['operations'], permissions: ['customers:view', 'customers:edit', 'orders:view', 'requests:view', 'support:view', 'assistant:view'] };
    case 'account-manager':
      return { userId: AM_ID, isAdmin: false, roles: ['account_manager'], permissions: ['requests:view'] };
    case 'admin':
      return { userId: ME, isAdmin: true, roles: ['admin'], permissions: [] };
  }
}

export type CustomerSample = {
  perms: CustomerPerms;
  vis: PanelVisibility;
  header: CustomerHeaderVM;
  actions: CustomerActionsVM;
  overview: OverviewVM;
  orders: OrderRowVM[] | null;
  invoices: PanelData<InvoiceRowVM[]>;
  rfqs: RfqRowVM[] | null;
  wallet: WalletTabVM;
  documents: DocumentsTabVM;
  team: TeamTabVM;
  activity: ActivityTabVM;
};

const ORDERS_RAW = [
  { id: 'o1', code: 'OCT-STK-2026-0019', date: '2026-11-27T10:00:00Z', title: 'Pet water fountain × 200', total: 174600, paid: 174600, status: 'delivered' },
  { id: 'o2', code: 'OCT-SRC-2026-0207', date: '2026-10-18T10:00:00Z', title: 'Baking mat set, logo, box', total: 410000, paid: 123000, status: 'balance_pending' },
  { id: 'o3', code: 'OCT-TK-2026-0031', date: '2026-11-16T10:00:00Z', title: 'Pet accessories range', total: 620000, paid: 0, status: 'deposit_pending' },
  { id: 'o4', code: 'OCT-SRC-2026-0198', date: '2026-10-02T10:00:00Z', title: 'Glass food containers', total: 234000, paid: 234000, status: 'shipped' },
  { id: 'o5', code: 'OCT-SRC-2026-0213', date: '2026-11-04T10:00:00Z', title: 'Bamboo storage boxes', total: 512000, paid: 153600, status: 'in_production' },
];
const INVOICES_RAW = [
  { id: 'i1', number: 'INV-2026-0412', docType: 'commercial_invoice', status: 'issued', amount: 287000, paid: 0, due: '2026-12-01T00:00:00Z', issued: '2026-11-20T00:00:00Z' },
  { id: 'i2', number: 'PF-2026-0118', docType: 'proforma_invoice', status: 'issued', amount: 186000, paid: 0, due: '2026-11-30T00:00:00Z', issued: '2026-11-16T00:00:00Z' },
  { id: 'i3', number: 'INV-2026-0371', docType: 'commercial_invoice', status: 'issued', amount: 64000, paid: 0, due: '2026-11-12T00:00:00Z', issued: '2026-10-29T00:00:00Z' },
  { id: 'i4', number: 'INV-2026-0350', docType: 'commercial_invoice', status: 'paid', amount: 229700, paid: 229700, due: '2026-11-27T00:00:00Z', issued: '2026-11-20T00:00:00Z' },
];
const PAYMENTS = [
  { amountCents: 229700, status: 'confirmed', method: 'wallet', at: '2026-11-27T18:42:00Z' },
  { amountCents: 255000, status: 'confirmed', method: 'bank_transfer', at: '2026-10-22T09:00:00Z' },
  { amountCents: 1675700, status: 'confirmed', method: 'bank_transfer', at: '2026-06-02T09:00:00Z' },
];

export function buildSample(role: SampleRole, state: SampleState): CustomerSample {
  const s = sampleSession(role);
  const perms = customerPerms(s, AM_ID);
  const vis = panelVisibility(perms);
  const empty = state === 'empty';
  const err = state === 'error';
  const orders: OrderRowVM[] = empty ? [] : ORDERS_RAW.map((o) => ({ id: o.id, code: o.code, date: o.date, service: o.code.includes('-STK-') ? 'Ready stock' : o.code.includes('-TK-') ? 'Turnkey' : 'Sourcing', title: o.title, totalCents: o.total, paidCents: o.paid, currency: 'USD', status: o.status, href: vis.orderLinks ? '#sample-order' : null }));
  const invRows: InvoiceRowVM[] = empty ? [] : INVOICES_RAW.map((d) => {
    const r = { docType: d.docType, status: d.status, amountCents: d.amount, paidCents: d.paid, dueAt: d.due };
    return { id: d.id, number: d.number, docType: d.docType, issued: d.issued, dueAt: d.due, amountCents: d.amount, paidCents: d.paid, balanceCents: invoiceBalanceCents(r), currency: 'USD', status: invoiceStatusName(r, NOW), href: '#sample-document' };
  });
  const rfqs: RfqRowVM[] = empty ? [] : [
    { id: 'r1', code: 'RFQ-1051', title: '3 products: silicone lids, mats, trays', quantity: '1500 pcs', quotes: 0, created: '2026-11-27T18:10:00Z', status: 'quoting', href: vis.requestLinks ? '#sample-rfq' : null },
    { id: 'r2', code: 'RFQ-1042', title: 'Ceramic pet bowls with logo', quantity: '800 pcs', quotes: 3, created: '2026-11-20T09:00:00Z', status: 'quoted', href: vis.requestLinks ? '#sample-rfq' : null },
    { id: 'r3', code: 'RFQ-0987', title: 'Glass food containers', quantity: '2000 pcs', quotes: 2, created: '2026-09-12T09:00:00Z', status: 'accepted', href: vis.requestLinks ? '#sample-rfq' : null },
  ];
  const money: MoneySummary = moneySummary(
    {
      currency: 'USD',
      wallets: vis.walletBalance ? (empty ? [] : [{ currency: 'USD', balanceMinor: 425000 }]) : 'restricted',
      holds: empty ? [] : [{ amountCents: 118000 }],
      invoices: vis.invoices ? (empty ? [] : INVOICES_RAW.map((d) => ({ docType: d.docType, status: d.status, amountCents: d.amount, paidCents: d.paid, dueAt: d.due, currency: 'USD' }))) : 'restricted',
      payments: vis.invoices ? (empty ? [] : PAYMENTS) : 'restricted',
    },
    NOW,
  );
  const credit: PanelData<CreditVM> = !vis.credit ? 'restricted' : {
    eligible: state === 'second-approver',
    terms: state === 'second-approver'
      ? [{ id: 't1', division: 'SRC', limitCents: 1000000, currency: 'USD', netDays: 30, status: 'pending_approval', overdueBlocked: false, updatedAt: '2026-11-26T10:00:00Z', proposedByMe: true }]
      : [],
  };
  const company: CompanyVM = {
    legalName: 'Anna Home Trading LLC', buyerCode: 'CUS-00418', country: 'United Arab Emirates', city: 'Dubai', businessType: 'Retailer', registrationNo: 'DED 1048832',
    website: 'annahome.example', kycStatus: empty ? 'submitted' : 'verified', kycHref: vis.kycLink ? '#sample-kyc' : null, since: '2026-03-02T00:00:00Z', walletReference: 'AH-7K2Q',
  };
  const am: AccountManagerVM = {
    current: { id: AM_ID, name: 'Ravi Menon', title: 'Account manager', team: 'Sourcing', office: 'Dubai', email: 'ravi@example.com', outOfOffice: false, assignedAt: '2026-03-02T10:00:00Z', assignedBy: 'System', reason: 'Kyc verified', load: 32 },
    cap: 50,
    candidates: perms.reassign ? [{ id: AM_ID, name: 'Ravi Menon', team: 'Sourcing', customers: 32, outOfOffice: false }, { id: 'sample-am-lena', name: 'Lena Fischer', team: 'Sourcing', customers: 41, outOfOffice: false }, { id: 'sample-am-omar', name: 'Omar Khalid', team: 'Turnkey', customers: 50, outOfOffice: true }] : [],
    history: perms.audit ? [{ id: 'h1', title: 'Assigned to Ravi Menon · Kyc verified', actor: 'System', at: '2026-03-02T10:00:00Z', tone: 'info' }] : [],
    auditVisible: perms.audit,
  };
  const activityItems = empty ? [] : [
    { id: 'a1', title: 'Paid checkout CO-2026-0153 from wallet · US$ 2,297.00', actor: 'System', at: '2026-11-27T18:42:00Z', tone: 'success' as const },
    { id: 'a2', title: 'Sent RFQ-1051 (3 products)', actor: 'Anna Khan', at: '2026-11-27T18:10:00Z', tone: 'info' as const },
    { id: 'a3', title: 'Account manager assigned: Ravi Menon', actor: 'System', at: '2026-03-02T10:00:00Z', tone: 'info' as const },
    { id: 'a4', title: 'Verification: In review → Verified', actor: 'Compliance', at: '2026-03-02T09:00:00Z', tone: 'success' as const },
  ];
  const invForOpen = vis.invoices ? invRows.map((d) => ({ id: d.id, number: d.number, status: d.status, balanceCents: d.balanceCents, currency: d.currency, dueAt: d.dueAt })) : null;
  const open = openItems(
    {
      rfqs: rfqs.map((r) => ({ id: r.id, code: r.code, status: r.status, title: r.title, quotes: r.quotes })),
      orders: orders.map((o) => ({ id: o.id, code: o.code, status: o.status, totalCents: o.totalCents, paidCents: o.paidCents, currency: o.currency })),
      invoices: invForOpen,
      tickets: vis.tickets && !empty ? [{ id: 'tk1', code: 'TCK-2291', subject: 'Carton labels for 0207', status: 'open' }] : null,
      kyc: empty ? { id: 'k1', status: 'submitted' } : null,
    },
    vis,
    (c, cur) => formatCents(c, currencyLabel(cur)),
    shortDate,
  ).map((i) => ({ ...i, href: i.href ? '#sample-link' : null }));
  const services = [
    { service: 'sourcing', label: 'Sourcing', status: 'on', plan: 'Growth', updatedAt: '2026-03-04T00:00:00Z' },
    { service: 'dropship', label: 'Dropshipping', status: 'off', plan: '', updatedAt: null },
    { service: 'warehouse', label: '3PL warehouse', status: 'on', plan: '', updatedAt: '2026-05-01T00:00:00Z' },
    { service: 'brand', label: 'Make My Brand', status: 'trial', plan: '', updatedAt: '2026-10-10T00:00:00Z' },
  ];
  const header: CustomerHeaderVM = {
    id: 'sample-org',
    name: 'Anna Home Trading',
    buyerCode: 'CUS-00418',
    city: 'Dubai',
    countryName: 'United Arab Emirates',
    since: '2026-03-02T00:00:00Z',
    status: empty ? 'Verification pending' : 'Verified',
    vip: !empty,
    accountManager: { id: AM_ID, name: 'Ravi Menon', team: 'Sourcing', outOfOffice: false },
    owner: 'Anna Khan',
    services: activeServices(services),
    counts: { orders: orders.length, invoices: vis.invoices ? invRows.length : null, rfqs: rfqs.length, documents: empty ? 0 : vis.supplierDocuments ? 7 : 5, team: empty ? 1 : 3, tickets: empty ? 0 : 1 },
    message: !vis.tickets ? { reason: 'Support · view permission needed' } : empty ? { reason: 'No open support ticket. Customers start conversations from their account.' } : { href: '#sample-ticket' },
    newQuote: !vis.requestLinks ? { reason: 'Requests · view permission needed' } : empty ? { reason: 'Quotes are added to an open request. This customer has none.' } : { href: '#sample-rfq' },
  };
  const actions: CustomerActionsVM = {
    orgId: 'sample-org',
    orgName: 'Anna Home Trading',
    visibility: vis.actions,
    vip: header.vip,
    creditEligible: false,
    accountManager: am,
    services,
    dropshipMarkets: { countries: ['AE', 'SA'], locked: false },
    limits: { maxOrderCents: 1500000, maxMonthCents: 4000000, minMarginPct: 12, setAt: '2026-09-01T00:00:00Z', ownCeiling: perms.isMine && !perms.isAdmin ? { maxAmountCents: 2500000, minMarginPct: 10 } : null },
    kycHref: vis.kycLink ? '#sample-kyc' : null,
    assistantHref: vis.assistantLinks ? '#sample-assistant' : null,
  };
  const allDocs = empty ? [] : [
    { id: 'd1', number: 'INV-2026-0412', type: 'commercial_invoice', supplier: false, amountCents: 287000, currency: 'USD', status: 'issued', created: '2026-11-20T00:00:00Z', href: '#sample-document' },
    { id: 'd2', number: 'PF-2026-0118', type: 'proforma_invoice', supplier: false, amountCents: 186000, currency: 'USD', status: 'issued', created: '2026-11-16T00:00:00Z', href: '#sample-document' },
    { id: 'd3', number: 'QC-2026-0091', type: 'qc_report', supplier: false, amountCents: null, currency: 'USD', status: 'issued', created: '2026-11-10T00:00:00Z', href: '#sample-document' },
    { id: 'd4', number: 'RCPT-2026-0533', type: 'receipt', supplier: false, amountCents: 229700, currency: 'USD', status: 'paid', created: '2026-11-27T00:00:00Z', href: '#sample-document' },
    { id: 'd5', number: 'STMT-2026-11', type: 'statement', supplier: false, amountCents: null, currency: 'USD', status: 'issued', created: '2026-11-01T00:00:00Z', href: '#sample-document' },
    { id: 'd6', number: 'PO-2026-0207', type: 'purchase_order', supplier: true, amountCents: 280000, currency: 'USD', status: 'issued', created: '2026-10-19T00:00:00Z', href: '#sample-document' },
    { id: 'd7', number: 'REM-2026-0088', type: 'remittance', supplier: true, amountCents: 84000, currency: 'USD', status: 'paid', created: '2026-10-25T00:00:00Z', href: '#sample-document' },
  ];
  return {
    perms,
    vis,
    header,
    actions,
    overview: {
      company,
      money: err ? null : money,
      statementHref: vis.invoices && !empty ? '#sample-statement' : null,
      credit: err && credit !== 'restricted' ? null : credit,
      openItems: err ? null : open,
      recentOrders: err ? null : orders.slice(0, 4),
      activity: err ? null : activityItems,
    },
    orders: err ? null : orders,
    invoices: !vis.invoices ? 'restricted' : err ? null : invRows,
    rfqs: err ? null : rfqs,
    wallet: {
      money: err ? null : money,
      reference: 'AH-7K2Q',
      holds: err ? null : empty ? [] : [{ id: 'wh1', at: '2026-11-18T00:00:00Z', service: 'Sourcing', amountCents: 118000, status: 'open' }, { id: 'wh2', at: '2026-09-02T00:00:00Z', service: '3PL warehouse', amountCents: 40000, status: 'captured' }],
      topups: !vis.walletBalance ? 'restricted' : err ? null : empty ? [] : [{ id: 't1', at: '2026-11-26T00:00:00Z', amountCents: 200000, currency: 'USD', method: 'bank_transfer', reference: 'AH-7K2Q', status: 'credited' }],
    },
    documents: {
      documents: err ? null : allDocs.filter((d) => vis.supplierDocuments || !d.supplier),
      kyc: err ? null : [{ id: 'k1', status: empty ? 'submitted' : 'verified', submittedAt: '2026-02-28T00:00:00Z', href: vis.kycLink ? '#sample-kyc' : null }],
      supplierHidden: !vis.supplierDocuments,
    },
    team: {
      members: err ? null : empty ? [{ id: 'm1', name: 'Anna Khan', email: 'anna@example.com', role: 'Owner', joined: '2026-03-01T00:00:00Z' }] : [
        { id: 'm1', name: 'Anna Khan', email: 'anna@example.com', role: 'Owner', joined: '2026-03-01T00:00:00Z' },
        { id: 'm2', name: 'Samir Haddad', email: 'samir@example.com', role: 'Buyer', joined: '2026-04-11T00:00:00Z' },
        { id: 'm3', name: 'Mei Lin', email: 'mei@example.com', role: 'Finance', joined: '2026-06-20T00:00:00Z' },
      ],
      accountManager: am,
    },
    activity: {
      activity: err ? null : activityItems,
      assistant: err ? null : empty ? [] : [{ id: 'as1', title: 'Shipping times to Jebel Ali', status: 'closed', lastAt: '2026-11-21T09:00:00Z', href: vis.assistantLinks ? '#sample-assistant' : null }],
      auditVisible: perms.audit,
    },
  };
}
