import { money, asCurrency, convertMinor, CURRENCIES, type Currency } from '@/lib/format';

/** Minimal FX context needed to convert aggregates into the platform currency (subset of lib/currency CurrencyContext). */
export type FxCtx = { currency: Currency; rate: number; rounding?: Record<string, { step_minor: number }> };

/** Sum amounts per currency (SPEC §15.1: never add USD and CNY together without converting). */
export function sumByCurrency<T>(rows: T[], amount: (r: T) => number | null | undefined, currency: (r: T) => string | null | undefined) {
  const m = new Map<Currency, number>();
  for (const r of rows) {
    const c = asCurrency(currency(r));
    m.set(c, (m.get(c) ?? 0) + Number(amount(r) ?? 0));
  }
  return m;
}

/** Convert a per-currency map into one total in the platform currency at the approved rate. */
export function convertedTotal(ctx: FxCtx, totals: Map<Currency, number>) {
  let t = 0;
  const step = ctx.rounding?.[ctx.currency]?.step_minor ?? 1;
  totals.forEach((v, c) => { t += convertMinor(v, c, ctx.currency, ctx.rate, step); });
  return t;
}

export function rateLabel(ctx: FxCtx) {
  return `${Number(ctx.rate).toLocaleString('en-US', { maximumFractionDigits: 6 })} CNY/USD`;
}

/** "US$ 1,200.00 · CN¥ 300.00" — one entry per currency present (or the platform currency when empty). */
export function perCurrencyText(totals: Map<Currency, number>, fallback: Currency = 'USD') {
  const parts = CURRENCIES.filter((c) => totals.has(c)).map((c) => money(totals.get(c)!, c));
  return parts.length ? parts.join(' · ') : money(0, fallback);
}

/**
 * Per-currency amounts plus a total converted into the platform currency, labelled as converted.
 * Used by Stat values / table footers across the admin finance screens.
 */
export function CurrencyTotals({ totals, ctx, className }: { totals: Map<Currency, number>; ctx: FxCtx; className?: string }) {
  const present = CURRENCIES.filter((c) => totals.has(c));
  const mixed = present.length > 1 || (present.length === 1 && present[0] !== ctx.currency);
  return (
    <span className={className}>
      <span className="mono font-semibold tabular-nums">{perCurrencyText(totals, ctx.currency)}</span>
      {mixed && (
        <span className="block text-xs text-muted font-normal">
          Total {money(convertedTotal(ctx, totals), ctx.currency)} · converted at {rateLabel(ctx)}
        </span>
      )}
    </span>
  );
}
