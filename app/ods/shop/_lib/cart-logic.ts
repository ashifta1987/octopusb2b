/**
 * ODS T5a · Cart logic (pure, client-safe; unit-tested in tests/unit/ods-cart.test.ts). No I/O, no React.
 * Money stays in MINOR units (cents). Nothing here moves money: the summary is what the cart page shows; the checkout (T5b)
 * recalculates everything on the server at "Place order".
 *
 *  - lineTotalMinor(kind, unit, qty)      sample = ONE fee per request (today's request_service charges once), else unit × qty
 *  - depositMinor(unit, qty, pct)         pool deposit held (same rounding as the database's round_minor with step 1)
 *  - isBelowMoq / sendBlockReason         Get a quote: "Send" is disabled while a line (not saved for later) is below MOQ
 *  - summarise(buy, quote, saved, duty)   CartSummary: subtotal by kind (pool = held deposit), what's due now, counts,
 *                                         header count = all lines
 *  - estimateDuty(lines)                  "Duty and VAT: on arrival, about …" from duty entries; null = "not known yet"
 *  - parseRecheck(raw)                    shop_cart_recheck() JSON → notices per line
 *  - noticeText / unavailableText         sentences for the re-check notices
 *  - mapCartError(e)                      RPC error → { code, message } (friendly, names the product and the fix)
 */
import { formatMoney } from '@octopus/ui/format';
import { mapDbError } from '@/lib/format';
import { ROLE_REASON } from '@/lib/shop/shared';
import type { BuyKind, BuyLine, CartNotice, CartSummary, QuoteLine } from './cart-types';

export const BUY_KINDS: readonly BuyKind[] = ['sample', 'stock', 'pool', 'brand', 'service'];
export const CART_NOT_READY = { ok: false as const, code: 'cart-not-ready', message: 'The cart is being set up.' };

export const currencyLabel = (code: string | null | undefined) => (!code || code === 'USD' ? 'US$' : code);
export const fmtMinor = (minor: number, currency = 'USD') => formatMoney(minor / 100, { currency: currencyLabel(currency) });

export function lineTotalMinor(kind: BuyKind, unitPriceMinor: number, qty: number): number {
  if (!Number.isFinite(unitPriceMinor) || !Number.isFinite(qty) || qty <= 0) return 0;
  return kind === 'sample' ? Math.round(unitPriceMinor) : Math.round(unitPriceMinor) * Math.floor(qty);
}

export function depositMinor(unitPriceMinor: number, qty: number, pct: number): number {
  if (!(unitPriceMinor >= 0) || !(qty > 0) || !(pct >= 0)) return 0;
  return Math.round((unitPriceMinor * qty * pct) / 100);
}

export const isBelowMoq = (qty: number, moq: number) => Number.isFinite(qty) && qty < Math.max(1, Math.floor(moq || 1));

/** null = the quote request can be sent; otherwise the reason shown next to the disabled button. */
export function sendBlockReason(quote: readonly QuoteLine[]): string | null {
  const live = quote.filter((l) => !l.savedForLater);
  if (!live.length) return 'Add products to Get a quote first.';
  const low = live.filter((l) => l.belowMoq);
  if (low.length === 1) return `${low[0].title} is below its minimum order of ${low[0].moq.toLocaleString('en-US')}. Raise it or join a pool.`;
  if (low.length > 1) return `${low.length} products are below their minimum order. Raise them or join a pool.`;
  return null;
}

export function summarise(buy: readonly BuyLine[], quote: readonly QuoteLine[], saved: readonly (BuyLine | QuoteLine)[], duty: { minor: number } | null): CartSummary {
  const subtotalByKind: Partial<Record<BuyKind, number>> = {};
  let subtotal = 0;
  let held = 0;
  for (const l of buy) {
    if (l.savedForLater) continue;
    const due = l.kind === 'pool' ? l.depositMinor ?? 0 : l.lineTotalMinor;
    if (l.kind === 'pool') held += due;
    subtotalByKind[l.kind] = (subtotalByKind[l.kind] ?? 0) + due;
    subtotal += due;
  }
  const buyCount = buy.filter((l) => !l.savedForLater).length;
  const quoteCount = quote.filter((l) => !l.savedForLater).length;
  return {
    subtotalByKind,
    subtotalMinor: subtotal,
    heldDepositMinor: held,
    buyCount,
    quoteCount,
    savedCount: saved.length,
    headerCount: buyCount + quoteCount + saved.length,
    dutyEstimate: duty,
  };
}

/** Header count without loading the lines (all lines, saved included). */
export const headerCount = (buyLines: number, quoteLines: number) => Math.max(0, buyLines) + Math.max(0, quoteLines);

