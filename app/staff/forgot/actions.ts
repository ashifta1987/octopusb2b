'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient, createPublicClient } from '@/lib/supabase/server';
import { emailIsStaff, staffAudit } from '@/lib/staff/server';

export type ForgotState = { sent: boolean; error?: string } | null;

async function siteOrigin() {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (env) return env;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

/** Forgot password (SPEC §17.3 "Reset"): always the same neutral answer; only staff emails get a link. */
export async function requestStaffReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get('email'));
  if (!parsed.success) return { sent: false, error: 'Enter your work email.' };
  const email = parsed.data;
  try {
    if (await emailIsStaff(email)) {
      // implicit-flow client: the link works from any device/browser (no PKCE verifier cookie needed)
      await createPublicClient().auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/staff/set-password?type=recovery` });
      const { data: prof } = await createAdminClient().from('profiles').select('id').ilike('email', email).limit(1).maybeSingle();
      await staffAudit((prof?.id as string | undefined) ?? null, 'auth.password_reset_requested', { email });
    }
  } catch {
    // neutral response regardless
  }
  return { sent: true };
}
