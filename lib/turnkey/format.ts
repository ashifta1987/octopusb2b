/** Turnkey Projects (ADDON-31) — pure helpers shared by server pages, client islands and tests. */

export const TURNKEY_CATEGORIES = ['self-service', 'food', 'leisure', 'small-factory', 'infrastructure', 'fit-out'] as const;
export type TurnkeyCategory = (typeof TURNKEY_CATEGORIES)[number];
export const TURNKEY_STATUSES = ['register-interest', 'live', 'archived'] as const;
export type TurnkeyStatus = (typeof TURNKEY_STATUSES)[number];
export const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const REGIONS = ['MENA', 'Africa', 'Europe', 'Indian subcontinent', 'SEA', 'Americas'] as const;

export const CATEGORY_LABEL: Record<TurnkeyCategory, string> = {
  'self-service': 'Self-service & automated', food: 'Food & hospitality', leisure: 'Leisure & sport',
  'small-factory': 'Small factories', infrastructure: 'Infrastructure', 'fit-out': 'Fit-out',
};
/** Short pill text on cards (Atlas design). */
export const CATEGORY_PILL: Record<TurnkeyCategory, string> = {
  'self-service': 'Self-service', food: 'Food', leisure: 'Leisure', 'small-factory': 'Small factory', infrastructure: 'Infra', 'fit-out': 'Fit-out',
};
export const CATEGORY_PILL_CLASS: Record<TurnkeyCategory, string> = {
  'self-service': 'bg-[#E0E7FF] text-[#3730A3]', food: 'bg-[#FFE4E6] text-[#9F1239]', leisure: 'bg-[#DCFCE7] text-[#166534]',
  'small-factory': 'bg-[#FEF3C7] text-[#854D0E]', infrastructure: 'bg-[#CFFAFE] text-[#155E75]', 'fit-out': 'bg-[#F3E8FF] text-[#6B21A8]',
};

export type TurnkeyProject = {
  project_id: string; title: string; category: TurnkeyCategory; short_reason: string | null;
  starting_budget_usd: number | null; budget_unit: string | null; lead_time_days: number | null;
  best_markets: string[]; factory_hub_ids: string[]; hub_label: string | null; status: TurnkeyStatus;
  is_starter_pick: boolean; starter_rank: number | null; sort_rank: number; hero_image_path: string | null;
  overview_md: string | null; highlights: string[]; earn: { label: string; value: string; note: string }[];
  four_tests: Record<string, unknown>; seo_title: string | null; seo_description: string | null;
};
export type TurnkeyHub = { hub_id: string; name: string; province: string | null; lat: number | null; lng: number | null; known_for: string | null; sort_rank: number };
export type TurnkeyEquipment = { line_id: string; sort_order: number; group_label: string | null; name: string; quantity: number; unit: string | null; spec_md: string | null; budget_usd: number | null };
export type TurnkeyPackage = {
  package_id: string; project_id: string; tier_name: string; tier_rank: number; tier_label: string | null; starting_budget_usd: number | null;
  starting_budget_notes: string | null; capacity_label: string | null; items_count: number | null; space_label: string | null; container_label: string | null;
  lead_time_days: number | null; monthly_revenue_low: number | null; monthly_revenue_high: number | null; payback_months_low: number | null;
  payback_months_high: number | null; summary_md: string | null; is_active: boolean; equipment: TurnkeyEquipment[];
};
export type TurnkeySource = { sort_order: number; region_label: string; title: string; description: string | null };

const nf = new Intl.NumberFormat('en-US');
/** 38000 → "$38 k"; 1100 → "$1.1 k"; 800 → "$800" */
export function kUsd(n: number | null | undefined) {
  if (n == null) return null;
  if (n < 1000) return `$${nf.format(n)}`;
  const k = n / 1000;
  return `$${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, '')} k`;
}
export const usd = (n: number | null | undefined) => (n == null ? null : `$${nf.format(n)}`);
/** "From $22 k/court" */
export function fromLabel(p: Pick<TurnkeyProject, 'starting_budget_usd' | 'budget_unit'>) {
  const k = kUsd(p.starting_budget_usd);
  return k ? `From ${k}${p.budget_unit ? `/${p.budget_unit}` : ''}` : null;
}
export function rangeLabel(lo: number | null, hi: number | null, unit: (n: number) => string) {
  if (lo == null && hi == null) return null;
  if (lo != null && hi != null) return `${unit(lo)} – ${unit(hi)}`;
  return unit((lo ?? hi)!);
}
export const paybackLabel = (k: Pick<TurnkeyPackage, 'payback_months_low' | 'payback_months_high'>) =>
  k.payback_months_low != null && k.payback_months_high != null ? `${k.payback_months_low}–${k.payback_months_high} months` : k.payback_months_low != null ? `${k.payback_months_low} months` : null;
