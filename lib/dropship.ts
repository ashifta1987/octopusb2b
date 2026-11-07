import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';

/**
 * ADDON-44-E — Dropshipping catalogue data. Everything comes from the SECURITY DEFINER functions in migration 183,
 * which only return verified, live, dropship-enabled products and service names (no supplier, carrier or Octopus cost).
 */
export type ShipType = 'express' | 'standard' | 'economy';
export type Quote = { service: ShipType; ships_from: string; product_cents: number; ship_duty_cents: number; fee_cents: number; total_cents: number; days_min: number; days_max: number };
export type CatalogueRow = {
  product_id: string; slug: string; title: string; image_url: string | null; category_id: string | null; category_name: string | null;
  stock_warehouse: number; stock_partner: number; variant_count: number; services: Quote[]; blocked_reason: string | null;
};
export type Variant = { id: string; name: string; colour: string | null; stock_warehouse: number; stock_partner: number };
export type Detail = CatalogueRow & {
  has_battery: boolean; has_liquid: boolean; weight_g: number; store_title: string; store_bullets: string[]; store_description: string | null;
  images: string[]; variants: Variant[]; blocked_countries: string[];
};

export const SHIP_LABEL: Record<ShipType, string> = { express: 'Express', standard: 'Standard', economy: 'Economy' };
export const days = (q: Pick<Quote, 'days_min' | 'days_max'>) => `${q.days_min}–${q.days_max} days`;

export async function dropshipSettings() {
  const { settings } = await getSiteContent();
  const markup = Number(settings['dropship.markup']);
  const handling = Number(settings['dropship.handling_days']);
  return {
    markup: Number.isFinite(markup) && markup > 1 ? markup : null,
    handlingDays: Number.isFinite(handling) && handling > 0 ? handling : null,
    returns: typeof settings['dropship.returns'] === 'string' && (settings['dropship.returns'] as string).trim() ? (settings['dropship.returns'] as string) : null,
    defaultCountry: typeof settings['dropship.default_country'] === 'string' ? (settings['dropship.default_country'] as string) : null,
    demo: settings['demo.addon44'] === true,
  };
}

/** Suggested retail = cost × markup, rounded up to end in .99 (null without a pricing rule). */
export function suggested(totalCents: number, markup: number | null) {
  if (!markup) return null;
  return Math.max(99, Math.ceil((totalCents * markup) / 100) * 100 - 1);
}
export function profit(priceCents: number, totalCents: number) {
  const p = priceCents - totalCents;
  return { cents: p, pct: priceCents > 0 ? Math.round((p / priceCents) * 100) : 0 };
}

export async function dropshipCountries(): Promise<string[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('dropship_countries');
  if (error) throw new Error(`Could not load dropship countries: ${error.message}`);
  return ((data ?? []) as unknown as (string | { dropship_countries: string })[]).map((r) => (typeof r === 'string' ? r : r.dropship_countries));
}

export async function dropshipCatalogue(country: string): Promise<CatalogueRow[]> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('dropship_catalogue', { p_country: country });
  if (error) throw new Error(`Could not load the catalogue: ${error.message}`);
  return (data ?? []) as CatalogueRow[];
}

export async function dropshipDetail(id: string, country: string): Promise<Detail | null> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('dropship_product_detail', { p_product: id, p_country: country });
  if (error) throw new Error(`Could not load the product: ${error.message}`);
  return (data ?? null) as Detail | null;
}

export async function importList(orgId: string) {
  const sb = await createClient();
  const { data, error } = await sb.from('dropship_import_list').select('product_id, variant_id, service, price_cents').eq('org_id', orgId);
  if (error) throw new Error(`Could not load your import list: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.product_id as string, r]));
}

/** The quote shown on a card: the chosen shipping type, else the fastest available. */
export function pickQuote(services: Quote[], ship?: ShipType | null) {
  if (ship) return services.find((s) => s.service === ship) ?? null;
  return [...services].sort((a, b) => a.days_min - b.days_min || a.total_cents - b.total_cents)[0] ?? null;
}

