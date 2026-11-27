import Link from 'next/link';
import Image from 'next/image';
import { connection } from 'next/server';
import { Home, Cpu, Sparkles, Dog, Tent, Briefcase, ToyBrick, Package, Shirt, Utensils, Lamp, Gift, Hammer, Heart, Car, Watch, Boxes } from 'lucide-react';
import { money } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { getStoreContent } from '@/components/store/currency';
import { getCardsByIds, getCategoryCounts, listOpenPools, listProducts } from '@/components/store/data';
import { ProductImage, unitOne } from '@/components/store/product-card';
import { ProgressBar } from '@/components/store/pools/pool-card';
import { Countdown } from '@/components/store/pools/countdown';
import { stockTotals } from '@/lib/category-stock';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { tkImageUrl } from '@/lib/turnkey/format';
import { getDropshipCatalogue, pickRoute } from '@/lib/dropship';
import { dropshipOn, nowIso } from '@/lib/core/account';
import { SUB_BRANDS, type SubBrand } from '@/components/site/ui';
import { getShopViewer, getPersonalPickIds, getRecentlyViewedIds } from '@/lib/shop/data';
import { shopCan } from '@/lib/shop/shared';
import { ShopCard, CardGrid } from './shop-card';
import { PanelLink } from './panel-link';

/* CH-1 Shop home rails (Shop_Home.html, top to bottom). Each rail is its own async component inside its own <Suspense>
   (app/shop/page.tsx) with its own empty state. Catalogue data = the public cached queries; only ids come from the session. */

const wrap = 'max-w-[1240px] mx-auto px-4 sm:px-6';

