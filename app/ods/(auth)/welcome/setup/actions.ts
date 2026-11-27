'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { mapDbError } from '@/lib/format';
import { safeCustomerNext } from '@/lib/safe-next';
import { customerHome, isShopEnabled } from '@/lib/shop/flag';
import { cleanInterests, identityFrom, normalizeE164, roleToBusinessType, PHONE_ERROR, SETUP_ROLES } from '@/lib/ods-auth';
import { ensureOwnProfile, refuseStaff } from '@/lib/ods-auth-server';

export type SetupField = 'company' | 'country' | 'phone' | 'role';
export type SetupValues = { company: string; country: string; phone: string; role: string; interests: string[] };
export type SetupFormState = { formError?: string; fieldErrors?: Partial<Record<SetupField, string>>; values?: SetupValues } | null;

const Setup = z.object({
  company: z.string().trim().min(2, 'Enter your company name (at least 2 characters).').max(160, 'Use 160 characters or fewer.'),
  country: z.string().regex(/^[A-Z]{2}$/, 'Choose your country, or Other.'),
  role: z.enum(SETUP_ROLES.map((r) => r.value) as [string, ...string[]], { message: 'Choose your role.' }),
});

/** A missing database function (migration 252 not applied yet) — PostgREST PGRST202 / Postgres 42883. */
const missingFunction = (e: { code?: string; message?: string }) => e.code === 'PGRST202' || e.code === '42883' || /does not exist|could not find the function/i.test(e.message ?? '');

/**
 * Go to the shop (Part 4.5): validates, refuses staff, then the EXISTING complete_onboarding() RPC creates the profile,
 * the company, the owner membership and the wallet in ONE transaction (migration 0002). p_full_name = the Google name
 * (or the e-mail's local part), p_business_type = the role label (lib/ods-auth.ts roleToBusinessType). Interests are
 * saved with save_company_interests() ONLY if that function exists (migration 252 is DRAFTED, not applied): when it is
 * missing the company is still created and the interests are skipped. Then → the safe next (default /shop).
 */
export async function completeSetup(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const values: SetupValues = {
    company: String(formData.get('company') ?? '').slice(0, 200),
    country: String(formData.get('country') ?? ''),
    phone: String(formData.get('phone') ?? '').slice(0, 40),
    role: String(formData.get('role') ?? ''),
    interests: cleanInterests(formData.getAll('interests')),
  };
  const fieldErrors: Partial<Record<SetupField, string>> = {};
  const parsed = Setup.safeParse(values);
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[i.path[0] as SetupField] ??= i.message;
  const phone = normalizeE164(values.phone);
  if (!phone) fieldErrors.phone = values.phone.trim() ? PHONE_ERROR : 'Enter your WhatsApp number with + and the country code.';
  if (!parsed.success || !phone) return { fieldErrors, values };

  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user) redirect('/login?next=%2Fwelcome%2Fsetup');
  if (await refuseStaff(user.id, user.email)) redirect('/welcome/setup'); // the page shows the staff message

  const home = customerHome(await isShopEnabled());
  const next = safeCustomerNext(formData.get('next'), home);
  // already in a company (set up in another tab, or joined a team): never run complete_onboarding again for them
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (member) {
    await ensureOwnProfile(user);
    redirect(next);
  }

  const { error } = await sb.rpc('complete_onboarding', {
    p_full_name: identityFrom(user).name,
    p_company: parsed.data.company,
    p_country: parsed.data.country,
    p_phone: phone,
    p_business_type: roleToBusinessType(parsed.data.role),
    p_city: null,
  });
  if (error) return { formError: mapDbError(error), values };

  if (values.interests.length) {
    const { error: ie } = await sb.rpc('save_company_interests', { p_services: values.interests });
    // missing (migration 252 not applied) or any other failure: the company exists already, so carry on to the shop
    if (ie && !missingFunction(ie)) console.warn('save_company_interests failed', ie.code);
  }
  redirect(next);
}

/** Joined a team but no profile yet (see ensureOwnProfile): create it from the Google name, then continue. */
export async function finishMemberProfile(formData: FormData): Promise<void> {
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect('/login?next=%2Fwelcome%2Fsetup');
  if (await refuseStaff(u.user.id, u.user.email)) redirect('/welcome/setup');
  await ensureOwnProfile(u.user);
  redirect(safeCustomerNext(formData.get('next'), customerHome(await isShopEnabled())));
}
