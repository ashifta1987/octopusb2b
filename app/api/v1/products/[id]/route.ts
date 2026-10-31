import { apiRoute, isUuid } from '@/lib/api/handler';
import { PRODUCT_COLUMNS, publicProduct, publicSuppliers } from '@/lib/api/data';
import { json, problem } from '@/lib/api/problem';
import { loadFx, price } from '@/lib/api/money';

/** GET /api/v1/products/{id|slug} — detail with price tiers, specs, media, tags and valid certificates. */
export const GET = apiRoute<{ id: string }>({ scopes: ['catalog:read'] }, async ({ ctx, params }) => {
  const idOrSlug = params.id;
  const { data: p } = await ctx.sb
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq(isUuid(idOrSlug) ? 'id' : 'slug', idOrSlug)
    .eq('status', 'live')
    .is('archived_at', null)
    .maybeSingle();
  if (!p) return problem(404, 'NOT_FOUND', 'Product not found.');

  const [tiers, specs, media, tags, certs, sups, fx] = await Promise.all([
    ctx.sb.from('price_tiers').select('min_qty, unit_price_cents, currency').eq('product_id', p.id).order('min_qty'),
    ctx.sb.from('product_specs').select('name, value').eq('product_id', p.id).order('sort'),
    ctx.sb.from('product_media').select('url, kind, alt').eq('product_id', p.id).order('sort'),
    ctx.sb.from('product_tags').select('tag:tags(name, slug, kind)').eq('product_id', p.id),
    ctx.sb.from('product_certificates').select('certificate:certificates(name, issuer, status, expires_at)').eq('product_id', p.id),
    publicSuppliers(ctx.sb, [p.supplier_id]),
    loadFx(ctx.sb),
  ]);

  return json({
    data: {
      ...publicProduct(p, fx, sups.get(p.supplier_id)),
      price_tiers: (tiers.data ?? []).map((t) => ({ min_qty: t.min_qty, unit_price: price(t.unit_price_cents, t.currency, fx) })),
      specs: specs.data ?? [],
      media: media.data ?? [],
      tags: (tags.data ?? []).map((t) => t.tag).filter(Boolean),
      certificates: (certs.data ?? [])
        .map((c) => c.certificate as unknown as { name: string; issuer: string | null; status: string; expires_at: string | null } | null)
        .filter((c) => c && (c.status === 'verified' || c.status === 'expiring'))
        .map((c) => ({ name: c!.name, issuer: c!.issuer, expires_at: c!.expires_at })),
    },
  });
});
