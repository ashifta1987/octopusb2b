'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setBrandProjectStatus } from './actions';
import type { BrandMove } from '@/lib/brand-projects';

/** Status controls on Admin › Brand projects › MB-… (bug 2, 8 Nov 2026). Close asks for an internal reason. */
export function BrandStatusControls({ id, moves, paid, isAdmin }: { id: string; moves: BrandMove[]; paid: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [busy, start] = useTransition();
  const move = moves.find((m) => m.to === to);
  if (!moves.length) return <p className="text-sm text-muted" data-testid="no-moves">Closed. Only an admin can reopen this project.</p>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!move || move.disabled) return;
    if (move.needsReason && reason.trim().length < 3) { setMsg({ tone: 'bad', text: 'Give an internal reason for closing (the customer does not see it).' }); return; }
    start(async () => {
      const r = await setBrandProjectStatus(id, move.to, reason.trim() || null);
      if (!r.ok) { setMsg({ tone: 'bad', text: r.error }); return; }
      setMsg(r.data?.warning ? { tone: 'warn', text: r.data.warning } : { tone: 'ok', text: r.message ?? 'Updated' });
      setTo(''); setReason('');
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="status-form">
      <div>
        <label htmlFor="bp-to" className="label">Move to</label>
        <select id="bp-to" className="input" value={to} onChange={(e) => { setTo(e.target.value); setMsg(null); }}>
          <option value="">Choose a status</option>
          {moves.map((m) => <option key={m.to + (m.reopen ? ':r' : '')} value={m.to} disabled={!!m.disabled}>{m.label}{m.disabled ? ' (admin only)' : ''}</option>)}
        </select>
      </div>
      {move?.needsReason && (
        <div>
          <label htmlFor="bp-reason" className="label">Internal reason (required, not shown to the customer)</label>
          <textarea id="bp-reason" className="input min-h-[88px]" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />
          {paid && <p className="text-sm text-warn mt-1" role="note">Payment received; handle the refund separately.{!isAdmin ? ' Only an admin can close this project.' : ''}</p>}
        </div>
      )}
      {move?.disabled && <p className="text-sm text-bad">{move.disabled}</p>}
      <button type="submit" className="btn btn-primary" disabled={!move || !!move.disabled || busy}>{busy ? 'Saving…' : move?.reopen ? 'Reopen' : move?.to === 'closed' ? 'Close project' : 'Update status'}</button>
      {msg && <p role="status" className={`text-sm ${msg.tone === 'ok' ? 'text-ok' : msg.tone === 'warn' ? 'text-warn font-semibold' : 'text-bad'}`} data-testid="status-msg">{msg.text}</p>}
    </form>
  );
}

