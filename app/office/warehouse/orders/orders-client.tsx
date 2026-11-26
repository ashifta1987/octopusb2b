'use client';

import Link from 'next/link';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsTableCard } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { ORDER_STATUS, SOURCE_TEXT, type OrdersBoard } from '@/lib/warehouse-orders';
import { importDropshipAction, retryAllocationAction } from '../order-actions';
import { MsgLine, useRun } from '../wh-run';
import { DgBadge, OrderStatusBadge } from './order-bits';

const TILES: [string, string[]][] = [
  ['Waiting for stock', ['new']], ['Ready to pick', ['allocated']], ['Picking', ['picking']], ['Ready to pack', ['picked', 'packing']], ['Exceptions', ['exception']],
];

export function OrdersClient({ board }: { board: OrdersBoard }) {
  const { pending, msg, run } = useRun();
  const t = useRun();
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Orders by step" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {TILES.map(([label, keys]) => (
          <div key={label} className="ds-card !p-4" data-testid={`wh-orders-tile-${keys[0]}`}>
            <div className="text-[12.5px] text-[#5B6478]">{label}</div>
            <div className="text-[26px] font-bold leading-tight">{keys.reduce((n, k) => n + (board.counts[k] ?? 0), 0)}</div>
          </div>
        ))}
      </section>

      {board.can_import && (
        <DsCard title="Dropship orders handed to the warehouse" icon="truck" testId="wh-dropship-ready"
          subtitle="Paid Octopus Dropship orders whose stock is reserved (or received from sourcing). Bring them in to pick and pack here.">
          {board.dropship_ready.length === 0 ? (
            <p className="m-0 text-[13px] text-[#5B6478]" data-testid="wh-dropship-none">No Dropship order is waiting.</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-2">
              {board.dropship_ready.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#E3E7EF] p-3" data-testid={`wh-dropship-${d.order_number}`}>
                  <span className="font-mono font-semibold">{d.order_number}</span>
                  <span className="text-[13px] text-[#5B6478]">{d.items} item(s) · {d.units} unit(s) · paid order from {fmtWh(d.created_at)}</span>
                  <DsButton variant="secondary" icon="download" disabled={pending} className="ml-auto" testId={`wh-dropship-import-${d.order_number}`}
                    onClick={() => run(() => importDropshipAction(d.id))}>Bring in</DsButton>
                </li>
              ))}
            </ul>
          )}
          <MsgLine msg={msg} testId="wh-dropship-msg" />
        </DsCard>
      )}

      {board.orders.length === 0 ? (
        <DsEmptyState icon="cart" title="No orders here" description="Client orders arrive from the portal (form or CSV); Dropship orders are brought in above." testId="wh-orders-empty" />
      ) : (
        <DsTableCard title="Orders" icon="cart" testId="wh-orders-table" minWidth={900}
          headers={['Order', 'Owner', 'Source', 'Ship to', 'Units', 'Warehouse', 'Status', 'Received']}>
          {board.orders.map((o) => (
            <tr key={o.id} data-testid={`wh-order-row-${o.code}`}>
              <td>
                <Link href={`/office/warehouse/orders/${o.code}`} className="font-mono font-semibold text-[#2559B8] underline">{o.code}</Link>
                {(o.external_ref || o.store_order) && <div className="text-[12px] text-[#5B6478]">{o.store_order ?? o.external_ref}</div>}
              </td>
              <td>{o.owner}</td>
              <td>{SOURCE_TEXT[o.source] ?? o.source}</td>
              <td>{o.ship_name} · {o.ship_country}</td>
              <td>{o.units}{o.picked > 0 && o.status !== 'packed' ? <div className="text-[12px] text-[#5B6478]">{o.picked} picked</div> : null}</td>
              <td>{o.warehouse_code}</td>
              <td>
                <div className="flex flex-col gap-1 items-start">
                  <OrderStatusBadge status={o.status} />
                  <DgBadge kinds={o.dg_kinds} />
                  {o.override_locked && <DsBadge tone="bad" icon="lock">Override locked</DsBadge>}
                  {o.store_order_cancelled && <DsBadge tone="bad">Dropship order cancelled</DsBadge>}
                  {o.status === 'new' && (
                    <DsButton variant="link" disabled={t.pending} onClick={() => t.run(() => retryAllocationAction(o.id, o.code))} testId={`wh-retry-${o.code}`}>Check stock again</DsButton>
                  )}
                </div>
              </td>
              <td>{fmtWh(o.created_at)}</td>
            </tr>
          ))}
        </DsTableCard>
      )}
      <MsgLine msg={t.msg} testId="wh-orders-msg" />
      <p className="m-0 text-[12.5px] text-[#5B6478]">Status words: {Object.entries(ORDER_STATUS).filter(([k]) => !['labelled', 'shipped'].includes(k)).map(([, v]) => v[0]).join(' · ')}. Labels and hand-over come with dispatch.</p>
    </div>
  );
}
