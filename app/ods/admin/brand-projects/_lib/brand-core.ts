/**
 * ODS T9 · Back Office › Services › Make My Brand projects — pure logic (server + client + tests).
 * Labels, steps and staff moves come from TODAY's lib/brand-projects (BRAND_STEPS / BRAND_STATUS_LABEL / brandMoves);
 * set_brand_project_status() still enforces every rule. This only maps them onto ODS tones, tabs and the stepper.
 */
import type { StatusTone, StepStatus } from '@octopus/ui';
import { BRAND_STATUS_LABEL, BRAND_STEPS, BRAND_TONE } from '@/lib/brand-projects';

export const BRAND_PATH = '/admin/brand-projects';
export type BrandTab = 'all' | (typeof BRAND_STEPS)[number] | 'closed';
export const BRAND_TABS: [BrandTab, string][] = [['all', 'All'], ...BRAND_STEPS.map((s) => [s, BRAND_STATUS_LABEL[s]] as [BrandTab, string]), ['closed', 'Closed']];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Today's ?status= rule: one of the steps or closed, else all. */
export function parseBrandTab(sp: Record<string, string | string[] | undefined>): BrandTab {
  const s = first(sp.status);
  return s && (BRAND_STEPS as readonly string[]).concat('closed').includes(s) ? (s as BrandTab) : 'all';
}
export const brandTabHref = (base: string, t: BrandTab, extra?: Record<string, string>) => {
  const u = new URLSearchParams(extra);
  if (t !== 'all') u.set('status', t);
  const q = u.toString();
  return q ? `${base}?${q}` : base;
};

const TONE: Record<string, StatusTone> = { blue: 'info', amber: 'warning', green: 'success', gray: 'neutral' };
/** Today's badge tone (BRAND_TONE) → ODS pill tone. */
export const brandTone = (status: string): StatusTone => TONE[BRAND_TONE[status] ?? 'gray'] ?? 'neutral';
export const brandLabel = (status: string) => BRAND_STATUS_LABEL[status] ?? status;

/** Counts per tab from the rows (one read of every project, then filtered — same rows today's per-status read returns). */
export function brandCounts(rows: readonly { status: string }[]): Record<BrandTab, number> {
  const out = { all: rows.length } as Record<BrandTab, number>;
  for (const [t] of BRAND_TABS) if (t !== 'all') out[t] = rows.filter((r) => r.status === t).length;
  return out;
}

/**
 * Stepper over today's 6 steps. Closed: steps before the one it was closed from are done, that step is an error step
 * ("Closed"), the rest upcoming. Stocked = all done.
 */
export function brandSteps(status: string, closedFrom: string | null): { id: string; label: string; status: StepStatus }[] {
  const steps = BRAND_STEPS as readonly string[];
  const at = status === 'closed' ? steps.indexOf(closedFrom ?? 'submitted') : steps.indexOf(status);
  const idx = at < 0 ? 0 : at;
  return steps.map((s, i) => ({
    id: s,
    label: BRAND_STATUS_LABEL[s],
    status: status === 'closed' ? (i < idx ? 'done' : i === idx ? 'error' : 'upcoming') : status === 'stocked' ? 'done' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming',
  }));
}

export const RECORD_TABS = ['overview', 'logos', 'history'] as const;
export type BrandRecordTab = (typeof RECORD_TABS)[number];
export const isBrandRecordTab = (v: unknown): v is BrandRecordTab => typeof v === 'string' && (RECORD_TABS as readonly string[]).includes(v);

/** Logo file name from a storage path ("<org>/<uuid>-logo.png" → "logo.png"), as today. */
export const logoName = (path: string) => (path.split('/').pop() ?? path).replace(/^[0-9a-f-]{36}-/, '');

export function historyTitle(h: { from_status: string | null; to_status: string | null }): string {
  return h.from_status ? `${brandLabel(h.from_status)} → ${brandLabel(h.to_status ?? '')}` : 'Submitted by the customer';
}
