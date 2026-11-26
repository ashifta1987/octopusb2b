'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TK_INSPECTION_KINDS, feeNeedsApproval, fromPrice, usdToCents } from '@/lib/turnkey/format';
import {
  cancelInspectionAction, createInspectionAction, decideInspectionFeeAction, overridePsiAction, proposeInspectionFeeAction, publishInspectionAction,
  returnInspectionAction, scheduleInspectionAction, withdrawInspectionFeeAction,
} from '@/app/admin/turnkey/projects/actions';

type Msg = { ok: boolean; text: string } | null;
type R = { ok: boolean; message?: string; error?: string };
const Note = ({ msg, id }: { msg: Msg; id: string }) => msg
  ? <p role="status" className={`m-0 rounded-[10px] border px-4 py-3 text-sm ${msg.ok ? 'bg-ok-bg border-ok/40 text-ok' : 'bg-bad-bg border-bad/40 text-bad'}`} data-testid={id}>{msg.text}</p>
  : null;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const act = (fn: () => Promise<R>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { after?.(); router.refresh(); }
  });
  return { pending, msg, act };
}

/**
 * Turnkey T5 — staff plan an inspection (design: "Production and QC: factory audit and inspections, each paid before it
 * starts"). The factory name and address are for staff and the inspector only; checklist lines (one per line) are shown
 * to the client in the published report, so they must not name the factory (the database refuses it).
 */
export function InspectionCreateForm({ projectId, code, phaseFeeAvailable }: { projectId: string; code: string; phaseFeeAvailable: boolean }) {
  const { pending, msg, act } = useAct();
  const [kind, setKind] = useState<string>('pre_shipment');
  const [factory, setFactory] = useState('');
  const [address, setAddress] = useState('');
  const [brief, setBrief] = useState('');
  const [checklist, setChecklist] = useState('');
  const [usePhase, setUsePhase] = useState(false);
  return (
    <form className="flex flex-col gap-3" aria-labelledby="tk-qc-new-h" data-testid="tk-qc-create"
      onSubmit={(e) => { e.preventDefault(); act(() => createInspectionAction(projectId, code, kind, factory, address, brief, checklist, kind === 'factory_audit' && usePhase), () => { setFactory(''); setAddress(''); setBrief(''); setChecklist(''); }); }}>
      <h3 id="tk-qc-new-h" className="m-0 text-[15px] font-semibold">Plan an inspection</h3>
      <Note msg={msg} id="tk-qc-create-msg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tk-qc-kind">Inspection</label>
          <select id="tk-qc-kind" className="input min-h-11" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="tk-qc-kind">
            {TK_INSPECTION_KINDS.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tk-qc-factory">Factory (staff and inspector only) *</label>
          <input id="tk-qc-factory" className="input min-h-11" value={factory} onChange={(e) => setFactory(e.target.value)} maxLength={200} data-testid="tk-qc-factory" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tk-qc-address">Factory address (staff and inspector only)</label>
          <input id="tk-qc-address" className="input min-h-11" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tk-qc-brief">Brief for the inspector (AQL level, what to check; staff only)</label>
          <textarea id="tk-qc-brief" className="input min-h-20" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="tk-qc-checklist">Checklist, one line each (the client sees these lines and their Pass / Fail / N/A) *</label>
          <textarea id="tk-qc-checklist" className="input min-h-28" value={checklist} onChange={(e) => setChecklist(e.target.value)} data-testid="tk-qc-checklist" />
        </div>
      </div>
      {kind === 'factory_audit' && phaseFeeAvailable && (
        <label className="flex items-center gap-2 text-[14px] min-h-11">
          <input type="checkbox" checked={usePhase} onChange={(e) => setUsePhase(e.target.checked)} className="w-5 h-5" data-testid="tk-qc-use-phase-fee" />
          Paid with the Production and QC fee (the client already paid the factory audit)
        </label>
      )}
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !factory.trim() || !checklist.trim()} data-testid="tk-qc-create-save">Plan inspection</button></div>
    </form>
  );
}

