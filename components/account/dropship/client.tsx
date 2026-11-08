'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShippingTypePill, ExamplePill, Icon, STORE_SOON } from '@/components/ds';
import type { Quote, ShipType, Variant } from '@/lib/dropship';

const usd = (c: number) => `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dd = (q: Quote) => `${q.days_min}–${q.days_max} days`;
const FROM: Record<ShipType, string> = { express: 'Octopus warehouse', standard: 'Partner warehouses', economy: 'Global network' };

/** Submit button with a pending state (import list add / remove). */
export function ImportButton({ added, className = '' }: { added: boolean; className?: string }) {
  const { pending } = useFormStatus();
  return added
    ? <button type="submit" disabled={pending} className={`btn btn-ghost w-full ${className}`} data-testid="import-added" aria-label="Added to import list. Select to remove.">{pending ? 'Removing…' : <>Added <Icon name="check" size={16} /></>}</button>
    : <button type="submit" disabled={pending} className={`btn btn-primary w-full ${className}`} data-testid="import-add">{pending ? 'Adding…' : 'Add to import list'}</button>;
}

/** "Customers in" select that reloads the page with ?country=. */
export function CountrySelect({ value, options, id = 'country' }: { value: string; options: [string, string][]; id?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <select id={id} name="country" className="input" value={value} data-testid="country-select"
      onChange={(e) => { const p = new URLSearchParams(sp?.toString()); p.set('country', e.target.value); router.push(`${path}?${p.toString()}`); }}>
      {options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}

/** Board 23 — variant chips + stock, cost table with a radio per shipping type, and the live "Your price" box. */
export function DropshipBuyBox({ gallery, info, productId, services, variants, markup, demo, countryName, added, addAction, removeAction }: {
  gallery: React.ReactNode; info: React.ReactNode; productId: string; services: Quote[]; variants: Variant[]; markup: number | null; demo: boolean; countryName: string; added: boolean;
  addAction: (fd: FormData) => Promise<void>; removeAction: (fd: FormData) => Promise<void>;
}) {
  const [variantId, setVariant] = useState(variants[0]?.id ?? '');
  const variant = variants.find((v) => v.id === variantId) ?? null;
  const available = (q: Quote) => !variant || (q.service === 'express' ? variant.stock_warehouse > 0 : q.service === 'standard' ? variant.stock_partner > 0 : true);
  const [ship, setShip] = useState<ShipType>((services.find(available) ?? services[0])?.service ?? 'express');
  const quote = services.find((s) => s.service === ship) ?? services[0] ?? null;
  const sugg = quote && markup ? Math.max(99, Math.ceil((quote.total_cents * markup) / 100) * 100 - 1) : null;
  const [price, setPrice] = useState(sugg ? (sugg / 100).toFixed(2) : '');
  const priceCents = Math.round(Number(price) * 100) || 0;
  const pr = useMemo(() => (quote && priceCents > 0 ? { c: priceCents - quote.total_cents, pct: Math.round(((priceCents - quote.total_cents) / priceCents) * 100) } : null), [quote, priceCents]);
  const [edited, setEdited] = useState(false);
  // changing the shipping type recalculates the suggestion; the price follows it until the seller types their own
  const choose = (t: ShipType) => {
    setShip(t);
    const q = services.find((x) => x.service === t);
    if (!edited && q && markup) setPrice((Math.max(99, Math.ceil((q.total_cents * markup) / 100) * 100 - 1) / 100).toFixed(2));
  };
  const [push, setPush] = useState(false);
  const outOfStock = !!quote && !available(quote);

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2 items-start">
      {gallery}
      <div className="space-y-4">
      {info}
      {variants.length > 0 && (
        <div className="card p-4 sm:p-5" data-testid="variants">
          <div className="k">{variants.some((v) => v.colour) ? 'Colour' : 'Variant'}</div>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Variant">
            {variants.map((v) => {
              const on = v.id === variantId;
              return (
                <button key={v.id} type="button" role="radio" aria-checked={on} onClick={() => { setVariant(v.id); }}
                  className={`inline-flex items-center gap-2 min-h-11 px-3.5 rounded-full border text-[14px] font-medium ${on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line-strong hover:border-ink'}`}>
                  {v.colour && <span className="w-3.5 h-3.5 rounded-full border border-black/15" style={{ background: v.colour }} aria-hidden />}{v.name}
                </button>
              );
            })}
          </div>
          {variant && <p className="mt-3 text-[13.5px] text-black"><b className="text-ink">{variant.name}:</b> {variant.stock_warehouse.toLocaleString('en-US')} in our warehouse (Express) · {variant.stock_partner.toLocaleString('en-US')} at partner warehouses (Standard)</p>}
        </div>
      )}
      </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr] items-start" data-testid="buy-box">
        <section className="card overflow-hidden" aria-labelledby="cost-h">
          <div className="px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-2">
            <div><h2 id="cost-h" className="text-[17px] font-bold">Cost to you per order</h2><p className="text-[13px] text-muted">One unit to a customer in {countryName}. Choose a shipping type.</p></div>
            {demo && <ExamplePill />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px] min-w-[640px]" data-testid="cost-table">
              <thead><tr>{['Shipping type', 'Ships from', 'Product', 'Shipping and duties', 'Fulfilment fee', 'Total', 'Delivery'].map((h, i) => <th key={h} className={`th !py-2.5 ${i >= 2 && i <= 5 ? '!text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {services.map((q) => {
                  const on = q.service === ship;
                  const ok = available(q);
                  return (
                    <tr key={q.service} className={`${on ? 'bg-tint' : ''} ${ok ? 'cursor-pointer' : 'opacity-60'}`} onClick={() => ok && choose(q.service)}>
                      <td className={`td !py-3 ${on ? 'shadow-[inset_3px_0_0_var(--coral)]' : ''}`}>
                        <label className="inline-flex items-center gap-2.5 min-h-11 cursor-pointer">
                          <input type="radio" name="ship" value={q.service} checked={on} disabled={!ok} onChange={() => choose(q.service)} className="w-4 h-4 accent-coral" />
                          <ShippingTypePill type={q.service} />
                        </label>
                      </td>
                      <td className="td !py-3 !px-3 text-black text-[13.5px]">{FROM[q.service]}{!ok && <span className="block text-bad text-[12.5px]">Out of stock for this variant</span>}</td>
                      <td className="td !py-3 text-right tabular-nums whitespace-nowrap">{usd(q.product_cents)}</td>
                      <td className="td !py-3 text-right tabular-nums whitespace-nowrap">{usd(q.ship_duty_cents)}</td>
                      <td className="td !py-3 text-right tabular-nums whitespace-nowrap">{usd(q.fee_cents)}</td>
                      <td className="td !py-3 text-right tabular-nums whitespace-nowrap font-bold">{usd(q.total_cents)}</td>
                      <td className="td !py-3 whitespace-nowrap">{dd(q)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3.5 text-[13px] text-muted">Economy parcels are checked and repacked by Octopus. Charged from your US dollar wallet when each order comes in. Top up by bank transfer. An order that mixes shipping types ships one parcel per type, each with its own tracking.</p>
        </section>

        <section className="rounded-[14px] bg-white border-2 border-ink p-5" aria-labelledby="price-h" data-testid="price-box">
          <div className="flex items-center justify-between gap-2"><h2 id="price-h" className="text-[17px] font-bold">Your price</h2>{demo && <ExamplePill />}</div>
          {quote && (
            <dl className="mt-3 space-y-1.5 text-[14px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">Your cost · {quote.service[0].toUpperCase() + quote.service.slice(1)}</dt><dd className="font-semibold tabular-nums">{usd(quote.total_cents)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Suggested retail</dt><dd className="font-semibold tabular-nums">{sugg ? usd(sugg) : 'No pricing rule yet'}</dd></div>
            </dl>
          )}
          {markup && <p className="mt-1.5 text-[12.5px] text-muted">Your pricing rule: cost × {markup}, rounded up to end in .99.</p>}
          <label htmlFor="sell" className="k block mt-4">Your selling price (US$)</label>
          <input id="sell" inputMode="decimal" className="input mt-1.5 !text-[17px] font-semibold tabular-nums" value={price} onChange={(e) => { setEdited(true); setPrice(e.target.value.replace(/[^0-9.]/g, '')); }} data-testid="sell-price" />
          <div className="mt-3 rounded-[10px] bg-pearl border border-line p-3.5 grid grid-cols-2 gap-3" aria-live="polite">
            <div><div className="k">Profit per order</div><div className={`mt-1 text-[22px] font-extrabold tabular-nums ${pr && pr.c < 0 ? 'text-bad' : 'text-ok'}`} data-testid="profit">{pr ? usd(pr.c) : '—'}</div></div>
            <div><div className="k">Margin</div><div className={`mt-1 text-[22px] font-extrabold tabular-nums ${pr && pr.c < 0 ? 'text-bad' : 'text-ok'}`} data-testid="margin">{pr ? `${pr.pct}%` : '—'}</div></div>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">Before your store&apos;s channel and payment fees.</p>
          <div className="mt-4 space-y-2.5">
            <form action={added ? removeAction : addAction}>
              <input type="hidden" name="product_id" value={productId} />
              <input type="hidden" name="variant_id" value={variantId} />
              <input type="hidden" name="service" value={ship} />
              <input type="hidden" name="price" value={price} />
              {outOfStock && !added ? <button type="button" disabled className="btn btn-primary w-full">Out of stock</button> : <ImportButton added={added} />}
            </form>
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" className="btn btn-dark" onClick={() => setPush((x) => !x)} aria-expanded={push}>Push to my store</button>
              <Link href={`/request/sample?product=${productId}`} className="btn btn-ghost">Order a sample</Link>
            </div>
            {push && <p className="text-[13px] rounded-[10px] bg-warn-bg text-warn px-3 py-2.5" data-testid="push-soon">{STORE_SOON} No store is connected to your account yet.</p>}
          </div>
        </section>
      </div>
    </>
  );
}

/** Phone: filters collapse behind a [Filters] button; desktop: always shown. */
export function FilterToggle({ on, children }: { on: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button type="button" className="btn btn-ghost w-full md:hidden" aria-expanded={open} aria-controls="catalogue-filter-panel" onClick={() => setOpen((x) => !x)}>
        <Icon name="search" size={18} />Filters{on ? ' (on)' : ''}
      </button>
      <div id="catalogue-filter-panel" className={`${open ? 'block mt-3' : 'hidden'} md:block md:mt-0`}>{children}</div>
    </div>
  );
}
