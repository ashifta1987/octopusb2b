'use server';
import { z } from 'zod';
import { refresh } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { shopCan, ROLE_REASON, type ShopRole } from '@/lib/shop/shared';
import { buildCart } from '../_lib/cart';
import { CART_NOT_READY, isMissingFunction, mapCartError } from '../_lib/cart-logic';
import { CUSTOMISATION_OPTIONS, type CartActionResult } from '../_lib/cart-types';

const CUSTOM_IDS: readonly string[] = CUSTOMISATION_OPTIONS.map((o) => o.id);

/**
 * ODS T5a · cart server actions (Part 5.8). Every rule is enforced again in the database (shop_guard: signed-in customer of a
 * live company, owner / buyer; prices and limits read from the source; MOQ; stock; ship-to). These validate the shape,
 * translate RPC errors into plain sentences and return the WHOLE refreshed CartView so the UI never guesses.
 * No money moves: no ledger / wallet / payment / order / checkout writes here (sendQuoteRequest = today's quote_list_submit,
 * whose sourcing fee path is unchanged).
 * Before migration 253 exists the cart RPCs are missing → { ok:false, code:'cart-not-ready' } (the quote-list actions keep
 * working on the 251 RPCs).
 */
type Fail = { ok: false; code: string; message: string };

const uuid = z.string().uuid();
const qty = z.coerce.number().int('Quantity: enter a whole number.').min(1, 'Quantity: enter a whole number above 0.').max(10_000_000, 'Quantity: that is too many.');
const line = z.enum(['buy', 'quote']);
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });
const invalid = (e: z.ZodError): Fail => fail('INVALID_INPUT', e.issues[0]?.message ?? 'Please check the form.');

/** Signed-in customer whose role may act (the same rule as shop_member_can() in the database). */
async function gate(): Promise<Fail | null> {
  const s = await getSession();
  if (!s || s.isStaff || !s.org) return fail('NOT_SIGNED_IN', 'Please sign in again.');
  const sb = await createClient();
  const { data } = await sb.from('org_members').select('member_role').eq('org_id', s.org.id).eq('user_id', s.userId).maybeSingle();
  if (!shopCan((data?.member_role as ShopRole | undefined) ?? null)) return fail('ROLE_NOT_ALLOWED', ROLE_REASON);
  return null;
}

async function done<T>(data?: T): Promise<CartActionResult<T>> {
  const cart = await buildCart(false);
  refresh(); // the Shop header "Cart (n)" lives in the layout
  return data === undefined ? { ok: true, cart } : { ok: true, cart, data };
}

const rpcFail = (error: { code?: string; message?: string }): Fail => {
  if (isMissingFunction(error)) return { ...CART_NOT_READY };
  const m = mapCartError(error);
  return fail(m.code, m.message);
};

/** Read-only: the cart as it is now (no re-check). */
export async function cartGet(): Promise<CartActionResult> {
  const s = await getSession();
  if (!s || s.isStaff || !s.org) return fail('NOT_SIGNED_IN', 'Please sign in again.');
  return { ok: true, cart: await buildCart(false) };
}

const Add = z.object({
  kind: z.enum(['sample', 'stock', 'pool', 'brand', 'service']),
  refId: z.string().trim().min(1, 'Choose an item.').max(80),
  qty: qty.optional(),
  note: z.string().max(500).optional(), // reserved (lines carry no notes in T5a)
});
/** Adds a Buy-now line; the price snapshot is read from the source in the database. Adding again raises the quantity. */
export async function cartAdd(input: z.input<typeof Add>): Promise<CartActionResult<{ addedId: string; title?: string; qty: number }>> {
  const p = Add.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const { data, error } = await sb.rpc('shop_cart_add', { p_kind: p.data.kind, p_ref: p.data.refId, p_qty: p.data.qty ?? null });
  if (error) return rpcFail(error);
  const d = data as { id: string; qty: number; title: string | null };
  return done({ addedId: d.id, title: d.title ?? undefined, qty: Number(d.qty) });
}

const UpdateQty = z.object({ id: uuid, qty });
export async function cartUpdateQty(input: z.input<typeof UpdateQty>): Promise<CartActionResult> {
  const p = UpdateQty.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const { error } = await sb.rpc('shop_cart_update', { p_item: p.data.id, p_qty: p.data.qty });
  if (error) return rpcFail(error);
  return done();
}

const Remove = z.object({ id: uuid, line });
export async function cartRemove(input: z.input<typeof Remove>): Promise<CartActionResult> {
  const p = Remove.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const { error } = p.data.line === 'buy'
    ? await sb.rpc('shop_cart_remove', { p_item: p.data.id })
    : await sb.rpc('quote_list_remove', { p_item: p.data.id });
  if (error) return rpcFail(error);
  return done();
}

const Save = z.object({ id: uuid, line, saved: z.boolean() });
export async function cartSaveForLater(input: z.input<typeof Save>): Promise<CartActionResult> {
  const p = Save.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const { error } = await sb.rpc('shop_cart_save_for_later', { p_line: p.data.line, p_item: p.data.id, p_saved: p.data.saved });
  if (error) return rpcFail(error);
  return done();
}

