'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/format';
import { TK_PHASES, TK_PHASE_SERVICE, feeNeedsApproval, fromPrice, isGatedPhase, usdToCents, type TkStageCode } from '@/lib/turnkey/format';
import { proposeFeeAction, withdrawFeeAction } from '../actions';

type Svc = { code: string; name: string; from_cents: number; approx: boolean };

/**
 * Turnkey T3 — SetFee on the staff project page (design: "SetFee lets staff set the exact fee (admin approval above
 * 2x)"; D5: service fees). Staff choose the phase, the service (default from the phase) and the exact fee in US dollars;
 * it starts at the service's starting fee. Up to 2× the starting fee the fee is active at once (the client can pay it);
 * above 2×, or with no starting fee, an admin who is not the proposer approves it first. The form says which before it
 * is sent. Changing a fee = a new version under the same rule; a fee with a payment cannot be changed.
 */
export function FeeProposeForm({ projectId, code, defaultStage, services }: { projectId: string; code: string; defaultStage: TkStageCode; services: Svc[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const paid = TK_PHASES.filter((p) => p.paid);
  const svcFor = (st: string) => TK_PHASE_SERVICE[st as TkStageCode] ?? '';
  const priceFor = (svc: string) => { const s = services.find((x) => x.code === svc); return s && s.from_cents > 0 ? String(s.from_cents / 100) : ''; };
  const [stage, setStage] = useState<string>(defaultStage);
  const [service, setService] = useState<string>(svcFor(defaultStage));
  const [amount, setAmount] = useState<string>(priceFor(svcFor(defaultStage)));
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const svc = services.find((x) => x.code === service);
  const cents = usdToCents(amount);
  const valid = cents != null && !Number.isNaN(cents) && cents > 0;
  const startCents = svc && svc.from_cents > 0 ? svc.from_cents : null;
  const needs = valid ? feeNeedsApproval(cents, startCents) : null;
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start(async () => {
      const r = await proposeFeeAction(projectId, code, stage, service, amount, note);
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
      if (r.ok) { setNote(''); router.refresh(); }
    });
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-testid="tk-fee-form" aria-labelledby="tk-fee-form-h">
      <h3 id="tk-fee-form-h" className="m-0 text-[15px] font-semibold">Set a fee</h3>
      {msg && <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid="tk-fee-msg">{msg.text}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tk-fee-stage">Phase</label>
          <select id="tk-fee-stage" className="input min-h-11" value={stage} data-testid="tk-fee-stage"
            onChange={(e) => { const st = e.target.value; setStage(st); const sv = svcFor(st); setService(sv); setAmount(priceFor(sv)); }}>
            {paid.map((p) => <option key={p.code} value={p.code}>{p.n}. {p.name}{isGatedPhase(p.code) ? ' (locked until paid)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tk-fee-service">Service</label>
          <select id="tk-fee-service" className="input min-h-11" value={service} data-testid="tk-fee-service"
            onChange={(e) => { setService(e.target.value); setAmount(priceFor(e.target.value)); }}>
            <option value="">Other ({TK_PHASES.find((p) => p.code === stage)?.name} fee)</option>
            {services.filter((s) => s.from_cents > 0).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tk-fee-amount">Exact fee (US$) *</label>
          <input id="tk-fee-amount" className="input min-h-11" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="tk-fee-amount" aria-describedby="tk-fee-amount-help" />
          <p id="tk-fee-amount-help" className="m-0 mt-1 text-[12.5px] text-muted">
            {startCents ? `Starting fee: ${fromPrice(startCents, svc?.approx)}. Up to ${money(2 * startCents)} it is active at once; above that an admin (not you) approves it first.`
              : 'No starting fee for this choice: an admin (not you) approves the fee first.'}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="tk-fee-note">Note for the approvers (staff only)</label>
          <input id="tk-fee-note" className="input min-h-11" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} data-testid="tk-fee-note" />
        </div>
      </div>
      {needs != null && (
        <p role="status" className={`m-0 text-[13.5px] font-semibold ${needs ? 'text-warn' : 'text-ok'}`} data-testid="tk-fee-rule">
          {needs ? (startCents ? 'Needs an admin’s approval: above 2× the starting fee.' : 'Needs an admin’s approval: no starting fee.')
            : 'Active at once: within 2× the starting fee. The client can pay it straight away.'}
        </p>
      )}
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !valid} data-testid="tk-fee-propose">{needs ? 'Send for approval' : 'Set fee'}</button></div>
    </form>
  );
}

export function FeeWithdrawButton({ feeId, code }: { feeId: string; code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} data-testid={`tk-fee-withdraw-${feeId}`}
        onClick={() => start(async () => { const r = await withdrawFeeAction(feeId, code); if (r.ok) router.refresh(); else setErr(r.error ?? 'Something went wrong.'); })}>
        Withdraw
      </button>
      {err && <span role="alert" className="text-[13px] text-bad">{err}</span>}
    </span>
  );
}
