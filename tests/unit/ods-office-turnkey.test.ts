import { describe, expect, it } from 'vitest';
import {
  feeRatio, inspectionBlocked, inspectionStartingCents, isProjectTab, kpiItems, odsTone, overviewTab, phaseSteps, phaseTab, projectFilters, projectsHref, recordGates, tripBlocked, turnkeySections,
  type GateInput,
} from '@/app/ods/admin/turnkey/_lib/turnkey-logic';

const money = (c: number | null | undefined) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);
const base = (o: Partial<GateInput> = {}): GateInput => ({
  project: { stage: 'design', status: 'open' }, isAdmin: false, edit: true, stages: [], fees: [], drawings: { versions: [], extras: [] },
  quotes: { quotes: [], factory_quotes: [], deposit_pct: 30 }, inspections: [], shipping: { balance_state: 'no_quote', shipments: [], documents: [] }, ...o,
});

describe('ODS T9 turnkey · sections, tabs, filters', () => {
  it('section menu = today (approvals + settings for admins only), same test ids', () => {
    expect(turnkeySections(false).map((s) => s.key)).toEqual(['dashboard', 'projects', 'catalogue', 'services', 'reports', 'leads']);
    expect(turnkeySections(true).map((s) => s.testid)).toContain('tk-admin-fee-approvals');
    expect(turnkeySections(true).map((s) => s.key)).toContain('settings');
  });
  it('overview tab + project tab parsing', () => {
    expect(overviewTab('services')).toBe('services');
    expect(overviewTab('nope')).toBe('dashboard');
    expect(isProjectTab('qc')).toBe(true);
    expect(isProjectTab('x')).toBe(false);
    expect(phaseTab('production_qc')).toBe('qc');
    expect(phaseTab('enquiry')).toBe('overview');
  });
  it('project filters = today (stage whitelist, status default active, q cleaned, mine)', () => {
    expect(projectFilters({})).toEqual({ stage: '', status: 'active', q: '', mine: false });
    expect(projectFilters({ stage: 'design', status: 'on_hold', q: "TKP-0001'; drop", mine: '1' })).toEqual({ stage: 'design', status: 'on_hold', q: 'TKP-0001 drop', mine: true });
    expect(projectFilters({ stage: 'evil', status: 'weird' }).stage).toBe('');
    expect(projectsHref({ stage: 'design', status: 'active', q: '', mine: false }, { mine: '1' })).toBe('/admin/turnkey/projects?stage=design&mine=1');
    expect(projectsHref({ stage: 'design', status: 'open', q: '', mine: true }, { stage: '', mine: '' })).toBe('/admin/turnkey/projects?status=open');
  });
  it('tones map to ODS', () => {
    expect(odsTone('amber')).toBe('warning');
    expect(odsTone('green')).toBe('success');
    expect(odsTone('zzz')).toBe('neutral');
  });
});

describe('ODS T9 turnkey · phase stepper', () => {
  const rows = [{ stage: 'enquiry', started_at: '2026-03-02', completed_at: '2026-03-04', due_on: null }];
  it('current phase is current; earlier done; later upcoming', () => {
    const { steps, current } = phaseSteps('design', 'open', rows, (d) => d);
    expect(steps).toHaveLength(8);
    expect(current).toBe(2);
    expect(steps[0].status).toBe('done');
    expect(steps[2].status).toBe('current');
    expect(steps[3].status).toBe('upcoming');
    expect(steps[0].detail).toBe('Done 2026-03-04');
  });
  it('on hold shows the phase as needing attention, in words', () => {
    const { steps } = phaseSteps('design', 'on_hold', rows, (d) => d);
    expect(steps[2]).toMatchObject({ status: 'error', errorText: 'On hold' });
  });
  it('completed = every step done', () => {
    const r = phaseSteps('handover', 'completed', rows, (d) => d);
    expect(r.current).toBe(8);
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
  });
});