export const equipmentTotal = (k: Pick<TurnkeyPackage, 'equipment'>) => k.equipment.reduce((s, e) => s + (e.budget_usd ?? 0), 0);

/** Approximate lat/lng → position (%) inside the Atlas map box (China, roughly 18–45°N, 98–126°E). Not geo-accurate by design. */
/** Map positions from design/TurnkeyAtlas.dc.html (stylised, not geo-accurate); Jinan added between Qingdao and Zhengzhou. */
const MAP_POS: Record<string, { left: number; top: number }> = {
  'CN-LN-SY': { left: 30, top: 18 }, 'CN-SD-QD': { left: 52, top: 26 }, 'CN-SD-JN': { left: 42, top: 30 }, 'CN-HA-ZZ': { left: 34, top: 40 },
  'CN-JS-ZJG': { left: 54, top: 44 }, 'CN-ZJ-NB': { left: 62, top: 52 }, 'CN-ZJ-WZ': { left: 56, top: 60 }, 'CN-FJ-RA': { left: 50, top: 66 },
  'CN-GD-CZ': { left: 46, top: 74 }, 'CN-GD-FS': { left: 26, top: 76 }, 'CN-GD-GZ': { left: 33, top: 70 }, 'CN-GD-SZ': { left: 38, top: 82 },
};
export function hubPosition(h: Pick<TurnkeyHub, 'lat' | 'lng'> & { hub_id?: string }) {
  if (h.hub_id && MAP_POS[h.hub_id]) return MAP_POS[h.hub_id];
  const lat = Number(h.lat ?? 30), lng = Number(h.lng ?? 115);
  const x = ((lng - 98) / (126 - 98)) * 100;
  const y = ((45 - lat) / (45 - 18)) * 100;
  return { left: Math.min(94, Math.max(6, x)), top: Math.min(90, Math.max(8, y)) };
}

export type AtlasSort = 'budget' | 'lead' | 'hub';
export function filterProjects(projects: TurnkeyProject[], opts: { category?: string | null; hub?: string | null; sort?: AtlasSort }) {
  let list = projects.filter((p) => p.status !== 'archived');
  if (opts.category) list = list.filter((p) => p.category === opts.category);
  if (opts.hub) list = list.filter((p) => p.factory_hub_ids.includes(opts.hub!));
  const sort = opts.sort ?? 'budget';
  const live = (p: TurnkeyProject) => (p.status === 'live' ? 0 : 1);
  return [...list].sort((a, b) => {
    if (sort === 'lead') return (a.lead_time_days ?? 1e9) - (b.lead_time_days ?? 1e9) || a.sort_rank - b.sort_rank;
    if (sort === 'hub') return (a.hub_label ?? '~').localeCompare(b.hub_label ?? '~') || a.sort_rank - b.sort_rank;
    return live(a) - live(b) || (a.starting_budget_usd ?? 1e12) - (b.starting_budget_usd ?? 1e12) || a.sort_rank - b.sort_rank;
  });
}

/** Problems with the starter-pick set (unit-tested; the DB enforces the same with a unique index + check). */
export function starterPickProblems(projects: Pick<TurnkeyProject, 'project_id' | 'is_starter_pick' | 'starter_rank' | 'status'>[]) {
  const picks = projects.filter((p) => p.is_starter_pick && p.status !== 'archived');
  const problems: string[] = [];
  const ranks = picks.map((p) => p.starter_rank);
  if (ranks.some((r) => r == null || r < 1 || r > 5)) problems.push('Starter ranks must be 1–5.');
  if (new Set(ranks).size !== ranks.length) problems.push('Starter ranks must be unique.');
  if (picks.length > 5) problems.push('At most five starter picks.');
  return problems;
}

/** four_tests: {equipment_share: 0..1 | null, ships_in_container, simple_revenue, non_expert_buyer: boolean} */
export function validFourTests(v: unknown): v is { equipment_share: number | null; ships_in_container: boolean; simple_revenue: boolean; non_expert_buyer: boolean } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const share = o.equipment_share;
  return (share === null || share === undefined || (typeof share === 'number' && share >= 0 && share <= 1))
    && ['ships_in_container', 'simple_revenue', 'non_expert_buyer'].every((k) => typeof o[k] === 'boolean');
}

/** WhatsApp deep link with the reference number prefilled. */
export function waLink(number: string | null | undefined, text: string) {
  const digits = (number ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

