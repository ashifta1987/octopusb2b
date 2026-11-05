'use client';
import { PasswordInput } from '@/components/password/password-input';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { staffSignIn, type SignInState } from './actions';
import { StaffHeading, LockNotice } from '../_components/bits';

function fmtTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function StaffLoginForm({ next, initialError, notice, emailDomain, attempts, minutes }: {
  next: string; initialError: string | null; notice: string | null; emailDomain: string; attempts: number; minutes: number;
}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(staffSignIn, initialError ? { error: initialError } : null);
  // controlled so a wrong password doesn't wipe the email (React resets uncontrolled fields after a form action)
  const [email, setEmail] = useState('');
  const until = fmtTime(state?.lockedUntil);
  return (
    <div className="flex flex-col gap-5">
      <StaffHeading title="Sign in to the back office" hint="Use the work account Admin created for you." />
      {notice && <div role="status" className="border border-line bg-blue-soft rounded-[10px] px-3.5 py-3 text-[13px] leading-[1.45] text-[#1E4F9C]">{notice}</div>}
      <form action={action} className="flex flex-col gap-5" noValidate={false}>
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="se" className="text-sm font-semibold">Work email</label>
          <input id="se" name="email" type="email" required autoComplete="username" className="input min-h-12" placeholder={`name@${emailDomain}`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-baseline">
            <label htmlFor="sp" className="text-sm font-semibold">Password</label>
            <Link href="/staff/forgot" className="text-[13px] font-semibold text-blue">Forgot password?</Link>
          </div>
          <PasswordInput id="sp" name="password" required autoComplete="current-password" className="input min-h-12" />
        </div>
        {state?.error && (
          <div role="alert" className="text-sm text-bad">
            <p className="m-0">{state.error}{until && <> Try again after <strong>{until}</strong>.</>}</p>
            {typeof state.remaining === 'number' && !until && (
              <p className="m-0 mt-1">{state.remaining} attempt{state.remaining === 1 ? '' : 's'} left before the account is locked.</p>
            )}
            {state.notStaff && <p className="m-0 mt-1"><Link href="/login" className="text-blue font-semibold">Go to Customer login</Link></p>}
          </div>
        )}
        <button className="btn btn-primary w-full min-h-[50px]" disabled={pending}>{pending ? 'Signing in…' : 'Continue'}</button>
      </form>
      <LockNotice>After {attempts} wrong attempts the account is locked for {minutes} minutes and Admin is notified.</LockNotice>
      <span className="text-[13px] text-muted text-center">Not Octopus staff? <Link href="/login" className="text-blue font-semibold">Customer login</Link></span>
    </div>
  );
}
