import { Suspense } from 'react';
import { DsEmptyState, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireCustomer } from '@/lib/auth';
import { getInvitesForMe } from '@/lib/dropship-ds12';
import { JoinClient } from './join-client';

export const metadata = { title: 'Join a Dropship team · Octopus' };

/**
 * Release 5 · Step 13 — accept a Dropship team invitation. The invited person signs in (or signs up) with the invited email;
 * ds_team_invites_for_me() lists invitations for that confirmed email only, and ds_team_invite_accept() adds them to the
 * company with the invited role. A login that already belongs to a company can't join (one company per login).
 */
async function Join() {
  await requireCustomer('/account/dropship/join');
  const invites = await getInvitesForMe().catch(() => []);
  return (
    <div className="flex flex-col gap-5 max-w-[720px]" data-testid="ds-join-page">
      <DsPageHeader title="Join a Dropship team" icon="users" subtitle="Accept an invitation to work on a company's Octopus Dropship account." />
      {invites.length === 0 ? (
        <DsEmptyState icon="users" testId="join-empty" title="No invitation for this sign-in"
          description="Ask the account owner to invite the email address you signed in with." actionLabel="Back to my account" actionHref="/account" actionIcon="arrow" />
      ) : (
        <JoinClient invites={invites} />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Join />
    </Suspense>
  );
}
