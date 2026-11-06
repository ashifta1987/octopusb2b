import type { StagedSpec } from './types.ts';

/**
 * specification_raw → key/value rows for filters (ADDON-27 §4c). The raw text stays authoritative on the product.
 * Splits on new lines, on " | " and on runs of 2+ spaces that separate a second "Key: value" pair
 * ("Tank: approx. 280ML    Mist: approx. 40-50ml/h"). Lines without a key are skipped (kept in the raw text).
 */
export function parseSpecs(raw: string | null | undefined): StagedSpec[] {
  const out: StagedSpec[] = [];
  if (!raw) return out;
  const chunks = String(raw)
    .split(/\r?\n/)
    .flatMap((l) => l.split(/\s+\|\s+/))
    .flatMap((l) => l.split(/\s{2,}(?=[^\s:：][^:：]{0,40}[:：])/));
  for (const c of chunks) {
    const m = /^\s*([^:：]{1,60}?)\s*[:：]\s*(.+?)\s*$/.exec(c);
    if (!m) continue;
    const key = m[1].replace(/^\d+[.)]\s*/, '').trim();
    if (!key || !m[2]) continue;
    out.push({ key, value: m[2], sort: out.length + 1 });
  }
  return out;
}

/** "70*80*175mm（含底座）" → { value: "70*80*175mm", notes: "含底座" } */
export function splitSizeNotes(raw: string | null | undefined): { value: string | null; notes: string | null } {
  if (raw == null || String(raw).trim() === '') return { value: null, notes: null };
  const s = String(raw).replace(/\r?\n/g, ' ').trim();
  const notes: string[] = [];
  const value = s.replace(/[（(]([^）)]+)[）)]/g, (_m, n: string) => { notes.push(n.trim()); return ''; }).replace(/\s+/g, ' ').trim();
  return { value: value || null, notes: notes.length ? notes.join('; ') : null };
}

