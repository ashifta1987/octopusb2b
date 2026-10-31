'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapDbError } from '@/lib/format';
import { clearStaffSession, currentClaims, issueBackupCodes, staffAudit } from '@/lib/staff/server';
import { passwordProblem } from '@/lib/staff/password';
import { isStepUpError } from '@/lib/staff/step-up';

export type Result = { ok: true; message?: string } | { ok: false; error: string; stepUp?: boolean };

async function mfaFresh(): Promise<boolean> {
  const sb = await createClient();
  const { data, error } = await sb.rpc('mfa_fresh', {});
  return !error && data === true;
}

const Profile = z.object({ full_name: z.string().trim().min(2, 'Enter your name.').max(120), phone: z.string().trim().max(30).optional() });

export async function updateStaffProfile(_prev: Result | null, formData: FormData): Promise<Result> {
  const c = await currentClaims();
  if (!c) redirect('/staff/login?next=/staff/account');
  const parsed = Profile.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const sb = await createClient();
  const { error } = await sb.from('profiles').update({ full_name: parsed.data.full_name, phone: parsed.data.phone || null }).eq('id', c.uid);
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/staff/account');
  return { ok: true, message: 'Profile saved.' };
}

/** Change password — a sensitive action: needs a code verified in the last 10 minutes (step-up). */
export async function changeStaffPassword(_prev: Result | null, formData: FormData): Promise<Result> {
  const c = await currentClaims();
  if (!c) redirect('/staff/login?next=/staff/account');
  const pw = String(formData.get('password') ?? '');
  const problem = passwordProblem(pw, String(formData.get('confirm') ?? ''));
  if (problem) return { ok: false, error: problem };
  if (!(await mfaFresh())) return { ok: false, stepUp: true, error: 'For your security, confirm your 6-digit code first.' };
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) return { ok: false, error: /same|different from the old/i.test(error.message) ? 'Choose a password you have not used before.' : error.message };
  await staffAudit(c.uid, 'auth.password_changed', {});
  return { ok: true, message: 'Password changed.' };
}

/** New set of 10 backup codes (old ones stop working) — step-up required. */
export async function regenerateBackupCodes(): Promise<{ ok: true; codes: string[] } | { ok: false; error: string; stepUp?: boolean }> {
  const c = await currentClaims();
  if (!c) redirect('/staff/login?next=/staff/account');
  if (c.aal !== 'aal2' || !(await mfaFresh())) return { ok: false, stepUp: true, error: 'For your security, confirm your 6-digit code first.' };
  const codes = await issueBackupCodes(c.uid);
  await staffAudit(c.uid, 'auth.backup_codes_regenerated', { count: codes.length });
  return { ok: true, codes };
}

/** "Sign out everywhere": ends every session of this user (admin_end_sessions on self), then this one. */
export async function signOutEverywhere(): Promise<{ ok: false; error: string; stepUp?: boolean } | void> {
  const c = await currentClaims();
  if (!c) redirect('/staff/login');
  const sb = await createClient();
  const { error } = await sb.rpc('admin_end_sessions', { p_user: c.uid, p_reason: 'self: sign out everywhere' });
  if (error) return { ok: false, error: mapDbError(error), stepUp: isStepUpError(error) };
  await staffAudit(c.uid, 'auth.sign_out', { everywhere: true });
  await sb.auth.signOut({ scope: 'local' });
  await clearStaffSession();
  redirect('/staff/login');
}
