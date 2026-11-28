import { describe, expect, it } from 'vitest';
import {
  checkoutLabel, checkoutReason, dutyText, isCartNotReady, miniCartLines, noticeText, parseCartTab, poolCodeFromHref, recheckSummary,
  restQuoteHref, sendLabel, sendReason, shipToText, summaryRows, todayStep, cartTabHref,
} from '@/app/ods/shop/cart/_lib/cart-ui';
import type { BuyLine, CartView } from '@/app/ods/shop/_lib/cart-types';

const line = (o: Partial<BuyLine> & Pick<BuyLine, 'kind'>): BuyLine => ({
  line: 'buy', id: 'l1', refId: 'r1', title: 'Pet water fountain', subLine: null, href: null, image: null, qty: 200, minQty: 1, step: 1, maxQty: null,
  unitPriceMinor: 780, lineTotalMinor: 156000, depositMinor: null, note: null, notice: null, savedForLater: false, ...o,
});
const summary = (o: Partial<CartView['summary']> = {}): CartView['summary'] => ({
  subtotalByKind: {}, subtotalMinor: 0, heldDepositMinor: 0, buyCount: 0, quoteCount: 0, savedCount: 0, headerCount: 0, dutyEstimate: null, ...o,
});
const cart = (o: Partial<CartView> = {}): CartView => ({
  shipTo: { country: 'AE', countryName: 'United Arab Emirates', city: 'Dubai' }, canAct: true, roleReason: null, verified: true,
  buy: [], quote: [], saved: [], summary: summary(), notices: [], ...o,
});

describe('cart tabs (?tab=)', () => {
  it('parses buy | quote | saved and falls back to buy', () => {
    expect(parseCartTab('quote')).toBe('quote');
    expect(parseCartTab(['saved', 'buy'])).toBe('saved');
    expect(parseCartTab('evil')).toBe('buy');
    expect(parseCartTab(undefined)).toBe('buy');
    expect(cartTabHref('buy')).toBe('/shop/cart');
    expect(cartTabHref('quote')).toBe('/shop/cart?tab=quote');
  });
});

describe('summary', () => {
  it('lists subtotals by type in the fixed order, skipping empty kinds', () => {
    const rows = summaryRows(summary({ subtotalByKind: { service: 4500, sample: 1800, pool: 33600, stock: 0 } }));
    expect(rows.map((r) => r.kind)).toEqual(['sample', 'pool', 'service']);
    expect(rows[1].label).toBe('MOQ pool deposits, held');
  });
  it('duty: estimate or "not known yet" (never invented)', () => {
    expect(dutyText({ minor: 9000 })).toBe('On arrival, about US$ 90.00');
    expect(dutyText(null)).toBe('On arrival, not known yet');
  });
  it('ship-to text and labels', () => {
    expect(shipToText({ country: 'AE', countryName: 'United Arab Emirates', city: 'Dubai' })).toBe('Dubai, United Arab Emirates');
    expect(shipToText({ country: 'AE', countryName: null, city: null })).toBe('AE');
    expect(shipToText({ country: null, countryName: null, city: null })).toBeNull();
    expect(checkoutLabel(5)).toBe('Checkout · 5 items');
    expect(checkoutLabel(1)).toBe('Checkout · 1 item');
    expect(sendLabel(3)).toBe('Send quote request · 3 products');
  });
});

describe('disabled reasons', () => {
  it('send: role first, then empty, then below MOQ', () => {
    expect(sendReason({ canAct: false, roleReason: 'Ask your owner.' }, [{ belowMoq: true }])).toBe('Ask your owner.');
    expect(sendReason({ canAct: true, roleReason: null }, [])).toMatch(/Add a product/);
    expect(sendReason({ canAct: true, roleReason: null }, [{ belowMoq: false }, { belowMoq: true }])).toBe('Fix the line below its minimum to send.');
    expect(sendReason({ canAct: true, roleReason: null }, [{ belowMoq: true }, { belowMoq: true }])).toBe('Fix the 2 lines below their minimum to send.');
    expect(sendReason({ canAct: true, roleReason: null }, [{ belowMoq: false }])).toBeNull();
  });
  it('checkout: role, then no Buy now lines; unverified companies may open it', () => {
    expect(checkoutReason({ canAct: false, roleReason: null }, 3)).toMatch(/browse only/);
    expect(checkoutReason({ canAct: true, roleReason: null }, 0)).toBe('Add a Buy now item first.');
    expect(checkoutReason({ canAct: true, roleReason: null }, 2)).toBeNull();
  });
});

