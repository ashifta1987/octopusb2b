'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';

/** ADDON-36 H3 — "Get notified when a pool opens" (rate-limited; duplicates are treated as success). */
export async function subscribePoolAlerts(email: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(email);
  if (!parsed.success) return { ok: false, error: 'Enter a valid email address.' };
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  const admin = createAdminClient();
  if (ip) {
    const { data } = await admin.rpc('auth_rate_hit', { p_bucket: `pool-alert:${ip}`, p_limit: 5, p_window_s: 3600 }).then((r) => r, () => ({ data: null }));
    const r = data as { allowed: boolean } | null;
    if (r && !r.allowed) return { ok: false, error: 'Too many sign-ups from your network. Try again in an hour.' };
  }
  const { error } = await admin.from('pool_alert_signups').insert({ email: parsed.data });
  if (error && error.code !== '23505') {
    console.error('pool alert signup failed', error.message);
    return { ok: false, error: 'Could not save your email. Please try again.' };
  }
  return { ok: true, message: 'Done. We will email you when the next pool opens.' };
}

