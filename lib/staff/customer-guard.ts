'use server';
import { emailIsStaff, isStaffUser } from '@/lib/staff/server';
import { createClient } from '@/lib/supabase/server';

/** Customer sign-up guard (SPEC §17.3 "A staff email cannot hold a customer account"). */
export async function checkCustomerSignupEmail(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e || !e.includes('@')) return { ok: false, error: 'Enter a valid email address.' };
  try {
    if (await emailIsStaff(e)) {
      return { ok: false, error: 'This is an Octopus staff email. Staff cannot create a customer account — use the Back office login instead.' };
    }
  } catch {
    // if the check cannot run, the DB trigger STAFF_CANNOT_BE_CUSTOMER still blocks staff from joining an org
  }
  return { ok: true };
}

/** After a customer-form sign-in: staff members are sent to the staff flow instead of the customer portal. */
export async function staffRedirectAfterCustomerSignIn(): Promise<string | null> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  const uid = data?.claims?.sub as string | undefined;
  if (!uid) return null;
  try {
    return (await isStaffUser(uid)) ? '/staff/verify' : null;
  } catch {
    return null;
  }
}
