'use client';

import { useMemo, useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtDate, money } from '@/lib/format';
import { decideRatesAction, proposeRatesAction } from './actions';

export type RateVersion = {
  id: string; plan_code: string; warehouse_code: string | null; version: number;
  receiving_per_carton_cents: number | null; storage_per_pallet_month_cents: number | null; storage_per_cbm_month_cents: number | null;
  pick_pack_first_cents: number | null; pick_pack_extra_cents: number | null; returns_per_item_cents: number | null; min_monthly_cents: number | null;
  status: 'pending_approval' | 'active' | 'superseded' | 'rejected'; note: string | null; proposed_by: string; approved_by: string | null;
  effective_from: string | null; reject_reason: string | null; created_at: string;
};
const FEES: [keyof RateVersion, string][] = [
  ['receiving_per_carton_cents', 'Receiving, per carton'], ['storage_per_pallet_month_cents', 'Storage, per pallet per month'],
  ['storage_per_cbm_month_cents', 'Storage, per m³ per month'], ['pick_pack_first_cents', 'Pick and pack, first item'],
  ['pick_pack_extra_cents', 'Each extra item'], ['returns_per_item_cents', 'Returns, per item'], ['min_monthly_cents', 'Monthly minimum'],
];
const v = (x: unknown) => (x == null ? 'Not set' : money(Number(x), 'USD'));
const n = (x: unknown) => (x == null ? null : Number(x));

