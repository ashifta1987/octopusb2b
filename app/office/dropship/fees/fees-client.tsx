'use client';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsNotice } from '@/components/dropship-ui';
import { fmtDate, money } from '@/lib/format';
import { activateFeeVersionAction, proposeFeeVersionAction, rejectFeeVersionAction } from './actions';

export type FeeVersion = {
  id: string; version: number; status: string;
  pick_pack_first_cents: number; pick_pack_extra_cents: number; packaging_cents: number;
  storage_per_cbm_day_cents: number; return_handling_cents: number; branded_packaging_cents: number | null; insurance_bp: number;
  weigh_tolerance_g: number | null; weigh_tolerance_pct: number | null; dispute_window_days: number | null;
  effective_from: string | null; superseded_at: string | null; note: string | null;
  proposed_by: string; proposed_by_name: string | null; approved_by_name: string | null; created_at: string;
};
export type FeesAccess = { userId: string; canProposeFee: boolean; canApproveFee: boolean; readOnly: boolean };

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  active: 'ok', pending_approval: 'warn', rejected: 'bad', superseded: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  active: 'Active', pending_approval: 'Waiting for approval', rejected: 'Rejected', superseded: 'Replaced',
};
const NOT_SET = 'Not set';
const usd = (c: number | null | undefined) => (c == null ? NOT_SET : money(c, 'USD'));
const toUsd = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p role={m.ok ? 'status' : 'alert'} data-testid="fees-msg" className={`m-0 text-[13px] ${m.ok ? 'text-ok' : 'text-bad'}`}>{m.text}</p>;
}

