import 'server-only';
import type { createAdminClient } from '@/lib/supabase/server';

type Sb = ReturnType<typeof createAdminClient>;
export type PublicSupplier = { code: string; country: string; verified: boolean };

/** Buyers only ever see supplier code + country + badge (public_suppliers view). Never legal names/contacts/costs. */
export async function publicSuppliers(sb: Sb, ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  const map = new Map<string, PublicSupplier>();
  if (!uniq.length) return map;
  const { data } = await sb.from('public_suppliers').select('id, code, country, verified').in('id', uniq);
  for (const s of data ?? []) map.set(s.id, { code: s.code, country: s.country, verified: s.verified });
  return map;
}

/** Strips characters that would break PostgREST filter syntax. */
export function safeSearch(q: string) {
  return q.replace(/[^\p{L}\p{N}\s\-.]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function publicProduct(p: Record<string, unknown>, sup?: PublicSupplier) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description ?? null,
    category_id: p.category_id ?? null,
    unit: p.unit,
    moq: p.moq,
    lead_time_days: p.lead_time_days ?? null,
    incoterm: p.incoterm ?? null,
    origin_country: p.origin_country ?? null,
    hs_code: p.hs_code ?? null,
    image_url: p.image_url ?? null,
    from_price_cents: p.min_price_cents ?? null,
    currency: 'USD',
    ready_to_ship: p.ready_to_ship,
    octopus_dropship: p.octopus_dropship,
    supplier: sup ?? null,
  };
}

export const PRODUCT_COLUMNS =
  'id, slug, title, description, category_id, supplier_id, unit, moq, lead_time_days, incoterm, origin_country, hs_code, image_url, min_price_cents, ready_to_ship, octopus_dropship';
