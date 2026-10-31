import type { Amount, CurrencyCode, CurrencySettings, Price } from '@/lib/contracts';

/**
 * Money helpers for the public API (SPEC §15.1): every amount is `{ amount_minor, currency }`.
 * Pure functions (no server-only import) so the Postman generator and unit tests can use them.
 */

/** Normalises a currency column value (char(3), may be padded/null) to a supported code. */
export function cur(c: unknown): CurrencyCode {
  return String(c ?? '').trim().toUpperCase() === 'CNY' ? 'CNY' : 'USD';
}

/** `{ amount_minor, currency }`, or null when the amount is null/undefined. */
export function amt(minor: unknown, currency: unknown): Amount | null {
  if (minor === null || minor === undefined || minor === '') return null;
  const n = Number(minor);
  if (!Number.isFinite(n)) return null;
  return { amount_minor: Math.round(n), currency: cur(currency) };
}

/** Like amt() but never null (missing → 0). */
export function amt0(minor: unknown, currency: unknown): Amount {
  return amt(minor, currency) ?? { amount_minor: 0, currency: cur(currency) };
}

export type FxContext = {
  currency: CurrencyCode; // platform currency
  rate: number; // CNY per 1 USD (approved, manual)
  fxRateId: string | null;
  effectiveFrom: string | null;
  steps: Partial<Record<CurrencyCode, number>>; // rounding step (minor units) per target currency
};

/** Mirror of SQL convert_amount(): rate = CNY per 1 USD, rounded to the target currency step. */
export function convert(minor: number, from: CurrencyCode, to: CurrencyCode, rate: number, step = 1) {
  if (from === to) return minor;
  const raw = from === 'USD' ? minor * rate : minor / rate;
  const s = Math.max(1, step);
  return Math.round(raw / s) * s;
}

/** A catalogue price in its own currency + `converted` into the platform currency. */
export function price(minor: unknown, currency: unknown, fx: FxContext): Price | null {
  const a = amt(minor, currency);
  if (!a) return null;
  return {
    ...a,
    converted: {
      amount_minor: convert(a.amount_minor, a.currency, fx.currency, fx.rate, fx.steps[fx.currency] ?? 1),
      currency: fx.currency,
      fx_rate_id: a.currency === fx.currency ? null : fx.fxRateId,
    },
  };
}

export function currencySettings(fx: FxContext): CurrencySettings {
  return { currency: fx.currency, rate: { base: 'USD', quote: 'CNY', rate: fx.rate, effective_from: fx.effectiveFrom, fx_rate_id: fx.fxRateId } };
}

type SbLike = {
  from: (t: string) => {
    select: (c: string) => unknown;
  };
};

/**
 * Loads the platform currency + approved rate with any Supabase client (service role in API routes).
 * Not cached: API responses must reflect a switch immediately.
 */
export async function loadFx(sb: SbLike): Promise<FxContext> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = sb as any;
  const [settings, fx] = await Promise.all([
    s.from('site_settings').select('key, value').in('key', ['platform_currency', 'currency_rounding']),
    s
      .from('fx_rates')
      .select('id, rate, effective_from')
      .eq('source', 'manual')
      .lte('effective_from', new Date().toISOString())
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const map: Record<string, unknown> = {};
  for (const r of (settings.data ?? []) as { key: string; value: unknown }[]) map[r.key] = r.value;
  const rounding = (map.currency_rounding ?? {}) as Record<string, { step_minor?: number }>;
  return {
    currency: cur(map.platform_currency),
    rate: Number(fx.data?.rate ?? 7.1),
    fxRateId: (fx.data?.id as string | undefined) ?? null,
    effectiveFrom: (fx.data?.effective_from as string | undefined) ?? null,
    steps: { USD: Number(rounding.USD?.step_minor ?? 1), CNY: Number(rounding.CNY?.step_minor ?? 1) },
  };
}

/**
 * Finds amounts without a currency: any object with `amount_minor` must carry a 3-letter `currency`, and no key
 * may end in `_cents` (legacy bare integers). Returns JSON paths of offenders (empty = OK). Used by unit tests and
 * mirrored in the Postman test scripts.
 */
export function findBareAmounts(value: unknown, path = '$'): string[] {
  const bad: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => bad.push(...findBareAmounts(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('amount_minor' in o && !(typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency))) bad.push(path);
    for (const [k, v] of Object.entries(o)) {
      if (k.endsWith('_cents')) bad.push(`${path}.${k}`);
      bad.push(...findBareAmounts(v, `${path}.${k}`));
    }
  }
  return bad;
}
