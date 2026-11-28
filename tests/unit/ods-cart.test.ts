import { describe, expect, it } from 'vitest';
import {
  CART_NOT_READY, depositMinor, estimateDuty, headerCount, isBelowMoq, isMissingFunction, isMissingRelationOrColumn, lineTotalMinor,
  mapCartError, noticeText, parseRecheck, pickNotice, sendBlockReason, summarise, unavailableText,
} from '@/app/ods/shop/_lib/cart-logic';
import type { BuyLine, QuoteLine } from '@/app/ods/shop/_lib/cart-types';
import { ROLE_REASON } from '@/lib/shop/shared';

const buy = (o: Partial<BuyLine>): BuyLine => ({
  line: 'buy', id: 'b', kind: 'stock', refId: 'r', title: 'Steel bottle', subLine: null, href: null, image: null, qty: 10, minQty: 10, step: 1,
  maxQty: null, unitPriceMinor: 500, lineTotalMinor: 5000, depositMinor: null, note: null, notice: null, savedForLater: false, ...o,
});
const quote = (o: Partial<QuoteLine>): QuoteLine => ({
  line: 'quote', id: 'q', productId: 'p', title: 'Bamboo tray', href: '/shop/products/x', image: null, qty: 100, moq: 100, unit: 'pieces',
  targetPriceMinor: null, customisation: null, belowMoq: false, poolHref: null, notice: null, savedForLater: false, ...o,
});

describe('line maths', () => {
  it('sample = one fee per request, others unit × qty', () => {
    expect(lineTotalMinor('sample', 2500, 3)).toBe(2500);
    expect(lineTotalMinor('stock', 450, 30)).toBe(13500);
    expect(lineTotalMinor('pool', 300, 5)).toBe(1500);
    expect(lineTotalMinor('service', 19900, 2)).toBe(39800);
    expect(lineTotalMinor('stock', 450, 0)).toBe(0);
    expect(lineTotalMinor('stock', Number.NaN, 2)).toBe(0);
  });
  it('pool deposit rounds like round_minor (step 1)', () => {
    expect(depositMinor(300, 5, 10)).toBe(150);
    expect(depositMinor(333, 7, 30)).toBe(699); // 699.3
    expect(depositMinor(335, 1, 10)).toBe(34); // 33.5 → 34
    expect(depositMinor(300, 0, 10)).toBe(0);
  });
  it('below MOQ', () => {
    expect(isBelowMoq(99, 100)).toBe(true);
    expect(isBelowMoq(100, 100)).toBe(false);
    expect(isBelowMoq(1, 0)).toBe(false);
  });
  it('header count = all lines', () => {
    expect(headerCount(3, 2)).toBe(5);
    expect(headerCount(-1, 2)).toBe(2);
  });
});

describe('summary', () => {
  it('subtotal by kind (pool = held deposit), due now, counts, header = all lines', () => {
    const b = [
      buy({ id: '1', kind: 'stock', lineTotalMinor: 13500 }),
      buy({ id: '2', kind: 'sample', lineTotalMinor: 2500 }),
      buy({ id: '3', kind: 'pool', lineTotalMinor: 1500, depositMinor: 150 }),
      buy({ id: '4', kind: 'stock', lineTotalMinor: 1000 }),
    ];
    const q = [quote({ id: 'a' }), quote({ id: 'b' })];
    const saved = [buy({ id: '5', savedForLater: true, lineTotalMinor: 99999 }), quote({ id: 'c', savedForLater: true })];
    const s = summarise(b, q, saved, null);
    expect(s.subtotalByKind).toEqual({ stock: 14500, sample: 2500, pool: 150 });
    expect(s.subtotalMinor).toBe(17150);
    expect(s.heldDepositMinor).toBe(150);
    expect([s.buyCount, s.quoteCount, s.savedCount, s.headerCount]).toEqual([4, 2, 2, 8]);
    expect(s.dutyEstimate).toBeNull();
  });
  it('saved lines never count in the subtotal, even when passed in buy', () => {
    const s = summarise([buy({ savedForLater: true })], [], [], { minor: 10 });
    expect(s.subtotalMinor).toBe(0);
    expect(s.buyCount).toBe(0);
    expect(s.dutyEstimate).toEqual({ minor: 10 });
  });
  it('empty cart', () => {
    const s = summarise([], [], [], null);
    expect(s).toMatchObject({ subtotalMinor: 0, headerCount: 0, subtotalByKind: {} });
  });
});

describe('send block reason', () => {
  it('names the one product below MOQ', () => {
    expect(sendBlockReason([quote({ belowMoq: true, moq: 1000, title: 'Mug' })])).toBe('Mug is below its minimum order of 1,000. Raise it or join a pool.');
  });
  it('counts several, ignores saved lines, null when fine', () => {
    expect(sendBlockReason([quote({ belowMoq: true }), quote({ belowMoq: true, id: 'z' })])).toMatch(/^2 products are below/);
    expect(sendBlockReason([quote({}), quote({ belowMoq: true, savedForLater: true })])).toBeNull();
    expect(sendBlockReason([quote({ savedForLater: true })])).toMatch(/Add products/);
  });
});

