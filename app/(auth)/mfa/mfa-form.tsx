'use client';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Stage = { kind: 'loading' } | { kind: 'enrol'; factorId: string; qr: string; secret: string } | { kind: 'challenge'; factorId: string } | { kind: 'error'; message: string };

function qrSrc(qr: string) {
  return qr.startsWith('data:') ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}

/** Enrol a TOTP factor (QR + secret) or step up the session to aal2, then go to `next`. */
export function MfaForm({ next, email }: { next: string; email: string | null }) {
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // enrol only once (StrictMode runs effects twice in dev)
    started.current = true;
    (async () => {
      const sb = createClient();
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) { setStage({ kind: 'error', message: error.message }); return; }
      const verified = data.totp[0];
      if (verified) { setStage({ kind: 'challenge', factorId: verified.id }); return; }
      // Remove half-finished enrolments so a fresh QR code can be issued.
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status === 'unverified')) {
        await sb.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: en, error: e2 } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, issuer: 'Octopus B2B' });
      if (e2 || !en) { setStage({ kind: 'error', message: e2?.message ?? 'Could not start 2FA setup.' }); return; }
      setStage({ kind: 'enrol', factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret });
    })();
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage.kind !== 'enrol' && stage.kind !== 'challenge') return;
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) { setErr('Enter the 6-digit code from your authenticator app.'); return; }
    setBusy(true); setErr(null);
    const sb = createClient();
    const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: stage.factorId });
    if (e1 || !ch) { setBusy(false); setErr(e1?.message ?? 'Could not start the check.'); return; }
    const { error: e2 } = await sb.auth.mfa.verify({ factorId: stage.factorId, challengeId: ch.id, code: clean });
    if (e2) { setBusy(false); setErr(/invalid|expired/i.test(e2.message) ? 'That code is not valid or has expired. Try the current code.' : e2.message); setCode(''); return; }
    // Full navigation so the server sees the new aal2 session cookie.
    window.location.assign(next);
  };

  return (
    <section className="card p-8">
      <h1 className="text-[26px] font-bold leading-tight">{stage.kind === 'enrol' ? 'Set up two-step verification' : 'Two-step verification'}</h1>
      <p className="text-muted mt-2 text-[15px]">
        {stage.kind === 'enrol'
          ? 'Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) and enter the 6-digit code it shows.'
          : 'Enter the 6-digit code from your authenticator app to confirm it is you. This is needed for downloads, restores and approvals.'}
      </p>
      {email && <p className="text-sm mt-2">Signed in as <b className="font-semibold">{email}</b></p>}

      {stage.kind === 'loading' && <p className="mt-6 text-muted" role="status">Loading…</p>}
      {stage.kind === 'error' && (
        <div role="alert" className="mt-6 rounded-[10px] border border-bad/40 bg-[#FDE8E8] px-4 py-3 text-sm text-[#A32D2D]">
          {stage.message}. If this keeps happening, ask an Admin to check that TOTP multi-factor authentication is enabled for the project.
        </div>
      )}

      {stage.kind === 'enrol' && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc(stage.qr)} alt="QR code for your authenticator app" width={200} height={200} className="border border-line rounded-lg bg-white p-2" />
          <button type="button" className="text-sm text-blue font-semibold" onClick={() => setShowSecret((v) => !v)} aria-expanded={showSecret}>
            {showSecret ? 'Hide setup key' : 'Can’t scan? Show the setup key'}
          </button>
          {showSecret && <code className="mono text-sm break-all bg-surface border border-line rounded px-3 py-2 select-all">{stage.secret}</code>}
        </div>
      )}

      {(stage.kind === 'enrol' || stage.kind === 'challenge') && (
        <form onSubmit={verify} className="mt-6">
          <label htmlFor="mfa-code" className="label">6-digit code</label>
          <input id="mfa-code" className="input mono text-center text-xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
            autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} aria-describedby={err ? 'mfa-err' : undefined} />
          {err && <p id="mfa-err" role="alert" className="text-sm text-bad mt-2">{err}</p>}
          <button type="submit" className="btn btn-primary w-full mt-4" disabled={busy}>{busy ? 'Checking…' : stage.kind === 'enrol' ? 'Turn on 2FA' : 'Verify'}</button>
        </form>
      )}
      <p className="text-center mt-6"><a href={next} className="text-sm text-muted hover:text-navy">Cancel and go back</a></p>
    </section>
  );
}
