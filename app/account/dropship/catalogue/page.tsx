import { Suspense } from 'react';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { COUNTRY_NAMES } from '@/lib/format';
import { dropshipCatalogue, dropshipCountries, dropshipSettings, importList, pickQuote, profit, suggested, days, type ShipType } from '@/lib/dropship';
import { VerifiedBadge, ShippingTypePill, ExamplePill, Icon, Notice } from '@/components/ds';
import { CountrySelect, FilterToggle, ImportButton } from '@/components/account/dropship/client';
import { addToImportList, removeFromImportList } from '../actions';

export const metadata = { title: 'Dropshipping catalogue' };

type SP = { q?: string; country?: string; cat?: string; ship?: string; sort?: string; wh?: string; list?: string };
const usd = (c: number) => `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SORTS: [string, string][] = [['fastest', 'Fastest delivery'], ['profit', 'Best profit'], ['cost', 'Lowest cost'], ['newest', 'Newest']];
const SHIPS: [string, string][] = [['', 'All'], ['express', 'Express'], ['standard', 'Standard'], ['economy', 'Economy']];

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return <Suspense fallback={<CatalogueSkeleton />}><Catalogue searchParams={searchParams} /></Suspense>;
}

function CatalogueSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the catalogue">
      <div className="h-8 w-48 bg-line rounded" /><div className="card h-[150px] mt-6" />
      <div className="mt-6 grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card h-[420px] animate-pulse" />)}</div>
    </div>
  );
}

async function Catalogue({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireCustomer('/account/dropship/catalogue');
  const sp = await searchParams;
  const [cfg, countries] = await Promise.all([dropshipSettings(), dropshipCountries()]);
  const countryOpts = countries.map((c) => [c, COUNTRY_NAMES[c] ?? c] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  const fallback = cfg.defaultCountry && countries.includes(cfg.defaultCountry) ? cfg.defaultCountry : (s.org?.country && countries.includes(s.org.country) ? s.org.country : countries[0]);
  const country = sp.country && countries.includes(sp.country.toUpperCase()) ? sp.country.toUpperCase() : fallback;
  const countryName = country ? (COUNTRY_NAMES[country] ?? country) : '';
  const ship = (['express', 'standard', 'economy'].includes(sp.ship ?? '') ? sp.ship : null) as ShipType | null;

  const [rows, list] = country ? await Promise.all([dropshipCatalogue(country), importList(s.org!.id)]) : [[], new Map()];
  const cats = [...new Map(rows.filter((r) => r.category_id).map((r) => [r.category_id!, r.category_name ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const q = (sp.q ?? '').trim().toLowerCase();
  const filtered = rows
    .filter((r) => !q || r.title.toLowerCase().includes(q) || (r.category_name ?? '').toLowerCase().includes(q))
    .filter((r) => !sp.cat || r.category_id === sp.cat)
    .filter((r) => sp.wh !== '1' || r.stock_warehouse > 0)
    .filter((r) => sp.list !== '1' || list.has(r.product_id))
    .map((r) => {
      const quote = r.blocked_reason ? null : pickQuote(r.services, ship);
      const sugg = quote ? suggested(quote.total_cents, cfg.markup) : null;
      return { r, quote, sugg, pr: quote && sugg ? profit(sugg, quote.total_cents) : null };
    })
    .filter((x) => !ship || x.quote || x.r.blocked_reason);
  const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : 'fastest';
  filtered.sort((a, b) => {
    if (!a.quote !== !b.quote) return a.quote ? -1 : 1; // blocked products go to the end
    if (!a.quote || !b.quote) return 0;
    if (sort === 'profit') return (b.pr?.cents ?? 0) - (a.pr?.cents ?? 0);
    if (sort === 'cost') return a.quote.total_cents - b.quote.total_cents;
    if (sort === 'newest') return 0;
    return a.quote.days_min - b.quote.days_min || a.quote.total_cents - b.quote.total_cents;
  });
  const available = filtered.filter((x) => x.quote).length;
  const hasFilters = !!(q || sp.cat || ship || sp.wh === '1' || sp.list === '1');
  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, country, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/account/dropship/catalogue?${p.toString()}`;
  };

  const filters = (
    <form action="/account/dropship/catalogue" className="card p-4 sm:p-5" data-testid="catalogue-filters">
      <input type="hidden" name="country" value={country ?? ''} />
      {ship && <input type="hidden" name="ship" value={ship} />}
      <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div><label htmlFor="q" className="k block mb-1.5">Search the catalogue</label><input id="q" name="q" defaultValue={sp.q ?? ''} className="input" placeholder="Product name or category" /></div>
        <div><label htmlFor="country" className="k block mb-1.5">Customers in</label><CountrySelect value={country ?? ''} options={countryOpts} /></div>
        <div><label htmlFor="cat" className="k block mb-1.5">Category</label>
          <select id="cat" name="cat" defaultValue={sp.cat ?? ''} className="input"><option value="">All categories</option>{cats.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></div>
        <div><label htmlFor="sort" className="k block mb-1.5">Sort by</label>
          <select id="sort" name="sort" defaultValue={sort} className="input">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="k mr-1">Shipping type</span>
        {SHIPS.map(([k, l]) => {
          const on = (ship ?? '') === k;
          return <Link key={l} href={href({ ship: k || undefined })} aria-current={on ? 'true' : undefined} className={`inline-flex items-center min-h-11 px-4 rounded-full border text-[14px] font-medium ${on ? 'bg-ink text-white border-ink hover:text-white' : 'bg-white text-ink border-line-strong hover:border-ink'}`}>{l}</Link>;
        })}
        <label className="sm:ml-auto inline-flex items-center gap-2.5 min-h-11 cursor-pointer text-[14px] font-medium">
          <input type="checkbox" name="wh" value="1" defaultChecked={sp.wh === '1'} className="w-5 h-5 accent-ink" />In our warehouse now
        </label>
        <button type="submit" className="btn btn-ghost btn-sm">Apply</button>
      </div>
      <p className="mt-3 text-[13px] text-muted leading-relaxed">Express ships from the Octopus warehouse and is the fastest. Standard ships from partner warehouses. Economy uses the global network and is checked and repacked by Octopus. An order can mix types; each type ships its own parcel with its own tracking. Costs and delivery days are for customers in {countryName || 'the country you choose'}.</p>
    </form>
  );

  return (
    <div data-testid="dropship-catalogue">
      <div className="k !text-coral-text">Dropshipping</div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[860px]">
          <h1 className="text-[30px] font-extrabold leading-[1.15]">Catalogue</h1>
          <p className="mt-1 text-[14.5px] text-black">Only products available for dropshipping to your markets are shown · Verified suppliers only · Prices include shipping and duties to the country you choose</p>
        </div>
        <Link href={href({ list: sp.list === '1' ? undefined : '1' })} className="btn btn-ghost" data-testid="import-list-link"><Icon name="doc" size={18} />{sp.list === '1' ? 'Show all products' : `Import list (${list.size})`}</Link>
      </div>

      {!country ? (
        <div className="mt-6"><Notice tone="warn">Dropshipping routes are not set up yet. Your account manager will tell you as soon as products can ship to your markets.</Notice></div>
      ) : (
        <>
          <FilterToggle on={hasFilters}>{filters}</FilterToggle>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[14.5px]" data-testid="result-count"><b>{available} {available === 1 ? 'product' : 'products'}</b> for customers in {countryName}{filtered.length > available ? ` · ${filtered.length - available} not available there` : ''}</p>
            {cfg.demo && <ExamplePill />}
          </div>

          {filtered.length === 0 ? (
            <div className="card p-8 mt-4 text-center" data-testid="catalogue-empty">
              <p className="text-[16px] font-semibold">No products ship to {countryName} with these filters</p>
              {hasFilters && <Link href={href({ q: undefined, cat: undefined, ship: undefined, wh: undefined, list: undefined, sort: undefined })} className="btn btn-ghost mt-4">Clear filters</Link>}
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {filtered.map(({ r, quote, sugg, pr }) => {
                const blocked = !quote;
                const added = list.has(r.product_id);
                const detail = `/account/dropship/catalogue/${r.product_id}?country=${country}`;
                return (
                  <li key={r.product_id} className={`card overflow-hidden flex flex-col ${blocked ? 'bg-pearl' : ''}`} data-testid={blocked ? 'catalogue-blocked' : 'catalogue-card'}>
                    <div className={`relative aspect-square bg-pearl ${blocked ? 'opacity-50' : ''}`}>
                      {r.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={r.image_url} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                        : <div className="absolute inset-0 flex flex-col items-center justify-center text-muted text-[13px] gap-1.5"><Icon name="box" size={28} />Photo coming</div>}
                      <span className="absolute top-2.5 left-2.5"><VerifiedBadge /></span>
                    </div>
                    <div className="p-4 flex flex-col flex-1">
                      {quote && <div className="flex flex-wrap gap-1.5"><ShippingTypePill type={quote.service} /><span className="pill bg-pearl text-muted border border-line">{days(quote)}</span></div>}
                      <h2 className="mt-2.5 text-[15.5px] font-bold leading-snug line-clamp-2"><Link href={detail} className="text-ink hover:text-coral-text">{r.title}</Link></h2>
                      <p className="mt-1.5 text-[13px] text-muted">
                        {r.stock_warehouse > 0 ? `${r.stock_warehouse.toLocaleString('en-US')} in our warehouse` : r.stock_partner > 0 ? `${r.stock_partner.toLocaleString('en-US')} at partner warehouses` : 'Ships from the global network'}
                        {r.variant_count > 1 ? ` · ${r.variant_count} variants` : ''}
                      </p>
                      {blocked ? (
                        <p className="mt-3 text-[13.5px] text-muted flex-1" data-testid="blocked-reason">Not available to {countryName}: {r.blocked_reason}</p>
                      ) : (
                        <>
                          <dl className="mt-3 pt-3 border-t border-line space-y-1 text-[13.5px] flex-1">
                            <div className="flex justify-between gap-2"><dt className="text-muted">Your cost (incl. shipping)</dt><dd className="font-semibold tabular-nums whitespace-nowrap">{usd(quote.total_cents)}</dd></div>
                            {sugg && <div className="flex justify-between gap-2"><dt className="text-muted">Suggested price</dt><dd className="font-bold tabular-nums whitespace-nowrap">{usd(sugg)}</dd></div>}
                            {pr && <div className="flex justify-between gap-2"><dt className="text-muted">Profit</dt><dd className="font-bold text-ok tabular-nums whitespace-nowrap">{usd(pr.cents)} ({pr.pct}%)</dd></div>}
                          </dl>
                          <form action={added ? removeFromImportList : addToImportList} className="mt-3">
                            <input type="hidden" name="product_id" value={r.product_id} />
                            <input type="hidden" name="service" value={quote.service} />
                            {sugg && <input type="hidden" name="price" value={(sugg / 100).toFixed(2)} />}
                            <ImportButton added={added} />
                          </form>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
