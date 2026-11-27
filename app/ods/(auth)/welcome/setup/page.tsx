import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeCustomerNext } from '@/lib/safe-next';
import { customerHome, isShopEnabled } from '@/lib/shop/flag';
import { identityFrom, INVITE_FOR_ME } from '@/lib/ods-auth';
import { refuseStaff } from '@/lib/ods-auth-server';
import { getSetupCountries } from '@/lib/ods-auth-settings';
import { SetupMemberView, SetupStaffView, SetupView } from '../../_components/setup-view';
import { completeSetup, finishMemberProfile } from './actions';

export const metadata = { title: 'Set up your company · Octopus B2B', robots: { index: false, follow: false } };

type SP = Promise<{ next?: string }>;

/**
 * /welcome/setup (Part 4.5). Served here by proxy.ts only when the ODS theme is on for the visitor AND they are signed in
 * (signed out → /login?next=…; theme off → 307 /onboarding). Guards:
 *  - staff → the staff message (no customer company, SPEC §17.3);
 *  - already in a company with a profile → next;  in a company without a profile (joined a team) → one-click profile;
 *  - invited by a teammate (ds_team_invites_for_me) → the invite page (invited users skip setup);
 *  - otherwise the form (complete_onboarding in one transaction, see ./actions.ts).
 */
export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<main id="main" className="min-h-screen bg-ods-canvas" aria-busy="true" />}>
      <Setup searchParams={searchParams} />
    </Suspense>
  );
}

async function Setup({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const home = customerHome(await isShopEnabled());
  const next = safeCustomerNext(sp.next, home);
  const sb = await createClient();
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user) redirect(`/login?next=${encodeURIComponent(next === home ? '/welcome/setup' : `/welcome/setup?next=${encodeURIComponent(next)}`)}`);
  if (await refuseStaff(user.id, user.email)) return <SetupStaffView />;

  const [{ data: profile }, { data: member }] = await Promise.all([
    sb.from('profiles').select('id').eq('id', user.id).maybeSingle(),
    sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle(),
  ]);
  const identity = identityFrom(user);
  if (member && profile) redirect(next);
  if (member) return <SetupMemberView identity={identity} next={next} action={finishMemberProfile} />;

  const { data: invites } = await sb.rpc('ds_team_invites_for_me');
  if (Array.isArray(invites) && invites.length) redirect(INVITE_FOR_ME);

  return <SetupView identity={identity} next={next} countries={await getSetupCountries()} action={completeSetup} />;
}
