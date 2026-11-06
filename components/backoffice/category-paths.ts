import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Active categories → "Parent > Child > Leaf" display paths, plus the top-level ancestor name (for SKU category codes). */
export async function categoryPaths(sb: SupabaseClient) {
  const { data: cats } = await sb.from('categories').select('id, name, parent_id').eq('active', true).order('sort');
  const byId = new Map((cats ?? []).map((c) => [c.id as string, c]));
  const paths = new Map<string, string>(); const top = new Map<string, string>();
  for (const c of cats ?? []) {
    const parts: string[] = []; let cur: typeof c | undefined = c;
    while (cur) { parts.unshift(cur.name as string); cur = cur.parent_id ? byId.get(cur.parent_id as string) : undefined; }
    paths.set(c.id as string, parts.join(' > ')); top.set(c.id as string, parts[0]);
  }
  return { paths, top };
}

