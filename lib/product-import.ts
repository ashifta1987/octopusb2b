/** Bulk product template v2 (ADDON-33) — pure helpers: image matching, diffs, export formatting. No I/O. */
import { normalizeSku } from './sku';

export const IMAGE_COLS = ['image_file', 'image_file_2', 'image_file_3'] as const;
export const IMAGE_EXT = /\.(jpe?g|png|webp|avif)$/i;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;

export type ZipEntry = { name: string; path: string; size: number };

/** Case-insensitive match of a cell value against zip entries (base names; folders ignored, hidden/__MACOSX skipped). */
export function matchImage(cell: string, entries: ZipEntry[]): { entry: ZipEntry | null; caseMismatch: boolean } {
  const want = cell.trim();
  if (!want) return { entry: null, caseMismatch: false };
  const exact = entries.find((e) => e.name === want);
  if (exact) return { entry: exact, caseMismatch: false };
  const ci = entries.find((e) => e.name.toLowerCase() === want.toLowerCase());
  return { entry: ci ?? null, caseMismatch: !!ci };
}

export function zipImageEntries(paths: { path: string; size: number }[]): ZipEntry[] {
  return paths
    .filter((p) => !p.path.endsWith('/') && !p.path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX'))
    .map((p) => ({ path: p.path, name: p.path.split('/').pop()!, size: p.size }));
}

/** Files in the zip that no row references (info list, ignored). */
export function unreferenced(entries: ZipEntry[], cells: string[]) {
  const used = new Set(cells.map((c) => c.trim().toLowerCase()).filter(Boolean));
  return entries.filter((e) => IMAGE_EXT.test(e.name) && !used.has(e.name.toLowerCase())).map((e) => e.name);
}

export type ComparableProduct = {
  title: string; category_id: string | null; unit: string; moq: number | null; lead_time_days: number | null; incoterm: string | null;
  origin_country: string | null; hs_code: string | null; currency: string; octopus_dropship: boolean; ready_to_ship: boolean; description: string | null;
  tiers: { min_qty: number; unit_price_cents: number }[];
};
export type FieldDiff = { field: string; from: string; to: string };

const show = (v: unknown) => (v == null || v === '' ? '—' : String(v));
const tierText = (t: ComparableProduct['tiers'], cur: string) => t.map((x) => `${x.min_qty}+ ${(x.unit_price_cents / 100).toFixed(2)} ${cur}`).join(' · ') || '—';

/** Field-level diff for an UPDATE (row vs. current product). Empty = unchanged. */
export function diffProduct(cur: ComparableProduct & { category_path?: string }, next: ComparableProduct & { category_path?: string }): FieldDiff[] {
  const out: FieldDiff[] = [];
  const cmp = (field: string, a: unknown, b: unknown, fa = a, fb = b) => { if ((a ?? null) !== (b ?? null)) out.push({ field, from: show(fa), to: show(fb) }); };
  cmp('title', cur.title, next.title);
  cmp('category', cur.category_id, next.category_id, cur.category_path ?? cur.category_id, next.category_path ?? next.category_id);
  cmp('unit', cur.unit, next.unit);
  cmp('moq', cur.moq, next.moq);
  cmp('lead_time_days', cur.lead_time_days, next.lead_time_days);
  cmp('incoterm', cur.incoterm, next.incoterm);
  cmp('origin_country', cur.origin_country, next.origin_country);
  cmp('hs_code', cur.hs_code, next.hs_code);
  cmp('currency', cur.currency, next.currency);
  cmp('octopus_dropship', cur.octopus_dropship, next.octopus_dropship);
  cmp('ready_to_ship', cur.ready_to_ship, next.ready_to_ship);
  cmp('description', (cur.description ?? '').trim() || null, (next.description ?? '').trim() || null);
  const ta = tierText(cur.tiers, cur.currency), tb = tierText(next.tiers, next.currency);
  if (ta !== tb) out.push({ field: 'price tiers', from: ta, to: tb });
  return out;
}

/** Number shown in the exported sheet for a minor-unit price (round-trips through the parser's toCents). */
export const exportPrice = (cents: number) => Number((cents / 100).toFixed(2));

/** File name to put back in image_file* on export: the original upload name, else the last URL segment. */
export function exportImageName(m: { source_file_name: string | null; url: string }) {
  if (m.source_file_name) return m.source_file_name;
  try { return decodeURIComponent(new URL(m.url).pathname.split('/').pop() ?? ''); } catch { return m.url.split('/').pop() ?? ''; }
}

/** Rows that share a SKU inside a file → error text per row (all row numbers listed). */
export function inFileDuplicateErrors(rows: { row: number; sku: string }[], message: (rows: number[]) => string) {
  const by = new Map<string, number[]>();
  for (const r of rows) { const k = normalizeSku(r.sku); if (k) by.set(k, [...(by.get(k) ?? []), r.row]); }
  const errs = new Map<number, string>();
  for (const list of by.values()) if (list.length > 1) for (const r of list) errs.set(r, message(list));
  return errs;
}

