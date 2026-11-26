'use client';

import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsInput } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { DG_LABEL } from '@/lib/warehouse-orders';
import { CARRIER_LABEL, SCAN_RESULT_LABEL, SHIPMENT_STATUS, grams, type DispatchBoard, type DispatchOrder, type DispatchParcel } from '@/lib/warehouse-w4';
import { confirmLabelAction, createLabelAction, logLabelPrintAction, voidLabelAction } from '../w4-actions';
import { MsgLine, useRun } from '../wh-run';
import { Handover } from './handover-client';
import { Freight } from './freight-client';
import { OnTheWay } from './tracking-client';

/** print only the element marked .wh-print-on (manifest or pallet label); the staff menu and controls are hidden on paper */
export const PRINT_CSS = `
@media print {
  @page { margin: 8mm; }
  body * { visibility: hidden !important; }
  .wh-print-on, .wh-print-on * { visibility: visible !important; }
  .wh-print-on { position: absolute; left: 0; top: 0; width: 100%; border: 0 !important; box-shadow: none !important; }
}`;

/** Warehouse OS · W4 board 13 — label parcels, label check, hand-over batches with manifest, freight pallets, tracking. */
export function DispatchClient({ board, labelUrls, warehouseNames, cities }: {
  board: DispatchBoard; labelUrls: Record<string, string>; warehouseNames: Record<string, string>; cities: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      {board.staging && (
        <p role="note" className="print:hidden m-0 rounded-[10px] border border-[#F3D9A4] bg-[#FFFBF2] px-4 py-3 text-[13.5px]" data-testid="wh-dispatch-sandbox-note">
          Staging: sandbox accounts make test labels whose tracking numbers start with <span className="font-mono">SBX</span>. They are never sent to a carrier.
        </p>
      )}
      <div className="print:hidden flex flex-col gap-5">
        <LabelQueue board={board} labelUrls={labelUrls} />
        <LabelCheck board={board} />
      </div>
      <Handover board={board} warehouseNames={warehouseNames} />
      <Freight board={board} warehouseNames={warehouseNames} cities={cities} />
      <div className="print:hidden"><OnTheWay board={board} /></div>
    </div>
  );
}

function LabelQueue({ board, labelUrls }: { board: DispatchBoard; labelUrls: Record<string, string> }) {
  const { pending, msg, run } = useRun();
  return (
    <DsCard title={`Label parcels · ${board.orders.length}`} icon="file" testId="wh-label-queue"
      subtitle="Packed orders. The carrier rules choose the service for each parcel; print the label, stick it on, then scan it at Label check.">
      <MsgLine msg={msg} testId="wh-label-msg" />
      {board.orders.length === 0 ? <p className="m-0 text-[13.5px] text-[#5B6478]">Nothing packed is waiting for a label.</p> : (
        <ul className="list-none m-0 p-0 flex flex-col gap-3">
          {board.orders.map((o) => <OrderRow key={o.id} o={o} labelUrls={labelUrls} canLabel={board.can_dispatch.includes(o.warehouse_code)}
            canVoid={board.can_void.includes(o.warehouse_code)} pending={pending} run={run} />)}
        </ul>
      )}
    </DsCard>
  );
}

