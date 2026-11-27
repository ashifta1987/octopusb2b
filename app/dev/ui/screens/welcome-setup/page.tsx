import type { AuthIdentity } from '@/lib/ods-auth';
import type { SetupFormState } from '@/app/ods/(auth)/welcome/setup/actions';
import { SetupMemberView, SetupStaffView, SetupView } from '@/app/ods/(auth)/_components/setup-view';
import { AuthFixtureFrame, FixtureState } from '../_auth-frame';

export const metadata = { title: 'First-time setup · ODS fixtures (staging)', robots: { index: false, follow: false } };

const ANNA: AuthIdentity = { name: 'Anna Khan', firstName: 'Anna', initials: 'AK', email: 'anna@example.com', avatarUrl: null, provider: 'google' };
const COUNTRIES = {
  launch: [
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
  ],
  all: [
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'IN', name: 'India' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'US', name: 'United States' },
  ],
};
const ERRORS: SetupFormState = {
  fieldErrors: { company: 'Enter your company name (at least 2 characters).', phone: 'Enter the number with + and the country code, for example +971 50 123 4567.' },
  values: { company: 'A', country: 'AE', phone: '050 123 4567', role: 'buyer', interests: ['pools'] },
};

/** Fixture only: never saves. */
async function previewOnly(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  'use server';
  return {
    formError: 'Example only: this preview page doesn’t save anything.',
    values: {
      company: String(formData.get('company') ?? ''), country: String(formData.get('country') ?? ''), phone: String(formData.get('phone') ?? ''),
      role: String(formData.get('role') ?? 'owner'), interests: formData.getAll('interests').map(String),
    },
  };
}
async function previewMember(): Promise<void> {
  'use server';
}

/** /welcome/setup with a sample Google user (Auth_Setup), the validation-error state, and the staff / team-member variants. */
export default function WelcomeSetupFixtures() {
  return (
    <AuthFixtureFrame title="First-time company setup" intro="The /welcome/setup screen (Auth_Setup, M_Auth_Setup) with a sample Google user. Submitting here never saves.">
      <FixtureState id="setup" title="Setup form" note="Sample launch countries (the real list comes from signup_launch_countries + every country).">
        <SetupView embedded headingLevel={2} identity={ANNA} next="/shop" countries={COUNTRIES} action={previewOnly} />
      </FixtureState>
      <FixtureState id="setup-errors" title="Validation errors" note="Company too short and a local phone number without + (E.164 check on blur, on submit and on the server).">
        <SetupView embedded headingLevel={2} identity={{ ...ANNA, provider: 'email', email: 'buyer@example.com' }} next="/shop" countries={COUNTRIES} action={previewOnly} initialState={ERRORS} />
      </FixtureState>
      <FixtureState id="setup-staff" title="Staff account" note="Staff never set up a customer company.">
        <SetupStaffView embedded headingLevel={2} />
      </FixtureState>
      <FixtureState id="setup-member" title="Joined a team, no profile yet" note="Invited people skip setup; this only appears if a teammate’s profile is missing.">
        <SetupMemberView embedded headingLevel={2} identity={ANNA} next="/shop" action={previewMember} />
      </FixtureState>
    </AuthFixtureFrame>
  );
}
