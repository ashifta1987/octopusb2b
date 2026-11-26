/**
 * Octopus Dropship · Step 6 — the merchant pricing rule, as pure functions (no server, no I/O).
 * Mirror of the SQL in migration *_ds6_import_editor_pricing_packing: ds_currency_exponent, ds_round_price,
 * ds_bands_problem, ds_price_compute, ds_profit_bp. The pages use it for the live preview while the merchant types; the
 * server (ds_listing_state / ds_push_enqueue) computes the price that is saved and pushed. Exact integer arithmetic
 * (BigInt rationals), so the browser and the database give the same answer to the cent — the DB test and
 * tests/unit/dropship-pricing.test.ts share one case table.
 *
 * Units: landed cost in USD cents; prices in store-currency minor units (KWD/BHD/OMR have 3 decimals); FX = store
 * currency per 1 USD as a decimal string with up to 8 decimals; multipliers in thousandths (2.2 → 2200); margins in
 * basis points (50 % → 5000).
 */

export type Rounding = 'end_99' | 'end_95' | 'whole' | 'none';

export type PriceBand = {
  from_cents: number;
  to_cents: number | null;
  multiplier_milli: number;
  fixed_cents: number;
};

export type PriceRule = {
  bands: PriceBand[];
  rounding: Rounding;
  compare_at_bp: 2500 | 5000 | null;
  min_profit_bp: number;
};

export type PriceResult =
  | {
      ok: true;
      band: number;
      multiplier_milli: number;
      fixed_cents: number;
      price_minor: number;
      compare_at_minor: number | null;
      landed_minor: number;
      profit_bp: number;
      below_min: boolean;
      currency: string;
    }
  | { ok: false; code: 'NO_LANDED' | 'NEEDS_FX' | 'INVALID_BANDS'; message: string };

export const SUPPORTED_CURRENCIES = ['USD', 'AED', 'SAR', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'KWD', 'QAR', 'BHD', 'OMR'] as const;

export const ROUNDING_LABEL: Record<Rounding, string> = {
  end_99: 'End in .99',
  end_95: 'End in .95',
  whole: 'Whole number',
  none: 'No rounding',
};

export function currencyExponent(currency: string | null | undefined): number {
  switch ((currency ?? 'USD').toUpperCase()) {
    case 'KWD': case 'BHD': case 'OMR': case 'JOD': case 'TND': return 3;
    case 'JPY': case 'KRW': case 'VND': return 0;
    default: return 2;
  }
}

// BigInt() calls rather than BigInt literals: the repo compiles to ES2017 (no BigInt literal syntax)
const B0 = BigInt(0);
const B1 = BigInt(1);
const B5 = BigInt(5);
const B1000 = BigInt(1000);
const B10000 = BigInt(10000);
const B1E8 = BigInt(100000000);
function pow10(n: number): bigint {
  let out = B1;
  for (let i = 0; i < n; i++) out *= BigInt(10);
  return out;
}

/** ceil(a / b) for b > 0 */
function ceilDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b === B0 ? q : a > B0 ? q + B1 : q;
}

/** floor(a / b) for b > 0 */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b === B0 ? q : a < B0 ? q - B1 : q;
}

/** "3.6725" → { num: 367250000, den: 100000000 } as BigInts; null when not a positive decimal with ≤ 8 places */
export function parseFx(fx: string | number | null | undefined): { num: bigint; den: bigint } | null {
  if (fx == null) return null;
  const s = String(fx).trim();
  const m = s.match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(8, '0');
  const num = BigInt(m[1]) * B1E8 + BigInt(frac);
  return num > B0 ? { num, den: B1E8 } : null;
}

