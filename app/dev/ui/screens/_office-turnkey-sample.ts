/**
 * SAMPLE data for the staging-only Turnkey fixtures (/dev/ui/screens/office-turnkey-*). Labelled sample; invented for
 * design review; never used by real pages. Shapes are today's (lib/turnkey/*), so the real views and gates run on them.
 */
import type { TkDashboard, TkSettings, TkFeeRow, TkFunnelRow, TkAgeingRow, TkUnpaidRow, TkInspectorRow } from '@/lib/turnkey/reports';
import type { TkService } from '@/lib/turnkey/format';
import type { TkInspectorJob, TkInspectorJobListItem } from '@/lib/turnkey/qc';
import type { RecordBase, RecordSources, StaffFee } from '@/app/ods/admin/turnkey/projects/[code]/_components/record-types';
import type { ProjectRowVM } from '@/app/ods/admin/turnkey/_components/projects-grid';
import type { FeeApprovalRow, InspApprovalRow, TripApprovalRow } from '@/app/ods/admin/turnkey/_components/approvals-view';
import type { CatalogueRow, LeadRow } from '@/app/ods/admin/turnkey/_components/overview-view';

export const ME = 'sample-staff-me';
export const OTHER = 'sample-staff-lena';

export const ROLES = [
  ['admin', 'Admin'],
  ['editor', 'Turnkey editor'],
  ['viewer', 'Turnkey viewer (read only)'],
] as const;
export type TkRole = (typeof ROLES)[number][0];
export function roleSession(role: TkRole) {
  if (role === 'admin') return { isAdmin: true, edit: true, roles: ['admin'], permissions: [] as string[] };
  if (role === 'editor') return { isAdmin: false, edit: true, roles: ['operations'], permissions: ['turnkey:view', 'turnkey:edit', 'turnkey_qc:view'] };
  return { isAdmin: false, edit: false, roles: ['account_manager'], permissions: ['turnkey:view'] };
}
export const sampleMoney = (c: number | null | undefined, cur = 'USD') => (c == null ? '—' : `${cur === 'USD' ? 'US$' : cur} ${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/* ───────── overview ───────── */
export const DASHBOARD: TkDashboard = {
  can_see_all: true,
  kpi: {
    open_by_stage: { enquiry: 4, consultation: 3, design: 5, sourcing: 2, quote_deposit: 2, production_qc: 3, shipment: 1, handover: 1 },
    open_total: 21, on_hold: 2, new_enquiries_7d: 4, waiting_approvals: 2, unpaid_count: 6, unpaid_cents: 1874000, inspections_to_schedule: 1,
    inspections_due_7d: 2, inspections_overdue: 1, reports_to_review: 1, trips_requested: 1, trips_upcoming_30d: 1,
    next_trips: [{ code: 'TKP-00009', title: 'Boutique hotel lobby', start_on: '2026-12-08', end_on: '2026-12-11', travellers: 3 }],
    due_inspections: [
      { code: 'TKP-00012', title: 'Robotic cafe', kind: 'pre_shipment', round: 1, scheduled_on: '2026-11-30', status: 'scheduled' },
      { code: 'TKP-00007', title: 'Bubble tea kiosk', kind: 'factory_audit', round: 1, scheduled_on: '2026-12-02', status: 'in_progress' },
    ],
  },
  my_projects: [
    { code: 'TKP-00012', title: 'Robotic cafe', stage: 'production_qc', status: 'open', client: 'Gulf Home Trading LLC', updated_at: '2026-11-26T10:00:00Z', unpaid: 1, on_cover: false },
    { code: 'TKP-00015', title: 'Dental clinic fit-out', stage: 'design', status: 'on_hold', client: null, updated_at: '2026-11-20T10:00:00Z', unpaid: 0, on_cover: true },
  ],
};
export const DASHBOARD_EMPTY: TkDashboard = { can_see_all: false, kpi: null, my_projects: [] };
export const CATALOGUE: CatalogueRow[] = [
  { project_id: 'robotic-cafe', title: 'Robotic cafe', category: 'Food & drink', status: 'live', starting_budget_usd: 45000, hero_image_path: 'turnkey/robotic-cafe.webp', floor_area_m2: 25 },
  { project_id: 'bubble-tea-kiosk', title: 'Bubble tea kiosk', category: 'Food & drink', status: 'live', starting_budget_usd: 18000, hero_image_path: null, floor_area_m2: 12 },
  { project_id: 'nail-salon', title: 'Nail salon', category: 'Beauty', status: 'archived', starting_budget_usd: null, hero_image_path: 'turnkey/nail-salon.webp', floor_area_m2: 40 },
];
export const SERVICES: TkService[] = [
  { code: 'consultation', name: 'Consultation', from_cents: 9900, unit: 'project', approx: false, rule_text: 'Paid before we start.', group_code: 'core', photo_path: null, sort: 1 },
  { code: 'layout_drawing', name: 'Layout drawing', from_cents: 49900, unit: 'project', approx: false, rule_text: '3 versions free, then 50% per extra version.', group_code: 'core', photo_path: null, sort: 2 },
  { code: 'pre_shipment_inspection', name: 'Pre-shipment inspection', from_cents: 29900, unit: 'day', approx: true, rule_text: null, group_code: 'qc', photo_path: null, sort: 3 },
];
export const LEADS: LeadRow[] = [
  { lead_id: 'l1', reference: 'TKL-0041', kind: 'quote', status: 'moved', company_name: 'Gulf Home Trading LLC', country: 'AE', created_at: '2026-03-02T10:00:00Z', turnkey_projects: { title: 'Robotic cafe' } },
];

/* ───────── projects ───────── */
export const PROJECTS: ProjectRowVM[] = [
  { id: 'p12', code: 'TKP-00012', title: 'Robotic cafe', stage: 'production_qc', status: 'open', client: 'Gulf Home Trading LLC', source: 'web', manager: 'Ravi Menon', cover: null, updated_at: '2026-11-26T10:00:00Z' },
  { id: 'p15', code: 'TKP-00015', title: 'Dental clinic fit-out', stage: 'design', status: 'on_hold', client: null, source: 'legacy_lead', manager: 'Lena Fischer', cover: 'Cover: Ravi Menon · 20 Nov 2026 to 4 Dec 2026', updated_at: '2026-11-20T10:00:00Z' },
  { id: 'p09', code: 'TKP-00009', title: 'Boutique hotel lobby', stage: 'handover', status: 'open', client: 'Nordic Living AB', source: 'staff', manager: 'Ravi Menon', cover: null, updated_at: '2026-11-18T10:00:00Z' },
  { id: 'p07', code: 'TKP-00007', title: 'Bubble tea kiosk', stage: 'sourcing', status: 'open', client: 'Casa Verde SA', source: 'web', manager: null, cover: null, updated_at: '2026-11-11T10:00:00Z' },
];
export const PER_STAGE: Record<string, number> = { enquiry: 4, consultation: 3, design: 5, sourcing: 2, quote_deposit: 2, production_qc: 3, shipment: 1, handover: 1 };

/* ───────── project record ───────── */
const fee = (o: Partial<StaffFee> & Pick<StaffFee, 'id' | 'stage' | 'amount_cents' | 'status'>): StaffFee => ({
  service_code: null, service_name: null, version: 1, currency: 'USD', starting_cents: null, needs_approval: false, note: null, proposed_by: OTHER, proposed_by_name: 'Lena Fischer',
  proposed_at: '2026-04-02T10:00:00Z', approved_by: null, approved_by_name: null, approved_at: null, rejected_by_name: null, rejected_at: null, reject_reason: null, withdrawn_at: null,
  effective_from: '2026-04-02', superseded_at: null, document_id: 'd', document_number: 'PF-2026-0101', document_status: 'paid', paid_cents: o.amount_cents, paid: true, ...o,
});

export function recordBase(state: string): RecordBase {
  const waiting = state === 'second-approver';
  return {
    p: {
      id: 'p12', code: 'TKP-00012', org_id: 'org1', catalogue_project_id: 'robotic-cafe', title: 'Robotic cafe', stage: 'production_qc', status: state === 'on-hold' ? 'on_hold' : 'open',
      status_reason: state === 'on-hold' ? 'Client asked to pause until the lease is signed.' : null, country: 'AE', city: 'Dubai', target_open_on: '2027-03-01', floor_area_m2: 25,
      budget_cents: 6000000, currency: 'USD', plan: 'Self-serve coffee robot kiosk in a mall atrium.', source: 'web', stage_changed_at: '2026-10-20T10:00:00Z', created_at: '2026-03-02T10:00:00Z', updated_at: '2026-11-26T10:00:00Z',
    },
    stages: [
      { stage: 'enquiry', started_at: '2026-03-02', completed_at: '2026-03-04', due_on: null },
      { stage: 'consultation', started_at: '2026-03-04', completed_at: '2026-04-01', due_on: null },
      { stage: 'design', started_at: '2026-04-02', completed_at: '2026-06-10', due_on: null },
      { stage: 'sourcing', started_at: '2026-06-11', completed_at: '2026-08-01', due_on: null },
      { stage: 'quote_deposit', started_at: '2026-08-02', completed_at: '2026-10-20', due_on: null },
      { stage: 'production_qc', started_at: '2026-10-20', completed_at: null, due_on: '2026-12-15' },
    ],
    events: [
      { id: 3, kind: 'stage', from_stage: 'quote_deposit', to_stage: 'production_qc', status: null, message: null, created_at: '2026-10-20T10:00:00Z' },
      { id: 2, kind: 'stage', from_stage: 'sourcing', to_stage: 'quote_deposit', status: null, message: null, created_at: '2026-08-02T10:00:00Z' },
      { id: 1, kind: 'created', from_stage: null, to_stage: 'enquiry', status: null, message: 'Robot kiosk for a mall atrium', created_at: '2026-03-02T10:00:00Z' },
    ],
    managerName: 'Ravi Menon',
    contact: { name: 'Ravi Menon', on_cover: false, usual_name: 'Ravi Menon', cover_name: null, cover_from: null, cover_to: null },
    staff: { owner_id: 'am1', owner_set_at: '2026-03-02T10:00:00Z', created_by: null, legacy_lead_id: null, is_seed: false, cover_id: null, cover_from: null, cover_to: null },
    company: { id: 'org1', name: 'Gulf Home Trading LLC', country: 'AE' },
    cands: [{ user_id: 'am1', full_name: 'Ravi Menon' }, { user_id: 'am2', full_name: 'Lena Fischer' }],
    fees: state === 'error' ? null : [
      fee({ id: 'f1', stage: 'consultation', service_code: 'consultation', service_name: 'Consultation', amount_cents: 9900, starting_cents: 9900, status: 'active' }),
      fee({ id: 'f2', stage: 'design', service_code: 'layout_drawing', service_name: 'Layout drawing', amount_cents: 49900, starting_cents: 49900, status: 'active' }),
      fee({ id: 'f3', stage: 'shipment', service_name: 'Shipment handling', amount_cents: waiting ? 150000 : 60000, starting_cents: 50000, status: waiting ? 'pending_approval' : 'active', needs_approval: waiting, proposed_by: waiting ? ME : OTHER, proposed_by_name: waiting ? 'Priya Shah' : 'Lena Fischer', document_number: waiting ? null : 'PF-2026-0144', paid: false, paid_cents: 0, document_status: waiting ? null : 'issued', note: waiting ? 'Two containers, port fees included.' : null }),
    ],
    services: SERVICES.map((s) => ({ code: s.code, name: s.name, from_cents: s.from_cents, approx: s.approx })),
    lead: null,
  };
}

export function recordSources(state: string): RecordSources {
  if (state === 'error') return { drw: null, qts: null, qc: null, ship: null, trp: null };
  return {
    drw: {
      data: {
        versions: [
          { id: 'v2', version: 2, file_path: 'x/v2.pdf', file_name: 'robotic-cafe-layout-v2.pdf', mime_type: 'application/pdf', size_bytes: 2400000, message: 'Moved the robot to the front.', status: 'approved', shared_at: '2026-06-01T10:00:00Z', decided_at: '2026-06-10T10:00:00Z', uploaded_by_name: 'Lena Fischer' },
          { id: 'v1', version: 1, file_path: 'x/v1.pdf', file_name: 'robotic-cafe-layout-v1.pdf', mime_type: 'application/pdf', size_bytes: 2100000, message: null, status: 'changes_requested', shared_at: '2026-05-10T10:00:00Z', decided_at: '2026-05-15T10:00:00Z', uploaded_by_name: 'Lena Fischer' },
        ],
        comments: [{ id: 1, version_id: 'v1', from_staff: false, kind: 'changes', body: 'Please move the robot nearer the entrance.', created_at: '2026-05-15T10:00:00Z', author_name: null }],
        extras: [],
      },
      urls: {},
    },
    qts: {
      deposit_pct: 30, custom_branded: false, deposit_pct_standard: 30, deposit_pct_custom: 50,
      factory_quotes: [{ id: 'fq1', supplier_name: 'Sample Robotics Co.', supplier_ref: 'Q-889', valid_until: '2026-08-30', notes: null, total_cost_cents: 3200000, created_at: '2026-07-01T10:00:00Z', created_by_name: 'Lena Fischer', lines: [{ id: 'fl1', line_no: 1, description: 'Coffee robot arm kiosk', qty: 1, unit_cost_cents: 3200000, total_cost_cents: 3200000 }] }],
      quotes: [{ id: 'q1', version: 1, status: 'accepted', total_cents: 4800000, deposit_pct: 30, deposit_cents: 1440000, message: null, client_comment: 'Approved.', valid_until: '2026-09-01', sent_at: '2026-08-02T10:00:00Z', decided_at: '2026-08-10T10:00:00Z', created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-10T10:00:00Z', created_by_name: 'Lena Fischer', sent_by_name: 'Lena Fischer', document_id: 'dq', document_number: 'PF-2026-0120', document_status: 'paid', paid_cents: 1440000, deposit_paid: true, cost_cents: 3200000, cost_complete: true, lines: [{ id: 'ql1', line_no: 1, description: 'Coffee robot kiosk, installed', qty: 1, unit_price_cents: 4800000, total_cents: 4800000, unit_cost_cents: 3200000, cost_cents: 3200000, factory_line_id: 'fl1', supplier_name: 'Sample Robotics Co.' }] }],
    },
    qc: {
      phase_fee_available: null,
      inspectors: [{ user_id: 'in1', full_name: 'Chen Wei' }],
      inspections: [{
        id: 'i1', kind: 'pre_shipment', round: 1, status: 'scheduled', scheduled_on: '2026-11-30', factory_name: 'Sample Robotics Co.', factory_address: 'Bao’an, Shenzhen', brief: 'Check the arm calibration and the casing finish.',
        created_at: '2026-11-01T10:00:00Z', created_by_name: 'Lena Fischer', inspector_id: 'in1', inspector_name: 'Chen Wei', scheduled_at: '2026-11-10T10:00:00Z', started_at: null, submitted_at: null, returned_reason: null,
        published_at: null, published_by_name: null, cancelled_at: null, cancel_reason: null, override_at: null, override_reason: null, override_by_name: null, paid: true, phase_fee: null,
        fees: [{ id: 'if1', version: 1, service_code: 'pre_shipment_inspection', amount_cents: 29900, starting_cents: 29900, needs_approval: false, status: 'active', note: null, proposed_by: OTHER, proposed_by_name: 'Lena Fischer', proposed_at: '2026-11-01T10:00:00Z', approved_by_name: null, approved_at: null, rejected_by_name: null, rejected_at: null, reject_reason: null, withdrawn_at: null, document_id: 'di', document_number: 'PF-2026-0139', document_status: 'paid', paid_cents: 29900, paid: true }],
        items: [], photos: [], report: null,
      }],
    },
    ship: { balance_state: 'not_invoiced', balance: null, shipments: [], documents: [], items: [], signoff: null },
    trp: { passport_access: false, trips: [] },
  };
}

/* ───────── approvals ───────── */
export const APPROVALS: FeeApprovalRow[] = [
  { id: 'a1', project_code: 'TKP-00012', project_title: 'Robotic cafe', client_name: 'Gulf Home Trading LLC', stage: 'shipment', service_name: 'Shipment handling', version: 2, amount_cents: 150000, currency: 'USD', status: 'pending_approval', note: 'Two containers, port fees included.', starting_cents: 50000, active_cents: 60000, proposed_by: ME, proposed_by_name: 'Priya Shah', proposed_at: '2026-11-26T09:00:00Z', approved_by_name: null, approved_at: null, rejected_by_name: null, rejected_at: null, reject_reason: null },
  { id: 'a2', project_code: 'TKP-00007', project_title: 'Bubble tea kiosk', client_name: 'Casa Verde SA', stage: 'consultation', service_name: 'Consultation', version: 1, amount_cents: 45000, currency: 'USD', status: 'pending_approval', note: null, starting_cents: 9900, active_cents: null, proposed_by: OTHER, proposed_by_name: 'Lena Fischer', proposed_at: '2026-11-25T09:00:00Z', approved_by_name: null, approved_at: null, rejected_by_name: null, rejected_at: null, reject_reason: null },
  { id: 'a3', project_code: 'TKP-00009', project_title: 'Boutique hotel lobby', client_name: 'Nordic Living AB', stage: 'design', service_name: 'Layout drawing', version: 1, amount_cents: 120000, currency: 'USD', status: 'active', note: null, starting_cents: 49900, active_cents: null, proposed_by: OTHER, proposed_by_name: 'Lena Fischer', proposed_at: '2026-11-01T09:00:00Z', approved_by_name: 'Omar Khalid', approved_at: '2026-11-02T09:00:00Z', rejected_by_name: null, rejected_at: null, reject_reason: null },
];
export const INSP_APPROVALS: InspApprovalRow[] = [{ id: 'ia1', project_code: 'TKP-00007', project_title: 'Bubble tea kiosk', client_name: 'Casa Verde SA', kind: 'factory_audit', round: 1, version: 1, amount_cents: 90000, starting_cents: 29900, note: null, proposed_by: OTHER, proposed_by_name: 'Lena Fischer', proposed_at: '2026-11-24T09:00:00Z' }];
export const TRIP_APPROVALS: TripApprovalRow[] = [];

/* ───────── reports ───────── */
export const REPORT_FEES: TkFeeRow[] = [
  { period: '2026-11-01', service_key: 'consultation', service_name: 'Consultation', issued_count: 4, issued_cents: 39600, paid_cents: 29700, outstanding_cents: 9900, void_count: 0 },
  { period: '2026-11-01', service_key: 'layout_drawing', service_name: 'Layout drawing', issued_count: 2, issued_cents: 99800, paid_cents: 49900, outstanding_cents: 49900, void_count: 1 },
];
export const REPORT_FUNNEL: TkFunnelRow[] = [
  { seq: 1, stage: 'enquiry', stage_name: 'Enquiry', reached: 12, open_now: 4, on_hold_now: 0, cancelled_here: 2, completed_here: 0 },
  { seq: 2, stage: 'consultation', stage_name: 'Consultation', reached: 8, open_now: 3, on_hold_now: 1, cancelled_here: 1, completed_here: 0 },
  { seq: 3, stage: 'design', stage_name: 'Design', reached: 5, open_now: 2, on_hold_now: 0, cancelled_here: 0, completed_here: 0 },
];
export const REPORT_AGEING: TkAgeingRow[] = [
  { bucket: '0–30', sort: 1, open_count: 4, outstanding_cents: 59800, oldest_days: 21 },
  { bucket: '31–60', sort: 2, open_count: 1, outstanding_cents: 9900, oldest_days: 44 },
  { bucket: '61–90', sort: 3, open_count: 0, outstanding_cents: 0, oldest_days: null },
  { bucket: '90+', sort: 4, open_count: 1, outstanding_cents: 49900, oldest_days: 102 },
];
export const REPORT_UNPAID: TkUnpaidRow[] = [{ document_id: 'u1', number: 'PF-2026-0144', project_code: 'TKP-00012', client_name: 'Gulf Home Trading LLC', service_name: 'Shipment handling', amount_cents: 60000, paid_cents: 0, outstanding_cents: 60000, issued_at: '2026-11-20T10:00:00Z', age_days: 7 }];
export const REPORT_INSPECTORS: TkInspectorRow[] = [{ inspector_id: 'in1', inspector_name: 'Chen Wei', open_jobs: 2, due_7_days: 1, overdue: 1, awaiting_review: 0, published_in_period: 3, next_on: '2026-11-30' }];

/* ───────── settings ───────── */
export const SETTINGS: TkSettings = {
  deposit_pct: 30, deposit_pct_custom: 50, extra_traveller_day_cents: 8000, included_travellers: 2, visit_rule_text: 'Up to 2 people included; each extra traveller US$ 80 per day.',
  passport_retention_days: 30, passport_retention_set: false, am_waiver_threshold_cents: null, can_edit: true,
  changes: [{ action: 'tk.setting.deposit_pct', entity_id: null, details: { from: 25, to: 30 }, at: '2026-11-02T09:00:00Z', by: 'Omar Khalid' }],
};

/* ───────── inspector ───────── */
export const INSPECT_JOBS: TkInspectorJobListItem[] = [
  { id: '11111111-1111-1111-1111-111111111111', kind: 'pre_shipment', round: 1, status: 'scheduled', scheduled_on: '2026-11-30', project_code: 'TKP-00012', project_title: 'Robotic cafe', factory_name: 'Sample Robotics Co.', factory_address: 'Bao’an, Shenzhen' },
  { id: '22222222-2222-2222-2222-222222222222', kind: 'factory_audit', round: 1, status: 'in_progress', scheduled_on: '2026-12-02', project_code: 'TKP-00007', project_title: 'Bubble tea kiosk', factory_name: 'Sample Tea Equipment Ltd', factory_address: null },
  { id: '33333333-3333-3333-3333-333333333333', kind: 'pre_shipment', round: 1, status: 'published', scheduled_on: '2026-11-10', project_code: 'TKP-00009', project_title: 'Boutique hotel lobby', factory_name: 'Sample Furniture Works', factory_address: 'Foshan' },
];
export function inspectJob(state: string): TkInspectorJob {
  return {
    id: '11111111-1111-1111-1111-111111111111', project_id: 'p12', project_code: 'TKP-00012', project_title: 'Robotic cafe', project_open: true, kind: 'pre_shipment', round: 1,
    status: state === 'returned' ? 'in_progress' : 'scheduled', scheduled_on: '2026-11-30', factory_name: 'Sample Robotics Co.', factory_address: 'Bao’an, Shenzhen',
    brief: 'Check the arm calibration and the casing finish.', returned_reason: state === 'returned' ? 'Add two photos of the casing.' : null, paid: state !== 'unpaid',
    items: [
      { id: 'it1', position: 1, label: 'Arm moves through the full range', answer: null, remark: null },
      { id: 'it2', position: 2, label: 'Casing has no scratches or dents', answer: null, remark: null },
      { id: 'it3', position: 3, label: 'Safety stop works', answer: null, remark: null },
    ],
    photos: [], report: null,
  };
}
