import { describe, expect, it } from 'vitest';
import {
  activeServices, companyStatusName, creditSummary, creditTermStatusName, customerPerms, initials, invoiceStatusName, isSupplierDocType, moneySummary,
  openItems, orderServiceLabel, panelVisibility, type SessionLike,
} from '@/app/ods/admin/customers/_lib/customer-logic';
import { STATUS_NAMES } from '@octopus/ui/status';

const NOW = '2026-11-27T12:00:00Z';
const sess = (p: Partial<SessionLike> = {}): SessionLike => ({ userId: 'me', isAdmin: false, roles: [], permissions: [], ...p });

describe('ODS T9 customer record · company status (Appendix C)', () => {
  it('maps kyc_status to the four company names', () => {
    expect(companyStatusName({ kycStatus: 'verified' })).toBe('Verified');
    for (const k of ['submitted', 'in_review', 'more_info']) expect(companyStatusName({ kycStatus: k })).toBe('Verification pending');
    for (const k of ['not_started', 'rejected', null, undefined, 'weird']) expect(companyStatusName({ kycStatus: k })).toBe('Not verified');
    expect(companyStatusName({ kycStatus: 'verified', archivedAt: '2026-01-01' })).toBe('Paused');
  });
  it('only returns Appendix C company names', () => {
    const names = new Set<string>(STATUS_NAMES.company);
    for (const k of ['verified', 'submitted', 'rejected']) expect(names.has(companyStatusName({ kycStatus: k }))).toBe(true);
  });
});

describe('ODS T9 customer record · invoices + money summary', () => {
  const base = { docType: 'commercial_invoice', status: 'issued', amountCents: 10000, paidCents: 0, dueAt: '2026-12-10T00:00:00Z' };
  it('invoice status names', () => {
    expect(invoiceStatusName(base, NOW)).toBe('Sent');
    expect(invoiceStatusName({ ...base, paidCents: 4000 }, NOW)).toBe('Partly paid');
    expect(invoiceStatusName({ ...base, dueAt: '2026-11-01T00:00:00Z', paidCents: 4000 }, NOW)).toBe('Overdue');
    expect(invoiceStatusName({ ...base, paidCents: 10000 }, NOW)).toBe('Paid');
    expect(invoiceStatusName({ ...base, status: 'paid' }, NOW)).toBe('Paid');
    expect(invoiceStatusName({ ...base, status: 'void' }, NOW)).toBe('Cancelled');
    expect(invoiceStatusName({ ...base, docType: 'credit_note' }, NOW)).toBe('Credit note');
    expect(invoiceStatusName({ ...base, status: 'draft' }, NOW)).toBe('Draft');
  });

  it('sums wallet, holds, invoices due, paid in 12 months and the last payment (record currency only)', () => {
    const m = moneySummary(
      {
        currency: 'USD',
        wallets: [{ currency: 'USD', balanceMinor: 425000 }, { currency: 'EUR', balanceMinor: 999 }],
        holds: [{ amountCents: 100000 }, { amountCents: 18000 }],
        invoices: [
          { ...base, amountCents: 287000, currency: 'USD' },
          { ...base, docType: 'proforma_invoice', amountCents: 186000, currency: 'USD' },
          { ...base, amountCents: 64000, dueAt: '2026-11-12T00:00:00Z', currency: 'USD' },
          { ...base, amountCents: 5000, paidCents: 5000, currency: 'USD' },
          { ...base, amountCents: 7000, currency: 'EUR' },
          { ...base, docType: 'credit_note', amountCents: 3000, currency: 'USD' },
        ],
        payments: [
          { amountCents: 229700, status: 'confirmed', method: 'wallet', at: '2026-11-27T10:00:00Z' },
          { amountCents: 255000, status: 'matched', method: 'bank_transfer', at: '2026-10-22T09:00:00Z' },
          { amountCents: 99999, status: 'pending', method: 'bank_transfer', at: '2026-11-26T09:00:00Z' },
          { amountCents: 50000, status: 'confirmed', method: 'bank_transfer', at: '2025-10-01T09:00:00Z' },
        ],
      },
      NOW,
    );
    expect(m.walletAvailableCents).toBe(425000);
    expect(m.heldCents).toBe(118000);
    expect(m.invoicesDueCents).toBe(287000 + 186000 + 64000);
    expect(m.invoicesDueCount).toBe(3);
    expect(m.overdueCount).toBe(1);
    expect(m.paid12mCents).toBe(229700 + 255000);
    expect(m.lastPayment).toEqual({ at: '2026-11-27T10:00:00Z', cents: 229700, method: 'wallet' });
  });

  it('keeps restricted and failed parts apart', () => {
    const m = moneySummary({ currency: 'USD', wallets: 'restricted', holds: null, invoices: 'restricted', payments: null }, NOW);
    expect(m.walletAvailableCents).toBe('restricted');
    expect(m.heldCents).toBeNull();
    expect(m.invoicesDueCents).toBe('restricted');
    expect(m.paid12mCents).toBeNull();
    expect(m.lastPayment).toBeNull();
    expect(moneySummary({ currency: 'USD', wallets: [], holds: [], invoices: [], payments: [] }, NOW).lastPayment).toBe('none');
  });
});

