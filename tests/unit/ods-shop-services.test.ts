import { describe, expect, it } from 'vitest';
import {
  ALMOST_FULL_RATIO, CLOSING_SOON_HOURS, buyerCount, defaultUnits, groupPools, isAlmostFull, isClosingSoon, joinTotals, normalisePoolCode,
  parsePoolFilter, parsePoolSort, poolStatusName, poolStep, poolsListHref, snapUnits, sortPools, toPoolRow, toPoolView, unitPriceAt,
  formatClosing, type PoolSource, type PoolView,
} from '@/app/ods/shop/pools/_lib/pool-logic';
import { BRIEF_MIN, OWN_PROJECT_SLUG, budgetError, buildTurnkeyPlan, includedRows, isProjectSlug, startMissing } from '@/app/ods/shop/turnkey/_lib/turnkey-logic';
import { parseQuoteKey, parseWarehouseView, servicesForView, warehouseHref } from '@/app/ods/shop/warehouse/_lib/warehouse-logic';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const H = 3600e3;

/** A PoolDetail-shaped row WITH the fields a customer must never see (participants, buyer codes, factory, starter). */
function source(over: Partial<PoolSource> & Record<string, unknown> = {}): PoolSource {
  return {
    id: 'p1',
    code: 'POOL-0042',
    status: 'open',
    currency: 'USD',
    product: { slug: 'crate', title: 'Foldable pet crate', unit: 'units', image_url: null, hs_code: '4202', id: 'prod-1' } as PoolSource['product'],
    target_qty: 1000,
    filled_qty: 640,
    min_pledge: 50,
    max_buyers: 25,
    deposit_pct: 10,
    deadline_at: new Date(NOW + 5 * 24 * H).toISOString(),
    created_at: '2026-11-18T09:00:00Z',
    filled_at: null,
    pool_price_minor: 1250,
    target_price_minor: 1120,
    base_price_minor: 1390,
    saving_pct: 19,
    buyers: 14,
    tiers: [
      { min_qty: 1, unit_price_minor: 1390 },
      { min_qty: 500, unit_price_minor: 1250 },
      { min_qty: 1000, unit_price_minor: 1120 },
    ],
    events: [{ kind: 'joined', title: 'Joined', qty: 100, created_at: '2026-11-20T10:00:00Z', body: 'BUYER-1042 pledged 100' }],
    participants: [{ country: 'AE', qty: 100, status: 'paid', joined_at: '2026-11-20T10:00:00Z', is_mine: false, buyer_code: 'BUYER-1042' }],
    factory: { verified: true, country: 'CN', province: 'Guangdong', name: 'Secret Factory Ltd' },
    starter: { country: 'AE' },
    ...over,
  } as PoolSource;
}

const view = (over: Partial<PoolSource> & Record<string, unknown> = {}): PoolView => toPoolView(source(over));

describe('MOQ pools · white-label projection', () => {
  it('keeps the buyer COUNT and drops participants, buyer codes, factory, starter and event bodies', () => {
    const v = view();
    expect(v.buyers).toBe(14);
    const json = JSON.stringify(v);
    for (const leak of ['participants', 'buyer_code', 'BUYER-1042', 'factory', 'Secret Factory', 'Guangdong', 'starter', 'hs_code', '4202', 'prod-1', '"body"']) {
      expect(json).not.toContain(leak);
    }
    expect(Object.keys(v).sort()).toEqual(
      ['basePriceMinor', 'buyers', 'code', 'createdAt', 'currency', 'deadlineAt', 'depositPct', 'events', 'filledAt', 'filledQty', 'id', 'image', 'maxBuyers', 'minPledge', 'poolPriceMinor', 'productSlug', 'savingPct', 'status', 'targetPriceMinor', 'targetQty', 'tiers', 'title', 'unit'].sort(),
    );
    expect(v.events[0]).toEqual({ kind: 'joined', title: 'Joined', qty: 100, created_at: '2026-11-20T10:00:00Z' });
  });

  it('the card row built from a view carries no buyer data either', () => {
    expect(JSON.stringify(toPoolRow(view()))).not.toMatch(/participant|buyer_code|factory/);
  });

  it('buyerCount says how many, never who', () => {
    expect(buyerCount(1)).toBe('1 buyer');
    expect(buyerCount(14)).toBe('14 buyers');
  });
});