describe('duty estimate', () => {
  it('null when there are no goods lines or a rate is missing ("not known yet")', () => {
    expect(estimateDuty([])).toBeNull();
    expect(estimateDuty([{ valueMinor: 1000, dutyBp: 500, taxBp: 0, deMinimisMinor: null }, null])).toBeNull();
  });
  it('duty on value, tax on value + duty', () => {
    // 10,000 × 5 % = 500 duty; (10,000 + 500) × 5 % = 525 VAT → 1,025
    expect(estimateDuty([{ valueMinor: 10000, dutyBp: 500, taxBp: 500, deMinimisMinor: null }])).toEqual({ minor: 1025 });
  });
  it('nothing at or under the de minimis', () => {
    expect(estimateDuty([{ valueMinor: 5000, dutyBp: 500, taxBp: 500, deMinimisMinor: 5000 }])).toEqual({ minor: 0 });
    expect(estimateDuty([{ valueMinor: 5001, dutyBp: 1000, taxBp: 0, deMinimisMinor: 5000 }])).toEqual({ minor: 500 });
  });
});

describe('re-check notices', () => {
  const raw = {
    notices: [
      { line: 'buy', id: 's1', title: 'Bottle', kind: 'stock-reduced', fromQty: 60, toQty: 30 },
      { line: 'buy', id: 's1', title: 'Bottle', kind: 'price-changed', fromMinor: 500, toMinor: 450 },
      { line: 'quote', id: 'q9', title: 'Tray', kind: 'pool-closed', reason: 'moved-to-quote' },
      { line: 'buy', id: 'x', kind: 'unavailable', reason: 'SERVICE_INACTIVE' },
      { line: 'nope', id: 'x', kind: 'pool-closed' },
      { line: 'buy', id: 'y', kind: 'price-changed', fromMinor: 'abc', toMinor: 1 },
      null,
    ],
    changed: 3,
  };
  it('parses known shapes only', () => {
    const n = parseRecheck(raw);
    expect(n.map((x) => x.notice.kind)).toEqual(['stock-reduced', 'price-changed', 'pool-closed', 'unavailable']);
    expect(parseRecheck(null)).toEqual([]);
    expect(parseRecheck({ notices: 'x' })).toEqual([]);
  });
  it('picks the worst notice per line', () => {
    const n = parseRecheck(raw);
    expect(pickNotice(n, 'buy', 's1')).toEqual({ kind: 'stock-reduced', fromQty: 60, toQty: 30 });
    expect(pickNotice(n, 'quote', 'q9')).toEqual({ kind: 'pool-closed' });
    expect(pickNotice(n, 'buy', 'none')).toBeNull();
  });
  it('sentences', () => {
    expect(noticeText({ kind: 'price-changed', fromMinor: 500, toMinor: 450 })).toBe('The price changed from US$ 5.00 to US$ 4.50.');
    expect(noticeText({ kind: 'stock-reduced', fromQty: 1200, toQty: 300 })).toBe('Only 300 left in stock, so we lowered the quantity from 1,200. Ask for a quote for the rest.');
    expect(noticeText({ kind: 'pool-closed' })).toMatch(/moved this product to Get a quote/);
    expect(noticeText({ kind: 'unavailable', reason: 'moved-to-quote' })).toMatch(/moved it to Get a quote/);
    expect(unavailableText('whatever')).toBe('Not available right now.');
  });
});

describe('errors', () => {
  it('maps RPC codes to sentences that name the product', () => {
    expect(mapCartError({ message: 'BELOW_MOQ: 10 | Steel bottle' })).toEqual({ code: 'BELOW_MOQ', message: 'Quantity is below the minimum for Steel bottle. Enter at least 10.' });
    expect(mapCartError({ message: 'ABOVE_STOCK: 1200 | Steel bottle' }).message).toBe('Only 1,200 of Steel bottle in stock. Lower the quantity, or ask for a quote for the rest.');
    expect(mapCartError({ message: 'NO_FIXED_PRICE: Make My Brand' })).toEqual({ code: 'NO_FIXED_PRICE', message: 'Make My Brand has no fixed price. Ask for a quote instead.' });
    expect(mapCartError({ message: 'ROLE_NOT_ALLOWED' })).toEqual({ code: 'ROLE_NOT_ALLOWED', message: ROLE_REASON });
    expect(mapCartError({ message: 'POOL_NOT_OPEN: Tray' }).code).toBe('POOL_NOT_OPEN');
    expect(mapCartError({ message: 'QUOTE_LIST_EMPTY' }).message).toMatch(/nothing to send/);
  });
  it('never leaks a raw database message', () => {
    expect(mapCartError({ message: 'duplicate key value violates unique constraint "x"' })).toEqual({ code: 'error', message: 'Something went wrong. Please try again.' });
    expect(mapCartError(null).code).toBe('error');
  });
  it('detects a missing 253 (function / column / table)', () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.shop_cart_add' })).toBe(true);
    expect(isMissingFunction({ code: '42883', message: 'function public.shop_cart_lines() does not exist' })).toBe(true);
    expect(isMissingFunction({ code: 'P0001', message: 'BELOW_MOQ: 10 | x' })).toBe(false);
    expect(isMissingRelationOrColumn({ code: '42703', message: 'column quote_list_items.saved_for_later does not exist' })).toBe(true);
    expect(isMissingRelationOrColumn({ code: 'PGRST205', message: "Could not find the table 'public.shop_carts'" })).toBe(true);
    expect(isMissingRelationOrColumn(null)).toBe(false);
    expect(CART_NOT_READY).toEqual({ ok: false, code: 'cart-not-ready', message: 'The cart is being set up.' });
  });
});