describe('ODS T9 turnkey · record gates (today’s rules)', () => {
  it('next fee state: none → pending → approved → paid', () => {
    expect(recordGates(base(), money).nextFee).toBe('none');
    expect(recordGates(base({ fees: [{ stage: 'sourcing', status: 'pending_approval', paid: false, service_code: null, amount_cents: 1 }] }), money).nextFee).toBe('pending');
    expect(recordGates(base({ fees: [{ stage: 'sourcing', status: 'active', paid: false, service_code: null, amount_cents: 1 }] }), money).nextFee).toBe('approved');
    expect(recordGates(base({ fees: [{ stage: 'sourcing', status: 'active', paid: true, service_code: null, amount_cents: 1 }] }), money).nextFee).toBe('paid');
  });
  it('default fee stage = first paid phase after the current one without an active fee', () => {
    expect(recordGates(base(), money).defaultStage).toBe('sourcing');
    expect(recordGates(base({ fees: [{ stage: 'sourcing', status: 'active', paid: true, service_code: null, amount_cents: 1 }] }), money).defaultStage).toBe('quote_deposit');
  });
  it('drawing upload gates', () => {
    expect(recordGates(base({ project: { stage: 'design', status: 'on_hold' } }), money).uploadBlocked).toBe('Reopen the project to share drawings.');
    expect(recordGates(base({ project: { stage: 'sourcing', status: 'open' } }), money).uploadBlocked).toBe('Drawings are shared in the Design phase.');
    expect(recordGates(base({ drawings: { versions: [{ version: 1, status: 'shared' }], extras: [] } }), money).uploadBlocked).toBe('Waiting for the client to review version 1.');
    expect(recordGates(base({ drawings: { versions: [{ version: 3, status: 'changes_requested' }], extras: [] } }), money).uploadBlocked).toMatch(/Version 4 is an extra version; it starts/);
    expect(recordGates(base({ drawings: { versions: [{ version: 3, status: 'changes_requested' }], extras: [{ for_version: 4, status: 'open', paid: false, amount_cents: 25000 }] } }), money).uploadBlocked).toMatch(/after the client pays \$250.00/);
    expect(recordGates(base({ drawings: { versions: [{ version: 1, status: 'changes_requested' }], extras: [] } }), money).uploadBlocked).toBeNull();
    const g = recordGates(base({ drawings: { versions: [{ version: 2, status: 'approved' }], extras: [] } }), money);
    expect(g.finish).toEqual({ done: true, text: 'Design: the client approved version 2.' });
  });
  it('quote and deposit finish + balance issue gate', () => {
    const accepted = { status: 'accepted', version: 1, deposit_paid: true, total_cents: 100000, deposit_cents: 30000 };
    const g = recordGates(base({ project: { stage: 'quote_deposit', status: 'open' }, quotes: { quotes: [accepted], factory_quotes: [], deposit_pct: 30 }, shipping: { balance_state: 'not_invoiced', shipments: [], documents: [] } }), money);
    expect(g.finish?.done).toBe(true);
    expect(g.canIssueBalance).toBe(true);
    expect(g.balanceCentsDue).toBe(70000);
    const viewer = recordGates(base({ edit: false, project: { stage: 'quote_deposit', status: 'open' }, quotes: { quotes: [accepted], factory_quotes: [], deposit_pct: 30 }, shipping: { balance_state: 'not_invoiced', shipments: [], documents: [] } }), money);
    expect(viewer.canIssueBalance).toBe(false);
    const unpaid = recordGates(base({ project: { stage: 'quote_deposit', status: 'open' }, quotes: { quotes: [{ ...accepted, deposit_paid: false }], factory_quotes: [], deposit_pct: 30 }, shipping: { balance_state: 'not_invoiced', shipments: [], documents: [] } }), money);
    expect(unpaid.canIssueBalance).toBe(false);
    expect(unpaid.finish).toEqual({ done: false, text: 'Quote version 1 accepted; waiting for the deposit.' });
  });
  it('production and QC finish needs a passed published PSI and a paid balance; docs editor rule', () => {
    const insp = [{ id: 'i1', kind: 'pre_shipment', round: 1, status: 'published', report: { result: 'pass' }, override_at: null }];
    const g = recordGates(base({ project: { stage: 'production_qc', status: 'open' }, inspections: insp, shipping: { balance_state: 'paid', shipments: [], documents: [] } }), money);
    expect(g.psi.done).toBe(true);
    expect(g.finish?.done).toBe(true);
    expect(g.latestPsiId).toBe('i1');
    expect(recordGates(base({ project: { stage: 'handover', status: 'completed' } }), money).docEditor).toBe(false);
    expect(recordGates(base({ isAdmin: true, project: { stage: 'handover', status: 'completed' } }), money).docEditor).toBe(true);
  });
  it('inspection + trip blocked texts and fee ratio', () => {
    expect(inspectionBlocked({ paid: false, phase_fee: null, fees: [] }, 'open', (c) => money(c))).toBe('Set the fee first; the inspection is scheduled after the client pays it.');
    expect(inspectionBlocked({ paid: false, phase_fee: null, fees: [{ status: 'pending_approval', amount_cents: 1, document_number: null }] }, 'open', (c) => money(c))).toBe('The fee is waiting for an admin’s approval.');
    expect(inspectionBlocked({ paid: true, phase_fee: null, fees: [] }, 'open', (c) => money(c))).toBeNull();
    expect(inspectionBlocked({ paid: true, phase_fee: null, fees: [] }, 'on_hold', (c) => money(c))).toBe('Reopen the project to schedule.');
    expect(tripBlocked({ paid: false, fees: [{ status: 'active', amount_cents: 50000, document_number: 'PF-1' }] }, (c) => money(c))).toBe('Confirmed after the client pays $500.00 (proforma PF-1).');
    expect(feeRatio(150000, 50000)).toBe('3.0×');
    expect(feeRatio(1, null)).toBeNull();
    expect(inspectionStartingCents('nope', [])).toBeNull();
  });
});

describe('ODS T9 turnkey · dashboard KPIs', () => {
  it('8 tiles with today’s labels, hints and test ids', () => {
    const t = kpiItems({ open_by_stage: {}, open_total: 1200, on_hold: 0, new_enquiries_7d: 1, waiting_approvals: 2, unpaid_count: 0, unpaid_cents: 0, inspections_to_schedule: 0, inspections_due_7d: 1, inspections_overdue: 1, reports_to_review: 0, trips_requested: 1, trips_upcoming_30d: 0, next_trips: [], due_inspections: [] }, (c) => money(c));
    expect(t.map((x) => x.testid)).toEqual(['tk-kpi-open', 'tk-kpi-approvals', 'tk-kpi-unpaid', 'tk-kpi-inspections', 'tk-kpi-trips', 'tk-kpi-enquiries', 'tk-kpi-reviews', 'tk-kpi-to-schedule']);
    expect(t[0]).toMatchObject({ value: '1,200', hint: 'None on hold' });
    expect(t[1]).toMatchObject({ tone: 'warn', hintHref: '/admin/turnkey/approvals' });
    expect(t[2].hint).toBe('Everything issued is paid');
    expect(t[3]).toMatchObject({ hint: '1 overdue', tone: 'bad' });
    expect(t[4].hint).toBe('1 request waiting for a fee');
  });
});
