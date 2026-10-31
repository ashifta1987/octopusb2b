'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getRequestMeta } from '@/lib/staff/request-meta';
import { clearStaffSession, getStaffSecurity, isStaffUser, safeNext, staffAudit } from '@/lib/staff/server';
import { ipRuleBlocks } from '@/lib/staff/ip';
import { EXPIRED_COOKIE, verifyExpiredMarker } from '@/lib/staff/session-cookie';

export type SignInState = {
  error?: string;
  lockedUntil?: string | null;
  remaining?: number | null;
  notStaff?: boolean;
} | null;

const Creds = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), next: z.string().optional() });

type LockStatus = { locked: boolean; locked_until: string | null; failed: number };
type Failure = LockStatus & { just_locked: boolean; max: number };

/** Step 1 — email + password (SPEC §17.2). Lockout after 5 failures (auth_record_failure), staff only. */
export async function staffSignIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = Creds.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter your work email and password.' };
  const { email, password } = parsed.data;
  const next = safeNext(parsed.data.next, '/staff/workspace');
  const admin = createAdminClient();
  const meta = await getRequestMeta();

  const { data: lock } = await admin.rpc('auth_lock_status', { p_email: email });
  const ls = lock as LockStatus | null;
  if (ls?.locked) return { error: 'This account is locked after too many wrong attempts.', lockedUntil: ls.locked_until };

  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    const { data: f } = await admin.rpc('auth_record_failure', { p_email: email, p_kind: 'password', p_ip: meta.ip, p_ua: meta.ua });
    const fail = f as Failure | null;
    if (fail?.locked) return { error: 'Too many wrong attempts. The account is locked and Admin has been notified.', lockedUntil: fail.locked_until };
    const remaining = fail ? Math.max(0, fail.max - fail.failed) : null;
    return { error: 'Wrong email or password.', remaining };
  }

  const uid = data.user.id;
  if (!(await isStaffUser(uid))) {
    await sb.auth.signOut();
    return { error: 'This is the staff portal — use Customer login.', notStaff: true };
  }

  const sec = await getStaffSecurity();
  const { data: roles } = await admin.from('user_roles').select('role_code').eq('user_id', uid);
  if (ipRuleBlocks(sec, (roles ?? []).map((r) => r.role_code as string), meta.ip)) {
    await staffAudit(uid, 'auth.sign_in_failed', { method: 'password', reason: 'ip_not_allowed' });
    await sb.auth.signOut();
    return { error: 'Sign-in for your role is limited to office IP addresses. Connect from the office network or ask an Admin.' };
  }

  await admin.rpc('auth_record_success', { p_email: email });
  await staffAudit(uid, 'auth.sign_in', { method: 'password' });
  await clearStaffSession(); // a new sign-in starts a new staff session clock at /staff/verify
  redirect(`/staff/verify?next=${encodeURIComponent(next)}`);
}

/** The proxy cannot write the audit log; it leaves a signed marker and the login page records auth.session_expired. */
export async function recordSessionExpiry(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(EXPIRED_COOKIE)?.value;
  if (!raw) return;
  jar.delete(EXPIRED_COOKIE);
  const m = verifyExpiredMarker(raw);
  if (!m) return;
  await staffAudit(m.uid, 'auth.session_expired', { reason: m.reason });
}
