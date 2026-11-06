import 'server-only';
import OpenAI from 'openai';
import { createAdminClient } from '@/lib/supabase/server';
import { classifyProducts, normType, type AiClassify, type HsProduct, type HsResult, type HsStore, type HsType } from './classify';
import { HS_DEFAULT_MODEL, HS_SCHEMA, HS_SYSTEM_PROMPT } from './prompt';

/** Server side of HS detection: Supabase store, OpenAI classifier (strict JSON schema), runners for imports / forms / cron. */

type Sb = ReturnType<typeof createAdminClient>;

const SYSTEM = HS_SYSTEM_PROMPT;
const SCHEMA = HS_SCHEMA;

/** Only product fields are sent (title, category, specs, material) — never buyer, supplier or price data. Server-side only. */
export function openAiClassifier(): AiClassify | null {
  if (!process.env.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  return async (items) => {
    const r = await client.chat.completions.create({
      model: process.env.HS_AI_MODEL || HS_DEFAULT_MODEL, temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA as never },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(items.map((i) => ({ ...i, specs: i.specs?.slice(0, 1200) ?? null }))) }],
    });
    return JSON.parse(r.choices[0]?.message?.content ?? '{}');
  };
}

export function supabaseHsStore(sb: Sb): HsStore {
  return {
    async types() {
      const { data } = await sb.from('hs_product_types').select('id, type_key, name, keywords, heading, confirmed, confidence, source');
      return ((data ?? []) as HsType[]).map((t) => ({ ...t, confidence: t.confidence == null ? null : Number(t.confidence) }));
    },
    async upsertAiType(t) {
      const { data: ex } = await sb.from('hs_product_types').select('id, type_key, name, keywords, heading, confirmed, confidence, source').eq('type_key', t.type_key).maybeSingle();
      if (ex) return { ...(ex as HsType), confidence: ex.confidence == null ? null : Number(ex.confidence) };
      const { data, error } = await sb.from('hs_product_types').insert({
        type_key: t.type_key, name: t.name, keywords: [t.type_key], heading: t.heading, confirmed: false, source: 'ai', confidence: t.confidence, reason: t.reason,
      }).select('id, type_key, name, keywords, heading, confirmed, confidence, source').single();
      if (error) { // created concurrently → read it back
        const { data: again } = await sb.from('hs_product_types').select('id, type_key, name, keywords, heading, confirmed, confidence, source').eq('type_key', t.type_key).single();
        return again as HsType;
      }
      return { ...(data as HsType), confidence: data.confidence == null ? null : Number(data.confidence) };
    },
    async save(results) {
      for (const r of results) {
        // only products that still have no code; the guard_hs_code trigger also refuses to overwrite sheet / manual codes
        await sb.from('products').update({
          hs_code: r.heading, hs_code_source: r.source, hs_code_status: r.status, hs_code_confidence: r.confidence,
          hs_product_type_id: r.type_id, hs_code_note: r.note, hs_classify_pending: false,
        }).eq('id', r.product_id).is('hs_code', null);
      }
    },
  };
}

/** Product fields for the classifier. */
export async function loadHsProducts(sb: Sb, ids: string[]): Promise<HsProduct[]> {
  if (!ids.length) return [];
  const out: HsProduct[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('products')
      .select('id, title, hs_code, hs_code_source, specification_raw, categories(name), product_specs(name, value)')
      .in('id', ids.slice(i, i + 200));
    for (const p of data ?? []) {
      const specs = (p.product_specs ?? []) as { name: string; value: string }[];
      const cat = (Array.isArray(p.categories) ? p.categories[0] : p.categories) as { name?: string } | null;
      out.push({
        id: p.id as string, title: p.title as string, category: cat?.name ?? null, hs_code: p.hs_code as string | null, hs_code_source: p.hs_code_source as string | null,
        specs: [p.specification_raw, ...specs.map((s) => `${s.name}: ${s.value}`)].filter(Boolean).join('; ').slice(0, 2000) || null,
        material: specs.find((s) => /material/i.test(s.name))?.value ?? null,
      });
    }
  }
  return out;
}

