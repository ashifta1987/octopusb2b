import { describe, expect, it } from 'vitest';
import { publicProduct } from '@/lib/api/data';
import { amt, amt0, convert, currencySettings, findBareAmounts, price, type FxContext } from '@/lib/api/money';
import { publicDocument, publicOrder, publicQuote, publicRfq, publicServiceRequest } from '@/lib/api/trade';
import { Amount, CurrencySettings, Price, WEBHOOK_EVENTS, WebhookEndpointCreate } from '@/lib/contracts';
import { buildOpenApi } from '@/lib/api/openapi';

const usdFx: FxContext = { currency: 'USD', rate: 7.1, fxRateId: 'fx1', effectiveFrom: '2026-11-01T00:00:00Z', steps: { USD: 1, CNY: 1 } };
const cnyFx: FxContext = { ...usdFx, currency: 'CNY', steps: { USD: 1, CNY: 100 } };

describe('API money shape { amount_minor, currency } (SPEC §15.1)', () => {
  it('amt normalises currency and nulls', () => {
    expect(amt(19000, 'USD')).toEqual({ amount_minor: 19000, currency: 'USD' });
    expect(amt('136800', 'CNY ')).toEqual({ amount_minor: 136800, currency: 'CNY' });
    expect(amt(null, 'USD')).toBeNull();
    expect(amt0(undefined, 'CNY')).toEqual({ amount_minor: 0, currency: 'CNY' });
    expect(Amount.safeParse(amt(1, 'USD')).success).toBe(true);
  });

  it('converts like SQL convert_amount (rate = CNY per USD, rounding step)', () => {
    expect(convert(19000, 'USD', 'CNY', 7.1)).toBe(134900);
    expect(convert(134900, 'CNY', 'USD', 7.1)).toBe(19000);
    expect(convert(19000, 'USD', 'CNY', 7.1, 100)).toBe(134900);
    expect(convert(19001, 'USD', 'CNY', 7.1, 100)).toBe(134900);
    expect(convert(500, 'USD', 'USD', 7.1)).toBe(500);
  });

  it('catalogue prices keep their currency and add `converted` in the platform currency', () => {
    expect(price(650, 'CNY', usdFx)).toEqual({ amount_minor: 650, currency: 'CNY', converted: { amount_minor: 92, currency: 'USD', fx_rate_id: 'fx1' } });
    expect(price(1000, 'USD', usdFx)).toEqual({ amount_minor: 1000, currency: 'USD', converted: { amount_minor: 1000, currency: 'USD', fx_rate_id: null } });
    expect(price(1000, 'USD', cnyFx)!.converted).toEqual({ amount_minor: 7100, currency: 'CNY', fx_rate_id: 'fx1' });
    expect(Price.safeParse(price(650, 'CNY', usdFx)).success).toBe(true);
    const p = publicProduct({ id: 'p', slug: 's', title: 't', unit: 'pcs', moq: 1, min_price_cents: 650, currency: 'CNY', ready_to_ship: true, octopus_dropship: false }, usdFx);
    expect(p.currency).toBe('CNY');
    expect(p.from_price).toMatchObject({ amount_minor: 650, currency: 'CNY', converted: { currency: 'USD' } });
    expect(findBareAmounts(p)).toEqual([]);
  });

  it('documents keep their locked currency', () => {
    const q = publicQuote({ id: 'q', supplier_id: 's', unit_price_cents: 120, quantity: 1000, shipping_cents: 5000, currency: 'CNY', status: 'sent' }, null);
    expect(q).toMatchObject({ currency: 'CNY', unit_price: { amount_minor: 120, currency: 'CNY' }, total: { amount_minor: 125000, currency: 'CNY' } });
    expect(q).not.toHaveProperty('supplier_id');
    const o = publicOrder({ id: 'o', supplier_id: 's', unit_price_cents: 14, shipping_cents: 0, total_cents: 140000, deposit_cents: 42000, paid_cents: 42000, currency: 'USD' }, null);
    expect(o).toMatchObject({ currency: 'USD', balance: { amount_minor: 98000, currency: 'USD' }, deposit: { amount_minor: 42000, currency: 'USD' } });
    expect(publicRfq({ id: 'r', fee_minor: 3550, target_price_cents: null, currency: 'CNY' })).toMatchObject({ fee: { amount_minor: 3550, currency: 'CNY' }, target_price: null });
    expect(publicServiceRequest({ id: 's', fee_minor: 19900, currency: 'USD' }).fee).toEqual({ amount_minor: 19900, currency: 'USD' });
    expect(publicDocument({ id: 'd', amount_cents: null, currency: 'USD' }).amount).toBeNull();
    for (const x of [q, o]) expect(findBareAmounts(x)).toEqual([]);
  });

  it('findBareAmounts flags amounts without currency and legacy *_cents keys', () => {
    expect(findBareAmounts({ a: { amount_minor: 1, currency: 'USD' }, list: [{ amount_minor: 2, currency: 'CNY' }] })).toEqual([]);
    expect(findBareAmounts({ a: { amount_minor: 1 } })).toEqual(['$.a']);
    expect(findBareAmounts({ list: [{ total_cents: 5 }] })).toEqual(['$.list[0].total_cents']);
    expect(findBareAmounts({ a: { amount_minor: 1, currency: 'usd' } })).toEqual(['$.a']);
  });

  it('GET /settings/currency payload', () => {
    const s = currencySettings(usdFx);
    expect(s).toEqual({ currency: 'USD', rate: { base: 'USD', quote: 'CNY', rate: 7.1, effective_from: '2026-11-01T00:00:00Z', fx_rate_id: 'fx1' } });
    expect(CurrencySettings.safeParse(s).success).toBe(true);
  });

  it('settings.currency_changed is a subscribable webhook event documented in OpenAPI', () => {
    expect(WEBHOOK_EVENTS).toContain('settings.currency_changed');
    expect(WebhookEndpointCreate.safeParse({ url: 'https://example.com/h', events: ['settings.currency_changed'] }).success).toBe(true);
    const doc = buildOpenApi('https://x.test');
    expect(doc.webhooks).toHaveProperty(['settings.currency_changed']);
    expect(doc.components.schemas).toHaveProperty('Amount');
    expect(doc.paths['/settings/currency'].get).toMatchObject({ security: [{ oauth2: ['catalog:read'] }, { apiKey: [] }] });
    // no response schema still exposes a bare *_cents integer
    expect(JSON.stringify(doc.components.schemas)).not.toMatch(/_cents"/);
  });
});
