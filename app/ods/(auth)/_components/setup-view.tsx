import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo, buttonClass } from '@octopus/ui';
import { SignOutButton } from '@octopus/ui/components/auth-broadcast';
import type { AuthIdentity } from '@/lib/ods-auth';
import { SetupForm, type SetupFormProps } from './setup-form';

/** Header with the logo (white header → navy mark) and "Step 1 of 1" (Auth_Setup). */
export function SetupHeader({ step = true, embedded, signedIn = true }: { step?: boolean; embedded?: boolean; signedIn?: boolean }) {
  const Tag = embedded ? 'div' : 'header';
  return (
    <Tag className="border-b border-ods-line bg-ods-surface">
      <div className="mx-auto flex max-w-ods-content items-center justify-between gap-4 px-ods-pad-page py-3">
        <Logo variant="mark" area="public" signedIn={signedIn} height={28} priority />
        {step ? <p className="text-ods-small text-ods-slate">Step 1 of 1</p> : null}
      </div>
    </Tag>
  );
}

/** Avatar (Google photo, or initials) + name + "email · signed in with Google". */
export function IdentityCard({ identity }: { identity: AuthIdentity }) {
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="setup-identity">
      {identity.avatarUrl ? (
        // Google profile photo (lh3.googleusercontent.com): plain <img>, no next/image remote pattern needed
        // eslint-disable-next-line @next/next/no-img-element
        <img src={identity.avatarUrl} alt="" width={48} height={48} referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-ods-canvas text-ods-body font-bold text-ods-navy">
          {identity.initials}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-semibold text-ods-navy">{identity.name}</p>
        <p className="text-ods-small break-all text-ods-slate">
          {identity.email} · {identity.provider === 'google' ? 'signed in with Google' : 'signed in with email'}
        </p>
      </div>
    </div>
  );
}

/** `embedded` (fixtures): no header/main landmarks, so several copies fit on one page. */
function Shell({ children, step = true, embedded }: { children: ReactNode; step?: boolean; embedded?: boolean }) {
  const Main = embedded ? 'div' : 'main';
  return (
    <div className={embedded ? 'flex flex-col bg-ods-canvas' : 'flex min-h-screen flex-1 flex-col bg-ods-canvas'}>
      <SetupHeader step={step} embedded={embedded} />
      <Main id={embedded ? undefined : 'main'} className="flex-1 px-ods-pad-page py-8 ods-tablet:py-10">
        <div className="mx-auto w-full max-w-[760px] rounded-ods-card border border-ods-line bg-ods-surface p-5 shadow-ods-card ods-tablet:p-8">{children}</div>
      </Main>
    </div>
  );
}

export type SetupViewProps = Omit<SetupFormProps, 'next'> & { identity: AuthIdentity; next: string; headingLevel?: 1 | 2; embedded?: boolean };

/**
 * /welcome/setup (Part 4.5, Auth_Setup + M_Auth_Setup), presentational (props only) so /dev/ui/screens/welcome-setup can
 * show it with a sample Google user and a validation-error state.
 */
export function SetupView({ identity, headingLevel = 1, embedded, ...form }: SetupViewProps) {
  const H = `h${headingLevel}` as 'h1' | 'h2';
  return (
    <Shell embedded={embedded}>
      <IdentityCard identity={identity} />
      <H className="mt-5 text-[28px] leading-tight font-bold text-ods-navy">Welcome, {identity.firstName}. Tell us about your company</H>
      <p className="mt-2 mb-6 text-ods-body text-ods-slate">This is a one-time step, under a minute. You can change it later in My account › Team and settings.</p>
      <SetupForm {...form} />
    </Shell>
  );
}

/** Staff never set up a customer company (same rule and wording as /onboarding). */
export function SetupStaffView({ headingLevel = 1, embedded }: { headingLevel?: 1 | 2; embedded?: boolean }) {
  const H = `h${headingLevel}` as 'h1' | 'h2';
  return (
    <Shell step={false} embedded={embedded}>
      <div data-testid="setup-staff">
        <H className="text-[28px] leading-tight font-bold text-ods-navy">This is a staff account</H>
        <p className="mt-2 text-ods-body text-ods-slate">Octopus staff cannot create a customer profile. Sign in to the back office instead.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/staff/login" className={buttonClass('primary')}>
            Back office login
          </Link>
          <SignOutButton />
        </div>
      </div>
    </Shell>
  );
}

/** Joined a team (org member) but no profile yet: one button creates the profile from the Google name, then the shop. */
export function SetupMemberView({ identity, next, action, headingLevel = 1, embedded }: { identity: AuthIdentity; next: string; action: (fd: FormData) => Promise<void>; headingLevel?: 1 | 2; embedded?: boolean }) {
  const H = `h${headingLevel}` as 'h1' | 'h2';
  return (
    <Shell step={false} embedded={embedded}>
      <IdentityCard identity={identity} />
      <H className="mt-5 text-[28px] leading-tight font-bold text-ods-navy">You’re in the team, {identity.firstName}</H>
      <p className="mt-2 text-ods-body text-ods-slate">Your company is already set up by its owner. Continue to the shop.</p>
      <form action={action} className="mt-6" data-testid="setup-member">
        <input type="hidden" name="next" value={next} />
        <button type="submit" className={buttonClass('primary')}>
          Go to the shop
        </button>
      </form>
    </Shell>
  );
}