const QuoteAdd = z.object({ productId: uuid, qty: qty.optional() });
/** Today's quote_list_add (works before 253 too). A product that was saved for later comes back to Get a quote. */
export async function quoteAdd(input: z.input<typeof QuoteAdd>): Promise<CartActionResult<{ count: number }>> {
  const p = QuoteAdd.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const s = await getSession();
  const sb = await createClient();
  const { data, error } = await sb.rpc('quote_list_add', { p_product: p.data.productId, p_quantity: p.data.qty ?? null, p_notes: null });
  if (error) return rpcFail(error);
  const saved = await sb.from('quote_list_items').select('id').eq('org_id', s!.org!.id).eq('product_id', p.data.productId).eq('saved_for_later', true).maybeSingle();
  if (!saved.error && saved.data?.id) await sb.rpc('shop_cart_save_for_later', { p_line: 'quote', p_item: saved.data.id as string, p_saved: false });
  return done({ count: Number((data as { count: number }).count) });
}

const QuoteUpdate = z.object({
  id: uuid,
  qty,
  targetPriceMinor: z.number().int('Target price: enter an amount like 1.85.').min(0, 'Target price: enter an amount like 1.85, or leave it empty.').max(100_000_000_000).nullable(),
  customisation: z.string().nullable().refine((c) => c == null || CUSTOM_IDS.includes(c), 'Customisation: choose one of the options.'),
});
export async function quoteUpdate(input: z.input<typeof QuoteUpdate>): Promise<CartActionResult> {
  const p = QuoteUpdate.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const v = p.data;
  const { error } = await sb.rpc('quote_list_update_details', { p_item: v.id, p_quantity: v.qty, p_target_price_minor: v.targetPriceMinor, p_customisation: v.customisation });
  if (error && isMissingFunction(error)) {
    // before 253: only the quantity can be saved (251's quote_list_update keeps the notes when they are passed back)
    if (v.targetPriceMinor != null || (v.customisation != null && v.customisation !== 'none')) return { ...CART_NOT_READY };
    const cur = await sb.from('quote_list_items').select('notes').eq('id', v.id).maybeSingle();
    const r = await sb.rpc('quote_list_update', { p_item: v.id, p_quantity: v.qty, p_notes: (cur.data?.notes as string | null | undefined) ?? null });
    if (r.error) return rpcFail(r.error);
    return done();
  }
  if (error) return rpcFail(error);
  return done();
}

const ShipTo = z.object({
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Ship to: choose a country.'),
  city: z.string().trim().max(80, 'City: 80 characters at most.').optional(),
});
export async function cartSetShipTo(input: z.input<typeof ShipTo>): Promise<CartActionResult> {
  const p = ShipTo.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const { error } = await sb.rpc('shop_cart_set_ship_to', { p_country: p.data.country, p_city: p.data.city || null });
  if (error) return rpcFail(error);
  return done();
}

/** Re-reads prices, stock and pools and applies Part 5.8 (see shop_cart_recheck); the notices are on the returned lines. */
export async function cartRecheck(): Promise<CartActionResult> {
  const g = await gate();
  if (g) return g;
  const sb = await createClient();
  const { error } = await sb.rpc('shop_cart_lines');
  if (error) return rpcFail(error);
  const cart = await buildCart(true);
  refresh();
  return { ok: true, cart };
}

const Send = z.object({
  notes: z.string().trim().max(2000, 'Notes: 2,000 characters at most.'),
  idem: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Please reload the page and try again.'),
});
/** "Send quote request · n products" → today's quote_list_submit: ONE RFQ with one line per product (not saved for later). */
export async function sendQuoteRequest(input: z.input<typeof Send>): Promise<CartActionResult<{ code: string; lines: number }>> {
  const p = Send.safeParse(input);
  if (!p.success) return invalid(p.error);
  const g = await gate();
  if (g) return g;
  const s = await getSession();
  const sb = await createClient();
  // ship-to: the cart's (253), else the company's country — the same default today's quote list uses
  const cart = await sb.from('shop_carts').select('ship_to_country, ship_to_city').eq('org_id', s!.org!.id).maybeSingle();
  const country = ((cart.error ? null : (cart.data?.ship_to_country as string | null)) ?? s!.org!.country ?? '').trim().toUpperCase();
  const city = (cart.error || !cart.data ? s!.org!.city : (cart.data.ship_to_city as string | null)) ?? null;
  if (!/^[A-Z]{2}$/.test(country)) return fail('SHIP_TO_REQUIRED', mapCartError({ message: 'SHIP_TO_REQUIRED' }).message);
  const { data, error } = await sb.rpc('quote_list_submit', {
    p_destination_country: country, p_destination_city: city || null, p_notes: p.data.notes || null, p_idem: p.data.idem,
  });
  if (error) return rpcFail(error);
  const d = data as { code: string; lines: number };
  return done({ code: d.code, lines: Number(d.lines) });
}