describe('MOQ pools · join maths (mirror of today’s JoinPoolForm)', () => {
  const p = view();
  it('unit price follows the tier reached by the pool after this pledge', () => {
    expect(unitPriceAt(p.tiers, 0)).toBe(1390);
    expect(unitPriceAt(p.tiers, 640 + 100)).toBe(1250);
    expect(unitPriceAt(p.tiers, 1200)).toBe(1120);
    expect(unitPriceAt([], 10)).toBeNull();
  });
  it('product total, deposit at the pool’s own %, estimated balance at the target price', () => {
    const t = joinTotals(p, 100)!;
    expect(t.unitMinor).toBe(1250);
    expect(t.productTotalMinor).toBe(125_000);
    expect(t.depositMinor).toBe(12_500); // 10 % of US$ 1,250.00
    expect(t.balanceEstimateMinor).toBe(1120 * 100 - 12_500);
  });
  it('uses the deposit % of the pool (never a constant)', () => {
    expect(joinTotals({ ...p, depositPct: 25 }, 100)!.depositMinor).toBe(31_250);
    expect(joinTotals({ ...p, depositPct: 0 }, 100)!.depositMinor).toBe(0);
  });
  it('rounds the deposit like SQL (half up on cents)', () => {
    expect(joinTotals({ ...p, tiers: [{ min_qty: 1, unit_price_minor: 333 }], depositPct: 15 }, 1)!.depositMinor).toBe(50); // 49.95 → 50
  });
  it('no price tiers → no totals', () => {
    expect(joinTotals({ ...p, tiers: [] }, 100)).toBeNull();
  });
  it('default units: what is still needed, between the minimum and 5 × the minimum', () => {
    expect(defaultUnits(p)).toBe(250);
    expect(defaultUnits({ minPledge: 50, targetQty: 1000, filledQty: 980 })).toBe(50);
  });
});

describe('MOQ pools · units stepping', () => {
  it('never below the minimum', () => {
    expect(snapUnits(10, { min: 50 })).toBe(50);
    expect(snapUnits(Number.NaN, { min: 50 })).toBe(50);
    expect(snapUnits(-5, { min: 50 })).toBe(50);
  });
  it('whole units from the minimum when there is no step (pools today)', () => {
    expect(poolStep(undefined)).toBe(1);
    expect(snapUnits(73.9, { min: 50 })).toBe(73);
  });
  it('snaps to min + k × step and caps at max', () => {
    expect(poolStep(10)).toBe(10);
    expect(snapUnits(74, { min: 50, step: 10 })).toBe(70);
    expect(snapUnits(76, { min: 50, step: 10 })).toBe(80);
    expect(snapUnits(1000, { min: 50, step: 10, max: 995 })).toBe(990);
  });
});

describe('MOQ pools · status and filters', () => {
  it('thresholds match the Shop cards', () => {
    expect(CLOSING_SOON_HOURS).toBe(72);
    expect(ALMOST_FULL_RATIO).toBe(0.75);
  });
  it('closing soon = open and closes within 72 h', () => {
    expect(isClosingSoon(view({ deadline_at: new Date(NOW + 71 * H).toISOString() }), NOW)).toBe(true);
    expect(isClosingSoon(view({ deadline_at: new Date(NOW + 73 * H).toISOString() }), NOW)).toBe(false);
    expect(isClosingSoon(view({ deadline_at: new Date(NOW - H).toISOString() }), NOW)).toBe(false);
    expect(isClosingSoon(view({ status: 'locked', deadline_at: new Date(NOW + H).toISOString() }), NOW)).toBe(false);
  });
  it('almost full = open and at 75 % of the target or more', () => {
    expect(isAlmostFull(view({ filled_qty: 750 }), NOW)).toBe(true);
    expect(isAlmostFull(view({ filled_qty: 749 }), NOW)).toBe(false);
    expect(isAlmostFull(view({ filled_qty: 900, status: 'expired' }), NOW)).toBe(false);
  });
  it('Appendix C names', () => {
    expect(poolStatusName(view(), NOW)).toBe('Open');
    expect(poolStatusName(view({ filled_qty: 800 }), NOW)).toBe('Almost full');
    expect(poolStatusName(view({ filled_qty: 800, deadline_at: new Date(NOW + 10 * H).toISOString() }), NOW)).toBe('Closing soon');
    expect(poolStatusName(view({ status: 'locked', filled_qty: 1000 }), NOW)).toBe('Filled');
    expect(poolStatusName(view({ status: 'expired' }), NOW)).toBe('Closed (not filled)');
    expect(poolStatusName(view({ deadline_at: new Date(NOW - H).toISOString() }), NOW)).toBe('Closed (not filled)');
  });
  it('groups the pills and sorts', () => {
    const a = view({ code: 'POOL-1', deadline_at: new Date(NOW + 10 * H).toISOString() });
    const b = view({ code: 'POOL-2', filled_qty: 900 });
    const gone = view({ code: 'POOL-3', deadline_at: new Date(NOW - H).toISOString() });
    const g = groupPools([a, b, gone], [view({ code: 'POOL-9', status: 'locked' })], [], NOW);
    expect(g.open.map((p) => p.code)).toEqual(['POOL-1', 'POOL-2']);
    expect(g['closing-soon'].map((p) => p.code)).toEqual(['POOL-1']);
    expect(g['almost-full'].map((p) => p.code)).toEqual(['POOL-2']);
    expect(g.filled).toHaveLength(1);
    expect(sortPools([a, b], 'filled').map((p) => p.code)).toEqual(['POOL-2', 'POOL-1']);
    expect(sortPools([b, a], 'closing').map((p) => p.code)).toEqual(['POOL-1', 'POOL-2']);
  });
  it('URL state', () => {
    expect(parsePoolFilter('mine')).toBe('mine');
    expect(parsePoolFilter('nope')).toBe('open');
    expect(parsePoolSort(undefined)).toBe('closing');
    expect(poolsListHref({ status: 'open', sort: 'closing' })).toBe('/shop/pools');
    expect(poolsListHref({ status: 'filled', sort: 'saving', category: 'pets' })).toBe('/shop/pools?category=pets&status=filled&sort=saving');
  });
  it('accepts today’s pool code only', () => {
    expect(normalisePoolCode('pool-0042')).toBe('POOL-0042');
    expect(normalisePoolCode('POOL-1')).toBe('POOL-1');
    expect(normalisePoolCode('42')).toBeNull();
    expect(normalisePoolCode('POOL-12;drop')).toBeNull();
  });
  it('closing time in the customer’s zone', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    expect(formatClosing('2026-12-02T14:00:00Z', 'Asia/Dubai', now)).toBe('2 Dec, 18:00 (Dubai time)');
    expect(formatClosing('2027-01-02T14:00:00Z', 'UTC', now)).toBe('2 Jan 2027, 14:00 (UTC)');
  });
});

