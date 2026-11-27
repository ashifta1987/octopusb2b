'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, Field, Input, Icon } from '@octopus/ui';
import { createClient } from '@/lib/supabase/client';
import { onboardingHref } from '@/lib/signup-service';
import { checkCustomerSignupEmail, staffRedirectAfterCustomerSignIn } from '@/lib/staff/customer-guard';
import { customerSignIn, customerSignUp } from '@/app/(auth)/actions';

type Step = 'email' | 'password' | 'create' | 'verify';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * "Work email · Continue with email" (Auth_SignIn) on top of TODAY's e-mail method, unchanged (app/(auth)/auth-form.tsx):
 *   email → password → customerSignIn (server action: per-IP rate limit, 5-strikes lockout, audit) — or
 *   email → "Create your account" → password → customerSignUp → 6-digit code — or
 *   "Email me a 6-digit code instead" → supabase.auth.signInWithOtp + verifyOtp (staff continue to /staff/verify).
 * No magic link is invented: the code e-mail also carries Supabase's confirmation link, handled by /auth/callback.
 * Phones: same, full width.
 */
export function EmailSignIn({ next, initialEmail = '', initialStep = 'email' }: { next: string; initialEmail?: string; initialStep?: Step }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeMode, setCodeMode] = useState<'login' | 'signup'>('login');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const go = (to: string) => {
    router.push(to);
    router.refresh();
  };
  const reset = (s: Step) => {
    setErr(null);
    setInfo(null);
    setPassword('');
    setStep(s);
  };

  function continueWithEmail(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!EMAIL_RE.test(v)) return setErr('Enter your work email, for example name@company.com.');
    setEmail(v);
    reset('password');
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await customerSignIn({ email, password, next });
      if (!r.ok) {
        const until = r.lockedUntil ? new Date(r.lockedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
        setErr(r.error + (until ? ` Try again after ${until}.` : '') + (typeof r.remaining === 'number' && r.remaining > 0 && r.remaining < 3 ? ` ${r.remaining} attempt${r.remaining === 1 ? '' : 's'} left before the account is locked.` : ''));
        return;
      }
      go(r.redirect ?? next);
    } catch {
      setErr('We couldn’t sign you in. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8 || !/\d/.test(password)) return setErr('Password needs at least 8 characters, with a number.');
    setBusy(true);
    try {
      const r = await customerSignUp({ email, password, next });
      if (!r.ok) return setErr(r.error);
      if (r.redirect) return go(r.redirect);
      setCodeMode('signup');
      setStep('verify');
      setInfo(`We sent a 6-digit code to ${email}.`);
    } catch {
      setErr('We couldn’t create your account. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function emailCode(mode: 'login' | 'signup') {
    setErr(null);
    setBusy(true);
    if (mode === 'signup') {
      const guard = await checkCustomerSignupEmail(email);
      if (!guard.ok) {
        setBusy(false);
        return setErr(guard.error);
      }
    }
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: callback(), shouldCreateUser: mode === 'signup' } });
    setBusy(false);
    if (error) return setErr(error.message);
    setCodeMode(mode);
    setStep('verify');
    setInfo(`We sent a 6-digit code to ${email}.`);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await createClient().auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) return setErr(error.message);
    const staffTarget = codeMode === 'login' ? await staffRedirectAfterCustomerSignIn() : null;
    go(staffTarget ?? (codeMode === 'signup' ? onboardingHref(next) : next));
  }

  const errorLine = err ? (
    <p role="alert" className="text-ods-small font-medium text-ods-danger" data-testid="email-error">
      {err}
    </p>
  ) : null;
  const back = (to: Step, label: string) => (
    <button type="button" onClick={() => reset(to)} className="inline-flex min-h-ods-control items-center gap-1 self-start text-ods-small font-semibold text-ods-blue underline-offset-2 hover:underline">
      <Icon icon={ArrowLeft} size="xs" />
      {label}
    </button>
  );
  const who = (
    <p className="text-ods-small text-ods-slate">
      Work email: <span className="font-semibold break-all text-ods-text">{email}</span>
    </p>
  );

  if (step === 'email') {
    return (
      <form onSubmit={continueWithEmail} noValidate className="flex flex-col gap-4" data-testid="email-form" data-step="email">
        <Field label="Work email" error={err ?? undefined}>
          <Input type="email" name="email" autoComplete="email" inputMode="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Button type="submit" variant="secondary" fullWidth data-testid="email-continue">
          Continue with email
        </Button>
      </form>
    );
  }

  if (step === 'password' || step === 'create') {
    const creating = step === 'create';
    return (
      <form onSubmit={creating ? signUp : signIn} className="flex flex-col gap-4" data-testid="email-form" data-step={step}>
        {back('email', 'Use a different email')}
        {who}
        <Field
          label={creating ? 'Create a password' : 'Password'}
          hint={creating ? 'At least 8 characters, with a number.' : undefined}
        >
          <Input type="password" name="password" autoComplete={creating ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {!creating ? (
          <Link href="/forgot" className="inline-flex min-h-ods-control items-center self-start text-ods-small font-semibold text-ods-blue underline underline-offset-2">
            Forgot password?
          </Link>
        ) : null}
        {errorLine}
        <Button type="submit" variant="primary" fullWidth loading={busy} loadingText="Please wait…" data-testid="email-submit">
          {creating ? 'Create my account' : 'Sign in'}
        </Button>
        <Button type="button" variant="ghost" fullWidth disabled={busy} onClick={() => emailCode(creating ? 'signup' : 'login')}>
          Email me a 6-digit code instead
        </Button>
        <p className="text-ods-small text-ods-slate">
          {creating ? 'Already have an account? ' : 'New to Octopus B2B? '}
          <button type="button" onClick={() => reset(creating ? 'password' : 'create')} className="inline-flex min-h-ods-control items-center font-semibold text-ods-blue underline underline-offset-2">
            {creating ? 'Sign in instead' : 'Create your free account'}
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-4" data-testid="email-form" data-step="verify">
      {back('email', 'Use a different email')}
      <p className="text-ods-body font-semibold text-ods-navy">Check your email</p>
      {info ? <p className="text-ods-small text-ods-slate" role="status">{info} You can also click the link in the email.</p> : null}
      <Field label="6-digit code">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} required className="font-mono tracking-[0.3em]" />
      </Field>
      {errorLine}
      <Button type="submit" variant="primary" fullWidth loading={busy} loadingText="Verifying…">
        Verify
      </Button>
    </form>
  );
}
