import type { AcceptInviteResult } from '@/app/ods/(auth)/invite/actions';
import { InviteView, type InviteItem } from '@/app/ods/(auth)/_components/invite-view';
import { AuthFixtureFrame, FixtureState } from '../_auth-frame';

export const metadata = { title: 'Team invitations · ODS fixtures (staging)', robots: { index: false, follow: false } };

const INVITE: InviteItem = { id: '00000000-0000-4000-8000-000000000001', company: 'Example Home Trading', ds_role: 'manager', expires_at: '2026-12-04T10:00:00Z' };

/** Fixture only: never joins anything. */
async function previewAccept(): Promise<AcceptInviteResult> {
  'use server';
  return { ok: false, code: 'expired', message: 'Example only: this preview page doesn’t accept invitations.' };
}

/** Every /invite/<token> state (States-Auth: invited by a teammate, different email) plus expired. */
export default function InviteFixtures() {
  return (
    <AuthFixtureFrame title="Team invitations" intro="The /invite/<token> screen in each state. Invitations are matched by the signed-in, confirmed email; the token is never shown or trusted.">
      <FixtureState id="signed-out" title="Signed out" note="Sign in with the invited email; Google comes back to this invite page.">
        <InviteView embedded headingLevel={2} state="signed-out" returnTo="/invite/example" google />
      </FixtureState>
      <FixtureState id="invite" title="Signed in, invitation found" note="Company, role and expiry from ds_team_invites_for_me. Accept here shows the example error.">
        <InviteView embedded headingLevel={2} state="invite" returnTo="/invite/example" google invites={[INVITE]} signedInAs="sara@example.com" accept={previewAccept} />
      </FixtureState>
      <FixtureState id="wrong-account" title="Different email than the invite" note="No invitation for the signed-in email.">
        <InviteView embedded headingLevel={2} state="wrong-account" reason="other-email" returnTo="/invite/example" google signedInAs="sara.personal@example.com" />
      </FixtureState>
      <FixtureState id="has-company" title="Login already in a company">
        <InviteView embedded headingLevel={2} state="wrong-account" reason="has-company" returnTo="/invite/example" google signedInAs="owner@example.com" />
      </FixtureState>
      <FixtureState id="staff" title="Staff account">
        <InviteView embedded headingLevel={2} state="wrong-account" reason="staff" returnTo="/invite/example" google signedInAs="staff@example.com" />
      </FixtureState>
      <FixtureState id="expired" title="Expired" note="Shown when accepting finds the invitation expired or cancelled.">
        <InviteView embedded headingLevel={2} state="expired" returnTo="/invite/example" google />
      </FixtureState>
    </AuthFixtureFrame>
  );
}
