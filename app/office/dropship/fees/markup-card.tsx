'use client';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsNotice } from '@/components/dropship-ui';
import { fmtDate } from '@/lib/format';
import { decideMarkupAction, proposeMarkupAction, withdrawMarkupAction } from './actions';

/** ds16_markup_page() — the shipping markup on the YunExpress rate-card cost (setting dropship.shipping_markup_pct). */
export type MarkupPage = {
  pct: number | null; can_propose: boolean; can_approve: boolean; me: string;
  pending: { id: string; old_value: unknown; new_value: unknown; reason: string | null; proposed_at: string; proposed_by: string; proposed_by_name: string | null } | null;
  history: { id: string; status: string; old_value: unknown; new_value: unknown; reason: string | null; proposed_by_name: string | null; decided_by_name: string | null;
    proposed_at: string; decided_at: string | null; decision_note: string | null }[];
};

const pctText = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v}%` : v == null ? 'Not set' : `${Number(v)}%`);
const STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'neutral' | 'info']> = {
  approved: ['Approved', 'ok'], seeded: ['Owner decision', 'info'], rejected: ['Rejected', 'bad'], withdrawn: ['Withdrawn', 'neutral'],
};

/**
 * DS16 · Shipping markup card (Dropship staff › Fees). Rate cards stay at the carrier cost; the merchant's shipping line is the cost plus
 * this markup (integer cents, rounded half up). A change is proposed, then a DIFFERENT Finance approver or admin approves it — the
 * database refuses anything else. Orders already placed keep the shipping line they were charged.
 */
export function MarkupCard({ page }: { page: MarkupPage }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const p = page.pending;
  const mine = !!p && p.proposed_by === page.me;
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
    if (r.ok) after?.();
  });

  return (
    <DsCard title="Shipping markup" icon="percent" testId="shipping-markup-card"
      subtitle="Rate cards are the carrier cost. The merchant pays the cost plus this markup on the shipping line. Two people change it.">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 m-0 text-[13.5px]">
          <div><dt className="text-muted text-[12.5px]">Markup in force</dt>
            <dd className="m-0 text-[18px] font-semibold" data-testid="markup-current">{page.pct == null ? 'Not set — shipping is charged at cost' : `${page.pct}%`}</dd></div>
          <div><dt className="text-muted text-[12.5px]">How it is worked out</dt>
            <dd className="m-0">Shipping line = rate-card cost × (1 + markup), whole cents, rounded half up.</dd></div>
        </dl>

        {p && (
          <div className="border border-warn-line bg-warn-bg rounded-[10px] p-3 flex flex-col gap-2" data-testid="markup-pending">
            <div className="text-[13.5px]">
              <DsBadge tone="warn">Waiting for a second approver</DsBadge>{' '}
              <strong>{pctText(p.old_value)} → {pctText(p.new_value)}</strong>
              <div className="text-[12px] text-muted">Proposed by {p.proposed_by_name ?? 'staff'} on {fmtDate(p.proposed_at)}{p.reason ? ` · ${p.reason}` : ''}</div>
            </div>
            {page.can_approve && !mine && (
              <div className="flex flex-wrap gap-2 items-end">
                <DsInput label="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
                <DsButton testId="markup-approve" disabled={pending} onClick={() => run(() => decideMarkupAction(p.id, true, note), () => setNote(''))}>Approve</DsButton>
                <DsButton variant="secondary" testId="markup-reject" disabled={pending || note.trim().length < 3}
                  disabledReason={note.trim().length < 3 ? 'Write why you reject it' : undefined}
                  onClick={() => run(() => decideMarkupAction(p.id, false, note), () => setNote(''))}>Reject</DsButton>
              </div>
            )}
            {mine && (
              <div className="flex flex-wrap gap-2 items-center">
                <p className="m-0 text-[13px] text-muted" data-testid="markup-own-note">You proposed this change. A different Finance approver or an admin must approve it.</p>
                <DsButton variant="link" disabled={pending} testId="markup-withdraw" onClick={() => run(() => withdrawMarkupAction(p.id))}>Withdraw</DsButton>
              </div>
            )}
          </div>
        )}

        {page.can_propose && !p && (
          <form className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" data-testid="markup-propose-form" onSubmit={(e) => {
            e.preventDefault();
            run(() => proposeMarkupAction(pct, reason), () => { setPct(''); setReason(''); });
          }}>
            <DsInput label="New markup (%)" name="markup_pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} hint="0 to 100, up to 2 decimals" required />
            <DsInput label="Reason" name="markup_reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" required />
            <div><DsButton type="submit" testId="markup-propose" disabled={pending || !pct.trim() || reason.trim().length < 3}
              disabledReason={!pct.trim() || reason.trim().length < 3 ? 'Enter the markup and a reason' : undefined}>Propose change</DsButton></div>
          </form>
        )}
        {!page.can_propose && !page.can_approve && <DsNotice tone="info" title="Read only">Dropship editors and Finance propose a change; a second Finance approver or an admin approves it.</DsNotice>}
        {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="markup-msg" className={`m-0 text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}

        {page.history.length > 0 && (
          <div className="ds-scroll">
            <table className="ds-tbl min-w-[640px]" data-testid="markup-history">
              <thead><tr><th scope="col">Change</th><th scope="col">Status</th><th scope="col">Proposed</th><th scope="col">Decided</th></tr></thead>
              <tbody>
                {page.history.map((h) => (
                  <tr key={h.id}>
                    <td className="font-mono">{pctText(h.old_value)} → {pctText(h.new_value)}{h.reason ? <div className="text-[12px] text-muted font-sans">{h.reason}</div> : null}</td>
                    <td><DsBadge tone={STATUS[h.status]?.[1] ?? 'neutral'}>{STATUS[h.status]?.[0] ?? h.status}</DsBadge></td>
                    <td>{h.proposed_by_name ?? '—'}<div className="text-[12px] text-muted">{fmtDate(h.proposed_at)}</div></td>
                    <td>{h.decided_by_name ?? (h.status === 'seeded' ? 'Set by migration' : '—')}{h.decided_at && <div className="text-[12px] text-muted">{fmtDate(h.decided_at)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DsCard>
  );
}
