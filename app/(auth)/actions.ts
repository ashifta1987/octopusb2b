'use server';
import { onboardingHref } from '@/lib/signup-service';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient, createClient, createPublicClient } from '@/lib/supabase/server';
import { getRequestMeta } from '@/lib/staff/request-meta';
import { emailIsStaff, isStaffUser } from '@/lib/staff/server';
import { checkCustomerSignupEmail } from '@/lib/staff/customer-guard';
import { getEmail } from '@/lib/adapters';

/**
 * Customer authentication (SPEC §4.1, ADDON-22): email + password only — no Google / social sign-in.
 * Server-side so every attempt is rate-limited per IP, counted for the 5-strikes lockout and written to audit_log
 * with the user id and IP.
 */

export type AuthResult =
  | { ok: true; redirect?: string; verify?: boolean }
  | { ok: false; error: string; lockedUntil?: string | null; remaining?: number | null };

const Email = z.string().trim().toLowerCase().email().max(254);
const LOGIN_LIMIT = 10;          // attempts per IP per minute (ADDON-22)
const PASSWORD_RULE = (p: string) => p.length >= 8 && /\d/.test(p);

type LockStatus = { locked: boolean; locked_until: string | null; failed: number };
type Failure = LockStatus & { just_locked: boolean; max: number };

