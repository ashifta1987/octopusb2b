'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';

const FEATURES = ['dropship'] as const;
export type LaunchFeature = (typeof FEATURES)[number];

/**
 * "Notify me when it launches" (migration 203). Stored in launch_signups (staff-readable only), rate-limited per
 * network; a repeat sign-up for the same feature + e-mail is treated as success.
 */
const THANKS = 'Thanks. We will email you once when it launches.';

export async function subscribeLaunch(feature: LaunchFeature, email: string, source?: string, trap?: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!FEATURES.includes(feature)) return { ok: false, error: 'Unknown feature.' };
  // honeypot filled = a bot: answer like a success so it learns nothing, store nothing
  if (typeof trap === 'string' && trap.trim() !== '') return { ok: true, message: THANKS };
  const parsed = z.string().trim().toLowerCase().email().max(200).safeParse(email);
  if (!parsed.success) return { ok: false, error: 'Enter a valid email address.' };
  const src = typeof source === 'string' && /^[a-z0-9-]{1,40}$/.test(source) ? source : null;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null;
  const admin = createAdminClient();
  if (ip) {
    const { data } = await admin.rpc('auth_rate_hit', { p_bucket: `launch-signup:${ip}`, p_limit: 5, p_window_s: 3600 }).then((r) => r, () => ({ data: null }));
    const r = data as { allowed: boolean } | null;
    if (r && !r.allowed) return { ok: false, error: 'Too many sign-ups from your network. Try again in an hour.' };
  }
  const { error } = await admin.from('launch_signups').insert({ feature, email: parsed.data, source: src });
  if (error && error.code !== '23505') {
    console.error('launch signup failed', error.message);
    return { ok: false, error: 'Could not save your email. Please try again.' };
  }
  return { ok: true, message: THANKS };
}
