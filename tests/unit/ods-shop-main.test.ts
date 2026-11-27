import { describe, expect, it } from 'vitest';
import { bottomNavForPath, greetingFor, normaliseInterest, orderSections, SECTION_ORDER, sectionBarItems, sectionForPath, seeAllHref } from '@/app/ods/shop/_lib/sections';
import {
  closesIn, poolStatus, toBrandCard, toDropshipCard, toPoolCard, toServiceCard, toSourcingCard, toTurnkeyCard, warehouseServicesFrom,
} from '@/app/ods/shop/_lib/cards';
import { buildSuggestGroups, clampLimit, cleanQuery } from '@/app/ods/shop/_lib/suggest';
import { flattenSuggestions, moveActive, parseSuggestResponse } from '@octopus/ui/suggest';
import { buildWaitingItems } from '@/lib/core/waiting-items';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const day = 864e5;

/** Supplier-ish values planted in the rows; none may appear in any mapper output. */
const SECRET = ['Guangzhou Secret Factory', 'SUP-0042', 'Foshan', 'MODEL-XJ-99', 'supplier-uuid-1', '0.83'];
const leaks = (v: unknown) => {
  const json = JSON.stringify(v);
  return SECRET.filter((s) => json.includes(s));
};
const FORBIDDEN_KEYS = /supplier|factory|province|city|model_no|cost|margin|sku/i;
const badKeys = (v: unknown): string[] => {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      for (const [k, val] of Object.entries(x)) {
        if (FORBIDDEN_KEYS.test(k)) out.push(k);
        walk(val);
      }
    }
  };
  walk(v);
  return out;
};

describe('orderSections (Part 5.2 §4)', () => {
  it('keeps the fixed order without interests', () => {
    expect(orderSections()).toEqual(['sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand']);
    expect(orderSections([])).toEqual([...SECTION_ORDER]);
    expect(orderSections(null)).toEqual([...SECTION_ORDER]);
  });
  it('moves the FIRST interest to the top, the rest keep the fixed order', () => {
    expect(orderSections(['turnkey', 'pools'])).toEqual(['turnkey', 'sourcing', 'pools', 'dropship', '3pl', 'brand']);
    expect(orderSections(['brand'])).toEqual(['brand', 'sourcing', 'pools', 'dropship', '3pl', 'turnkey']);
    expect(orderSections(['sourcing'])).toEqual([...SECTION_ORDER]);
  });
  it('skips unknown values and accepts aliases', () => {
    expect(orderSections(['nonsense', 42, 'warehouse'])).toEqual(['3pl', 'sourcing', 'pools', 'dropship', 'turnkey', 'brand']);
    expect(normaliseInterest(' MMB ')).toBe('brand');
    expect(normaliseInterest('x')).toBeNull();
  });
  it('always returns all six, once each', () => {
    for (const k of SECTION_ORDER) expect(new Set(orderSections([k])).size).toBe(6);
  });
});

describe('greetingFor (local hour)', () => {
  it.each([
    [0, 'Good evening'], [4, 'Good evening'], [5, 'Good morning'], [11, 'Good morning'],
    [12, 'Good afternoon'], [17, 'Good afternoon'], [18, 'Good evening'], [23, 'Good evening'], [24, 'Good evening'], [-1, 'Good evening'],
  ])('%i → %s', (h, g) => expect(greetingFor(h)).toBe(g));
});

describe('frame paths', () => {
  it('selects the SectionBar item by public path', () => {
    expect(sectionForPath('/shop')).toBeUndefined();
    expect(sectionForPath('/shop/products')).toBe('products');
    expect(sectionForPath('/shop/products/led-lamp?tab=details')).toBe('products');
    expect(sectionForPath('/shop/pools/POOL-12')).toBe('pools');
    expect(sectionForPath('/shop/poolsx')).toBeUndefined();
    expect(sectionForPath('/shop/warehouse/')).toBe('warehouse');
  });
  it('selects the BottomNav item', () => {
    expect(bottomNavForPath('/shop')).toBe('shop');
    expect(bottomNavForPath('/shop/quote-list')).toBe('cart');
    expect(bottomNavForPath('/shop/pools/POOL-1')).toBe('pools');
    expect(bottomNavForPath('/shop/products')).toBeUndefined();
  });
  it('hides switched-off sections and keeps the category on See all', () => {
    expect(sectionBarItems({ poolsOn: false, turnkeyOn: true }).map((i) => i.id)).not.toContain('pools');
    expect(seeAllHref('pools', 'pets')).toBe('/shop/pools?category=pets');
    expect(seeAllHref('brand', 'pets')).toBe('/shop/brand');
  });
});

