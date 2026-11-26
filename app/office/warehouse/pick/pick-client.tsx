'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DsBadge, DsButton, DsCard, DsEmptyState, DsInput, DsNotice } from '@/components/dropship-ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import type { DetailLine, OrderDetail, PickBoard } from '@/lib/warehouse-orders';
import { pickScanAction, reportShortAction, startPickAction } from '../order-actions';
import { MsgLine, useRun } from '../wh-run';
import { DgBadge, OrderStatusBadge } from '../orders/order-bits';

const upper = (s: string) => s.toUpperCase().replace(/\s+/g, '');
const focusItem = () => document.getElementById('wh-pick-item')?.focus();

function ShortForm({ d, line }: { d: OrderDetail; line: DetailLine }) {
  const { pending, msg, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <DsButton variant="link" onClick={() => setOpen(true)} testId={`wh-short-toggle-${line.sku}`}>Can’t find the rest?</DsButton>;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => reportShortAction(d.order.id, d.order.code, line.id, reason)); }}>
      <DsInput label="What did you find?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Bin empty, damaged units …" />
      <div className="flex gap-2">
        <DsButton type="submit" variant="danger" disabled={pending || !reason.trim()} testId={`wh-short-submit-${line.sku}`}>Report short</DsButton>
        <DsButton variant="link" onClick={() => setOpen(false)}>Keep picking</DsButton>
      </div>
      <MsgLine msg={msg} testId="wh-short-msg" />
    </form>
  );
}

