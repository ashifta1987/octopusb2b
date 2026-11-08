'use client';
import { PasswordInput } from '@/components/password/password-input';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { PASSWORD_MIN } from '@/lib/staff/password';
import { BackupCodesPanel } from '../_components/backup-codes';
import { changeStaffPassword, regenerateBackupCodes, signOutEverywhere, updateStaffProfile, prepareAddAuthenticator, authenticatorAdded, removeAuthenticator, type Result } from './actions';
import { createClient } from '@/lib/supabase/client';

function Msg({ r }: { r: Result | null }) {
  if (!r) return null;
  return r.ok
    ? <p role="status" className="text-sm text-ok m-0">✓ {r.message ?? 'Saved.'}</p>
    : <p role="alert" className="text-sm text-bad m-0">{r.error}</p>;
}

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(updateStaffProfile, null);
  return (
    <form action={action} className="grid gap-4">
      <div><label htmlFor="pf-name" className="label">Full name</label><input id="pf-name" name="full_name" required defaultValue={fullName} className="input" /></div>
      <div><label htmlFor="pf-phone" className="label">Phone</label><input id="pf-phone" name="phone" type="tel" defaultValue={phone} className="input" /></div>
      <Msg r={state} />
      <div><button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button></div>
    </form>
  );
}

export function PasswordForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<Result | null, FormData>(changeStaffPassword, null);
  useEffect(() => {
    if (state && !state.ok && state.stepUp) router.push(stepUpRedirect('/staff/account#password'));
  }, [state, router]);
  return (
    <form action={action} className="grid gap-4">
      <div>
        <label htmlFor="cp-new" className="label">New password</label>
        <PasswordInput id="cp-new" name="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className="input" aria-describedby="cp-hint" />
        <p id="cp-hint" className="text-[13px] text-muted mt-1">At least {PASSWORD_MIN} characters, with a letter and a number.</p>
      </div>
      <div><label htmlFor="cp-confirm" className="label">Repeat new password</label><PasswordInput id="cp-confirm" name="confirm" required autoComplete="new-password" className="input" /></div>
      <Msg r={state} />
      <div><button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Change password'}</button></div>
    </form>
  );
}

export function BackupCodesButton({ email, disabled }: { email: string; disabled?: boolean }) {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!window.confirm('Create 10 new backup codes? Your current backup codes will stop working.')) return;
    setBusy(true); setErr(null);
    const r = await regenerateBackupCodes();
    setBusy(false);
    if (r.ok) return setCodes(r.codes);
    if (r.stepUp) return router.push(stepUpRedirect('/staff/account#2fa'));
    setErr(r.error);
  }

  if (codes) return <BackupCodesPanel codes={codes} email={email} doneLabel="Done" onDone={() => { setCodes(null); router.refresh(); }} />;
  return (
    <div className="grid gap-2">
      <div><button type="button" className="btn btn-ghost" onClick={run} disabled={busy || disabled}>{busy ? 'Creating…' : 'Regenerate backup codes'}</button></div>
      {err && <p role="alert" className="text-sm text-bad m-0">{err}</p>}
    </div>
  );
}

export function SignOutEverywhere() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!window.confirm('Sign out of every device and browser, including this one?')) return;
    setBusy(true); setErr(null);
    const r = await signOutEverywhere();
    setBusy(false);
    if (r && !r.ok) {
      if (r.stepUp) return router.push(stepUpRedirect('/staff/account#sessions'));
      setErr(r.error);
    }
  }
  return (
    <>
      <button type="button" className="btn btn-danger" onClick={run} disabled={busy}>{busy ? 'Signing out…' : 'Sign out everywhere'}</button>
      {err && <p role="alert" className="text-sm text-bad m-0 w-full">{err}</p>}
    </>
  );
}

/* ───────── 2FA devices (8 Nov 2026): list, add another phone, remove one ───────── */
type Device = { id: string; name: string; added: string };

