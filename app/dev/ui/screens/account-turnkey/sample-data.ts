/**
 * SAMPLE data for the T6 Turnkey fixtures (staging only, never live). Numbers follow the Part 6.7 example table
 * (PF-2026-0112 Kitchen deposit US$ 2,550 paid 22 Oct; PF-2026-0118 Pet accessories deposit US$ 1,860 due 30 Nov).
 */
import type { TurnkeyDetailData } from '@/app/ods/account/turnkey/_components/turnkey-detail-view';
import type { TurnkeyListRow } from '@/app/ods/account/turnkey/_components/turnkey-list-view';

export const SAMPLE_TURNKEY_ROWS: TurnkeyListRow[] = [
  { code: 'TKP-00012', title: 'Kitchen storage line', stepLabel: 'Production', phaseLabel: 'Phase 6 of 8 · Production and QC', status: { label: 'Open', tone: 'info' }, statusReason: null, toPay: 0, stageChangedAt: '2026-10-24T09:00:00Z', createdAt: '2026-09-18T09:00:00Z', stepsDone: 3 },
  { code: 'TKP-00015', title: 'Pet accessories range', stepLabel: 'Design and quotes', phaseLabel: 'Phase 5 of 8 · Quote and deposit', status: { label: 'Open', tone: 'info' }, statusReason: null, toPay: 1, stageChangedAt: '2026-11-20T09:00:00Z', createdAt: '2026-10-30T09:00:00Z', stepsDone: 1 },
  { code: 'TKP-00009', title: 'Café fit-out', stepLabel: 'Brief', phaseLabel: 'Phase 2 of 8 · Consultation', status: { label: 'On hold', tone: 'warning' }, statusReason: 'Waiting for your floor plan', toPay: 0, stageChangedAt: '2026-08-02T09:00:00Z', createdAt: '2026-07-14T09:00:00Z', stepsDone: 0 },
];

const doc = (id: string, number: string, amount: number, paid: number) => ({ id, number, status: paid >= amount ? 'paid' : paid > 0 ? 'part_paid' : 'awaiting_payment', amount_cents: amount, paid_cents: paid });
const base = {
  org_id: 'sample-org', catalogue_project_id: null, currency: 'USD', source: 'web' as const, updated_at: '2026-11-26T09:00:00Z',
  country: 'AE', city: 'Dubai', target_open_on: '2027-02-01', floor_area_m2: 120, budget_cents: 4_100_000,
};

