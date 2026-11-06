/**
 * HS code detection (6 Nov 2026) — 4-digit heading only, from the product itself.
 * Order when hs_code is blank: confirmed rule → unconfirmed rule (suggested) → AI (≥ min confidence → suggested,
 * else blank + "HS code needs manual entry"). AI results are cached per normalised product type (they become
 * hs_product_types rows that later products match as rules), so a type is never classified twice.
 * Pure module: storage and the model are injected (tests use fakes). Only product fields are ever sent to the model.
 */
import { z } from 'zod';

export const HEADING_RE = /^[0-9]{4}$/;
export const MANUAL_NOTE = 'HS code needs manual entry';
export const AI_BATCH = 20;

export type HsProduct = { id: string; title: string; category: string | null; specs: string | null; material: string | null; hs_code: string | null; hs_code_source: string | null };
export type HsType = { id: string; type_key: string; name: string; keywords: string[]; heading: string | null; confirmed: boolean; confidence: number | null; source?: string | null };
export type HsResult = { product_id: string; type_id: string | null; heading: string | null; source: 'rule' | 'ai' | null; status: 'confirmed' | 'suggested' | 'missing'; confidence: number | null; note: string | null };
export type AiItem = { id: string; heading: string; confidence: number; product_type: string; reason: string };
export type AiClassify = (items: { id: string; title: string; category: string | null; specs: string | null; material: string | null }[]) => Promise<unknown>;
export interface HsStore {
  types(): Promise<HsType[]>;
  /** insert or return the existing type for this key (cache) */
  upsertAiType(t: { type_key: string; name: string; heading: string | null; confidence: number; reason: string }): Promise<HsType>;
  save(results: HsResult[]): Promise<void>;
}

export const normType = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 80);
const tokens = (s: string) => new Set(normType(s).split(' ').filter(Boolean).flatMap((w) => [w, w.endsWith('s') ? w.slice(0, -1) : w]));

/** Best rule for a product: every word of a keyword (or of the type name) must appear; longer keyword wins; confirmed wins ties. */
export function matchRule(p: Pick<HsProduct, 'title' | 'category' | 'specs'>, rules: HsType[]): HsType | null {
  const have = tokens([p.title, p.category ?? '', p.specs ?? ''].join(' '));
  let best: { t: HsType; score: number } | null = null;
  for (const t of rules) {
    for (const kw of [...t.keywords, t.type_key]) {
      const words = normType(kw).split(' ').filter(Boolean);
      if (!words.length || !words.every((w) => have.has(w))) continue;
      const score = words.length * 10 + (t.confirmed ? 1 : 0);
      if (!best || score > best.score) best = { t, score };
    }
  }
  return best?.t ?? null;
}

const aiItemSchema = z.object({
  id: z.string(),
  heading: z.string(),
  confidence: z.number(),
  product_type: z.string().min(2).max(80),
  reason: z.string().max(300),
  heading_title: z.string().max(300).optional(),
});

/** HS chapters run 01–97 and chapter 77 is reserved, so e.g. "0000" or "9900" is never a real heading. */
export const validChapter = (h: string) => { const c = Number(h.slice(0, 2)); return c >= 1 && c <= 97 && c !== 77; };

/** Validate one model item. Rejects anything that is not exactly a 4-digit heading or a confidence in 0..1. */
export function validateAiItem(raw: unknown): AiItem | null {
  const r = aiItemSchema.safeParse(raw);
  if (!r.success) return null;
  const heading = r.data.heading.trim();
  if (!HEADING_RE.test(heading)) return null;               // "84145", "84.14", "8414.51", "abcd" → rejected, never trimmed
  if (!validChapter(heading)) return null;                  // "0000", "7700", "9900" → no such chapter
  if (!(r.data.confidence >= 0 && r.data.confidence <= 1)) return null;
  if (!normType(r.data.product_type)) return null;
  return { ...r.data, heading };
}

export const chunk = <T,>(xs: T[], n = AI_BATCH) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Classify products whose hs_code is blank. Products with a sheet / manual code are never touched.
 * `maxCalls` caps the AI cost per run; products beyond the cap stay pending (returned in `deferred`).
 */
export async function classifyProducts(products: HsProduct[], store: HsStore, opts: { ai: AiClassify | null; minConfidence?: number; maxCalls?: number }) {
  const min = opts.minConfidence ?? 0.8;
  const todo = products.filter((p) => !(p.hs_code && ['sheet', 'manual'].includes(p.hs_code_source ?? '')) && !(p.hs_code && p.hs_code_source === null));
  let rules = await store.types();
  const results: HsResult[] = [];
  const needAi: HsProduct[] = [];
  // a cached AI type keeps source 'ai' until an admin confirms it (then it is a confirmed rule)
  const fromType = (p: HsProduct, t: HsType): HsResult => t.heading
    ? { product_id: p.id, type_id: t.id, heading: t.heading, source: t.source === 'ai' && !t.confirmed ? 'ai' : 'rule', status: t.confirmed ? 'confirmed' : 'suggested', confidence: t.confidence, note: null }
    : { product_id: p.id, type_id: t.id, heading: null, source: null, status: 'missing', confidence: t.confidence, note: MANUAL_NOTE };
  for (const p of todo) {
    const t = matchRule(p, rules);
    if (t) results.push(fromType(p, t)); else needAi.push(p);
  }
  let calls = 0; const deferred: string[] = []; let aiErrors = 0;
  const queue = [...needAi];
  while (queue.length) {
    const batch = queue.splice(0, AI_BATCH);
    // cache: types created by an earlier batch of this run may now match
    const still: HsProduct[] = [];
    for (const p of batch) { const t = matchRule(p, rules); if (t) results.push(fromType(p, t)); else still.push(p); }
    if (!still.length) continue;
    if (!opts.ai || calls >= (opts.maxCalls ?? 10)) { deferred.push(...still.map((p) => p.id)); continue; }
    calls++;
    let raw: unknown;
    try {
      raw = await opts.ai(still.map(({ id, title, category, specs, material }) => ({ id, title, category, specs, material })));
    } catch {
      aiErrors++;   // service unreachable → leave blank and flag, never guess
      for (const p of still) results.push({ product_id: p.id, type_id: null, heading: null, source: null, status: 'missing', confidence: null, note: `${MANUAL_NOTE} (classifier unavailable)` });
      continue;
    }
    const items = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [];
    const byId = new Map<string, AiItem>();
    for (const it of items) { const v = validateAiItem(it); if (v) byId.set(v.id, v); }
    for (const p of still) {
      const v = byId.get(p.id);
      if (!v) { results.push({ product_id: p.id, type_id: null, heading: null, source: null, status: 'missing', confidence: null, note: MANUAL_NOTE }); continue; }
      const confident = v.confidence >= min;
      const t = await store.upsertAiType({ type_key: normType(v.product_type), name: v.product_type, heading: confident ? v.heading : null, confidence: v.confidence, reason: v.reason });
      if (!rules.some((r) => r.id === t.id)) rules = [...rules, t];
      results.push(fromType(p, t));
    }
  }
  await store.save(results);
  return { results, aiCalls: calls, aiErrors, deferred };
}

