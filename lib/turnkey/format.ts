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
