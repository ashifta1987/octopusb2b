/**
 * ODS T9 · /admin/turnkey/approvals — presentational. Fees above 2× the starting fee (or with none), inspection fees and
 * China visit fees waiting for an admin who did not propose them. Decisions are TODAY's components (TkFeeDecision →
 * decideFeeAction; InspectionFeeDecision; TripFeeDecision): the proposer can't approve (UI) and the database refuses too.
 */
import { EmptyState } from '@octopus/ui';
import { fmtDate } from '@/lib/format';
import { feeStatusLabel, fromPrice, inspectionLabel, tkPhase } from '@/lib/turnkey/format';
import { TkFeeDecision } from '@/components/turnkey/fee-decision';
import { InspectionFeeDecision } from '@/components/turnkey/qc-staff';
import { TripFeeDecision } from '@/components/turnkey/trips-staff';
import { feeRatio } from '../_lib/turnkey-logic';
import { A, LoadError, Panel, TkPill, TurnkeyHead } from './tk-ui';

export type FeeApprovalRow = {
  id: string; project_code: string; project_title: string; client_name: string | null; stage: string; service_name: string; version: number;
  amount_cents: number; currency: string; status: string; note: string | null; starting_cents: number | null; active_cents: number | null;
  proposed_by: string; proposed_by_name: string | null; proposed_at: string; approved_by_name: string | null; approved_at: string | null;
  rejected_by_name: string | null; rejected_at: string | null; reject_reason: string | null;
};
export type InspApprovalRow = { id: string; project_code: string; project_title: string; client_name: string | null; kind: string; round: number; version: number; amount_cents: number; starting_cents: number | null; note: string | null; proposed_by: string; proposed_by_name: string | null; proposed_at: string };
export type TripApprovalRow = { id: string; project_code: string; project_title: string; client_name: string | null; trip_label: string; version: number; amount_cents: number; starting_cents: number; note: string | null; proposed_by: string; proposed_by_name: string | null; proposed_at: string };

export type ApprovalsViewProps = { userId: string; rows: FeeApprovalRow[]; insp: InspApprovalRow[]; trips: TripApprovalRow[]; error: boolean; money: (c: number, cur?: string) => string };

const item = 'grid items-start gap-3 p-3 ods-tablet:grid-cols-[1fr_auto]';
const listCls = 'm-0 grid list-none gap-0 divide-y divide-ods-line rounded-ods-card border border-ods-line p-0';

function Who({ name, at, note }: { name: string | null; at: string; note: string | null }) {
  return (
    <>
      <div className="text-ods-small text-ods-slate">Proposed by {name ?? 'Former team member'} · {fmtDate(at, true)}</div>
      {note ? <div className="text-ods-small">Note: {note}</div> : null}
    </>
  );
}

