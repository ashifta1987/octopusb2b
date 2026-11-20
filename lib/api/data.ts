import 'server-only';
import type { createAdminClient } from '@/lib/supabase/server';
import { cur, price, type FxContext } from './money';
import { factoryLabel } from '@/lib/factory-label';

type Sb = ReturnType<typeof createAdminClient>;
/** What an API customer may know about the factory: verified badge + country + province and the ready-made label
 *  ("Verified factory · China (Guangdong)"). Never the supplier id, code or name (migration 195, 19 Nov 2026). */
export type PublicFactory = { verified: boolean; country: string | null; province: string | null; label: string };

/**
 * DEPRECATED alias kept so API v1 clients that still read `supplier` do not break (19 Nov 2026). It carries exactly
 * the safe values of `factory` — verified, country, province and the label — copied key by key, so nothing else
 * (id, code, name, contact) can ever ride along. Will be removed: see postman/README.md → API changelog.
 */
export type SupplierAlias = PublicFactory;
export function supplierAlias(f: unknown): SupplierAlias | null {
  if (!f || typeof f !== 'object') return null;
  const x = f as Partial<PublicFactory>;
  return { verified: !!x.verified, country: x.country ?? null, province: x.province ?? null, label: String(x.label ?? '') };
}

/** Supplier ids (read server-side with the service-role API client) → factory info. The ids never leave the server. */
export async function publicFactories(sb: Sb, supplierIds: (string | null | undefined)[]) {
  const uniq = [...new Set(supplierIds.filter(Boolean))] as string[];
  const map = new Map<string, PublicFactory>();
  if (!uniq.length) return map;
  const { data } = await sb.from('suppliers').select('id, verified, identity_status, archived_at, country, province').in('id', uniq);
  for (const s of data ?? []) {
    // same rule as the product_factory / quote_factory / order_factory views
    const f = { verified: !!s.verified && (s.identity_status ?? 'ok') === 'ok' && !s.archived_at, country: s.country ?? null, province: s.province ?? null };
    map.set(s.id, { ...f, label: factoryLabel(f) });
  }
  return map;
}

/** Strips characters that would break PostgREST filter syntax. */
export function safeSearch(q: string) {
  return q.replace(/[^\p{L}\p{N}\s\-.]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** Catalogue prices keep their own currency (1688 suppliers quote CNY) + a `converted` amount in the platform currency. */
export function publicProduct(p: Record<string, unknown>, fx: FxContext, factory?: PublicFactory) {
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
    from_price: price(p.min_price_cents, p.currency, fx),
    currency: cur(p.currency),
    ready_to_ship: p.ready_to_ship,
    octopus_dropship: p.octopus_dropship,
    factory: factory ?? null,
    supplier: supplierAlias(factory),   // deprecated alias of `factory`
  };
}

/** `supplier_id` is read (service-role client) only to look up the factory label; publicProduct never returns it. */
export const PRODUCT_COLUMNS =
  'id, slug, title, description, category_id, supplier_id, unit, moq, lead_time_days, incoterm, origin_country, hs_code, image_url, min_price_cents, currency, ready_to_ship, octopus_dropship';
