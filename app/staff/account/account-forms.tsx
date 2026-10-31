'use client';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { PASSWORD_MIN } from '@/lib/staff/password';
import { BackupCodesPanel } from '../_components/backup-codes';
import { changeStaffPassword, regenerateBackupCodes, signOutEverywhere, updateStaffProfile, type Result } from './actions';

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
        <input id="cp-new" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" className="input" aria-describedby="cp-hint" />
        <p id="cp-hint" className="text-[13px] text-muted mt-1">At least {PASSWORD_MIN} characters, with a letter and a number.</p>
      </div>
      <div><label htmlFor="cp-confirm" className="label">Repeat new password</label><input id="cp-confirm" name="confirm" type="password" required autoComplete="new-password" className="input" /></div>
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
