import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCustomerSocialProviders } from '@/lib/auth-providers';
import { refuseStaff } from '@/lib/ods-auth-server';
import { InviteView, type InviteItem } from '../../_components/invite-view';
import { acceptTeamInvite } from '../actions';

export const metadata = { title: 'Team invitation · Octopus B2B', robots: { index: false, follow: false } };

type Params = Promise<{ token: string }>;

/**
 * /invite/<token> (Part 3.2, States-Auth). Served here by proxy.ts only when the ODS theme is on (off → today's Dropship
 * team join page). Customer team invites with tokens don't exist yet: invitations are matched by the signed-in person's
 * CONFIRMED e-mail (ds_team_invites_for_me). So the token is only used to come back to this URL after sign-in — it is
 * never shown, never looked up and never trusted. /invite/me is the token-less entry used by /auth/callback and setup.
 */
export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<main id="main" className="min-h-screen bg-ods-canvas" aria-busy="true" />}>
      <Invite params={params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: Params }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(token)) notFound();
  const returnTo = `/invite/${token}`;
  const [sb, social] = await Promise.all([createClient(), getCustomerSocialProviders()]);
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user) return <InviteView state="signed-out" returnTo={returnTo} google={social.google} />;
  const email = user.email ?? null;
  if (await refuseStaff(user.id, email)) return <InviteView state="wrong-account" reason="staff" signedInAs={email} returnTo={returnTo} google={social.google} />;

  const [{ data: member }, { data: inv }] = await Promise.all([
    sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle(),
    sb.rpc('ds_team_invites_for_me'),
  ]);
  const invites = (Array.isArray(inv) ? inv : []) as InviteItem[];
  if (member) return <InviteView state="wrong-account" reason="has-company" signedInAs={email} returnTo={returnTo} google={social.google} />;
  if (!invites.length) return <InviteView state="wrong-account" reason="other-email" signedInAs={email} returnTo={returnTo} google={social.google} />;
  return <InviteView state="invite" invites={invites} signedInAs={email} returnTo={returnTo} google={social.google} accept={acceptTeamInvite} />;
}