async function siteOrigin() {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (env) return env;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

const safeNext = (n: unknown, fallback = '/account') => {
  const s = typeof n === 'string' ? n : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : fallback;
};

/** 10 attempts per IP per minute on the given endpoint. Fails open if the limiter itself is unavailable. */
async function rateLimited(endpoint: string, ip: string | null): Promise<string | null> {
  if (!ip) return null;
  try {
    const { data } = await createAdminClient().rpc('auth_rate_hit', { p_bucket: `${endpoint}:${ip}`, p_limit: LOGIN_LIMIT, p_window_s: 60 });
    const r = data as { allowed: boolean; retry_after_s: number } | null;
    if (r && !r.allowed) return `Too many attempts from your network. Wait ${Math.max(r.retry_after_s, 1)} seconds and try again.`;
  } catch {
    // limiter unavailable → do not block sign-in
  }
  return null;
}

async function audit(uid: string | null, action: string, meta: { ip: string | null; ua: string | null }, details: Record<string, unknown>) {
  if (!uid) return;
  try {
    await createAdminClient().rpc('auth_audit', { p_user: uid, p_action: action, p_ip: meta.ip, p_ua: meta.ua, p_details: details });
  } catch {
    // audit must never block the user flow
  }
}

async function userIdByEmail(email: string): Promise<string | null> {
  const { data } = await createAdminClient().from('profiles').select('id').ilike('email', email).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Lockout alert to the account owner, with the IP of the last attempt (ADDON-22). */
async function sendLockoutAlert(email: string, ip: string | null, minutes: number) {
  try {
    const origin = await siteOrigin();
    await getEmail().send({
      to: email,
      subject: 'Your Octopus B2B account was locked',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0b1b3f">
  <h2 style="font-size:18px">Account locked for ${minutes} minutes</h2>
  <p>There were 5 wrong password attempts on your account${ip ? ` from IP address <b>${ip.replace(/[<>&"]/g, '')}</b>` : ''}. We locked sign-in for ${minutes} minutes to protect it.</p>
  <p>If this wasn't you, reset your password once the lock ends: <a href="${origin}/forgot">${origin}/forgot</a></p>
</div>`,
    }, { template: 'auth.lockout' });
  } catch {
    // e-mail failure must not change the sign-in answer
  }
}

/** Sign in with email + password. */
export async function customerSignIn(input: { email: string; password: string; next?: string }): Promise<AuthResult> {
  const e = Email.safeParse(input.email);
  if (!e.success || !input.password) return { ok: false, error: 'Enter your email and password.' };
  const email = e.data;
  const meta = await getRequestMeta();
  const limited = await rateLimited('login', meta.ip);
  if (limited) return { ok: false, error: limited };

  const admin = createAdminClient();
  const { data: lock } = await admin.rpc('auth_lock_status', { p_email: email });
  const ls = lock as LockStatus | null;
  if (ls?.locked) return { ok: false, error: 'This account is locked after too many wrong attempts.', lockedUntil: ls.locked_until };

  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password: input.password.slice(0, 200) });
  if (error || !data.user) {
    if (error && /not confirmed/i.test(error.message)) {
      return { ok: false, error: 'Confirm your email first — use the 6-digit code or the link we sent you.' };
    }
    const { data: f } = await admin.rpc('auth_record_failure', { p_email: email, p_kind: 'password', p_ip: meta.ip, p_ua: meta.ua });
    const fail = f as Failure | null;
    if (fail?.locked) {
      const { data: sec } = await admin.from('site_settings').select('value').eq('key', 'staff_security').maybeSingle();
      const minutes = Number((sec?.value as { lockout_minutes?: number } | null)?.lockout_minutes ?? 15);
      if (fail.just_locked && (await userIdByEmail(email))) await sendLockoutAlert(email, meta.ip, minutes);
      return { ok: false, error: `Too many wrong attempts. The account is locked for ${minutes} minutes and we emailed the account owner.`, lockedUntil: fail.locked_until };
    }
    const remaining = fail ? Math.max(0, fail.max - fail.failed) : null;
    return { ok: false, error: 'Wrong email or password.', remaining };
  }

  const uid = data.user.id;
  await admin.rpc('auth_record_success', { p_email: email });
  // staff who used the customer form continue in the staff flow (SPEC §17: staff ≠ customer)
  if (await isStaffUser(uid).catch(() => false)) {
    await audit(uid, 'auth.sign_in', meta, { method: 'password', provider: 'email', portal: 'customer_form' });
    return { ok: true, redirect: '/staff/verify' };
  }
  await audit(uid, 'auth.sign_in', meta, { method: 'password', provider: 'email', portal: 'customer' });
  return { ok: true, redirect: safeNext(input.next) };
}

/** Sign up with email + password → 6-digit code by email → profile. */
export async function customerSignUp(input: { email: string; password: string; next?: string }): Promise<AuthResult> {
  const e = Email.safeParse(input.email);
  if (!e.success) return { ok: false, error: 'Enter a valid email address.' };
  if (!PASSWORD_RULE(input.password ?? '')) return { ok: false, error: 'Password needs at least 8 characters, with a number.' };
  const email = e.data;
  const meta = await getRequestMeta();
  const limited = await rateLimited('signup', meta.ip);
  if (limited) return { ok: false, error: limited };
  const guard = await checkCustomerSignupEmail(email);
  if (!guard.ok) return { ok: false, error: guard.error };

  const sb = await createClient();
  const next = safeNext(input.next);
  const { data, error } = await sb.auth.signUp({
    email, password: input.password.slice(0, 200),
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { ok: false, error: error.message };
  await audit(data.user?.id ?? null, 'auth.sign_up', meta, { method: 'password', provider: 'email' });
  if (data.session) return { ok: true, redirect: onboardingHref(next) };
  return { ok: true, verify: true };
}

export type ResetState = { sent: boolean; error?: string } | null;

/** Forgot password: always the same neutral answer; only existing customer accounts get a one-time link. */
export async function requestCustomerReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const e = Email.safeParse(formData.get('email'));
  if (!e.success) return { sent: false, error: 'Enter your email address.' };
  const email = e.data;
  const meta = await getRequestMeta();
  const limited = await rateLimited('reset', meta.ip);
  if (limited) return { sent: false, error: limited };
  try {
    const uid = await userIdByEmail(email);
    if (uid && !(await emailIsStaff(email))) {
      // implicit-flow client: the link works from any device/browser; Supabase links are single-use and expire
      // after the project's email OTP expiry (1 hour).
      await createPublicClient().auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/reset-password?type=recovery` });
      await audit(uid, 'auth.password_reset_requested', meta, { provider: 'email' });
    }
  } catch {
    // neutral response regardless
  }
  return { sent: true };
}

/** After the new password was saved from the reset link: audit it and end every OTHER session (ADDON-22). */
export async function afterCustomerPasswordReset(): Promise<{ next: string }> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  const uid = (data?.claims?.sub as string | undefined) ?? null;
  if (!uid) return { next: '/login' };
  const meta = await getRequestMeta();
  await sb.auth.signOut({ scope: 'others' }).catch(() => null);
  await audit(uid, 'auth.password_reset', meta, { provider: 'email', other_sessions: 'revoked' });
  if (await isStaffUser(uid).catch(() => false)) return { next: '/staff/verify' };
  return { next: '/account' };
}