/** SetFee for one inspection: starts at the service's starting fee; says before sending whether an admin must approve it. */
export function InspectionFeeForm({ inspectionId, code, startingCents, testId }: { inspectionId: string; code: string; startingCents: number | null; testId: string }) {
  const { pending, msg, act } = useAct();
  const [amount, setAmount] = useState(startingCents ? String(startingCents / 100) : '');
  const [note, setNote] = useState('');
  const cents = usdToCents(amount);
  const valid = cents != null && !Number.isNaN(cents) && cents > 0;
  const needs = valid ? feeNeedsApproval(cents, startingCents) : null;
  const idA = `tk-qc-fee-${inspectionId}`;
  return (
    <form className="flex flex-col gap-2" data-testid={`tk-qc-fee-form-${testId}`} onSubmit={(e) => { e.preventDefault(); act(() => proposeInspectionFeeAction(inspectionId, code, amount, note), () => setNote('')); }}>
      <Note msg={msg} id={`tk-qc-fee-msg-${testId}`} />
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
        <div>
          <label className="label" htmlFor={idA}>Fee (US$)</label>
          <input id={idA} className="input min-h-11" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`tk-qc-fee-amount-${testId}`} />
        </div>
        <div>
          <label className="label" htmlFor={`${idA}-note`}>Note (staff only)</label>
          <input id={`${idA}-note`} className="input min-h-11" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </div>
      </div>
      <p className="m-0 text-[12.5px] text-muted" data-testid={`tk-qc-fee-rule-${testId}`}>
        {startingCents ? `Starting fee ${fromPrice(startingCents)}. ` : ''}
        {needs == null ? 'Enter the fee.' : needs ? 'Needs an admin’s approval (above 2× the starting fee).' : 'Active at once (within 2× the starting fee); the client can pay it.'}
      </p>
      <div><button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !valid} data-testid={`tk-qc-fee-save-${testId}`}>{needs ? 'Send for approval' : 'Set fee'}</button></div>
    </form>
  );
}

export function InspectionFeeDecision({ feeId, code, canApprove, canWithdraw, isAdmin }: { feeId: string; code: string; canApprove: boolean; canWithdraw: boolean; isAdmin: boolean }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-qc-reject-${feeId}`;
  return (
    <div className="flex flex-col gap-2">
      <Note msg={msg} id={`tk-qc-decide-msg-${feeId}`} />
      <div className="flex flex-wrap gap-2 items-end">
        {isAdmin && (canApprove
          ? <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act(() => decideInspectionFeeAction(feeId, code, 'approve', ''))} data-testid={`tk-qc-approve-${feeId}`}>Approve</button>
          : <span className="text-[13px] text-muted">You proposed this fee; another admin approves it.</span>)}
        {canWithdraw && <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => act(() => withdrawInspectionFeeAction(feeId, code))}>Withdraw</button>}
      </div>
      {isAdmin && (
        <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); act(() => decideInspectionFeeAction(feeId, code, 'reject', reason)); }}>
          <div className="flex-1">
            <label className="label" htmlFor={id}>Reject with a reason (staff only)</label>
            <input id={id} className="input min-h-11" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Reject</button>
        </form>
      )}
    </div>
  );
}

/** Schedules a PAID inspection: inspector (turnkey_qc:edit) and date. Disabled with the reason until the fee is paid. */
export function InspectionSchedule({ inspectionId, code, inspectors, currentInspector, currentDate, blocked, testId }: {
  inspectionId: string; code: string; inspectors: { user_id: string; full_name: string }[]; currentInspector: string | null; currentDate: string | null; blocked: string | null; testId: string;
}) {
  const { pending, msg, act } = useAct();
  const [who, setWho] = useState(currentInspector ?? '');
  const [on, setOn] = useState(currentDate ?? '');
  const id = `tk-qc-sched-${inspectionId}`;
  return (
    <form className="flex flex-col gap-2" data-testid={`tk-qc-schedule-${testId}`} onSubmit={(e) => { e.preventDefault(); act(() => scheduleInspectionAction(inspectionId, code, who, on)); }}>
      <Note msg={msg} id={`tk-qc-schedule-msg-${testId}`} />
      {blocked && <p className="m-0 text-[13px] text-warn" data-testid={`tk-qc-schedule-blocked-${testId}`}>{blocked}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px_auto] gap-2 items-end">
        <div>
          <label className="label" htmlFor={`${id}-who`}>Inspector</label>
          <select id={`${id}-who`} className="input min-h-11" value={who} onChange={(e) => setWho(e.target.value)} disabled={!!blocked} data-testid={`tk-qc-inspector-${testId}`}>
            <option value="">Choose</option>
            {inspectors.map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`${id}-on`}>Date</label>
          <input id={`${id}-on`} type="date" className="input min-h-11" value={on} onChange={(e) => setOn(e.target.value)} disabled={!!blocked} data-testid={`tk-qc-date-${testId}`} />
        </div>
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !!blocked || !who || !on} data-testid={`tk-qc-schedule-save-${testId}`}>{currentDate ? 'Reschedule' : 'Schedule'}</button>
      </div>
    </form>
  );
}

export function InspectionCancel({ inspectionId, code, testId }: { inspectionId: string; code: string; testId: string }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-qc-cancel-${inspectionId}`;
  return (
    <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); act(() => cancelInspectionAction(inspectionId, code, reason)); }}>
      <div className="flex-1">
        <label className="label" htmlFor={id}>Cancel this inspection (reason, staff only)</label>
        <input id={id} className="input min-h-11" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid={`tk-qc-cancel-reason-${testId}`} />
      </div>
      <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()} data-testid={`tk-qc-cancel-${testId}`}>Cancel inspection</button>
      <Note msg={msg} id={`tk-qc-cancel-msg-${testId}`} />
    </form>
  );
}

