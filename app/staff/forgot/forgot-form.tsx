'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { StaffHeading } from '../_components/bits';
import { requestStaffReset, type ForgotState } from './actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestStaffReset, null);
  return (
    <div className="flex flex-col gap-5">
      <StaffHeading title="Reset your password" hint="Enter your work email. If it belongs to an Octopus staff account, we send a link to set a new password." />
      {state?.sent ? (
        <div role="status" className="border border-line bg-white rounded-[10px] px-4 py-4 text-sm leading-[1.5]">
          If that email belongs to a staff account, a reset link is on its way. The link works once and expires soon. Check your spam folder if it doesn’t arrive.
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fe" className="text-sm font-semibold">Work email</label>
            <input id="fe" name="email" type="email" required autoComplete="username" className="input min-h-12" />
          </div>
          {state?.error && <p className="text-sm text-bad m-0" role="alert">{state.error}</p>}
          <button className="btn btn-primary w-full min-h-[50px]" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="text-[13px] text-muted m-0">Lost your phone instead? Ask an Admin to reset your two-step verification.</p>
      <Link href="/staff/login" className="text-[15px] font-semibold text-blue">Back to sign-in</Link>
    </div>
  );
}