describe('ODS T9 customer record · permission-based panel visibility', () => {
  it('finance sees credit, wallet balance, invoices and supplier documents', () => {
    const v = panelVisibility(customerPerms(sess({ permissions: ['customers:view', 'finance:view', 'wallet:view'] }), 'someone-else'));
    expect(v.credit).toBe(true);
    expect(v.walletBalance).toBe(true);
    expect(v.invoices).toBe(true);
    expect(v.supplierDocuments).toBe(true);
    expect(v.actions.creditTerms).toBe(true);
    expect(v.actions.vip).toBe(false);
    expect(v.actions.payLater).toBe(false);
    expect(v.actions.limits).toBe(false);
  });
  it('sales (no finance) never sees credit, wallet balance or supplier documents', () => {
    const p = customerPerms(sess({ permissions: ['customers:view', 'customers:edit', 'orders:view', 'requests:view'] }), 'someone-else');
    const v = panelVisibility(p);
    expect(v.credit).toBe(false);
    expect(v.walletBalance).toBe(false);
    expect(v.supplierDocuments).toBe(false);
    expect(v.invoices).toBe(true); // orders:view, as today's order page shows documents
    expect(v.actions.services).toBe(true); // customers:edit
    expect(v.actions.limits).toBe(false);
    expect(v.actions.reassign).toBe(false);
  });
  it("the customer's own account manager gets services + limits but no money panels", () => {
    const p = customerPerms(sess({ userId: 'am1', roles: ['account_manager'] }), 'am1');
    expect(p.isMine).toBe(true);
    const v = panelVisibility(p);
    expect(v.actions.services).toBe(true);
    expect(v.actions.limits).toBe(true);
    expect(v.credit).toBe(false);
    expect(v.invoices).toBe(false);
    expect(v.walletBalance).toBe(false);
    expect(v.kycLink).toBe(false);
    // another manager's customer: no services / limits
    const other = panelVisibility(customerPerms(sess({ userId: 'am2', roles: ['account_manager'] }), 'am1'));
    expect(other.actions.services).toBe(false);
    expect(other.actions.limits).toBe(false);
  });
  it('admin sees everything incl. VIP + Pay later; assistant:reassign alone can reassign', () => {
    const v = panelVisibility(customerPerms(sess({ isAdmin: true }), null));
    expect(Object.values(v.actions).every(Boolean)).toBe(true);
    expect(v.credit && v.supplierDocuments && v.walletBalance).toBe(true);
    expect(panelVisibility(customerPerms(sess({ permissions: ['customers:view', 'assistant:reassign'] }), null)).actions.reassign).toBe(true);
  });
  it('accepts permissions as a Set (lib/auth Session)', () => {
    expect(customerPerms(sess({ permissions: new Set(['finance:view']) }), null).finance).toBe(true);
  });
});

describe('ODS T9 customer record · small mappings', () => {
  it('open items link only where the role may open the page', () => {
    const items = openItems(
      {
        rfqs: [{ id: 'r1', code: 'RFQ-1', status: 'quoting', title: 'Lids', quotes: 0 }, { id: 'r2', code: 'RFQ-2', status: 'accepted', title: 'x', quotes: 1 }],
        orders: [{ id: 'o1', code: 'OCT-SRC-1', status: 'balance_pending', totalCents: 10000, paidCents: 4000, currency: 'USD' }, { id: 'o2', code: 'OCT-SRC-2', status: 'delivered', totalCents: 1, paidCents: 1, currency: 'USD' }],
        invoices: null,
        tickets: [{ id: 't1', code: 'TCK-1', subject: 'Labels', status: 'open' }],
        kyc: { id: 'k1', status: 'in_review' },
      },
      { orderLinks: false, requestLinks: true, tickets: false, kycLink: true },
      (c) => `US$ ${(c / 100).toFixed(2)}`,
      (d) => d,
    );
    expect(items.map((i) => i.ref)).toEqual(['KYC', 'RFQ-1', 'OCT-SRC-1']);
    expect(items[1]).toMatchObject({ status: 'Quoting', href: '/office/rfqs/r1' });
    expect(items[2]).toMatchObject({ status: 'Balance due', href: null, detail: 'US$ 60.00 to pay' });
  });
  it('credit summary + term status', () => {
    expect(creditTermStatusName('active')).toBe('Approved');
    expect(creditTermStatusName('pending_approval')).toBe('Waiting');
    expect(creditSummary({ eligible: false, terms: [] })).toBe('Not eligible');
    expect(creditSummary({ eligible: true, terms: [{ limitCents: 1000000, currency: 'USD', netDays: 30, status: 'active' }] })).toBe('US$ 10,000.00 · Net 30');
    expect(creditSummary({ eligible: true, terms: [{ limitCents: 1, currency: 'USD', netDays: 30, status: 'pending_approval' }] })).toBe('Eligible · no terms yet · second approver needed');
  });
  it('services, initials, supplier docs, order service', () => {
    expect(activeServices([{ service: 'brand', status: 'trial' }, { service: 'sourcing', status: 'on' }, { service: 'dropship', status: 'paused' }])).toEqual(['Sourcing', 'Make My Brand']);
    expect(initials('Anna Home Trading')).toBe('AH');
    expect(initials('Acme')).toBe('AC');
    expect(isSupplierDocType('purchase_order')).toBe(true);
    expect(isSupplierDocType('commercial_invoice')).toBe(false);
    expect(orderServiceLabel('OCT-SRC-2026-0207')).toBe('Sourcing');
    expect(orderServiceLabel('OCT-STK-2026-0019')).toBe('Ready stock');
    expect(orderServiceLabel('ORD-1042', 'pool-1')).toBe('MOQ pools');
    expect(orderServiceLabel('ORD-1042')).toBe('—');
  });
});
