import { describe, expect, it } from 'vitest';
import { publicProduct, supplierAlias, type PublicFactory } from '@/lib/api/data';
import type { FxContext } from '@/lib/api/money';
import { publicOrder, publicQuote } from '@/lib/api/trade';
import { buildOpenApi } from '@/lib/api/openapi';
import examples from '../../postman/examples.json';

// API v1 (19 Nov 2026): `supplier` is a DEPRECATED alias of `factory` on products, quotes and orders. It must carry
// exactly the safe part of `factory` (verified, country, province, label) — never an id, code, name or contact.
const fx: FxContext = { currency: 'USD', rate: 7.1, fxRateId: 'fx1', effectiveFrom: '2026-11-01T00:00:00Z', steps: { USD: 1, CNY: 1 } };
const factory: PublicFactory = { verified: true, country: 'CN', province: 'Guangdong', label: 'Verified factory · China (Guangdong)' };
const SAFE = ['verified', 'country', 'province', 'label'];
const FORBIDDEN = /^(id|supplier_id|code|supplier_code|name|legal_name|contact|email|phone)$/;

const safePart = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).filter(([k]) => SAFE.includes(k)));

describe('deprecated `supplier` alias', () => {
  const shapes = {
    product: publicProduct({ id: 'p', slug: 's', title: 't', unit: 'pcs', moq: 1, min_price_cents: 100, currency: 'USD', supplier_id: 'sup-uuid' }, fx, factory),
    quote: publicQuote({ id: 'q', supplier_id: 'sup-uuid', unit_price_cents: 10, quantity: 5, shipping_cents: 0, currency: 'USD' }, factory),
    order: publicOrder({ id: 'o', supplier_id: 'sup-uuid', unit_price_cents: 10, shipping_cents: 0, total_cents: 50, deposit_cents: 0, paid_cents: 0, currency: 'USD' }, factory),
  };
  for (const [kind, out] of Object.entries(shapes)) {
    it(`${kind}: supplier deep-equals the safe part of factory, with no id / code keys`, () => {
      const o = out as Record<string, unknown>;
      expect(o.supplier).toEqual(safePart(o.factory as Record<string, unknown>));
      expect(Object.keys(o.supplier as object).sort()).toEqual([...SAFE].sort());
      expect(Object.keys(o.supplier as object).some((k) => FORBIDDEN.test(k))).toBe(false);
      expect(JSON.stringify(o)).not.toContain('sup-uuid');
      expect('supplier_id' in o).toBe(false);
    });
  }

  it('copies key by key: extra fields on the factory object never reach the alias', () => {
    const leaky = { ...factory, id: 'sup-uuid', code: 'OCT-1132', name: 'Secret Factory Ltd', contact: 'x@y.z' };
    const a = supplierAlias(leaky)!;
    expect(a).toEqual(factory);
    expect(JSON.stringify(a)).not.toMatch(/sup-uuid|OCT-1132|Secret|x@y/);
  });

  it('is null when there is no factory', () => {
    expect(supplierAlias(null)).toBeNull();
    expect((publicOrder({ id: 'o', currency: 'USD' }, null) as Record<string, unknown>).supplier).toBeNull();
  });

  it('is marked deprecated in the OpenAPI document (Product, Quote, Order)', () => {
    const doc = buildOpenApi('https://example.test') as { components: { schemas: Record<string, { properties?: Record<string, Record<string, unknown>> }> } };
    for (const s of ['Product', 'Quote', 'Order']) {
      const p = doc.components.schemas[s].properties!.supplier;
      expect(p.deprecated, s).toBe(true);
      expect(String(p.description)).toMatch(/Deprecated alias of `factory`; contains only verified\/country\/province/);
    }
  });

  it('postman examples: every supplier alias equals the safe part of its factory', () => {
    let n = 0;
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (!x || typeof x !== 'object') return;
      const o = x as Record<string, unknown>;
      if ('factory' in o && o.factory) { n++; expect(o.supplier).toEqual(safePart(o.factory as Record<string, unknown>)); }
      Object.values(o).forEach(walk);
    };
    walk(examples);
    expect(n).toBeGreaterThan(0);
  });
});
