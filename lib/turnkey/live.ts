import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES } from '@/lib/format';

/**
 * The "open project" card (Turnkey hub hero + home banner): newest REAL lead that is in progress (contacted / quoted).
 * Shows only reference, project, package, destination country and stage — never the buyer's name or company.
 * Returns null when there is none, and the card is hidden (ADDON-32: never invent data).
 */
export type OpenProjectCard = { reference: string; project: string; tier: string | null; country: string; stage: string; budget: number | null; lead_days: number | null; payback: string | null };

export async function getOpenProjectCard(): Promise<OpenProjectCard | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('turnkey');
  cacheTag('turnkey-leads');
  let sb: ReturnType<typeof createAdminClient>;
  try { sb = createAdminClient(); } catch { return null; }
  const { data } = await sb.from('turnkey_leads')
    .select('reference, status, country, turnkey_projects(title), turnkey_packages(tier_name, starting_budget_usd, lead_time_days, payback_months_low, payback_months_high)')
    .in('status', ['contacted', 'quoted']).eq('is_seed', false).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const proj = (Array.isArray(data.turnkey_projects) ? data.turnkey_projects[0] : data.turnkey_projects) as { title: string } | null;
  const pkg = (Array.isArray(data.turnkey_packages) ? data.turnkey_packages[0] : data.turnkey_packages) as { tier_name: string; starting_budget_usd: number | null; lead_time_days: number | null; payback_months_low: number | null; payback_months_high: number | null } | null;
  return {
    reference: data.reference as string, project: proj?.title ?? 'Turnkey project', tier: pkg?.tier_name ?? null,
    country: COUNTRY_NAMES[data.country as string] ?? (data.country as string), stage: data.status === 'quoted' ? 'Quoted' : 'Specifying',
    budget: pkg?.starting_budget_usd ?? null, lead_days: pkg?.lead_time_days ?? null,
    payback: pkg?.payback_months_low != null && pkg?.payback_months_high != null ? `${pkg.payback_months_low}–${pkg.payback_months_high} mo` : null,
  };
}

