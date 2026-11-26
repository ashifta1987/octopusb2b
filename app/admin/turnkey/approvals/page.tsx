import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { feeStatusLabel, fromPrice, tkPhase } from '@/lib/turnkey/format';
import { TkFeeDecision } from '@/components/turnkey/fee-decision';

export const metadata = { title: 'Turnkey fee approvals' };

type Row = {
  id: string; project_id: string; project_code: string; project_title: string; client_name: string | null; stage: string; service_name: string; version: number;
  amount_cents: number; currency: string; status: string; note: string | null; starting_cents: number | null; active_cents: number | null;
  proposed_by: string; proposed_by_name: string | null; proposed_at: string; approved_by_name: string | null; approved_at: string | null;
  rejected_by_name: string | null; rejected_at: string | null; reject_reason: string | null;
};

/**
 * Admin › Turnkey › Fee approvals (T3; design: Admin "approves fees above 2x the starting fee", SetFee; programme D5:
 * the rule is for service fees). Only fees above 2× the starting fee (or with no starting fee) come here; fees within
 * 2× are active at once. An admin who did not propose the fee approves it, or rejects it with a reason. Shows the
 * starting fee, how many times it is, the fee it replaces, and the latest decisions.
 */
export default async function TurnkeyFeeApprovalsPage() {
  const s = await requireStaff('turnkey', 'view', '/admin/turnkey/approvals');
  if (!s.isAdmin) redirect('/forbidden');
  const sb = await createClient();
  const { data, error } = await sb.rpc('tk_list_fee_approvals', { p_decided_limit: 30 });
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, amount_cents: Number(r.amount_cents), starting_cents: r.starting_cents == null ? null : Number(r.starting_cents), active_cents: r.active_cents == null ? null : Number(r.active_cents) }));
  const pending = rows.filter((r) => r.status === 'pending_approval');
  const decided = rows.filter((r) => r.status !== 'pending_approval');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={<Link href="/admin/turnkey/projects" className="text-sm text-muted hover:text-ink">← Client projects</Link>}
        title="Fee approvals" subtitle="Turnkey fees above 2× the starting fee (or with no starting fee) wait here for an admin who did not propose them. The client sees the fee and can pay it once it is approved." />
      {error && <p role="alert" className="m-0 text-bad">The list could not be loaded. Reload the page.</p>}
      <Card title={`Waiting (${pending.length})`}>
        <div className="px-6 pb-6" data-testid="tk-approvals-pending">
          {pending.length === 0 ? <EmptyState title="Nothing to approve" body="New fee proposals appear here." /> : (
            <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line border border-line rounded-[12px]">
              {pending.map((r) => {
                const ph = tkPhase(r.stage);
                const fs = feeStatusLabel(r.status);
                const own = r.proposed_by === s.userId;
                const ratio = r.starting_cents ? r.amount_cents / r.starting_cents : null;
                return (
                  <li key={r.id} className="p-4 grid gap-3 md:grid-cols-[1fr_auto] items-start" data-testid={`tk-approval-${r.project_code}-${r.stage}`}>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/turnkey/projects/${r.project_code}`} className="font-semibold hover:text-coral-text">{r.project_title}</Link>
                        <span className="mono text-[12px] text-muted">{r.project_code}</span>
                        <StatusBadge status={r.status} label={fs.label} tone={fs.tone} />
                      </div>
                      <div className="text-[14px]">{r.service_name} · {ph ? `Phase ${ph.n} · ${ph.name}` : r.stage} · version {r.version} · {r.client_name ?? 'No company'}</div>
                      <div className="text-[15px]"><span className="mono font-semibold" data-testid={`tk-approval-amount-${r.id}`}>{money(r.amount_cents, r.currency)}</span>
                        <span className="text-[13px] text-muted">{r.starting_cents ? ` · starting fee ${fromPrice(r.starting_cents)} · ${ratio!.toFixed(1)}× the starting fee` : ' · no starting fee'}{r.active_cents != null ? ` · replaces ${money(r.active_cents, r.currency)}` : ''}</span></div>
                      <div className="text-[13px] text-muted">Proposed by {r.proposed_by_name ?? 'Former team member'} · {fmtDate(r.proposed_at, true)}</div>
                      {r.note && <div className="text-[13px]">Note: {r.note}</div>}
                    </div>
                    <TkFeeDecision feeId={r.id} code={r.project_code} canApprove={!own}
                      blockedReason={own ? 'You proposed this fee; another admin approves it.' : null} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
      <Card title="Latest decisions">
        <div className="px-6 pb-6" data-testid="tk-approvals-decided">
          {decided.length === 0 ? <EmptyState title="No decisions yet" /> : (
            <ul className="list-none m-0 p-0 flex flex-col divide-y divide-line">
              {decided.map((r) => {
                const fs = feeStatusLabel(r.status);
                return (
                  <li key={r.id} className="py-3 flex flex-col gap-1 text-[14px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/turnkey/projects/${r.project_code}`} className="font-semibold hover:text-coral-text">{r.project_code}</Link>
                      <span>{r.service_name} · {money(r.amount_cents, r.currency)} · version {r.version}</span>
                      <StatusBadge status={r.status} label={fs.label} tone={fs.tone} />
                    </div>
                    <div className="text-[13px] text-muted">
                      {r.status === 'rejected'
                        ? `Rejected by ${r.rejected_by_name ?? 'Former team member'} · ${fmtDate(r.rejected_at, true)}: ${r.reject_reason ?? ''}`
                        : `Approved by ${r.approved_by_name ?? 'Former team member'} · ${fmtDate(r.approved_at, true)}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