export function ApprovalsView({ userId, rows, insp, trips, error, money }: ApprovalsViewProps) {
  const pending = rows.filter((r) => r.status === 'pending_approval');
  const decided = rows.filter((r) => r.status !== 'pending_approval');
  return (
    <div className="grid gap-4" data-testid="tk-approvals">
      <TurnkeyHead
        title="Fee approvals"
        subtitle="Turnkey fees above 2× the starting fee (or with no starting fee) wait here for an admin who did not propose them. The client sees the fee and can pay it once it is approved."
        crumbs={[{ label: 'Turnkey', href: '/admin/turnkey' }, { label: 'Fee approvals' }]}
        current="approvals"
        isAdmin
      />
      {error ? <LoadError what="the list" /> : null}
      <Panel title={`Waiting (${pending.length})`} testId="tk-approvals-pending">
        {pending.length === 0 ? <EmptyState title="Nothing to approve" description="New fee proposals appear here." headingLevel={3} /> : (
          <ul className={listCls}>
            {pending.map((r) => {
              const ph = tkPhase(r.stage);
              const fs = feeStatusLabel(r.status);
              const own = r.proposed_by === userId;
              return (
                <li key={r.id} className={item} data-testid={`tk-approval-${r.project_code}-${r.stage}`}>
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2"><A href={`/admin/turnkey/projects/${r.project_code}`}>{r.project_title}</A><span className="font-mono text-ods-small text-ods-slate">{r.project_code}</span><TkPill label={fs.label} tone={fs.tone} /></div>
                    <div className="text-ods-table">{r.service_name} · {ph ? `Phase ${ph.n} · ${ph.name}` : r.stage} · version {r.version} · {r.client_name ?? 'No company'}</div>
                    <div className="text-ods-body"><span className="font-semibold tabular-nums" data-testid={`tk-approval-amount-${r.id}`}>{money(r.amount_cents, r.currency)}</span>
                      <span className="text-ods-small text-ods-slate">{r.starting_cents ? ` · starting fee ${fromPrice(r.starting_cents)} · ${feeRatio(r.amount_cents, r.starting_cents)} the starting fee` : ' · no starting fee'}{r.active_cents != null ? ` · replaces ${money(r.active_cents, r.currency)}` : ''}</span></div>
                    <Who name={r.proposed_by_name} at={r.proposed_at} note={r.note} />
                    {own ? <p className="m-0 text-ods-small font-semibold text-ods-warning" data-testid={`tk-approval-own-${r.id}`}>Second approver needed: you proposed this fee, so another admin approves it.</p> : null}
                  </div>
                  <TkFeeDecision feeId={r.id} code={r.project_code} canApprove={!own} blockedReason={own ? 'You proposed this fee; another admin approves it.' : null} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title={`Inspection fees waiting (${insp.length})`} testId="tk-approvals-inspections">
        {insp.length === 0 ? <EmptyState title="Nothing to approve" description="Inspection fees above 2× the starting fee appear here." headingLevel={3} /> : (
          <ul className={listCls}>
            {insp.map((r) => (
              <li key={r.id} className={item} data-testid={`tk-approval-insp-${r.project_code}-${r.kind}-${r.round}`}>
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2"><A href={`/admin/turnkey/projects/${r.project_code}`}>{r.project_title}</A><span className="font-mono text-ods-small text-ods-slate">{r.project_code}</span></div>
                  <div className="text-ods-table">{inspectionLabel(r.kind, r.round)} · version {r.version} · {r.client_name ?? 'No company'}</div>
                  <div className="text-ods-body"><span className="font-semibold tabular-nums">{money(r.amount_cents)}</span><span className="text-ods-small text-ods-slate">{r.starting_cents ? ` · starting fee ${fromPrice(r.starting_cents)} · ${feeRatio(r.amount_cents, r.starting_cents)} the starting fee` : ' · no starting fee'}</span></div>
                  <Who name={r.proposed_by_name} at={r.proposed_at} note={r.note} />
                </div>
                <InspectionFeeDecision feeId={r.id} code={r.project_code} isAdmin canApprove={r.proposed_by !== userId} canWithdraw={false} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={`China visit fees waiting (${trips.length})`} testId="tk-approvals-trips">
        {trips.length === 0 ? <EmptyState title="Nothing to approve" description="Trip fees above 2× the trip's list price appear here." headingLevel={3} /> : (
          <ul className={listCls}>
            {trips.map((r) => (
              <li key={r.id} className={item} data-testid={`tk-approval-trip-${r.project_code}`}>
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2"><A href={`/admin/turnkey/projects/${r.project_code}`}>{r.project_title}</A><span className="font-mono text-ods-small text-ods-slate">{r.project_code}</span></div>
                  <div className="text-ods-table">{r.trip_label} · version {r.version} · {r.client_name ?? 'No company'}</div>
                  <div className="text-ods-body"><span className="font-semibold tabular-nums">{money(r.amount_cents)}</span><span className="text-ods-small text-ods-slate"> · list price {money(r.starting_cents)} · {feeRatio(r.amount_cents, r.starting_cents)} the list price</span></div>
                  <Who name={r.proposed_by_name} at={r.proposed_at} note={r.note} />
                </div>
                <TripFeeDecision feeId={r.id} code={r.project_code} isAdmin canApprove={r.proposed_by !== userId} canWithdraw={false} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Latest decisions" testId="tk-approvals-decided">
        {decided.length === 0 ? <EmptyState title="No decisions yet" headingLevel={3} /> : (
          <ul className="m-0 grid list-none gap-0 divide-y divide-ods-line p-0">
            {decided.map((r) => {
              const fs = feeStatusLabel(r.status);
              return (
                <li key={r.id} className="grid gap-1 py-2 text-ods-table">
                  <div className="flex flex-wrap items-center gap-2"><A href={`/admin/turnkey/projects/${r.project_code}`}>{r.project_code}</A><span>{r.service_name} · {money(r.amount_cents, r.currency)} · version {r.version}</span><TkPill label={fs.label} tone={fs.tone} /></div>
                  <div className="text-ods-small text-ods-slate">{r.status === 'rejected' ? `Rejected by ${r.rejected_by_name ?? 'Former team member'} · ${fmtDate(r.rejected_at, true)}: ${r.reject_reason ?? ''}` : `Approved by ${r.approved_by_name ?? 'Former team member'} · ${fmtDate(r.approved_at, true)}`}</div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
