import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, Logo, ODS_SERVICE_ICONS, odsServices, cx, type OdsServiceKey } from '@octopus/ui';
import type { LoginState } from '@/lib/ods-auth';
import { AuthNotice, InfoBox, type AuthNoticeTone } from './notice';
import { OdsGoogleButton } from './google-button';
import { EmailSignIn } from './email-sign-in';

/** Service square colours (static class names for Tailwind). */
const SVC_BG: Record<OdsServiceKey, string> = {
  sourcing: 'bg-ods-svc-sourcing',
  pools: 'bg-ods-svc-pools',
  dropship: 'bg-ods-svc-dropship',
  '3pl': 'bg-ods-svc-3pl',
  turnkey: 'bg-ods-svc-turnkey',
  brand: 'bg-ods-svc-brand',
};

export type LoginViewProps = {
  /** safe same-site path the visitor goes to after signing in */
  next: string;
  /** Google offered (lib/auth-providers.ts); false → disabled button with the reason */
  google: boolean;
  /** notice from ?error= / ?state= (lib/ods-auth.ts loginStateFrom) */
  state: LoginState | null;
  /** a friendlyAuthError() text to show under the title (only known texts are passed in) */
  detail?: string | null;
  /** ?reset=1 after a password change */
  passwordReset?: boolean;
};

const STATES: Record<LoginState, { tone: AuthNoticeTone; title: string; text: (detail?: string | null) => ReactNode; action?: ReactNode }> = {
  cancelled: { tone: 'warning', title: 'You didn’t finish signing in.', text: () => 'Try again, or use your email instead.' },
  failed: {
    tone: 'danger',
    title: 'We couldn’t sign you in.',
    text: () => 'Please try again in a moment. If it keeps happening, contact support.',
    action: (
      <Link href="/contact" className="inline-flex min-h-ods-control items-center rounded-ods-control border border-ods-slate/70 bg-ods-surface px-4 text-ods-small font-semibold text-ods-navy hover:border-ods-navy">
        Contact support
      </Link>
    ),
  },
  'link-expired': { tone: 'warning', title: 'This sign-in link has expired.', text: (d) => d ?? 'The link expired or was already used. Sign in again below.' },
  unavailable: { tone: 'warning', title: 'Google sign-in isn’t available right now.', text: () => 'Use your work email, or try Google again later.' },
  'staff-email': {
    tone: 'info',
    title: 'This is an Octopus staff email.',
    text: () => 'Staff sign in at the back office with their work email and password.',
    action: (
      <Link href="/staff/login" className="inline-flex min-h-ods-control items-center font-semibold text-ods-navy underline underline-offset-2">
        Back office sign-in
      </Link>
    ),
  },
  'session-expired': { tone: 'info', title: 'Please sign in again.', text: () => 'For your security we signed you out after a long time away.' },
  'signed-out': { tone: 'neutral', title: 'You signed out', text: () => 'You signed out in another tab. Sign in again to continue.' },
  invite: { tone: 'info', title: 'You’ve been invited to a team.', text: () => 'Sign in with the email address the invitation was sent to.' },
  'wrong-account': {
    tone: 'warning',
    title: 'This invite is for a different email.',
    text: () => 'Sign in with the Google account or work email the invitation was sent to. Google will let you pick the account.',
  },
};

/**
 * /login (Part 4.3, Auth_SignIn + M_Auth_SignIn), presentational: props only, so /dev/ui/screens/login-states can show
 * every state. Desktop/tablet: navy side panel (520 px at 1280, narrower on tablets) + the form; phones (< 768): logo header,
 * then the form. One H1. Google button = official Google branding (packages/ui GoogleSignInButton).
 */
export function LoginView({ next, google, state, detail, passwordReset }: LoginViewProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col ods-tablet:flex-row" data-testid="ods-login-frame">
      <header className="border-b border-ods-line bg-ods-surface px-ods-pad-page py-3 ods-tablet:hidden">
        <Logo variant="mark" area="public" height={28} priority />
      </header>

      <aside
        aria-label="One account for all six services"
        className="relative hidden shrink-0 flex-col justify-between overflow-hidden bg-ods-navy-dark px-12 py-12 text-white ods-tablet:flex ods-tablet:w-[clamp(300px,40vw,520px)]"
      >
        <div>
          <Logo variant="white-tagline" area="public" height={66} priority />
          <p className="mt-12 text-[28px] leading-tight font-bold text-white">One account for all six.</p>
          <p className="mt-2 text-ods-body text-white/85">Sign in once and use everything:</p>
          <ul className="mt-8 flex flex-col gap-3">
            {odsServices.map((svc) => (
              <li key={svc.key} className="flex items-center gap-3 text-ods-body font-medium text-white">
                <span className={cx('grid size-8 shrink-0 place-items-center rounded-ods-control text-white', SVC_BG[svc.key])}>
                  <Icon icon={ODS_SERVICE_ICONS[svc.key]} size="sm" />
                </span>
                {svc.name}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-12 text-ods-small text-white/85">Free to join · Open to verified companies</p>
      </aside>

      <main id="main" className="flex flex-1 justify-center bg-ods-surface px-ods-pad-page py-8 ods-tablet:items-center ods-tablet:py-12" data-testid="ods-login">
        <LoginForm next={next} google={google} state={state} detail={detail} passwordReset={passwordReset} />
      </main>
    </div>
  );
}

/**
 * The form column on its own (the fixtures page shows it once per state, with an H3 title, under its own H1).
 */
export function LoginForm({ next, google, state, detail, passwordReset, headingLevel = 1 }: LoginViewProps & { headingLevel?: 1 | 3 }) {
  const s = state ? STATES[state] : null;
  const H = `h${headingLevel}` as 'h1' | 'h3';
  return (
    <div className="flex w-full max-w-[420px] flex-col gap-5">
      <div>
        <H className="text-[28px] leading-tight font-bold text-ods-navy">Sign in or create your account</H>
        <p className="mt-2 text-ods-body text-ods-slate">
          {google ? 'Use your work Google account. New here? The same button creates your free account.' : 'Use your work email. New here? You can create your free account in the next step.'}
        </p>
      </div>

      {passwordReset ? (
        <AuthNotice tone="info" title="Your password was changed." testId="login-state" state="password-reset">
          Sign in with the new password.
        </AuthNotice>
      ) : null}
      {s && state ? (
        <AuthNotice tone={s.tone} title={s.title} action={s.action} testId="login-state" state={state}>
          {s.text(detail)}
        </AuthNotice>
      ) : null}

      <OdsGoogleButton next={next} enabled={google} />

      <div className="flex items-center gap-3 text-ods-small text-ods-slate" aria-hidden="true">
        <span className="h-px flex-1 bg-ods-line" />
        or
        <span className="h-px flex-1 bg-ods-line" />
      </div>

      <EmailSignIn next={next} />

      <p className="text-ods-small text-ods-slate">
        By continuing you agree to our{' '}
        <Link href="/legal/terms" className="font-medium text-ods-blue underline underline-offset-2">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="font-medium text-ods-blue underline underline-offset-2">
          Privacy policy
        </Link>
        . We only use your Google name, email and photo.
      </p>

      <InfoBox>
        After you sign in, the shop opens here. Your account panel opens in its own tab from <strong className="font-semibold text-ods-navy">My account ↗</strong>.
      </InfoBox>

      <p className="text-ods-small text-ods-slate">
        Octopus staff?{' '}
        <Link href="/staff/login" className="inline-flex min-h-ods-control items-center font-semibold text-ods-blue underline underline-offset-2">
          Back office sign-in
        </Link>
      </p>
    </div>
  );
}
