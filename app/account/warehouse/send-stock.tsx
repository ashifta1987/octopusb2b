'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { StatusBadge } from '@/components/ui';
import { ASN_STATUS, fmtDay, fmtWh, loadText } from '@/lib/warehouse-inbound';
import { cancelAsnAction, createAsnAction, saveSkuAction, type PortalResult } from './actions';

export type PortalSku = { id: string; sku: string; name: string; item_id: string; status: string };
export type PortalAsn = {
  id: string; code: string; warehouse_code: string; expected_date: string; cartons: number | null; pallets: number | null; status: string;
  booked_slot_at: string | null; received_at: string | null;
  lines: { sku: string | null; name: string | null; expected: number; good: number | null; status: string }[];
  checking: number;
};
type Msg = { ok: boolean; text: string } | null;
const TONE = { info: 'blue', warn: 'amber', ok: 'green', bad: 'red', neutral: 'gray' } as const;

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div><label htmlFor={id} className="label">{label}</label>{children}</div>;
}

function AddSku({ onAdded }: { onAdded: (id: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [f, setF] = useState({ sku: '', name: '', barcode: '', weightG: '', battery: false, liquid: false });
  const ready = f.sku.trim() !== '' && f.name.trim() !== '';
  return (
    <form className="rounded-[10px] border border-line p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end" data-testid="wh-add-sku"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        start(async () => {
          const r: PortalResult = await saveSkuAction(f);
          setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Added.' : r.error ?? 'Something went wrong.' });
          if (r.ok && r.id) { onAdded(r.id); setF({ sku: '', name: '', barcode: '', weightG: '', battery: false, liquid: false }); router.refresh(); }
        });
      }}>
      <Field id="sku-code" label="SKU *"><input id="sku-code" className="input" value={f.sku} maxLength={64} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
      <Field id="sku-name" label="Product name *"><input id="sku-name" className="input" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field id="sku-barcode" label="Barcode"><input id="sku-barcode" className="input" value={f.barcode} maxLength={64} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></Field>
      <Field id="sku-weight" label="Weight (g)"><input id="sku-weight" className="input" inputMode="numeric" value={f.weightG} onChange={(e) => setF({ ...f, weightG: e.target.value.replace(/\D/g, '') })} /></Field>
      <label className="flex items-center gap-2 min-h-11 text-[14px]"><input type="checkbox" className="w-5 h-5" checked={f.battery} onChange={(e) => setF({ ...f, battery: e.target.checked })} />Contains a battery</label>
      <label className="flex items-center gap-2 min-h-11 text-[14px]"><input type="checkbox" className="w-5 h-5" checked={f.liquid} onChange={(e) => setF({ ...f, liquid: e.target.checked })} />Contains liquid</label>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-ghost btn-sm" disabled={pending || !ready} data-testid="wh-add-sku-save">Save product</button>
        {msg && <span role={msg.ok ? 'status' : 'alert'} data-testid="wh-add-sku-msg" className={`text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

function NewNotice({ skus, warehouses, defaultWarehouse, today }: { skus: PortalSku[]; warehouses: { code: string; name: string }[]; defaultWarehouse: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ warehouse: defaultWarehouse, date: '', cartons: '', pallets: '', note: '' });
  const [lines, setLines] = useState<{ skuId: string; qty: string }[]>([{ skuId: '', qty: '' }]);
  const active = skus.filter((s) => s.status === 'active');
  const filled = lines.filter((l) => l.skuId);
  const why = !f.date ? 'Choose an arrival date' : !(Number(f.cartons) > 0 || Number(f.pallets) > 0) ? 'Enter cartons or pallets'
    : filled.length === 0 ? 'Add at least one product' : filled.some((l) => !(Number(l.qty) > 0)) ? 'Enter a quantity for every product'
    : new Set(filled.map((l) => l.skuId)).size !== filled.length ? 'Each product goes on one line' : null;
  const setLine = (i: number, patch: Partial<{ skuId: string; qty: string }>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <section className="card p-5" aria-labelledby="wh-new-asn" data-testid="wh-send-form">
      <h2 id="wh-new-asn" className="text-[18px] font-semibold m-0">New stock notice</h2>
      <p className="mt-1 mb-4 text-[13.5px] text-black/75">Tell us what is coming. The warehouse can only check in a delivery that has a stock notice.</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => {
        e.preventDefault();
        if (why) return;
        start(async () => {
          const r = await createAsnAction({ ...f, lines });
          setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Sent.' : r.error ?? 'Something went wrong.' });
          if (r.ok) { setLines([{ skuId: '', qty: '' }]); setF((x) => ({ ...x, cartons: '', pallets: '', note: '' })); router.refresh(); }
        });
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field id="asn-wh" label="Warehouse *">
            <select id="asn-wh" className="input" value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
            </select>
          </Field>
          <Field id="asn-date" label="Arrival date *"><input id="asn-date" type="date" className="input" min={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field id="asn-cartons" label="Cartons"><input id="asn-cartons" className="input" inputMode="numeric" value={f.cartons} onChange={(e) => setF({ ...f, cartons: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field id="asn-pallets" label="Pallets"><input id="asn-pallets" className="input" inputMode="numeric" value={f.pallets} onChange={(e) => setF({ ...f, pallets: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
          <legend className="label">Products and units *</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_auto] gap-2 items-end" data-testid={`wh-send-line-${i}`}>
              <div>
                <label htmlFor={`asn-sku-${i}`} className="sr-only">Product {i + 1}</label>
                <select id={`asn-sku-${i}`} className="input" value={l.skuId} onChange={(e) => setLine(i, { skuId: e.target.value })}>
                  <option value="">{active.length ? 'Choose a product' : 'Add a product first'}</option>
                  {active.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`asn-qty-${i}`} className="sr-only">Units of product {i + 1}</label>
                <input id={`asn-qty-${i}`} className="input" inputMode="numeric" placeholder="Units" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} />
              </div>
              <button type="button" className="btn btn-ghost btn-sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove product ${i + 1}`}>Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, { skuId: '', qty: '' }])} disabled={lines.length >= 200}>Add a line</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adding} onClick={() => setAdding((a) => !a)} data-testid="wh-add-sku-toggle">{adding ? 'Close new product' : 'New product (SKU)'}</button>
          </div>
        </fieldset>
        <Field id="asn-note" label="Note for the warehouse"><textarea id="asn-note" className="input py-2" rows={2} maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={pending || Boolean(why)} aria-describedby={why ? 'asn-why' : undefined} data-testid="wh-send-submit">Send stock notice</button>
          {why && <span id="asn-why" className="text-[13px] text-black/70">{why}</span>}
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-send-msg" className={`m-0 text-[14px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
      </form>
      {adding && (
        <div className="mt-4">
          <AddSku onAdded={(id) => setLines((ls) => {
            const k = ls.findIndex((l) => !l.skuId);
            return k >= 0 ? ls.map((l, j) => (j === k ? { ...l, skuId: id } : l)) : [...ls, { skuId: id, qty: '' }];
          })} />
        </div>
      )}
    </section>
  );
}

