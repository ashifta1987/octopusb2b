import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCustomer } from '@/lib/auth';
import { COUNTRY_NAMES } from '@/lib/format';
import { dropshipCountries, dropshipDetail, dropshipSettings, importList, pickQuote, days } from '@/lib/dropship';
import { VerifiedBadge, Pill, Icon, Notice, TBC } from '@/components/ds';
import { CountrySelect, DropshipBuyBox } from '@/components/account/dropship/client';
import { BRAND_START_HREF } from '@/components/store/make-my-brand/content';
import { addToImportList, removeFromImportList } from '../../actions';

export const metadata = { title: 'Dropshipping product' };
const usd = (c: number) => `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const UUID = /^[0-9a-f-]{36}$/i;

export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ country?: string }> }) {
  return (
    <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="grid gap-5 lg:grid-cols-2"><div className="card aspect-square" /><div className="card h-[320px]" /></div>}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ country?: string }> }) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const [cfg, countries] = await Promise.all([dropshipSettings(), dropshipCountries()]);
  const fallback = cfg.defaultCountry && countries.includes(cfg.defaultCountry) ? cfg.defaultCountry : countries[0];
  const country = sp.country && countries.includes(sp.country.toUpperCase()) ? sp.country.toUpperCase() : fallback;
  if (!country) notFound();
  const [p, list] = await Promise.all([dropshipDetail(id, country), importList(s.org!.id)]);
  if (!p) notFound(); // unverified supplier, not live or not switched on for dropshipping
  const countryName = COUNTRY_NAMES[country] ?? country;
  const countryOpts = countries.map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const fastest = pickQuote(p.services);
  const cheapest = [...p.services].sort((a, b) => a.total_cents - b.total_cents)[0];
  const images = p.images.length ? p.images : p.image_url ? [p.image_url] : [];
  const notTo = p.blocked_countries.map((c) => COUNTRY_NAMES[c] ?? c);

  return (
    <div data-testid="dropship-product">
      <nav aria-label="Breadcrumb" className="text-[13.5px]">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/account/dropship" className="text-blue font-medium">Dropshipping</Link></li><li aria-hidden className="text-muted">›</li>
          <li><Link href={`/account/dropship/catalogue?country=${country}`} className="text-blue font-medium">Catalogue</Link></li><li aria-hidden className="text-muted">›</li>
          <li aria-current="page" className="text-body-2 line-clamp-1">{p.title}</li>
        </ol>
      </nav>

      <div className="mt-4">
      {(() => {
        const gallery = (
        <section className="card p-3 sm:p-4" aria-label="Photos">
          <div className="relative aspect-square rounded-[10px] overflow-hidden bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {images[0] ? <img src={images[0]} alt={p.title} className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 flex flex-col items-center justify-center text-muted gap-2"><Icon name="box" size={32} />Photo coming</div>}
          </div>
          {images.length > 1 && (
            <ul className="mt-3 grid grid-cols-3 gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {images.slice(1, 4).map((src) => <li key={src} className="relative aspect-square rounded-[8px] overflow-hidden bg-surface border border-line"><img src={src} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" /></li>)}
            </ul>
          )}
          <p className="mt-2.5 text-[12.5px] text-muted">{images.length ? `Photo 1 of ${images.length} · all photos go to your store` : 'Photos are added before the product goes to your store'}</p>
        </section>

        );
        const info = (
          <>
          <div>
            {p.category_name && <div className="k !text-blue">{p.category_name}</div>}
            <h1 className="mt-1 text-[24px] sm:text-[30px] font-extrabold leading-[1.15]">{p.title}</h1>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <VerifiedBadge />
              {p.stock_warehouse > 0 && <Pill>In our warehouse</Pill>}
              {p.services.some((q) => q.service === 'express') && <Pill tone="info">Express available</Pill>}
            </div>
            {fastest && cheapest ? (
              <p className="mt-3 text-[15px] text-body-2">Ships {fastest.service === 'express' ? 'Express' : fastest.service === 'standard' ? 'Standard' : 'Economy'} to {countryName} in {days(fastest)}. From {usd(cheapest.total_cents)} per order, shipping and duties included.</p>
            ) : (
              <div className="mt-3"><Notice tone="warn">Not available to {countryName}: {p.blocked_reason}.</Notice></div>
            )}
          </div>
          <div className="card p-4 sm:p-5 grid gap-4 sm:grid-cols-[1fr_1.1fr] items-center">
            <div><label htmlFor="country" className="k block mb-1.5">Customers in</label><CountrySelect value={country} options={countryOpts} /></div>
            <p className="text-[13px] text-muted">{p.services.length ? `Allowed to ship to ${countryName}. Costs below include shipping and duties to ${countryName}.` : `Cannot ship to ${countryName}. Choose another country to see costs.`}</p>
          </div>
          </>
        );
        return p.services.length > 0 ? (
          <DropshipBuyBox gallery={gallery} info={info} productId={p.product_id} services={p.services} variants={p.variants} markup={cfg.markup} demo={cfg.demo} countryName={countryName}
            added={list.has(p.product_id)} addAction={addToImportList} removeAction={removeFromImportList} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2 items-start">{gallery}<div className="space-y-4">{info}</div></div>
        );
      })()}
      </div>

      <section className="card p-5 sm:p-6 mt-5" aria-labelledby="sees-h" data-testid="customer-sees">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="sees-h" className="text-[17px] font-bold">What your customer sees</h2><Pill tone="info">Editable later in the import editor</Pill></div>
        <p className="mt-1 text-[13.5px] text-muted">This title, these bullet points and this description are pushed to your store with the photos. No Octopus name, supplier name or Octopus price appears in the listing.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-[10px] border border-line p-4">
            <div className="k">Title</div><div className="mt-1 text-[16px] font-bold text-navy">{p.store_title}</div>
            {p.store_bullets.length > 0 && <><div className="k mt-3">Bullet points</div><ul className="mt-1 list-disc pl-5 space-y-1 text-[14px] text-body-2">{p.store_bullets.map((b) => <li key={b}>{b}</li>)}</ul></>}
          </div>
          <div className="rounded-[10px] border border-line p-4"><div className="k">Description</div><p className="mt-1 text-[14px] text-body-2 leading-relaxed">{p.store_description ?? TBC}</p></div>
        </div>
      </section>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <section className="card p-5" aria-labelledby="ship-h">
          <h2 id="ship-h" className="text-[16px] font-bold">Shipping and restrictions</h2>
          <dl className="mt-3 space-y-3 text-[13.5px]">
            <div><dt className="k">Ships from</dt><dd className="mt-0.5 text-body-2">Express: Octopus warehouse. Standard: partner warehouses. Economy: global network, checked and repacked by Octopus.</dd></div>
            <div><dt className="k">Handling time</dt><dd className="mt-0.5 text-body-2">{cfg.handlingDays ? `Packed within ${cfg.handlingDays} working days of payment. Delivery days in the table start after that.` : TBC}</dd></div>
            {p.has_battery && <div><dt className="k">Battery</dt><dd className="mt-0.5 text-body-2">Built-in battery. Ships only on routes that accept batteries, which is why some countries can be unavailable.</dd></div>}
            {p.has_liquid && <div><dt className="k">Liquid</dt><dd className="mt-0.5 text-body-2">Contains liquid. Ships only on routes that accept liquids.</dd></div>}
            <div><dt className="k">Not available to</dt><dd className="mt-0.5 text-body-2" data-testid="not-available-to">{notTo.length ? notTo.join(', ') : 'No restrictions on the current routes.'}</dd></div>
          </dl>
        </section>
        <section className="card p-5" aria-labelledby="pack-h">
          <h2 id="pack-h" className="text-[16px] font-bold">Packing</h2>
          <ul className="mt-3 list-disc pl-5 space-y-1.5 text-[13.5px] text-body-2">
            <li>Your packing slip, with your store name, goes in every parcel</li>
            <li>Plain outer box with no Octopus branding</li>
            <li>No Octopus prices or invoices inside the parcel</li>
          </ul>
        </section>
        <section className="card p-5" aria-labelledby="ret-h">
          <h2 id="ret-h" className="text-[16px] font-bold">Returns</h2>
          <p className="mt-3 text-[13.5px] text-body-2">{cfg.returns ?? 'Returns policy to be confirmed.'}</p>
        </section>
      </div>

      <section className="mt-5 rounded-[14px] bg-navy text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between" data-testid="make-it-your-brand">
        <div className="flex items-center gap-3.5">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-[10px] bg-white/10"><Icon name="tag" /></span>
          <div><div className="k !text-[#9CC2FF]">Make it your brand</div><h2 className="!text-white text-[18px] font-bold">Want your logo on this product?</h2><p className="text-[13.5px] text-[#C9D0E8]">Start a Make My Brand project for your own logo and packaging.</p></div>
        </div>
        <Link href={`${BRAND_START_HREF}?product=${p.product_id}`} className="btn btn-light">Start a Make My Brand project</Link>
      </section>
    </div>
  );
}