/** Round UP a rational raw price (store minor units) by the rule — never below the raw price. */
export function roundPrice(num: bigint, den: bigint, mode: Rounding, exp: number): number {
  const unit = pow10(exp);
  const step = exp >= 2 ? pow10(exp - 2) : null;
  let out: bigint;
  if (mode === 'none') out = ceilDiv(num, den);
  else if (mode === 'whole' || step === null) out = ceilDiv(num, den * unit) * unit;
  else if (mode === 'end_95') out = ceilDiv(num + B5 * step * den, unit * den) * unit - B5 * step;
  else out = ceilDiv(num + step * den, unit * den) * unit - step;
  return Number(out < B1 ? B1 : out);
}

/** Same sentences as ds_bands_problem(). null = valid. */
export function bandsProblem(bands: PriceBand[] | null | undefined): string | null {
  if (!bands || bands.length === 0) return 'Add at least one cost band.';
  if (bands.length > 10) return 'Use 10 cost bands or fewer.';
  let prevTo: number | null = 0;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const n = i + 1;
    if (![b.from_cents, b.multiplier_milli, b.fixed_cents ?? 0].every((x) => Number.isFinite(x)) || (b.to_cents != null && !Number.isFinite(b.to_cents))) {
      return `Band ${n}: enter amounts as numbers.`;
    }
    if (b.from_cents !== prevTo) return n === 1 ? 'Band 1 must start at $0.00.' : `Band ${n} must start where band ${n - 1} ends.`;
    if (n < bands.length && (b.to_cents == null || b.to_cents <= b.from_cents)) return `Band ${n}: "To" must be more than "From".`;
    if (n === bands.length && b.to_cents != null) return `Band ${n} (the last band) must go "and up".`;
    if (b.multiplier_milli < 1000 || b.multiplier_milli > 20000) return `Band ${n}: the multiplier must be between 1.0 and 20.0.`;
    if ((b.fixed_cents ?? 0) < 0 || (b.fixed_cents ?? 0) > 100000) return `Band ${n}: the fixed amount must be between $0.00 and $1,000.00.`;
    prevTo = b.to_cents;
  }
  return null;
}

/** First-push price — identical to ds_price_compute(). */
export function computePrice(landedUsdCents: number | null | undefined, rule: PriceRule, fx: string | number | null | undefined, currency: string): PriceResult {
  const cur = (currency || 'USD').toUpperCase();
  if (landedUsdCents == null || !Number.isInteger(landedUsdCents) || landedUsdCents <= 0) {
    return { ok: false, code: 'NO_LANDED', message: 'The landed cost is not known yet.' };
  }
  const f = cur === 'USD' ? { num: B1, den: B1 } : parseFx(fx);
  if (!f) return { ok: false, code: 'NEEDS_FX', message: `No exchange rate for ${cur} yet.` };
  const problem = bandsProblem(rule.bands);
  if (problem) return { ok: false, code: 'INVALID_BANDS', message: problem };
  const idx = rule.bands.findIndex((b) => landedUsdCents >= b.from_cents && (b.to_cents == null || landedUsdCents < b.to_cents));
  const band = rule.bands[idx];
  const exp = currencyExponent(cur);
  // store minor = USD cents × fx × 10^(exp−2)
  const scaleNum = exp >= 2 ? pow10(exp - 2) : B1;
  const scaleDen = exp >= 2 ? B1 : pow10(2 - exp);
  const L = BigInt(landedUsdCents);
  const rawNum = (L * BigInt(band.multiplier_milli) + BigInt(band.fixed_cents ?? 0) * B1000) * f.num * scaleNum;
  const rawDen = B1000 * f.den * scaleDen;
  const price = roundPrice(rawNum, rawDen, rule.rounding, exp);
  const compare = rule.compare_at_bp == null ? null : roundPrice(BigInt(price) * BigInt(10000 + rule.compare_at_bp), B10000, rule.rounding, exp);
  const landedMinor = Number(ceilDiv(L * f.num * scaleNum, f.den * scaleDen));
  const profit = Number(floorDiv(BigInt(price - landedMinor) * B10000, BigInt(price)));
  return {
    ok: true,
    band: idx + 1,
    multiplier_milli: band.multiplier_milli,
    fixed_cents: band.fixed_cents ?? 0,
    price_minor: price,
    compare_at_minor: compare,
    landed_minor: landedMinor,
    profit_bp: profit,
    below_min: profit < (rule.min_profit_bp ?? 0),
    currency: cur,
  };
}

