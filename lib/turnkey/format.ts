/** Turnkey Sourcing (design: docs/design/turnkey-v2) — pure helpers shared by server pages, client islands and tests. */

/** The 6 ADDON-31 category codes still on the first 25 projects; anything else is shown as typed (owner's sheet). */
const LEGACY_CATEGORY_LABEL: Record<string, string> = {
  'self-service': 'Self-service & automated', food: 'Food & hospitality', leisure: 'Leisure & sport',
  'small-factory': 'Small factories', infrastructure: 'Infrastructure', 'fit-out': 'Fit-out',
};
export const categoryLabel = (c: string) => LEGACY_CATEGORY_LABEL[c] ?? c;

export type TkProject = {
  project_id: string; title: string; category: string; short_reason: string | null; starting_budget_usd: number | null;
  budget_unit: string | null; hero_image_path: string | null; hero_image_alt: string | null; floor_area_m2: number | null; sort_rank: number;
};
export const TK_PROJECT_COLUMNS = 'project_id, title, category, short_reason, starting_budget_usd, budget_unit, hero_image_path, hero_image_alt, floor_area_m2, sort_rank';

export type TkService = {
  code: string; name: string; from_cents: number; unit: 'project' | 'day' | 'version' | 'item' | 'trip' | 'free'; approx: boolean;
  rule_text: string | null; group_code: 'core' | 'qc' | 'visit' | 'trip_extra' | 'manager'; photo_path: string | null; sort: number;
};

const nf = new Intl.NumberFormat('en-US');
/** Every turnkey price is a starting price: "From $99", "About $250", "Free". Cents in, whole dollars out when exact. */
export function fromPrice(cents: number, approx = false): string {
  if (cents === 0) return 'Free';
  const usd = cents / 100;
  const amount = `$${Number.isInteger(usd) ? nf.format(usd) : usd.toFixed(2)}`;
  return approx ? `About ${amount}` : `From ${amount}`;
}
export const UNIT_SUFFIX: Record<TkService['unit'], string> = { project: ' per project', day: ' per day', version: ' per version', item: '', trip: ' per trip', free: '' };
export const servicePrice = (s: Pick<TkService, 'from_cents' | 'approx' | 'unit'>) => `${fromPrice(s.from_cents, s.approx)}${s.from_cents ? UNIT_SUFFIX[s.unit] : ''}`;

/** "From $22,000" for a project's starting budget (whole US dollars), or null when not set. */
export const projectFrom = (p: Pick<TkProject, 'starting_budget_usd' | 'budget_unit'>) =>
  p.starting_budget_usd == null ? null : `From $${nf.format(p.starting_budget_usd)}${p.budget_unit ? ` ${p.budget_unit}` : ''}`;

/** 8 phases, 7 payment gates (only the enquiry is free). Codes match tk_stages (migration T2). */
export type TkStageCode = 'enquiry' | 'consultation' | 'design' | 'sourcing' | 'quote_deposit' | 'production_qc' | 'shipment' | 'handover';
export const TK_PHASES: { n: number; code: TkStageCode; name: string; what: string; paid: boolean }[] = [
  { n: 1, code: 'enquiry', name: 'Enquiry', what: 'Pick a project or ask for a new one and tell us your plan.', paid: false },
  { n: 2, code: 'consultation', name: 'Consultation', what: 'Paid first. We set the exact fee with you.', paid: true },
  { n: 3, code: 'design', name: 'Design', what: 'Layout drawing: 3 versions free, then 50% of the drawing fee per extra version.', paid: true },
  { n: 4, code: 'sourcing', name: 'Sourcing', what: 'We collect quotes from factories. You deal only with us.', paid: true },
  { n: 5, code: 'quote_deposit', name: 'Quote and deposit', what: 'Approve the quote and pay the deposit.', paid: true },
  { n: 6, code: 'production_qc', name: 'Production and QC', what: 'Factory audit and inspections, each paid before it starts.', paid: true },
  { n: 7, code: 'shipment', name: 'Shipment', what: 'Booking, tracking and shipping documents.', paid: true },
  { n: 8, code: 'handover', name: 'Handover', what: 'Final documents, sign-off and an optional China visit.', paid: true },
];

