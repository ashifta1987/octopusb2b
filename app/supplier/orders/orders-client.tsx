'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsChip, DsEmptyState, DsInput, DsNotice, DsPageHeader, DsSelect, DsTableCard, DsTextarea } from '@/components/dropship-ui';
import { CARRIERS, ORDER_STATUS, carrierLabel, countryName, fmtDay } from '@/lib/dropship-ds14-shared';
import type { SupOrder, SupOrders } from '@/lib/dropship-ds14';
import { orderDetailAction, problemAction, shipAction } from '../actions';
import { SupplierFrame } from '../frame';

type Tab = 'to_ship' | 'shipped' | 'problems';
const tabOf = (o: SupOrder): Tab => (o.status === 'shipped' ? 'shipped' : o.status === 'to_ship' ? 'to_ship' : 'problems');

function Detail({ o, detail, onDone }: { o: SupOrder; detail: SupOrder; onDone: () => void }) {
  const [carrier, setCarrier] = useState<string>('yunexpress');
  const [other, setOther] = useState('');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const a = detail.ship_to;
  const open = o.status === 'to_ship' || o.status === 'problem';
  const ship = () => start(async () => {
    const r = await shipAction(o.id, carrier, other, tracking);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: r.data.all_shipped ? 'Marked as shipped. Octopus sends the tracking number on.' : 'Marked as shipped. The order completes when the other supplier ships too.' });
    onDone();
  });
  const problem = () => start(async () => {
    const r = await problemAction(o.id, note);
    if (!r.ok) { setMsg({ ok: false, text: r.message }); return; }
    setMsg({ ok: true, text: 'Staff were told.' });
    onDone();
  });
  return (
    <DsCard title={`Order ${o.order}`} subtitle={o.ship_by ? `Ship by ${fmtDay(o.ship_by)}` : undefined} icon="package" testId="supplier-order-detail">
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 m-0 text-[14px]">
        {o.items.flatMap((i, k) => [
          <div key={`t${k}`}><dt className="text-[12px] text-[#5B6478]">Item</dt><dd className="m-0 font-semibold">{i.title}{i.variant ? ` (${i.variant})` : ''}</dd></div>,
          <div key={`s${k}`}><dt className="text-[12px] text-[#5B6478]">SKU and quantity</dt><dd className="m-0">{i.sku} × {i.qty}</dd></div>,
        ])}
        <div className="sm:col-span-2"><dt className="text-[12px] text-[#5B6478]">Ship to (for shipping only)</dt>
          <dd className="m-0" data-testid="supplier-ship-to">{a ? [a.name, a.line1, a.line2, [a.postcode, a.city].filter(Boolean).join(' '), a.region, countryName(a.country), a.phone].filter(Boolean).map((l, i) => <div key={i}>{l}</div>) : '—'}</dd></div>
      </dl>
      {o.status === 'shipped' && <p className="mt-3 mb-0 text-[14px]">Shipped with {carrierLabel(o.carrier)}. Tracking number <b>{o.tracking_no}</b>.</p>}
      {o.status === 'cancelled' && <DsNotice tone="bad" title="This order was cancelled">Do not ship it. If you already packed it, tell your Octopus contact.</DsNotice>}
      {o.problem_note && <p className="mt-3 mb-0 text-[14px] text-[#8A5300]">You reported: {o.problem_note}</p>}
      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <DsSelect label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>{CARRIERS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</DsSelect>
            {carrier === 'other' && <DsInput label="Carrier name" value={other} onChange={(e) => setOther(e.target.value)} />}
            <DsInput label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} hint="Letters, digits and dashes, no spaces." />
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="ds-btn ds-btn-secondary min-h-[44px] inline-flex items-center gap-2" href={`/api/dropship-supplier/packing-slip/${o.id}`} target="_blank" rel="noopener noreferrer" >Download packing slip</a>
            <DsButton onClick={ship} loading={pending} icon="truck" testId="supplier-mark-shipped">Mark as shipped</DsButton>
          </div>
          <DsNotice tone="info" title="Use the Octopus packing slip only">Do not add your own invoice, logo or contact details to the parcel. The slip must be printed before you mark the order shipped.</DsNotice>
          <details><summary className="min-h-[44px] flex items-center cursor-pointer text-[14px] font-semibold text-[#2A6FD1]">Report a problem</summary>
            <div className="flex flex-col gap-2 pt-2"><DsTextarea label="What is wrong?" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              <div><DsButton variant="secondary" onClick={problem} loading={pending}>Tell staff</DsButton></div></div></details>
        </div>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} className={`text-[14px] mt-3 ${msg.ok ? 'text-[#0B6A65]' : 'text-[#B42318]'}`} data-testid="supplier-order-msg">{msg.text}</div>}
    </DsCard>
  );
}

export function OrdersClient({ data }: { data: SupOrders }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('to_ship');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupOrder | null>(null);
  const [loading, start] = useTransition();
  const rows = data.orders.filter((o) => tabOf(o) === tab);
  const n = (t: Tab) => data.orders.filter((o) => tabOf(o) === t).length;
  const open = (o: SupOrder) => start(async () => {
    setOpenId(o.id);
    const r = await orderDetailAction(o.id);
    setDetail(r.ok ? r.data : null);
  });
  const current = data.orders.find((o) => o.id === openId) ?? null;
  return (
    <SupplierFrame testId="supplier-orders-page">
      <DsPageHeader title="Orders to ship" subtitle="Pack, add tracking and mark as shipped. Buyer details are for shipping only." icon="truck" />
      <div className="flex flex-wrap gap-2">
        {([['to_ship', 'To ship'], ['shipped', 'Shipped'], ['problems', 'Problems']] as [Tab, string][]).map(([k, l]) => <DsChip key={k} pressed={tab === k} onClick={() => setTab(k)}>{l} ({n(k)})</DsChip>)}
      </div>
      {rows.length === 0 ? (
        <DsEmptyState title={tab === 'to_ship' ? 'Nothing to ship' : tab === 'shipped' ? 'No shipped orders yet' : 'No problems'} description="Octopus sends you paid orders here. You get an email for each new one." icon="truck" />
      ) : (
        <DsTableCard title="Orders" headers={['Order', 'Product', 'Qty', 'Country', 'Status', '']} minWidth={640}>
          {rows.map((o) => {
            const st = ORDER_STATUS[o.status];
            return (
              <tr key={o.id} data-testid="supplier-order-row">
                <td className="font-semibold">{o.order}</td>
                <td>{o.items.map((i) => i.title + (i.variant ? ` (${i.variant})` : '')).join(', ')}</td>
                <td>{o.items.reduce((s, i) => s + i.qty, 0)}</td>
                <td>{countryName(o.country)}</td>
                <td><DsBadge tone={st.tone}>{st.label}</DsBadge></td>
                <td><DsButton variant="secondary" onClick={() => open(o)} aria-label={`Open order ${o.order}`}>Open</DsButton></td>
              </tr>
            );
          })}
        </DsTableCard>
      )}
      {loading && <p role="status" className="text-[14px] m-0">Opening the order…</p>}
      {current && detail && detail.id === current.id && <Detail o={current} detail={detail} onDone={() => router.refresh()} />}
      {data.ship_within_days != null && <p className="text-[12px] text-[#5B6478] m-0">Ship within {data.ship_within_days} days of receiving the order.</p>}
    </SupplierFrame>
  );
}