export type DutyInput = { valueMinor: number; dutyBp: number; taxBp: number; deMinimisMinor: number | null };
/**
 * About how much duty + VAT/GST is due on arrival, from the duty entries (lookup_duty_rate: duty_bp, tax_bp, de minimis).
 * Duty = value × duty %; tax on (value + duty) × tax %; nothing when the goods total is at or under the de minimis.
 * null ("not known yet") when there are no goods lines or any line has no entry.
 */
export function estimateDuty(lines: readonly (DutyInput | null)[]): { minor: number } | null {
  if (!lines.length || lines.some((l) => l == null)) return null;
  const ls = lines as DutyInput[];
  const total = ls.reduce((s, l) => s + Math.max(0, l.valueMinor), 0);
  const minimis = ls.map((l) => l.deMinimisMinor).filter((x): x is number => x != null && x > 0);
  if (minimis.length && total <= Math.min(...minimis)) return { minor: 0 };
  let sum = 0;
  for (const l of ls) {
    const v = Math.max(0, l.valueMinor);
    const duty = (v * Math.max(0, l.dutyBp)) / 10000;
    sum += duty + ((v + duty) * Math.max(0, l.taxBp)) / 10000;
  }
  return { minor: Math.round(sum) };
}

/** Sentences for the "unavailable" reasons shop_cart_lines() / shop_cart_recheck() return (codes from the database). */
export function unavailableText(reason: string): string {
  switch (reason) {
    case 'moved-to-quote': return 'No longer in stock at a fixed price. We moved it to Get a quote.';
    case 'PRODUCT_UNAVAILABLE': case 'NOT_FOUND': return 'This product is no longer available. Remove it.';
    case 'NO_FIXED_PRICE': return 'There is no fixed price for this any more. Ask for a quote instead.';
    case 'OUT_OF_STOCK': return 'Out of stock. Ask for a quote instead.';
    case 'SERVICE_INACTIVE': return 'This service is paused right now. Remove it or try again later.';
    case 'POOLS_DISABLED': return 'Group buying is paused right now. Please check back later.';
    case 'POOL_NOT_OPEN': return 'This pool has closed.';
    case 'POOL_FULL': return 'This pool has reached its buyer limit.';
    case 'POOL_CURRENCY_MISMATCH': return 'This pool is priced in another currency and can’t take new buyers.';
    case 'ALREADY_PLEDGED': return 'Your company already joined this pool. Remove this line; your pledge is in My account.';
    default: return 'Not available right now.';
  }
}

export function noticeText(n: CartNotice, currency = 'USD'): string {
  switch (n.kind) {
    case 'price-changed': return `The price changed from ${fmtMinor(n.fromMinor, currency)} to ${fmtMinor(n.toMinor, currency)}.`;
    case 'stock-reduced': return `Only ${n.toQty.toLocaleString('en-US')} left in stock, so we lowered the quantity from ${n.fromQty.toLocaleString('en-US')}. Ask for a quote for the rest.`;
    case 'pool-closed': return 'The pool closed, so we moved this product to Get a quote.';
    case 'unavailable': return unavailableText(n.reason);
  }
}

export type RecheckNotice = { line: 'buy' | 'quote'; id: string; title: string | null; notice: CartNotice };
const num = (x: unknown) => (typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN);

/** shop_cart_recheck() → { notices: [{ line, id, title, kind, … }] } — unknown shapes are dropped, never guessed. */
export function parseRecheck(raw: unknown): RecheckNotice[] {
  const list = (raw && typeof raw === 'object' && Array.isArray((raw as { notices?: unknown }).notices) ? (raw as { notices: unknown[] }).notices : []) as Record<string, unknown>[];
  const out: RecheckNotice[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object' || (r.line !== 'buy' && r.line !== 'quote') || typeof r.id !== 'string') continue;
    const title = typeof r.title === 'string' ? r.title : null;
    let notice: CartNotice | null = null;
    if (r.kind === 'price-changed' && Number.isFinite(num(r.fromMinor)) && Number.isFinite(num(r.toMinor))) notice = { kind: 'price-changed', fromMinor: num(r.fromMinor), toMinor: num(r.toMinor) };
    else if (r.kind === 'stock-reduced' && Number.isFinite(num(r.fromQty)) && Number.isFinite(num(r.toQty))) notice = { kind: 'stock-reduced', fromQty: num(r.fromQty), toQty: num(r.toQty) };
    else if (r.kind === 'pool-closed') notice = { kind: 'pool-closed' };
    else if (r.kind === 'unavailable') notice = { kind: 'unavailable', reason: typeof r.reason === 'string' ? r.reason : 'unknown' };
    if (notice) out.push({ line: r.line, id: r.id, title, notice });
  }
  return out;
}

