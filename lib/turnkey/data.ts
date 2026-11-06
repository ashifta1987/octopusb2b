import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';
import type { TurnkeyHub, TurnkeyPackage, TurnkeyProject, TurnkeySource, TurnkeyEquipment } from './format';

/** Public Turnkey catalogue (ADDON-31): RLS hides archived projects / inactive packages. Cached 5 min, tag `turnkey`. */
export async function getTurnkeyCatalogue(): Promise<{ projects: TurnkeyProject[]; hubs: TurnkeyHub[]; packages: TurnkeyPackage[] }> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('turnkey');
  const sb = createPublicClient();
  const [p, h, k] = await Promise.all([
    sb.from('turnkey_projects').select('*').neq('status', 'archived').order('sort_rank'),
    sb.from('turnkey_hubs').select('*').order('sort_rank'),
    sb.from('turnkey_packages').select('*').eq('is_active', true).order('tier_rank'),
  ]);
  return {
    projects: (p.data ?? []) as TurnkeyProject[],
    hubs: ((h.data ?? []) as TurnkeyHub[]).map((x) => ({ ...x, lat: x.lat == null ? null : Number(x.lat), lng: x.lng == null ? null : Number(x.lng) })),
    packages: ((k.data ?? []) as Omit<TurnkeyPackage, 'equipment'>[]).map((x) => ({ ...x, equipment: [] })),
  };
}

export async function getTurnkeyProject(slug: string): Promise<{ project: TurnkeyProject; packages: TurnkeyPackage[]; sources: TurnkeySource[]; hubs: TurnkeyHub[] } | null> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('turnkey');
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const sb = createPublicClient();
  const { data: project } = await sb.from('turnkey_projects').select('*').eq('project_id', slug).neq('status', 'archived').maybeSingle();
  if (!project) return null;
  const [k, s, h] = await Promise.all([
    sb.from('turnkey_packages').select('*, turnkey_equipment(line_id, sort_order, group_label, name, quantity, unit, spec_md, budget_usd)').eq('project_id', slug).eq('is_active', true).order('tier_rank'),
    sb.from('turnkey_project_sources').select('sort_order, region_label, title, description').eq('project_id', slug).order('sort_order'),
    sb.from('turnkey_hubs').select('*').in('hub_id', (project as TurnkeyProject).factory_hub_ids.length ? (project as TurnkeyProject).factory_hub_ids : ['-']),
  ]);
  const packages = ((k.data ?? []) as (Omit<TurnkeyPackage, 'equipment'> & { turnkey_equipment: TurnkeyEquipment[] })[]).map(({ turnkey_equipment, ...x }) => ({
    ...x, equipment: [...(turnkey_equipment ?? [])].sort((a, b) => a.sort_order - b.sort_order),
  }));
  return { project: project as TurnkeyProject, packages, sources: (s.data ?? []) as TurnkeySource[], hubs: (h.data ?? []) as TurnkeyHub[] };
}

export async function getTurnkeySlugs(): Promise<string[]> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('turnkey');
  const { data } = await createPublicClient().from('turnkey_projects').select('project_id').neq('status', 'archived');
  return (data ?? []).map((r) => r.project_id as string);
}

