'use client';

import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { CARRIER_LABEL, SHIPMENT_STATUS, grams, kg, type Dispatch, type DispatchBoard } from '@/lib/warehouse-w4';
import { cancelDispatchAction, closeDispatchAction, dispatchRemoveAction, dispatchScanAction, openDispatchAction } from '../w4-actions';
import { MsgLine, useRun } from '../wh-run';

/** Hand-over batches per carrier account: scan checked labels in, hand over with who took them, print the manifest. */
export function Handover({ board, warehouseNames }: { board: DispatchBoard; warehouseNames: Record<string, string> }) {
  const { pending, msg, run } = useRun();
  const accounts = board.accounts.filter((a) => board.can_dispatch.includes(a.warehouse_code));
  const [account, setAccount] = useState(accounts[0]?.id ?? '');
  const [printing, setPrinting] = useState<string | null>(null);
  const open = board.dispatches.filter((d) => d.status === 'open');
  const closed = board.dispatches.filter((d) => d.status === 'handed_over');
  // render the sheet first, then open the print dialog
  const print = (code: string) => { setPrinting(code); setTimeout(() => { window.print(); setPrinting(null); }, 50); };
  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <DsCard title="Hand over to the carrier" icon="truck" testId="wh-handover"
          subtitle={`One batch per carrier account. ${board.ready.length} checked label${board.ready.length === 1 ? '' : 's'} waiting for a batch.`}>
          {accounts.length === 0 ? <p className="m-0 text-[13.5px] text-muted">No carrier account here yet (Carriers and rules).</p> : (
            <div className="flex flex-wrap gap-3 items-end">
              <DsSelect label="Carrier account" value={account} onChange={(e) => setAccount(e.target.value)} containerClassName="w-[280px]">
                {accounts.map((a) => <option key={a.id} value={a.id}>{`${CARRIER_LABEL[a.carrier]} · ${a.name}${a.mode === 'sandbox' ? ' (sandbox)' : ''}${Object.keys(warehouseNames).length > 1 ? ` · ${warehouseNames[a.warehouse_code] ?? a.warehouse_code}` : ''}`}</option>)}
              </DsSelect>
              <DsButton icon="plus" disabled={pending || !account} testId="wh-dispatch-open" onClick={() => run(() => openDispatchAction(account))}>Start a batch</DsButton>
              <MsgLine msg={msg} testId="wh-dispatch-open-msg" />
            </div>
          )}
          {board.ready.length > 0 && (
            <ul className="mt-3 mb-0 pl-5 text-[13px] text-muted" aria-label="Checked labels waiting for a batch">
              {board.ready.map((l) => <li key={l.id}><span className="font-mono">{l.tracking_no}</span> · {l.order_code} parcel {l.parcel_seq} · {CARRIER_LABEL[l.carrier]} {l.service_name}</li>)}
            </ul>
          )}
        </DsCard>
      </div>
      {open.map((d) => <div key={d.id} className="print:hidden"><OpenBatch d={d} /></div>)}
      {closed.length > 0 && (
        <DsCard title="Manifests" icon="list" noPadding testId="wh-manifests" className="print:hidden" subtitle="Handed-over batches of the last 30 days.">
          <ul className="list-none m-0 p-0">
            {closed.map((d) => (
              <li key={d.id} className="border-b border-divider last:border-0 px-5 py-3">
                <Manifest d={d} onPrint={() => print(d.code)} warehouseName={warehouseNames[d.warehouse_code] ?? d.warehouse_code} />
              </li>
            ))}
          </ul>
        </DsCard>
      )}
      {printing && closed.filter((d) => d.code === printing).map((d) => (
        <div key={d.code} className="hidden print:block wh-print-on"><Manifest d={d} onPrint={() => undefined} warehouseName={warehouseNames[d.warehouse_code] ?? d.warehouse_code} sheet /></div>
      ))}
    </div>
  );
}