export function Rail({ id, title, sub, more, children, testId }: {
  id: string; title: string; sub?: React.ReactNode; more?: { href: string; label: string }; children: React.ReactNode; testId?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`${wrap} py-6 sm:py-8 scroll-mt-28`} data-testid={testId ?? `shop-rail-${id}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 mb-4">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="m-0 text-[22px] sm:text-[26px] font-bold leading-tight">{title}</h2>
          {sub && <p className="m-0 mt-1 text-[15px] text-muted">{sub}</p>}
        </div>
        {more && <Link href={more.href} className="inline-flex items-center min-h-11 font-semibold text-coral-text underline underline-offset-4">{more.label}<span className="sr-only">: {title}</span></Link>}
      </div>
      {children}
    </section>
  );
}

export function RailSkeleton({ title, n = 4 }: { title: string; n?: number }) {
  return (
    <section className={`${wrap} py-6 sm:py-8`} aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="h-7 w-64 max-w-full rounded bg-fill mb-4" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: n }).map((_, i) => <div key={i} className="card h-[300px] bg-white" />)}
      </div>
    </section>
  );
}

const Empty = ({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) => (
  <div className="card"><EmptyState title={title} body={body} action={action} /></div>
);

/* 1 · Welcome strip */
export async function WelcomeStrip() {
  const v = await getShopViewer();
  return <WelcomeStripView firstName={v.firstName} waiting={v.waiting} />;
}

export function WelcomeStripView({ firstName, waiting: n }: { firstName: string | null; waiting: number | null }) {
  const line = n == null ? 'See what is waiting for you in your account panel.'
    : n === 0 ? 'Nothing is waiting for you right now.'
      : `${n} ${n === 1 ? 'thing is' : 'things are'} waiting for you.`;
  return (
    <section className={`${wrap} pt-6`} aria-labelledby="welcome-h" data-testid="welcome-strip">
      <div className="rounded-[16px] bg-white border border-line px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="welcome-h" className="m-0 text-[22px] sm:text-[26px] font-bold leading-tight">Welcome back{firstName ? `, ${firstName}` : ''}</h1>
          <p className="m-0 mt-1 text-[15px] text-black" data-testid="waiting-line">{line}</p>
        </div>
        <PanelLink href="/account" className="min-h-11 px-4 rounded-[10px] bg-coral text-white font-semibold no-underline hover:bg-coral-text hover:text-white" testId="welcome-panel-link">
          Open my account panel
        </PanelLink>
      </div>
    </section>
  );
}

/* 1b · Your services: one sign-in for all six (owner 27 Nov). On → the panel page; otherwise an in-app request, never a new account. */
export async function ServicesStrip() {
  const v = await getShopViewer();
  const { settings } = await getStoreContent();
  const s = v.services;
  const dsOn = v.dropshipV2 && dropshipOn(s.dropship);
  const items: ServiceTile[] = [
    { key: 'sourcing', on: s.sourcing.status === 'on', panel: '/account/sourcing', request: '/shop/products', requestLabel: 'Browse products' },
    { key: 'brand', on: s.brand.status === 'on', panel: '/account/brand', request: '/request/brand', requestLabel: 'Start a brand' },
    { key: 'pools', on: false, panel: '/account/pools', request: '/shop/pools', requestLabel: 'See open pools', hidden: settings.pool_enabled === false },
    { key: 'turnkey', on: false, panel: '/account/turnkey', request: '/shop/turnkey', requestLabel: 'See projects', hidden: settings['turnkey.enabled'] === false },
    { key: 'dropship', on: dsOn, panel: '/account/dropship', request: v.dropshipV2 ? '/account/dropship' : '/request/dropship', requestLabel: v.dropshipV2 ? 'Request access' : 'Join the launch list' },
    { key: '3pl', on: s.warehouse.status === 'on', panel: '/account/warehouse', request: '/3pl/apply', requestLabel: 'Apply in one step' },
  ];
  return <ServicesStripView items={items.filter((i) => !i.hidden)} />;
}

export type ServiceTile = { key: SubBrand; on: boolean; panel: string; request: string; requestLabel: string; hidden?: boolean };
export function ServicesStripView({ items }: { items: ServiceTile[] }) {
  return (
    <section className={`${wrap} pt-4`} aria-labelledby="services-h" data-testid="services-strip">
      <h2 id="services-h" className="sr-only">Your services</h2>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 list-none m-0 p-0">
        {items.map((i) => {
          const b = SUB_BRANDS[i.key];
          return (
            <li key={i.key} className="card p-3 flex flex-col gap-2" data-testid={`service-${i.key}`}>
              <Image src={b.src} alt={b.alt} width={b.width} height={b.height} sizes="140px" className="block h-10 w-auto self-start rounded-[8px]" />
              <span className={`pill self-start ${i.on ? 'bg-ok-bg text-ok' : 'bg-tint text-ink'}`}>{i.on ? 'On for your company' : 'Available'}</span>
              {i.on
                ? <PanelLink href={i.panel} className="min-h-11 text-[14px] font-semibold text-coral-text underline underline-offset-4">Open in panel</PanelLink>
                : <Link href={i.request} className="inline-flex items-center min-h-11 text-[14px] font-semibold text-coral-text underline underline-offset-4">{i.requestLabel}</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* 2 · Shop by category */
const ICONS: [RegExp, typeof Home][] = [
  [/home|kitchen|house|furnit/i, Home], [/electr|tech|phone|computer/i, Cpu], [/beaut|cosmet|personal/i, Sparkles], [/pet/i, Dog],
  [/outdoor|garden|sport|camp/i, Tent], [/office|station/i, Briefcase], [/toy|baby|kid/i, ToyBrick], [/pack/i, Package],
  [/apparel|cloth|fashion|textile/i, Shirt], [/food|bever/i, Utensils], [/light|lamp/i, Lamp], [/gift|craft/i, Gift],
  [/tool|hardware|industr/i, Hammer], [/health|medic/i, Heart], [/auto|car|vehic/i, Car], [/watch|jewel|access/i, Watch],
];
export async function CategoryTiles() {
  const [{ categories }, counts] = await Promise.all([getStoreContent(), getCategoryCounts()]);
  const totals = stockTotals(categories, counts);
  const top = categories.filter((c) => c.level === 1 && (totals.get(c.id) ?? 0) > 0)
    .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || a.sort - b.sort).slice(0, 8);
  return (
    <Rail id="categories" title="Shop by category" more={{ href: '/shop/products', label: 'All categories' }}>
      {top.length === 0 ? <Empty title="No categories yet" body="Categories appear here as soon as products are listed." /> : (
        <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 list-none m-0 p-0">
          {top.map((c) => {
            const Icon = ICONS.find(([re]) => re.test(`${c.slug} ${c.name}`))?.[1] ?? Boxes;
            return (
              <li key={c.id}>
                <Link href={`/shop/products?c=${encodeURIComponent(c.slug)}`} className="card card-lift flex flex-col items-center justify-center gap-2 min-h-[104px] p-3 text-center text-[14px] font-semibold text-ink underline underline-offset-4 decoration-line-strong hover:text-coral-text">
                  <span className="w-11 h-11 rounded-[12px] bg-tint text-coral-text flex items-center justify-center" aria-hidden><Icon size={20} strokeWidth={1.9} /></span>
                  {c.name}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Rail>
  );
}

/* 3 · Recommended sourcing products */
export async function RecommendedRail() {
  const v = await getShopViewer();
  const { ids, personal } = await getPersonalPickIds(8);
  const cards = await getCardsByIds(ids);
  return (
    <Rail id="recommended" title="Recommended sourcing products"
      sub={personal ? 'Based on your categories and past requests. Prices drop at higher quantities.' : 'Popular with buyers right now. Prices drop at higher quantities.'}
      more={{ href: '/shop/products', label: 'See all products' }}>
      {cards.length === 0 ? <Empty title="No products to suggest yet" body="Suggestions appear once products are listed." action={<Link href="/request/sourcing" className="btn btn-primary">Request a product</Link>} /> : (
        <CardGrid testId="recommended-grid">{cards.map((p) => <li key={p.id} className="min-w-0 flex"><ShopCard p={p} canAct={shopCan(v.role)} /></li>)}</CardGrid>
      )}
    </Rail>
  );
}

/* 4 · MOQ pools */
export async function PoolsRail() {
  const { settings } = await getStoreContent();
  if (settings.pool_enabled === false) return null;
  const { items } = await listOpenPools({ limit: 3, sort: 'closing' });
  const n = (x: number) => x.toLocaleString('en-US');
  return (
    <Rail id="pools" title="MOQ pools: buy together" sub="Join other buyers to reach the factory minimum and pay the bulk price." more={{ href: '/shop/pools', label: 'See all pools' }}>
      {items.length === 0 ? <Empty title="No open pools right now" body="Start one from any product page: other buyers join and you pay only for your share." action={<Link href="/shop/products" className="btn btn-ghost">Browse products</Link>} /> : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none m-0 p-0" data-testid="pools-grid">
          {items.map((p) => (
            <li key={p.id} className="card overflow-hidden flex flex-col">
              <ProductImage src={p.product.image_url} alt={p.product.title} />
              <div className="p-4 flex flex-col gap-2 flex-1">
                <h3 className="m-0 text-[15px] font-semibold leading-snug line-clamp-2"><Link href={`/pool/${p.code}`} className="text-ink underline underline-offset-4 decoration-line-strong hover:text-coral-text">{p.product.title}</Link></h3>
                <div className="text-[15px]">
                  {p.pool_price_minor != null ? <>Pool price <b className="font-display text-[17px]">{money(p.pool_price_minor, p.currency)}</b></> : <span className="text-muted">Pool price on request</span>}
                  {p.base_price_minor != null && p.pool_price_minor != null && p.base_price_minor > p.pool_price_minor && <> <s className="text-muted">{money(p.base_price_minor, p.currency)}</s><span className="sr-only"> normal price</span></>}
                  <span className="text-muted"> / {unitOne(p.product.unit)}</span>
                </div>
                <ProgressBar filled={p.filled_qty} target={p.target_qty} className="h-2" />
                <div className="text-[13px] text-muted flex flex-wrap gap-x-3">
                  <span>{n(p.filled_qty)} of {n(p.target_qty)} {p.product.unit}</span>
                  <Countdown to={p.deadline_at} prefix="Closes in " />
                  <span>Join from {n(p.min_pledge)} {p.product.unit}</span>
                </div>
                <Link href={`/pool/${p.code}`} className="btn btn-dark btn-sm mt-auto">Join pool<span className="sr-only">: {p.product.title}</span></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Rail>
  );
}

/* 5 · Turnkey projects */
export async function TurnkeyRail() {
  const { settings } = await getStoreContent();
  if (settings['turnkey.enabled'] === false) return null;
  const { projects } = await getTurnkeyCatalogue();
  const list = projects.slice(0, 3);
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    <Rail id="turnkey" title="Turnkey projects" sub="From idea to delivered stock: design, sourcing, samples, QC, packaging and shipping." more={{ href: '/shop/turnkey', label: 'See all projects' }}>
      {list.length === 0 ? <Empty title="No projects listed yet" body="Tell us what you want to build and we plan it with you." action={<Link href="/account/turnkey/new" className="btn btn-primary">Start a project</Link>} /> : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none m-0 p-0" data-testid="turnkey-grid">
          {list.map((p) => <li key={p.project_id}><TurnkeyCard p={p} image={tkImageUrl(p.hero_image_path, sb)} /></li>)}
        </ul>
      )}
    </Rail>
  );
}

export function TurnkeyCard({ p, image }: { p: Awaited<ReturnType<typeof getTurnkeyCatalogue>>['projects'][number]; image: string | null }) {
  return (
    <article className="card overflow-hidden flex flex-col h-full">
      <ProductImage src={image} alt={p.hero_image_alt ?? p.title} label="Project photo" />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <h3 className="m-0 text-[15px] font-semibold leading-snug">{p.title}</h3>
        {p.short_reason && <p className="m-0 text-[14px] text-muted line-clamp-2">{p.short_reason}</p>}
        <div className="text-[15px]">
          {p.starting_budget_usd != null && Number(p.starting_budget_usd) > 0
            ? <>From <b className="font-display text-[17px]">{money(Math.round(Number(p.starting_budget_usd) * 100), 'USD')}</b>{p.budget_unit ? <span className="text-muted"> {p.budget_unit}</span> : null}</>
            : <span className="text-muted">Budget in your quote</span>}
        </div>
        <div className="text-[13px] text-muted">Timeline and MOQ in your quote</div>
        <div className="mt-auto pt-2 grid grid-cols-2 gap-2">
          <Link href={`/turnkey/catalogue#${encodeURIComponent(p.project_id)}`} className="btn btn-ghost btn-sm">View project<span className="sr-only">: {p.title}</span></Link>
          <Link href={`/account/turnkey/new?project=${encodeURIComponent(p.project_id)}`} className="btn btn-primary btn-sm">Start<span className="sr-only">: {p.title}</span></Link>
        </div>
      </div>
    </article>
  );
}