async function settings(sb: Sb) {
  const { data } = await sb.from('site_settings').select('key, value').in('key', ['hs.ai_enabled', 'hs.ai_min_confidence', 'hs.ai_max_calls_per_run']);
  const m = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return { aiEnabled: m['hs.ai_enabled'] !== false, min: Number(m['hs.ai_min_confidence'] ?? 0.8), maxCalls: Number(m['hs.ai_max_calls_per_run'] ?? 10) };
}

/** Classify these products now (or all pending ones). Never throws: failures leave codes blank and flagged. */
export async function runHsClassification(ids?: string[], store?: HsStore) {
  const sb = createAdminClient();
  try {
    let target = ids;
    if (!target) {
      const { data } = await sb.from('products').select('id').eq('hs_classify_pending', true).limit(500);
      target = (data ?? []).map((r) => r.id as string);
    }
    const prods = (await loadHsProducts(sb, target)).filter((p) => !p.hs_code);
    if (!prods.length) return { classified: 0, aiCalls: 0, deferred: 0 };
    const s = await settings(sb);
    const r = await classifyProducts(prods, store ?? supabaseHsStore(sb), { ai: s.aiEnabled ? openAiClassifier() : null, minConfidence: s.min, maxCalls: s.maxCalls });
    // products over the cost cap stay queued for the next run (cron)
    if (r.deferred.length) await sb.from('products').update({ hs_classify_pending: true }).in('id', r.deferred);
    return { classified: r.results.length, aiCalls: r.aiCalls, deferred: r.deferred.length, aiErrors: r.aiErrors };
  } catch (e) {
    console.error('[hs] classification failed', e);
    return { classified: 0, aiCalls: 0, deferred: 0, error: (e as Error).message };
  }
}

/** Mark products as waiting for classification (bulk imports call this, then run in the background). */
export async function queueHsClassification(ids: string[]) {
  if (!ids.length) return;
  const sb = createAdminClient();
  for (let i = 0; i < ids.length; i += 500) await sb.from('products').update({ hs_classify_pending: true }).in('id', ids.slice(i, i + 500)).is('hs_code', null);
}

/** Backfill preview: what every product without an HS code would receive. Writes proposals only (and caches AI types). */
export async function previewHsBackfill() {
  const sb = createAdminClient();
  const { data } = await sb.from('products').select('id').is('hs_code', null).is('archived_at', null).limit(2000);
  const ids = (data ?? []).map((r) => r.id as string);
  const prods = await loadHsProducts(sb, ids);
  const real = supabaseHsStore(sb);
  const proposals: HsResult[] = [];
  const s = await settings(sb);
  const r = await classifyProducts(prods, { types: real.types, upsertAiType: real.upsertAiType, save: async (x) => { proposals.push(...x); } },
    { ai: s.aiEnabled ? openAiClassifier() : null, minConfidence: s.min, maxCalls: Math.max(s.maxCalls, Math.ceil(prods.length / 20)) });
  await sb.from('hs_backfill_proposals').delete().neq('product_id', '00000000-0000-0000-0000-000000000000');
  if (proposals.length) {
    await sb.from('hs_backfill_proposals').insert(proposals.map((p) => ({ product_id: p.product_id, hs_product_type_id: p.type_id, heading: p.heading, source: p.source, status: p.status, confidence: p.confidence, note: p.note })));
  }
  return { products: prods.length, proposals: proposals.length, aiCalls: r.aiCalls, deferred: r.deferred.length };
}

/** Apply the reviewed proposals (owner approval). Sheet / manual codes are protected by the trigger. */
export async function applyHsBackfill(actorId: string) {
  const sb = createAdminClient();
  const { data } = await sb.from('hs_backfill_proposals').select('*');
  const rows = (data ?? []) as { product_id: string; hs_product_type_id: string | null; heading: string | null; source: 'rule' | 'ai' | null; status: HsResult['status']; confidence: number | null; note: string | null }[];
  await supabaseHsStore(sb).save(rows.map((p) => ({ product_id: p.product_id, type_id: p.hs_product_type_id, heading: p.heading, source: p.source, status: p.status, confidence: p.confidence, note: p.note })));
  await sb.from('audit_log').insert({ actor_id: actorId, action: 'hs_backfill.applied', entity: 'products', entity_id: null, details: { products: rows.length, filled: rows.filter((r) => r.heading).length } });
  await sb.from('hs_backfill_proposals').delete().neq('product_id', '00000000-0000-0000-0000-000000000000');
  return rows.length;
}

export { normType };
