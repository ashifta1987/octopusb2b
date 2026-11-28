import { describe, expect, it } from 'vitest';
import {
  BRAND_TABS, LOW_STOCK_COVER_DAYS, LOW_STOCK_SETTING_KEY, lowStockCoverDays, SETTINGS_TABS, SHIPPING_FILTERS, SUPPORT_TABS, TURNKEY_STAGE_STEP, TURNKEY_STEPS, TURNKEY_TABS, WAREHOUSE_TABS,
  brandStatus, kycMode, kycView, odsTone, payStatePill, pickTab, shipmentGroup, stockLevel, supportPrefill, ticketStatus, turnkeyStatusPill,
  turnkeyStepper, warehouseOrderGroup,
} from '@/app/ods/account/_services/logic';
import { TK_PHASES } from '@/lib/turnkey/format';
import { STATUS_NAMES } from '@octopus/ui/status';

describe('turnkey stage → ODS stepper', () => {
  it('maps every one of today\'s 8 phases to a step', () => {
    for (const p of TK_PHASES) expect(TURNKEY_STAGE_STEP[p.code], p.code).toBeDefined();
    expect(TURNKEY_STEPS.map((s) => s.label)).toEqual(['Brief', 'Design and quotes', 'Samples', 'Production', 'QC', 'Shipping']);
  });
  it('documents the mapping', () => {
    const at = (stage: string) => TURNKEY_STEPS[turnkeyStepper({ stage, status: 'open' }).current].id;
    expect(at('enquiry')).toBe('brief');
    expect(at('consultation')).toBe('brief');
    expect(at('design')).toBe('design');
    expect(at('sourcing')).toBe('design');
    expect(at('quote_deposit')).toBe('design');
    expect(at('production_qc')).toBe('production');
    expect(at('shipment')).toBe('shipping');
    expect(at('handover')).toBe('shipping');
    expect(at('unknown_stage')).toBe('brief');
  });
  it('moves Production → QC only once a pre-shipment inspection has started', () => {
    const planned = turnkeyStepper({ stage: 'production_qc', status: 'open', inspections: [{ kind: 'pre_shipment', status: 'planned' }] });
    expect(TURNKEY_STEPS[planned.current].id).toBe('production');
    const audit = turnkeyStepper({ stage: 'production_qc', status: 'open', inspections: [{ kind: 'factory_audit', status: 'published' }] });
    expect(TURNKEY_STEPS[audit.current].id).toBe('production');
    const psi = turnkeyStepper({ stage: 'production_qc', status: 'open', inspections: [{ kind: 'pre_shipment', status: 'scheduled' }] });
    expect(TURNKEY_STEPS[psi.current].id).toBe('qc');
  });
  it('step states: done before, current, upcoming after; Samples carries its note', () => {
    const s = turnkeyStepper({ stage: 'production_qc', status: 'open' });
    expect(s.steps.map((x) => x.status)).toEqual(['done', 'done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(s.steps.find((x) => x.id === 'samples')?.note).toMatch(/No separate sample step/);
    expect(s.errorText).toBeNull();
  });
  it('on hold / cancelled → the current step is an error with the reason; completed → all done', () => {
    const h = turnkeyStepper({ stage: 'consultation', status: 'on_hold', statusReason: 'Waiting for your floor plan' });
    expect(h.steps[0].status).toBe('error');
    expect(h.errorText).toBe('On hold: Waiting for your floor plan');
    expect(turnkeyStepper({ stage: 'design', status: 'cancelled' }).errorText).toBe('Cancelled');
    const c = turnkeyStepper({ stage: 'handover', status: 'completed' });
    expect(c.steps.every((x) => x.status === 'done')).toBe(true);
    expect(c.current).toBe(TURNKEY_STEPS.length - 1);
  });
  it('project status and pay-state pills use Appendix C names / tones', () => {
    expect(turnkeyStatusPill('open')).toEqual({ label: 'Open', tone: 'info' });
    expect(turnkeyStatusPill('on_hold').tone).toBe('warning');
    expect(payStatePill('paid')).toEqual({ label: 'Paid', tone: 'success' });
    expect(payStatePill('part_paid').label).toBe('Partly paid');
    expect(payStatePill('to_pay').label).toBe('Waiting for payment');
    for (const n of ['Paid', 'Partly paid']) expect(STATUS_NAMES.invoices as readonly string[]).toContain(n);
  });
});

describe('support ticket status', () => {
  it('maps every ticket_status to a label, tone and the Open / Closed tab', () => {
    const all = ['new', 'open', 'waiting_customer', 'waiting_internal', 'resolved', 'closed', 'reopened'];
    const groups = Object.fromEntries(all.map((s) => [s, ticketStatus(s).group]));
    expect(groups).toEqual({ new: 'open', open: 'open', waiting_customer: 'open', waiting_internal: 'open', resolved: 'closed', closed: 'closed', reopened: 'open' });
    expect(ticketStatus('waiting_customer')).toEqual({ label: 'Waiting for you', tone: 'warning', group: 'open' });
    expect(ticketStatus('resolved').tone).toBe('success');
    expect(ticketStatus('closed').tone).toBe('neutral');
    expect(ticketStatus('some_new_status')).toEqual({ label: 'some new status', tone: 'neutral', group: 'open' });
  });
});

describe('KYC state labels (Settings › Verification)', () => {
  it('uses the Appendix C company names and today\'s step index', () => {
    expect(kycView('not_started')).toEqual({ name: 'Not verified', label: 'Not verified', tone: 'warning', step: 1 });
    expect(kycView('submitted')).toMatchObject({ name: 'Verification pending', label: 'Verification pending', step: 2 });
    expect(kycView('in_review')).toMatchObject({ name: 'Verification pending', label: 'Being reviewed', step: 2 });
    expect(kycView('more_info')).toMatchObject({ name: 'Not verified', label: 'More information needed', tone: 'warning', step: 1 });
    expect(kycView('rejected')).toMatchObject({ name: 'Not verified', label: 'Not approved', tone: 'danger' });
    expect(kycView('verified')).toEqual({ name: 'Verified', label: 'Verified', tone: 'success', step: 4 });
    expect(kycView(null).name).toBe('Not verified');
    for (const s of ['not_started', 'submitted', 'in_review', 'more_info', 'rejected', 'verified']) expect(STATUS_NAMES.company as readonly string[]).toContain(kycView(s).name);
  });
  it('form mode follows today\'s rules', () => {
    expect(kycMode('verified', true, 0)).toBe('locked');
    expect(kycMode('in_review', true, 0)).toBe('locked');
    expect(kycMode('submitted', true, 1)).toBe('docs');
    expect(kycMode('submitted', true, 0)).toBe('locked');
    expect(kycMode('submitted', false, 2)).toBe('locked');
    expect(kycMode('more_info', true, 0)).toBe('edit');
    expect(kycMode('rejected', true, 0)).toBe('edit');
    expect(kycMode('not_started', false, 2)).toBe('edit');
  });
});

describe('warehouse stock labels', () => {
  it('out of stock / all reserved / low (days of cover) / in stock; unknown cover is never low', () => {
    expect(stockLevel({ available: 0, on_hand: 0, days_cover: null }).label).toBe('Out of stock');
    expect(stockLevel({ available: 0, on_hand: 50, days_cover: 3 }).label).toBe('All reserved');
    expect(stockLevel({ available: 40, on_hand: 240, days_cover: LOW_STOCK_COVER_DAYS - 1 })).toEqual({ id: 'low', label: 'Low stock', tone: 'warning' });
    expect(stockLevel({ available: 40, on_hand: 240, days_cover: LOW_STOCK_COVER_DAYS }).id).toBe('ok');
    expect(stockLevel({ available: 5, on_hand: 5, days_cover: null }).id).toBe('ok');
  });
  it('the threshold comes from the setting (default 14) and is passed in', () => {
    expect(LOW_STOCK_SETTING_KEY).toBe('warehouse.low_stock_cover_days');
    expect(LOW_STOCK_COVER_DAYS).toBe(14);
    expect(lowStockCoverDays(21)).toBe(21);
    expect(lowStockCoverDays('30')).toBe(30);
    expect(lowStockCoverDays(1)).toBe(1);
    expect(lowStockCoverDays(365)).toBe(365);
    for (const bad of [undefined, null, 0, 366, -3, 7.5, 'abc', '', '12 days', true, {}, NaN]) expect(lowStockCoverDays(bad)).toBe(14);
    const row = { available: 40, on_hand: 240, days_cover: 20 };
    expect(stockLevel(row).id).toBe('ok');
    expect(stockLevel(row, 21).id).toBe('low');
    expect(stockLevel(row, 20).id).toBe('ok');
    expect(stockLevel({ ...row, days_cover: null }, 365).id).toBe('ok');
  });
});

describe('shipping groups', () => {
  it('maps every shipment_status', () => {
    const all = ['draft', 'priced', 'created', 'label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'];
    expect(all.map((s) => shipmentGroup(s).group)).toEqual(['preparing', 'preparing', 'preparing', 'preparing', 'in_transit', 'in_transit', 'in_transit', 'delivered', 'problem', 'problem']);
    expect(shipmentGroup('delivered').label).toBe('Delivered');
    expect(warehouseOrderGroup('shipped')).toEqual({ group: 'in_transit', label: 'Shipped', tone: 'info' });
    expect(SHIPPING_FILTERS[0]).toBe('all');
  });
});

describe('helpers', () => {
  it('pickTab keeps only known values', () => {
    expect(pickTab('fees', WAREHOUSE_TABS)).toBe('fees');
    expect(pickTab('send', WAREHOUSE_TABS)).toBe('stock');
    expect(pickTab(undefined, TURNKEY_TABS)).toBe('overview');
    expect(pickTab(['closed', 'open'], SUPPORT_TABS)).toBe('closed');
    expect(pickTab('verification', SETTINGS_TABS)).toBe('verification');
    expect(pickTab('x', BRAND_TABS)).toBe('proofs');
  });
  it('odsTone maps today\'s tone words', () => {
    expect(['green', 'amber', 'red', 'blue', 'gray', 'ok', 'warn', 'bad', 'info', 'neutral'].map(odsTone)).toEqual(['success', 'warning', 'danger', 'info', 'neutral', 'success', 'warning', 'danger', 'info', 'neutral']);
  });
  it('supportPrefill accepts known references and plain subjects only', () => {
    expect(supportPrefill('tkp-00012', null)).toEqual({ subject: 'About TKP-00012', body: 'About TKP-00012: ' });
    expect(supportPrefill('MB-0007', 'Proof')).toEqual({ subject: 'Proof', body: 'About MB-0007: ' });
    expect(supportPrefill('<script>', null)).toBeNull();
    expect(supportPrefill(null, 'Add a team member')?.subject).toBe('Add a team member');
    expect(supportPrefill(null, '   ')).toBeNull();
  });
  it('brand status words', () => {
    expect(brandStatus('proof')).toEqual({ label: 'Proof to approve', tone: 'warning' });
    expect(brandStatus('stocked').tone).toBe('success');
  });
});
