'use client';

import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsSelect } from '@/components/dropship-ui';
import { Barcode128 } from '@/components/warehouse/barcode';
import { fmtWh } from '@/lib/warehouse-inbound';
import { PALLET_STATUS, kg, type DispatchBoard, type FreightPallet } from '@/lib/warehouse-w4';
import { freightAddAction, freightCloseAction, freightCreateAction, freightDispatchAction, freightLabelPrintedAction, freightRemoveAction, freightReopenAction } from '../w4-actions';
import { MsgLine, useRun } from '../wh-run';

/** Board 13 — freight pallet build: client orders' parcels on an outbound pallet, weigh and measure, pallet label, dispatch. */
export function Freight({ board, warehouseNames, cities }: { board: DispatchBoard; warehouseNames: Record<string, string>; cities: Record<string, string> }) {
  const { pending, msg, run } = useRun();
  const places = board.can_dispatch;
  const [wh, setWh] = useState(places[0] ?? '');
  const [dest, setDest] = useState('');
  const [printing, setPrinting] = useState<{ code: string; copies: number } | null>(null);
  const active = board.pallets.filter((p) => p.status !== 'dispatched');
  const sent = board.pallets.filter((p) => p.status === 'dispatched');
  const print = (p: FreightPallet, copies: number) => {
    void freightLabelPrintedAction(p.id, copies);
    setPrinting({ code: p.code, copies });
    setTimeout(() => { window.print(); setPrinting(null); }, 50);
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <DsCard title="Freight pallets" icon="layers" testId="wh-freight"
          subtitle="For client orders that go by freight instead of a parcel carrier. Scan the orders onto the pallet, weigh and measure it, print its label, then dispatch it to the forwarder.">
          {places.length === 0 ? <p className="m-0 text-[13.5px] text-muted">Packers, supervisors and admins of this warehouse build pallets.</p> : (
            <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); if (dest.trim()) run(() => freightCreateAction(wh, dest), () => setDest('')); }}>
              {places.length > 1 && (
                <DsSelect label="Warehouse" value={wh} onChange={(e) => setWh(e.target.value)} containerClassName="w-[200px]">
                  {places.map((c) => <option key={c} value={c}>{warehouseNames[c] ?? c}</option>)}
                </DsSelect>
              )}
              <DsInput label="Destination" value={dest} maxLength={160} placeholder="e.g. Amazon FBA DTM2, Germany" onChange={(e) => setDest(e.target.value)} containerClassName="w-[320px]" />
              <DsButton type="submit" icon="plus" disabled={pending || !dest.trim()} testId="wh-freight-create">New pallet</DsButton>
              <MsgLine msg={msg} testId="wh-freight-msg" />
            </form>
          )}
        </DsCard>
      </div>
      {active.map((p) => <div key={p.id} className="print:hidden"><PalletCard p={p} canVoid={board.can_void.includes(p.warehouse_code)} onPrint={(n) => print(p, n)} /></div>)}
      {sent.length > 0 && (
        <DsCard title="Dispatched pallets" icon="truck" noPadding className="print:hidden" testId="wh-freight-sent">
          <ul className="list-none m-0 p-0">
            {sent.map((p) => (
              <li key={p.id} className="border-b border-divider last:border-0 px-5 py-2 text-[13.5px]">
                <span className="font-mono font-semibold">{p.code}</span> · {p.destination} · {p.orders.length} order{p.orders.length === 1 ? '' : 's'} · {kg(p.gross_weight_g)}
                <span className="text-muted"> · {p.forwarder}{p.reference ? ` ${p.reference}` : ''} · {fmtWh(p.dispatched_at)}</span>
              </li>
            ))}
          </ul>
        </DsCard>
      )}
      {printing && board.pallets.filter((p) => p.code === printing.code).map((p) => (
        <div key={p.code} className="hidden print:flex wh-print-on flex-wrap gap-3">
          {Array.from({ length: printing.copies }, (_, i) => <PalletLabel key={i} p={p} warehouse={`${cities[p.warehouse_code] ?? warehouseNames[p.warehouse_code] ?? p.warehouse_code}`} />)}
        </div>
      ))}
    </div>
  );
}

export function PalletLabel({ p, warehouse }: { p: FreightPallet; warehouse: string }) {
  const parcels = p.orders.reduce((n, o) => n + o.parcels, 0);
  return (
    <div className="bg-white text-black border border-black rounded-[4px] p-3 flex flex-col gap-1.5 w-[100mm] min-h-[70mm] max-w-full box-border" data-testid={`wh-pallet-label-${p.code}`}>
      <div className="flex justify-between text-[11px] uppercase tracking-[.08em]"><span>Freight pallet</span><span>From {warehouse}</span></div>
      <div className="text-[30px] font-bold font-mono leading-none">{p.code}</div>
      <div className="text-[15px] font-semibold">To {p.destination}</div>
      <div className="text-[12px]">{p.orders.length} order{p.orders.length === 1 ? '' : 's'} · {parcels} parcel{parcels === 1 ? '' : 's'} · gross {kg(p.gross_weight_g)}</div>
      {p.length_mm && <div className="text-[12px]">{p.length_mm / 10} × {(p.width_mm ?? 0) / 10} × {(p.height_mm ?? 0) / 10} cm</div>}
      <Barcode128 value={p.code} height={64} />
    </div>
  );
}

