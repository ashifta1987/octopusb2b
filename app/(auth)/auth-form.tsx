'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/cn';

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

  async function google() {
    setErr(null);
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback() } });
    if (error) setErr(error.message.includes('provider is not enabled') ? 'Google sign-in is not enabled yet. Use email for now.' : error.message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'signup') {
        if (password.length < 8 || !/\d/.test(password)) throw new Error('Password needs at least 8 characters, with a number.');
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: callback() } });
        if (error) throw error;
        if (data.session) return router.push('/onboarding');
        setStep('verify');
        setInfo(`We sent a 6-digit code to ${email}.`);
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next); router.refresh();
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function emailCode() {
    setErr(null); setBusy(true);
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
    router.push(mode === 'signup' ? '/onboarding' : next); router.refresh();
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
          <button type="button" onClick={google} className="btn btn-ghost w-full mt-6 min-h-[50px]">
            <span className="w-5 h-5 rounded-full border-2 border-navy text-[10px] font-bold flex items-center justify-center" aria-hidden>G</span>Continue with Google
          </button>
          <div className="flex items-center gap-3 my-6 text-sm text-muted"><span className="flex-1 h-px bg-line" />or {mode === 'signup' ? 'sign up' : 'log in'} with email<span className="flex-1 h-px bg-line" /></div>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input id="email" type="email" required autoComplete="email" className="input min-h-12" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
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
