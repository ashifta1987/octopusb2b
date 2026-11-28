'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, fmtDate } from '@/lib/format';
import { decideHoldApprovalAction, financeActOnHoldAction } from './actions';

export type StaffHoldRow = {
  id: string;
  org_id: string;
  org_name: string;
  division_code: string;
  service: string;
  target_type: string;
  target_id: string;
  order_code: string | null;
  funding_method: string;
  amount_cents: number;
  released_cents: number;
  refunded_cents: number;
  currency: string;
  release_rule: string;
  milestone_label: string;
  status: string;
  dispute_reason: string | null;
  invoice_number: string | null;
  created_at: string;
};

export type StaffHoldApprovalRow = {
  id: string;
  hold_id: string;
  action: string;
  amount_cents: number;
  refund_destination: string | null;
  reason: string;
  status: string;
  proposed_by: string;
  created_at: string;
};

export function HoldsClient({
  holds,
  approvals,
  currentUserId,
  thresholdCents,
}: {
  holds: StaffHoldRow[];
  approvals: StaffHoldApprovalRow[];
  currentUserId: string;
  thresholdCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterService, setFilterService] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = holds.filter((h) => {
    if (filterService !== 'all' && h.service !== filterService) return false;
    if (filterStatus !== 'all' && h.status !== filterStatus) return false;
    return true;
  });

  function handleAct(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await financeActOnHoldAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Action failed.');
        return;
      }
      setNotice(
        res.requiresSecondApprover
          ? `Amount exceeds ${money(thresholdCents, 'USD')} threshold — queued for second Finance approver.`
          : 'Held payment action executed and ledger updated.',
      );
      router.refresh();
    });
  }

  function handleApproval(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await decideHoldApprovalAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Approval failed.');
        return;
      }
      setNotice('Two-person decision recorded.');
      router.refresh();
    });
  }

  return (
    <div className="space-y-6" data-testid="finance-holds-page">
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900" role="alert" data-testid="holds-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-950" data-testid="holds-notice">
          {notice}
        </div>
      )}

      {/* Pending Two-Person Approvals Queue (> US$1,000 threshold) */}
      {approvals.length > 0 && (
        <section className="card p-5 space-y-3 border-amber-400" data-testid="hold-approvals-queue">
          <div>
            <h2 className="text-base font-semibold text-ink">
              Two-Person Approval Queue (Releases &amp; Refunds above {money(thresholdCents, 'USD')})
            </h2>
            <p className="text-xs text-muted">
              Enforced in the database: the proposer cannot approve their own request (<code>proposed_by &lt;&gt; approved_by</code>).
            </p>
          </div>
          <div className="space-y-2">
            {approvals.map((a) => {
              const isSelf = a.proposed_by === currentUserId;
              return (
                <div
                  key={a.id}
                  data-testid={`hold-approval-${a.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-xs"
                >
                  <div>
                    <span className="font-semibold uppercase text-ink">{a.action.replace('_', ' ')}</span> ·{' '}
                    <strong className="font-mono">{money(a.amount_cents, 'USD')}</strong>
                    {a.refund_destination ? ` → ${a.refund_destination}` : ''} · Reason: <em>{a.reason}</em>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={handleApproval}>
                      <input type="hidden" name="approval_id" value={a.id} />
                      <input type="hidden" name="approve" value="true" />
                      <button
                        type="submit"
                        disabled={pending || isSelf}
                        title={isSelf ? 'Proposer cannot approve their own request' : 'Approve & execute'}
                        data-testid={`approve-hold-btn-${a.id}`}
                        className="rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        {isSelf ? 'Awaiting 2nd approver' : 'Approve & Execute'}
                      </button>
                    </form>
                    <form action={handleApproval}>
                      <input type="hidden" name="approval_id" value={a.id} />
                      <input type="hidden" name="approve" value="false" />
                      <button
                        type="submit"
                        disabled={pending || isSelf}
                        className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted">Service:</span>
          <select
            value={filterService}
            onChange={(e) => setFilterService(e.target.value)}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
          >
            <option value="all">All services</option>
            <option value="sourcing">Sourcing</option>
            <option value="brand">Make My Brand</option>
            <option value="pools">MOQ Pools</option>
            <option value="turnkey">Turnkey</option>
            <option value="warehouse">3PL Warehouse</option>
            <option value="dropship">Dropshipping</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
          >
            <option value="all">All statuses</option>
            <option value="held">Held</option>
            <option value="partially_released">Partly released</option>
            <option value="disputed">Disputed</option>
            <option value="released">Released</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
      </div>

      {/* Holds list */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="card p-8 text-center text-sm text-muted">
            No held payments match the selected filters.
          </div>
        ) : (
          filtered.map((h) => {
            const rem = h.amount_cents - h.released_cents - h.refunded_cents;
            const isOpen = rem > 0 && ['held', 'partially_released', 'disputed'].includes(h.status);
            return (
              <div
                key={h.id}
                data-testid={`hold-row-${h.id}`}
                className="card p-5 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink">{h.division_code}</span>
                      <span className="text-xs font-semibold capitalize text-ink">{h.service}</span>
                      {h.order_code && <span className="font-mono text-xs text-muted">· {h.order_code}</span>}
                      <span className="text-xs text-muted">· {h.org_name}</span>
                      <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold uppercase text-ink">
                        {h.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Milestone rule: <strong className="text-ink">{h.milestone_label}</strong> · Funded via{' '}
                      {h.funding_method} on {fmtDate(h.created_at)}
                    </p>
                    {h.dispute_reason && (
                      <p className="mt-1 text-xs font-semibold text-amber-900">
                        Dispute reason: {h.dispute_reason}
                      </p>
                    )}
                    {h.invoice_number && (
                      <p className="mt-1 text-xs text-emerald-800 font-mono">
                        Tax invoice issued on release: {h.invoice_number}
                      </p>
                    )}
                  </div>

                  <div className="text-right font-mono text-xs space-y-0.5">
                    <div>Total held: <strong>{money(h.amount_cents, h.currency)}</strong></div>
                    <div className="text-emerald-800">Released: {money(h.released_cents, h.currency)}</div>
                    <div className="text-muted">Refunded: {money(h.refunded_cents, h.currency)}</div>
                    <div className="text-sm font-bold text-ink">Remaining: {money(rem, h.currency)}</div>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-line pt-3 flex flex-wrap items-center gap-3">
                    <form action={handleAct} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="hold_id" value={h.id} />
                      <select
                        name="action"
                        defaultValue="release"
                        data-testid={`hold-action-select-${h.id}`}
                        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
                      >
                        <option value="release">Release in full ({money(rem, h.currency)})</option>
                        <option value="partial_release">Partial release</option>
                        <option value="refund">Refund to customer</option>
                      </select>
                      <input
                        type="number"
                        name="amount_cents"
                        defaultValue={rem}
                        min={1}
                        max={rem}
                        className="w-28 rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-xs"
                      />
                      <select
                        name="refund_destination"
                        defaultValue="wallet"
                        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
                      >
                        <option value="wallet">Refund destination: Wallet</option>
                        <option value="original_method">Refund destination: Original method</option>
                      </select>
                      <input
                        type="text"
                        name="reason"
                        defaultValue={h.status === 'disputed' ? 'Dispute resolved & milestone confirmed' : 'Milestone confirmed'}
                        placeholder="Reason / milestone note"
                        className="w-56 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        disabled={pending}
                        data-testid={`hold-execute-btn-${h.id}`}
                        className="rounded-lg bg-ink px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-40"
                      >
                        Execute
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
