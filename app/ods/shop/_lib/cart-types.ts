/**
 * ODS T5a · Cart contract (pure, client-safe). Written by the coordinator; the CART-DATA builder implements the loader and
 * actions that return these shapes, the CART-UI builder renders them. Change only by agreement.
 *
 * One cart per company (Part 5.8):
 *  - Buy now lines   = public.shop_cart_items (migration 253): sample · stock · pool · brand · service, fixed price snapshot.
 *  - Get a quote     = public.quote_list_items (migration 251, extended in 253 with target price, customisation, saved for later),
 *                      sent with the existing quote_list_submit → ONE RFQ with rfq_lines.
 *  - Saved for later = lines of either kind with saved_for_later = true.
 * Money: minor units (cents) + currency 'USD'; render with formatMoney(minor / 100). No money moves in T5a.
 */
export type BuyKind = 'sample' | 'stock' | 'pool' | 'brand' | 'service';
export type CartTab = 'buy' | 'quote' | 'saved';

export type CartImage = { src: string; alt: string; unoptimized?: boolean };

/** A re-check result shown on the line (Part 5.8 "Re-checks"). */
export type CartNotice =
  | { kind: 'price-changed'; fromMinor: number; toMinor: number }
  | { kind: 'stock-reduced'; fromQty: number; toQty: number }
  | { kind: 'pool-closed' } // the line was moved to Get a quote
  | { kind: 'unavailable'; reason: string };

export type BuyLine = {
  line: 'buy';
  id: string;
  kind: BuyKind;
  refId: string; // product id / pool id / service key …
  title: string;
  subLine: string | null; // e.g. "Sample · 1 piece", "Pool POOL-0042 · deposit 30 % held"
  href: string | null;
  image: CartImage | null;
  qty: number;
  minQty: number;
  step: number;
  maxQty: number | null;
  unitPriceMinor: number; // current price (after re-check)
  lineTotalMinor: number;
  depositMinor: number | null; // pools: the held deposit for this line
  note: string | null; // green note: next tier / held deposit / proof time / rate card
  notice: CartNotice | null;
  savedForLater: boolean;
};

export type QuoteLine = {
  line: 'quote';
  id: string;
  productId: string;
  title: string;
  href: string;
  image: CartImage | null;
  qty: number;
  moq: number;
  unit: string;
  targetPriceMinor: number | null;
  customisation: string | null; // one of CUSTOMISATION_OPTIONS ids, or null
  belowMoq: boolean; // → "Raise it or join a pool"; Send disabled while any line is below MOQ
  poolHref: string | null; // an open pool for this product, if any
  notice: CartNotice | null;
  savedForLater: boolean;
};

export type CartSummary = {
  subtotalByKind: Partial<Record<BuyKind, number>>; // minor units, Buy now (not saved) only
  subtotalMinor: number;
  heldDepositMinor: number; // pools
  buyCount: number;
  quoteCount: number;
  savedCount: number;
  headerCount: number; // all lines (Part 5.8: header count = all lines)
  dutyEstimate: { minor: number } | null; // null → "not known yet"
};

export type CartView = {
  shipTo: { country: string | null; countryName: string | null; city: string | null };
  canAct: boolean; // owner / buyer
  roleReason: string | null;
  verified: boolean;
  buy: BuyLine[];
  quote: QuoteLine[];
  saved: (BuyLine | QuoteLine)[];
  summary: CartSummary;
  notices: CartNotice[]; // page-level summary of re-check changes
};

export const CUSTOMISATION_OPTIONS = [
  { id: 'none', label: 'No customisation' },
  { id: 'logo', label: 'Your logo on the product' },
  { id: 'packaging', label: 'Your packaging' },
  { id: 'colour', label: 'Your colour or material' },
] as const;

export type CartActionResult<T = unknown> = { ok: true; cart: CartView; data?: T } | { ok: false; code: string; message: string };

/**
 * Server actions (CART-DATA builder, file app/ods/shop/cart/actions.ts, 'use server'). Every one re-reads and returns the
 * whole CartView so the UI never guesses:
 *   cartAdd({ kind, refId, qty, note? })                 → adds a Buy now line (price snapshot read from the source)
 *   cartUpdateQty({ id, qty })                           → Buy now line quantity (min/step/max enforced in the DB)
 *   cartRemove({ id, line: 'buy' | 'quote' })
 *   cartSaveForLater({ id, line: 'buy' | 'quote', saved })
 *   quoteAdd({ productId, qty })                         → today's quote_list_add
 *   quoteUpdate({ id, qty, targetPriceMinor, customisation })
 *   cartSetShipTo({ country, city? })
 *   cartRecheck()                                        → re-reads prices, stock, pools; applies Part 5.8 rules; returns notices
 *   sendQuoteRequest({ notes, idem })                    → quote_list_submit (one RFQ with lines); data = { code, lines }
 * Loader (server-only, app/ods/shop/_lib/cart.ts): getCart({ recheck?: boolean }): Promise<CartView>.
 */
