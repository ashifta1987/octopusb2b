'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { StatusBadge } from '@/components/ui';
import { fmtWh } from '@/lib/warehouse-inbound';
import { CLIENT_STATUS, ORDER_CSV_MAX_BYTES, ORDER_CSV_TEMPLATE, clientSteps } from '@/lib/warehouse-orders';
import { cancelOrderAction, createCsvOrdersAction, createOrderAction, previewCsvAction, type CsvPreview } from './actions';
import type { PortalSku } from './send-stock';

/** Warehouse OS · W3a portal Orders tab (board 19): new order form, CSV upload with preview, order list with a step tracker. */
export type PortalOrder = {
  id: string; code: string; external_ref: string | null; status: string; warehouse_code: string; ship_name: string; ship_country: string;
  created_at: string; packed_at: string | null; lines: { sku: string; name: string; qty: number }[];
};
type Msg = { ok: boolean; text: string } | null;
const TONE = { info: 'blue', warn: 'amber', ok: 'green', bad: 'red', neutral: 'gray' } as const;
const EMPTY = { ref: '', name: '', phone: '', line1: '', line2: '', city: '', region: '', postcode: '', country: '' };

function Field({ id, label, children, className = '' }: { id: string; label: string; children: ReactNode; className?: string }) {
  return <div className={className}><label htmlFor={id} className="label">{label}</label>{children}</div>;
}
function Note({ msg, testId }: { msg: Msg; testId: string }) {
  return msg ? <p role={msg.ok ? 'status' : 'alert'} data-testid={testId} className={`m-0 text-[14px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p> : null;
}

function Steps({ status }: { status: string }) {
  if (status === 'cancelled') return null;
  return (
    <ol className="list-none m-0 p-0 flex flex-wrap gap-1.5 text-[12px]" aria-label="Order steps">
      {clientSteps(status).map((s) => (
        <li key={s.label} aria-current={s.state === 'current' ? 'step' : undefined}
          className={`px-2 py-0.5 rounded-full border ${s.state === 'done' ? 'bg-ink text-white border-ink' : s.state === 'current' ? 'border-ink font-semibold' : 'border-line text-black/70'}`}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function NewOrder({ skus }: { skus: PortalSku[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState(EMPTY);
  const [lines, setLines] = useState<{ skuId: string; qty: string }[]>([{ skuId: '', qty: '1' }]);
  const active = skus.filter((s) => s.status === 'active');
  const filled = lines.filter((l) => l.skuId);
  const why = !f.name.trim() ? 'Enter the customer’s name' : !f.line1.trim() ? 'Enter the street address' : !f.city.trim() ? 'Enter the city'
    : !/^[A-Za-z]{2}$/.test(f.country.trim()) ? 'Enter the two-letter country code' : filled.length === 0 ? 'Add at least one product'
      : filled.some((l) => !(Number(l.qty) > 0)) ? 'Enter a quantity for every product' : new Set(filled.map((l) => l.skuId)).size !== filled.length ? 'Each product goes on one line' : null;
  const setLine = (i: number, patch: Partial<{ skuId: string; qty: string }>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const input = (k: keyof typeof EMPTY, label: string, extra: Record<string, unknown> = {}, cls = '') => (
    <Field id={`ord-${k}`} label={label} className={cls}>
      <input id={`ord-${k}`} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} />
    </Field>
  );
  return (
    <section className="card p-5" aria-labelledby="wh-new-order" data-testid="wh-order-form">
      <h2 id="wh-new-order" className="text-[18px] font-semibold m-0">New order</h2>
      <p className="mt-1 mb-4 text-[13.5px] text-black/75">We pick and pack from your stock at our warehouse. The order waits if a product is not in stock yet.</p>
      {active.length === 0 ? (
        <p className="m-0 text-[14px]">Add your products under <Link href="/account/warehouse?tab=send" className="underline">Send stock</Link> first.</p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          if (why) return;
          start(async () => {
            const r = await createOrderAction({ ...f, lines });
            setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Sent.' : r.error ?? 'Something went wrong.' });
            if (r.ok) { setF(EMPTY); setLines([{ skuId: '', qty: '1' }]); router.refresh(); }
          });
        }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {input('ref', 'Your order number', { maxLength: 64, autoComplete: 'off' })}
            {input('name', 'Customer name *', { maxLength: 120, autoComplete: 'off' })}
            {input('phone', 'Phone', { maxLength: 40, inputMode: 'tel', autoComplete: 'off' })}
            {input('country', 'Country code *', { maxLength: 2, placeholder: 'US', autoComplete: 'off' })}
            {input('line1', 'Address *', { maxLength: 200, autoComplete: 'off' }, 'sm:col-span-2')}
            {input('line2', 'Address line 2', { maxLength: 200, autoComplete: 'off' }, 'sm:col-span-2')}
            {input('city', 'City *', { maxLength: 100, autoComplete: 'off' })}
            {input('region', 'State / region', { maxLength: 100, autoComplete: 'off' })}
            {input('postcode', 'Postcode', { maxLength: 12, autoComplete: 'off' })}
          </div>
          <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
            <legend className="label">Products and units *</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_auto] gap-2 items-end" data-testid={`wh-order-line-${i}`}>
                <div>
                  <label htmlFor={`ord-sku-${i}`} className="sr-only">Product {i + 1}</label>
                  <select id={`ord-sku-${i}`} className="input" value={l.skuId} onChange={(e) => setLine(i, { skuId: e.target.value })}>
                    <option value="">Choose a product</option>
                    {active.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`ord-qty-${i}`} className="sr-only">Units of product {i + 1}</label>
                  <input id={`ord-qty-${i}`} className="input" inputMode="numeric" placeholder="Units" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} />
                </div>
                <button type="button" className="btn btn-ghost btn-sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove product ${i + 1}`}>Remove</button>
              </div>
            ))}
            <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { skuId: '', qty: '1' }])} disabled={lines.length >= 100}>Add a line</button></div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={pending || Boolean(why)} aria-describedby={why ? 'ord-why' : undefined} data-testid="wh-order-submit">Send order</button>
            {why && <span id="ord-why" className="text-[13px] text-black/70">{why}</span>}
          </div>
          <Note msg={msg} testId="wh-order-msg" />
        </form>
      )}
    </section>
  );
}

function CsvUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const ready = preview && preview.orders.length > 0 && preview.errors.length === 0 && preview.orders.every((o) => o.ok);
  return (
    <section className="card p-5" aria-labelledby="wh-csv" data-testid="wh-csv">
      <h2 id="wh-csv" className="text-[18px] font-semibold m-0">Upload orders (CSV)</h2>
      <p className="mt-1 mb-3 text-[13.5px] text-black/75">
        One row per product; rows with the same order number make one order. Up to 200 orders per file. We check every row and show a preview before anything is created.{' '}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(ORDER_CSV_TEMPLATE)}`} download="octopus-orders-template.csv" className="underline">Download the template</a>
      </p>
      <label htmlFor="wh-csv-file" className="label">CSV file</label>
      <input id="wh-csv-file" type="file" accept=".csv,text/csv" className="text-[14px] min-h-11" data-testid="wh-csv-file" disabled={pending}
        onChange={(e) => {
          const fl = e.target.files?.[0];
          setPreview(null); setMsg(null);
          if (!fl) return;
          if (fl.size > ORDER_CSV_MAX_BYTES) { setMsg({ ok: false, text: 'The file is larger than 1 MB. Split it into smaller files.' }); return; }
          setFile(fl.name);
          start(async () => {
            const t = await fl.text();
            setText(t);
            const r = await previewCsvAction(t);
            if (!r.ok || !r.preview) { setMsg({ ok: false, text: r.error ?? 'The file could not be read.' }); return; }
            setPreview(r.preview);
          });
        }} />
      {pending && <p className="mt-2 mb-0 text-[13px] text-black/70" role="status">Checking…</p>}
      {preview && (
        <div className="mt-4 flex flex-col gap-3" data-testid="wh-csv-preview">
          <p className="m-0 text-[14px]"><strong>{file}</strong>: {preview.orders.length} order(s), {preview.orders.filter((o) => o.ok).length} ready{preview.errors.length ? `, ${preview.errors.length} row problem(s)` : ''}.</p>
          {preview.errors.length > 0 && (
            <ul className="m-0 pl-5 text-[13.5px] text-bad" data-testid="wh-csv-row-errors">{preview.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
          )}
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="CSV preview">
            <table className="w-full border-collapse min-w-[560px]">
              <thead><tr><th className="th">Your order</th><th className="th">Customer</th><th className="th">Products</th><th className="th">Check</th></tr></thead>
              <tbody>
                {preview.orders.map((o) => (
                  <tr key={o.index} className="border-t border-line align-top" data-testid={`wh-csv-order-${o.external_ref}`}>
                    <td className="py-2 pr-3 font-mono">{o.external_ref}</td>
                    <td className="py-2 pr-3">{o.name} · {o.country}</td>
                    <td className="py-2 pr-3 text-[13.5px]">{o.lines.map((l) => `${l.sku} × ${l.qty}`).join(', ')}</td>
                    <td className="py-2">{o.ok ? <span className="text-ok">Ready</span> : <span className="text-bad">{o.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" className="btn btn-primary" disabled={pending || !ready} data-testid="wh-csv-create"
              onClick={() => start(async () => {
                const r = await createCsvOrdersAction(text);
                setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Created.' : r.error ?? 'Something went wrong.' });
                if (r.ok) { setPreview(null); setText(''); router.refresh(); }
              })}>Create {preview.orders.length} order(s)</button>
            {!ready && <span className="text-[13px] text-black/70">Fix the file and upload it again; nothing is created while a row has a problem.</span>}
          </div>
        </div>
      )}
      <div className="mt-2"><Note msg={msg} testId="wh-csv-msg" /></div>
    </section>
  );
}

function OrderList({ orders, warehouseNames }: { orders: PortalOrder[]; warehouseNames: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <section className="card p-5" aria-labelledby="wh-orders-list" data-testid="wh-portal-orders">
      <h2 id="wh-orders-list" className="text-[18px] font-semibold m-0">Your orders</h2>
      {orders.length === 0 ? <p className="mt-2 mb-0 text-[14px] text-black/75">No orders yet.</p> : (
        <ul className="mt-3 mb-0 p-0 list-none flex flex-col gap-3">
          {orders.map((o) => {
            const [label, tone] = CLIENT_STATUS[o.status] ?? [o.status, 'neutral'];
            const units = o.lines.reduce((n, l) => n + l.qty, 0);
            return (
              <li key={o.id} className="rounded-[10px] border border-line p-4 flex flex-col gap-2" data-testid={`wh-portal-order-${o.code}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-semibold">{o.code}</span>
                  {o.external_ref && <span className="text-[13px] text-black/70">Your order {o.external_ref}</span>}
                  <StatusBadge status={o.status} label={label} tone={TONE[tone]} />
                  <span className="ml-auto text-[13px] text-black/70">{fmtWh(o.created_at)}</span>
                </div>
                <Steps status={o.status} />
                <div className="text-[13.5px]">{o.ship_name} · {o.ship_country} · {units} unit(s) · {warehouseNames[o.warehouse_code] ?? o.warehouse_code}</div>
                <div className="text-[13px] text-black/70">{o.lines.map((l) => `${l.sku} × ${l.qty}`).join(', ')}</div>
                <div className="flex flex-wrap gap-2">
                  {['packed', 'labelled', 'shipped'].includes(o.status) && (
                    <Link href={`/account/warehouse?tab=orders&order=${o.code}`} className="btn btn-ghost btn-sm" data-testid={`wh-proof-link-${o.code}`}>Packing proof<span className="sr-only"> for {o.code}</span></Link>
                  )}
                  {['new', 'allocated'].includes(o.status) && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
                      onClick={() => start(async () => { const r = await cancelOrderAction(o.id); setMsg({ ok: r.ok, text: r.ok ? `${o.code} cancelled.` : r.error ?? 'Something went wrong.' }); if (r.ok) router.refresh(); })}>
                      Cancel<span className="sr-only"> {o.code}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2"><Note msg={msg} testId="wh-portal-orders-msg" /></div>
    </section>
  );
}

export function OrdersTab({ skus, orders, warehouses }: { skus: PortalSku[]; orders: PortalOrder[]; warehouses: { code: string; name: string }[] }) {
  const names = Object.fromEntries(warehouses.map((w) => [w.code, w.name]));
  return (
    <div className="mt-5 flex flex-col gap-5" data-testid="wh-orders-tab">
      <NewOrder skus={skus} />
      <CsvUpload />
      <OrderList orders={orders} warehouseNames={names} />
    </div>
  );
}
