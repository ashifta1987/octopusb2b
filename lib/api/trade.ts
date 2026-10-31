import 'server-only';
import type { createAdminClient } from '@/lib/supabase/server';
import { publicSuppliers } from './data';

type Sb = ReturnType<typeof createAdminClient>;

export const RFQ_COLUMNS =
  'id, code, title, details, quantity, unit, status, fee_usd_cents, product_id, category_id, destination_country, destination_city, incoterm, target_price_cents, expires_at, created_at, updated_at';

export const ORDER_COLUMNS =
  'id, code, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, incoterm, quote_id, rfq_id, supplier_id, terms_version_id, delivered_at, claim_visible_until, claim_hidden_until, created_at, updated_at';

const QUOTE_COLUMNS =
  'id, code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, notes, status, valid_until, created_at';

/** Quotes for the given RFQ ids — caller MUST have verified the RFQs belong to ctx.orgId. */
export async function quotesFor(sb: Sb, rfqIds: string[]) {
  if (!rfqIds.length) return [];
  const { data, error } = await sb.from('quotes').select(QUOTE_COLUMNS).in('rfq_id', rfqIds).neq('status', 'draft').order('created_at');
  if (error) throw new Error(error.message);
  const sups = await publicSuppliers(sb, (data ?? []).map((q) => q.supplier_id));
  return (data ?? []).map(({ supplier_id, ...q }) => ({
    ...q,
    total_cents: q.unit_price_cents * q.quantity + q.shipping_cents,
    currency: 'USD',
    supplier: sups.get(supplier_id) ?? null,
  }));
}

export function publicOrder(o: Record<string, unknown>, supplier: unknown) {
  const { supplier_id: _omit, ...rest } = o;
  void _omit;
  return { ...rest, balance_cents: Number(o.total_cents) - Number(o.paid_cents), currency: 'USD', supplier };
}
