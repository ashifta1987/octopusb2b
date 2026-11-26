'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { rpcMessage } from '@/lib/dropship-ds6';

/**
 * Finance › SaaS billing (Release 5 · Step 12b) — server actions. The page needs finance:view; every RPC checks in the database
 * that the caller is a company-wide Finance approver or an admin on a 2FA session, and that the approver is not the proposer.
 */
export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  await requireStaff('finance', 'view', '/admin/finance/saas');
  const sb = await createClient();
  const { error } = await sb.rpc(fn, args);
  revalidatePath('/admin/finance/saas');
  if (error) return { ok: false, message: rpcMessage(error) };
  return { ok: true };
}

const Reason = z.string().trim().min(3, 'Enter the reason (at least 3 characters).').max(500);

export async function proposeSwitchAction(enable: boolean, startAt: string | null, reason: string): Promise<ActionResult> {
  const r = Reason.safeParse(reason);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? 'Enter the reason.' };
  if (startAt && Number.isNaN(Date.parse(startAt))) return { ok: false, message: 'Date: choose a valid date.' };
  return rpc('saas_switch_propose', { p_enable: enable, p_start_at: enable && startAt ? new Date(startAt).toISOString() : null, p_reason: r.data });
}

export async function decideSwitchAction(approve: boolean, note: string): Promise<ActionResult> {
  return rpc('saas_switch_decide', { p_approve: approve, p_note: note.trim().slice(0, 500) || null });
}

export async function withdrawSwitchAction(): Promise<ActionResult> {
  return rpc('saas_switch_withdraw', {});
}

export async function setOverrideAction(orgId: string, kind: 'free_forever' | 'extra_trial', extraDays: number | null, reason: string): Promise<ActionResult> {
  const o = z.string().uuid().safeParse(orgId);
  if (!o.success) return { ok: false, message: 'Choose a merchant.' };
  const r = Reason.safeParse(reason);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? 'Enter the reason.' };
  if (kind === 'extra_trial' && (!extraDays || extraDays < 1 || extraDays > 365)) return { ok: false, message: 'Extra trial days: 1 to 365.' };
  return rpc('saas_override_set', { p_org: o.data, p_kind: kind, p_extra_days: kind === 'extra_trial' ? extraDays : null, p_reason: r.data });
}

export async function removeOverrideAction(orgId: string, reason: string): Promise<ActionResult> {
  const o = z.string().uuid().safeParse(orgId);
  const r = Reason.safeParse(reason);
  if (!o.success || !r.success) return { ok: false, message: 'Enter the reason for removing the override.' };
  return rpc('saas_override_remove', { p_org: o.data, p_reason: r.data });
}

const Plan = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Plan code: lowercase letters, numbers and _ (2 to 40).'),
  name: z.string().trim().min(1, 'Enter the plan name.').max(60),
  description: z.string().max(300).optional(),
  price_cents: z.number().int().positive().max(10000000).nullable(),
  live_products_limit: z.number().int().positive().nullable(),
  stores_limit: z.number().int().positive().nullable(),
  orders_month_limit: z.number().int().positive().nullable(),
  features: z.array(z.enum(['import_push', 'order_sync', 'auto_sync', 'priority_handling', 'branded_packaging'])),
  sort_order: z.number().int().min(0).max(1000),
  active: z.boolean(),
});

export async function proposePlanAction(input: z.input<typeof Plan>, reason: string): Promise<ActionResult> {
  const p = Plan.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the plan.' };
  const r = Reason.safeParse(reason);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? 'Enter the reason.' };
  const { code, ...values } = p.data;
  return rpc('ds_plan_propose', { p_code: code, p_values: values, p_reason: r.data });
}

export async function decidePlanAction(changeId: string, approve: boolean, note: string): Promise<ActionResult> {
  const c = z.string().uuid().safeParse(changeId);
  if (!c.success) return { ok: false, message: 'This proposal was not found.' };
  return rpc('ds_plan_decide', { p_change: c.data, p_approve: approve, p_note: note.trim().slice(0, 500) || null });
}
