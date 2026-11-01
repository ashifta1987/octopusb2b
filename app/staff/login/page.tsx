import { Suspense } from 'react';
import { StaffFrame, FrameFallback } from '../_components/frame';
import { StaffLoginForm } from './login-form';
import { ExpiryRecorder } from './expiry-recorder';
import { getStaffSecurity } from '@/lib/staff/server';

export const metadata = { title: 'Staff sign-in' };

type SP = { next?: string; expired?: string; ip?: string; error?: string; locked?: string; reset?: string };

async function LoginBody({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sec = await getStaffSecurity();
  const notice =
    sp.expired ? 'Your session ended (30 minutes idle or 12 hours in total). Sign in again.'
    : sp.ip ? 'Your role can only sign in from an office IP address. Connect from the office network or ask an Admin.'
    : sp.locked ? 'Too many wrong codes. The account is locked for a while and Admin has been notified.'
    : sp.reset ? 'Your password was changed. Sign in with the new password.'
    : null;
  return (
    <>
      {sp.expired && <ExpiryRecorder />}
      <StaffLoginForm
        next={sp.next ?? ''}
        initialError={sp.error ?? null}
        notice={notice}
        emailDomain={sec.google_domain}
        attempts={sec.lockout_attempts}
        minutes={sec.lockout_minutes}
      />
    </>
  );
}

/** StaffLogin.png — step 1: work email + password (Google sign-in removed 1 Nov 2026). */
export default function StaffLoginPage(props: { searchParams: Promise<SP> }) {
  return (
    <StaffFrame step={0}>
      <Suspense fallback={<FrameFallback />}>
        <LoginBody {...props} />
      </Suspense>
    </StaffFrame>
  );
}
