'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { afterCustomerPasswordReset } from '../actions';

type Phase = 'checking' | 'ready' | 'invalid';

/**
 * Establishes the recovery session from the email link (token_hash, PKCE `code` or implicit `#access_token`),
 * then sets the new password. Other sessions are ended server-side afterwards.
 */
export function ResetPasswordForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState<string | null>(null);
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
      try {
        const linkError = sp.get('error_description') ?? hash.get('error_description');
        if (linkError) throw new Error(linkError);
        const tokenHash = sp.get('token_hash');
        const code = sp.get('code');
        if (tokenHash) {
          const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
          if (error) throw error;
        } else if (hash.get('access_token') && hash.get('refresh_token')) {
          const { error } = await sb.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
          if (error) throw error;
        } else if (code) {
          const { data: s } = await sb.auth.getSession();
          if (!s.session) {
            const { error } = await sb.auth.exchangeCodeForSession(code);
            if (error) throw error;
          }
        }
        const { data: u } = await sb.auth.getUser();
        if (!u.user) throw new Error('This link is invalid or has expired.');
        setEmail(u.user.email ?? null);
        window.history.replaceState(null, '', '/reset-password');
        setPhase('ready');
      } catch (e) {
        setErr((e as Error).message || 'This link is invalid or has expired.');
        setPhase('invalid');
      }
    })();
  }, [sp]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8 || !/\d/.test(pw)) return setErr('Password needs at least 8 characters, with a number.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true); setErr(null);
    const { error } = await createClient().auth.updateUser({ password: pw });
    if (error) {
      setBusy(false);
      return setErr(/same|different from the old/i.test(error.message) ? 'Choose a password you have not used before.' : error.message);
    }
    const { next } = await afterCustomerPasswordReset();
    router.replace(next);
    router.refresh();
  }

  if (phase === 'checking') return <div><h2 className="text-[28px] font-semibold">Checking your link…</h2><div className="mt-6 h-40 rounded-[10px] bg-white/60 animate-pulse" aria-hidden /></div>;
  if (phase === 'invalid') {
    return (
      <div>
        <h2 className="text-[28px] font-semibold">This link no longer works</h2>
        <p className="text-sm text-muted mt-2">{err} Reset links work once and expire after 1 hour.</p>
        <Link href="/forgot" className="btn btn-primary w-full min-h-[50px] mt-6">Send a new link</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-[28px] font-semibold">Choose a new password</h2>
        {email && <p className="text-sm text-muted mt-1">For {email}. You will be signed out on your other devices.</p>}
      </div>
      <div>
        <label htmlFor="np" className="label">New password</label>
        <input id="np" type="password" required autoComplete="new-password" className="input min-h-12" value={pw} onChange={(e) => setPw(e.target.value)} />
        <p className="text-sm text-muted mt-2">At least 8 characters, with a number.</p>
      </div>
      <div>
        <label htmlFor="np2" className="label">Repeat new password</label>
        <input id="np2" type="password" required autoComplete="new-password" className="input min-h-12" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </div>
      {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      <button className="btn btn-primary w-full min-h-[50px]" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
    </form>
  );
}
