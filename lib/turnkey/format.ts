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