export function RatesClient({ versions, plans, warehouses, canPropose, isAdmin, me }: {
  versions: RateVersion[]; plans: { code: string; name: string; description: string | null }[]; warehouses: { code: string; name: string }[];
  canPropose: boolean; isAdmin: boolean; me: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const active = versions.filter((x) => x.status === 'active');
  const waiting = versions.filter((x) => x.status === 'pending_approval');
  const whName = Object.fromEntries(warehouses.map((w) => [w.code, w.name]));
  const run = (p: Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await p; setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Done.' : r.error ?? 'Something went wrong.' }); if (r.ok) after?.();
  });
  // monthly quote calculator (uses the active plan for all warehouses, or a warehouse override when chosen)
  const [q, setQ] = useState({ plan: plans[0]?.code ?? 'standard', wh: '', orders: '', items: '1', pallets: '', cartons: '', returns: '' });
  const rate = useMemo(() => active.find((x) => x.plan_code === q.plan && x.warehouse_code === (q.wh || null)) ?? active.find((x) => x.plan_code === q.plan && x.warehouse_code === null) ?? null, [active, q.plan, q.wh]);
  const quote = useMemo(() => {
    if (!rate) return null;
    const orders = Number(q.orders) || 0; const items = Math.max(1, Number(q.items) || 1); const pallets = Number(q.pallets) || 0; const cartons = Number(q.cartons) || 0; const rets = Number(q.returns) || 0;
    const parts: [string, number | null][] = [
      ['Receiving', n(rate.receiving_per_carton_cents) == null ? null : cartons * n(rate.receiving_per_carton_cents)!],
      ['Storage', n(rate.storage_per_pallet_month_cents) == null ? null : pallets * n(rate.storage_per_pallet_month_cents)!],
      ['Pick and pack', n(rate.pick_pack_first_cents) == null || n(rate.pick_pack_extra_cents) == null ? null : orders * (n(rate.pick_pack_first_cents)! + (items - 1) * n(rate.pick_pack_extra_cents)!)],
      ['Returns', n(rate.returns_per_item_cents) == null ? null : rets * n(rate.returns_per_item_cents)!],
    ];
    const known = parts.filter(([, c]) => c != null) as [string, number][];
    const sum = known.reduce((s, [, c]) => s + c, 0);
    const min = n(rate.min_monthly_cents);
    return { parts, total: min != null ? Math.max(sum, min) : sum, minApplied: min != null && sum < min, unknown: parts.some(([, c]) => c == null) };
  }, [rate, q]);

  return (
    <div className="flex flex-col gap-5">
      <DsCard title="Rate card" icon="percent" noPadding testId="wh-rate-card">
        <div className="ds-scroll">
          <table className="ds-tbl min-w-[760px]">
            <thead><tr><th scope="col">Fee</th>{plans.map((p) => <th key={p.code} scope="col">{p.name}</th>)}</tr></thead>
            <tbody>
              {FEES.map(([k, label]) => (
                <tr key={k}><td>{label}</td>{plans.map((p) => {
                  const a = active.find((x) => x.plan_code === p.code && x.warehouse_code === null);
                  return <td key={p.code} className="font-mono">{a ? v(a[k]) : 'Not set'}</td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 px-5 py-3 text-[12.5px] text-[#5B6478]">Prices for all warehouses. {active.some((x) => x.warehouse_code) ? `Warehouse prices: ${active.filter((x) => x.warehouse_code).map((x) => `${plans.find((p) => p.code === x.plan_code)?.name} at ${whName[x.warehouse_code!] ?? x.warehouse_code}`).join(', ')}.` : 'No warehouse has its own prices.'}</p>
      </DsCard>

      {waiting.length > 0 && (
        <DsCard title={`Waiting for approval (${waiting.length})`} icon="clock" testId="wh-rates-waiting">
          <div className="flex flex-col gap-3">
            {waiting.map((w) => {
              const mine = w.proposed_by === me;
              return (
                <div key={w.id} className="border-b border-[#E3E7EF] pb-3 last:border-0">
                  <p className="m-0 text-[13.5px]"><strong>{plans.find((p) => p.code === w.plan_code)?.name} · {w.warehouse_code ? whName[w.warehouse_code] ?? w.warehouse_code : 'All warehouses'} · v{w.version}</strong> · {fmtDate(w.created_at)}{w.note ? ` · ${w.note}` : ''}</p>
                  <p className="m-0 text-[12.5px] text-[#5B6478]">{FEES.map(([k, l]) => `${l}: ${v(w[k])}`).join(' · ')}</p>
                  {isAdmin && (rejecting === w.id ? (
                    <form className="mt-2 flex flex-wrap gap-2 items-end" onSubmit={(e) => { e.preventDefault(); run(decideRatesAction(w.id, 'reject', reason), () => setRejecting(null)); }}>
                      <DsInput label="Why is it rejected?" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
                      <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} disabledReason={!reason.trim() ? 'Enter a reason' : undefined}>Reject</DsButton>
                      <DsButton variant="link" onClick={() => setRejecting(null)}>Cancel</DsButton>
                    </form>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2 items-start">
                      <DsButton disabled={pending || mine} disabledReason={mine ? 'You can’t approve rates you proposed.' : undefined} onClick={() => run(decideRatesAction(w.id, 'approve'))} testId={`wh-rates-approve-${w.version}`}>Approve</DsButton>
                      <DsButton variant="secondary" disabled={pending} onClick={() => { setRejecting(w.id); setReason(''); }}>Reject</DsButton>
                    </div>
                  ))}
                  {!isAdmin && <p className="mt-1 mb-0 text-[12.5px] text-[#5B6478]">An admin approves client rates.</p>}
                </div>
              );
            })}
          </div>
        </DsCard>
      )}

      {canPropose && (
        <DsCard title="Propose new rates" icon="plus" testId="wh-rates-propose" subtitle="Leave a fee empty if it isn’t set yet. Clients never see a fee as 0 unless you enter 0.">
          <form className="grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(proposeRatesAction(fd)); }}>
            <DsSelect label="Plan" name="plan" defaultValue={plans[0]?.code}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</DsSelect>
            <DsSelect label="Warehouse" name="warehouse" defaultValue=""><option value="">All warehouses</option>{warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</DsSelect>
            <span />
            <DsInput label="Receiving, per carton (US$)" name="receiving" inputMode="decimal" />
            <DsInput label="Storage, per pallet per month (US$)" name="storage_pallet" inputMode="decimal" />
            <DsInput label="Storage, per m³ per month (US$)" name="storage_cbm" inputMode="decimal" />
            <DsInput label="Pick and pack, first item (US$)" name="pick_first" inputMode="decimal" />
            <DsInput label="Each extra item (US$)" name="pick_extra" inputMode="decimal" />
            <DsInput label="Returns, per item (US$)" name="returns" inputMode="decimal" />
            <DsInput label="Monthly minimum (US$)" name="min_monthly" inputMode="decimal" hint="Empty = no minimum" />
            <DsInput label="Note" name="note" containerClassName="md:col-span-2" />
            <div className="md:col-span-3"><DsButton type="submit" disabled={pending} testId="wh-rates-propose-submit">Propose</DsButton></div>
          </form>
        </DsCard>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-rates-msg" className={`m-0 text-[13px] ${msg.ok ? 'text-[#1B7F4B]' : 'text-[#B42318]'}`}>{msg.text}</p>}

      <DsCard title="Monthly quote" icon="dollar" testId="wh-quote">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <DsSelect label="Plan" value={q.plan} onChange={(e) => setQ({ ...q, plan: e.target.value })}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</DsSelect>
          <DsSelect label="Warehouse" value={q.wh} onChange={(e) => setQ({ ...q, wh: e.target.value })}><option value="">All warehouses</option>{warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}</DsSelect>
          <DsInput label="Orders a month" inputMode="numeric" value={q.orders} onChange={(e) => setQ({ ...q, orders: e.target.value })} />
          <DsInput label="Items per order" inputMode="numeric" value={q.items} onChange={(e) => setQ({ ...q, items: e.target.value })} />
          <DsInput label="Pallets stored" inputMode="numeric" value={q.pallets} onChange={(e) => setQ({ ...q, pallets: e.target.value })} />
          <DsInput label="Cartons received" inputMode="numeric" value={q.cartons} onChange={(e) => setQ({ ...q, cartons: e.target.value })} />
          <DsInput label="Returns" inputMode="numeric" value={q.returns} onChange={(e) => setQ({ ...q, returns: e.target.value })} />
        </div>
        {!quote ? <p className="mt-3 mb-0 text-[13.5px] text-[#5B6478]" data-testid="wh-quote-none">This plan has no active rates yet.</p> : (
          <dl className="mt-3 grid grid-cols-[180px_1fr] gap-y-1 m-0 text-[14px]" data-testid="wh-quote-result">
            {quote.parts.map(([k, c]) => <div key={k} className="contents"><dt className="text-[#5B6478]">{k}</dt><dd className="m-0 font-mono">{c == null ? 'Not set' : money(c, 'USD')}</dd></div>)}
            <dt className="font-semibold">Estimated month</dt><dd className="m-0 font-mono font-semibold">{money(quote.total, 'USD')}{quote.minApplied ? ' (monthly minimum)' : ''}{quote.unknown ? ' + fees not set yet' : ''}</dd>
          </dl>
        )}
        <p className="mt-2 mb-0 text-[12.5px] text-[#5B6478]">Shipping and packaging materials are charged on top, by use.</p>
      </DsCard>

      <DsCard title="History" icon="clock" noPadding>
        <div className="ds-scroll"><table className="ds-tbl min-w-[620px]">
          <thead><tr><th scope="col">Plan</th><th scope="col">Warehouse</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Date</th></tr></thead>
          <tbody>
            {versions.length === 0 && <tr><td colSpan={5} className="text-[#5B6478]">No rates proposed yet.</td></tr>}
            {versions.map((x) => (
              <tr key={x.id}><td>{plans.find((p) => p.code === x.plan_code)?.name ?? x.plan_code}</td><td>{x.warehouse_code ? whName[x.warehouse_code] ?? x.warehouse_code : 'All'}</td><td className="font-mono">v{x.version}</td>
                <td><DsBadge tone={x.status === 'active' ? 'ok' : x.status === 'pending_approval' ? 'warn' : x.status === 'rejected' ? 'bad' : 'neutral'}>{x.status === 'pending_approval' ? 'Waiting' : x.status === 'active' ? 'Active' : x.status === 'rejected' ? 'Rejected' : 'Replaced'}</DsBadge></td>
                <td>{fmtDate(x.effective_from ?? x.created_at)}</td></tr>
            ))}
          </tbody>
        </table></div>
      </DsCard>
    </div>
  );
}
