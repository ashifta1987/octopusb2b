'use client';

import { useState } from 'react';
import type { BrandMove } from '@/lib/brand-projects';

/** Fixture stand-in for today's BrandStatusControls (same fields and rules text; calls nothing). */
export function SampleStatusControls({ moves, paid, isAdmin }: { moves: BrandMove[]; paid: boolean; isAdmin: boolean }) {
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const move = moves.find((m) => m.to === to);
  if (!moves.length) return <p className="m-0 text-ods-small text-ods-slate" data-testid="no-moves">Closed. Only an admin can reopen this project.</p>;
  return (
    <form
      className="grid gap-3"
      data-testid="status-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!move || move.disabled) return;
        if (move.needsReason && reason.trim().length < 3) return setMsg('Give an internal reason for closing (the customer does not see it).');
        setMsg('Updated (sample — nothing was saved).');
      }}
    >
      <label htmlFor="bp-to" className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
        Move to
        <select id="bp-to" value={to} onChange={(e) => { setTo(e.target.value); setMsg(null); }} className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 text-ods-body font-normal">
          <option value="">Choose a status</option>
          {moves.map((m) => (
            <option key={m.to + (m.reopen ? ':r' : '')} value={m.to} disabled={!!m.disabled}>
              {m.label}
              {m.disabled ? ' (admin only)' : ''}
            </option>
          ))}
        </select>
      </label>
      {move?.needsReason ? (
        <label htmlFor="bp-reason" className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
          Internal reason (required, not shown to the customer)
          <textarea id="bp-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="min-h-[88px] rounded-ods-control border border-ods-line-strong p-2 text-ods-body font-normal" />
          {paid ? <span className="text-ods-small font-normal text-ods-warning">Payment received; handle the refund separately.{!isAdmin ? ' Only an admin can close this project.' : ''}</span> : null}
        </label>
      ) : null}
      {move?.disabled ? <p className="m-0 text-ods-small text-ods-danger">{move.disabled}</p> : null}
      <button type="submit" disabled={!move || !!move.disabled} className="inline-flex h-ods-control items-center justify-center rounded-ods-control bg-ods-blue px-3 text-ods-body font-semibold text-white disabled:opacity-60">
        {move?.reopen ? 'Reopen' : move?.to === 'closed' ? 'Close project' : 'Update status'}
      </button>
      {msg ? <p role="status" className="m-0 text-ods-small" data-testid="status-msg">{msg}</p> : null}
    </form>
  );
}
