import { apiRoute, isUuid, pageMeta, range } from '@/lib/api/handler';
import { PRODUCT_COLUMNS, publicProduct, publicSuppliers, safeSearch } from '@/lib/api/data';
import { json, problem } from '@/lib/api/problem';
import { loadFx } from '@/lib/api/money';
import { ProductQuery, zodIssues } from '@/lib/contracts';

/** GET /api/v1/products — live catalogue search. Supplier shown as code + country only. */
export const GET = apiRoute({ scopes: ['catalog:read'] }, async ({ ctx, url }) => {
  const parsed = ProductQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return problem(400, 'INVALID_QUERY', 'Invalid query parameters.', { errors: zodIssues(parsed.error) });
  const { q, category, page, per_page, ready_to_ship, dropship } = parsed.data;

  let query = ctx.sb.from('products').select(PRODUCT_COLUMNS, { count: 'exact' }).eq('status', 'live').is('archived_at', null);

  if (category) {
    const { data: cats } = await ctx.sb.from('categories').select('id, parent_id, slug').eq('active', true);
    const root = (cats ?? []).find((c) => (isUuid(category) ? c.id === category : c.slug === category));
    if (!root) return problem(404, 'NOT_FOUND', `Category "${category}" not found.`);
    const ids = new Set([root.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of cats ?? []) {
        if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
      }
    }
    query = query.in('category_id', [...ids]);
  }
  if (q) {
    const s = safeSearch(q);
    if (s) query = query.or(`title.ilike.%${s}%,search.wfts(english).${s}`);
  }
  if (ready_to_ship) query = query.eq('ready_to_ship', ready_to_ship === 'true');
  if (dropship) query = query.eq('octopus_dropship', dropship === 'true');

  const [from, to] = range(page, per_page);
  const { data, count, error } = await query.order('featured', { ascending: false }).order('title').range(from, to);
  if (error) throw new Error(error.message);
  const [sups, fx] = await Promise.all([publicSuppliers(ctx.sb, (data ?? []).map((p) => p.supplier_id)), loadFx(ctx.sb)]);
  return json({ data: (data ?? []).map((p) => publicProduct(p, fx, sups.get(p.supplier_id))), meta: pageMeta(page, per_page, count) });
});