/** Profit of a typed (manual) price — identical to ds_profit_bp(). */
export function profitBp(priceMinor: number | null | undefined, landedUsdCents: number | null | undefined, fx: string | number | null | undefined, currency: string): number | null {
  if (priceMinor == null || priceMinor <= 0 || landedUsdCents == null) return null;
  const cur = (currency || 'USD').toUpperCase();
  const f = cur === 'USD' ? { num: B1, den: B1 } : parseFx(fx);
  if (!f) return null;
  const exp = currencyExponent(cur);
  const scaleNum = exp >= 2 ? pow10(exp - 2) : B1;
  const scaleDen = exp >= 2 ? B1 : pow10(2 - exp);
  const landedMinor = ceilDiv(BigInt(landedUsdCents) * f.num * scaleNum, f.den * scaleDen);
  return Number(floorDiv((BigInt(priceMinor) - landedMinor) * B10000, BigInt(priceMinor)));
}

/** "US$ 12.99" / "AED 159.99" / "KWD 4.990" (the same as ds_fmt_money). Unknown → "—". */
export function storeMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return '—';
  const cur = (currency ?? 'USD').toUpperCase();
  const exp = currencyExponent(cur);
  const v = new Intl.NumberFormat('en-US', { minimumFractionDigits: exp, maximumFractionDigits: exp }).format(Math.abs(minor) / 10 ** exp);
  return `${minor < 0 ? '-' : ''}${cur === 'USD' ? 'US$' : cur} ${v}`;
}

/** Typed amount ("159.99", "AED 159.99") → minor units of the currency, exactly. null when it isn't a valid amount. */
export function parseMoneyToMinor(raw: string | null | undefined, currency: string): number | null {
  const exp = currencyExponent(currency);
  const s = (raw ?? '').replace(/^\s*(?:US\$|\$|[A-Z]{3})\s*/i, '').replace(/,/g, '').trim();
  if (!s) return null;
  const m = s.match(exp === 0 ? /^(\d+)$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${exp}}))?$`));
  if (!m) return null;
  const minor = Number(m[1]) * 10 ** exp + Number((m[2] ?? '').padEnd(exp, '0') || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** minor → "159.99" for an input box */
export function minorToInput(minor: number | null | undefined, currency: string): string {
  if (minor == null) return '';
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

export const pct = (bp: number | null | undefined, digits = 0) => (bp == null ? '—' : `${(bp / 100).toFixed(digits)}%`);

/** "2.2" → 2200 (thousandths); null when invalid */
export function parseMultiplier(raw: string): number | null {
  const m = raw.trim().match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
}

export const multiplierText = (milli: number) => String(milli / 1000);

/** Short rule summary, e.g. "3 bands · × 2.6 / 2.2 / 1.9 · .99" */
export function ruleSummary(rule: Pick<PriceRule, 'bands' | 'rounding'>): string {
  if (!rule.bands.length) return 'No rule yet';
  const r = rule.rounding === 'end_99' ? '.99' : rule.rounding === 'end_95' ? '.95' : rule.rounding === 'whole' ? 'whole numbers' : 'no rounding';
  return `${rule.bands.length} band${rule.bands.length === 1 ? '' : 's'} · × ${rule.bands.map((b) => multiplierText(b.multiplier_milli)).join(' / ')} · ${r}`;
}

/** Stock is shown to merchants as a label only, never a number. */
export const STOCK_TEXT: Record<'in_stock' | 'low' | 'out' | 'extended', string> = { in_stock: 'In stock', low: 'Low stock', out: 'Out of stock', extended: 'Extended' };
export const STOCK_TONE: Record<'in_stock' | 'low' | 'out' | 'extended', 'ok' | 'warn' | 'bad' | 'info'> = { in_stock: 'ok', low: 'warn', out: 'bad', extended: 'info' };
