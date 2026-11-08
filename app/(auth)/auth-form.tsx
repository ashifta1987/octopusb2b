'use client';
import { PasswordInput } from '@/components/password/password-input';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onboardingHref } from '@/lib/signup-service';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { checkCustomerSignupEmail, staffRedirectAfterCustomerSignIn } from '@/lib/staff/customer-guard';
import { customerSignIn, customerSignUp } from './actions';

type Step = 'email' | 'verify';

export function AuthForm({ initialMode, next, initialError, google = false }: { initialMode: 'signup' | 'login'; next: string; initialError?: string; google?: boolean }) {
  const sb = createClient();
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  // Google (customers only, owner decision 5 Nov 2026) — Supabase OAuth; /auth/callback blocks staff emails
  async function signInWithGoogle() {
    setErr(null); setBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback?via=google&next=${encodeURIComponent(mode === 'signup' ? onboardingHref(next) : next)}`;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
    if (error) { setBusy(false); setErr(/not enabled/i.test(error.message) ? 'Google sign-in is not available right now. Use your email instead.' : error.message); }
  }

  // Email + password go through server actions: per-IP rate limit, 5-strikes lockout and audit log (ADDON-22).
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'signup') {
        if (password.length < 8 || !/\d/.test(password)) throw new Error('Password needs at least 8 characters, with a number.');
        const r = await customerSignUp({ email, password, next });
        if (!r.ok) throw new Error(r.error);
        if (r.redirect) return router.push(r.redirect);
        setStep('verify');
        setInfo(`We sent a 6-digit code to ${email}.`);
      } else {
        const r = await customerSignIn({ email, password, next });
        if (!r.ok) {
          const until = r.lockedUntil ? new Date(r.lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
          throw new Error(r.error + (until ? ` Try again after ${until}.` : '') + (typeof r.remaining === 'number' && r.remaining > 0 && r.remaining < 3 ? ` ${r.remaining} attempt${r.remaining === 1 ? '' : 's'} left before the account is locked.` : ''));
        }
        router.push(r.redirect ?? next); router.refresh();
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function emailCode() {
    setErr(null); setBusy(true);
    if (mode === 'signup') {
      const guard = await checkCustomerSignupEmail(email);
      if (!guard.ok) { setBusy(false); return setErr(guard.error); }
    }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: callback(), shouldCreateUser: mode === 'signup' } });
    setBusy(false);
    if (error) return setErr(error.message);
    setStep('verify'); setInfo(`We sent a 6-digit code to ${email}.`);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) return setErr(error.message);
    const staffTarget = mode === 'login' ? await staffRedirectAfterCustomerSignIn() : null;
    router.push(staffTarget ?? (mode === 'signup' ? onboardingHref(next) : next)); router.refresh();
  }

  const steps = ['Email', 'Verify', 'Profile'];
  const stepIdx = step === 'email' ? 0 : 1;
  return (
    <div>
      {mode === 'signup' && (
        <div className="grid grid-cols-3 gap-2 mb-8" aria-label="Progress">
          {steps.map((s, i) => (
            <div key={s}><div className={cn('h-1 rounded-full', i <= stepIdx ? 'bg-coral' : 'bg-line')} /><div className={cn('mt-2 text-xs', i <= stepIdx ? 'font-semibold text-ink' : 'text-muted')}>{s}</div></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 bg-fill rounded-[10px] p-1 mb-7" role="tablist">
        {(['signup', 'login'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setStep('email'); setErr(null); }}
            className={cn('min-h-11 rounded-[8px] font-semibold', mode === m ? 'bg-white shadow-sm text-ink' : 'text-muted')}>{m === 'signup' ? 'Sign up' : 'Log in'}</button>
        ))}
      </div>

      {step === 'email' ? (
        <>
          <h2 className="text-[28px] font-semibold">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
          <p className="text-sm text-muted mt-1">{mode === 'signup' ? 'Free for buyers. Suppliers are verified before going live.' : 'Log in to your Octopus B2B account.'}</p>
          {google && (
            <>
              <button type="button" onClick={signInWithGoogle} disabled={busy} className="btn btn-ghost w-full mt-6 min-h-[50px]">
                <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                Continue with Google
              </button>
              <div className="flex items-center gap-3 my-6 text-sm text-muted"><span className="flex-1 h-px bg-line" />or {mode === 'signup' ? 'sign up' : 'log in'} with email<span className="flex-1 h-px bg-line" /></div>
            </>
          )}
          <form onSubmit={submit} className={google ? 'space-y-5' : 'space-y-5 mt-6'}>
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input id="email" type="email" required autoComplete="email" className="input min-h-12" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <div className="flex justify-between items-baseline">
                <label htmlFor="password" className="label">Password</label>
                {mode === 'login' && <Link href="/forgot" className="inline-flex items-center min-h-11 text-[13px] font-semibold text-coral-text">Forgot password?</Link>}
              </div>
              <PasswordInput id="password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="input min-h-12" value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'signup' && <p className="text-sm text-muted mt-2">At least 8 characters, with a number.</p>}
            </div>
            {err && <p className="text-sm text-bad" role="alert">{err}</p>}
            <button className="btn btn-primary w-full min-h-[50px]" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account with email' : 'Log in'}</button>
            <button type="button" onClick={emailCode} disabled={!email || busy} className="w-full min-h-11 text-sm font-semibold text-coral-text disabled:opacity-50">Email me a 6-digit code instead</button>
          </form>
        </>
      ) : (
        <form onSubmit={verify} className="space-y-5">
          <h2 className="text-[28px] font-semibold">Check your email</h2>
          {info && <p className="text-sm text-muted">{info} You can also click the link in the email.</p>}
          <div>
            <label htmlFor="code" className="label">6-digit code</label>
            <input id="code" inputMode="numeric" pattern="[0-9]{6,8}" maxLength={8} required className="input min-h-12 mono text-xl tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {err && <p className="text-sm text-bad" role="alert">{err}</p>}
          <button className="btn btn-primary w-full min-h-[50px]" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
          <button type="button" className="w-full text-sm font-semibold text-coral-text" onClick={() => setStep('email')}>Use a different email</button>
        </form>
      )}
    </div>
  );
}

