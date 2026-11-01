'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';
import { checkCustomerSignupEmail, staffRedirectAfterCustomerSignIn } from '@/lib/staff/customer-guard';
import { customerSignIn, customerSignUp } from './actions';

type Step = 'email' | 'verify';

export function AuthForm({ initialMode, next, initialError }: { initialMode: 'signup' | 'login'; next: string; initialError?: string }) {
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
    router.push(staffTarget ?? (mode === 'signup' ? '/onboarding' : next)); router.refresh();
  }

  const steps = ['Email', 'Verify', 'Profile'];
  const stepIdx = step === 'email' ? 0 : 1;
  return (
    <div>
      {mode === 'signup' && (
        <div className="grid grid-cols-3 gap-2 mb-8" aria-label="Progress">
          {steps.map((s, i) => (
            <div key={s}><div className={cn('h-1 rounded-full', i <= stepIdx ? 'bg-blue' : 'bg-line')} /><div className={cn('mt-2 text-xs', i <= stepIdx ? 'font-semibold text-navy' : 'text-muted')}>{s}</div></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 bg-[#E9ECF1] rounded-[10px] p-1 mb-7" role="tablist">
        {(['signup', 'login'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setStep('email'); setErr(null); }}
            className={cn('min-h-11 rounded-[8px] font-semibold', mode === m ? 'bg-white shadow-sm text-navy' : 'text-muted')}>{m === 'signup' ? 'Sign up' : 'Log in'}</button>
        ))}
      </div>

      {step === 'email' ? (
        <>
          <h2 className="text-[28px] font-semibold">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
          <p className="text-sm text-muted mt-1">{mode === 'signup' ? 'Free for buyers. Suppliers are verified before going live.' : 'Log in to your Octopus B2B account.'}</p>
          <form onSubmit={submit} className="space-y-5 mt-6">
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input id="email" type="email" required autoComplete="email" className="input min-h-12" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <div className="flex justify-between items-baseline">
                <label htmlFor="password" className="label">Password</label>
                {mode === 'login' && <Link href="/forgot" className="text-[13px] font-semibold text-blue">Forgot password?</Link>}
              </div>
              <input id="password" type="password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="input min-h-12" value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'signup' && <p className="text-sm text-muted mt-2">At least 8 characters, with a number.</p>}
            </div>
            {err && <p className="text-sm text-bad" role="alert">{err}</p>}
            <button className="btn btn-primary w-full min-h-[50px]" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account with email' : 'Log in'}</button>
            <button type="button" onClick={emailCode} disabled={!email || busy} className="w-full text-sm font-semibold text-blue disabled:opacity-50">Email me a 6-digit code instead</button>
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
          <button type="button" className="w-full text-sm font-semibold text-blue" onClick={() => setStep('email')}>Use a different email</button>
        </form>
      )}
    </div>
  );
}

