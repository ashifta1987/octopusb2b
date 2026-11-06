import type { Incoterm } from './types.ts';

/**
 * Supplier quote strings → price rows (ADDON-27 §4b). Handles every shape in the Bowijie workbook:
 *   'EXW, MOQ 3000'                                   (+ Price USD column)      → 1 row
 *   'Machine：1.3  |  FOB, MOQ 3000'                                            → 1 row, variant 'Machine'
 *   'Machine with Mijia：2.4 / Machine without Mijia：2.1  |  FOB, MOQ 3000'   → 2 rows
 *   '带米家： / 不带米家：12.208  |  FOB, MOQ 3000'                              → 1 row (blank price skipped)
 *   '10.54  |  FOB, MOQ 3000'                                                   → 1 row, no variant
 *   'MOQ 3000 / Plug-in: 1.12 / Rechargeable: 1.5  |  MOQ 1000 / …  |  FOB'     → one row per MOQ × variant
 *   'No price quoted'                                                          → no rows, needs_quote
 * A blank price is null, never zero.
 */
export type ParsedPrice = { incoterm: Incoterm; moq: number; variant: string; price: number };
export type PriceParse = { rows: ParsedPrice[]; noPrice: boolean; warnings: string[] };

const INCOTERMS: Incoterm[] = ['EXW', 'FOB', 'CIF', 'DDP', 'FCA', 'CFR'];
const NUM = /(\d+(?:\.\d+)?)/;

export function toPriceMinor(price: number) {
  return Math.round(price * 10000);
}

function cleanLabel(raw: string) {
  // '2Machine without Mijia' (typo in the source) → 'Machine without Mijia'
  return raw.replace(/^\s*\d+(?=[A-Za-z])/, '').replace(/\s+/g, ' ').trim();
}

/** "label：1.3" / "label: 1.3" / "1.3" → {label, price|null} */
function labelPrice(part: string): { label: string; price: number | null } | null {
  const p = part.trim();
  if (!p) return null;
  const m = /^(.*?)[：:]\s*(\d+(?:\.\d+)?)?\s*$/.exec(p);
  if (m) return { label: cleanLabel(m[1]), price: m[2] != null ? Number(m[2]) : null };
  if (/^\d+(?:\.\d+)?$/.test(p)) return { label: '', price: Number(p) };
  return null;
}

export function parsePriceOptions(
  text: string | null | undefined,
  opts: { priceColumn?: number | null; defaultIncoterm: Incoterm; defaultMoq?: number | null },
): PriceParse {
  const warnings: string[] = [];
  const src = String(text ?? '').trim();
  if (!src && opts.priceColumn == null) return { rows: [], noPrice: true, warnings };
  if (/no price/i.test(src)) return { rows: [], noPrice: true, warnings };

  const segments = src.split('|').map((s) => s.trim()).filter(Boolean);
  let incoterm: Incoterm = opts.defaultIncoterm;
  for (const s of segments) for (const t of INCOTERMS) if (new RegExp(`\\b${t}\\b`).test(s)) incoterm = t;
  let globalMoq = opts.defaultMoq ?? null;
  const rows: ParsedPrice[] = [];

  for (const seg of segments) {
    const parts = seg.split('/').map((s) => s.trim()).filter(Boolean);
    let segMoq: number | null = null;
    const priced: { label: string; price: number | null }[] = [];
    for (const part of parts) {
      const moq = /\bMOQ\s*(\d+)/i.exec(part);
      if (moq) { segMoq = Number(moq[1]); if (!/[：:]/.test(part.replace(/MOQ\s*\d+/i, ''))) continue; }
      // a pure trade-term chunk ("FOB", "EXW, MOQ 3000") carries no price
      if (INCOTERMS.some((t) => new RegExp(`^${t}\\b`).test(part)) && !/[：:]/.test(part)) continue;
      const lp = labelPrice(part.replace(/\bMOQ\s*\d+\s*,?/i, ''));
      if (lp) priced.push(lp);
    }
    if (segMoq != null && !priced.length) { globalMoq = segMoq; continue; }
    for (const lp of priced) {
      if (lp.price == null) { warnings.push(`blank price for "${lp.label || 'default'}" skipped`); continue; }
      rows.push({ incoterm, moq: segMoq ?? -1, variant: lp.label, price: lp.price });
    }
  }
  // rows without their own MOQ take the MOQ named elsewhere in the string, or the MOQ column
  for (const r of rows) if (r.moq === -1) r.moq = globalMoq ?? opts.defaultMoq ?? 1;
  // 'EXW, MOQ 3000' — the price is in the Price USD column
  if (!rows.length && opts.priceColumn != null && Number.isFinite(opts.priceColumn)) {
    rows.push({ incoterm, moq: globalMoq ?? opts.defaultMoq ?? 1, variant: '', price: Number(opts.priceColumn) });
  }
  if (!rows.length) return { rows, noPrice: true, warnings: [...warnings, `no price found in "${src}"`] };
  if (NUM.test(src) === false) warnings.push('quote contains no number');
  return { rows, noPrice: false, warnings };
}

/** median of a list (for the outlier rule) */
export function median(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

