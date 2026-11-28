/**
 * ODS T5a · Cart UI helpers (pure; server, client and unit tests). Labels, tab parsing, re-check texts, summary rows and
 * the per-line "complete it today" links of the checkout placeholder. Renders the coordinator's contract
 * (../../_lib/cart-types.ts) — no data access here.
 */
import { formatMoney, formatNumber } from '@octopus/ui/format';
import type { BuyKind, BuyLine, CartActionResult, CartNotice, CartTab, CartView, QuoteLine } from '../../_lib/cart-types';
import { CUSTOMISATION_OPTIONS } from '../../_lib/cart-types';
import { unavailableText } from '../../_lib/cart-logic';

export const CART_PATH = '/shop/cart';
export const CHECKOUT_PATH = '/shop/checkout';
export const CART_TABS: readonly CartTab[] = ['buy', 'quote', 'saved'];

/** `?tab=` → a cart tab (unknown → buy). */
export function parseCartTab(v: string | string[] | undefined | null): CartTab {
  const s = Array.isArray(v) ? v[0] : v;
  return (CART_TABS as readonly string[]).includes(s ?? '') ? (s as CartTab) : 'buy';
}

export const cartTabHref = (tab: CartTab) => (tab === 'buy' ? CART_PATH : `${CART_PATH}?tab=${tab}`);

/** Type tag label per Buy now kind (Part 5.8 line types). */
export const KIND_LABEL: Record<BuyKind, string> = {
  sample: 'Sample',
  stock: 'Ready stock',
  pool: 'MOQ pool',
  brand: 'Make My Brand',
  service: 'Warehouse service',
};

/** Summary row label per kind (the pool row is the held deposit — what is due now). */
export const SUBTOTAL_LABEL: Record<BuyKind, string> = {
  sample: 'Samples',
  stock: 'Ready stock',
  pool: 'MOQ pool deposits, held',
  brand: 'Make My Brand',
  service: 'Warehouse services',
};

const KIND_ORDER: BuyKind[] = ['sample', 'stock', 'pool', 'brand', 'service'];

export const money = (minor: number) => formatMoney(minor / 100);

/** What a Buy now line costs now: pool lines = the held deposit; every other kind = the line total. */
export const dueNowMinor = (l: Pick<BuyLine, 'kind' | 'depositMinor' | 'lineTotalMinor'>) => (l.kind === 'pool' && l.depositMinor != null ? l.depositMinor : l.lineTotalMinor);
const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export function summaryRows(s: CartView['summary']): { kind: BuyKind; label: string; minor: number }[] {
  return KIND_ORDER.filter((k) => s.subtotalByKind[k] != null && (s.subtotalByKind[k] ?? 0) > 0).map((k) => ({ kind: k, label: SUBTOTAL_LABEL[k], minor: s.subtotalByKind[k] ?? 0 }));
}

export function dutyText(d: CartView['summary']['dutyEstimate']): string {
  return d ? `On arrival, about ${money(d.minor)}` : 'On arrival, not known yet';
}

export function shipToText(t: CartView['shipTo']): string | null {
  const place = [t.city, t.countryName ?? t.country].filter(Boolean).join(', ');
  return place || null;
}

export const checkoutLabel = (n: number) => `Checkout · ${plural(n, 'item')}`;
export const sendLabel = (n: number) => `Send quote request · ${plural(n, 'product')}`;

/** Why "Send quote request" is disabled (null = it can be sent). */
export function sendReason(cart: Pick<CartView, 'canAct' | 'roleReason'>, lines: Pick<QuoteLine, 'belowMoq'>[]): string | null {
  if (!cart.canAct) return cart.roleReason ?? 'Your role can browse only.';
  if (!lines.length) return 'Add a product to Get a quote first.';
  const below = lines.filter((l) => l.belowMoq).length;
  if (below) return below === 1 ? 'Fix the line below its minimum to send.' : `Fix the ${below} lines below their minimum to send.`;
  return null;
}

/** Why "Checkout" is disabled (null = it can be opened). Unverified companies may open it: the page says "Verify to pay". */
export function checkoutReason(cart: Pick<CartView, 'canAct' | 'roleReason'>, buyCount: number): string | null {
  if (!cart.canAct) return cart.roleReason ?? 'Your role can browse only.';
  if (!buyCount) return 'Add a Buy now item first.';
  return null;
}

export const customisationLabel = (id: string | null) => CUSTOMISATION_OPTIONS.find((o) => o.id === (id ?? 'none'))?.label ?? 'No customisation';

/** "Ask for a quote for the rest" → the product page with the quote drawer open and the missing quantity. */
export function restQuoteHref(line: Pick<BuyLine, 'href'>, rest: number): string | null {
  if (!line.href || rest <= 0) return null;
  return `${line.href}?quote=1&qty=${rest}`;
}

/** One-line text of a re-check notice on its line. */
export function noticeText(n: CartNotice, ctx: { title?: string } = {}): string {
  switch (n.kind) {
    case 'price-changed':
      return `The price changed from ${money(n.fromMinor)} to ${money(n.toMinor)} each since you added it.`;
    case 'stock-reduced':
      return `Only ${formatNumber(n.toQty)} left. We changed your quantity from ${formatNumber(n.fromQty)} to ${formatNumber(n.toQty)}.`;
    case 'pool-closed':
      return `The pool closed, so we moved ${ctx.title ?? 'this product'} to Get a quote. You can still order it.`;
    case 'unavailable':
      // reason is a code from the re-check (CART-DATA builder's unavailableText words it)
      return unavailableText(n.reason);
  }
}