describe('card mappers are white-label', () => {
  const product = {
    id: 'p1', slug: 'led-lamp', title: 'LED lamp', unit: 'pcs', moq: 200, min_price_cents: null, image_url: 'https://cdn.example.com/x.jpg',
    tiers: [{ min_qty: 500, unit_price_cents: 590 }, { min_qty: 200, unit_price_cents: 620 }],
    tags: [{ slug: 'customisable', name: 'Customisable', kind: 'feature' }],
    factory: { verified: true, country: 'China', province: 'Foshan', name: 'Guangzhou Secret Factory', code: 'SUP-0042' },
    supplier_id: 'supplier-uuid-1', cost_cents: 83, lead_time_days: 18, created_at: new Date(NOW - 2 * day).toISOString(), ready_to_ship: false,
  };
  it('sourcing: price from the cheapest tier, only "Verified supplier"', () => {
    const c = toSourcingCard(product, { now: NOW });
    expect(c.fromPrice).toBe(5.9);
    expect(c.unit).toBe('pc');
    expect(c.delivery).toBe('18 days');
    expect(c.badges.map((b) => b.label)).toEqual(['New', 'Verified supplier', 'Customisable']);
    expect(c.image).toEqual({ src: 'https://cdn.example.com/x.jpg', alt: 'LED lamp', unoptimized: true });
    expect(leaks(c)).toEqual([]);
    expect(badKeys(c)).toEqual([]);
  });
  it('sourcing: no price → null (Price on request), unknown lead time → On request', () => {
    const c = toSourcingCard({ ...product, tiers: [], lead_time_days: null });
    expect(c.fromPrice).toBeNull();
    expect(c.delivery).toBe('On request');
  });
  it('pool: status, closes in, no price → left out', () => {
    const row = {
      id: 'x', code: 'POOL-7', status: 'open', product: { slug: 's', title: 'Mug', unit: 'units', image_url: null, supplier: 'Guangzhou Secret Factory' },
      target_qty: 1000, filled_qty: 800, min_pledge: 50, deadline_at: new Date(NOW + 5 * day).toISOString(), pool_price_minor: 180, base_price_minor: 210,
      factory: { verified: true, province: 'Foshan' }, supplier_id: 'supplier-uuid-1',
    };
    const c = toPoolCard(row, { now: NOW })!;
    expect(c.status).toBe('Almost full');
    expect(c.closesIn).toBe('5 days');
    expect(c.poolPrice).toBe(1.8);
    expect(c.href).toBe('/shop/pools/POOL-7');
    expect(leaks(c)).toEqual([]);
    expect(badKeys(c)).toEqual([]);
    expect(toPoolCard({ ...row, pool_price_minor: null }, { now: NOW })).toBeNull();
    expect(poolStatus({ ...row, filled_qty: 1000 }, NOW)).toBe('Filled');
    expect(poolStatus({ ...row, deadline_at: new Date(NOW + day).toISOString() }, NOW)).toBe('Closing soon');
    expect(closesIn(new Date(NOW - 1).toISOString(), NOW)).toBe('closed');
    expect(closesIn(new Date(NOW + 5 * 3600e3).toISOString(), NOW)).toBe('5 hours');
  });
  it('dropship: no price or landed cost without access; never the model number', () => {
    const row = { id: 'd1', title: 'Fountain', image: null, route: { product_cents: 780, landed_price_cents: 995 }, stock_status: 'in_stock', model_no: 'MODEL-XJ-99' } as Parameters<typeof toDropshipCard>[0];
    const locked = toDropshipCard(row, { hasAccess: false, requestHref: '/account/dropship' });
    expect(locked).not.toHaveProperty('yourPrice');
    expect(locked).not.toHaveProperty('landedCost');
    expect(JSON.stringify(locked)).not.toMatch(/7\.8|9\.95/);
    const open = toDropshipCard(row, { hasAccess: true, requestHref: '/account/dropship', country: 'United Arab Emirates' });
    expect(open.yourPrice).toBe(7.8);
    expect(open.landedCost).toBe(9.95);
    expect(open.landedIn).toBe('United Arab Emirates');
    expect(leaks([locked, open])).toEqual([]);
  });
  it('turnkey, brand and warehouse cards', () => {
    const t = toTurnkeyCard({ project_id: 'TK-1', title: 'Kitchen line', starting_budget_usd: '8500', hero_image_path: 'tk/hero.jpg', hero_image_alt: null }, { supabaseUrl: 'https://abc.supabase.co' });
    expect(t.fromPrice).toBe(8500);
    expect(t.image?.unoptimized).toBe(false);
    expect(toTurnkeyCard({ project_id: 'TK-2', title: 'X', starting_budget_usd: null, hero_image_path: null, hero_image_alt: null }).fromPrice).toBeNull();
    const b = toBrandCard({ key: 'box', name: 'Branded colour box', body: 'Box', moq: null, days: null });
    expect(b).toMatchObject({ fromPrice: null, moq: null, proofTime: 'In your quote', brandHref: '/request/brand?method=box' });
    const w = warehouseServicesFrom({ receiving_per_carton_cents: 150, storage_per_pallet_month_cents: null, pick_pack_first_cents: 120, pick_pack_extra_cents: null, returns_per_item_cents: null }).map(toServiceCard);
    expect(w).toHaveLength(4);
    expect(w[0].rates).toEqual([]);
    expect(w[1].rates).toEqual([{ label: 'Per carton', amount: 1.5, per: '' }]);
    expect(badKeys([t, b, w])).toEqual([]);
  });
});

