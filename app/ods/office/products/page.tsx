// ODS T9 · Catalogue › Product moderation. Replaces the T8 re-export of app/office/products/page.tsx inside the ODS Back Office
// frame. Same guard (requireStaff('products','approve')), the same reads as today (portal_products() for the hidden
// moderation / HS columns, item_master, product_publish_blocker), today's moderateProduct unchanged. Supplier code / name
// come from the same embed as today (RLS decides).
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { portalProducts } from '@/components/backoffice/hidden-columns';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { moderateProduct } from '@/app/office/actions';
import { ModerationScreen, type ProductDetail, type QueueRow } from './_components/moderation-screen';

export const metadata = { title: 'Product moderation' };

const ACTIONS = { moderate: moderateProduct };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
type SP = Promise<{ p?: string }>;

async function ModerationContent({ searchParams }: { searchParams: SP }) {
  await requireStaff('products', 'approve', '/office/products');
  const { p: selId } = await searchParams;
  const sb = await createClient();
  const { data: queueRaw, error: queueError } = await portalProducts(sb)
    .select('id, title, status, updated_at, image_url, moderation_hold, suppliers!products_supplier_id_fkey(code, country)')
    .in('status', ['submitted', 'in_review'])
    .order('updated_at')
    .limit(100);
  const queue: QueueRow[] | null = queueError
    ? null
    : ((queueRaw ?? []) as Record<string, unknown>[]).map((q) => {
        const s = one(q.suppliers as { code: string; country: string } | null);
        return { id: String(q.id), title: String(q.title ?? ''), status: String(q.status), updated_at: String(q.updated_at), image_url: (q.image_url as string | null) ?? null, moderation_hold: !!q.moderation_hold, supplier_code: s?.code ?? null, supplier_country: s?.country ?? null };
      });
  const selected = selId ? await loadDetail(sb, selId) : null;
  return <ModerationScreen state="ok" queue={queue} queueError={queueError?.message ?? null} selected={selected} actions={ACTIONS} />;
}

async function loadDetail(sb: Awaited<ReturnType<typeof createClient>>, id: string): Promise<ProductDetail | null> {
  const { data: pr } = await portalProducts(sb)
    .select('id, external_id, title, description, status, moderation_hold, moderation_hold_reason, hs_code_status, hs_code_source, hs_code_note, unit, moq, lead_time_days, incoterm, origin_country, hs_code, net_weight, colour_box_mm, octopus_dropship, ready_to_ship, seo_title, seo_description, image_url, updated_at, rejection_reason, suppliers!products_supplier_id_fkey(code, legal_name, country, verified, supplier_switches(listings_live)), categories(name), currency, price_tiers(min_qty, unit_price_cents, currency), product_specs(name, value, sort), product_media(url, sort, kind), product_tags(tags(name)), product_certificates(certificates(name, status))')
    .eq('id', id)
    .maybeSingle();
  if (!pr) return null;
  const p = pr as Record<string, unknown>;
  const [{ data: im }, { data: blocker }, cx] = await Promise.all([
    sb.from('item_master').select('weight_g, box_l_cm, box_w_cm, box_h_cm, origin_country, has_battery, has_liquid, has_magnet, has_powder, is_fragile').eq('sourcing_product_id', id).maybeSingle(),
    sb.rpc('product_publish_blocker', { p_product: id }),
    getCurrencyContext(),
  ]);
  const sup = one(p.suppliers as { code: string; legal_name: string; country: string; verified: boolean; supplier_switches: { listings_live: boolean } | { listings_live: boolean }[] | null } | null);
  const tiers = ((p.price_tiers ?? []) as { min_qty: number; unit_price_cents: number; currency: string }[]).sort((a, b) => a.min_qty - b.min_qty);
  const lowest = tiers[tiers.length - 1];
  const lowestPlatform = lowest && lowest.currency !== cx.currency ? toPlatform(cx, lowest.unit_price_cents, lowest.currency) : null;
  const media = ((p.product_media ?? []) as { url: string; sort: number; kind: string }[]).filter((m) => m.kind === 'image').sort((a, b) => a.sort - b.sort);
  return {
    id,
    external_id: (p.external_id as string | null) ?? null,
    title: String(p.title ?? ''),
    description: (p.description as string | null) ?? null,
    status: String(p.status),
    moderation_hold: !!p.moderation_hold,
    moderation_hold_reason: (p.moderation_hold_reason as string | null) ?? null,
    hs_code: (p.hs_code as string | null) ?? null,
    hs_code_status: (p.hs_code_status as string | null) ?? null,
    hs_code_source: (p.hs_code_source as string | null) ?? null,
    hs_code_note: (p.hs_code_note as string | null) ?? null,
    unit: String(p.unit ?? 'pcs'),
    moq: p.moq == null ? null : Number(p.moq),
    lead_time_days: p.lead_time_days == null ? null : Number(p.lead_time_days),
    incoterm: (p.incoterm as string | null) ?? null,
    origin: im?.origin_country ? String(im.origin_country).trim() : ((p.origin_country as string | null) ?? null),
    weight_box:
      im?.weight_g && im?.box_l_cm && im?.box_w_cm && im?.box_h_cm
        ? `${im.weight_g} g · ${im.box_l_cm} × ${im.box_w_cm} × ${im.box_h_cm} cm`
        : p.net_weight || p.colour_box_mm
          ? `${p.net_weight ?? '—'} / ${p.colour_box_mm ?? '—'} (legacy)`
          : '—',
    shippingFlags: [im?.has_battery && 'Battery', im?.has_liquid && 'Liquid', im?.has_magnet && 'Magnet', im?.has_powder && 'Powder', im?.is_fragile && 'Fragile'].filter(Boolean).join(', ') || 'None',
    flags: [p.octopus_dropship && 'Octopus Dropship', p.ready_to_ship && 'Ready to ship'].filter(Boolean).join(', '),
    seo_title: (p.seo_title as string | null) ?? null,
    seo_description: (p.seo_description as string | null) ?? null,
    image_url: (p.image_url as string | null) ?? null,
    updated_at: String(p.updated_at),
    supplier: sup ? { code: sup.code, legal_name: sup.legal_name, country: sup.country, verified: !!sup.verified } : null,
    category: one(p.categories as { name: string } | null)?.name ?? null,
    tiers,
    lowestPlatform: lowestPlatform != null ? { minor: lowestPlatform, currency: cx.currency } : null,
    specs: ((p.product_specs ?? []) as { name: string; value: string; sort: number }[]).sort((a, b) => a.sort - b.sort).map((s) => ({ name: s.name, value: s.value })),
    media: media.map((m) => m.url),
    tags: ((p.product_tags ?? []) as { tags: { name: string } | { name: string }[] | null }[]).map((t) => one(t.tags)?.name).filter((x): x is string => !!x),
    certificates: ((p.product_certificates ?? []) as { certificates: { name: string; status: string } | { name: string; status: string }[] | null }[]).map((c) => one(c.certificates)).filter(Boolean).map((x) => `${x!.name} · ${x!.status}`),
    blocker: blocker ? String(blocker) : null,
    listingsOff: sup ? one(sup.supplier_switches)?.listings_live === false : false,
  };
}

export default function ModerationPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<ModerationScreen state="loading" queue={[]} selected={null} actions={ACTIONS} />}>
      <ModerationContent searchParams={searchParams} />
    </Suspense>
  );
}