function OpenBatch({ d }: { d: Dispatch }) {
  const { pending, msg, run, setMsg } = useRun();
  const [scan, setScan] = useState('');
  const [to, setTo] = useState('');
  const [mf, setMf] = useState('');
  const [reason, setReason] = useState('');
  const total = d.lines.reduce((n, l) => n + (l.weight_g ?? 0), 0);
  return (
    <DsCard title={`${d.code} · ${d.account ? `${CARRIER_LABEL[d.account.carrier]} · ${d.account.name}` : ''}`} icon="package" testId={`wh-dispatch-${d.code}`}
      subtitle={`Started ${fmtWh(d.created_at)} · ${d.lines.length} parcel${d.lines.length === 1 ? '' : 's'} · ${kg(total)}`}>
      <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); if (!scan.trim()) { setMsg({ ok: false, text: 'Scan a label.' }); return; } run(() => dispatchScanAction(d.id, scan), () => setScan('')); }}>
        <DsInput label={`Scan a label into ${d.code}`} value={scan} autoComplete="off" onChange={(e) => setScan(e.target.value)} containerClassName="w-[260px]" />
        <DsButton type="submit" icon="plus" disabled={pending} testId={`wh-dispatch-scan-${d.code}`}>Add</DsButton>
      </form>
      {d.lines.length > 0 && (
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label={`Parcels in ${d.code}`}>
          <table className="ds-tbl min-w-[560px]">
            <thead><tr><th scope="col">Tracking</th><th scope="col">Order</th><th scope="col">Weight</th><th scope="col">To</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id} data-testid={`wh-dispatch-line-${l.tracking_no}`}>
                  <td className="font-mono">{l.tracking_no}{l.sandbox ? ' (sandbox)' : ''}</td><td>{l.order_code} · parcel {l.parcel_seq}</td><td>{grams(l.weight_g)}</td><td>{l.ship_country}</td>
                  <td><DsButton variant="link" disabled={pending} onClick={() => run(() => dispatchRemoveAction(d.id, l.id))}>Take out<span className="sr-only"> {l.tracking_no}</span></DsButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 pt-4 border-t border-divider flex flex-wrap gap-3 items-end">
        <DsInput label="Handed to (driver or pickup reference)" value={to} maxLength={120} onChange={(e) => setTo(e.target.value)} containerClassName="w-[280px]" />
        <DsInput label="Carrier manifest number (optional)" value={mf} maxLength={64} onChange={(e) => setMf(e.target.value)} containerClassName="w-[240px]" />
        <DsButton icon="send" disabled={pending || d.lines.length === 0 || !to.trim()} disabledReason={d.lines.length === 0 ? 'Scan labels in first' : !to.trim() ? 'Enter who took the parcels' : undefined}
          testId={`wh-dispatch-close-${d.code}`} onClick={() => run(() => closeDispatchAction(d.id, to, mf))}>Hand over {d.lines.length} parcel{d.lines.length === 1 ? '' : 's'}</DsButton>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-muted min-h-[44px] flex items-center">Cancel this batch</summary>
        <div className="flex flex-wrap gap-3 items-end">
          <DsInput label="Why is the batch cancelled?" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} containerClassName="w-[280px]" />
          <DsButton variant="secondary" disabled={pending || !reason.trim()} onClick={() => run(() => cancelDispatchAction(d.id, reason))}>Cancel batch</DsButton>
        </div>
      </details>
      <div className="mt-2"><MsgLine msg={msg} testId={`wh-dispatch-msg-${d.code}`} /></div>
    </DsCard>
  );
}

function Manifest({ d, onPrint, warehouseName, sheet = false }: { d: Dispatch; onPrint: () => void; warehouseName: string; sheet?: boolean }) {
  const total = d.lines.reduce((n, l) => n + (l.weight_g ?? 0), 0);
  return (
    <section aria-label={`Manifest ${d.manifest_no ?? d.code}`} data-testid={sheet ? undefined : `wh-manifest-${d.code}`} className={sheet ? 'bg-white text-black p-2' : ''}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{d.manifest_no}</span>
        <span className="text-[13px]">{d.code} · {d.account ? `${CARRIER_LABEL[d.account.carrier]} · ${d.account.name}` : ''} · {warehouseName}</span>
        {d.account?.mode === 'sandbox' && <DsBadge tone="warn">Sandbox · not a real hand-over</DsBadge>}
        {!sheet && <DsButton variant="link" onClick={onPrint} testId={`wh-manifest-print-${d.code}`}>Print manifest<span className="sr-only"> {d.manifest_no}</span></DsButton>}
      </div>
      <p className="m-0 mt-1 text-[13px] text-muted">Handed to {d.handed_to} · {fmtWh(d.closed_at)} by {d.closed_by_name ?? 'staff'} · {d.lines.length} parcel{d.lines.length === 1 ? '' : 's'} · {kg(total)}</p>
      <div className="mt-2 overflow-x-auto" tabIndex={sheet ? undefined : 0} role={sheet ? undefined : 'region'} aria-label={sheet ? undefined : `Parcels on manifest ${d.manifest_no}`}>
        <table className="ds-tbl min-w-[520px]">
          <thead><tr><th scope="col">Tracking</th><th scope="col">Order</th><th scope="col">Service</th><th scope="col">Weight</th><th scope="col">To</th><th scope="col">Now</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id}><td className="font-mono">{l.tracking_no}</td><td>{l.order_code} · P{l.parcel_seq}</td><td>{l.service_name}</td><td>{grams(l.weight_g)}</td><td>{l.ship_country}</td>
                <td>{SHIPMENT_STATUS[l.status][0]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet && <p className="mt-6 text-[12px]">Received by: ____________________ Signature: ____________________ Date / time: ______________</p>}
    </section>
  );
}
