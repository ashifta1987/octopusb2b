'use server';
import { currentClaims, isStaffUser, staffAudit } from '@/lib/staff/server';

/** After the invite / reset password was saved in the browser: audit and continue to 2FA. */
export async function afterPasswordSet(kind: string): Promise<{ next: string }> {
  const c = await currentClaims();
  if (!c) return { next: '/staff/login?reset=1' };
  if (!(await isStaffUser(c.uid))) return { next: '/login' };
  await staffAudit(c.uid, 'auth.password_set', { via: kind === 'invite' ? 'invite' : kind === 'recovery' ? 'reset' : 'account' });
  return { next: '/staff/verify' };
}
