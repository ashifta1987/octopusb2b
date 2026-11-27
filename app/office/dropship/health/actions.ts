'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { rpcMessage } from '@/lib/dropship-ds6';

/**
 * Staff › System health (Release 5 · Step 13) — Retry (re-queues the same job with its idempotency key), stop a job
 * (dead letter, with a reason) and "Notify merchant" for a store whose access must be renewed. The database allows these only
 * to Dropship editors and admins; Finance and Support read the page only.
 */
export type ActionResult = { ok: true } | { ok: false; message: string };
const Kind = z.enum(['domain_event', 'outbox', 'push_job']);

async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  await requireDropshipV2Staff(false, '/office/dropship/health');
  const sb = await createClient();
  const { error } = await sb.rpc(fn, args);
  revalidatePath('/office/dropship/health');
  return error ? { ok: false, message: rpcMessage(error) } : { ok: true };
}

export async function retryJobAction(kind: string, id: string): Promise<ActionResult> {
  const k = Kind.safeParse(kind);
  const i = z.string().uuid().safeParse(id);
  if (!k.success || !i.success) return { ok: false, message: 'This job was not found.' };
  return rpc('ds_health_retry', { p_kind: k.data, p_id: i.data });
}

export async function stopJobAction(kind: string, id: string, reason: string): Promise<ActionResult> {
  const k = z.enum(['domain_event', 'outbox']).safeParse(kind);
  const i = z.string().uuid().safeParse(id);
  if (!k.success || !i.success) return { ok: false, message: 'This job was not found.' };
  if (reason.trim().length < 3) return { ok: false, message: 'Say why this job should stop.' };
  return rpc('ds_health_dead_letter', { p_kind: k.data, p_id: i.data, p_reason: reason.trim().slice(0, 300) });
}

export async function notifyMerchantAction(connectionId: string): Promise<ActionResult> {
  const i = z.string().uuid().safeParse(connectionId);
  if (!i.success) return { ok: false, message: 'This store was not found.' };
  return rpc('ds_health_notify_merchant', { p_connection: i.data });
}

/** C0 · carrier → store tracking company name (Dropship editors and admins; checked again by c0_tracking_name_save). */
export async function saveTrackingNameAction(f: { carrier: string; platform: string; company: string; url: string }): Promise<ActionResult> {
  const p = z.object({
    carrier: z.enum(['yunexpress', '4px']),
    platform: z.string().regex(/^[a-z_]{2,20}$/),
    company: z.string().trim().max(80),
    url: z.string().trim().max(300),
  }).safeParse(f);
  if (!p.success) return { ok: false, message: 'Check the name and the link.' };
  if (p.data.url && !/^https:\/\/\S+$/.test(p.data.url)) return { ok: false, message: 'The tracking link must start with https://.' };
  if (p.data.url && !p.data.url.includes('{tracking}')) return { ok: false, message: 'The tracking link must contain {tracking} where the number goes.' };
  return rpc('c0_tracking_name_save', {
    p_carrier: p.data.carrier, p_platform: p.data.platform, p_company: p.data.company || null, p_url_template: p.data.url || null,
    p_use_branded_link: !p.data.url, p_note: null,
  });
}