describe('Turnkey start form', () => {
  it('writes products and quantity into the plan text for today’s action', () => {
    expect(buildTurnkeyPlan({ products: 'Kitchen line', quantity: '1,000', brief: 'Bamboo, matte black labels.' })).toBe(
      'Products: Kitchen line\nQuantity per item: 1,000\n\nBamboo, matte black labels.',
    );
    expect(buildTurnkeyPlan({ products: ' ', quantity: '', brief: ' Only a brief ' })).toBe('Only a brief');
  });
  it('lists what still blocks Send', () => {
    const v = { products: '', quantity: '', budgetUsd: '', country: '', brief: 'short' };
    expect(startMissing(v, true)).toEqual(['what you want to make or open', `your brief (${BRIEF_MIN} characters or more)`]);
    expect(startMissing({ ...v, brief: 'x'.repeat(BRIEF_MIN) }, false)).toEqual([]);
  });
  it('budget uses today’s usdToCents rule', () => {
    expect(budgetError('')).toBeNull();
    expect(budgetError('35,000')).toBeNull();
    expect(budgetError('$1200.50')).toBeNull();
    expect(budgetError('about 5k')).toMatch(/US dollars/);
  });
  it('project slugs', () => {
    expect(isProjectSlug('1-robotic-cafe')).toBe(true);
    expect(isProjectSlug(OWN_PROJECT_SLUG)).toBe(true);
    expect(isProjectSlug('../etc')).toBe(false);
  });
  it('What’s included = core + QC services in order', () => {
    const rows = includedRows([
      { code: 'visit', name: 'China visit', from_cents: 1, unit: 'trip', approx: false, rule_text: null, group_code: 'visit', photo_path: null, sort: 1 },
      { code: 'qc', name: 'Inspection', from_cents: 39900, unit: 'day', approx: false, rule_text: 'Photo report', group_code: 'qc', photo_path: null, sort: 3 },
      { code: 'consultation', name: 'Consultation', from_cents: 9900, unit: 'project', approx: false, rule_text: null, group_code: 'core', photo_path: null, sort: 2 },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['consultation', 'qc']);
  });
});

describe('Warehouse views', () => {
  it('Storage | Fulfilment and the quote drawer URL', () => {
    expect(parseWarehouseView('fulfilment')).toBe('fulfilment');
    expect(parseWarehouseView('x')).toBe('storage');
    expect(servicesForView('storage')).toEqual(['storage', 'receiving']);
    expect(servicesForView('fulfilment')).toEqual(['fulfilment', 'returns']);
    expect(parseQuoteKey('returns')).toBe('returns');
    expect(parseQuoteKey('evil')).toBeNull();
    expect(warehouseHref({ view: 'storage' })).toBe('/shop/warehouse');
    expect(warehouseHref({ view: 'fulfilment', quote: 'returns' })).toBe('/shop/warehouse?view=fulfilment&quote=returns');
  });
});
