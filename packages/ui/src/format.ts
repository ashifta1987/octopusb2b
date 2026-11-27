/**
 * Money, dates and numbers (Part 2.7). Pure (server + client).
 *   formatMoney(1234.56)  → "US$ 1,234.56"
 *   formatMoney(-420)     → "−US$ 420.00"   (U+2212 minus, never a bare number)
 *   formatDate('2026-11-27') → "27 Nov 2026"; within the current year with { short: true } → "27 Nov"
 *   formatTime(date, 'Asia/Dubai') → "18:00 (Dubai time)"
 */
export const MINUS = '\u2212';

export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}): string {
  const s = new Intl.NumberFormat('en-US', opts).format(Math.abs(n));
  return n < 0 ? `${MINUS}${s}` : s;
}

export function formatMoney(amount: number, opts: { currency?: string; decimals?: number; signDisplay?: 'auto' | 'always' } = {}): string {
  const { currency = 'US$', decimals = 2, signDisplay = 'auto' } = opts;
  const abs = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(amount));
  const sign = amount < 0 ? MINUS : signDisplay === 'always' && amount > 0 ? '+' : '';
  return `${sign}${currency} ${abs}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Nov 2026" (UTC calendar date of ISO date strings); `short` drops the year inside `now`'s year. */
export function formatDate(d: Date | string, opts: { short?: boolean; now?: Date } = {}): string {
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDate();
  const m = MONTHS[date.getUTCMonth()];
  const y = date.getUTCFullYear();
  if (opts.short && y === (opts.now ?? new Date()).getUTCFullYear()) return `${day} ${m}`;
  return `${day} ${m} ${y}`;
}

/** "18:00 (Dubai time)" in the given IANA zone. */
export function formatTime(d: Date | string, timeZone = 'Asia/Dubai', label?: string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(date);
  const city = label ?? timeZone.split('/').pop()?.replace(/_/g, ' ');
  return `${t} (${city} time)`;
}
