'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { requestCustomerReset, type ResetState } from '../actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(requestCustomerReset, null);
  return (
    <div>
      <h2 className="text-[28px] font-semibold">Reset your password</h2>
      <p className="text-sm text-muted mt-1">Enter the email you use for Octopus B2B. We send a link to choose a new password.</p>
      {state?.sent ? (
        <div role="status" className="mt-6 card px-4 py-4 text-sm leading-[1.5]">
          If an account exists for that email, a reset link is on its way. The link works once and expires after 1 hour. Check your spam folder if it doesn’t arrive.
        </div>
      ) : (
        <form action={action} className="space-y-5 mt-6">
          <div>
            <label htmlFor="fe" className="label">Work email</label>
            <input id="fe" name="email" type="email" required autoComplete="email" className="input min-h-12" placeholder="you@company.com" />
          </div>
          {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
          <button className="btn btn-primary w-full min-h-[50px]" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <Link href="/login" className="inline-block mt-6 text-[15px] font-semibold text-coral-text">Back to log in</Link>
    </div>
  );
}