/** Kitchen storage line — production, pre-shipment inspection scheduled (QC step), deposit paid, inspection fee to pay. */
export const SAMPLE_TURNKEY_KITCHEN: TurnkeyDetailData = {
  project: { ...base, id: 'p-12', code: 'TKP-00012', title: 'Kitchen storage line', stage: 'production_qc', status: 'open', status_reason: null, plan: 'Storage line for 3 kitchen shops: shelving, drawers and labels.', stage_changed_at: '2026-10-24T09:00:00Z', created_at: '2026-09-18T09:00:00Z' },
  stages: [
    { stage: 'enquiry', started_at: '2026-09-18T09:00:00Z', completed_at: '2026-09-20T09:00:00Z', due_on: null },
    { stage: 'consultation', started_at: '2026-09-20T09:00:00Z', completed_at: '2026-09-26T09:00:00Z', due_on: null },
    { stage: 'design', started_at: '2026-09-26T09:00:00Z', completed_at: '2026-10-02T09:00:00Z', due_on: null },
    { stage: 'sourcing', started_at: '2026-10-02T09:00:00Z', completed_at: '2026-10-09T09:00:00Z', due_on: null },
    { stage: 'quote_deposit', started_at: '2026-10-09T09:00:00Z', completed_at: '2026-10-24T09:00:00Z', due_on: null },
    { stage: 'production_qc', started_at: '2026-10-24T09:00:00Z', completed_at: null, due_on: '2026-12-06' },
  ],
  events: [
    { id: 5, kind: 'inspection', from_stage: null, to_stage: null, status: null, message: 'Pre-shipment inspection scheduled for 6 Dec.', created_at: '2026-11-25T09:00:00Z' },
    { id: 4, kind: 'stage_forward', from_stage: 'quote_deposit', to_stage: 'production_qc', status: null, message: null, created_at: '2026-10-24T09:00:00Z' },
    { id: 3, kind: 'quote', from_stage: null, to_stage: null, status: null, message: 'You accepted quote version 2.', created_at: '2026-10-20T09:00:00Z' },
    { id: 1, kind: 'created', from_stage: null, to_stage: null, status: null, message: null, created_at: '2026-09-18T09:00:00Z' },
  ],
  managerName: 'Omar S.', contact: { name: 'Omar S.', on_cover: false, usual_name: null, cover_name: null, cover_from: null, cover_to: null },
  fees: [
    { id: 'f1', stage: 'consultation', service_code: 'consultation', service_name: 'Consultation', version: 1, amount_cents: 30_000, currency: 'USD', effective_from: '2026-09-20', document_id: 'd1', document: doc('d1', 'PF-2026-0098', 30_000, 30_000) },
    { id: 'f2', stage: 'design', service_code: 'layout_drawing', service_name: 'Layout drawing', version: 1, amount_cents: 60_000, currency: 'USD', effective_from: '2026-09-26', document_id: 'd2', document: doc('d2', 'PF-2026-0101', 60_000, 60_000) },
  ],
  drawings: {
    versions: [{ id: 'v1', version: 1, file_path: 'x', file_name: 'kitchen-layout-v1.pdf', mime_type: 'application/pdf', size_bytes: 1_240_000, message: 'First layout.', status: 'approved', shared_at: '2026-09-30T09:00:00Z', decided_at: '2026-10-02T09:00:00Z', url: null }],
    comments: [
      { id: 1, version_id: 'v1', from_staff: true, kind: 'comment', body: 'Here is the first layout. The drawers follow your sketch.', created_at: '2026-09-30T09:00:00Z' },
      { id: 2, version_id: 'v1', from_staff: false, kind: 'approval', body: 'Looks good, approved.', created_at: '2026-10-02T09:00:00Z' },
    ],
    extras: [],
  },
  quotes: [{
    id: 'q2', version: 2, status: 'accepted', currency: 'USD', total_cents: 410_000, deposit_pct: 30, deposit_cents: 123_000, message: null, client_comment: null, valid_until: null, document_id: 'd3', sent_at: '2026-10-15T09:00:00Z', decided_at: '2026-10-20T09:00:00Z',
    lines: [
      { id: 'l1', line_no: 1, description: 'Shelving units, oak finish', qty: 40, unit_price_cents: 6_500, total_cents: 260_000 },
      { id: 'l2', line_no: 2, description: 'Drawer sets with labels', qty: 60, unit_price_cents: 2_500, total_cents: 150_000 },
    ],
    document: doc('d3', 'PF-2026-0112', 255_000, 255_000),
  }],
  inspections: [
    { id: 'i1', kind: 'factory_audit', round: 1, status: 'published', scheduled_on: '2026-10-28', phase_fee_id: 'pf', published_at: '2026-10-30T09:00:00Z', created_at: '2026-10-25T09:00:00Z', fee: null,
      report: { lot_size: 100, sample_size: 13, critical_defects: 0, major_defects: 0, minor_defects: 1, result: 'pass', client_summary: 'Factory meets the agreed standard.', published_at: '2026-10-30T09:00:00Z' }, items: [{ id: 'c1', position: 1, label: 'Materials as agreed', answer: 'pass' }], photos: [] },
    { id: 'i2', kind: 'pre_shipment', round: 1, status: 'scheduled', scheduled_on: '2026-12-06', phase_fee_id: null, published_at: null, created_at: '2026-11-25T09:00:00Z',
      fee: { id: 'if2', amount_cents: 29_000, currency: 'USD', document: doc('d4', 'PF-2026-0121', 29_000, 0) }, report: null, items: [], photos: [] },
  ],
  shipping: { balance: null, shipments: [], documents: [], handover: { items: [], signoff: null } },
  trips: [],
  tripPrices: { dayCents: 39_900, includedTravellers: 2, extraTravellerDayCents: 9_900, visaLetterCents: 4_900, carDayCents: 10_000, airportPickupCents: 3_900, hotelHelpCents: 0 },
  keySeed: 'sample-seed',
};