/**
 * Review a submitted report: write the summary the client reads (never the factory name: the database refuses it),
 * untick photos the client should not see (for example a factory sign), publish — or return it to the inspector.
 */
export function InspectionReview({ inspectionId, code, photos, ownReport, testId }: {
  inspectionId: string; code: string; photos: { id: string; url: string | null; n: number }[]; ownReport: boolean; testId: string;
}) {
  const { pending, msg, act } = useAct();
  const [summary, setSummary] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const [why, setWhy] = useState('');
  const id = `tk-qc-review-${inspectionId}`;
  return (
    <div className="flex flex-col gap-3" data-testid={`tk-qc-review-${testId}`}>
      <Note msg={msg} id={`tk-qc-review-msg-${testId}`} />
      {ownReport ? <p className="m-0 text-[13px] text-muted">You inspected this one: another team member reviews and publishes it.</p> : (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); act(() => publishInspectionAction(inspectionId, code, summary, hidden)); }}>
          <label className="label" htmlFor={`${id}-sum`}>Summary for the client * (no factory names)</label>
          <textarea id={`${id}-sum`} className="input min-h-24" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} data-testid={`tk-qc-summary-${testId}`} />
          {photos.length > 0 && (
            <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
              <legend className="label">Photos the client sees</legend>
              <div className="flex flex-wrap gap-3">
                {photos.map((ph) => (
                  <label key={ph.id} className="flex items-center gap-2 text-[13px] min-h-11">
                    <input type="checkbox" className="w-5 h-5" checked={!hidden.includes(ph.id)} onChange={(e) => setHidden((h) => e.target.checked ? h.filter((x) => x !== ph.id) : [...h, ph.id])} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {ph.url ? <img src={ph.url} alt={`Inspection photo ${ph.n}`} className="w-16 h-16 object-cover rounded-[8px] border border-line" /> : <span>Photo {ph.n}</span>}
                    <span className="sr-only">Show photo {ph.n} to the client</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !summary.trim()} data-testid={`tk-qc-publish-${testId}`}>Publish report</button></div>
        </form>
      )}
      <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); act(() => returnInspectionAction(inspectionId, code, why)); }}>
        <div className="flex-1">
          <label className="label" htmlFor={`${id}-why`}>Return to the inspector (what to check)</label>
          <input id={`${id}-why`} className="input min-h-11" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={1000} />
        </div>
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !why.trim()}>Return</button>
      </form>
    </div>
  );
}

/** Admins: let the project go to Shipment despite the latest failed pre-shipment inspection (reason; never its inspector). */
export function PsiOverride({ inspectionId, code, testId }: { inspectionId: string; code: string; testId: string }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-qc-override-${inspectionId}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); act(() => overridePsiAction(inspectionId, code, reason)); }}>
      <Note msg={msg} id={`tk-qc-override-msg-${testId}`} />
      <label className="label" htmlFor={id}>Admin override: allow shipment despite the failure (reason, staff only)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Override</button>
      </div>
    </form>
  );
}

