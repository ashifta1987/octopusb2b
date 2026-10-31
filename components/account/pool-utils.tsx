import { money } from '@/lib/format';

/** Group-buy helpers for the customer portal: totals are kept per currency (never summed across currencies). */
export function sumByCurrency<T>(rows: T[], amount: (r: T) => number | null | undefined, currency: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  rows.forEach((r) => { const c = currency(r) ?? 'USD'; out[c] = (out[c] ?? 0) + Number(amount(r) ?? 0); });
  return out;
}

export function CurrencyTotalsInline({ totals }: { totals: Record<string, number> }) {
  const entries = Object.entries(totals).filter(([, v]) => v);
  if (!entries.length) return <span>—</span>;
  return (
    <span className="flex flex-col">
      {entries.map(([c, v]) => <span key={c} className="mono tabular-nums">{money(v, c)}</span>)}
    </span>
  );
}
