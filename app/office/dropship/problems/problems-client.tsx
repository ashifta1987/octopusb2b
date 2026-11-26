'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsChip, DsEmptyState, DsInput, DsNotice, DsPageHeader, DsTextarea } from '@/components/dropship-ui';
import type { StaffBoard, StaffCaseRow } from '@/lib/dropship-problems';
import { CASE_KIND_LABEL, caseStatusLabel, caseSteps, centsFromInput, fmtStamp, usd, waitingOn } from '@/lib/dropship-problems-shared';
import {
  approveRefundAction, carrierClaimAction, receiveReturnAction, refundAction, rejectCaseAction, reshipAction, reweighDecideAction,
  reweighDisputeDecideAction, settleReturnAction, type StaffResult,
} from './actions';

/**
 * Release 4 · Step 10 — staff Order problems: the Exceptions table of staff/StaffQueue.html for Dropship claims / returns
 * (Order · Merchant · Problem · Waiting on · SLA · Owner), the selected case with its steps and actions, re-weighs over
 * tolerance ("Charge the merchant $x?" → Create adjustment / Absorb, States-Staff) and re-weigh disputes.
 */

function sla(d: string | null) {
  if (!d) return { text: '—', tone: 'neutral' as const };
  const h = Math.round((new Date(d).getTime() - Date.now()) / 36e5);
  return h < 0 ? { text: `Late by ${-h} h`, tone: 'bad' as const } : { text: h < 24 ? `${h} h left` : `${Math.round(h / 24)} days left`, tone: h < 4 ? 'warn' as const : 'ok' as const };
}

