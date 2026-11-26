'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PRODUCT_PHOTO_MAX_BYTES, coverText, dailyText, productPhotoPath, type Inventory, type InventorySku } from '@/lib/warehouse-w5';
import { setSkuPhotoAction } from './w5-actions';

/** Warehouse OS · W5 portal Inventory tab (board 18): stock by product with a thumbnail, available, reserved, incoming, days of cover; a larger photo for the selected product. */
type Msg = { ok: boolean; text: string } | null;
const n = (v: number) => v.toLocaleString('en-US');

function Thumb({ s, size }: { s: InventorySku; size: 'sm' | 'lg' }) {
  const cls = size === 'sm' ? 'w-12 h-12 rounded-[8px]' : 'w-full aspect-square max-h-[320px] rounded-[12px]';
  return s.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={s.image_url} alt={size === 'lg' ? `Photo of ${s.name}` : ''} className={`${cls} object-cover border border-line bg-white block`} />
  ) : (
    <div className={`${cls} border border-dashed border-line bg-pearl flex items-center justify-center text-center text-[11.5px] text-black/70 p-1`} aria-hidden={size === 'sm' ? true : undefined}>
      {size === 'lg' ? 'No photo yet' : 'No photo'}
    </div>
  );
}

function PhotoUpload({ s, orgId }: { s: InventorySku; orgId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="mt-3">
      <label htmlFor={`wh-inv-photo-${s.id}`} className="label">{s.image_url ? 'Replace the photo' : 'Add a product photo'}</label>
      <input id={`wh-inv-photo-${s.id}`} type="file" accept="image/jpeg,image/png,image/webp" className="text-[14px] min-h-11" disabled={pending}
        data-testid="wh-inv-photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          setMsg(null);
          if (!file) return;
          if (file.size > PRODUCT_PHOTO_MAX_BYTES) { setMsg({ ok: false, text: 'The photo is larger than 5 MB.' }); return; }
          const path = productPhotoPath(orgId, s.id, crypto.randomUUID(), file.type);
          if (!path) { setMsg({ ok: false, text: 'Use a JPG, PNG or WebP photo.' }); return; }
          start(async () => {
            const { error } = await createClient().storage.from('wh-products').upload(path, file, { contentType: file.type, upsert: false });
            if (error) { setMsg({ ok: false, text: `The photo could not be uploaded: ${error.message}` }); return; }
            const r = await setSkuPhotoAction(s.id, path);
            setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Photo saved.' : r.error ?? 'Something went wrong.' });
            if (r.ok) router.refresh();
          });
        }} />
      <p className="mt-1 mb-0 text-[12.5px] text-black/70">JPG, PNG or WebP, up to 5 MB. Only your team and our warehouse staff see it.</p>
      {pending && <p className="mt-1 mb-0 text-[13px] text-black/70" role="status">Uploading…</p>}
      {msg && <p role={msg.ok ? 'status' : 'alert'} data-testid="wh-inv-photo-msg" className={`mt-1 mb-0 text-[13.5px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
    </div>
  );
}

function Detail({ s, orgId }: { s: InventorySku; orgId: string }) {
  return (
    <section className="card p-5" aria-labelledby="wh-inv-detail-h" data-testid="wh-inv-detail">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,280px)_1fr] gap-5">
        <div>
          <Thumb s={s} size="lg" />
          <PhotoUpload s={s} orgId={orgId} />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[13px] text-black/70">{s.sku}{s.barcode ? ` · ${s.barcode}` : ''}</div>
          <h2 id="wh-inv-detail-h" className="text-[20px] font-semibold m-0">{s.name}</h2>
          {s.status !== 'active' && <p className="mt-1 mb-0 text-[13px] text-black/70">Archived product (still holds stock)</p>}
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 m-0">
            {([['On hand', s.on_hand], ['Reserved for orders', s.reserved], ['Available', s.available], ['On its way in', s.incoming], ['Being checked', s.checking]] as const).map(([k, v]) => (
              <div key={k} className="rounded-[10px] border border-line p-3">
                <dt className="text-[12.5px] text-black/70">{k}</dt>
                <dd className="m-0 text-[22px] font-bold leading-tight">{n(v)}</dd>
              </div>
            ))}
            <div className="rounded-[10px] border border-line p-3">
              <dt className="text-[12.5px] text-black/70">Days of cover</dt>
              <dd className="m-0 text-[17px] font-bold leading-tight" data-testid="wh-inv-detail-cover">{coverText(s.days_cover)}</dd>
            </div>
          </dl>
          <p className="mt-3 mb-0 text-[13.5px] text-black/75">{dailyText(s.shipped_30d)}. Days of cover = available units ÷ units shipped a day over the last 30 days.</p>
          {s.checking > 0 && <p className="mt-1 mb-0 text-[13.5px] text-black/75">{n(s.checking)} unit(s) counted differently at receiving; a supervisor checks them before they are in stock.</p>}
          <h3 className="mt-4 mb-2 text-[15px] font-semibold">By warehouse</h3>
          {s.by_warehouse.length === 0 ? <p className="m-0 text-[14px] text-black/75">No units in a warehouse yet.</p> : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Stock of ${s.sku} by warehouse`}>
              <table className="w-full border-collapse min-w-[360px]">
                <thead><tr><th className="th">Warehouse</th><th className="th text-right">On hand</th><th className="th text-right">Reserved</th><th className="th text-right">Available</th></tr></thead>
                <tbody>
                  {s.by_warehouse.map((w) => (
                    <tr key={w.warehouse_code} className="border-t border-line" data-testid={`wh-inv-wh-${w.warehouse_code}`}>
                      <td className="py-2 pr-3">{w.warehouse}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{n(w.on_hand)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{n(w.reserved)}</td>
                      <td className="py-2 text-right tabular-nums">{n(w.available)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function InventoryTab({ inventory, orgId }: { inventory: Inventory; orgId: string }) {
  const [selId, setSelId] = useState<string | null>(inventory.skus[0]?.id ?? null);
  const sel = inventory.skus.find((s) => s.id === selId) ?? null;
  const t = inventory.totals;
  return (
    <div className="mt-5 flex flex-col gap-5" data-testid="wh-inventory">
      <section aria-label="Stock totals" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([['On hand', t.on_hand, 'Units in our warehouses'], ['Available', t.available, 'On hand minus reserved for orders'], ['On its way in', t.incoming, 'Open stock notices'], ['Being checked', t.checking, 'Counted differently at receiving']] as const).map(([k, v, sub]) => (
          <div key={k} className="card p-5" data-testid={`wh-inv-total-${k.toLowerCase().replace(/ /g, '-')}`}>
            <div className="text-[13px] text-black/75">{k}</div>
            <div className="text-[30px] font-bold leading-tight">{n(v)}</div>
            <div className="text-[12.5px] text-black/70">{sub}</div>
          </div>
        ))}
      </section>
      {inventory.skus.length === 0 ? (
        <section className="card p-5">
          <h2 className="text-[18px] font-semibold m-0">No products yet</h2>
          <p className="mt-2 mb-0 text-[14px] text-black/75">Add your products and send a stock notice under <Link href="/account/warehouse?tab=send" className="underline">Send stock</Link>. Stock shows here once we receive it.</p>
        </section>
      ) : (
        <>
          {sel && <Detail s={sel} orgId={orgId} />}
          <section className="card p-0 overflow-hidden" aria-labelledby="wh-inv-list">
            <h2 id="wh-inv-list" className="text-[18px] font-semibold m-0 px-5 pt-5 pb-3">Stock by product</h2>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stock by product">
              <table className="w-full border-collapse min-w-[760px]">
                <thead>
                  <tr>
                    <th className="th pl-5"><span className="sr-only">Photo</span></th><th className="th">Product</th>
                    <th className="th text-right">On hand</th><th className="th text-right">Reserved</th><th className="th text-right">Available</th>
                    <th className="th text-right">Incoming</th><th className="th text-right">Being checked</th><th className="th">Days of cover</th>
                    <th className="th pr-5"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.skus.map((s) => (
                    <tr key={s.id} className={`border-t border-line ${s.id === selId ? 'bg-tint' : ''}`} data-testid={`wh-inv-row-${s.sku}`} aria-current={s.id === selId ? 'true' : undefined}>
                      <td className="py-2 pl-5 pr-3"><Thumb s={s} size="sm" /></td>
                      <td className="py-2 pr-3"><div className="font-semibold">{s.name}</div><div className="font-mono text-[12.5px] text-black/70">{s.sku}</div></td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid={`wh-inv-onhand-${s.sku}`}>{n(s.on_hand)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{n(s.reserved)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold" data-testid={`wh-inv-available-${s.sku}`}>{n(s.available)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums" data-testid={`wh-inv-incoming-${s.sku}`}>{n(s.incoming)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{n(s.checking)}</td>
                      <td className="py-2 pr-3 text-[13.5px]" data-testid={`wh-inv-cover-${s.sku}`}>{coverText(s.days_cover)}</td>
                      <td className="py-2 pr-5 text-right">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelId(s.id)} aria-pressed={s.id === selId} data-testid={`wh-inv-select-${s.sku}`}>
                          Details<span className="sr-only"> for {s.sku}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
