/**
 * C0 · Internal formats → the JSON ds_order_intake takes (client-safe, pure). Every connector (CSV now; Shopify, WooCommerce … later)
 * maps its orders to InternalOrder and sends toIntakeOrder(order) to ds_order_intake(org, channel, order). Integer minor units only.
 */
import type { InternalOrder, InternalShipment } from './types';

/** Currency exponent (ISO 4217): KWD / BHD / OMR / JOD / TND / LYD / IQD 3; JPY / KRW / VND / CLP / ISK / UGX 0; others 2. */
export function currencyExponent(code: string): number {
  const c = (code || '').toUpperCase();
  if (['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD'].includes(c)) return 3;
  if (['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF'].includes(c)) return 0;
  return 2;
}

/**
 * "12.50" / "12,50" / "1,234.50" → integer minor units of the currency, or null when it is not a clean non-negative amount.
 * Never uses floating point for the result (string arithmetic), so 0.1 + 0.2 problems can't happen.
 */
export function decimalToMinor(raw: string | number | null | undefined, currency: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[\s'\u00a0]/g, '').replace(/^[A-Z]{3}/i, '').replace(/^[$€£¥]/, '');
  if (s === '') return null;
  // "1.234,50" (comma decimals) → "1234.50"; "1,234.50" → "1234.50"; "12,50" → "12.50"
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const exp = currencyExponent(currency);
  const frac = m[2] ?? '';
  if (frac.length > exp && /[1-9]/.test(frac.slice(exp))) return null; // more precision than the currency has
  const minor = BigInt(m[1]) * BigInt(10 ** exp) + BigInt((frac + '000').slice(0, exp) || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

export const minorToDecimal = (minor: number | null | undefined, currency: string): string => {
  if (minor == null) return '';
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const neg = minor < 0;
  const s = String(Math.abs(Math.trunc(minor))).padStart(exp + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -exp)}.${s.slice(-exp)}`;
};

/** The JSON ds_order_intake / ds_order_intake_core reads (key names are the database's). */
export function toIntakeOrder(o: InternalOrder): Record<string, unknown> {
  const clean = (v: string | null | undefined) => (v == null || v.trim() === '' ? undefined : v.trim());
  return JSON.parse(JSON.stringify({
    external_order_id: o.externalOrderId.trim(),
    external_order_name: clean(o.externalOrderName),
    currency: o.currency.toUpperCase(),
    fx_rate_to_usd: o.fxRateToUsd ?? undefined,
    buyer_name: clean(o.buyerName),
    buyer_phone: clean(o.buyerPhone),
    shipping_method: o.shippingMethod ?? undefined,
    other_items: o.otherItems && o.otherItems > 0 ? o.otherItems : undefined,
    risk: o.risk ?? undefined,
    address_check: o.addressCheck ?? undefined,
    address_issue: clean(o.addressIssue),
    address: {
      name: clean(o.address.name), phone: clean(o.address.phone), line1: clean(o.address.line1), line2: clean(o.address.line2),
      city: clean(o.address.city), region: clean(o.address.region), postcode: clean(o.address.postcode), country: o.address.country.toUpperCase(),
    },
    lines: o.lines.map((l) => ({
      variant_id: l.variantId ?? undefined,
      model_no: l.modelNo ? l.modelNo.trim().toUpperCase() : undefined,
      qty: l.qty,
      // intake names these "_cents" but they are minor units of the ORDER currency; the quote converts with the locked FX rate
      buyer_unit_price_cents: l.buyerUnitPriceMinor ?? undefined,
      buyer_paid_cents: l.buyerPaidMinor ?? undefined,
      variant_label: clean(l.variantLabel),
    })),
  }));
}

/** A tracking row for a store (or the tracking CSV), from the c0_tracking_export() row. */
export function toInternalShipment(r: {
  order_number: string; external_order_id: string | null; external_order_name: string | null; tracking_numbers: string | null;
  tracking_company: string | null; tracking_token: string | null; shipped_at: string | null;
}, origin: string): InternalShipment {
  return {
    storeOrderNumber: r.order_number,
    externalOrderId: r.external_order_id,
    externalOrderName: r.external_order_name,
    trackingNumbers: (r.tracking_numbers ?? '').split(/\s+/).filter(Boolean),
    trackingCompany: r.tracking_company || 'Other',
    trackingUrl: r.tracking_token ? new URL(`/t/${r.tracking_token}`, origin).toString() : null,
    shippedAt: r.shipped_at,
  };
}