/** design v2 StaffFees: merchant fees (3PL), weighing tolerance, internal charges and plans (Step 12). */
export function FeesClient({ fees, access }: { fees: FeeVersion[]; access: FeesAccess }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const active = fees.find((r) => r.status === 'active');
  const waiting = fees.filter((r) => r.status === 'pending_approval');
  const run = (p: Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await p; setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' });
  });

  return (
    <div className="flex flex-col gap-5">
      {access.readOnly && <DsNotice tone="info" title="Read only">You can see the fees and their history. 3PL, Finance and admins make changes.</DsNotice>}

      <DsCard title={active ? `Merchant fees · version ${active.version}, from ${fmtDate(active.effective_from)}` : 'Merchant fees'} icon="percent" noPadding testId="fee-versions"
        subtitle={active ? undefined : 'No active fee version yet. Merchant prices can’t be quoted until one is approved.'}>
        {active ? (
          <div className="ds-scroll" tabIndex={0}>
            <table className="ds-tbl min-w-[560px]" data-testid="active-fee-version">
              <thead><tr><th scope="col">Fee</th><th scope="col">Amount</th><th scope="col">Owner</th></tr></thead>
              <tbody>
                <tr><td>Processing, first item</td><td className="font-mono">{usd(active.pick_pack_first_cents)}</td><td>3PL</td></tr>
                <tr><td>Processing, each extra item</td><td className="font-mono">{usd(active.pick_pack_extra_cents)}</td><td>3PL</td></tr>
                <tr><td>Protective packaging</td><td className="font-mono">{usd(active.packaging_cents)}</td><td>3PL</td></tr>
                <tr><td>Branded packaging handling</td><td className="font-mono">{usd(active.branded_packaging_cents)}</td><td>3PL</td></tr>
                <tr><td>Storage of merchant-owned stock, per m³ per day</td><td className="font-mono">{usd(active.storage_per_cbm_day_cents)}</td><td>3PL</td></tr>
                <tr><td>Insurance</td><td>{active.insurance_bp ? `${active.insurance_bp / 100}% of declared value` : 'Off'}</td><td>Shipping</td></tr>
              </tbody>
            </table>
          </div>
        ) : <p className="m-0 px-5 pb-4 text-[13px] text-muted">{access.canProposeFee ? 'Propose the first version below.' : 'A 3PL or Finance colleague proposes the first version.'}</p>}
      </DsCard>

      <DsCard title="Weighing tolerance" icon="scale" testId="fee-tolerance">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 m-0 text-[13.5px]">
          <div><dt className="text-muted text-[12.5px]">Absorb differences up to (g)</dt><dd className="m-0 font-semibold">{active?.weigh_tolerance_g ?? NOT_SET}</dd></div>
          <div><dt className="text-muted text-[12.5px]">or up to (%)</dt><dd className="m-0 font-semibold">{active?.weigh_tolerance_pct ?? NOT_SET}</dd></div>
          <div><dt className="text-muted text-[12.5px]">Dispute window (days)</dt><dd className="m-0 font-semibold">{active?.dispute_window_days ?? NOT_SET}</dd></div>
        </dl>
      </DsCard>

      {waiting.length > 0 && (
        <DsCard title={`Waiting for approval (${waiting.length})`} icon="clock" testId="fee-waiting">
          <div className="flex flex-col gap-3">
            {waiting.map((w) => {
              const mine = w.proposed_by === access.userId;
              return (
                <div key={w.id} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0" data-testid={`pending-fee-${w.version}`}>
                  <div className="text-[13.5px]">
                    <strong>Version {w.version}</strong> · first {usd(w.pick_pack_first_cents)} · extra {usd(w.pick_pack_extra_cents)} · packaging {usd(w.packaging_cents)} ·
                    branded {usd(w.branded_packaging_cents)} · tolerance {w.weigh_tolerance_g ?? '—'} g / {w.weigh_tolerance_pct ?? '—'} % · disputes {w.dispute_window_days ?? '—'} days
                    <div className="text-[12px] text-muted">Proposed by {w.proposed_by_name ?? 'staff'} on {fmtDate(w.created_at)}{w.note ? ` · ${w.note}` : ''} · orders already paid keep the version used at payment</div>
                  </div>
                  {rejectId === w.id ? (
                    <form className="flex flex-wrap gap-2 items-end" action={() => run(rejectFeeVersionAction(w.id, reason).then((x) => { if (x.ok) setRejectId(null); return x; }))}>
                      <DsInput label="Why is it rejected?" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                      <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>Reject</DsButton>
                      <DsButton variant="link" onClick={() => setRejectId(null)}>Cancel</DsButton>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2 items-start">
                      {access.canApproveFee && (
                        <DsButton disabled={pending || mine} disabledReason={mine ? 'You can’t approve a change you proposed.' : undefined}
                          testId={`approve-fee-${w.version}`} onClick={() => run(activateFeeVersionAction(w.id))}>Approve and activate</DsButton>
                      )}
                      {(access.canApproveFee || access.canProposeFee) && (
                        <DsButton variant="secondary" disabled={pending} testId={`reject-fee-${w.version}`} onClick={() => { setRejectId(w.id); setReason(''); }}>Reject</DsButton>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DsCard>
      )}

      {access.canProposeFee && (
        <div id="propose" className="scroll-mt-20">
        <DsCard title="Propose changes" icon="plus" subtitle="Fee changes take effect when a second person approves. Orders keep the fee version used at payment." testId="propose-fee">
          <form className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="propose-fee-form" onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await proposeFeeVersionAction(fd);
              setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Proposed.' : r.error ?? 'Could not propose.' });
            });
          }}>
            <DsInput label="Processing, first item (US$)" name="first" inputMode="decimal" required defaultValue={toUsd(active?.pick_pack_first_cents)} />
            <DsInput label="Each extra item (US$)" name="extra" inputMode="decimal" required defaultValue={toUsd(active?.pick_pack_extra_cents)} />
            <DsInput label="Protective packaging (US$)" name="packaging" inputMode="decimal" defaultValue={toUsd(active?.packaging_cents)} />
            <DsInput label="Branded packaging handling (US$)" name="branded" inputMode="decimal" hint="Leave empty if not set yet" defaultValue={toUsd(active?.branded_packaging_cents)} />
            <DsInput label="Storage per m³ per day (US$)" name="storage" inputMode="decimal" defaultValue={toUsd(active?.storage_per_cbm_day_cents)} />
            <input type="hidden" name="returns" value={toUsd(active?.return_handling_cents)} />
            <DsInput label="Weighing tolerance (g)" name="tol_g" inputMode="numeric" defaultValue={active?.weigh_tolerance_g ?? ''} />
            <DsInput label="or tolerance (%)" name="tol_pct" inputMode="decimal" defaultValue={active?.weigh_tolerance_pct ?? ''} />
            <DsInput label="Dispute window (days)" name="dispute_days" inputMode="numeric" defaultValue={active?.dispute_window_days ?? ''} />
            <DsInput label="Note" name="note" placeholder="Why this change" />
            <div className="md:col-span-3"><DsButton type="submit" disabled={pending} testId="propose-fee-submit">Propose changes</DsButton></div>
          </form>
        </DsCard>
        </div>
      )}
      <Msg m={msg} />

      <DsCard title="Internal charges (management reports only)" icon="layers" testId="fee-internal">
        <p className="m-0 text-[13px] text-muted">Charges between Dropship, 3PL, Shipping and Sourcing are set up with plan billing (Step 12). Only Dropship invoices the merchant; internal charges are removed from company totals.</p>
      </DsCard>
      <DsCard title="Plans" icon="card" testId="fee-plans">
        <p className="m-0 text-[13px] text-muted">Plan prices and limits are set up with plan billing (Step 12) and stay off until Finance switches them on. No plan prices are shown until they are confirmed.</p>
      </DsCard>

      <DsCard title="History" icon="clock" noPadding>
        <div className="ds-scroll" tabIndex={0}>
          <table className="ds-tbl min-w-[820px]" data-testid="fee-history">
            <thead><tr><th scope="col">Version</th><th scope="col">Status</th><th scope="col">First / extra / packaging</th><th scope="col">Branded</th><th scope="col">Tolerance</th><th scope="col">Proposed</th><th scope="col">Approved</th></tr></thead>
            <tbody>
              {fees.length === 0 && <tr><td colSpan={7} className="text-muted">No fee versions yet.</td></tr>}
              {fees.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono">v{f.version}</td>
                  <td><DsBadge tone={STATUS_TONE[f.status] ?? 'neutral'}>{STATUS_LABEL[f.status] ?? f.status}</DsBadge></td>
                  <td className="font-mono">{usd(f.pick_pack_first_cents)} / {usd(f.pick_pack_extra_cents)} / {usd(f.packaging_cents)}</td>
                  <td className="font-mono">{usd(f.branded_packaging_cents)}</td>
                  <td>{f.weigh_tolerance_g ?? '—'} g / {f.weigh_tolerance_pct ?? '—'} % · {f.dispute_window_days ?? '—'} days</td>
                  <td>{f.proposed_by_name ?? '—'}<div className="text-[12px] text-muted">{fmtDate(f.created_at)}</div></td>
                  <td>{f.approved_by_name ?? '—'}{f.effective_from && <div className="text-[12px] text-muted">{fmtDate(f.effective_from)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DsCard>
    </div>
  );
}
