'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { StaffHeading, LockNotice } from '../_components/bits';
import { CodeInput } from '../_components/code-input';
import { BackupCodesPanel } from '../_components/backup-codes';
import { staffSignOut } from '@/lib/staff/actions';
import { completeVerification, finishEnrolment, recordTotpFailure, redeemBackupCode, type FailResult } from './actions';

type Props = {
  mode: 'challenge' | 'enrol';
  factorId: string | null;
  next: string;
  self: string;
  stepUp: boolean;
  email: string;
  trustHours: number;
  lockedUntil: string | null;
  startInBackup: boolean;
};

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function failMessage(f: FailResult) {
  if (f.locked) return `Too many wrong codes. The account is locked until ${fmtTime(f.lockedUntil)} and Admin has been notified.`;
  return `That code is not correct.${typeof f.remaining === 'number' ? ` ${f.remaining} attempt${f.remaining === 1 ? '' : 's'} left before the account is locked.` : ''}`;
}

export function VerifyFlow(p: Props) {
  const [view, setView] = useState<'code' | 'backup'>(p.startInBackup && p.mode === 'challenge' ? 'backup' : 'code');
  if (p.lockedUntil) {
    return (
      <div className="flex flex-col gap-5">
        <StaffHeading title="Account locked" hint="Too many wrong passwords or codes." />
        <LockNotice>This account is locked until <strong>{fmtTime(p.lockedUntil)}</strong> and Admin has been notified. Try again later or ask an Admin to unlock it.</LockNotice>
        <form action={staffSignOut}><button className="btn btn-ghost w-full">Sign out</button></form>
      </div>
    );
  }
  if (p.mode === 'enrol') return <Enrol {...p} />;
  return view === 'backup' ? <BackupCode {...p} onBack={() => setView('code')} /> : <Challenge {...p} onBackup={() => setView('backup')} />;
}

