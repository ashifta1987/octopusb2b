'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { mapDbError } from '@/lib/format';
import { generateApiKey } from '@/lib/api/keys';
import type { ActionResult } from '@/components/account/data';
import { API_SCOPES, WEBHOOK_EVENTS } from '@/components/account/dev-constants';

const PATH = '/account/developer';

async function ctx() {
  const s = await getSession();
  if (!s) return { error: 'Please sign in again.' } as const;
  if (!s.org) return { error: 'Please complete your company profile first.' } as const;
  return { s, org: s.org, sb: await createClient() } as const;
}

const Scopes = z.array(z.enum(API_SCOPES)).min(1, 'Choose at least one scope.');

/* ───────── API apps (api_clients) ───────── */

export async function createApp(input: { name: string; scopes: string[] }): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const parsed = z.object({ name: z.string().trim().min(2, 'App name is too short.').max(80), scopes: Scopes }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { error } = await c.sb.from('api_clients').insert({
    org_id: c.org.id, name: parsed.data.name, scopes: parsed.data.scopes, created_by: c.s.userId,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateScopes(appId: string, scopes: string[]): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const parsed = Scopes.safeParse(scopes);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid scopes' };
  const { data, error } = await c.sb.from('api_clients').update({ scopes: parsed.data })
    .eq('id', appId).eq('org_id', c.org.id).is('revoked_at', null).select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'App not found.' };
  revalidatePath(PATH);
  return { ok: true };
}

export async function revokeApp(appId: string): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const now = new Date().toISOString();
  const { data, error } = await c.sb.from('api_clients').update({ revoked_at: now })
    .eq('id', appId).eq('org_id', c.org.id).is('revoked_at', null).select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'App not found or already revoked.' };
  // Revoke every key of the app as well (RLS apik_upd allows own org).
  await c.sb.from('api_keys').update({ revoked_at: now }).eq('client_id', appId).eq('org_id', c.org.id).is('revoked_at', null);
  revalidatePath(PATH);
  return { ok: true };
}

/* ───────── API keys (secret shown once) ───────── */

export async function createKey(appId: string, mode: 'test' | 'live'): Promise<ActionResult<{ key: string; prefix: string; mode: 'test' | 'live' }>> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  if (mode !== 'test' && mode !== 'live') return { ok: false, error: 'Invalid mode.' };

  // Ownership check with the user's client (RLS) before using the service role.
  const { data: app } = await c.sb.from('api_clients').select('id, org_id, revoked_at').eq('id', appId).eq('org_id', c.org.id).maybeSingle();
  if (!app || app.org_id !== c.org.id) return { ok: false, error: 'App not found.' };
  if (app.revoked_at) return { ok: false, error: 'This app is revoked.' };

  if (mode === 'live') {
    // KYC is read from the DB, never trusted from the client.
    const { data: org } = await c.sb.from('organizations').select('kyc_status').eq('id', c.org.id).maybeSingle();
    if (org?.kyc_status !== 'verified') return { ok: false, error: 'Live keys unlock after your KYC is verified.' };
  }

  const k = generateApiKey(mode);
  const admin = createAdminClient();
  const { error } = await admin.from('api_keys').insert({
    client_id: app.id, org_id: c.org.id, mode, prefix: k.key.slice(0, 12), key_hash: k.hash,
  });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(PATH);
  return { ok: true, data: { key: k.key, prefix: k.key.slice(0, 12), mode } };
}

export async function revokeKey(keyId: string): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const { data, error } = await c.sb.from('api_keys').update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId).eq('org_id', c.org.id).is('revoked_at', null).select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'Key not found or already revoked.' };
  revalidatePath(PATH);
  return { ok: true };
}

/* ───────── Webhook endpoints ───────── */

const WebhookInput = z.object({
  url: z.string().trim().url('Enter a valid URL.').max(500).refine((u) => u.startsWith('https://'), 'Webhook URLs must use https://'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event.'),
});

export async function createWebhook(input: { url: string; events: string[] }): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const parsed = WebhookInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  const { error } = await c.sb.from('webhook_endpoints').insert({ org_id: c.org.id, url: parsed.data.url, events: parsed.data.events, active: true });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath(PATH);
  return { ok: true };
}

export async function setWebhookActive(id: string, active: boolean): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const { data, error } = await c.sb.from('webhook_endpoints').update({ active: !!active }).eq('id', id).eq('org_id', c.org.id).select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'Webhook not found.' };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteWebhook(id: string): Promise<ActionResult> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const { data, error } = await c.sb.from('webhook_endpoints').delete().eq('id', id).eq('org_id', c.org.id).select('id');
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data?.length) return { ok: false, error: 'Webhook not found.' };
  revalidatePath(PATH);
  return { ok: true };
}

/** The signing secret is only sent to the browser on explicit reveal. */
export async function revealWebhookSecret(id: string): Promise<ActionResult<{ secret: string }>> {
  const c = await ctx();
  if ('error' in c) return { ok: false, error: c.error! };
  const { data } = await c.sb.from('webhook_endpoints').select('secret').eq('id', id).eq('org_id', c.org.id).maybeSingle();
  if (!data) return { ok: false, error: 'Webhook not found.' };
  return { ok: true, data: { secret: data.secret as string } };
}
