import { apiRoute, isUuid } from '@/lib/api/handler';
import { json, problem } from '@/lib/api/problem';

/** GET /api/v1/categories — active category tree (flat, 4 levels; use parent_id to build the tree). */
export const GET = apiRoute({ scopes: ['catalog:read'] }, async ({ ctx, url }) => {
  let q = ctx.sb.from('categories').select('id, parent_id, name, slug, level, hs_code, sort').eq('active', true);
  const level = Number(url.searchParams.get('level'));
  if (level >= 1 && level <= 4) q = q.eq('level', level);
  const parent = url.searchParams.get('parent_id');
  if (parent) {
    if (!isUuid(parent)) return problem(400, 'INVALID_QUERY', 'parent_id must be a UUID.');
    q = q.eq('parent_id', parent);
  }
  const { data, error } = await q.order('level').order('sort').order('name');
  if (error) throw new Error(error.message);
  return json({ data: data ?? [] });
});
