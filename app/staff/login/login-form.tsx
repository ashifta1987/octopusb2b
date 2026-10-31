'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { staffSignIn, type SignInState } from './actions';
import { StaffHeading, LockNotice } from '../_components/bits';

function fmtTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function StaffLoginForm({ next, initialError, notice, googleDomain, attempts, minutes }: {
  next: string; initialError: string | null; notice: string | null; googleDomain: string; attempts: number; minutes: number;
}) {
  const [state, action, pending] = useActionState<SignInState, FormData>(staffSignIn, initialError ? { error: initialError } : null);
  const [gErr, setGErr] = useState<string | null>(null);
  const [gBusy, setGBusy] = useState(false);

  async function google() {
    setGErr(null); setGBusy(true);
    const sb = createClient();
    const verifyNext = `/staff/verify?next=${encodeURIComponent(next || '/staff/workspace')}`;
    const redirectTo = `${window.location.origin}/auth/callback?staff=1&next=${encodeURIComponent(verifyNext)}`;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { hd: googleDomain, prompt: 'select_account' } } });
    setGBusy(false);
    if (error) setGErr(error.message.includes('provider is not enabled') ? 'Google sign-in is not enabled yet. Use your work email and password.' : error.message);
  }

  const until = fmtTime(state?.lockedUntil);
  return (
    <div className="flex flex-col gap-5">
      <StaffHeading title="Sign in to the back office" hint="Use the work account Admin created for you." />
      {notice && <div role="status" className="border border-line bg-blue-soft rounded-[10px] px-3.5 py-3 text-[13px] leading-[1.45] text-[#1E4F9C]">{notice}</div>}
      <button type="button" onClick={google} disabled={gBusy} className="btn btn-ghost w-full min-h-[50px]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
        Sign in with Google (@{googleDomain})
      </button>
      {gErr && <p className="text-sm text-bad -mt-2" role="alert">{gErr}</p>}
      <div className="flex items-center gap-3 text-muted text-[13px]"><span className="flex-1 h-px bg-line" />or with email and password<span className="flex-1 h-px bg-line" /></div>
      <form action={action} className="flex flex-col gap-5" noValidate={false}>
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="se" className="text-sm font-semibold">Work email</label>
          <input id="se" name="email" type="email" required autoComplete="username" className="input min-h-12" placeholder={`name@${googleDomain}`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-baseline">
            <label htmlFor="sp" className="text-sm font-semibold">Password</label>
            <Link href="/staff/forgot" className="text-[13px] font-semibold text-blue">Forgot password?</Link>
          </div>
          <input id="sp" name="password" type="password" required autoComplete="current-password" className="input min-h-12" />
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
