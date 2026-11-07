import 'server-only';
import { cookies } from 'next/headers';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hashBackupCode, newBackupCodes } from '@/lib/staff/backup-codes';
import { getRequestMeta } from '@/lib/staff/request-meta';
import { DEFAULT_STAFF_SECURITY, type StaffSecurity } from '@/lib/staff/ip';
import { STAFF_COOKIE, newStaffCookie, sessionState, signStaffCookie, staffCookieOptions, verifyStaffCookie, type StaffCookie } from '@/lib/staff/session-cookie';

/** staff_security site setting (not public → read with the service role). */
export async function getStaffSecurity(): Promise<StaffSecurity> {
  try {
    const { data } = await createAdminClient().from('site_settings').select('value').eq('key', 'staff_security').maybeSingle();
    return { ...DEFAULT_STAFF_SECURITY, ...((data?.value as Partial<StaffSecurity>) ?? {}) };
  } catch {
    return DEFAULT_STAFF_SECURITY;
  }
}

/** Audit an auth event with IP + device (auth_audit is service-role only). Never throws. */
export async function staffAudit(userId: string | null, action: string, details: Record<string, unknown> = {}) {
  try {
    const meta = await getRequestMeta();
    await createAdminClient().rpc('auth_audit', { p_user: userId, p_action: action, p_ip: meta.ip, p_ua: meta.ua, p_details: details });
  } catch {
    // audit must never block sign-in
  }
}

/** "Is this user staff?" without the aal2 requirement (routing). */
export async function isStaffUser(userId: string): Promise<boolean> {
  const { data } = await createAdminClient().rpc('user_is_staff', { p_user: userId });
  return data === true;
}

export async function emailIsStaff(email: string): Promise<boolean> {
  const { data } = await createAdminClient().rpc('email_is_staff', { p_email: email });
  return data === true;
}

export async function readStaffCookie(): Promise<StaffCookie | null> {
  const jar = await cookies();
  try {
    return verifyStaffCookie(jar.get(STAFF_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** Start the staff session clock after a successful 2FA verification (server actions / route handlers only). */
export async function startStaffSession(userId: string, trusted: boolean) {
  const sec = await getStaffSecurity();
  const jar = await cookies();
  const prev = await readStaffCookie();
  // keep the original start for step-up re-verification so the 12 h maximum still counts from sign-in
  const now = Date.now();
  const fresh = newStaffCookie(trusted, userId, now, sec.trust_hours);
  // step-up keeps the session; ticking "trust this computer" on a later verification starts the trust period then
  const v = prev && prev.uid === userId
    ? { ...prev, last: now, trusted: trusted || prev.trusted, ...(prev.until ? { until: prev.until } : trusted && fresh.until ? { until: fresh.until } : {}) }
    : fresh;
  jar.set(STAFF_COOKIE, signStaffCookie(v), staffCookieOptions({ idleMinutes: sec.idle_minutes, maxHours: sec.max_session_hours, trustHours: sec.trust_hours }, v.until, now));
}

export async function clearStaffSession() {
  const jar = await cookies();
  jar.delete(STAFF_COOKIE);
}

/** Only same-site relative paths are allowed as redirect targets. */
export function safeNext(n: string | null | undefined, fallback = '/staff/workspace') {
  return n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : fallback;
}

/** Replace the user's backup codes with 10 new ones (hashes stored via the service role); returns the plain codes once. */
export async function issueBackupCodes(userId: string): Promise<string[]> {
  const codes = newBackupCodes();
  const admin = createAdminClient();
  const del = await admin.from('staff_backup_codes').delete().eq('user_id', userId);
  if (del.error) throw new Error(del.error.message);
  const ins = await admin.from('staff_backup_codes').insert(codes.map((c) => ({ user_id: userId, code_hash: hashBackupCode(c) })));
  if (ins.error) throw new Error(ins.error.message);
  return codes;
}

/** Current user id + email from the verified JWT (null when signed out). */
export async function currentClaims(): Promise<{ uid: string; email: string | null; aal: string | null; amr: { method: string; timestamp: number }[] } | null> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return { uid: c.sub as string, email: (c.email as string) ?? null, aal: (c.aal as string) ?? null, amr: (c.amr as { method: string; timestamp: number }[]) ?? [] };
}

/** Is there a live staff session (signed cookie for this user, within idle/max limits)? */
export async function staffSessionValid(userId: string): Promise<boolean> {
  const [cookie, sec] = await Promise.all([readStaffCookie(), getStaffSecurity()]);
  if (!cookie || cookie.uid !== userId) return false;
  return sessionState(cookie, Date.now(), { idleMinutes: sec.idle_minutes, maxHours: sec.max_session_hours, trustHours: sec.trust_hours }) === 'ok';
}

/** Open tickets whose SLA is due within `hours` (workspace "N near SLA" badge). RLS applies. */
export async function nearSlaCount(hours = 4): Promise<number> {
  const sb = await createClient();
  const soon = new Date(Date.now() + hours * 3600_000).toISOString();
  const { count } = await sb.from('tickets').select('id', { count: 'exact', head: true })
    .not('status', 'in', '(resolved,closed)').not('sla_due_at', 'is', null).lte('sla_due_at', soon);
  return count ?? 0;
}
