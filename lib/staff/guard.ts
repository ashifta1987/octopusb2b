import 'server-only';
import { redirect } from 'next/navigation';
import type { Session } from '@/lib/auth';
import { getRequestMeta } from '@/lib/staff/request-meta';
import { getStaffSecurity, staffAudit } from '@/lib/staff/server';
import { ipRuleBlocks } from '@/lib/staff/ip';

/**
 * Layout guard for /office, /admin, /distributor (SPEC §17.3): signed-out → staff login; customers → customer login;
 * optional office IP rule for the configured roles (Admin, Finance) → blocked notice on the staff login.
 */
export async function staffLayoutGuard(session: Session | null, next: string): Promise<Session> {
  if (!session) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  if (!session.isStaff) redirect('/login');
  const sec = await getStaffSecurity();
  if (sec.ip_rule_enabled) {
    const { ip } = await getRequestMeta();
    if (ipRuleBlocks(sec, session.roles, ip)) {
      await staffAudit(session.userId, 'auth.ip_blocked', { path: next });
      redirect('/staff/login?ip=1');
    }
  }
  return session;
}
