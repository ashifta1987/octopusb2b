import { AuthShell } from '../auth-page';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Forgot password' };

/** Customer password reset request (ADDON-22): one-time link, expires after 1 hour. */
export default function ForgotPage() {
  return (
    <AuthShell title="Reset your password" sub="We send a secure link to your email. It works once and expires after an hour.">
      <ForgotForm />
    </AuthShell>
  );
}