export function ProblemsClient({ board, selected, tab: initialTab }: { board: StaffBoard; selected: string | null; tab: 'open' | 'reweigh' | 'done' }) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const rows = tab === 'done' ? board.done : board.open;
  const [sel, setSel] = useState<string | null>(selected ?? rows[0]?.code ?? null);
  const [result, setResult] = useState<StaffResult | null>(null);
  const [pending, start] = useTransition();
  const cur = rows.find((r) => r.code === sel) ?? null;
  const act = (p: Promise<StaffResult>) => start(async () => { const r = await p; setResult(r); if (r.ok) router.refresh(); });

  return (
    <div className="flex flex-col gap-5" data-testid="problems-page">
      <DsPageHeader title="Order problems" icon="flag"
        subtitle="Lost and damaged parcels, returns and re-weighs of Dropship orders. Every decision is sent to the merchant and logged. Refunds above US$1,000 need a second Finance approver." />
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Show">
        <DsChip pressed={tab === 'open'} onClick={() => { setTab('open'); setSel(board.open[0]?.code ?? null); }} testId="tab-open">{`Open (${board.open.length})`}</DsChip>
        <DsChip pressed={tab === 'reweigh'} onClick={() => setTab('reweigh')} testId="tab-reweigh">{`Re-weigh (${board.reweigh_candidates.length + board.reweigh_disputes.length})`}</DsChip>
        <DsChip pressed={tab === 'done'} onClick={() => { setTab('done'); setSel(board.done[0]?.code ?? null); }} testId="tab-done">Decided</DsChip>
      </div>
      {result && <DsNotice tone={result.ok ? 'ok' : 'bad'} title={result.ok ? 'Done' : 'Not done'} testId="problems-result">{result.message}</DsNotice>}

      {tab !== 'reweigh' && (
        <>
          <DsCard noPadding testId="problems-table">
            {rows.length === 0 ? <div className="p-5"><DsEmptyState icon="check" title="Nothing here" description="No order problems in this view." /></div> : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Order problems">
                <table className="ds-tbl min-w-[820px]">
                  <thead><tr><th scope="col">Order</th><th scope="col">Merchant</th><th scope="col">Problem</th><th scope="col">Waiting on</th><th scope="col">SLA</th><th scope="col">Owner</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const s = caseStatusLabel(r.status, r.kind);
                      const t = sla(r.ticket_sla_due_at);
                      return (
                        <tr key={r.id} className={r.code === sel ? 'bg-tint-2' : ''} data-testid={`problem-row-${r.code}`}>
                          <td><button type="button" aria-current={r.code === sel ? 'true' : undefined} className="font-mono text-coral-text underline bg-transparent border-0 cursor-pointer min-h-[44px] p-0" onClick={() => { setSel(r.code); setResult(null); }}>{r.external_order_name ?? r.order_number}</button>
                            <span className="block text-[12px] text-muted">{r.code}</span></td>
                          <td>{r.merchant}</td>
                          <td><DsBadge tone={r.kind === 'return' ? 'info' : 'bad'}>{CASE_KIND_LABEL[r.kind]}</DsBadge><span className="block text-[12px] text-muted">{s.label}</span></td>
                          <td>{waitingOn(r.status)}</td>
                          <td>{tab === 'open' ? <DsBadge tone={t.tone}>{t.text}</DsBadge> : fmtStamp(r.decided_at)}</td>
                          <td>{r.ticket_owner ?? 'Unassigned'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DsCard>
          {cur && <CaseDetail key={cur.id} c={cur} board={board} pending={pending} act={act} />}
        </>
      )}

      {tab === 'reweigh' && <Reweigh board={board} pending={pending} act={act} />}
    </div>
  );
}

function CaseDetail({ c, board, pending, act }: { c: StaffCaseRow; board: StaffBoard; pending: boolean; act: (p: Promise<StaffResult>) => void }) {
  const [ref, setRef] = useState(c.carrier_claim_ref ?? '');
  const [msg, setMsg] = useState('');
  const [amount, setAmount] = useState(((c.kind === 'return' ? c.suggested_refund_cents ?? 0 : c.refund_cap_cents) / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [carrierRef, setCarrierRef] = useState(c.return_tracking ?? '');
  const open = ['reported', 'carrier_claim', 'awaiting_return', 'received'].includes(c.status);
  const cents = centsFromInput(amount);
  const steps = caseSteps(c);
  const editDisabled = !board.can_edit ? 'Support or Dropship editors decide order problems.' : undefined;
  return (
    <section className="ds-card" aria-labelledby="pc-title" data-testid="problem-detail">
      <div className="flex justify-between gap-2 flex-wrap">
        <h2 id="pc-title" className="m-0 text-[18px] font-bold text-ink">{`Order ${c.external_order_name ?? c.order_number}: ${CASE_KIND_LABEL[c.kind].toLowerCase()} · ${c.code}`}</h2>
        <DsBadge tone={caseStatusLabel(c.status, c.kind).tone}>{caseStatusLabel(c.status, c.kind).label}</DsBadge>
      </div>
      <p className="m-0 mt-1 text-[13px] text-muted">{`${c.merchant} · reported ${fmtStamp(c.created_at)} · order total ${usd(c.order_total_cents)} · paid with ${c.payment_option ?? '—'}${c.protected_open ? ' (payment protection still holds it)' : ''}`}</p>
      <ol className="list-none m-0 mt-3 p-0 flex flex-col gap-2 text-[14px]">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-2 items-center"><DsBadge tone={s.state === 'done' ? 'ok' : s.state === 'current' ? 'warn' : 'neutral'}>{s.state === 'done' ? 'Done' : s.state === 'current' ? 'Waiting' : 'Next'}</DsBadge>{s.label}{s.detail ? ` · ${s.detail}` : ''}</li>
        ))}
      </ol>
      <p className="m-0 mt-3 text-[14px] text-ink whitespace-pre-line"><strong>Merchant wrote:</strong> {c.description}</p>
      {c.merchant_choice && <p className="m-0 mt-1 text-[14px]"><strong>Merchant asked for:</strong> {c.merchant_choice === 'reship' ? 'Reship' : 'Refund to the wallet'}</p>}
      {c.kind === 'return' && <p className="m-0 mt-1 text-[14px]"><strong>Return:</strong> {`${c.return_to === 'warehouse' ? 'to the warehouse' : 'to the merchant'} · ${String(c.return_reason ?? '').replace('_', ' ')} · ${c.return_units.map((u) => `${u.qty} × ${u.model_no}`).join(', ')}`}</p>}
      {c.warehouse_return && <p className="m-0 mt-1 text-[14px]"><strong>Warehouse:</strong> <Link className="text-coral-text underline" href={`/office/warehouse/returns?status=all&r=${c.warehouse_return.code}`}>{c.warehouse_return.code}</Link>{` · ${c.warehouse_return.status} · ${c.warehouse_return.good_units} of ${c.warehouse_return.units} good`}</p>}
      {(c.photo_urls ?? []).some(Boolean) && <div className="flex gap-2 flex-wrap mt-2">{(c.photo_urls ?? []).map((u, n) => u && <a key={n} href={u} target="_blank" rel="noopener noreferrer" className="text-[13px] text-coral-text underline min-h-[44px] inline-flex items-center">{`Photo ${n + 1}`}</a>)}</div>}
      {c.ticket && <p className="m-0 mt-1 text-[13px]"><Link className="text-coral-text underline" href={`/office/support?t=${c.ticket.id}`}>{`Ticket ${c.ticket.code}`}</Link></p>}
      {c.outcome_message && <p className="m-0 mt-2 text-[14px]"><strong>Decision:</strong> {c.outcome_message}</p>}

      {c.status === 'awaiting_approval' && c.approval && (
        <div className="mt-4 flex flex-col gap-2" data-testid="approval-box">
          <DsNotice tone="warn" title="Waiting for approval">{`Refund of ${usd(c.approval.amount_cents)} proposed by ${c.approval.requested_by_name ?? 'staff'}. Another Finance user or an admin must approve.`}</DsNotice>
          <DsTextarea label="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={600} />
          <div className="flex gap-2 flex-wrap">
            <DsButton icon="check" loading={pending} disabled={pending || !c.approval.can_approve} disabledReason={!c.approval.can_approve ? 'Only a different person with Finance approval rights can approve.' : undefined}
              onClick={() => act(approveRefundAction(c.id, true, note))} testId="approve-refund">{`Approve ${usd(c.approval.amount_cents)}`}</DsButton>
            <DsButton variant="danger" icon="x" disabled={pending || !c.approval.can_approve} onClick={() => act(approveRefundAction(c.id, false, note))} testId="reject-refund">Reject</DsButton>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-4 grid gap-4">
          {c.kind !== 'return' && c.status === 'reported' && (
            <div className="flex gap-2 items-end flex-wrap">
              <DsInput label="Carrier claim no." value={ref} onChange={(e) => setRef(e.target.value)} maxLength={64} containerClassName="min-w-[220px]" />
              <DsButton variant="secondary" disabled={pending || !ref.trim() || !board.can_edit} disabledReason={editDisabled} onClick={() => act(carrierClaimAction(c.id, ref))} testId="carrier-claim">Claim opened with the carrier</DsButton>
            </div>
          )}
          {c.kind === 'return' && c.status === 'awaiting_return' && (
            <div className="flex gap-2 items-end flex-wrap">
              <DsInput label="Return tracking / carrier reference" value={carrierRef} onChange={(e) => setCarrierRef(e.target.value)} maxLength={64} containerClassName="min-w-[240px]" />
              <DsButton variant="secondary" disabled={pending} onClick={() => act(receiveReturnAction(c.id, carrierRef))} testId="receive-return">Parcel arrived: register at the warehouse</DsButton>
              <span className="text-[12px] text-muted">Warehouse staff with the returns role.</span>
            </div>
          )}
          <DsTextarea label="Message to the merchant" value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} maxLength={600} />
          {c.kind !== 'return' && (
            <div className="flex gap-2 flex-wrap items-start">
              <DsButton icon="truck" loading={pending} disabled={pending || !board.can_edit} disabledReason={editDisabled} onClick={() => act(reshipAction(c.id, msg))} testId="reship-now">Reship now</DsButton>
            </div>
          )}
          {(c.kind !== 'return' || c.status === 'received') && (
            <div className="flex gap-2 items-end flex-wrap">
              <DsInput label={c.kind === 'return' ? `Refund (suggested ${usd(c.suggested_refund_cents ?? null)})` : 'Refund amount (US$)'} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
                hint={`At most ${usd(c.refund_cap_cents)}`} error={cents === null ? 'Amount: US$ with up to two decimals.' : undefined} containerClassName="min-w-[220px]" />
              {c.kind === 'return' ? (
                <DsButton variant="secondary" disabled={pending || cents === null || !board.can_edit} disabledReason={editDisabled} onClick={() => act(settleReturnAction(c.id, cents ?? 0, msg))} testId="settle-return">
                  {cents ? `Settle and refund ${usd(cents)}` : 'Settle without refund'}
                </DsButton>
              ) : (
                <DsButton variant="secondary" disabled={pending || !cents || !board.can_edit} disabledReason={editDisabled} onClick={() => act(refundAction(c.id, cents ?? 0, msg))} testId="refund-wallet">
                  {`Refund ${usd(cents ?? 0)} to wallet`}
                </DsButton>
              )}
            </div>
          )}
          <p className="m-0 text-[12px] text-muted">{`Refunds above ${usd(board.approval_limit_cents)} go to a second Finance approver.`}</p>
          <div className="flex gap-2 flex-wrap">
            <DsButton variant="danger" icon="x" disabled={pending || msg.trim().length < 5 || !board.can_edit} disabledReason={msg.trim().length < 5 ? 'Write the reason for the merchant first.' : editDisabled}
              onClick={() => act(rejectCaseAction(c.id, msg))} testId="reject-case">{c.kind === 'return' ? 'Close: not accepted' : 'Not covered: reject'}</DsButton>
          </div>
        </div>
      )}
    </section>
  );
}

