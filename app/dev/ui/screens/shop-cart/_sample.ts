/**
 * SAMPLE cart data for the /dev/ui/screens/shop-cart fixture only (staging). Not real products, prices or companies.
 * Shapes = the T5a contract (app/ods/shop/_lib/cart-types.ts). Money in minor units (cents).
 */
import type { BuyLine, CartNotice, CartView, QuoteLine } from '@/app/ods/shop/_lib/cart-types';

const buy = (l: Partial<BuyLine> & Pick<BuyLine, 'id' | 'kind' | 'title' | 'qty' | 'unitPriceMinor' | 'lineTotalMinor'>): BuyLine => ({
  line: 'buy',
  refId: `ref-${l.id}`,
  subLine: null,
  href: null,
  image: null,
  minQty: 1,
  step: 1,
  maxQty: null,
  depositMinor: null,
  note: null,
  notice: null,
  savedForLater: false,
  ...l,
});

const quote = (l: Partial<QuoteLine> & Pick<QuoteLine, 'id' | 'title' | 'qty' | 'moq'>): QuoteLine => ({
  line: 'quote',
  productId: `p-${l.id}`,
  href: `/shop/products/sample-${l.id}`,
  image: null,
  unit: 'units',
  targetPriceMinor: null,
  customisation: null,
  belowMoq: l.qty < l.moq,
  poolHref: null,
  notice: null,
  savedForLater: false,
  ...l,
});

export const SAMPLE_BUY: BuyLine[] = [
  buy({ id: 'b1', kind: 'sample', title: 'Silicone baking mat set', subLine: 'Sample · 1 set', href: '/shop/products/silicone-baking-mat-set', qty: 1, maxQty: 5, unitPriceMinor: 1800, lineTotalMinor: 1800, note: 'Ships by express courier' }),
  buy({ id: 'b2', kind: 'stock', title: 'Pet water fountain', subLine: 'Ready stock in our China warehouse', href: '/shop/products/pet-water-fountain', qty: 200, minQty: 50, step: 10, maxQty: 400, unitPriceMinor: 780, lineTotalMinor: 156000, note: '500+ units: US$ 7.40 each' }),
  buy({ id: 'b3', kind: 'pool', title: 'Foldable pet crate · pool POOL-0042', subLine: '640 of 1,000 units · closes 2 Dec', href: '/shop/pools/POOL-0042', qty: 100, minQty: 50, unitPriceMinor: 1120, lineTotalMinor: 112000, depositMinor: 33600, note: 'Held now: 30% of US$ 1,120.00. Returned if the pool doesn’t fill.' }),
  buy({ id: 'b4', kind: 'brand', title: 'Branded colour box design', subLine: 'Your logo on a colour box · 2 proof rounds', href: '/shop/brand', qty: 1, unitPriceMinor: 12000, lineTotalMinor: 12000, note: 'Proof time is confirmed with your design' }),
  buy({ id: 'b5', kind: 'service', title: 'Receiving and quality check', subLine: 'At our China warehouse · photos included', href: '/shop/warehouse', qty: 10, unitPriceMinor: 450, lineTotalMinor: 4500, note: 'Price from your warehouse rate card' }),
];

export const SAMPLE_QUOTE: QuoteLine[] = [
  quote({ id: 'q1', title: 'Silicone baking mat set', qty: 2000, moq: 500, unit: 'sets', customisation: 'logo' }),
  quote({ id: 'q2', title: 'Bamboo storage box', qty: 600, moq: 500 }),
  quote({ id: 'q3', title: 'Glass food containers', qty: 600, moq: 300, unit: 'sets', targetPriceMinor: 390, customisation: 'packaging' }),
];

export const SAMPLE_SAVED: (BuyLine | QuoteLine)[] = [
  buy({ id: 's1', kind: 'sample', title: 'LED desk lamp', subLine: 'Sample · 1 piece', qty: 1, unitPriceMinor: 2500, lineTotalMinor: 2500, savedForLater: true }),
  quote({ id: 's2', title: 'Yoga mat 6 mm', qty: 300, moq: 300, savedForLater: true }),
];

export function sampleCart(o: { buy?: BuyLine[]; quote?: QuoteLine[]; saved?: (BuyLine | QuoteLine)[]; notices?: CartNotice[]; canAct?: boolean; verified?: boolean; duty?: number | null } = {}): CartView {
  const b = o.buy ?? SAMPLE_BUY;
  const q = o.quote ?? SAMPLE_QUOTE;
  const sv = o.saved ?? SAMPLE_SAVED;
  const due = (l: BuyLine) => (l.kind === 'pool' ? (l.depositMinor ?? 0) : l.lineTotalMinor);
  const byKind: CartView['summary']['subtotalByKind'] = {};
  for (const l of b) byKind[l.kind] = (byKind[l.kind] ?? 0) + due(l);
  const subtotal = b.reduce((t, l) => t + due(l), 0);
  return {
    shipTo: { country: 'AE', countryName: 'United Arab Emirates', city: 'Dubai' },
    canAct: o.canAct ?? true,
    roleReason: o.canAct === false ? 'Your role can browse but not change the cart. Ask your company owner to make you a buyer.' : null,
    verified: o.verified ?? true,
    buy: b,
    quote: q,
    saved: sv,
    summary: {
      subtotalByKind: byKind,
      subtotalMinor: subtotal,
      heldDepositMinor: b.filter((l) => l.kind === 'pool').reduce((t, l) => t + (l.depositMinor ?? 0), 0),
      buyCount: b.length,
      quoteCount: q.length,
      savedCount: sv.length,
      headerCount: b.length + q.length + sv.length, // all lines, as summarise() in cart-logic
      dutyEstimate: o.duty === undefined ? { minor: 9000 } : o.duty == null ? null : { minor: o.duty },
    },
    notices: o.notices ?? [],
  };
}

/** Re-checked: price up on the stock line, stock reduced on another, a pool closed (moved to Get a quote). */
export function rechecked(): CartView {
  const price: CartNotice = { kind: 'price-changed', fromMinor: 780, toMinor: 795 };
  const stock: CartNotice = { kind: 'stock-reduced', fromQty: 200, toQty: 120 };
  const pool: CartNotice = { kind: 'pool-closed' };
  const b = [
    SAMPLE_BUY[0],
    { ...SAMPLE_BUY[1], unitPriceMinor: 795, lineTotalMinor: 159000, notice: price },
    buy({ id: 'b6', kind: 'stock', title: 'Ceramic pet bowl', subLine: 'Ready stock in our China warehouse', href: '/shop/products/ceramic-pet-bowl', qty: 120, minQty: 10, maxQty: 120, unitPriceMinor: 350, lineTotalMinor: 42000, notice: stock }),
  ];
  const q = [quote({ id: 'q4', title: 'Foldable pet crate', qty: 100, moq: 500, poolHref: null, notice: pool }), ...SAMPLE_QUOTE.slice(0, 1)];
  return sampleCart({ buy: b, quote: q, notices: [price, stock, pool] });
}

export function belowMoq(): CartView {
  return sampleCart({ quote: [SAMPLE_QUOTE[0], quote({ id: 'q2b', title: 'Bamboo storage box', qty: 300, moq: 500, poolHref: '/shop/pools/POOL-0051' }), SAMPLE_QUOTE[2]] });
}

export const EMPTY_CART = sampleCart({ buy: [], quote: [], saved: [], duty: null });