function TrustBox({ hours, checked, onChange }: { hours: number; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-sm leading-[1.45] text-[#3B4556] cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-[18px] h-[18px] mt-0.5 accent-blue flex-none" />
      Trust this computer for {hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hours`} — you won&apos;t be asked for the code again on it until then
    </label>
  );
}

function BackLink() {
  return (
    <form action={staffSignOut}>
      <button type="submit" className="text-[15px] font-semibold text-blue">Back</button>
    </form>
  );
}

/* ───────── Challenge (has a verified authenticator) ───────── */
function Challenge(p: Props & { onBackup: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code) || !p.factorId) return setErr('Enter the 6-digit code from your authenticator app.');
    setBusy(true); setErr(null);
    const sb = createClient();
    const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: p.factorId });
    const { error } = chErr ? { error: chErr } : await sb.auth.mfa.verify({ factorId: p.factorId, challengeId: ch!.id, code });
    if (error) {
      const f = await recordTotpFailure();
      setBusy(false); setCode('');
      if (f.locked) { router.replace('/staff/login?locked=1'); return; }
      return setErr(failMessage(f));
    }
    const r = await completeVerification({ trusted, next: p.next, stepUp: p.stepUp });
    if (r?.error) { setBusy(false); setErr(r.error); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <StaffHeading
        title={p.stepUp ? 'Confirm it’s you' : 'Enter your 6-digit code'}
        hint={p.stepUp
          ? 'This action needs a fresh code. Open your authenticator app and enter the code for Octopus B2B.'
          : 'Open your authenticator app (Google Authenticator, Microsoft Authenticator or 1Password) and enter the code for Octopus B2B.'}
      />
      <CodeInput value={code} onChange={setCode} disabled={busy} />
      {!p.stepUp && <TrustBox hours={p.trustHours} checked={trusted} onChange={setTrusted} />}
      {err && <p className="text-sm text-bad m-0" role="alert">{err}</p>}
      <button className="btn btn-primary w-full min-h-[50px]" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
      <div className="flex justify-between items-center">
        <button type="button" onClick={p.onBackup} className="text-[15px] font-semibold text-blue">Use a backup code</button>
        {p.stepUp ? <button type="button" onClick={() => router.back()} className="text-[15px] font-semibold text-blue">Cancel</button> : <BackLink />}
      </div>
      {!p.stepUp && <p className="text-[13px] text-muted leading-[1.45] m-0">First sign-in? You will scan a QR code to set up two-step verification and save 10 backup codes.</p>}
    </form>
  );
}

/* ───────── Backup code (lost phone) ───────── */
function BackupCode(p: Props & { onBack: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await redeemBackupCode(code);
    if (!r.ok) {
      setBusy(false);
      if (r.locked) { router.replace('/staff/login?locked=1'); return; }
      return setErr(r.error + (typeof r.remaining === 'number' ? ` ${r.remaining} attempt${r.remaining === 1 ? '' : 's'} left.` : ''));
    }
    router.replace(p.self.replace(/[?&]mode=backup/, ''));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <StaffHeading title="Use a backup code" hint="Enter one of the 10 backup codes you saved when you set up two-step verification. You will then set up your authenticator app again." />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bc" className="text-sm font-semibold">Backup code</label>
        <input id="bc" value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" placeholder="K7QX-M2PA" className="input min-h-12 font-mono text-lg tracking-widest uppercase" autoFocus />
      </div>
      {err && <p className="text-sm text-bad m-0" role="alert">{err}</p>}
      <button className="btn btn-primary w-full min-h-[50px]" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Use backup code'}</button>
      <div className="flex justify-between items-center">
        <button type="button" onClick={p.onBack} className="text-[15px] font-semibold text-blue">Use my authenticator app</button>
        <BackLink />
      </div>
      <p className="text-[13px] text-muted leading-[1.45] m-0">No backup codes left? Ask an Admin to reset your two-step verification.</p>
    </form>
  );
}

/* ───────── First-time enrolment ───────── */
type Enrolment = { factorId: string; qr: string; secret: string };

function Enrol(p: Props) {
  const router = useRouter();
  const started = useRef(false);
  const [enr, setEnr] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const sb = createClient();
      // drop half-finished enrolments from earlier attempts
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, issuer: 'Octopus B2B' });
      if (error || !data) { setErr(error?.message ?? 'Could not start two-step setup. Reload the page.'); return; }
      setEnr({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!enr || !/^\d{6}$/.test(code)) return setErr('Enter the 6-digit code shown in your authenticator app.');
    setBusy(true); setErr(null);
    const sb = createClient();
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: enr.factorId, code });
    if (error) {
      const f = await recordTotpFailure();
      setBusy(false); setCode('');
      if (f.locked) { router.replace('/staff/login?locked=1'); return; }
      return setErr(failMessage(f));
    }
    const r = await finishEnrolment({ trusted });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setCodes(r.codes);
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-5">
        <StaffHeading title="Save your backup codes" hint="Two-step verification is on. Use a backup code if you ever lose your phone." />
        <BackupCodesPanel codes={codes} email={p.email} onDone={async () => {
          const r = await completeVerification({ trusted, next: p.next, stepUp: false });
          if (r?.error) setErr(r.error);
        }} />
        {err && <p className="text-sm text-bad m-0" role="alert">{err}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <StaffHeading title="Set up two-step verification" hint="Scan this QR code with your authenticator app (Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code it shows." />
      <div className="flex flex-col sm:flex-row gap-5 items-start">
        <div className="w-[176px] h-[176px] bg-white border border-line rounded-[10px] p-2 flex items-center justify-center flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {enr ? <img src={enr.qr} alt="QR code for your authenticator app" width={160} height={160} /> : <span className="text-[13px] text-muted">Preparing…</span>}
        </div>
        <div className="text-[13px] text-muted leading-[1.5]">
          <ol className="list-decimal pl-4 m-0 space-y-1">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan the QR code.</li>
            <li>Enter the 6-digit code below.</li>
          </ol>
          {enr && (
            <div className="mt-3">
              <button type="button" className="text-blue font-semibold" onClick={() => setShowSecret((v) => !v)} aria-expanded={showSecret}>Can’t scan? Enter a key instead</button>
              {showSecret && <div className="mt-2 font-mono text-[13px] text-navy break-all bg-white border border-line rounded-md px-2 py-1.5 select-all">{enr.secret}</div>}
            </div>
          )}
        </div>
      </div>
      <CodeInput value={code} onChange={setCode} disabled={busy || !enr} autoFocus={false} />
      <TrustBox hours={p.trustHours} checked={trusted} onChange={setTrusted} />
      {err && <p className="text-sm text-bad m-0" role="alert">{err}</p>}
      <button className="btn btn-primary w-full min-h-[50px]" disabled={busy || !enr || code.length !== 6}>{busy ? 'Verifying…' : 'Verify and continue'}</button>
      <div className="flex justify-end"><BackLink /></div>
      <p className="text-[13px] text-muted leading-[1.45] m-0">After this step you will get 10 backup codes. Save them — they are the only way back in if you lose your phone (or ask an Admin).</p>
    </form>
  );
}
