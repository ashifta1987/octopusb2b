'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { toCents } from '@/lib/format';
import { shopError, shopCan, type ShopRole } from '@/lib/shop/shared';

/**
 * CH-1 Shop actions. Every rule is enforced again in the database (shop_guard: signed-in customer, live company, owner/buyer;
 * MOQ; ship-to; fee from settings) — these only validate shape and translate errors into plain language.
 */
type Fail = { ok: false; error: string; field?: string };
const uuid = z.string().uuid();
const idem = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const country = z.string().trim().regex(/^[A-Z]{2}$/, 'Ship to: choose a country.');
const money = z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, 'Target price: enter an amount like 1.85, or leave it empty.');

async function signedIn() {
  const s = await getSession();
  return !!s && !s.isStaff && !!s.org;
}

/** owner / buyer of the signed-in company (the same rule as shop_member_can() in the database) */
async function memberCanAct(): Promise<boolean> {
  const s = await getSession();
  if (!s?.org || s.isStaff) return false;
  const sb = await createClient();
  const { data } = await sb.from('org_members').select('member_role').eq('org_id', s.org.id).eq('user_id', s.userId).maybeSingle();
  return shopCan((data?.member_role as ShopRole | undefined) ?? null);
}

export async function addToQuoteList(productId: string, quantity?: number): Promise<{ ok: true; count: number } | Fail> {
  if (!uuid.safeParse(productId).success) return { ok: false, error: 'This product is no longer available.' };
  if (!(await signedIn())) return { ok: false, error: 'Please sign in again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('quote_list_add', { p_product: productId, p_quantity: quantity ?? null, p_notes: null });
  if (error) return { ok: false, error: shopError(error) };
  return { ok: true, count: Number((data as { count: number }).count) };
}

export async function updateQuoteItem(id: string, quantity: number, notes: string): Promise<{ ok: true; count: number } | Fail> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Item not found.' };
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, error: 'Quantity: enter a whole number above 0.', field: 'quantity' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('quote_list_update', { p_item: id, p_quantity: quantity, p_notes: notes.slice(0, 1000) || null });
  if (error) return { ok: false, error: shopError(error) };
  return { ok: true, count: Number((data as { count: number }).count) };
}

export async function removeQuoteItem(id: string): Promise<{ ok: true; count: number } | Fail> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Item not found.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('quote_list_remove', { p_item: id });
  if (error) return { ok: false, error: shopError(error) };
  return { ok: true, count: Number((data as { count: number }).count) };
}

const ListSend = z.object({ country, city: z.string().trim().max(80), notes: z.string().trim().max(2000), idem });
export async function sendQuoteList(input: z.input<typeof ListSend>): Promise<{ ok: true; id: string; code: string; lines: number } | Fail> {
  const p = ListSend.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Please check the form.', field: String(p.error.issues[0]?.path[0] ?? '') };
  const sb = await createClient();
  const { data, error } = await sb.rpc('quote_list_submit', {
    p_destination_country: p.data.country, p_destination_city: p.data.city || null, p_notes: p.data.notes || null, p_idem: p.data.idem,
  });
  if (error) return { ok: false, error: shopError(error) };
  const d = data as { id: string; code: string; lines: number };
  return { ok: true, id: d.id, code: d.code, lines: d.lines };
}

const Rfq = z.object({
  productId: uuid, quantity: z.coerce.number().int('Quantity: enter a whole number.').positive('Quantity: enter a whole number above 0.'),
  targetPrice: money, country, city: z.string().trim().max(80), customisation: z.array(z.string().trim().max(60)).max(8),
  notes: z.string().trim().max(2000), idem,
});
export async function submitShopRfq(input: z.input<typeof Rfq>): Promise<{ ok: true; id: string; code: string } | Fail> {
  const p = Rfq.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Please check the form.', field: String(p.error.issues[0]?.path[0] ?? '') };
  const v = p.data;
  const sb = await createClient();
  const { data, error } = await sb.rpc('shop_submit_rfq', {
    p_product: v.productId, p_quantity: v.quantity, p_destination_country: v.country, p_destination_city: v.city || null,
    p_target_price_cents: v.targetPrice ? toCents(v.targetPrice) : null, p_customisation: v.customisation, p_notes: v.notes || null, p_idem: v.idem,
  });
  if (error) {
    const msg = shopError(error);
    return { ok: false, error: msg, field: /BELOW_MOQ|INVALID_QUANTITY/.test(error.message) ? 'quantity' : /SHIP_TO/.test(error.message) ? 'country' : undefined };
  }
  const d = data as { id: string; code: string };
  return { ok: true, id: d.id, code: d.code };
}

const Sample = z.object({
  productId: uuid, productTitle: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().int().min(1, 'Number of samples: 1 to 5.').max(5, 'Number of samples: 1 to 5.'),
  country, city: z.string().trim().max(80), notes: z.string().trim().max(2000), idem,
});
/** "Order a sample" → the existing sample service request (code SRV-<n>, sample fee from settings, charged in the RPC). */
export async function submitSample(input: z.input<typeof Sample>): Promise<{ ok: true; id: string; code: string | null } | Fail> {
  const p = Sample.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Please check the form.', field: String(p.error.issues[0]?.path[0] ?? '') };
  if (!(await signedIn())) return { ok: false, error: 'Please sign in again.' };
  if (!(await memberCanAct())) return { ok: false, error: shopError({ message: 'ROLE_NOT_ALLOWED' }) };
  const v = p.data;
  const sb = await createClient();
  const details = Object.fromEntries(Object.entries({
    product: v.productTitle, quantity: String(v.quantity), destination_country: v.country, destination_city: v.city, notes: v.notes, source: 'shop',
  }).filter(([, x]) => x !== ''));
  const { data: id, error } = await sb.rpc('request_service', { p_service: 'sample', p_details: details, p_product: v.productId, p_idem: `svc:${v.idem}` });
  if (error) return { ok: false, error: shopError(error) };
  const { data: row } = await sb.from('service_requests').select('code').eq('id', id as string).maybeSingle();
  return { ok: true, id: id as string, code: (row?.code as string | undefined) ?? null };
}

/** Recently viewed: called from the product page after it is shown (never during render or prefetch). */
export async function recordView(productId: string): Promise<void> {
  if (!uuid.safeParse(productId).success) return;
  const sb = await createClient();
  await sb.rpc('shop_record_view', { p_product: productId });
}
