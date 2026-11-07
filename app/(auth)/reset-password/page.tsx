import { Suspense } from 'react';
import { AuthShell } from '../auth-page';
import { ResetPasswordForm } from './reset-form';

export const metadata = { title: 'Choose a new password' };

/** Landing page of the customer reset link (ADDON-22). */
export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" sub="Pick a password you don't use anywhere else.">
      <Suspense fallback={<div className="h-40 rounded-[10px] bg-white/60 animate-pulse" aria-hidden />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
