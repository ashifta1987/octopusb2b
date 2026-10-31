import { Suspense } from 'react';
import { StaffFrame, FrameFallback } from '../_components/frame';
import { SetPasswordForm } from './set-password-form';

export const metadata = { title: 'Set your password · Staff' };

/** Invite + reset landing (SPEC §17.3): the email link brings a one-time session; set a password, then 2FA. */
export default function StaffSetPasswordPage() {
  return (
    <StaffFrame step={0}>
      <Suspense fallback={<FrameFallback />}>
        <SetPasswordForm />
      </Suspense>
    </StaffFrame>
  );
}
