'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { StaffHeading } from '../_components/bits';
import { passwordProblem, PASSWORD_MIN } from '@/lib/staff/password';
import { afterPasswordSet } from './actions';

type Phase = 'checking' | 'ready' | 'invalid';

/**
 * Establishes the session from the email link — `token_hash`+`type` (verifyOtp), `code` (PKCE exchange) or an
 * implicit-flow `#access_token` fragment — then lets the staff member choose a password.
 */
export function SetPasswordForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState<string | null>(null);
  const [kind, setKind] = useState<string>(sp.get('type') ?? 'invite');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const sb = createClient();
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const linkError = sp.get('error_description') ?? hash.get('error_description');
      const tokenHash = sp.get('token_hash');
      const type = (sp.get('type') ?? hash.get('type') ?? 'invite') as EmailOtpType;
      const code = sp.get('code');
      setKind(type);
      try {
        if (linkError) throw new Error(linkError);
        if (tokenHash) {
          const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: type === 'recovery' ? 'recovery' : type === 'invite' ? 'invite' : type });
          if (error) throw error;
        } else if (hash.get('access_token') && hash.get('refresh_token')) {
          const { error } = await sb.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
          if (error) throw error;
        } else if (code) {
          // the browser client may already have exchanged it while initialising
          const { data: s } = await sb.auth.getSession();
          if (!s.session) {
            const { error } = await sb.auth.exchangeCodeForSession(code);
            if (error) throw error;
          }
        }
        const { data: u } = await sb.auth.getUser();
        if (!u.user) throw new Error('This link is invalid or has expired.');
        setEmail(u.user.email ?? null);
        window.history.replaceState(null, '', '/staff/set-password');
        setPhase('ready');
      } catch (e) {
        setErr((e as Error).message || 'This link is invalid or has expired.');
        setPhase('invalid');
      }
    })();
  }, [sp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw, pw2);
    if (problem) return setErr(problem);
    setBusy(true); setErr(null);
    const sb = createClient();
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      if (/aal2|assurance|mfa/i.test(error.message)) {
        router.push(`/staff/verify?next=${encodeURIComponent('/staff/set-password')}`);
        return;
      }
      return setErr(/same|different from the old/i.test(error.message) ? 'Choose a password you have not used before.' : error.message);
    }
    const { next } = await afterPasswordSet(kind);
    router.replace(next);
    router.refresh();
  }

  if (phase === 'checking') return <div className="flex flex-col gap-5"><StaffHeading title="Checking your link…" /><div className="h-40 rounded-[10px] bg-white/60 animate-pulse" aria-hidden /></div>;

  if (phase === 'invalid') {
    return (
      <div className="flex flex-col gap-5">
        <StaffHeading title="This link has expired" hint="Invite links work once and expire after 24 hours." />
        {err && <p className="text-sm text-bad m-0" role="alert">{err}</p>}
        <p className="text-sm text-muted m-0">Ask an Admin to resend your invite, or request a new reset link.</p>
        <div className="flex gap-3">
          <Link href="/staff/forgot" className="btn btn-primary">Send a new reset link</Link>
          <Link href="/staff/login" className="btn btn-ghost">Back to sign-in</Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <StaffHeading
        title={kind === 'recovery' ? 'Choose a new password' : 'Set your password'}
        hint={<>For {email ?? 'your staff account'}. Next you will set up two-step verification.</>}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="np" className="text-sm font-semibold">New password</label>
        <input id="np" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className="input min-h-12" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="np-hint" />
        <span id="np-hint" className="text-[13px] text-muted">At least {PASSWORD_MIN} characters, with a letter and a number.</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="np2" className="text-sm font-semibold">Repeat password</label>
        <input id="np2" type="password" required autoComplete="new-password" className="input min-h-12" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </div>
      {err && <p className="text-sm text-bad m-0" role="alert">{err}</p>}
      <button className="btn btn-primary w-full min-h-[50px]" disabled={busy}>{busy ? 'Saving…' : 'Save password and continue'}</button>
    </form>
  );
}
