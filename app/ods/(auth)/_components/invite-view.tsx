import Link from 'next/link';
import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { Icon, buttonClass, formatDate } from '@octopus/ui';
import { SignOutButton } from '@octopus/ui/components/auth-broadcast';
import { ROLE_LABELS } from '@/lib/dropship-ds12-shared';
import type { AcceptInviteResult } from '../invite/actions';
import { AuthNotice } from './notice';
import { OdsGoogleButton } from './google-button';
import { InviteAccept } from './invite-accept';
import { SetupHeader } from './setup-view';

export type InviteItem = { id: string; company: string; ds_role: 'manager' | 'support'; expires_at: string };
export type InviteState = 'signed-out' | 'invite' | 'wrong-account' | 'expired';
export type InviteViewProps = {
  state: InviteState;
  /** this page's own path (/invite/<token>): where sign-in comes back to */
  returnTo: string;
  google: boolean;
  invites?: InviteItem[];
  /** wrong-account: who is signed in */
  signedInAs?: string | null;
  /** wrong-account variants: another person's e-mail (default), a login that already has a company, a staff account */
  reason?: 'other-email' | 'has-company' | 'staff';
  accept?: (id: string) => Promise<AcceptInviteResult>;
  headingLevel?: 1 | 2;
  /** fixtures: no header/main landmarks */
  embedded?: boolean;
};

/**
 * /invite/<token> (States-Auth "Invited by a teammate" / "Different email than the invite"), presentational.
 * Customer team invitations are matched by the signed-in, CONFIRMED e-mail (ds_team_invites_for_me) — the token in the URL
 * is never shown and never trusted (real invite tokens come with invite e-mails later).
 */
export function InviteView({ state, returnTo, google, invites = [], signedInAs, reason = 'other-email', accept, headingLevel = 1, embedded }: InviteViewProps) {
  const H = `h${headingLevel}` as 'h1' | 'h2';
  const Main = embedded ? 'div' : 'main';
  const loginHref = `/login?next=${encodeURIComponent(returnTo)}&state=invite`;
  let body: ReactNode;
  if (state === 'signed-out') {
    body = (
      <>
        <H className="text-[28px] leading-tight font-bold text-ods-navy">You’ve been invited to a team</H>
        <p className="text-ods-body text-ods-slate">Sign in to see the invitation and accept it. Use the email address the invitation was sent to — new here? The same button creates your account.</p>
        <OdsGoogleButton next={returnTo} enabled={google} text="continue" />
        <p className="text-ods-small text-ods-slate">
          No Google account?{' '}
          <Link href={loginHref} className="inline-flex min-h-ods-control items-center font-semibold text-ods-blue underline underline-offset-2">
            Use your work email
          </Link>
        </p>
      </>
    );
  } else if (state === 'invite') {
    body = (
      <>
        <H className="text-[28px] leading-tight font-bold text-ods-navy">{invites.length === 1 ? `Join ${invites[0].company}` : 'You’ve been invited to a team'}</H>
        <p className="text-ods-body text-ods-slate">{signedInAs ? <>Signed in as <span className="font-semibold break-all text-ods-text">{signedInAs}</span>. </> : null}Accept to work on the company’s account with the role below.</p>
        <ul className="flex flex-col gap-4">
          {invites.map((i) => (
            <li key={i.id} className="rounded-ods-card border border-ods-line p-4" data-testid="invite-item">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-ods-control bg-ods-blue-tint text-ods-navy">
                  <Icon icon={Users} size="md" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ods-navy">{i.company}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ods-small">
                    <dt className="text-ods-slate">Role</dt>
                    <dd className="text-ods-text">
                      <strong className="font-semibold">{ROLE_LABELS[i.ds_role]?.label ?? i.ds_role}</strong> — {ROLE_LABELS[i.ds_role]?.can ?? ''}
                    </dd>
                    <dt className="text-ods-slate">Valid until</dt>
                    <dd className="text-ods-text">{formatDate(i.expires_at)}</dd>
                  </dl>
                </div>
              </div>
              {accept ? (
                <div className="mt-4">
                  <InviteAccept id={i.id} accept={accept} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </>
    );
  } else if (state === 'wrong-account') {
    const text =
      reason === 'has-company'
        ? { title: 'Your login already belongs to a company', line: 'One login works for one company. Ask the owner to invite another email address, or go to your shop.' }
        : reason === 'staff'
          ? { title: 'This is a staff account', line: 'Octopus staff can’t join a customer team. Sign out and use the customer email the invitation was sent to.' }
          : { title: 'This invite is for a different email', line: 'We found no invitation for the account you signed in with. Switch to the email address the invitation was sent to.' };
    body = (
      <>
        <H className="text-[28px] leading-tight font-bold text-ods-navy">{text.title}</H>
        <AuthNotice tone="warning" title={signedInAs ? <>You signed in as <span className="break-all">{signedInAs}</span>.</> : 'You are signed in with another account.'}>
          {text.line}
        </AuthNotice>
        {reason === 'has-company' ? (
          <div className="flex flex-wrap gap-3">
            <a href="/shop" className={buttonClass('primary')}>
              Go to my shop
            </a>
            <SignOutButton />
          </div>
        ) : (
          <>
            <OdsGoogleButton next={returnTo} enabled={google} text="continue" testId="google-switch" />
            <div className="flex flex-wrap items-center gap-3">
              <SignOutButton>Sign out</SignOutButton>
              <span className="text-ods-small text-ods-slate">then sign in with the invited email.</span>
            </div>
          </>
        )}
      </>
    );
  } else {
    body = (
      <>
        <H className="text-[28px] leading-tight font-bold text-ods-navy">This invitation has expired</H>
        <p className="text-ods-body text-ods-slate">Invitations are valid for a limited time. Ask the person who invited you to send a new one.</p>
        <div>
          <Link href="/" className={buttonClass('secondary')}>
            Back to the introduction page
          </Link>
        </div>
      </>
    );
  }
  return (
    <div className={embedded ? 'flex flex-col bg-ods-canvas' : 'flex min-h-screen flex-1 flex-col bg-ods-canvas'}>
      <SetupHeader step={false} embedded={embedded} signedIn={state !== 'signed-out'} />
      <Main id={embedded ? undefined : 'main'} className="flex-1 px-ods-pad-page py-8 ods-tablet:py-12">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 rounded-ods-card border border-ods-line bg-ods-surface p-5 shadow-ods-card ods-tablet:p-8" data-testid="invite-state" data-state={state} data-reason={state === 'wrong-account' ? reason : undefined}>
          {body}
        </div>
      </Main>
    </div>
  );
}
