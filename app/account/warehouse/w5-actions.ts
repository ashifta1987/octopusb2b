'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cleanDbError } from '@/lib/warehouse-inbound';
import { DECISIONS, SUPPORT_KINDS, refKind, type Decision, type SupportKind } from '@/lib/warehouse-w5';

/**
 * Warehouse OS · W5 client portal actions (Inventory photo, Returns decision, Support request). The company is always the
 * signed-in person's own; every rule (own company, own products / returns / orders, steps) is enforced by the wh_* functions.
 */
export type W5Result = { ok: boolean; message?: string; error?: string; id?: string; code?: string };
const PATH = '/account/warehouse';
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

export async function setSkuPhotoAction(skuId: string, path: string): Promise<W5Result> {
  await requireCustomer(PATH);
  if (!uuid(skuId) || typeof path !== 'string' || path.length > 200) return { ok: false, error: 'Choose the product again.' };
  const sb = await createClient();
  const { error } = await sb.rpc('wh_set_sku_image', { p_sku: skuId, p_path: path });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  revalidatePath(PATH);
  return { ok: true, message: 'Photo saved.' };
}

export async function decideReturnAction(f: {
  returnId: string; decision: Decision;
  ship?: { name: string; phone: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string } | null;
}): Promise<W5Result> {
  await requireCustomer(PATH);
  if (!uuid(f.returnId)) return { ok: false, error: 'Return not found. Reload the page.' };
  if (!DECISIONS.includes(f.decision)) return { ok: false, error: 'Choose restock, discard or send back.' };
  const ship = f.decision === 'send_back' && f.ship
    ? { ...f.ship, country: f.ship.country.trim().toUpperCase() }
    : null;
  if (f.decision === 'send_back' && !ship) return { ok: false, error: 'Enter the address to send the units to.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_return_decide', { p_return: f.returnId, p_decision: f.decision, p_ship: ship });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  const d = data as { code: string; decision: Decision };
  revalidatePath(PATH);
  return {
    ok: true, code: d.code,
    message: d.decision === 'restock' ? `${d.code}: restock chosen. The warehouse puts the good units back into your stock.`
      : d.decision === 'discard' ? `${d.code}: discard chosen. The warehouse disposes of the units.`
        : `${d.code}: send back chosen. The warehouse packs the units and ships them to you.`,
  };
}

export async function createSupportRequestAction(f: {
  kind: SupportKind; subject: string; body: string; ref: string; attachments: { path: string; name: string }[];
}): Promise<W5Result> {
  const s = await requireCustomer(PATH);
  if (!s.org) return { ok: false, error: 'Your account is not linked to a company.' };
  if (!SUPPORT_KINDS.includes(f.kind)) return { ok: false, error: 'Choose the type of request.' };
  const subject = (f.subject ?? '').trim();
  const body = (f.body ?? '').trim();
  const ref = (f.ref ?? '').trim().toUpperCase();
  if (subject.length < 3 || subject.length > 200) return { ok: false, error: 'Enter a short subject (3 to 200 characters).' };
  if (body.length < 5 || body.length > 10000) return { ok: false, error: 'Describe the problem or question (at least 5 characters).' };
  if (ref && !refKind(ref)) return { ok: false, error: 'Choose one of your orders, stock notices or returns, or none.' };
  const atts = Array.isArray(f.attachments) ? f.attachments.slice(0, 10) : [];
  if (atts.some((a) => typeof a?.path !== 'string' || !a.path.startsWith(`${s.org!.id}/`) || a.path.includes('..') || typeof a.name !== 'string')) {
    return { ok: false, error: 'Invalid attachment.' };
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_create_support_request', {
    p_org: s.org.id, p_kind: f.kind, p_subject: subject, p_body: body, p_ref: ref || null,
    p_attachments: atts.map((a) => ({ path: a.path, name: a.name.slice(0, 300) })),
  });
  if (error) return { ok: false, error: cleanDbError(error.message) };
  const d = data as { id: string; code: string };
  revalidatePath(PATH);
  revalidatePath('/account/support');
  return { ok: true, id: d.id, code: d.code, message: `Request ${d.code} sent. Our team replies within 1 business day.` };
}
