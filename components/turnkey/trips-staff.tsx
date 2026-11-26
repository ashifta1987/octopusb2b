'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/format';
import { usdToCents } from '@/lib/turnkey/format';
import {
  cancelTripStaffAction, completeTripAction, confirmTripAction, decideTripFeeAction, deletePassportStaffAction, proposeTripFeeAction, withdrawTripFeeAction,
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
 * Turnkey T6 — staff TripManager (design: "TripManager is staff itinerary, costs, checklist, guide and trip report"). The
 * trip fee follows the SetFee rule against the trip's list price from the services list: up to 2× it is active at once,
 * above 2× an admin who did not set it approves it. The itinerary is confirmed after the client has paid.
 */
export function TripFeeForm({ tripId, code, listCents, seq }: { tripId: string; code: string; listCents: number; seq: number }) {
  const { pending, msg, act } = useAct();
  const [amount, setAmount] = useState(String(listCents / 100));
  const [note, setNote] = useState('');
  const cents = usdToCents(amount);
  const valid = cents != null && !Number.isNaN(cents) && cents > 0;
  const needs = valid ? cents > 2 * listCents : null;
  const id = `tk-trip-fee-${seq}`;
  return (
    <form className="flex flex-col gap-2" data-testid={`tk-trip-fee-form-${seq}`} onSubmit={(e) => { e.preventDefault(); act(() => proposeTripFeeAction(tripId, code, amount, note), () => setNote('')); }}>
      <Note msg={msg} id={`tk-trip-fee-msg-${seq}`} />
      <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2">
        <div>
          <label className="label" htmlFor={id}>Trip fee (US$)</label>
          <input id={id} className="input min-h-11" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`tk-trip-fee-amount-${seq}`} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-note`}>Note (staff only)</label>
          <input id={`${id}-note`} className="input min-h-11" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </div>
      </div>
      <p className="m-0 text-[12.5px] text-muted" data-testid={`tk-trip-fee-rule-${seq}`}>
        List price {money(listCents)}. {needs == null ? 'Enter the fee.' : needs ? 'Needs an admin’s approval (above 2× the list price).' : 'Active at once (within 2× the list price); the client can pay it.'}
      </p>
      <div><button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !valid} data-testid={`tk-trip-fee-save-${seq}`}>{needs ? 'Send for approval' : 'Set fee'}</button></div>
    </form>
  );
}

export function TripFeeDecision({ feeId, code, canApprove, canWithdraw, isAdmin }: { feeId: string; code: string; canApprove: boolean; canWithdraw: boolean; isAdmin: boolean }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-trip-reject-${feeId}`;
  return (
    <div className="flex flex-col gap-2">
      <Note msg={msg} id={`tk-trip-decide-msg-${feeId}`} />
      <div className="flex flex-wrap gap-2 items-end">
        {isAdmin && (canApprove
          ? <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => act(() => decideTripFeeAction(feeId, code, 'approve', ''))} data-testid={`tk-trip-approve-${feeId}`}>Approve</button>
          : <span className="text-[13px] text-muted">You proposed this fee; another admin approves it.</span>)}
        {canWithdraw && <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => act(() => withdrawTripFeeAction(feeId, code))}>Withdraw</button>}
      </div>
      {isAdmin && (
        <form className="flex flex-col sm:flex-row gap-2 sm:items-end" onSubmit={(e) => { e.preventDefault(); act(() => decideTripFeeAction(feeId, code, 'reject', reason)); }}>
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

/** Itinerary (client sees it), guide and staff notes (staff only). Disabled with the reason until the fee is paid. */
export function TripConfirmForm({ tripId, code, seq, blocked, initial }: { tripId: string; code: string; seq: number; blocked: string | null; initial: { itinerary: string; guide: string; notes: string } }) {
  const { pending, msg, act } = useAct();
  const [it, setIt] = useState(initial.itinerary);
  const [guide, setGuide] = useState(initial.guide);
  const [notes, setNotes] = useState(initial.notes);
  const id = `tk-trip-conf-${seq}`;
  return (
    <form className="flex flex-col gap-2" data-testid={`tk-trip-confirm-${seq}`} onSubmit={(e) => { e.preventDefault(); act(() => confirmTripAction(tripId, code, it, guide, notes)); }}>
      <Note msg={msg} id={`tk-trip-confirm-msg-${seq}`} />
      {blocked && <p className="m-0 text-[13px] text-warn" data-testid={`tk-trip-confirm-blocked-${seq}`}>{blocked}</p>}
      <div>
        <label className="label" htmlFor={`${id}-it`}>Itinerary (the client sees it; no supplier names) *</label>
        <textarea id={`${id}-it`} className="input min-h-24" value={it} onChange={(e) => setIt(e.target.value)} maxLength={4000} disabled={!!blocked} data-testid={`tk-trip-itinerary-${seq}`} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor={`${id}-guide`}>Guide (staff only)</label>
          <input id={`${id}-guide`} className="input min-h-11" value={guide} onChange={(e) => setGuide(e.target.value)} maxLength={120} disabled={!!blocked} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-notes`}>Costs and checklist notes (staff only)</label>
          <input id={`${id}-notes`} className="input min-h-11" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} disabled={!!blocked} />
        </div>
      </div>
      <div><button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={pending || !!blocked || !it.trim()} data-testid={`tk-trip-confirm-save-${seq}`}>{initial.itinerary ? 'Update itinerary' : 'Confirm trip'}</button></div>
    </form>
  );
}

export function TripCompleteForm({ tripId, code, seq }: { tripId: string; code: string; seq: number }) {
  const { pending, msg, act } = useAct();
  const [report, setReport] = useState('');
  const id = `tk-trip-done-${seq}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); act(() => completeTripAction(tripId, code, report)); }}>
      <Note msg={msg} id={`tk-trip-done-msg-${seq}`} />
      <label className="label" htmlFor={id}>Trip report (the client sees it)</label>
      <textarea id={id} className="input min-h-20" value={report} onChange={(e) => setReport(e.target.value)} maxLength={4000} />
      <div><button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending}>Close the trip</button></div>
    </form>
  );
}

export function TripCancelStaff({ tripId, code, seq }: { tripId: string; code: string; seq: number }) {
  const { pending, msg, act } = useAct();
  const [reason, setReason] = useState('');
  const id = `tk-trip-cancel-${seq}`;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); act(() => cancelTripStaffAction(tripId, code, reason)); }}>
      <Note msg={msg} id={`tk-trip-cancel-msg-${seq}`} />
      <label className="label" htmlFor={id}>Cancel the trip (the client sees the reason)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input id={id} className="input min-h-11 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()}>Cancel trip</button>
      </div>
    </form>
  );
}

export function PassportDeleteStaff({ travellerId, code, position }: { travellerId: string; code: string; position: number }) {
  const { pending, msg, act } = useAct();
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => act(() => deletePassportStaffAction(travellerId, code))} data-testid={`tk-staff-passport-delete-${position}`}>
        Delete on request<span className="sr-only"> (traveller {position})</span>
      </button>
      <Note msg={msg} id={`tk-staff-passport-msg-${position}`} />
    </span>
  );
}
