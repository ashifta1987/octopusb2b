'use client';
import Link from 'next/link';
import { useState } from 'react';
import { money } from '@/lib/format';

type Tier = { min_qty: number; unit_price_cents: number };

/**
 * Product.png "Bulk price tiers" card: tier picker, quantity stepper, unit price + estimated subtotal.
 * `tiers` must already be converted to the platform `currency`; `rfqFee`/`sampleFee` come from service_price_info() in `feeCurrency`.
 */
export function PriceCalculator({ productId, tiers, currency, unit, unitOne, moq, rfqFee, sampleFee, feeCurrency, whatsapp, incoterm }: {
  productId: string; tiers: Tier[]; currency: string; unit: string; unitOne: string; moq: number; rfqFee: number | null; sampleFee: number | null;
  feeCurrency?: string; whatsapp: string | null; incoterm: string | null;
}) {
  const fmt = (minor: number) => money(minor, currency);
  const fee = (minor: number) => money(minor, feeCurrency ?? currency);
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  const [qty, setQty] = useState(Math.max(moq, sorted[0]?.min_qty ?? moq));
  const tier = sorted.reduce<Tier | undefined>((pick, t) => (qty >= t.min_qty ? t : pick), undefined);
  const base = sorted[0]?.unit_price_cents ?? 0;
  const below = qty < moq;
  const step = moq >= 100 ? Math.round(moq / 10) || 1 : 1;
  const quick = [...new Set([moq, ...sorted.map((t) => t.min_qty), (sorted[sorted.length - 1]?.min_qty ?? moq) * 2.5].map(Math.round))].slice(0, 4);

  return (
    <section className="card p-6 space-y-5" aria-labelledby="tiers-h">
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <h2 id="tiers-h" className="text-lg font-semibold">Bulk price tiers</h2>
        <span className="text-[13px] text-muted">{currency} per {unitOne} · MOQ {moq.toLocaleString('en-US')} {unit}</span>
      </div>
      {sorted.length ? (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">
          {sorted.map((t, i) => {
            const next = sorted[i + 1];
            const on = tier === t;
            const save = base && i > 0 ? Math.round((1 - t.unit_price_cents / base) * 100) : 0;
            return (
              <li key={t.min_qty}>
                <button type="button" aria-pressed={on} onClick={() => setQty(t.min_qty)}
                  className={`w-full text-left rounded-[10px] border-[1.5px] px-3 py-3 ${on ? 'bg-blue border-blue text-white' : 'bg-white border-line hover:border-navy'}`}>
                  <span className={`block text-[12px] ${on ? 'text-white' : 'text-muted'}`}>
                    {t.min_qty.toLocaleString('en-US')}{next ? `–${(next.min_qty - 1).toLocaleString('en-US')}` : '+'} {unit}
                  </span>
                  <span className="block font-display text-[22px] font-bold mt-1">{fmt(t.unit_price_cents)}</span>
                  <span className={`block text-[11px] font-semibold mt-0.5 ${on ? 'text-white' : 'text-ok'}`}>{i === 0 ? 'Base price' : `Save ${save}%`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted">Price on request — send an RFQ for a quote.</p>}

      <div>
        <label htmlFor="qty" className="label">Quantity ({unit})</label>
        <div className="flex border border-line-2 rounded-[8px] overflow-hidden">
          <button type="button" className="px-4 bg-surface font-bold" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - step))}>−</button>
          <input id="qty" type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="flex-1 min-w-0 text-center min-h-11 font-semibold outline-none" aria-describedby={below ? 'qty-err' : undefined} />
          <button type="button" className="px-4 bg-surface font-bold" aria-label="Increase quantity" onClick={() => setQty((q) => q + step)}>+</button>
        </div>
        {below && <p id="qty-err" className="text-[13px] text-bad mt-1" role="alert">Minimum order is {moq.toLocaleString('en-US')} {unit}.</p>}
        <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Quick quantities">
          {quick.map((n) => (
            <button key={n} type="button" onClick={() => setQty(n)} aria-pressed={qty === n}
              className={`rounded-full border px-3 py-1 text-[13px] ${qty === n ? 'border-navy bg-navy text-white' : 'border-line-2 bg-white'}`}>
              {n.toLocaleString('en-US')} {unit}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[10px] bg-surface px-4 py-3 flex flex-wrap justify-between items-end gap-3" aria-live="polite">
        <div>
          <div className="text-[13px] text-muted">Your unit price</div>
          <div className="font-display font-bold text-lg">{tier ? `${fmt(tier.unit_price_cents)} / ${unitOne}` : '—'}</div>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-muted">Estimated subtotal (excl. freight{incoterm ? `, ${incoterm}` : ''})</div>
          <div className="font-display font-bold text-2xl">{tier ? fmt(tier.unit_price_cents * qty) : '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href={`/request/sourcing?product=${productId}&qty=${qty}`} className="btn btn-primary">Request quote</Link>
        <Link href={`/request/sample?product=${productId}`} className="btn btn-ghost">Request sample</Link>
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-ghost col-span-2 !border-ok text-[#156B3A]">Enquire on WhatsApp</a>
        )}
      </div>
      <p className="text-[12px] text-muted text-center">
        RFQ fee <span className="mono font-semibold text-navy">{rfqFee ? fee(rfqFee) : 'free'}</span> per request
        {sampleFee != null && <> · Sample <span className="mono font-semibold text-navy">{fee(sampleFee)}</span> + shipping</>}
      </p>
    </section>
  );
}
