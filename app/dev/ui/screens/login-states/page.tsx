import { LOGIN_STATES, type LoginState } from '@/lib/ods-auth';
import { LoginForm } from '@/app/ods/(auth)/_components/login-view';
import { AuthFixtureFrame, FixtureState } from '../_auth-frame';

export const metadata = { title: 'Sign-in states · ODS fixtures (staging)', robots: { index: false, follow: false } };

const NOTES: Record<LoginState, string> = {
  cancelled: '/login?error=cancelled — back from Google without signing in (friendlyAuthError “Google sign-in was cancelled.” maps here too).',
  failed: '/login?error=failed — Google or our server had a problem; any unknown ?error= text shows this generic message.',
  'link-expired': '/login?error=expired — an e-mail link that expired or was opened in another browser.',
  unavailable: '/login?error=unavailable — Google provider error (invalid client, exchange failed).',
  'staff-email': '/login?error=staff-email — normally /auth/callback sends staff straight to /staff/login.',
  'session-expired': '/login?state=expired — after a long time away.',
  'signed-out': '/login?state=signed-out — signed out in another tab.',
  invite: '/login?next=/invite/<token> — sign in with the invited e-mail.',
  'wrong-account': '/login?next=/invite/<token>&state=wrong-account — signed in with another Google account than the invite.',
};

/** Every /login state (States-Auth), using the real form column with sample props. */
export default function LoginStatesFixtures() {
  return (
    <AuthFixtureFrame
      title="Sign-in states"
      intro="The /login form column (Auth_SignIn) in every state from States-Auth. The real page adds the navy side panel on tablets and desktops and the logo header on phones."
    >
      <FixtureState id="default" title="Default (Google on)" note="/login">
        <div className="flex justify-center p-6">
          <LoginForm next="/shop" google state={null} headingLevel={3} />
        </div>
      </FixtureState>
      <FixtureState id="google-off" title="Google not set up yet" note="lib/auth-providers.ts → google: false. The button stays, disabled, with the reason.">
        <div className="flex justify-center p-6">
          <LoginForm next="/shop" google={false} state={null} headingLevel={3} />
        </div>
      </FixtureState>
      {LOGIN_STATES.map((s) => (
        <FixtureState key={s} id={s} title={`State: ${s.replace(/-/g, ' ')}`} note={NOTES[s]}>
          <div className="flex justify-center p-6">
            <LoginForm next={s === 'invite' || s === 'wrong-account' ? '/invite/example' : '/shop'} google state={s} headingLevel={3} />
          </div>
        </FixtureState>
      ))}
      <FixtureState id="password-reset" title="After a password change" note="/login?reset=1">
        <div className="flex justify-center p-6">
          <LoginForm next="/shop" google state={null} passwordReset headingLevel={3} />
        </div>
      </FixtureState>
    </AuthFixtureFrame>
  );
}