function PickOrder({ d }: { d: OrderDetail }) {
  const o = d.order;
  const { pending, msg, run } = useRun();
  const [bin, setBin] = useState('');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('1');
  const open = ['allocated', 'picking'].includes(o.status);
  const left = d.lines.reduce((n, l) => n + l.qty - l.picked - l.short, 0);
  const qtyNum = Number(qty);
  const why = !bin ? 'Scan the bin' : !item ? 'Scan the product' : !(Number.isInteger(qtyNum) && qtyNum > 0) ? 'Enter the units' : undefined;
  const submit = () => {
    if (why || pending) return;
    run(() => pickScanAction({ orderId: o.id, code: o.code, bin, item, qty: qtyNum }), () => { setItem(''); setQty('1'); focusItem(); });
  };
  return (
    <div className="flex flex-col gap-4 max-w-[640px]" data-testid="wh-pick-order">
      <DsCard title={o.code} icon="cart" actions={<><OrderStatusBadge status={o.status} testId="wh-pick-status" /><DgBadge kinds={o.dg_kinds} /></>}>
        <p className="m-0 text-[14px]">{o.owner} · {o.ship_name} · {o.ship_country}</p>
        <p className="mt-1 mb-0 text-[20px] font-bold" data-testid="wh-pick-left">{left} unit{left === 1 ? '' : 's'} left to pick</p>
        {!d.can_pick && <p className="mt-2 mb-0 text-[13px] text-[#5B6478]">Packers, supervisors and admins of this warehouse pick.</p>}
        {o.status === 'picked' && (
          <div className="mt-3"><DsNotice tone="ok" title="Fully picked" action={<Link href={`/office/warehouse/pack?order=${o.code}`} className="font-semibold text-[#2559B8] underline">Packing station</Link>}>Take the items to packing.</DsNotice></div>
        )}
        {o.status === 'exception' && <div className="mt-3"><DsNotice tone="bad" title="Stopped">{o.exception_reason}</DsNotice></div>}
        {o.status === 'allocated' && d.can_pick && (
          <div className="mt-3"><DsButton icon="check" disabled={pending} onClick={() => run(() => startPickAction(o.id, o.code))} testId="wh-pick-start" className="min-h-[52px] w-full sm:w-auto">Start picking</DsButton></div>
        )}
      </DsCard>

      {open && d.can_pick && o.status === 'picking' && (
        <DsCard title="Scan" icon="search" testId="wh-pick-scan">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <DsInput id="wh-pick-bin" label="Bin" placeholder="A-01-03" value={bin} autoComplete="off" autoCapitalize="characters" inputMode="text"
              className="text-[20px] min-h-[52px]" onChange={(e) => setBin(upper(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusItem(); } }} />
            <DsInput id="wh-pick-item" label="Product (SKU or barcode)" value={item} autoComplete="off" autoCapitalize="characters"
              className="text-[20px] min-h-[52px]" onChange={(e) => setItem(upper(e.target.value))} />
            <DsInput label="Units" inputMode="numeric" pattern="[0-9]*" value={qty} className="text-[20px] min-h-[52px]"
              onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} hint="Scan once per unit, or type how many you took from this bin" />
            <DsButton type="submit" icon="check" disabled={pending || Boolean(why)} disabledReason={why} className="min-h-[52px] w-full" testId="wh-pick-submit">Confirm pick</DsButton>
            <MsgLine msg={msg} testId="wh-pick-msg" />
          </form>
        </DsCard>
      )}
      {!(open && d.can_pick && o.status === 'picking') && <MsgLine msg={msg} testId="wh-pick-msg" />}

      {d.lines.map((l) => {
        const rest = l.qty - l.picked - l.short;
        return (
          <DsCard key={l.id} title={l.sku} icon="box" testId={`wh-pick-line-${l.sku}`}
            actions={rest === 0 ? <DsBadge tone={l.short ? 'bad' : 'ok'}>{l.short ? `${l.short} short` : 'Picked'}</DsBadge> : <DsBadge tone="info">{rest} to pick</DsBadge>}>
            <p className="m-0 text-[14px]">{l.name}</p>
            <p className="mt-1 mb-0 text-[13px] text-[#5B6478]">{l.picked} of {l.qty} picked{l.barcode ? ` · barcode ${l.barcode}` : ''}</p>
            {rest > 0 && (
              l.suggest.length ? (
                <ul className="mt-2 mb-0 p-0 list-none flex flex-col gap-1" data-testid="wh-pick-suggest">
                  {l.suggest.map((s, i) => (
                    <li key={i} className={`text-[15px] ${i === 0 ? 'font-bold' : 'text-[#5B6478]'}`}>
                      {i === 0 ? 'Go to ' : 'Then '}<button type="button" className="font-mono underline text-[#2559B8]" onClick={() => { setBin(s.bin); focusItem(); }}>{s.bin}</button> · {s.lot} · {s.qty} there
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 mb-0 text-[13px] text-[#B42318]">Not in any bin here — it must be put away first.</p>
            )}
            {rest > 0 && open && d.can_pick && <div className="mt-2"><ShortForm d={d} line={l} /></div>}
          </DsCard>
        );
      })}
      <Link href="/office/warehouse/pick" className="text-[14px] font-semibold text-[#2559B8] underline">← All orders to pick</Link>
    </div>
  );
}

export function PickClient({ board, detail }: { board: PickBoard; detail: OrderDetail | null }) {
  if (detail) return <PickOrder d={detail} />;
  if (board.orders.length === 0) {
    return <DsEmptyState icon="list" title="Nothing to pick" description="Orders appear here once their stock is reserved." testId="wh-pick-empty" />;
  }
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-3 max-w-[640px]" data-testid="wh-pick-list">
      {board.orders.map((o) => (
        <li key={o.id}>
          <Link href={`/office/warehouse/pick?order=${o.code}`} data-testid={`wh-pick-open-${o.code}`}
            className="ds-card !p-4 flex flex-wrap items-center gap-3 no-underline text-[#1A174A] hover:bg-[#F7F9FC] min-h-[64px]">
            <span className="font-mono font-bold text-[17px]">{o.code}</span>
            <OrderStatusBadge status={o.status} />
            <span className="text-[14px]">{o.units - o.picked} unit(s) · {o.lines} line(s)</span>
            <span className="text-[13px] text-[#5B6478] w-full">{o.owner} · {o.warehouse_code} · since {fmtWh(o.allocated_at ?? o.created_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
