import 'server-only';
import type { createAdminClient } from '@/lib/supabase/server';
import { publicSuppliers } from './data';
import { amt, amt0, cur } from './money';

type Sb = ReturnType<typeof createAdminClient>;

export const RFQ_COLUMNS =
  'id, code, title, details, quantity, unit, status, fee_minor, currency, product_id, category_id, destination_country, destination_city, incoterm, target_price_cents, expires_at, created_at, updated_at';

export const ORDER_COLUMNS =
  'id, code, status, title, quantity, unit_price_cents, shipping_cents, total_cents, deposit_pct, deposit_cents, paid_cents, currency, fx_rate_id, incoterm, quote_id, rfq_id, supplier_id, terms_version_id, delivered_at, claim_visible_until, claim_hidden_until, created_at, updated_at';

const QUOTE_COLUMNS =
  'id, code, rfq_id, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, currency, fx_rate_id, notes, status, valid_until, created_at';

type Row = Record<string, unknown>;

/** RFQ in API shape: fee and target price are `{ amount_minor, currency }` in the RFQ's locked currency. */
export function publicRfq(r: Row) {
  const { fee_minor, target_price_cents, currency, category_id: _c, ...rest } = r;
  void _c;
  return { ...rest, currency: cur(currency), fee: amt0(fee_minor, currency), target_price: amt(target_price_cents, currency) };
}

/** Quote in API shape (currency + rate locked when the quote was sent). */
export function publicQuote(q: Row, supplier: unknown) {
  const { supplier_id: _s, unit_price_cents, shipping_cents, currency, ...rest } = q;
  void _s;
  const total = Number(unit_price_cents) * Number(q.quantity) + Number(shipping_cents ?? 0);
  return {
    ...rest,
    currency: cur(currency),
    unit_price: amt0(unit_price_cents, currency),
    shipping: amt0(shipping_cents, currency),
    total: amt0(total, currency),
    supplier,
  };
}

/** Quotes for the given RFQ ids — caller MUST have verified the RFQs belong to ctx.orgId. */
export async function quotesFor(sb: Sb, rfqIds: string[]) {
  if (!rfqIds.length) return [];
  const { data, error } = await sb.from('quotes').select(QUOTE_COLUMNS).in('rfq_id', rfqIds).neq('status', 'draft').order('created_at');
  if (error) throw new Error(error.message);
  const sups = await publicSuppliers(sb, (data ?? []).map((q) => q.supplier_id));
  return (data ?? []).map((q) => publicQuote(q, sups.get(q.supplier_id) ?? null));
}

/** Order in API shape: every amount carries the order's locked currency. */
export function publicOrder(o: Row, supplier: unknown) {
  const { supplier_id: _omit, unit_price_cents, shipping_cents, total_cents, deposit_cents, paid_cents, currency, ...rest } = o;
  void _omit;
  return {
    ...rest,
    currency: cur(currency),
    unit_price: amt0(unit_price_cents, currency),
    shipping: amt0(shipping_cents, currency),
    total: amt0(total_cents, currency),
    deposit: amt0(deposit_cents, currency),
    paid: amt0(paid_cents, currency),
    balance: amt0(Number(total_cents ?? 0) - Number(paid_cents ?? 0), currency),
    supplier,
  };
}

/** Document (PI, invoice, receipt…) with its amount in the document's own currency. */
export function publicDocument(d: Row) {
  const { amount_cents, currency, ...rest } = d;
  return { ...rest, currency: cur(currency), amount: amt(amount_cents, currency) };
}

/** Service request with the fee in its locked currency. */
export function publicServiceRequest(s: Row) {
  const { fee_minor, currency, fx_rate_id, ...rest } = s;
  return { ...rest, currency: cur(currency), fx_rate_id: fx_rate_id ?? null, fee: amt0(fee_minor, currency) };
}