export function AuthenticatorDevices({ devices }: { devices: Device[] }) {
  const router = useRouter();
  const [step, setStep] = useState<'idle' | 'name' | 'scan'>('idle');
  const [name, setName] = useState(`Phone ${devices.length + 1}`);
  const [enr, setEnr] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function begin() {
    setErr(null); setMsg(null); setBusy(true);
    const r = await prepareAddAuthenticator();
    setBusy(false);
    if (!r.ok) { if (r.stepUp) return router.push(stepUpRedirect('/staff/account#2fa')); return setErr(r.error); }
    setStep('name');
  }

  async function startEnroll(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) return setErr('Give the phone a name, e.g. "Work phone".');
    if (devices.some((d) => d.name.toLowerCase() === n.toLowerCase())) return setErr('You already have an authenticator with that name.');
    setBusy(true); setErr(null);
    const sb = createClient();
    // drop half-finished enrolments from earlier attempts
    const { data: list } = await sb.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: n, issuer: 'Octopus B2B' });
    setBusy(false);
    if (error || !data) return setErr(error?.message ?? 'Could not start. Try again.');
    setEnr({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setStep('scan');
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enr || !/^\d{6}$/.test(code)) return setErr('Enter the 6-digit code shown on the NEW phone.');
    setBusy(true); setErr(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enr.factorId, code });
    if (error) { setBusy(false); setCode(''); return setErr('That code did not match. Wait for a new code on the new phone and try again.'); }
    const r = await authenticatorAdded(enr.factorId);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setMsg(r.message ?? 'Added.'); setStep('idle'); setEnr(null); setCode('');
    router.refresh();
  }

  async function cancel() {
    if (enr) await createClient().auth.mfa.unenroll({ factorId: enr.factorId }).catch(() => {});
    setStep('idle'); setEnr(null); setCode(''); setErr(null);
  }

  async function remove(d: Device) {
    if (!window.confirm(`Remove "${d.name}"? Codes from that phone will stop working.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    const r = await removeAuthenticator(d.id);
    setBusy(false);
    if (!r.ok) { if (r.stepUp) return router.push(stepUpRedirect('/staff/account#2fa')); return setErr(r.error); }
    setMsg(r.message ?? 'Removed.');
    router.refresh();
  }

  return (
    <div className="grid gap-3" data-testid="mfa-devices">
      {devices.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-[10px]">
          {devices.map((d) => (
            <li key={d.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
              <span><span className="font-semibold block">{d.name}</span><span className="text-muted text-[13px]">Added {d.added}</span></span>
              <span className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-ok">✓ Active</span>
                {devices.length > 1 && <button type="button" className="btn btn-ghost btn-sm text-bad min-h-11" onClick={() => remove(d)} disabled={busy}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {step === 'idle' && devices.length > 0 && devices.length < 5 && (
        <div><button type="button" className="btn btn-ghost min-h-11" onClick={begin} disabled={busy} data-testid="add-authenticator">{busy ? 'Checking…' : '+ Add another phone'}</button></div>
      )}
      {step === 'name' && (
        <form onSubmit={startEnroll} className="rounded-[10px] border border-line p-4 grid gap-3">
          <label htmlFor="mfa-name" className="label">Name for the new phone</label>
          <input id="mfa-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <div className="flex gap-2"><button type="submit" className="btn btn-primary min-h-11" disabled={busy}>{busy ? 'Starting…' : 'Show QR code'}</button><button type="button" className="btn btn-ghost min-h-11" onClick={cancel}>Cancel</button></div>
        </form>
      )}
      {step === 'scan' && enr && (
        <form onSubmit={confirm} className="rounded-[10px] border border-line p-4 grid gap-3" data-testid="mfa-enroll">
          <p className="text-sm">On the <b>new phone</b>, open Google Authenticator → <b>+</b> → <b>Scan a QR code</b>.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enr.qr} alt="QR code for the new authenticator" width={180} height={180} className="bg-white p-2 border border-line rounded-[8px]" />
          <details className="text-[13px]"><summary className="cursor-pointer text-coral-text">Can&apos;t scan? Enter the key instead</summary><code className="mono break-all block mt-1" data-testid="mfa-secret">{enr.secret}</code></details>
          <label htmlFor="mfa-code" className="label">6-digit code from the new phone</label>
          <input id="mfa-code" className="input mono tracking-[.3em] max-w-[180px]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className="flex gap-2"><button type="submit" className="btn btn-primary min-h-11" disabled={busy}>{busy ? 'Checking…' : 'Confirm and add'}</button><button type="button" className="btn btn-ghost min-h-11" onClick={cancel}>Cancel</button></div>
        </form>
      )}
      {msg && <p role="status" className="text-sm text-ok m-0">✓ {msg}</p>}
      {err && <p role="alert" className="text-sm text-bad m-0">{err}</p>}
    </div>
  );
}