function PalletCard({ p, canVoid, onPrint }: { p: FreightPallet; canVoid: boolean; onPrint: (copies: number) => void }) {
  const { pending, msg, run, setMsg } = useRun();
  const [order, setOrder] = useState('');
  const [f, setF] = useState({ grossKg: '', lengthCm: '120', widthCm: '100', heightCm: '' });
  const [fw, setFw] = useState({ forwarder: '', reference: '' });
  const [copies, setCopies] = useState('2');
  const [reason, setReason] = useState('');
  const [label, tone] = PALLET_STATUS[p.status];
  const parcels = p.orders.reduce((n, o) => n + o.parcels, 0);
  const parcelsG = p.orders.reduce((n, o) => n + (o.weight_g ?? 0), 0);
  return (
    <DsCard title={`${p.code} · ${p.destination}`} icon="layers" testId={`wh-pallet-${p.code}`}
      subtitle={`${p.orders.length} order${p.orders.length === 1 ? '' : 's'} · ${parcels} parcel${parcels === 1 ? '' : 's'} · parcels ${kg(parcelsG)}${p.gross_weight_g ? ` · gross ${kg(p.gross_weight_g)}` : ''} · started ${fmtWh(p.created_at)}`}
      actions={<DsBadge tone={tone}>{label}</DsBadge>}>
      {p.status === 'open' && (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); if (!order.trim()) { setMsg({ ok: false, text: 'Scan the order number.' }); return; } run(() => freightAddAction(p.id, order), () => setOrder('')); }}>
          <DsInput label={`Scan an order onto ${p.code}`} value={order} placeholder="WO-000123" autoComplete="off" onChange={(e) => setOrder(e.target.value.toUpperCase())} containerClassName="w-[240px]" />
          <DsButton type="submit" icon="plus" disabled={pending} testId={`wh-pallet-add-${p.code}`}>Add order</DsButton>
        </form>
      )}
      {p.orders.length > 0 && (
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label={`Orders on ${p.code}`}>
          <table className="ds-tbl min-w-[520px]">
            <thead><tr><th scope="col">Order</th><th scope="col">Client</th><th scope="col">Parcels</th><th scope="col">Weight</th><th scope="col">To</th>{p.status === 'open' && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={o.order_id}><td className="font-mono">{o.order_code}</td><td>{o.owner ?? '—'}</td><td>{o.parcels}</td><td>{kg(o.weight_g)}</td><td>{o.ship_country}</td>
                  {p.status === 'open' && <td><DsButton variant="link" disabled={pending} onClick={() => run(() => freightRemoveAction(p.id, o.order_id))}>Take off<span className="sr-only"> {o.order_code}</span></DsButton></td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.status === 'open' && p.orders.length > 0 && (
        <div className="mt-4 pt-4 border-t border-divider flex flex-wrap gap-3 items-end">
          <DsInput label="Gross weight (kg)" inputMode="decimal" value={f.grossKg} onChange={(e) => setF({ ...f, grossKg: e.target.value.replace(/[^\d.,]/g, '').slice(0, 9) })} containerClassName="w-[150px]" />
          <DsInput label="Length (cm)" inputMode="decimal" value={f.lengthCm} onChange={(e) => setF({ ...f, lengthCm: e.target.value.replace(/[^\d.,]/g, '').slice(0, 6) })} containerClassName="w-[120px]" />
          <DsInput label="Width (cm)" inputMode="decimal" value={f.widthCm} onChange={(e) => setF({ ...f, widthCm: e.target.value.replace(/[^\d.,]/g, '').slice(0, 6) })} containerClassName="w-[120px]" />
          <DsInput label="Height (cm)" inputMode="decimal" value={f.heightCm} onChange={(e) => setF({ ...f, heightCm: e.target.value.replace(/[^\d.,]/g, '').slice(0, 6) })} containerClassName="w-[120px]" />
          <DsButton icon="check" disabled={pending || !f.grossKg || !f.heightCm} disabledReason={!f.grossKg || !f.heightCm ? 'Weigh and measure the pallet' : undefined}
            testId={`wh-pallet-close-${p.code}`} onClick={() => run(() => freightCloseAction(p.id, f))}>Close pallet</DsButton>
        </div>
      )}
      {p.status === 'closed' && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 items-end">
            <DsInput label="Label copies" inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, '').slice(0, 2))} containerClassName="w-[120px]" />
            <DsButton variant="secondary" icon="file" disabled={!(Number(copies) >= 1 && Number(copies) <= 20)} testId={`wh-pallet-print-${p.code}`} onClick={() => onPrint(Number(copies))}>
              {p.printed > 0 ? 'Reprint pallet label' : 'Print pallet label'}
            </DsButton>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <DsInput label="Freight forwarder" value={fw.forwarder} maxLength={120} onChange={(e) => setFw({ ...fw, forwarder: e.target.value })} containerClassName="w-[240px]" />
            <DsInput label="Booking reference (optional)" value={fw.reference} maxLength={64} onChange={(e) => setFw({ ...fw, reference: e.target.value })} containerClassName="w-[220px]" />
            <DsButton icon="send" disabled={pending || !fw.forwarder.trim()} disabledReason={fw.forwarder.trim() ? undefined : 'Enter the forwarder'} testId={`wh-pallet-dispatch-${p.code}`}
              onClick={() => run(() => freightDispatchAction(p.id, fw.forwarder, fw.reference))}>Dispatch pallet</DsButton>
          </div>
          {canVoid && (
            <details>
              <summary className="cursor-pointer text-[13px] text-muted min-h-[44px] flex items-center">Reopen this pallet (supervisor)</summary>
              <div className="flex flex-wrap gap-3 items-end">
                <DsInput label="Why is it reopened?" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} containerClassName="w-[260px]" />
                <DsButton variant="secondary" disabled={pending || !reason.trim()} onClick={() => run(() => freightReopenAction(p.id, reason))}>Reopen</DsButton>
              </div>
            </details>
          )}
        </div>
      )}
      <div className="mt-2"><MsgLine msg={msg} testId={`wh-pallet-msg-${p.code}`} /></div>
    </DsCard>
  );
}
