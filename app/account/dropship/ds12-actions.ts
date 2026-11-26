'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requireCustomer } from '@/lib/auth';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';

/**
 * Octopus Dropship · Release 5 · Steps 12 / 13 — merchant server actions (Plan and billing, Settings, invitations). Every
 * action checks the merchant (requireDropshipV2Merchant(featurePath) also redirects when the feature is switched off), then
 * calls ONE SECURITY DEFINER RPC that checks again in the database: own organisation, team role (owner / manager / support),
 * paused / closed rules, feature list. Answers { ok, message } so the page shows the reason next to the control.
 */

export type ActionResult<T = Record<string, unknown>> = { ok: true; data: T; message?: string } | { ok: false; message: string; code?: string };

async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const sb = await createClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { ok: false, message: rpcMessage(error), code: error.message.split(':')[0].trim() };
  return { ok: true, data: data as T };
}

const Uuid = z.string().uuid();

// ───────── Plan and billing ─────────
export async function choosePlanAction(code: string): Promise<ActionResult<{ plan_name: string; status: string; charge: { ok: boolean; invoice_number?: string; message?: string } | null }>> {
  await requireDropshipV2Merchant('/account/dropship/billing');
  const p = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).safeParse(code);
  if (!p.success) return { ok: false, message: 'This plan is not available.' };
  const r = await rpc<{ plan_name: string; status: string; charge: { ok: boolean; invoice_number?: string; message?: string } | null }>('ds_billing_choose_plan', { p_code: p.data });
  revalidatePath('/account/dropship/billing');
  revalidatePath('/account/dropship');
  return r;
}

// ───────── Settings ─────────
const SettingsInput = z.object({
  time_zone: z.string().trim().min(1).max(64),
  returns_policy: z.string().max(1000, 'Returns policy: up to 1,000 characters.').optional().or(z.literal('')),
  support_email: z.string().trim().max(200).email('Support email: enter an address like help@yourstore.com.').optional().or(z.literal('')),
  show_logo_slip: z.boolean(),
  show_logo_tracking: z.boolean(),
});

export async function saveSettingsAction(input: z.input<typeof SettingsInput>): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const p = SettingsInput.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the form.' };
  const r = await rpc('ds_settings_save', { p: { ...p.data, display_currency: 'USD' } });
  revalidatePath('/account/dropship/settings');
  return r;
}

const Prefs = z.array(z.object({
  event: z.enum(['new_order', 'awaiting_payment', 'on_hold', 'wallet_low', 'out_of_stock', 'cost_changed', 'push_failed', 'store_reconnect']),
  email: z.boolean(),
  in_app: z.boolean(),
})).max(20);

export async function savePrefsAction(prefs: z.input<typeof Prefs>): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const p = Prefs.safeParse(prefs);
  if (!p.success) return { ok: false, message: 'Check the notification choices.' };
  const r = await rpc('ds_notification_prefs_save', { p_prefs: p.data });
  revalidatePath('/account/dropship/settings');
  return r;
}

const LOGO_TYPES: Record<string, 'png' | 'jpg' | 'webp'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Logo: PNG / JPG / WEBP up to 1 MB, stored in the private bucket under a random name (never the merchant's file name). */
export async function uploadLogoAction(form: FormData): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const file = form.get('logo');
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'Logo: choose a PNG, JPG or WEBP file.' };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { ok: false, message: 'Logo: use a PNG, JPG or WEBP file.' };
  if (file.size > 1024 * 1024) return { ok: false, message: 'Logo: the file is larger than 1 MB.' };
  const path = `logos/${randomBytes(16).toString('hex')}.${ext}`;
  // the role check happens in the database first, before anything is stored
  const pre = await rpc('ds_settings_page', {});
  if (!pre.ok) return pre;
  const role = (pre.data as { my_role?: string }).my_role;
  if (role !== 'owner' && role !== 'manager') return { ok: false, message: 'Your team role can\u2019t change branding. Ask the account owner.' };
  const admin = createAdminClient();
  const up = await admin.storage.from('dropship-branding').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (up.error) return { ok: false, message: 'The logo could not be uploaded. Try again.' };
  const r = await rpc('ds_branding_set_logo', { p_path: path });
  if (!r.ok) await admin.storage.from('dropship-branding').remove([path]);
  revalidatePath('/account/dropship/settings');
  return r;
}

export async function removeLogoAction(): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const r = await rpc('ds_branding_set_logo', { p_path: null });
  revalidatePath('/account/dropship/settings');
  return r;
}

export async function setRoleAction(userId: string, role: 'owner' | 'manager' | 'support'): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const u = Uuid.safeParse(userId);
  const r0 = z.enum(['owner', 'manager', 'support']).safeParse(role);
  if (!u.success || !r0.success) return { ok: false, message: 'Choose Owner, Manager or Support.' };
  const r = await rpc('ds_team_set_role', { p_user: u.data, p_role: r0.data });
  revalidatePath('/account/dropship/settings');
  return r;
}

export async function removeMemberAction(userId: string): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const u = Uuid.safeParse(userId);
  if (!u.success) return { ok: false, message: 'This person is not in your team.' };
  const r = await rpc('ds_team_remove', { p_user: u.data });
  revalidatePath('/account/dropship/settings');
  return r;
}

export async function inviteAction(email: string, role: 'manager' | 'support'): Promise<ActionResult<{ invite_id: string }>> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const e = z.string().trim().toLowerCase().email('Email: enter an address like name@company.com.').max(200).safeParse(email);
  if (!e.success) return { ok: false, message: e.error.issues[0]?.message ?? 'Email: enter an address like name@company.com.' };
  const r0 = z.enum(['manager', 'support']).safeParse(role);
  if (!r0.success) return { ok: false, message: 'Choose Manager or Support.' };
  const r = await rpc<{ invite_id: string }>('ds_team_invite', { p_email: e.data, p_role: r0.data });
  revalidatePath('/account/dropship/settings');
  return r;
}

export async function cancelInviteAction(id: string): Promise<ActionResult> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const u = Uuid.safeParse(id);
  if (!u.success) return { ok: false, message: 'This invitation was not found.' };
  const r = await rpc('ds_team_invite_cancel', { p_id: u.data });
  revalidatePath('/account/dropship/settings');
  return r;
}

/** Accepting an invitation: the invited person is not a team member yet, so only a customer session is required. */
export async function acceptInviteAction(id: string): Promise<ActionResult> {
  await requireCustomer('/account/dropship/join');
  const u = Uuid.safeParse(id);
  if (!u.success) return { ok: false, message: 'This invitation is not valid for your sign-in.' };
  const r = await rpc('ds_team_invite_accept', { p_id: u.data });
  revalidatePath('/account/dropship');
  return r;
}

export async function closeDropshippingAction(confirm: string): Promise<ActionResult<{ open_orders: number; stores_disconnected: number; pushes_cancelled: number }>> {
  await requireDropshipV2Merchant('/account/dropship/settings');
  const r = await rpc<{ open_orders: number; stores_disconnected: number; pushes_cancelled: number }>('ds_close_dropshipping', { p_confirm: String(confirm ?? '').slice(0, 20) });
  revalidatePath('/account/dropship');
  revalidatePath('/account/dropship/settings');
  return r;
}