/** Pet accessories range — quote version 1 sent and waiting for your answer, drawing v2 to review, deposit not issued yet. */
export const SAMPLE_TURNKEY_PET: TurnkeyDetailData = {
  ...SAMPLE_TURNKEY_KITCHEN,
  project: { ...SAMPLE_TURNKEY_KITCHEN.project, id: 'p-15', code: 'TKP-00015', title: 'Pet accessories range', stage: 'quote_deposit', stage_changed_at: '2026-11-20T09:00:00Z', created_at: '2026-10-30T09:00:00Z', plan: 'Crates, beds and bowls under our brand for two pet shops.' },
  stages: SAMPLE_TURNKEY_KITCHEN.stages.slice(0, 5).map((s) => (s.stage === 'quote_deposit' ? { ...s, completed_at: null, due_on: '2026-11-30' } : s)),
  events: [{ id: 9, kind: 'quote', from_stage: null, to_stage: null, status: null, message: 'Quote version 1 sent.', created_at: '2026-11-20T09:00:00Z' }],
  fees: [{ id: 'f9', stage: 'sourcing', service_code: 'sourcing', service_name: 'Sourcing', version: 1, amount_cents: 186_000, currency: 'USD', effective_from: '2026-11-10', document_id: 'd9', document: doc('d9', 'PF-2026-0118', 186_000, 0) }],
  drawings: {
    versions: [
      { id: 'v2', version: 2, file_path: 'x', file_name: 'pet-range-v2.pdf', mime_type: 'application/pdf', size_bytes: 980_000, message: 'Logo 10% larger, colour matched to your guide.', status: 'shared', shared_at: '2026-11-23T09:00:00Z', decided_at: null, url: null },
      { id: 'v1p', version: 1, file_path: 'x', file_name: 'pet-range-v1.pdf', mime_type: 'application/pdf', size_bytes: 950_000, message: null, status: 'changes_requested', shared_at: '2026-11-16T09:00:00Z', decided_at: '2026-11-17T09:00:00Z', url: null },
    ],
    comments: [{ id: 7, version_id: 'v1p', from_staff: false, kind: 'changes', body: 'Please make the logo bigger.', created_at: '2026-11-17T09:00:00Z' }],
    extras: [],
  },
  quotes: [{
    id: 'q1p', version: 1, status: 'sent', currency: 'USD', total_cents: 620_000, deposit_pct: 30, deposit_cents: 186_000, message: 'Prices valid for 14 days.', client_comment: null, valid_until: '2026-11-30', document_id: null, sent_at: '2026-11-20T09:00:00Z', decided_at: null,
    lines: [{ id: 'pl1', line_no: 1, description: 'Foldable pet crate, branded', qty: 400, unit_price_cents: 1_550, total_cents: 620_000 }], document: null,
  }],
  inspections: [],
};

/** On hold (stepper shows the error state). */
export const SAMPLE_TURNKEY_ON_HOLD: TurnkeyDetailData = {
  ...SAMPLE_TURNKEY_KITCHEN,
  project: { ...SAMPLE_TURNKEY_KITCHEN.project, id: 'p-9', code: 'TKP-00009', title: 'Café fit-out', stage: 'consultation', status: 'on_hold', status_reason: 'Waiting for your floor plan' },
  fees: [], drawings: { versions: [], comments: [], extras: [] }, quotes: [], inspections: [], events: [], trips: [],
};
