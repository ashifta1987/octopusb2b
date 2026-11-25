import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';
import { TK_PROJECT_COLUMNS, type TkProject, type TkService } from './format';

/** Public Turnkey catalogue (T1): every project that is not archived. Cached 5 min, tag `turnkey`. */
export async function getTurnkeyCatalogue(): Promise<{ projects: TkProject[] }> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('turnkey');
  const { data } = await createPublicClient().from('turnkey_projects').select(TK_PROJECT_COLUMNS).neq('status', 'archived').order('sort_rank').order('title');
  return {
    projects: ((data ?? []) as unknown as TkProject[]).map((p) => ({ ...p, floor_area_m2: p.floor_area_m2 == null ? null : Number(p.floor_area_m2) })),
  };
}

/** Services and starting fees (tk_services), active only. */
export async function getTkServices(): Promise<TkService[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('turnkey');
  const { data } = await createPublicClient().from('tk_services').select('code, name, from_cents, unit, approx, rule_text, group_code, photo_path, sort').eq('active', true).order('sort');
  return ((data ?? []) as TkService[]).map((s) => ({ ...s, from_cents: Number(s.from_cents) }));
}
