import { describe, expect, it, vi } from 'vitest';
import { classifyProducts, matchRule, validateAiItem, normType, chunk, MANUAL_NOTE, type HsProduct, type HsStore, type HsType, type HsResult } from '@/lib/hs/classify';

const P = (o: Partial<HsProduct>): HsProduct => ({ id: 'p', title: 'Thing', category: null, specs: null, material: null, hs_code: null, hs_code_source: null, ...o });

/** In-memory store: types table + saved results, like the Supabase store (AI types are cached by type_key). */
function memStore(types: HsType[] = []) {
  const saved: HsResult[] = []; let n = 0;
  const store: HsStore = {
    types: async () => [...types],
    upsertAiType: async (t) => {
      const ex = types.find((x) => x.type_key === t.type_key);
      if (ex) return ex;
      const nt: HsType = { id: `ai-${++n}`, type_key: t.type_key, name: t.name, keywords: [t.type_key], heading: t.heading, confirmed: false, confidence: t.confidence, source: 'ai' };
      types.push(nt); return nt;
    },
    save: async (r) => { saved.push(...r); },
  };
  return { store, saved, types };
}
const rule = (o: Partial<HsType>): HsType => ({ id: 'r1', type_key: 'electric fan', name: 'Electric fan', keywords: ['fan'], heading: '8414', confirmed: false, confidence: null, ...o });

describe('HS heading detection', () => {
  it('confirmed rule fills the code as confirmed; unconfirmed rule as suggested (no AI call)', async () => {
    const ai = vi.fn();
    const a = memStore([rule({ confirmed: true })]);
    const r1 = await classifyProducts([P({ id: 'f8', title: 'Handheld Fan with Animated Face' })], a.store, { ai });
    expect(r1.results[0]).toMatchObject({ heading: '8414', source: 'rule', status: 'confirmed' });
    const b = memStore([rule({ confirmed: false })]);
    const r2 = await classifyProducts([P({ id: 'f9', title: 'Neck fans, 4000mAh' })], b.store, { ai });
    expect(r2.results[0]).toMatchObject({ heading: '8414', status: 'suggested' });
    expect(ai).not.toHaveBeenCalled();
  });

  it('rule matching needs every keyword word; longer keyword wins', () => {
    const rules = [rule({ id: 'a', keywords: ['fan'] }), rule({ id: 'b', type_key: 'ultrasonic humidifier', keywords: ['ultrasonic humidifier'], heading: '8509' })];
    expect(matchRule({ title: 'Ultrasonic Humidifier with fan', category: null, specs: null }, rules)?.id).toBe('b');
    expect(matchRule({ title: 'Humidifier P05', category: null, specs: null }, rules)).toBeNull();
  });

  it('AI ≥ 0.8 fills a suggested heading; < 0.8 leaves it blank and flagged', async () => {
    const m = memStore();
    const ai = vi.fn(async (items: { id: string }[]) => ({ items: [
      { id: items[0].id, heading: '8509', confidence: 0.86, product_type: 'Ultrasonic humidifier', reason: 'domestic electro-mechanical appliance' },
      { id: items[1].id, heading: '3307', confidence: 0.55, product_type: 'Aroma diffuser bar', reason: 'unclear' },
    ] }));
    const r = await classifyProducts([P({ id: 'h', title: 'Mini Capsule Humidifier P05' }), P({ id: 'd', title: 'Aroma bar' })], m.store, { ai });
    expect(r.results.find((x) => x.product_id === 'h')).toMatchObject({ heading: '8509', source: 'ai', status: 'suggested', confidence: 0.86 });
    expect(r.results.find((x) => x.product_id === 'd')).toMatchObject({ heading: null, status: 'missing', note: MANUAL_NOTE });
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('cache: the second product of the same type is matched from the cached type, not sent to the AI again', async () => {
    const m = memStore();
    const ai = vi.fn(async (items: { id: string }[]) => ({ items: items.map((i) => ({ id: i.id, heading: '8509', confidence: 0.9, product_type: 'Ultrasonic humidifier', reason: 'r' })) }));
    await classifyProducts([P({ id: 'p05', title: 'Ultrasonic humidifier P05' })], m.store, { ai });
    const r2 = await classifyProducts([P({ id: 'p06', title: 'Ultrasonic Humidifier P06, 300ml' })], m.store, { ai });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(r2.results[0]).toMatchObject({ product_id: 'p06', heading: '8509', status: 'suggested', source: 'ai' }); // still tagged ai, not rule
  });

  it('a sheet-supplied (or manual) code is never touched', async () => {
    const m = memStore([rule({ confirmed: true, heading: '8414' })]);
    const ai = vi.fn();
    const r = await classifyProducts([P({ id: 's', title: 'Fan', hs_code: '8414.51', hs_code_source: 'sheet' }), P({ id: 'm', title: 'Fan', hs_code: '8516', hs_code_source: 'manual' })], m.store, { ai });
    expect(r.results).toEqual([]);
  });

  it('5-digit, dotted or malformed AI headings are rejected (never trimmed), product flagged', async () => {
    for (const bad of ['84145', '8414.51', '84.14', 'abcd', '841', 8414, '0000', '7701', '9900']) expect(validateAiItem({ id: 'x', heading: bad, confidence: 0.9, product_type: 'fan', reason: 'r' })).toBeNull();
    expect(validateAiItem({ id: 'x', heading: '8414', confidence: 1.4, product_type: 'fan', reason: 'r' })).toBeNull();
    expect(validateAiItem({ id: 'x', heading: '8414', confidence: 0.9, product_type: 'fan', reason: 'r' })).toMatchObject({ heading: '8414' });
    const m = memStore();
    const r = await classifyProducts([P({ id: 'z', title: 'Gadget' })], m.store, { ai: async () => ({ items: [{ id: 'z', heading: '84145', confidence: 0.99, product_type: 'gadget', reason: 'r' }] }) });
    expect(r.results[0]).toMatchObject({ heading: null, status: 'missing', note: MANUAL_NOTE });
  });

  it('service down leaves the code blank and flagged (no throw)', async () => {
    const m = memStore();
    const r = await classifyProducts([P({ id: 'q', title: 'Gadget' })], m.store, { ai: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r.aiErrors).toBe(1);
    expect(r.results[0]).toMatchObject({ heading: null, status: 'missing' });
    expect(r.results[0].note).toMatch(/needs manual entry/);
  });

  it('batches of max 20 products per call and a cost cap per run', async () => {
    const m = memStore();
    const sizes: number[] = [];
    const ai = vi.fn(async (items: { id: string }[]) => { sizes.push(items.length); return { items: [] }; });
    const prods = Array.from({ length: 45 }, (_, i) => P({ id: `g${i}`, title: `Gadget model ${i} xq${i}` }));
    const r = await classifyProducts(prods, m.store, { ai, maxCalls: 2 });
    expect(sizes).toEqual([20, 20]);
    expect(r.deferred).toHaveLength(5);
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(normType('  Ultrasonic  Humidifier! ')).toBe('ultrasonic humidifier');
  });
});

