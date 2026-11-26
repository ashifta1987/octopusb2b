'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsSelect } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { CARRIER_LABEL, SHIPMENT_STATUS, TRACKING_STATUSES, TRACKING_STATUS_LABEL, trackingPath, type DispatchBoard, type OnTheWay as Row } from '@/lib/warehouse-w4';
import { addTrackingEventAction, sandboxNextEventAction } from '../w4-actions';
import { MsgLine, useRun } from '../wh-run';

/** Parcels on the way: last event, the customer tracking page, staff events (what the carrier reported), sandbox steps on staging. */
export function OnTheWay({ board }: { board: DispatchBoard }) {
  return (
    <DsCard title={`On the way · ${board.on_the_way.length}`} icon="activity" noPadding testId="wh-on-the-way"
      subtitle="Live carrier accounts are polled for tracking; add what the carrier or the customer reported here. The customer reads the description on the tracking page.">
      {board.on_the_way.length === 0 ? <p className="m-0 px-5 py-4 text-[13.5px] text-muted">Nothing on the way.</p> : (
        <ul className="list-none m-0 p-0">
          {board.on_the_way.map((r) => <TrackRow key={r.id} r={r} staging={board.staging} canAdd={board.can_dispatch.includes(r.warehouse_code)} />)}
        </ul>
      )}
    </DsCard>
  );
}

function TrackRow({ r, staging, canAdd }: { r: Row; staging: boolean; canAdd: boolean }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ status: 'in_transit', description: '', location: '' });
  const [label, tone] = SHIPMENT_STATUS[r.status];
  return (
    <li className="border-b border-divider last:border-0 px-5 py-3 flex flex-col gap-2" data-testid={`wh-track-${r.tracking_no}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{r.tracking_no}</span>
        <span className="text-[13px]">{r.order_code} · parcel {r.parcel_seq} · {CARRIER_LABEL[r.carrier]} {r.service_name} · to {r.ship_country}</span>
        {r.sandbox && <DsBadge tone="warn">Sandbox</DsBadge>}
        <DsBadge tone={tone}>{label}</DsBadge>
        {r.tracking_token && <Link href={trackingPath(r.tracking_token)} target="_blank" className="text-[13px] font-semibold underline">Customer tracking page<span className="sr-only"> for {r.order_code}</span></Link>}
      </div>
      {r.last_event && <p className="m-0 text-[13px] text-muted">Last: {r.last_event.description} · {fmtWh(r.last_event.at)}</p>}
      {canAdd && (
        <div className="flex flex-wrap gap-2">
          {staging && r.sandbox && r.status !== 'delivered' && (
            <DsButton variant="secondary" disabled={pending} testId={`wh-track-sandbox-${r.tracking_no}`} onClick={() => run(() => sandboxNextEventAction(r.id))}>
              Next sandbox event<span className="sr-only"> for {r.tracking_no}</span>
            </DsButton>
          )}
          <DsButton variant="link" onClick={() => setOpen((x) => !x)}>{open ? 'Close' : 'Add a tracking event'}<span className="sr-only"> for {r.tracking_no}</span></DsButton>
        </div>
      )}
      {open && (
        <form className="flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); run(() => addTrackingEventAction({ shipmentId: r.id, palletId: null, ...f }), () => { setOpen(false); setF({ status: 'in_transit', description: '', location: '' }); }); }}>
          <DsSelect label="What happened" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} containerClassName="w-[220px]">
            {TRACKING_STATUSES.map((s) => <option key={s} value={s}>{TRACKING_STATUS_LABEL[s]}</option>)}
          </DsSelect>
          <DsInput label="What the customer reads" value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} containerClassName="w-[300px]" />
          <DsInput label="Place (optional)" value={f.location} maxLength={120} onChange={(e) => setF({ ...f, location: e.target.value })} containerClassName="w-[180px]" />
          <DsButton type="submit" disabled={pending || f.description.trim().length < 3}>Save event</DsButton>
        </form>
      )}
      <MsgLine msg={msg} testId={`wh-track-msg-${r.tracking_no}`} />
    </li>
  );
}
