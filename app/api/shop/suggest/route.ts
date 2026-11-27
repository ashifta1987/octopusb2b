import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSiteContent } from '@/lib/content';
import { listOpenPools, listProducts } from '@/components/store/data';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { buildSuggestGroups, clampLimit, cleanQuery } from '@/app/ods/shop/_lib/suggest';

/**
 * ODS T4 · GET /api/shop/suggest?q=&limit= — ShopHeader search suggestions (Part 5.1): products, MOQ pools, turnkey
 * projects, categories. Signed-in customers only (401 otherwise). q needs 2+ characters; limit 1–8 per group (default 5).
 * Data: the public cached catalogue queries (listProducts full-text search, open pools, turnkey catalogue, categories);
 * the response carries only label + public href (+ a short type line) — no supplier fields, prices or ids beyond slugs
 * and public codes. Not cached by the browser or CDN (private, no-store). The client debounces (200 ms).
 */
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const s = await getSession().catch(() => null);
  if (!s?.org) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401, headers: HEADERS });
  const q = cleanQuery(req.nextUrl.searchParams.get('q'));
  const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
  if (q.length < 2) return NextResponse.json({ groups: [] }, { headers: HEADERS });
  const [products, pools, turnkey, content] = await Promise.allSettled([
    listProducts({ q }),
    listOpenPools({ limit: 200 }),
    getTurnkeyCatalogue(),
    getSiteContent(),
  ]);
  const settings = content.status === 'fulfilled' ? content.value.settings : {};
  const groups = buildSuggestGroups(
    q,
    {
      products: products.status === 'fulfilled' ? products.value.items.map((p) => ({ slug: p.slug, title: p.title })) : [],
      pools: pools.status === 'fulfilled' && settings.pool_enabled !== false ? pools.value.items.map((p) => ({ code: p.code, product: { title: p.product.title } })) : [],
      projects: turnkey.status === 'fulfilled' && settings['turnkey.enabled'] !== false ? turnkey.value.projects.map((p) => ({ project_id: p.project_id, title: p.title })) : [],
      categories: content.status === 'fulfilled' ? content.value.categories.map((c) => ({ slug: c.slug, name: c.name })) : [],
    },
    limit,
  );
  return NextResponse.json({ groups }, { headers: HEADERS });
}
