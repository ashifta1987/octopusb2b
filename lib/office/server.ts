import 'server-only';
import { headers } from 'next/headers';
import { getSession, type Session } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { clientIpFrom, officeFail, type OfficeResult } from '@/lib/office/workspace-core';

export type OfficeCtx = { s: Session; sb: Awaited<ReturnType<typeof createClient>> };

/**
 * A signed-in staff member on a 2FA (aal2) session, with the per-request Supabase client (RLS applies; the RPCs check again).
 * Fails like the database would: NOT_SIGNED_IN / STAFF_ONLY.
 */
export async function officeCtx(): Promise<OfficeCtx | { fail: OfficeResult<never> }> {
  const s = await getSession();
  if (!s) return { fail: officeFail('NOT_SIGNED_IN') };
  if (!s.isStaff || s.aal !== 'aal2') return { fail: officeFail('STAFF_ONLY') };
  return { s, sb: await createClient() };
}

/** The caller's IP for the audit trail ("IP when available"); null when the headers don't carry one. */
export async function requestIp(): Promise<string | null> {
  try {
    const h = await headers();
    return clientIpFrom(h.get('x-forwarded-for'), h.get('x-real-ip'));
  } catch {
    return null;
  }
}

/** Service-role client for server-only writes (staff_notify). */
export const officeAdmin = () => createAdminClient();
