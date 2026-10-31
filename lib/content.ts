import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/server';

/** Site settings, content blocks and company profile — every text on the site comes from here (SPEC §8.4). */
export async function getSiteContent() {
    'use cache';
    cacheLife({ revalidate: 300 });
    cacheTag('site-content');
    const sb = createPublicClient();
    const [settings, blocks, company, branches, categories] = await Promise.all([
      sb.from('site_settings').select('key, value'),
      sb.from('content_blocks').select('key, value'),
      sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
      sb.from('branches').select('*').eq('active', true).order('sort'),
      sb.from('categories').select('id, name, slug, level, parent_id, hs_code, sort').eq('active', true).order('sort'),
    ]);
    const s: Record<string, unknown> = {};
    (settings.data ?? []).forEach((r) => (s[r.key] = r.value));
    const b: Record<string, string> = {};
    (blocks.data ?? []).forEach((r) => (b[r.key] = r.value));
    return {
      settings: s,
      blocks: b,
      company: company.data as Company | null,
      branches: (branches.data ?? []) as Branch[],
      categories: (categories.data ?? []) as Category[],
    };
}

export type Company = {
  legal_name: string; brand: string | null; tagline: string | null; address: string | null; address_cn: string | null;
  contact_person: string | null; phone: string | null; whatsapp: string | null; email: string | null; website: string | null;
};
export type Branch = { id: string; name: string; city: string | null; country: string | null; address: string | null; phone: string | null; email: string | null };
export type Category = { id: string; name: string; slug: string; level: number; parent_id: string | null; hs_code: string | null; sort: number };

export function block(blocks: Record<string, string>, key: string, fallback = '') {
  return blocks[key] ?? fallback;
}

export function categoryPath(categories: Category[], id: string | null): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: Category[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur) { path.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return path;
}

export function descendantIds(categories: Category[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) categories.filter((c) => c.parent_id === out[i]).forEach((c) => out.push(c.id));
  return out;
}