describe('re-checks (Part 5.8)', () => {
  it('line notice texts', () => {
    expect(noticeText({ kind: 'price-changed', fromMinor: 780, toMinor: 795 })).toBe('The price changed from US$ 7.80 to US$ 7.95 each since you added it.');
    expect(noticeText({ kind: 'stock-reduced', fromQty: 200, toQty: 120 })).toBe('Only 120 left. We changed your quantity from 200 to 120.');
    expect(noticeText({ kind: 'pool-closed' }, { title: 'Foldable pet crate' })).toMatch(/moved Foldable pet crate to Get a quote/);
    expect(noticeText({ kind: 'unavailable', reason: 'OUT_OF_STOCK' })).toBe('Out of stock. Ask for a quote instead.');
  });
  it('page banner summarises each kind of change; null when nothing changed', () => {
    expect(recheckSummary([])).toBeNull();
    const s = recheckSummary([{ kind: 'price-changed', fromMinor: 1, toMinor: 2 }, { kind: 'stock-reduced', fromQty: 5, toQty: 2 }, { kind: 'pool-closed' }])!;
    expect(s.title).toBe('We checked your cart: 3 changes');
    expect(s.lines).toHaveLength(3);
    expect(s.hasPrice).toBe(true);
    expect(recheckSummary([{ kind: 'pool-closed' }])!.hasPrice).toBe(false);
  });
  it('"Ask for a quote for the rest" goes to the product quote drawer with the missing quantity', () => {
    expect(restQuoteHref({ href: '/shop/products/bowl' }, 80)).toBe('/shop/products/bowl?quote=1&qty=80');
    expect(restQuoteHref({ href: null }, 80)).toBeNull();
    expect(restQuoteHref({ href: '/shop/products/bowl' }, 0)).toBeNull();
  });
});

describe('mini-cart', () => {
  it('first 3 lines + n more', () => {
    const buy = ['a', 'b', 'c', 'd', 'e'].map((id) => line({ id, kind: 'sample' }));
    const r = miniCartLines(cart({ buy }));
    expect(r.lines.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    expect(r.more).toBe(2);
    expect(miniCartLines(cart({ buy: buy.slice(0, 2) })).more).toBe(0);
  });
});

describe('checkout placeholder: today’s way per line (no money, no orders)', () => {
  it('sample → the product page sample request', () => {
    expect(todayStep(line({ kind: 'sample', href: '/shop/products/mat' }))).toEqual({ kind: 'link', href: '/shop/products/mat#sample', label: 'Request this sample' });
  });
  it('pool → today’s join step with the units (saved the T4 way)', () => {
    expect(poolCodeFromHref('/shop/pools/POOL-0042')).toBe('POOL-0042');
    expect(poolCodeFromHref('/shop/products/x')).toBeNull();
    expect(todayStep(line({ kind: 'pool', href: '/shop/pools/POOL-0042', qty: 100 }))).toEqual({ kind: 'pool', code: 'POOL-0042', qty: 100, href: '/pool/POOL-0042#join-h', label: 'Join the pool now' });
  });
  it('stock / brand / service → Ask for a quote', () => {
    expect(todayStep(line({ kind: 'stock', href: '/shop/products/fountain', qty: 200 }))).toMatchObject({ href: '/shop/products/fountain?quote=1&qty=200', label: 'Ask for a quote' });
    expect(todayStep(line({ kind: 'brand', href: null }))).toMatchObject({ href: '/shop/brand', label: 'Ask for a quote' });
    expect(todayStep(line({ kind: 'service', href: '/shop/warehouse' }))).toMatchObject({ href: '/shop/warehouse', label: 'Ask for a quote' });
  });
  it('cart-not-ready is recognised (falls back to today’s flows)', () => {
    expect(isCartNotReady({ ok: false, code: 'cart-not-ready', message: 'x' })).toBe(true);
    expect(isCartNotReady({ ok: false, code: 'POOL_FULL', message: 'x' })).toBe(false);
    expect(isCartNotReady({ ok: true, cart: cart() })).toBe(false);
  });
});