describe('search suggestions', () => {
  const src = {
    products: [{ slug: 'led-lamp', title: 'LED lamp', supplier: 'Guangzhou Secret Factory' }] as unknown as { slug: string; title: string }[],
    pools: [{ code: 'POOL-1', product: { title: 'LED strip' } }, { code: 'POOL-2', product: { title: 'Mug' } }],
    projects: [{ project_id: 'TK-1', title: 'LED shop fit-out' }],
    categories: [{ slug: 'lighting', name: 'Lighting' }, { slug: 'led', name: 'LED panels' }],
  };
  it('groups products, pools, projects, categories with public hrefs only', () => {
    const g = buildSuggestGroups('led', src);
    expect(g.map((x) => x.id)).toEqual(['products', 'pools', 'projects', 'categories']);
    expect(flattenSuggestions(g).map((i) => i.href)).toEqual(['/shop/products/led-lamp', '/shop/pools/POOL-1', '/shop/turnkey/TK-1', '/shop/products?category=led']);
    expect(leaks(g)).toEqual([]);
  });
  it('needs 2 characters; cleans the query; clamps the limit', () => {
    expect(buildSuggestGroups('l', src)).toEqual([]);
    expect(cleanQuery(' a,(b)*  "c" ')).toBe('a b c');
    expect(clampLimit('99')).toBe(8);
    expect(clampLimit('x')).toBe(5);
  });
  it('arrow keys wrap through the text box', () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(2, 1, 3)).toBe(-1);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(0, -1, 3)).toBe(-1);
    expect(moveActive(-1, 1, 0)).toBe(-1);
  });
  it('parses only same-site links', () => {
    expect(parseSuggestResponse({ groups: [{ id: 'p', label: 'P', items: [{ label: 'A', href: '/a' }, { label: 'B', href: 'https://evil.test' }, { label: 'C', href: '//evil' }] }] })).toEqual([
      { id: 'p', label: 'P', items: [{ id: '/a', label: 'A', href: '/a' }] },
    ]);
    expect(parseSuggestResponse(null)).toEqual([]);
  });
});

describe('waiting items (same list as My account)', () => {
  const nowIso = new Date(NOW).toISOString();
  it('one item per request, payments, failed transfers (14 days), verification; most urgent first', () => {
    const items = buildWaitingItems(
      {
        quotes: [
          { rfq_id: 'r1', valid_until: new Date(NOW + 3 * day).toISOString(), rfqs: { code: 'RFQ-1', title: 'Mug' } },
          { rfq_id: 'r1', valid_until: new Date(NOW + 2 * day).toISOString(), rfqs: { code: 'RFQ-1', title: 'Mug' } },
          { rfq_id: 'r2', valid_until: new Date(NOW - day).toISOString(), rfqs: { code: 'RFQ-2', title: 'Old' } },
        ],
        orders: [
          { id: 'o1', code: 'OCT-1', title: 'Lamp', status: 'deposit_pending', updated_at: new Date(NOW - 5 * day).toISOString() },
          { id: 'o2', code: 'OCT-2', title: 'X', status: 'shipped', updated_at: new Date(NOW - 6 * day).toISOString() },
        ],
        transfers: [
          { id: 't1', amount_cents: 186000, status: 'failed', reject_reason: 'Wrong reference', confirmed_at: new Date(NOW - 2 * day).toISOString() },
          { id: 't2', amount_cents: 100, status: 'failed', reject_reason: 'Old', confirmed_at: new Date(NOW - 20 * day).toISOString() },
        ],
        kyc: { status: 'more_info', customer_message: null, reviewed_at: new Date(NOW - day).toISOString() },
      },
      nowIso,
    );
    expect(items.map((i) => i.key)).toEqual(['o-o1', 't-t1', 'kyc', 'q-r1']);
    expect(items.find((i) => i.kind === 'quote')!.title).toBe('2 quotes to review');
    expect(items.find((i) => i.kind === 'transfer')!.title).toBe('Transfer of US$ 1,860.00 not confirmed');
    expect(items.find((i) => i.kind === 'verification')!.body).toBe('Please contact your account manager.');
    expect(items.every((i) => i.href.startsWith('/account'))).toBe(true);
  });
  it('nothing waiting → []', () => {
    expect(buildWaitingItems({ quotes: [], orders: [], transfers: [], kyc: { status: 'approved', customer_message: null, reviewed_at: null } }, nowIso)).toEqual([]);
  });
});