/** Notices for one line, worst first (unavailable / pool closed > stock > price). */
export function pickNotice(notices: readonly RecheckNotice[], line: 'buy' | 'quote', id: string): CartNotice | null {
  const rank = { unavailable: 0, 'pool-closed': 1, 'stock-reduced': 2, 'price-changed': 3 } as const;
  const mine = notices.filter((n) => n.line === line && n.id === id).sort((a, b) => rank[a.notice.kind] - rank[b.notice.kind]);
  return mine[0]?.notice ?? null;
}

/** Postgres / PostgREST "function does not exist" (migration 253 not applied yet). */
export const isMissingFunction = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|function .* does not exist/i.test(e.message ?? ''));
/** A column / table that isn't there yet (253's quote_list_items columns, shop_carts). */
export const isMissingRelationOrColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205' || /column .* does not exist|relation .* does not exist|could not find the table/i.test(e.message ?? ''));

const n = (x: string) => {
  const v = Number(x);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : x;
};

/** RPC error → a code the UI can branch on + a sentence that says what to do. */
export function mapCartError(e: { message?: string; code?: string } | null | undefined): { code: string; message: string } {
  const m = e?.message ?? '';
  const i = m.indexOf(':');
  const code = (i >= 0 ? m.slice(0, i) : m).trim();
  const rest = i >= 0 ? m.slice(i + 1).trim() : '';
  const [a, b] = rest.split('|').map((x) => x.trim());
  const name = b || 'this item';
  const say = (message: string) => ({ code, message });
  switch (code) {
    case 'ROLE_NOT_ALLOWED': return say(ROLE_REASON);
    case 'NOT_SIGNED_IN': return say('Please sign in again.');
    case 'STAFF_CANNOT_BE_CUSTOMER': return say('Staff accounts can’t use the customer cart. Sign in with a customer account.');
    case 'NO_ORG': return say('Please complete your company profile first.');
    case 'BELOW_MOQ': return say(b ? `Quantity is below the minimum for ${b}. Enter at least ${n(a)}.` : `Quantity is below the minimum. Enter at least ${n(a)}.`);
    case 'QTY_STEP': return say(`Quantity for ${name} goes up in steps of ${n(a)}.`);
    case 'ABOVE_STOCK': return say(`Only ${n(a)} of ${name} in stock. Lower the quantity, or ask for a quote for the rest.`);
    case 'ABOVE_MAX': return say(`You can add up to ${n(a)} of ${name}.`);
    case 'OUT_OF_STOCK': return say(`${rest || 'This product'} is out of stock. Ask for a quote instead.`);
    case 'NO_FIXED_PRICE': return say(`${rest || 'This'} has no fixed price. Ask for a quote instead.`);
    case 'SERVICE_INACTIVE': return say('This service is paused right now. Please try again later.');
    case 'POOLS_DISABLED': return say('Group buying is paused right now. Please check back later.');
    case 'POOL_NOT_OPEN': return say('This pool has closed. Ask for a quote instead.');
    case 'POOL_FULL': return say('This pool has reached its buyer limit. Ask for a quote instead.');
    case 'POOL_CURRENCY_MISMATCH': return say('This pool is priced in another currency and can’t take new buyers.');
    case 'ALREADY_PLEDGED': return say('Your company already joined this pool. Your pledge is in My account.');
    case 'CART_FULL': return say('Your cart holds up to 50 Buy-now lines. Check out or remove some first.');
    case 'QUOTE_LIST_FULL': return say('Get a quote holds up to 50 products. Send it, or remove some first.');
    case 'QUOTE_LIST_EMPTY': return say('There is nothing to send. Add products to Get a quote, or move saved ones back.');
    case 'SHIP_TO_REQUIRED': return say('Ship to: choose the country we should ship to.');
    case 'PRODUCT_UNAVAILABLE': return say(`${rest || 'A product'} is no longer available. Remove it and try again.`);
    case 'INVALID_QUANTITY': return say('Quantity: enter a whole number above 0.');
    case 'INVALID_AMOUNT': return say('Target price: enter an amount like 1.85, or leave it empty.');
    case 'NOT_FOUND': return say('This line is no longer in your cart. The page has been refreshed.');
    case 'INVALID_INPUT': return say(rest ? `Please check: ${rest}.` : 'Please check the form.');
    // the sourcing fee of a quote request goes through the wallet exactly as today (core_submit_rfq) — same wording as today
    case 'WALLET_INSUFFICIENT': case 'WALLET_DISABLED': return say(mapDbError(e));
    default: return { code: 'error', message: 'Something went wrong. Please try again.' };
  }
}