/* 6 · Dropshipping (gated): names + images only until the company has dropship on; then landed cost to its country */
export async function DropshipRail() {
  const v = await getShopViewer();
  const on = v.dropshipV2 && dropshipOn(v.services.dropship);
  if (on) {
    const country = (v.org.country ?? 'US').toUpperCase();
    const { rows } = await getDropshipCatalogue({ country }).catch(() => ({ rows: [] as Awaited<ReturnType<typeof getDropshipCatalogue>>['rows'] }));
    return (
      <Rail id="dropship" title="Dropshipping products" sub={`Ready to sell from our warehouse. Landed cost to ${country}.`} more={{ href: '/account/dropship/catalogue', label: 'Open the catalogue' }}>
        {rows.length === 0 ? <Empty title="No products for your country yet" body="Your dropship catalogue shows every product with a price to your countries." /> : (
          <CardGrid testId="dropship-grid">
            {rows.slice(0, 4).map((r) => {
              const route = pickRoute(r.routes);
              return (
                <li key={r.product_id} className="card overflow-hidden flex flex-col">
                  <ProductImage src={r.images[0] ?? null} alt={r.title} />
                  <div className="p-4 flex flex-col gap-1.5 flex-1">
                    <h3 className="m-0 text-[15px] font-semibold leading-snug line-clamp-2">{r.title}</h3>
                    <span className="mono text-[12px] text-muted">{r.model_no}</span>
                    <div className="text-[15px]">{route ? <>Landed <b className="font-display text-[17px]">{money(route.landed_price_cents, 'USD')}</b></> : <span className="text-muted">No price for this route</span>}</div>
                  </div>
                </li>
              );
            })}
          </CardGrid>
        )}
      </Rail>
    );
  }
  const { items } = await listProducts({ dropship: true, sort: 'newest' }).catch(() => ({ items: [] as Awaited<ReturnType<typeof listProducts>>['items'] }));
  const list = items.slice(0, 4);
  return (
    <Rail id="dropship" title="Dropshipping products" sub="Ready to sell from our warehouse." more={{ href: v.dropshipV2 ? '/account/dropship' : '/request/dropship', label: 'Learn more' }}>
      <div className="rounded-[14px] bg-tint px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3" data-testid="dropship-gate">
        <p className="m-0 text-[15px] text-black max-w-[720px]">
          {v.dropshipV2
            ? 'Sell these in your store. We pack and ship every order under your brand. Request access to see landed costs to your countries.'
            : 'Octopus Dropship is coming soon. Join the launch list and we tell you when it opens.'}
        </p>
        <Link href={v.dropshipV2 ? '/account/dropship' : '/request/dropship'} className="btn btn-primary btn-sm" data-testid="dropship-request-access">
          {v.dropshipV2 ? 'Request access' : 'Join the launch list'}
        </Link>
      </div>
      {list.length === 0 ? <Empty title="No dropshipping products listed yet" body="Products ready to dropship appear here." /> : (
        <CardGrid testId="dropship-grid">
          {list.map((p) => (
            <li key={p.id} className="card overflow-hidden flex flex-col">
              <ProductImage src={p.image_url} alt={p.title} />
              <div className="p-4 flex flex-col gap-1.5 flex-1">
                <h3 className="m-0 text-[15px] font-semibold leading-snug line-clamp-2">{p.title}</h3>
                <span className="text-[13px] text-muted">Landed cost shown after access</span>
              </div>
            </li>
          ))}
        </CardGrid>
      )}
    </Rail>
  );
}

