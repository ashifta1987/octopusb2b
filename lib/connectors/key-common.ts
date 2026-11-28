/**
 * CONN S3 · shared pure helpers for key-paste connectors (Magento 2 and PrestaShop).
 */
import { currencyExponent, decimalToMinor } from './formats';

export const MODEL_NO = /^DS-\d{6}-\d{2}$/i;
export const cleanStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Formats an ISO timestamp as UTC "YYYY-MM-DD HH:MM:SS" for Magento searchCriteria and PrestaShop date filters. */
export function utcSqlTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Parses a store amount (e.g. Magento 4-decimal "19.9900" or PrestaShop 6-decimal "16.666667") into integer minor units.
 * Rounds half-up to the currency exponent without floating-point arithmetic so higher store precision never drops a line.
 */
export function storeAmountToMinor(raw: string | number | null | undefined, currency: string): number | null {
  const exact = decimalToMinor(raw, currency);
  if (exact !== null || raw == null) return exact;
  let s = String(raw).trim().replace(/[\s'\u00a0]/g, '').replace(/^[A-Z]{3}/i, '').replace(/^[$€£¥]/, '');
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const m = /^(\d{1,12})\.(\d+)$/.exec(s);
  if (!m) return null;
  const exp = currencyExponent(currency);
  const frac = m[2];
  if (frac.length <= exp) return null;
  const base = BigInt(m[1]) * BigInt(10 ** exp) + BigInt(frac.slice(0, exp) || '0');
  const rounded = frac[exp] >= '5' ? base + BigInt(1) : base;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(rounded);
}
