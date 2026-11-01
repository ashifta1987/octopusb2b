import { AuthShell } from '../auth-page';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Forgot password' };

/** Customer password reset request (ADDON-22): one-time link, expires after 1 hour. */
export default function ForgotPage() {
  return (
    <AuthShell>
      <ForgotForm />
    </AuthShell>
  );
}