/* 7 · New arrivals (last 14 days) */
export async function NewArrivalsRail() {
  await connection();
  const v = await getShopViewer();
  const since = new Date(Date.parse(nowIso()) - 14 * 864e5).toISOString().slice(0, 10);
  const { items } = await listProducts({ sort: 'newest', newSince: since });
  return (
    <Rail id="new" title="New arrivals" sub="Added in the last 14 days." more={{ href: '/shop/products?sort=newest', label: 'See new arrivals' }}>
      {items.length === 0 ? <Empty title="Nothing new in the last 14 days" body="New products appear here as soon as they are listed." action={<Link href="/shop/products?sort=newest" className="btn btn-ghost">See the newest products</Link>} /> : (
        <CardGrid testId="new-grid">{items.slice(0, 4).map((p) => <li key={p.id} className="min-w-0 flex"><ShopCard p={p} canAct={shopCan(v.role)} /></li>)}</CardGrid>
      )}
    </Rail>
  );
}

/* 8 · Put your brand on it + Request a product we don't list */
export function BrandBand() {
  const b = SUB_BRANDS.brand;
  return (
    <section className={`${wrap} py-6`} aria-labelledby="brand-h" data-testid="brand-band">
      <div className="rounded-[18px] bg-white border border-line p-5 sm:p-7 flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4 min-w-0">
          <Image src={b.src} alt={b.alt} width={b.width} height={b.height} sizes="160px" className="block h-14 w-auto rounded-[10px] shrink-0" />
          <div className="min-w-0">
            <h2 id="brand-h" className="m-0 text-[22px] font-bold">Put your brand on it</h2>
            <p className="m-0 mt-1 text-[15px] text-black">Logo, packaging, labels and inserts, made with the products you buy.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/request/brand" className="btn btn-primary">Start a brand</Link>
          <Link href="/request/sourcing" className="btn btn-ghost">Request a product we don&rsquo;t list</Link>
        </div>
      </div>
    </section>
  );
}

/* 9 · Recently viewed */
export async function RecentlyViewedRail() {
  const v = await getShopViewer();
  const cards = await getCardsByIds(await getRecentlyViewedIds(8));
  return (
    <Rail id="recent" title="Recently viewed">
      {cards.length === 0 ? <Empty title="Nothing viewed yet" body="Products you open in the shop show here, so you can find them again." /> : (
        <CardGrid testId="recent-grid">{cards.map((p) => <li key={p.id} className="min-w-0 flex"><ShopCard p={p} canAct={shopCan(v.role)} /></li>)}</CardGrid>
      )}
    </Rail>
  );
}