function Reweigh({ board, pending, act }: { board: StaffBoard; pending: boolean; act: (p: Promise<StaffResult>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-4">
      <DsCard title="Over tolerance" subtitle="Parcels heavier than the weight billed at payment. Charging creates an OCT-DS invoice paid from the wallet; the merchant gets 7 days to dispute." testId="reweigh-candidates">
        {board.reweigh_candidates.length === 0 ? <p className="m-0 text-[14px] text-muted">Nothing to decide.</p> : (
          <ul className="list-none m-0 p-0 flex flex-col gap-3">
            {board.reweigh_candidates.map((r) => (
              <li key={r.store_order_id} className="border border-line rounded-[12px] p-4" data-testid={`reweigh-${r.order_number}`}>
                <strong className="text-ink">{r.tolerance_unknown ? `Order ${r.external_order_name ?? r.order_number} is heavier than billed` : `Charge the merchant ${usd(r.amount_cents)}?`}</strong>
                <p className="m-0 mt-1 text-[13px] text-muted">
                  {`${r.merchant} · ${r.order_number} · billed ${(r.billed_g / 1000).toFixed(2)} kg vs ${(r.quoted_g / 1000).toFixed(2)} kg estimate (+${r.diff_g} g; measured ${r.actual_g} g, box ${r.volumetric_g} g volumetric).`}
                  {r.tolerance_unknown ? ' The weighing tolerance of this order\u2019s fee version is not set, so nothing can be charged.' : ` Tolerance ${r.tolerance_g} g.`}
                  {' '}<Link className="text-coral-text underline" href={`/office/warehouse/evidence/${r.wh_order_code}`}>{r.photo_path ? 'Scale photo' : 'Packing record'}</Link>
                </p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  <DsButton disabled={pending || r.tolerance_unknown || !board.can_edit} disabledReason={r.tolerance_unknown ? 'Tolerance not set (owner input).' : undefined}
                    onClick={() => act(reweighDecideAction(r.store_order_id, 'charge'))} testId={`reweigh-charge-${r.order_number}`}>Create adjustment</DsButton>
                  <DsButton variant="secondary" disabled={pending || !board.can_edit} onClick={() => act(reweighDecideAction(r.store_order_id, 'absorb'))} testId={`reweigh-absorb-${r.order_number}`}>Absorb</DsButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DsCard>
      <DsCard title="Disputes" testId="reweigh-disputes">
        {board.reweigh_disputes.length === 0 ? <p className="m-0 text-[14px] text-muted">No open disputes.</p> : (
          <ul className="list-none m-0 p-0 flex flex-col gap-3">
            {board.reweigh_disputes.map((r) => (
              <li key={r.id} className="border border-line rounded-[12px] p-4">
                <strong className="text-ink">{`Re-weigh disputed: order ${r.external_order_name ?? r.order_number} (${usd(r.amount_cents)})`}</strong>
                <p className="m-0 mt-1 text-[13px] text-muted">{`${r.merchant} · billed ${r.billed_weight_g} g vs ${r.quoted_weight_g} g · disputed ${fmtStamp(r.disputed_at)}`}</p>
                <p className="m-0 mt-1 text-[14px]">{r.dispute_reason}</p>
                <DsTextarea label="Answer to the merchant" value={answers[r.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [r.id]: e.target.value }))} rows={2} maxLength={600} containerClassName="mt-2" />
                <div className="flex gap-2 mt-2 flex-wrap">
                  <DsButton disabled={pending || (answers[r.id] ?? '').trim().length < 5 || !board.can_edit} onClick={() => act(reweighDisputeDecideAction(r.id, true, answers[r.id] ?? ''))}>{`Refund ${usd(r.amount_cents)}`}</DsButton>
                  <DsButton variant="danger" disabled={pending || (answers[r.id] ?? '').trim().length < 5 || !board.can_edit} onClick={() => act(reweighDisputeDecideAction(r.id, false, answers[r.id] ?? ''))}>Reject with reason</DsButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DsCard>
    </div>
  );
}
