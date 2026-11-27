import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { emailIsStaff, isStaffUser } from '@/lib/staff/server';
import { identityFrom } from '@/lib/ods-auth';

/** Staff (role or staff e-mail domain) never get a customer profile or company (SPEC §17.3) — same rule as /onboarding refuseStaff. */
export async function refuseStaff(userId: string, email: string | null | undefined): Promise<boolean> {
  try {
    return (await isStaffUser(userId)) || (!!email && (await emailIsStaff(email)));
  } catch {
    return false; // the STAFF_CANNOT_BE_CUSTOMER trigger still blocks it in the database
  }
}

/**
 * A person who JOINED a company through a team invite has an org_members row but may have no profiles row yet
 * (complete_onboarding() makes both, but must not run for them: it would rename the inviting company). Creates ONLY the
 * missing profile for this signed-in user (name / e-mail / photo from Google), never overwrites an existing one.
 * Service role, because profiles has no insert policy (complete_onboarding is SECURITY DEFINER for the same reason).
 */
export async function ensureOwnProfile(user: Pick<User, 'id' | 'email' | 'user_metadata' | 'app_metadata'>): Promise<boolean> {
  const id = identityFrom(user);
  try {
    const { error } = await createAdminClient()
      .from('profiles')
      .upsert({ id: user.id, full_name: id.name, email: user.email ?? null, avatar_url: id.avatarUrl }, { onConflict: 'id', ignoreDuplicates: true });
    return !error;
  } catch {
    return false;
  }
}
