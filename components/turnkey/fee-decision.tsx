'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decideFeeAction } from '@/app/admin/turnkey/projects/actions';

/**
 * Turnkey T3 — an admin's Approve / Reject on a waiting fee (Fee approvals queue and the staff project page). Rejecting
 * needs a reason. The database refuses the proposer and a second approval by the same admin; the message says why.
 */
export function TkFeeDecision({ feeId, code, canApprove, blockedReason }: { feeId: string; code: string; canApprove: boolean; blockedReason?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const decide = (decision: 'approve' | 'reject') => start(async () => {
    const r = await decideFeeAction(feeId, code, decision, reason);
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
    if (r.ok) { setRejecting(false); setReason(''); router.refresh(); }
  });
  const idReason = `tk-reject-why-${feeId}`;
  return (
    <div className="flex flex-col gap-2" data-testid={`tk-decide-${feeId}`}>
      {msg && <p role="status" className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`} data-testid={`tk-decide-msg-${feeId}`}>{msg.text}</p>}
      {!rejecting && (
        <div className="flex flex-wrap gap-2">
          {canApprove
            ? <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => decide('approve')} data-testid={`tk-approve-${feeId}`}>Approve</button>
            : blockedReason ? <span className="text-[13px] text-muted self-center">{blockedReason}</span> : null}
          <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => setRejecting(true)} data-testid={`tk-reject-open-${feeId}`}>Reject…</button>
        </div>
      )}
      {rejecting && (
        <form onSubmit={(e) => { e.preventDefault(); decide('reject'); }} className="flex flex-col gap-2">
          <label className="label" htmlFor={idReason}>Why is it rejected? (the team sees this, the client does not) *</label>
          <input id={idReason} className="input min-h-11" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-ghost btn-sm min-h-11" disabled={pending || !reason.trim()} data-testid={`tk-reject-${feeId}`}>Reject fee</button>
            <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
