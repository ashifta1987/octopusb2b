'use client';
import Link from 'next/link';
import { useState } from 'react';
import { money } from '@/lib/format';

type Tier = { min_qty: number; unit_price_cents: number };


/**
 * Product.png "Bulk price tiers" card: tier picker, quantity field (no stepper: preset chips or typing; MOQ, whole numbers and full cartons on blur), unit price + estimated subtotal.
 * `tiers` must already be converted to the platform `currency`; `rfqFee`/`sampleFee` come from service_price_info() in `feeCurrency`.
 */
export function PriceCalculator({ productId, tiers, currency, unit, unitOne, moq, orderMultiple, rfqFee, sampleFee, feeCurrency, whatsapp, incoterm }: {
  productId: string; tiers: Tier[]; currency: string; unit: string; unitOne: string; moq: number; orderMultiple?: number | null; rfqFee: number | null; sampleFee: number | null;
  feeCurrency?: string; whatsapp: string | null; incoterm: string | null;
}) {
  const fmt = (minor: number) => money(minor, currency);
  const fee = (minor: number) => money(minor, feeCurrency ?? currency);
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  const mult = orderMultiple && orderMultiple > 1 ? orderMultiple : null;
  const [qty, setQty] = useState(moq);
  const [text, setText] = useState(String(moq));
  const [note, setNote] = useState<string | null>(null);
  const typed = Math.floor(Number(text.replace(/[,\s]/g, '')));
  // price and subtotal follow what is in the box while typing; on blur the value is corrected (MOQ, whole number, cartons)
  const live = Number.isFinite(typed) && typed > 0 ? typed : qty;
  const tier = sorted.reduce<Tier | undefined>((pick, t) => (live >= t.min_qty ? t : pick), undefined);
  const base = sorted[0]?.unit_price_cents ?? 0;
  const fq = (n: number) => `${n.toLocaleString('en-US')} ${unit}`;
  const quick = [...new Set([moq, ...sorted.map((t) => t.min_qty)].filter((n) => n >= moq))].sort((a, b) => a - b);
  const set = (n: number) => { setQty(n); setText(String(n)); setNote(null); };
  const commit = () => {
    const msgs: string[] = [];
    let n = Number.isFinite(typed) && typed > 0 ? typed : moq;
    if (n < moq) { n = moq; msgs.push(`Minimum order is ${fq(moq)}`); }
    // the MOQ itself is always accepted (it is the supplier's own number); larger quantities go up to full cartons
    if (mult && n > moq && n % mult) { const up = Math.ceil(n / mult) * mult; msgs.push(`Rounded up to ${fq(up)} (full cartons of ${mult.toLocaleString('en-US')})`); n = up; }
    setQty(n); setText(String(n)); setNote(msgs.length ? msgs.join('. ') : null);
  };

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
                <button type="button" aria-pressed={on} onClick={() => set(Math.max(moq, t.min_qty))}
                  className={`w-full text-left rounded-[10px] border-[1.5px] px-3 py-3 ${on ? 'bg-coral border-coral-text text-white' : 'bg-white border-line hover:border-ink'}`}>
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
        <input id="qty" type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={text} data-testid="qty-input"
          onChange={(e) => setText(e.target.value.replace(/[^0-9,]/g, ''))}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          className="input text-center font-semibold" aria-describedby="qty-help" />
        <p id="qty-help" className={`text-[13px] mt-1 ${note ? 'text-bad' : 'text-muted'}`} role={note ? 'alert' : undefined} data-testid="qty-note">
          {note ?? `Minimum ${fq(moq)}${mult ? ` · packed ${mult.toLocaleString('en-US')} per carton` : ''}`}
        </p>
        {quick.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Quick quantities">
            {quick.map((n) => (
              <button key={n} type="button" onClick={() => set(n)} aria-pressed={qty === n} data-testid="qty-chip"
                className={`rounded-full border px-3 py-1 text-[13px] ${qty === n ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white'}`}>
                {fq(n)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-[10px] bg-pearl px-4 py-3 flex flex-wrap justify-between items-end gap-3" aria-live="polite">
        <div>
          <div className="text-[13px] text-muted">Your unit price</div>
          <div className="font-display font-bold text-lg"><span data-testid="unit-price">{tier ? `${fmt(tier.unit_price_cents)} / ${unitOne}` : '—'}</span></div>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-muted">Estimated subtotal (excl. freight{incoterm ? `, ${incoterm}` : ''})</div>
          <div className="font-display font-bold text-2xl"><span data-testid="subtotal">{tier ? fmt(tier.unit_price_cents * live) : '—'}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href={`/request/sourcing?product=${productId}&qty=${qty}`} className="btn btn-primary">Request quote</Link>
        <Link href={`/request/sample?product=${productId}`} className="btn btn-ghost">Request sample</Link>
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn btn-ghost col-span-2 !border-ok text-ok">Enquire on WhatsApp</a>
        )}
      </div>
      <p className="text-[12px] text-muted text-center">
        RFQ fee <span className="mono font-semibold text-ink">{rfqFee ? fee(rfqFee) : 'free'}</span> per request
        {sampleFee != null && <> · Sample <span className="mono font-semibold text-ink">{fee(sampleFee)}</span> + shipping</>}
      </p>
    </section>
  );
}
