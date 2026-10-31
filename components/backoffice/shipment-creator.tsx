'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { usd } from '@/lib/format';

type Rate = { carrier: string; service: string; priceCents: number; days: string };
type Res<T> = { ok: boolean; error?: string; data?: T };

/** Shipping.png steps 2–3: parcel details → YunExpress price trial → create shipment + label. */
export function ShipmentCreator({ orderId, orderCode, fromCountry, toCountry, defaultDesc, defaultHs, declaredCents, incoterm, priceTrial, createShipment }: {
  orderId: string; orderCode: string; fromCountry: string; toCountry: string; defaultDesc: string; defaultHs: string; declaredCents: number; incoterm: string | null;
  priceTrial: (i: { toCountry: string; fromCountry: string; weightKg: number; parcels: number }) => Promise<Res<Rate[]>>;
  createShipment: (orderId: string, i: { service: string; rateCents: number; weightKg: number; parcels: number }) => Promise<Res<{ trackingNo: string; labelUrl: string }>>;
}) {
  const router = useRouter();
  const [pieces, setPieces] = useState(1);
  const [weight, setWeight] = useState(5);
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ trackingNo: string; labelUrl: string } | null>(null);
  const [pending, start] = useTransition();

  const trial = () => start(async () => {
    setErr(null); setRates(null); setPick(null);
    const r = await priceTrial({ toCountry, fromCountry, weightKg: weight, parcels: pieces });
    if (!r.ok) setErr(r.error ?? 'Price trial failed'); else { setRates(r.data ?? []); setPick(0); }
  });
  const create = () => {
    if (pick == null || !rates) return;
    const rate = rates[pick];
    if (!window.confirm(`Create a YunExpress shipment for ${orderCode} with “${rate.service}” at ${usd(rate.priceCents)}? The order will be marked shipped.`)) return;
    start(async () => {
      setErr(null);
      const r = await createShipment(orderId, { service: rate.service, rateCents: rate.priceCents, weightKg: weight, parcels: pieces });
      if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
      setDone(r.data ?? null);
      router.refresh();
    });
  };

  if (done) return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold">Shipment created</h2>
      <p className="mt-2 text-sm">Waybill <span className="mono font-semibold">{done.trackingNo}</span> · order marked shipped.</p>
      <div className="mt-4 flex gap-3">
        <a href={done.labelUrl} target="_blank" rel="noopener" className="btn btn-primary">Print label (10 × 15 cm)</a>
        <button type="button" className="btn btn-ghost" onClick={() => router.push('/office/shipping')}>Back to queue</button>
      </div>
    </section>
  );

  return (
    <>
      <section className="card p-6">
        <h2 className="text-lg font-semibold mb-4">2 · Parcel and customs</h2>
        <div className="grid sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="sc-p" className="label">Pieces</label>
            <input id="sc-p" type="number" min={1} className="input mono" value={pieces} onChange={(e) => setPieces(Math.max(1, Number(e.target.value)))} />
          </div>
          <div>
            <label htmlFor="sc-w" className="label">Total weight (kg)</label>
            <input id="sc-w" type="number" min={0.1} step="0.1" className="input mono" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="sc-box" className="label">Box size (cm)</label>
            <input id="sc-box" className="input mono" placeholder="40 × 30 × 30" />
          </div>
          <div>
            <label htmlFor="sc-val" className="label">Declared value (USD)</label>
            <input id="sc-val" className="input mono" defaultValue={(declaredCents / 100).toFixed(2)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="sc-desc" className="label">Customs description (English)</label>
            <input id="sc-desc" className="input" defaultValue={defaultDesc} />
          </div>
          <div>
            <label htmlFor="sc-hs" className="label">HS code</label>
            <input id="sc-hs" className="input mono" defaultValue={defaultHs} />
          </div>
          <div>
            <label htmlFor="sc-vat" className="label">Buyer VAT / EORI</label>
            <input id="sc-vat" className="input mono" />
          </div>
        </div>
        <button type="button" className="btn btn-dark mt-4" onClick={trial} disabled={pending || !(weight > 0)}>{pending && !rates ? 'Getting rates…' : 'Get YunExpress rates'}</button>
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">3 · Choose a YunExpress service</h2>
          <span className="text-xs font-semibold rounded-full bg-surface border border-line px-2 py-1">Price trial · {fromCountry} → {toCountry}</span>
        </div>
        {!rates ? <p className="text-sm text-muted">Enter the parcel details and get rates.</p> : !rates.length ? <p className="text-sm text-muted">No services available for this route.</p> : (
          <fieldset className="space-y-3">
            <legend className="sr-only">Service</legend>
            {rates.map((r, i) => (
              <label key={r.service} className={cn('flex items-center gap-4 rounded-[10px] border-2 px-5 py-4 cursor-pointer', pick === i ? 'border-blue bg-blue-soft' : 'border-line')}>
                <input type="radio" name="svc" checked={pick === i} onChange={() => setPick(i)} />
                <div className="flex-1"><div className="font-semibold">{r.carrier} · {r.service}</div><div className="text-sm text-muted">{r.days} days</div></div>
                <div className="text-right"><div className="mono font-bold text-lg">{usd(r.priceCents)}</div></div>
              </label>
            ))}
          </fieldset>
        )}
        {err && <p className="mt-3 text-sm text-bad" role="alert">{err}</p>}
        <div className="border-t border-line mt-5 pt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">Shipping cost is billed to: <b className="text-navy">{incoterm === 'DDP' || incoterm === 'DAP' ? `Seller (${incoterm})` : `Buyer (${incoterm ?? 'FOB'})`}</b></span>
          <button type="button" className="btn btn-primary" disabled={pending || pick == null || !rates?.length} onClick={create}>{pending && rates ? 'Creating…' : 'Create shipment and print label'}</button>
        </div>
      </section>
    </>
  );
}