function OrderRow({ o, labelUrls, canLabel, canVoid, pending, run }: {
  o: DispatchOrder; labelUrls: Record<string, string>; canLabel: boolean; canVoid: boolean; pending: boolean; run: ReturnType<typeof useRun>['run'];
}) {
  return (
    <li className="rounded-[10px] border border-[#E3E7EF] p-4 flex flex-col gap-2" data-testid={`wh-dispatch-order-${o.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{o.code}</span>
        <span className="text-[13px] text-[#5B6478]">{o.owner} · to {o.ship_country} · {o.parcels.length} parcel{o.parcels.length === 1 ? '' : 's'}</span>
        {o.dg_kinds.map((k) => <DsBadge key={k} tone="warn">{DG_LABEL[k] ?? k}</DsBadge>)}
        <DsBadge tone={o.status === 'labelled' ? 'ok' : 'info'}>{o.status === 'labelled' ? 'All parcels labelled' : 'Packed'}</DsBadge>
      </div>
      <ul className="list-none m-0 p-0 flex flex-col gap-2">
        {o.parcels.map((p) => <ParcelRow key={p.id} o={o} p={p} url={p.label ? labelUrls[p.label.label_path] : undefined} canLabel={canLabel} canVoid={canVoid} pending={pending} run={run} />)}
      </ul>
    </li>
  );
}

function ParcelRow({ o, p, url, canLabel, canVoid, pending, run }: {
  o: DispatchOrder; p: DispatchParcel; url?: string; canLabel: boolean; canVoid: boolean; pending: boolean; run: ReturnType<typeof useRun>['run'];
}) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const l = p.label;
  const id = `${o.code}-${p.seq}`;
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-[#EEF0F4] pt-2" data-testid={`wh-parcel-row-${id}`}>
      <span className="text-[13.5px] font-semibold">Parcel {p.seq}</span>
      <span className="text-[13px] text-[#5B6478]">{grams(p.weight_g)}{p.box ? ` · box ${p.box}` : ''}</span>
      {p.pallet ? <DsBadge tone="info">{`On freight pallet ${p.pallet}`}</DsBadge> : l ? (
        <>
          <span className="font-mono text-[13.5px]" data-testid={`wh-label-info-${id}`}>{l.tracking_no}</span>
          <span className="text-[13px]">{CARRIER_LABEL[l.carrier]} · {l.service_name}</span>
          {l.sandbox && <DsBadge tone="warn">Sandbox</DsBadge>}
          <DsBadge tone={SHIPMENT_STATUS[l.status][1]}>{SHIPMENT_STATUS[l.status][0]}</DsBadge>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="ds-btn ds-btn-secondary" data-testid={`wh-label-print-${id}`}
              onClick={() => { void logLabelPrintAction(l.id); }}>
              {l.printed > 0 ? 'Reprint label' : 'Print label'}<span className="sr-only"> for {o.code} parcel {p.seq} (opens the PDF)</span>
            </a>
          )}
          {canVoid && !voiding && <DsButton variant="link" onClick={() => setVoiding(true)}>Void label<span className="sr-only"> {l.tracking_no}</span></DsButton>}
          {voiding && (
            <span className="flex flex-wrap gap-2 items-end">
              <DsInput label={`Why is ${l.tracking_no} voided?`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} containerClassName="w-[240px]" />
              <DsButton variant="danger" disabled={pending || !reason.trim()} onClick={() => run(() => voidLabelAction(l.id, reason), () => { setVoiding(false); setReason(''); })}>Void</DsButton>
              <DsButton variant="link" onClick={() => setVoiding(false)}>Keep it</DsButton>
            </span>
          )}
          {l.rule_reason && <span className="basis-full text-[12.5px] text-[#5B6478]">Why this service: {l.rule_reason}</span>}
        </>
      ) : canLabel ? (
        <DsButton icon="file" disabled={pending} testId={`wh-label-make-${id}`} onClick={() => run(() => createLabelAction(p.id))}>
          Make label<span className="sr-only"> for {o.code} parcel {p.seq}</span>
        </DsButton>
      ) : <span className="text-[13px] text-[#5B6478]">No label yet</span>}
    </li>
  );
}

function LabelCheck({ board }: { board: DispatchBoard }) {
  const { pending, msg, run, setMsg } = useRun();
  const [order, setOrder] = useState('');
  const [scan, setScan] = useState('');
  const can = board.can_dispatch.length > 0;
  return (
    <DsCard title="Label check" icon="check" testId="wh-label-check"
      subtitle="Scan the order number, then the label on the parcel. A label that belongs to another order is refused and logged on the Exceptions queue.">
      {!can ? <p className="m-0 text-[13.5px] text-[#5B6478]">Packers, supervisors and admins of this warehouse check labels.</p> : (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => {
          e.preventDefault();
          if (!order.trim() || !scan.trim()) { setMsg({ ok: false, text: 'Scan the order number and the label.' }); return; }
          run(() => confirmLabelAction(order, scan), () => setScan(''));
        }}>
          <DsInput label="Order number" value={order} placeholder="WO-000123" autoComplete="off" onChange={(e) => setOrder(e.target.value.toUpperCase())} containerClassName="w-[180px]" />
          <DsInput label="Scan the label" value={scan} autoComplete="off" onChange={(e) => setScan(e.target.value)} containerClassName="w-[240px]" />
          <DsButton type="submit" icon="check" disabled={pending} testId="wh-label-check-submit">Check label</DsButton>
        </form>
      )}
      <div className="mt-2"><MsgLine msg={msg} testId="wh-label-check-msg" /></div>
      {board.scans.length > 0 && (
        <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Recent label checks">
          <table className="ds-tbl min-w-[560px]">
            <thead><tr><th scope="col">When</th><th scope="col">Order</th><th scope="col">Scanned</th><th scope="col">Result</th><th scope="col">By</th></tr></thead>
            <tbody>
              {board.scans.map((s, i) => (
                <tr key={i}><td>{fmtWh(s.at)}</td><td className="font-mono">{s.order_code}</td><td className="font-mono">{s.code}</td>
                  <td>{['ok', 'already'].includes(s.result) ? <DsBadge tone="ok">{SCAN_RESULT_LABEL[s.result]}</DsBadge> : <DsBadge tone="bad">{`${SCAN_RESULT_LABEL[s.result] ?? s.result}${s.exception ? ` · ${s.exception}` : ''}`}</DsBadge>}</td>
                  <td>{s.by_name ?? 'staff'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DsCard>
  );
}
