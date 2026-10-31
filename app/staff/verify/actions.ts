'use server';
import { redirect } from 'next/navigation';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getRequestMeta } from '@/lib/staff/request-meta';
import { currentClaims, isStaffUser, issueBackupCodes, safeNext, startStaffSession, staffAudit, clearStaffSession } from '@/lib/staff/server';
import { hashBackupCode, normaliseBackupCode } from '@/lib/staff/backup-codes';

type Failure = { locked: boolean; locked_until: string | null; failed: number; just_locked: boolean; max: number };
export type FailResult = { locked: boolean; lockedUntil: string | null; remaining: number | null };

async function recordFailure(email: string, kind: 'totp' | 'backup_code'): Promise<FailResult> {
  const meta = await getRequestMeta();
  const { data } = await createAdminClient().rpc('auth_record_failure', { p_email: email, p_kind: kind, p_ip: meta.ip, p_ua: meta.ua });
  const f = data as Failure | null;
  if (f?.locked) {
    // locked: end the half-signed-in session so the next try starts again at step 1
    const sb = await createClient();
    await sb.auth.signOut();
    await clearStaffSession();
  }
  return { locked: !!f?.locked, lockedUntil: f?.locked_until ?? null, remaining: f ? Math.max(0, f.max - f.failed) : null };
}

/** A wrong 6-digit code (client MFA verify failed) → lockout counter (5 → locked 15 min, Admin notified). */
export async function recordTotpFailure(): Promise<FailResult> {
  const c = await currentClaims();
  if (!c?.email) return { locked: false, lockedUntil: null, remaining: null };
  return recordFailure(c.email, 'totp');
}

/** Called after the browser MFA verify upgraded the session to aal2: start the staff session clock, audit, go on. */
export async function completeVerification(input: { trusted: boolean; next: string; stepUp: boolean }): Promise<{ error: string } | void> {
  const c = await currentClaims();
  if (!c) redirect('/staff/login');
  if (c.aal !== 'aal2') return { error: 'The code was not accepted. Try again.' };
  if (!(await isStaffUser(c.uid))) redirect('/login');
  if (c.email) await createAdminClient().rpc('auth_record_success', { p_email: c.email });
  await startStaffSession(c.uid, !!input.trusted);
  await staffAudit(c.uid, 'auth.2fa_verified', { step_up: !!input.stepUp, trusted: !!input.trusted });
  redirect(safeNext(input.next, '/staff/workspace'));
}

/**
 * First enrolment finished (session is aal2): issue 10 backup codes (shown once) and audit. Sets no cookies on purpose
 * (a cookie write would re-render /staff/verify and skip the codes); the client then calls completeVerification.
 */
export async function finishEnrolment(input: { trusted: boolean }): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const c = await currentClaims();
  if (!c) return { ok: false, error: 'Your session ended. Sign in again.' };
  if (c.aal !== 'aal2') return { ok: false, error: 'Verify the code from your authenticator app first.' };
  if (!(await isStaffUser(c.uid))) return { ok: false, error: 'This is the staff portal — use Customer login.' };
  const codes = await issueBackupCodes(c.uid);
  if (c.email) await createAdminClient().rpc('auth_record_success', { p_email: c.email });
  await staffAudit(c.uid, 'auth.2fa_enrolled', { backup_codes: codes.length, trusted: !!input.trusted });
  return { ok: true, codes };
}

/**
 * "Use a backup code" (lost phone): a valid unused code is burned, the user's TOTP factors are removed and they enrol
 * a new authenticator straight away (which issues a fresh set of backup codes).
 */
export async function redeemBackupCode(code: string): Promise<{ ok: true } | ({ ok: false; error: string } & Partial<FailResult>)> {
  const c = await currentClaims();
  if (!c?.email) return { ok: false, error: 'Your session ended. Sign in again.' };
  if (normaliseBackupCode(code).length !== 8) return { ok: false, error: 'Backup codes have 8 letters and numbers, like K7QX-M2PA.' };
  const admin = createAdminClient();
  const { data: lock } = await admin.rpc('auth_lock_status', { p_email: c.email });
  if ((lock as { locked?: boolean } | null)?.locked) return { ok: false, error: 'This account is locked after too many wrong attempts.', locked: true, lockedUntil: (lock as { locked_until: string }).locked_until };

  const { data: row } = await admin.from('staff_backup_codes').select('id').eq('user_id', c.uid).eq('code_hash', hashBackupCode(code)).is('used_at', null).maybeSingle();
  if (!row) {
    const f = await recordFailure(c.email, 'backup_code');
    return { ok: false, error: f.locked ? 'Too many wrong attempts. The account is locked and Admin has been notified.' : 'That backup code is not valid or was already used.', ...f };
  }
  const upd = await admin.from('staff_backup_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id');
  if (upd.error || !upd.data?.length) return { ok: false, error: 'That backup code is not valid or was already used.' };

  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: c.uid });
  for (const f of factors?.factors ?? []) {
    if (f.factor_type === 'totp') await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: c.uid });
  }
  await admin.rpc('auth_record_success', { p_email: c.email });
  await staffAudit(c.uid, 'auth.backup_code_used', { factors_removed: (factors?.factors ?? []).filter((f) => f.factor_type === 'totp').length });
  return { ok: true };
}
