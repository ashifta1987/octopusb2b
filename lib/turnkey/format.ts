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

/** 8 phases, 7 payment gates (only the enquiry is free). */
export const TK_PHASES: { n: number; name: string; what: string; paid: boolean }[] = [
  { n: 1, name: 'Enquiry', what: 'Pick a project or ask for a new one and tell us your plan.', paid: false },
  { n: 2, name: 'Consultation', what: 'Paid first. We set the exact fee with you.', paid: true },
  { n: 3, name: 'Design', what: 'Layout drawing: 3 versions free, then 50% of the drawing fee per extra version.', paid: true },
  { n: 4, name: 'Sourcing', what: 'We collect quotes from factories. You deal only with us.', paid: true },
  { n: 5, name: 'Quote and deposit', what: 'Approve the quote and pay the deposit.', paid: true },
  { n: 6, name: 'Production and QC', what: 'Factory audit and inspections, each paid before it starts.', paid: true },
  { n: 7, name: 'Shipment', what: 'Booking, tracking and shipping documents.', paid: true },
  { n: 8, name: 'Handover', what: 'Final documents, sign-off and an optional China visit.', paid: true },
];

/** Public storage URL for a project photo path (https links pass through). */
export function tkImageUrl(path: string | null, supabaseUrl: string | undefined): string | null {
  if (!path) return null;
  if (/^https:\/\//.test(path)) return path;
  if (path.startsWith('/')) return path;
  return supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/site-media/${path.replace(/^\/+/, '')}` : null;
}
