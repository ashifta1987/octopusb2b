import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { StaffFrame, FrameFallback } from '../_components/frame';
import { VerifyFlow } from './verify-flow';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { getStaffSecurity, isStaffUser, safeNext, staffSessionValid } from '@/lib/staff/server';

export const metadata = { title: 'Two-step verification · Staff' };

type SP = { next?: string; reason?: string; mode?: string };

async function VerifyBody({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, '/staff/workspace');
  const stepUp = sp.reason === 'step_up';
  const self = `/staff/verify?next=${encodeURIComponent(next)}${stepUp ? '&reason=step_up' : ''}`;

  const sb = await createClient();
  const { data: claims } = await sb.auth.getClaims();
  const c = claims?.claims;
  if (!c?.sub) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
  const uid = c.sub as string;
  const email = (c.email as string) ?? '';
  if (!(await isStaffUser(uid))) redirect('/login');

  const sec = await getStaffSecurity();
  const { data: factors } = await sb.auth.mfa.listFactors();
  const verified = (factors?.totp ?? []).filter((f) => f.status === 'verified');
  const cookieOk = await staffSessionValid(uid);

  // already verified in this staff session and not a step-up → carry on
  if (c.aal === 'aal2' && cookieOk && !stepUp) redirect(next);

  const { data: lock } = email ? await createAdminClient().rpc('auth_lock_status', { p_email: email }) : { data: null };
  const ls = lock as { locked: boolean; locked_until: string | null } | null;

  return (
    <VerifyFlow
      key={verified.length ? 'challenge' : 'enrol'}
      mode={verified.length ? 'challenge' : 'enrol'}
      factorId={verified[0]?.id ?? null}
      next={next}
      self={self}
      stepUp={stepUp}
      email={email}
      trustHours={sec.trust_hours}
      lockedUntil={ls?.locked ? ls.locked_until : null}
      startInBackup={sp.mode === 'backup'}
    />
  );
}

/** StaffLogin-2-verify.png — step 2: TOTP challenge, or first-time enrolment (QR + 10 backup codes). Also the step-up re-check. */
export default function StaffVerifyPage(props: { searchParams: Promise<SP> }) {
  return (
    <StaffFrame step={1}>
      <Suspense fallback={<FrameFallback />}>
        <VerifyBody {...props} />
      </Suspense>
    </StaffFrame>
  );
}
