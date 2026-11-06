/**
 * Product Id / SKU rules (ADDON-33) — one module for every route (bulk template, single form, Bowijie importer, DB errors).
 * SKU = products.external_id ("Product Id"); `products.sku` / `sku_norm` are generated from it in the database.
 */
export const SKU_RE = /^[A-Z0-9][A-Z0-9._-]{2,39}$/;

export const SKU_ERRORS = {
  blank: 'SKU is required.',
  format: 'SKU must be 3–40 characters: letters, digits, dash, dot or underscore, no spaces.',
  duplicateInFile: (rows: number[]) => `SKU appears more than once in this file (rows ${rows.join(', ')}).`,
  otherSupplier: 'SKU already used by another supplier.',
  retired: 'This SKU was used before and cannot be reused.',
  immutable: 'The SKU of an existing product can only be changed by an Admin.',
} as const;

export const normalizeSku = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

/** null = valid; otherwise the error text. */
export function skuProblem(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return SKU_ERRORS.blank;
  if (/\s/.test(s) || !SKU_RE.test(s.toUpperCase())) return SKU_ERRORS.format;
  return null;
}

/** Map a database error from any product write to the shared SKU wording (or null if it is not a SKU error). */
export function skuDbError(message: string | null | undefined): string | null {
  const m = message ?? '';
  if (/SKU_TAKEN|products_sku_norm_key|products_external_id_key|sku_reservations_pkey/.test(m)) return SKU_ERRORS.otherSupplier;
  if (/SKU_RETIRED/.test(m)) return SKU_ERRORS.retired;
  if (/SKU_IMMUTABLE/.test(m)) return SKU_ERRORS.immutable;
  if (/products_sku_format|SKU_FORMAT/.test(m)) return SKU_ERRORS.format;
  return null;
}

/** Category code for generated SKUs: first letter + next two consonants of the top-level category ("Fasteners" → FST). */
export function categoryCode(name: string | null | undefined) {
  const w = (name ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!w) return 'GEN';
  const rest = w.slice(1).replace(/[AEIOUY]/g, '');
  return (w[0] + rest + w.slice(1)).slice(0, 3).padEnd(3, 'X');
}

/** Rows (1-based sheet row numbers) per SKU that appear more than once. */
export function duplicateSkus(rows: { row: number; sku: string }[]) {
  const by = new Map<string, number[]>();
  for (const r of rows) { const k = normalizeSku(r.sku); if (k) by.set(k, [...(by.get(k) ?? []), r.row]); }
  return new Map([...by].filter(([, v]) => v.length > 1));
}

/** Next free running numbers for a prefix: "FST" + taken ["FST-000007"] → FST-000008, FST-000009 … */
export function nextSkus(prefix: string, taken: Iterable<string>, count: number) {
  const set = new Set([...taken].map(normalizeSku));
  let n = 0;
  for (const t of set) { const m = new RegExp(`^${prefix}-(\\d{6})$`).exec(t); if (m) n = Math.max(n, Number(m[1])); }
  const out: string[] = [];
  while (out.length < count) { n++; const s = `${prefix}-${String(n).padStart(6, '0')}`; if (!set.has(s)) out.push(s); }
  return out;
}

