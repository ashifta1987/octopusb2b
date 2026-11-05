import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { createAdminClient, createPublicClient } from '@/lib/supabase/server';

/**
 * Real platform figures for the home page (no fabricated marketing numbers).
 * Aggregates only — no buyer identities leave this function. Values are null/0 when there is no data yet,
 * and the UI shows an empty state instead of a made-up figure.
 */
export type LiveQuote = { unit_price_minor: number; currency: string; supplier_code: string; supplier_country: string | null };
export type LiveRfq = { code: string; quantity: number; unit: string; title: string; destination_country: string | null; quotes: LiveQuote[]; quote_count: number };
export type HomeLiveData = {
  products: number;
  verifiedSuppliers: number;
  markets: number;                 // distinct buyer countries with at least one (non-cancelled) order
  maxBulkSavingPct: number | null; // best tier saving vs. base price across live products
  destinations: string[];          // ISO country codes we have shipped / sold to (most orders first)
  shipments: number;               // parcels/shipments created
  carriers: number;                // active carrier integrations
  liveRfq: LiveRfq | null;         // most recent RFQ with quotes (buyer shown only by destination country)
};

export async function getHomeLiveData(): Promise<HomeLiveData> {
  'use cache';
  cacheLife({ revalidate: 300 });
  cacheTag('products');
  cacheTag('site-content');
  cacheTag('home-live');
  const pub = createPublicClient();
  let admin: ReturnType<typeof createAdminClient> | null = null;
  try { admin = createAdminClient(); } catch { admin = null; }

  const [prodCount, supCount, tiers] = await Promise.all([
    pub.from('products').select('id', { count: 'exact', head: true }).eq('status', 'live').is('archived_at', null).eq('is_seed', false),
    pub.from('public_suppliers').select('id', { count: 'exact', head: true }).eq('verified', true),
    pub.from('price_tiers').select('product_id, min_qty, unit_price_cents').limit(5000),
  ]);

  // best saving: (base tier − best tier) / base tier, per product
  const byProduct = new Map<string, { min_qty: number; unit_price_cents: number }[]>();
  for (const t of tiers.data ?? []) {
    const arr = byProduct.get(t.product_id as string) ?? [];
    arr.push({ min_qty: Number(t.min_qty), unit_price_cents: Number(t.unit_price_cents) });
    byProduct.set(t.product_id as string, arr);
  }
  let best: number | null = null;
  for (const arr of byProduct.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.min_qty - b.min_qty);
    const base = arr[0].unit_price_cents, low = Math.min(...arr.map((x) => x.unit_price_cents));
    if (base > 0 && low < base) best = Math.max(best ?? 0, Math.round(((base - low) / base) * 100));
  }

  let markets = 0, destinations: string[] = [], shipments = 0, carriers = 0, liveRfq: LiveRfq | null = null;
  if (admin) {
    const [orders, ships, carr, rfqs] = await Promise.all([
      admin.from('orders').select('org_id, organizations(country)').neq('status', 'cancelled').eq('is_seed', false).limit(5000),
      admin.from('shipments').select('id, org_id', { count: 'exact' }).limit(5000),
      admin.from('carriers').select('code', { count: 'exact', head: true }).eq('active', true),
      admin.from('rfqs').select('id, code, quantity, unit, title, destination_country, product_id, products(title), created_at')
        .in('status', ['submitted', 'assigned', 'quoting', 'quoted']).order('created_at', { ascending: false }).limit(10),
    ]);
    const countryOf = (r: { organizations?: unknown }) => {
      const o = r.organizations as { country?: string | null } | { country?: string | null }[] | null | undefined;
      return (Array.isArray(o) ? o[0]?.country : o?.country) ?? null;
    };
    const tally = new Map<string, number>();
    const buyerCountries = new Set<string>();
    for (const o of orders.data ?? []) { const c = countryOf(o); if (c) { buyerCountries.add(c); tally.set(c, (tally.get(c) ?? 0) + 1); } }
    // shipments.org_id has no FK to organizations → resolve countries with a second query
    const shipOrgIds = [...new Set((ships.data ?? []).map((x) => x.org_id as string).filter(Boolean))];
    const { data: shipOrgs } = shipOrgIds.length ? await admin.from('organizations').select('id, country').in('id', shipOrgIds) : { data: [] as { id: string; country: string | null }[] };
    const orgCountry = new Map((shipOrgs ?? []).map((o) => [o.id as string, (o.country as string) ?? null]));
    for (const s of ships.data ?? []) { const c = orgCountry.get(s.org_id as string); if (c) tally.set(c, (tally.get(c) ?? 0) + 1); }
    markets = buyerCountries.size;
    destinations = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    shipments = ships.count ?? (ships.data ?? []).length;
    carriers = carr.count ?? 0;

    // live RFQ card: newest open RFQ that has sent quotes; quotes shown by supplier code + country only
    for (const r of rfqs.data ?? []) {
      const { data: qs } = await admin.from('quotes').select('unit_price_cents, currency, status, supplier_id').eq('rfq_id', r.id)
        .in('status', ['sent', 'viewed']).order('unit_price_cents', { ascending: true });
      if (!qs?.length) continue;
      const { data: sups } = await admin.from('public_suppliers').select('id, code, country').in('id', qs.map((q) => q.supplier_id as string));
      const supMap = new Map((sups ?? []).map((s) => [s.id as string, s]));
      const prod = r.products as { title?: string } | { title?: string }[] | null;
      const prodTitle = (Array.isArray(prod) ? prod[0]?.title : prod?.title) ?? null;
      liveRfq = {
        code: r.code as string,
        quantity: Number(r.quantity),
        unit: (r.unit as string) ?? 'pcs',
        title: prodTitle ?? String(r.title ?? '').replace(/^[\d,.\s]+[a-z]*\s*·\s*/i, '').slice(0, 80),
        destination_country: (r.destination_country as string) ?? null,
        quote_count: qs.length,
        quotes: qs.slice(0, 3).map((q) => ({
          unit_price_minor: Number(q.unit_price_cents), currency: (q.currency as string) ?? 'USD',
          supplier_code: (supMap.get(q.supplier_id as string)?.code as string) ?? 'Supplier',
          supplier_country: (supMap.get(q.supplier_id as string)?.country as string) ?? null,
        })),
      };
      break;
    }
  }

  return {
    products: prodCount.count ?? 0,
    verifiedSuppliers: supCount.count ?? 0,
    markets, maxBulkSavingPct: best, destinations, shipments, carriers, liveRfq,
  };
}

/** 'NL' → 🇳🇱 (regional indicator symbols); decorative only. */
export function flagEmoji(code: string) {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
}