/* ───────── Client projects (T2) ───────── */
export type TkProjectStatus = 'open' | 'on_hold' | 'completed' | 'cancelled';
export const TK_STATUS: Record<TkProjectStatus, { label: string; tone: 'blue' | 'amber' | 'green' | 'red' }> = {
  open: { label: 'In progress', tone: 'blue' },
  on_hold: { label: 'On hold', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
};
export const tkStatus = (s: string) => TK_STATUS[s as TkProjectStatus] ?? { label: s, tone: 'blue' as const };

export const tkPhase = (code: string) => TK_PHASES.find((p) => p.code === code) ?? null;
/** "Phase 2 of 8 · Consultation" (unknown codes are shown as they are). */
export const phaseLabel = (code: string) => { const p = tkPhase(code); return p ? `Phase ${p.n} of 8 · ${p.name}` : code; };
export const nextPhase = (code: string) => { const p = tkPhase(code); return p && p.n < 8 ? TK_PHASES[p.n] : null; };
export const earlierPhases = (code: string) => { const p = tkPhase(code); return p ? TK_PHASES.slice(0, p.n - 1) : []; };

export type TkStageRow = { stage: string; started_at: string | null; completed_at: string | null; due_on: string | null };
export type TkPhaseState = (typeof TK_PHASES)[number] & { state: 'done' | 'current' | 'todo'; row: TkStageRow | null };
/** The 8 phases with their state for a project in `current` (done before it, current, to do after it). */
export function phaseStates(current: string, rows: TkStageRow[]): TkPhaseState[] {
  const at = tkPhase(current)?.n ?? 1;
  return TK_PHASES.map((p) => ({ ...p, state: p.n < at ? 'done' : p.n === at ? 'current' : 'todo', row: rows.find((r) => r.stage === p.code) ?? null }));
}

/** Client's budget in integer cents → "$35,000"; unknown stays "Not given" (never $0 unless they typed 0). */
export function budgetLabel(cents: number | null | undefined): string {
  if (cents == null) return 'Not given';
  const usd = cents / 100;
  return `$${Number.isInteger(usd) ? nf.format(usd) : usd.toFixed(2)}`;
}
export const areaLabel = (m2: number | null | undefined) => (m2 == null ? 'Not given' : `About ${Number(m2)} m²`);
/** Whole US dollars typed in a form → integer cents; '' → null; anything else invalid → NaN. */
export function usdToCents(v: string): number | null {
  const t = v.replace(/[\s,$]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100);
}

/** Public storage URL for a project photo path (https links pass through). */
export function tkImageUrl(path: string | null, supabaseUrl: string | undefined): string | null {
  if (!path) return null;
  if (/^https:\/\//.test(path)) return path;
  if (path.startsWith('/')) return path;
  return supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/site-media/${path.replace(/^\/+/, '')}` : null;
}

/* ───────── Fees, payment gates and account managers (T3) ───────── */
/** Phases that stay locked until their fee is active and paid (tk_stage_fee_rules, migration T3). */
export const TK_GATED_PHASES: TkStageCode[] = ['consultation', 'design', 'sourcing', 'production_qc'];
/** Default service per paid phase (tk_stage_fee_rules.default_service_code); phases without one take a free-named fee. */
export const TK_PHASE_SERVICE: Partial<Record<TkStageCode, string>> = {
  consultation: 'consultation', design: 'layout_drawing', sourcing: 'sourcing_quotes', production_qc: 'factory_audit',
};
export const isGatedPhase = (code: string) => (TK_GATED_PHASES as string[]).includes(code);

export type TkFeeStatus = 'pending_approval' | 'active' | 'superseded' | 'rejected' | 'withdrawn';
/** Staff labels for a fee version. */
export function feeStatusLabel(status: string): { label: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'gray' } {
  switch (status) {
    case 'pending_approval': return { label: 'Waiting for admin approval', tone: 'amber' };
    case 'active': return { label: 'Active', tone: 'green' };
    case 'superseded': return { label: 'Replaced by a newer version', tone: 'gray' };
    case 'rejected': return { label: 'Rejected', tone: 'red' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}

/**
 * The design's SetFee rule (D5: service fees only): a fee up to 2× the service's starting fee is active at once; above
 * 2×, or when there is no starting fee, one admin who did not set it approves it first. Mirrors tk_propose_fee.
 */
export function feeNeedsApproval(amountCents: number, startingCents: number | null | undefined): boolean {
  return !startingCents || startingCents <= 0 || amountCents > 2 * startingCents;
}

/** Client payment state of an approved fee from its proforma (paid = fully paid). Unknown proforma → "to pay", never "paid". */
export type TkPayState = 'paid' | 'part_paid' | 'to_pay';
export function feePayState(amountCents: number, doc: { paid_cents: number | null; status: string | null } | null): TkPayState {
  if (!doc) return 'to_pay';
  const paid = Number(doc.paid_cents ?? 0);
  if (paid >= amountCents && amountCents > 0 && doc.status !== 'void' && doc.status !== 'cancelled') return 'paid';
  return paid > 0 ? 'part_paid' : 'to_pay';
}
export const PAY_STATE: Record<TkPayState, { label: string; tone: 'green' | 'amber' | 'blue' }> = {
  paid: { label: 'Paid', tone: 'green' },
  part_paid: { label: 'Part paid', tone: 'amber' },
  to_pay: { label: 'To pay', tone: 'blue' },
};

/** True when `today` (YYYY-MM-DD) is inside the cover period (both ends included). */
export function coverActive(from: string | null | undefined, to: string | null | undefined, today: string): boolean {
  return !!from && !!to && from <= today && today <= to;
}

/* ───────── Drawings, quotes and deposit (T4) ───────── */
/** Design rule: 3 layout drawing versions are free; each extra version costs 50% of the drawing fee (tk_decide_drawing). */
export const TK_FREE_DRAWING_VERSIONS = 3;
/** 50% of the drawing fee in integer cents, rounded half up to the cent (mirrors tk_drawing_extra_fees_half). */
export const extraVersionCents = (drawingFeeCents: number) => Math.floor((drawingFeeCents + 1) / 2);
/** True when asking for changes on `version` makes the next version a paid extra version. */
export const nextVersionIsExtra = (version: number) => version >= TK_FREE_DRAWING_VERSIONS;
/** Files staff may share as a layout drawing (bucket turnkey-drawings; up to 20 MB). */
export const TK_DRAWING_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const TK_DRAWING_MAX_BYTES = 20 * 1024 * 1024;

export function drawingStatusLabel(status: string, audience: 'client' | 'staff' = 'client'): { label: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'gray' } {
  switch (status) {
    case 'shared': return { label: audience === 'client' ? 'Waiting for your review' : 'Waiting for the client', tone: 'amber' };
    case 'approved': return { label: 'Approved', tone: 'green' };
    case 'changes_requested': return { label: 'Changes asked', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}

export function quoteStatusLabel(status: string, audience: 'client' | 'staff' = 'client'): { label: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'gray' } {
  switch (status) {
    case 'draft': return { label: 'Draft (not sent)', tone: 'gray' };
    case 'sent': return { label: audience === 'client' ? 'Waiting for your answer' : 'Sent · waiting for the client', tone: 'amber' };
    case 'accepted': return { label: 'Accepted', tone: 'green' };
    case 'changes_requested': return { label: 'Changes asked', tone: 'gray' };
    case 'superseded': return { label: 'Replaced by a newer version', tone: 'gray' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}

/** Deposit in integer cents: whole percent of the quote total, rounded half up (mirrors tk_client_quotes_deposit). */
export const depositCents = (totalCents: number, pct: number) => Math.floor((totalCents * pct + 50) / 100);

/** Staff margin: total − cost when every line has a known cost; otherwise null ("unknown", never 0). */
export function quoteMargin(totalCents: number, costCents: number | null | undefined, costComplete: boolean): { cents: number; pct: number | null } | null {
  if (!costComplete || costCents == null) return null;
  const cents = totalCents - costCents;
  return { cents, pct: totalCents > 0 ? Math.round((cents / totalCents) * 1000) / 10 : null };
}

/** Whole quantity typed in a form (1 … 1,000,000) → number; anything else → null. */
export function parseQty(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 1_000_000 ? n : null;
}

/** File size for people: "1.2 MB", "340 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* ───────── Production and QC: inspections (T5) ───────── */
/** The two inspections the design names (QC "covers factory audit and pre-shipment inspection"). */
export type TkInspectionKind = 'factory_audit' | 'pre_shipment';
export const TK_INSPECTION_KINDS: { code: TkInspectionKind; name: string; service: string }[] = [
  { code: 'factory_audit', name: 'Factory audit', service: 'factory_audit' },
  { code: 'pre_shipment', name: 'Pre-shipment inspection', service: 'pre_shipment_inspection' },
];
/** "Pre-shipment inspection (round 2)" — mirrors tk_inspection_label. */
export function inspectionLabel(kind: string, round: number): string {
  const k = TK_INSPECTION_KINDS.find((x) => x.code === kind)?.name ?? kind;
  return round > 1 ? `${k} (round ${round})` : k;
}
export function inspectionStatusLabel(status: string, audience: 'client' | 'staff' = 'client'): { label: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'gray' } {
  switch (status) {
    case 'planned': return { label: audience === 'client' ? 'Being arranged' : 'Planned · fee first', tone: 'amber' };
    case 'scheduled': return { label: 'Scheduled', tone: 'blue' };
    case 'in_progress': return { label: 'In progress', tone: 'blue' };
    case 'submitted': return { label: audience === 'client' ? 'Report being checked' : 'Submitted · review it', tone: 'amber' };
    case 'published': return { label: 'Report ready', tone: 'green' };
    case 'cancelled': return { label: 'Cancelled', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}
export type TkInspectionResult = 'pass' | 'pass_with_remarks' | 'fail';
export const TK_RESULTS: { code: TkInspectionResult; label: string }[] = [
  { code: 'pass', label: 'Pass' }, { code: 'pass_with_remarks', label: 'Pass with remarks' }, { code: 'fail', label: 'Fail' },
];
export function resultLabel(r: string | null | undefined): { label: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  switch (r) {
    case 'pass': return { label: 'Passed', tone: 'green' };
    case 'pass_with_remarks': return { label: 'Passed with remarks', tone: 'amber' };
    case 'fail': return { label: 'Failed', tone: 'red' };
    default: return { label: 'No result yet', tone: 'gray' };
  }
}
export const TK_ANSWERS: { code: 'pass' | 'fail' | 'na'; label: string }[] = [{ code: 'pass', label: 'Pass' }, { code: 'fail', label: 'Fail' }, { code: 'na', label: 'N/A' }];
/** Photos the inspector may upload (bucket turnkey-inspections; up to 10 MB). */
export const TK_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const TK_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const photoExt = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

/** Whole number typed in a form (0 … max) → number; anything else → null. */
export function parseCount(v: string, max = 10_000_000): number | null {
  const t = v.trim();
  if (!/^\d{1,8}$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? n : null;
}

/** The AQL numbers an inspector enters, checked like tk_submit_inspection. Returns the first problem, or null. */
export function aqlProblem(lot: number | null, sample: number | null, crit: number | null, major: number | null, minor: number | null): string | null {
  if (lot == null || lot < 1) return 'Enter the lot size (a whole number from 1).';
  if (sample == null || sample < 1) return 'Enter the sample size (a whole number from 1).';
  if (sample > lot) return 'The sample cannot be larger than the lot.';
  if (crit == null || major == null || minor == null) return 'Enter the critical, major and minor defects found (0 or more).';
  return null;
}

/**
 * Production and QC completes when the latest pre-shipment inspection is published with a pass (or pass with remarks);
 * a failed one needs a re-inspection or an admin override. Mirrors the T5 part of tk_move_project_stage.
 */
export type TkPsiRow = { kind: string; round: number; status: string; result?: string | null; overridden?: boolean };
export function psiGate(rows: TkPsiRow[]): { done: boolean; text: string } {
  const psi = rows.filter((r) => r.kind === 'pre_shipment' && r.status !== 'cancelled').sort((a, b) => b.round - a.round)[0];
  if (!psi) return { done: false, text: 'Production and QC is complete when a pre-shipment inspection has passed and its report is published.' };
  const name = inspectionLabel(psi.kind, psi.round);
  if (psi.status !== 'published') return { done: false, text: `${name}: Production and QC is complete when its report is published with a pass.` };
  if (psi.result === 'fail' && !psi.overridden) return { done: false, text: `${name} failed: shipment waits for a passed re-inspection (or an admin override with a reason).` };
  if (psi.result === 'fail') return { done: true, text: `${name} failed, and an admin approved shipment with a reason.` };
  return { done: true, text: `${name} passed and the report is published.` };
}

/* ───────── Balance, shipment, documents, trips and handover (T6) ───────── */
/** Balance of the accepted quote (total − deposit) in integer cents; 0 when the deposit covers the whole quote. */
export const balanceCents = (totalCents: number, depositCents: number) => Math.max(0, totalCents - depositCents);
/** State from tk_balance_state: no_quote | none | not_invoiced | unpaid | paid. */
export type TkBalanceState = 'no_quote' | 'none' | 'not_invoiced' | 'unpaid' | 'paid';
/** What still blocks Shipment on the money side (mirrors the T6 part of tk_move_project_stage). */
export function balanceGate(state: string | null | undefined): { done: boolean; text: string } {
  switch (state) {
    case 'paid': return { done: true, text: 'The balance is paid.' };
    case 'none': return { done: true, text: 'No balance: the deposit covered the whole quote.' };
    case 'unpaid': return { done: false, text: 'Shipment waits until the client has paid the balance in full.' };
    case 'not_invoiced': return { done: false, text: 'Shipment waits for the balance: issue the balance invoice, then the client pays it.' };
    default: return { done: false, text: 'Shipment starts after the client accepts a quote and pays its balance.' };
  }
}

export type TkShipmentMode = 'sea' | 'air' | 'express';
export const TK_SHIPMENT_MODES: { code: TkShipmentMode; name: string }[] = [
  { code: 'sea', name: 'Sea freight' }, { code: 'air', name: 'Air freight' }, { code: 'express', name: 'Express courier' },
];
export const shipmentModeLabel = (m: string) => TK_SHIPMENT_MODES.find((x) => x.code === m)?.name ?? m;
/** Tracking statuses in order (a status moves forward only; mirrors tk_add_shipment_event). */
export const TK_SHIPMENT_STEPS = ['booked', 'in_transit', 'arrived', 'delivered'] as const;
export function shipmentStatusLabel(status: string): { label: string; tone: 'blue' | 'amber' | 'green' | 'gray' } {
  switch (status) {
    case 'booked': return { label: 'Booked', tone: 'amber' };
    case 'in_transit': return { label: 'In transit', tone: 'blue' };
    case 'arrived': return { label: 'Arrived', tone: 'blue' };
    case 'delivered': return { label: 'Delivered', tone: 'green' };
    case 'cancelled': return { label: 'Cancelled', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}
/** Statuses an event may move a shipment to from `current` (forward only). */
export function nextShipmentStatuses(current: string): string[] {
  const i = (TK_SHIPMENT_STEPS as readonly string[]).indexOf(current);
  return i < 0 ? [] : TK_SHIPMENT_STEPS.slice(i + 1);
}
/** Shipment completes when every shipment that is not cancelled (at least one) is delivered. */
export function shipmentGate(rows: { status: string }[]): { done: boolean; text: string } {
  const live = rows.filter((r) => r.status !== 'cancelled');
  if (!live.length) return { done: false, text: 'Shipment is complete when the goods are booked, shipped and delivered.' };
  const open = live.filter((r) => r.status !== 'delivered').length;
  return open ? { done: false, text: `Shipment is complete when every shipment is delivered (${open} not delivered yet).` } : { done: true, text: 'Every shipment is delivered.' };
}

export const TK_SHIPMENT_DOC_KINDS: { code: string; name: string }[] = [
  { code: 'bill_of_lading', name: 'Bill of lading' }, { code: 'packing_list', name: 'Packing list' }, { code: 'commercial_invoice', name: 'Commercial invoice' },
  { code: 'certificate_of_origin', name: 'Certificate of origin' }, { code: 'insurance', name: 'Insurance certificate' }, { code: 'customs', name: 'Customs document' },
  { code: 'other', name: 'Other document' },
];
export const TK_HANDOVER_DOC_KINDS: { code: string; name: string }[] = [
  { code: 'warranty', name: 'Warranty' }, { code: 'manual', name: 'Manual' }, { code: 'as_built_drawing', name: 'As-built drawing' }, { code: 'certificate', name: 'Certificate' },
  { code: 'final_invoice', name: 'Final invoice' }, { code: 'training', name: 'Training record' }, { code: 'other', name: 'Other document' },
];
export const docKindLabel = (k: string) => [...TK_SHIPMENT_DOC_KINDS, ...TK_HANDOVER_DOC_KINDS].find((x) => x.code === k && k !== 'other')?.name ?? 'Document';
export function docStatusLabel(status: string): { label: string; tone: 'gray' | 'green' | 'amber' } {
  switch (status) {
    case 'draft': return { label: 'Draft · client cannot see it', tone: 'amber' };
    case 'released': return { label: 'Shared with the client', tone: 'green' };
    case 'withdrawn': return { label: 'Withdrawn', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}
/** Shipping and final documents (bucket turnkey-documents; up to 20 MB). */
export const TK_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const TK_DOC_MAX_BYTES = 20 * 1024 * 1024;

/* trips (Visit China) */
export type TkTripInput = { start: string; end: string; travellers: number; visaLetters: number; carDays: number; airportPickups: number; hotelHelp: boolean };
export type TkTripPrices = { dayCents: number; includedTravellers: number; extraTravellerDayCents: number; visaLetterCents: number; carDayCents: number; airportPickupCents: number; hotelHelpCents: number };
/** Days from the first to the last day, both included (YYYY-MM-DD); 0 when the dates are missing or reversed. */
export function tripDays(start: string, end: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 0;
  const d = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return d >= 1 ? d : 0;
}
/** Trip prices from the services list (tk_services): Visit China per day for up to N people, extra traveller per day, extras. */
export function tripPricesFrom(services: { code: string; from_cents: number; included_travellers?: number | null; extra_traveller_day_cents?: number | null }[]): TkTripPrices | null {
  const f = (c: string) => services.find((s) => s.code === c);
  const v = f('visit_china');
  if (!v || !(Number(v.from_cents) > 0)) return null;
  return {
    dayCents: Number(v.from_cents), includedTravellers: Number(v.included_travellers ?? 2), extraTravellerDayCents: Number(v.extra_traveller_day_cents ?? 0),
    visaLetterCents: Number(f('visa_letter')?.from_cents ?? 0), carDayCents: Number(f('car_driver')?.from_cents ?? 0),
    airportPickupCents: Number(f('airport_pickup')?.from_cents ?? 0), hotelHelpCents: Number(f('hotel_help')?.from_cents ?? 0),
  };
}
/** The trip's list price and its lines (mirrors tk_trip_estimate / the tk_trips_price constraint); a problem text when the request is impossible. */
export function tripPrice(p: TkTripPrices, t: TkTripInput): { days: number; lines: { label: string; qty: number; unitCents: number; totalCents: number }[]; listCents: number; problem: string | null } {
  const days = tripDays(t.start, t.end);
  const problem = !days ? 'Choose the first and the last day of the visit.'
    : days > 30 ? 'A visit lasts at most 30 days.'
    : !(t.travellers >= 1 && t.travellers <= 20) ? 'From 1 to 20 travellers.'
    : t.visaLetters < 0 || t.visaLetters > t.travellers ? 'At most one visa letter per traveller.'
    : t.carDays < 0 || t.carDays > days ? 'Car and driver for at most every day of the visit.'
    : t.airportPickups < 0 || t.airportPickups > 10 ? 'Up to 10 airport pick-ups.'
    : null;
  const extra = Math.max(0, t.travellers - p.includedTravellers);
  const lines = [
    { label: `Visit China with us (up to ${p.includedTravellers} people)`, qty: days, unitCents: p.dayCents, totalCents: days * p.dayCents },
    ...(extra > 0 ? [{ label: 'Extra traveller per day', qty: days * extra, unitCents: p.extraTravellerDayCents, totalCents: days * extra * p.extraTravellerDayCents }] : []),
    ...(t.visaLetters > 0 ? [{ label: 'Visa invitation letter', qty: t.visaLetters, unitCents: p.visaLetterCents, totalCents: t.visaLetters * p.visaLetterCents }] : []),
    ...(t.carDays > 0 ? [{ label: 'Car and driver (days)', qty: t.carDays, unitCents: p.carDayCents, totalCents: t.carDays * p.carDayCents }] : []),
    ...(t.airportPickups > 0 ? [{ label: 'Airport pick-up', qty: t.airportPickups, unitCents: p.airportPickupCents, totalCents: t.airportPickups * p.airportPickupCents }] : []),
    ...(t.hotelHelp ? [{ label: 'Hotel help', qty: 1, unitCents: p.hotelHelpCents, totalCents: p.hotelHelpCents }] : []),
  ];
  return { days, lines, listCents: lines.reduce((a, l) => a + l.totalCents, 0), problem };
}
export function tripStatusLabel(status: string, audience: 'client' | 'staff' = 'client'): { label: string; tone: 'blue' | 'amber' | 'green' | 'gray' } {
  switch (status) {
    case 'requested': return { label: audience === 'client' ? 'Requested · fee and payment first' : 'Requested · set the fee', tone: 'amber' };
    case 'confirmed': return { label: 'Confirmed', tone: 'green' };
    case 'completed': return { label: 'Completed', tone: 'gray' };
    case 'cancelled': return { label: 'Cancelled', tone: 'gray' };
    default: return { label: status, tone: 'gray' };
  }
}
/** "12 Mar 2027 to 14 Mar 2027 · 3 days · 3 travellers" (dates as typed, YYYY-MM-DD). */
export function tripSummary(t: { start_on: string; end_on: string; days: number; travellers: number }, fmt: (d: string) => string): string {
  return `${fmt(t.start_on)}${t.days > 1 ? ` to ${fmt(t.end_on)}` : ''} · ${t.days} ${t.days === 1 ? 'day' : 'days'} · ${t.travellers} ${t.travellers === 1 ? 'traveller' : 'travellers'}`;
}
/** Passport copies (bucket turnkey-passports; up to 10 MB; shown through 60-second signed links). */
export const TK_PASSPORT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const TK_PASSPORT_MAX_BYTES = 10 * 1024 * 1024;
export const passportExt = (mime: string) => (mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

/** Handover sign-off is possible when every checklist line (at least one) is done. Mirrors tk_sign_handover's checklist rule. */
export function handoverReady(items: { done_at: string | null }[]): { ready: boolean; text: string } {
  if (!items.length) return { ready: false, text: 'We are preparing your final documents. You sign when every line is ready.' };
  const open = items.filter((i) => !i.done_at).length;
  return open ? { ready: false, text: `${open} of ${items.length} ${items.length === 1 ? 'line is' : 'lines are'} not ready yet.` } : { ready: true, text: 'Everything is ready. Check the documents, then sign the handover.' };
}