function Notices({ asns, warehouseNames }: { asns: PortalAsn[]; warehouseNames: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <section className="card p-5" aria-labelledby="wh-asn-list" data-testid="wh-asn-list">
      <h2 id="wh-asn-list" className="text-[18px] font-semibold m-0">Your stock notices</h2>
      {asns.length === 0 ? <p className="mt-2 mb-0 text-[14px] text-black/75">No stock notices yet.</p> : (
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Stock notices">
          <table className="w-full border-collapse min-w-[720px]">
            <thead><tr><th className="th">Notice</th><th className="th">Warehouse</th><th className="th">Arrival</th><th className="th">Load</th><th className="th">Products</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {asns.map((a) => {
                const [label, tone] = ASN_STATUS[a.status] ?? [a.status, 'neutral'];
                const units = a.lines.reduce((n, l) => n + l.expected, 0);
                return (
                  <tr key={a.id} className="border-t border-line align-top" data-testid={`wh-asn-${a.code}`}>
                    <td className="py-2.5 pr-3 font-mono font-semibold">{a.code}</td>
                    <td className="py-2.5 pr-3">{warehouseNames[a.warehouse_code] ?? a.warehouse_code}</td>
                    <td className="py-2.5 pr-3">{a.booked_slot_at ? `${fmtWh(a.booked_slot_at)} China time` : fmtDay(a.expected_date)}</td>
                    <td className="py-2.5 pr-3">{loadText(a.cartons, a.pallets) || '—'}</td>
                    <td className="py-2.5 pr-3 text-[13.5px]">
                      {a.lines.map((l, i) => <div key={i}>{l.sku ?? 'Product'} · {l.expected}{l.status === 'accepted' && l.good != null ? ` (received ${l.good})` : ''}</div>)}
                      <div className="text-black/70">{units.toLocaleString('en-US')} units</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <StatusBadge status={a.status} label={label} tone={TONE[tone]} />
                      {a.lines.some((l) => l.status === 'blocked') && <div className="mt-1 text-[12.5px] text-warn" data-testid="wh-asn-checking">{a.checking} unit(s) being checked</div>}
                    </td>
                    <td className="py-2.5">
                      {(a.status === 'submitted' || a.status === 'booked') && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
                          onClick={() => start(async () => { const r = await cancelAsnAction(a.id); setMsg({ ok: r.ok, text: r.ok ? `${a.code} cancelled.` : r.error ?? 'Something went wrong.' }); if (r.ok) router.refresh(); })}>
                          Cancel<span className="sr-only"> {a.code}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 mb-0 text-[14px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </section>
  );
}

export function SendStock(props: {
  skus: PortalSku[]; asns: PortalAsn[]; warehouses: { code: string; name: string }[]; defaultWarehouse: string; today: string;
}) {
  const warehouseNames = Object.fromEntries(props.warehouses.map((w) => [w.code, w.name]));
  return (
    <div className="mt-5 flex flex-col gap-5" data-testid="wh-send">
      <NewNotice skus={props.skus} warehouses={props.warehouses} defaultWarehouse={props.defaultWarehouse} today={props.today} />
      <Notices asns={props.asns} warehouseNames={warehouseNames} />
    </div>
  );
}