/** Page banner (Part 5.8 re-checks): one heading + one line per kind of change. Null when nothing changed. */
export function recheckSummary(notices: CartNotice[]): { title: string; lines: string[]; hasPrice: boolean } | null {
  if (!notices.length) return null;
  const count = (k: CartNotice['kind']) => notices.filter((n) => n.kind === k).length;
  const price = count('price-changed');
  const stock = count('stock-reduced');
  const pool = count('pool-closed');
  const gone = count('unavailable');
  const lines: string[] = [];
  if (price) lines.push(`${plural(price, 'price')} changed since you added ${price === 1 ? 'it' : 'them'}. Your cart shows the new ${price === 1 ? 'price' : 'prices'}.`);
  if (stock) lines.push(`${plural(stock, 'item')} had less stock left. We lowered the ${stock === 1 ? 'quantity' : 'quantities'}; you can ask for a quote for the rest.`);
  if (pool) lines.push(`${plural(pool, 'pool')} closed. We moved ${pool === 1 ? 'it' : 'them'} to Get a quote, so you can still order.`);
  if (gone) lines.push(`${plural(gone, 'item')} can’t be bought right now. See the note on the line.`);
  return { title: `We checked your cart: ${plural(notices.length, 'change')}`, lines, hasPrice: price > 0 };
}

/** The mini-cart's first lines (Part 5.8: "the first lines, + n more"). */
export function miniCartLines(cart: CartView, max = 3): { lines: BuyLine[]; more: number } {
  return { lines: cart.buy.slice(0, max), more: Math.max(0, cart.buy.length - max) };
}

/** Pool code from a pool line href (/shop/pools/<POOL-code>). */
export function poolCodeFromHref(href: string | null): string | null {
  const m = /\/shop\/pools\/([^/?#]+)/.exec(href ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Checkout placeholder (T5a): how to finish each Buy now line today, with the flows that already exist.
 *  sample → the product page's sample request (#sample opens today's submitSample drawer);
 *  pool → today's join step /pool/<code>#join-h (the units are saved the T4 way before going there);
 *  stock / brand / service → Ask for a quote (product quote drawer / brand page / warehouse quote form).
 */
export type TodayStep = { kind: 'link'; href: string; label: string } | { kind: 'pool'; code: string; qty: number; href: string; label: string };

export function todayStep(line: BuyLine): TodayStep {
  switch (line.kind) {
    case 'sample':
      return { kind: 'link', href: `${line.href ?? '/shop/products'}#sample`, label: 'Request this sample' };
    case 'pool': {
      const code = poolCodeFromHref(line.href);
      return code
        ? { kind: 'pool', code, qty: line.qty, href: `/pool/${encodeURIComponent(code)}#join-h`, label: 'Join the pool now' }
        : { kind: 'link', href: line.href ?? '/shop/pools', label: 'Open the pool' };
    }
    case 'stock':
      return { kind: 'link', href: line.href ? `${line.href}?quote=1&qty=${line.qty}` : '/shop/products', label: 'Ask for a quote' };
    case 'brand':
      return { kind: 'link', href: line.href ?? '/shop/brand', label: 'Ask for a quote' };
    case 'service':
      return { kind: 'link', href: line.href ?? '/shop/warehouse', label: 'Ask for a quote' };
  }
}

/** Every cart write returns the whole cart; "cart-not-ready" = migration 253 not applied yet → use today's flow. */
export const isCartNotReady = (r: CartActionResult) => !r.ok && r.code === 'cart-not-ready';

export const newIdemKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

/* ───────── Server action types (app/ods/shop/cart/actions.ts, CART-DATA builder) — passed as props so fixtures can fake them ───────── */
export type CustomisationId = (typeof CUSTOMISATION_OPTIONS)[number]['id'];
export type CartAddFn = (i: { kind: BuyKind; refId: string; qty: number; note?: string }) => Promise<CartActionResult<{ addedId?: string; title?: string | null; qty?: number }>>;
export type CartUpdateQtyFn = (i: { id: string; qty: number }) => Promise<CartActionResult>;
export type CartRemoveFn = (i: { id: string; line: 'buy' | 'quote' }) => Promise<CartActionResult>;
export type CartSaveForLaterFn = (i: { id: string; line: 'buy' | 'quote'; saved: boolean }) => Promise<CartActionResult>;
export type QuoteAddFn = (i: { productId: string; qty: number }) => Promise<CartActionResult>;
export type QuoteUpdateFn = (i: { id: string; qty: number; targetPriceMinor: number | null; customisation: CustomisationId | null }) => Promise<CartActionResult>;
export type CartSetShipToFn = (i: { country: string; city?: string }) => Promise<CartActionResult>;
export type SendQuoteRequestFn = (i: { notes: string; idem: string }) => Promise<CartActionResult<{ code: string; lines: number }>>;

export type CartPageActions = {
  cartUpdateQty: CartUpdateQtyFn;
  cartRemove: CartRemoveFn;
  cartSaveForLater: CartSaveForLaterFn;
  quoteUpdate: QuoteUpdateFn;
  cartSetShipTo: CartSetShipToFn;
  sendQuoteRequest: SendQuoteRequestFn;
};
