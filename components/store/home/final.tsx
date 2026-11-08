import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { block } from '@/lib/content';
import { money } from '@/lib/format';
import { getSession } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getSiteMedia, slot, type SiteImage } from '@/lib/media';
import { getStoreContent } from '@/components/store/currency';
import { getFeatured, listOpenPools, listProducts, getServices, type CardProduct, type PoolCard } from '@/components/store/data';
import { unitOne } from '@/components/store/product-card';
import { getTurnkeyCatalogue } from '@/lib/turnkey/data';
import { CATEGORY_PILL, TURNKEY_CATEGORIES } from '@/lib/turnkey/format';
import { JsonLd, SITE_URL } from '@/components/store/seo';
import { copy } from './shared';
import { IllCard, Photo, FloatingCard, InsetPhoto, HeroFeather, OctoButton, NumEyebrow, Ticks, StepRow, Band } from './brand-ui';
import { ServicePicker, type PickerTab } from './service-picker';

/**
 * Home "/" — brand kit step 5 (ADDON-48 Part 3, owner's order). Real data only: products, pools, turnkey projects,
 * offices and the RFQ fee come from the database; numbers that are not live (dropship preview on staging) carry EXAMPLE;
 * rates, delivery days and the carrier name stay hidden until they exist. Copy is overridable in Site content (home3.*).
 */
type Blocks = Record<string, string>;
const WA = 'https://wa.me/8618826527644';
const Arrow = () => <span aria-hidden>→</span>;
const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => <h2 id={id} className="mt-3 text-[25px] md:text-[34px] font-extrabold leading-[1.12] tracking-[-0.01em]">{children}</h2>;
const Lead = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-[16.5px] leading-[1.6] text-black max-w-[560px]">{children}</p>;
const Btns = ({ children }: { children: React.ReactNode }) => <div className="mt-6 flex flex-col sm:flex-row gap-3">{children}</div>;
const fb = (key: string, src: string, alt: string): [string, Omit<SiteImage, 'key'>] => [key, { src, alt, width: 1200, height: 800 }];

export async function FinalHome() {
  const [{ blocks, settings, company, branches }, media, featured, pools, turnkey, services] = await Promise.all([
    getStoreContent(), getSiteMedia(), getFeatured(4), listOpenPools({ sort: 'filled', limit: 3 }), getTurnkeyCatalogue(), getServices(),
  ]);
  const ready = featured.length ? featured : (await listProducts({ sort: 'newest' })).items.filter((p) => p.image_url).slice(0, 4);
  const img = (k: string, src: string, alt: string) => slot(media, ...fb(k, src, alt));
  const M = {
    hero: img('home.hero.image', '/images/services/3d-3pl-logistics.webp', 'The Octopus mascot storing, packing and loading parcels onto a delivery truck'),
    drop: img('home.dropship.image', '/images/services/3d-dropshipping.webp', 'The Octopus mascot taking an order from a phone and delivering the parcel'),
    dropPhoto: img('home.dropship.photo', '/images/services/dropshipping.webp', 'An Octopus packer placing a product in a box'),
    brand: img('home.brand.image', '/images/services/make-my-brand-3d.webp', 'The Octopus mascot stamping a logo onto a product box'),
    sourcing: img('home.sourcing.image', '/images/services/product-sourcing-3d.webp', 'The Octopus mascot comparing factory quotes'),
    qc: img('home.sourcing.inset', '/images/services/factory-quality-control.webp', 'Quality inspection of products at the factory'),
    pools: img('home.pools.image', '/images/services/3d-moq-pooling.webp', 'The Octopus mascot gathering boxes from several buyers onto one pallet'),
    turnkey: img('home.turnkey.image', '/images/services/turnkey-projects-3d.webp', 'The Octopus mascot loading machines into a shipping container'),
    s1: img('home.3pl.strip.1', '/images/services/logistics.webp', 'Stock being stored on warehouse shelves'),
    s2: img('home.3pl.strip.2', '/images/services/3pl-service.webp', 'A parcel being scanned before packing'),
    s3: img('home.3pl.strip.3', '/images/services/logistics-vehicle.webp', 'Parcels being loaded into a van'),
    s4: img('home.3pl.strip.4', '/images/services/returns-dropship-shirt.webp', 'A returned product being checked'),
    pay: img('home.pay.image', '/images/services/wallet-escrow-3d.webp', 'The Octopus mascot guarding a safe with a wallet'),
    manager: img('home.manager.photo', '/images/services/customer-care-phone.webp', 'An Octopus account manager on a call'),
    faq: img('home.faq.photo', '/images/services/back-office.webp', 'An Octopus support team member answering a call'),
    cta: img('home.cta.image', '/images/services/3d-transportation.webp', 'The Octopus mascot loading parcels into a van'),
    face: slot(media, 'octo.face', { src: '/images/octo/octo-face.webp', alt: '', width: 256, height: 256 }),
  };
  const rfq = services.rfq?.priceCents ? money(services.rfq.priceCents, services.rfq.currency) : null;
  const turnkeyOn = settings['turnkey.enabled'] !== false;
  const poolsOn = settings.pool_enabled !== false;
  const countries = (settings.logistics_stats as { countries?: string | number } | undefined)?.countries;
  const demo = settings['demo.addon44'] === true;
  const offices = branches.filter((b) => (b.country ?? 'CN') === 'CN');
  const officeChip = (n: string, hq?: boolean) => n.replace(/ (headquarters|sourcing.*office|office).*$/i, '') + (hq ? ' · HQ' : '');
  const warehouses = Array.isArray(settings.warehouses) ? (settings.warehouses as { code: string; city: string; country: string; handles?: string }[]) : [];
  const second = warehouses.find((w) => !/shenzhen/i.test(w.city));
  const hours = settings.assistant_office_hours as { start?: string; end?: string } | undefined;

  const tabs: PickerTab[] = [
    { key: 'drop', label: 'Dropship', service: 'Dropshipping', promise: 'List verified products in your store. We ship each order to your customer.', steps: ['Pick products and set your price', 'Your customer orders, the order lands here', 'We pack with your slip and ship with tracking'], fact: 'No stock, no minimum', cta: 'Start dropshipping →', href: '/go/dropship' },
    { key: 'brand', label: 'Put my brand on it', service: 'Make My Brand', promise: 'Your logo on a verified product, made, checked and stocked for you.', steps: ['Pick a product from our verified suppliers', 'Add your logo print, engraving or branded box', 'Approve proof and sample, then we produce and check'], fact: 'Price confirmed before you pay', cta: 'Start a brand project →', href: '/request/brand' },
    { key: 'source', label: 'Source a product', service: 'Product sourcing', promise: 'Tell us the product. We find the verified factory and get you competing quotes.', steps: ['Send your request with product, quantity and destination', 'Compare quotes from verified factories within 24 hours', 'We inspect the goods and ship them to your door'], fact: rfq ? `RFQ fee ${rfq} · quotes in 24 h` : 'Quotes in 24 h', cta: 'Request quotes →', href: '/request/sourcing' },
    ...(poolsOn ? [{ key: 'pool', label: 'Share a factory order', service: 'MOQ pools', promise: 'Factory minimum too big? Join other buyers on one factory order and each take the quantity you need.', steps: ['Join an open pool or start one for a product', 'Commit your quantity; money waits in escrow', 'When the pool reaches the factory minimum, it is ordered, checked and shipped'], fact: "Pay only for your share · refunded if the pool doesn't fill by its deadline", cta: 'See open pools →', href: '/pools' }] : []),
    { key: 'store', label: 'Store and ship', service: '3PL & shipping', promise: 'Keep your stock in Shenzhen. We ship every order worldwide.', steps: ['Send your bulk order into our Shenzhen warehouse', 'We count it and store it by SKU, live in your account', 'We pick, pack and ship each order worldwide with tracking'], fact: 'Same or next working day dispatch', cta: 'Get a 3PL quote →', href: '/request/3pl' },
  ];

  const orgLd = company && { '@context': 'https://schema.org', '@type': 'Organization', name: company.brand ?? company.legal_name, legalName: company.legal_name, url: SITE_URL, logo: `${SITE_URL}/brand/octopus-b2b-logo.png`, email: company.email ?? undefined, telephone: company.phone ?? undefined };

  return (
    <div data-testid="home-final">
      {orgLd && <JsonLd data={orgLd} />}

      {/* Hero + picker */}
      <section className="bg-pearl" aria-labelledby="hero-h">
        <div className="wrap pt-8 md:pt-12 pb-10 md:pb-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_560px] items-center">
            <div>
              <div className="label-caps text-coral-text">{block(blocks, 'home3.hero.eyebrow', 'Dropshipping · Branding · Sourcing · Warehousing')}</div>
              <h1 id="hero-h" className="mt-3 text-[34px] md:text-[50px] leading-[1.05] font-extrabold tracking-[-0.03em]">
                {block(blocks, 'home3.hero.title', 'From the factory to your customer.')} <span className="text-coral-text">{block(blocks, 'home3.hero.title2', 'One account.')}</span>
              </h1>
              <p className="mt-4 text-[16.5px] leading-[1.6] text-black max-w-[560px]">{block(blocks, 'home3.hero.lead', 'Sell without holding stock, put your brand on verified products, source from factories in China and ship worldwide, with one US dollar wallet and one account manager.')}</p>
              <form action="/search" role="search" className="mt-6 flex max-w-[600px] rounded-[12px] border-[1.5px] border-ink bg-white overflow-hidden focus-within:ring-3 focus-within:ring-coral-text">
                <label htmlFor="hero-q" className="sr-only">Search products, HS codes or suppliers</label>
                <input id="hero-q" name="q" type="search" placeholder="Search products, HS codes or suppliers" className="flex-1 min-w-0 px-4 min-h-14 text-[16px] outline-none placeholder:text-muted" />
                <button type="submit" className="btn btn-dark rounded-none min-h-14 px-6">Search</button>
              </form>
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-black">
                {['Verified factories', 'Quotes in 24 h', 'One account manager', 'Escrow wallet'].map((t) => <li key={t} className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-ok" aria-hidden />{t}</li>)}
              </ul>
            </div>
            <HeroFeather img={M.hero} />
          </div>
          <div className="mt-8"><ServicePicker tabs={tabs} /></div>
        </div>
      </section>

      {/* Route */}
      <Band white label="How it fits together">
        <div className="label-caps text-coral-text">How it fits together</div>
        <H2 id="route-h">One account, the whole route</H2>
        <p className="mt-2 text-[15.5px] text-muted max-w-[640px]">Five stages from a factory in China to your customer. Each one is a service in the same account.</p>
        <ol className="mt-7 flex md:grid md:grid-cols-5 gap-3 overflow-x-auto snap-x -mx-4 px-4 md:mx-0 md:px-0 pb-1">
          {[
            ['Find', 'Get quotes from verified factories, or share a factory minimum.', [['Product sourcing', '/#sourcing'], ...(poolsOn ? [['MOQ pools', '/pools']] : [])]],
            ['Brand', 'Put your logo on the product and the box.', [['Make My Brand', '/make-my-brand']]],
            ['Stock', 'Keep your goods in our Shenzhen warehouse, by SKU.', [['3PL warehousing', '/#warehousing']]],
            ['Sell', 'List products in your own store. We fulfil each order.', [['Dropshipping', '/#dropshipping']]],
            ['Ship', countries ? `Delivered with tracking in ${countries} countries.` : 'Delivered with tracking to your customer.', [['Worldwide shipping', '/#warehousing']]],
          ].map(([t, b, links], i) => (
            <li key={t as string} className="card p-4 shrink-0 w-[240px] md:w-auto snap-start">
              <div className="label-caps text-muted">Stage {i + 1}</div>
              <h3 className="mt-1 text-[18px] font-bold">{t as string}</h3>
              <p className="mt-1 text-[14px] text-muted">{b as string}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{(links as string[][]).map(([l, h]) => <Link key={l} href={h} className="pill bg-tint text-coral-text min-h-8">{l}</Link>)}</div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[14px] text-muted">Use one service or all of them. Your wallet, your account manager and your orders stay in one place.</p>
      </Band>

      {/* 1 · Dropshipping */}
      <Band id="dropshipping" label="Dropshipping">
        <div className="grid gap-8 lg:grid-cols-2 items-center">
          <div>
            <NumEyebrow n={1}>Dropshipping</NumEyebrow>
            <H2 id="drop-h">You sell. We ship to your customer.</H2>
            <Lead>List verified products in your store. We pack each order under your brand and ship it with tracking. You see the full cost first.</Lead>
            <Ticks className="mt-5" items={['No stock, no minimum', 'Your packing slip, never our prices', 'Tracking to the door']} />
            <Btns><Link href="/go/dropship" className="btn btn-primary min-h-[52px]">Start dropshipping <Arrow /></Link><Link href="/products" className="btn btn-ghost min-h-[52px]">See the catalogue</Link></Btns>
          </div>
          <IllCard img={M.drop} chip="Your store → our warehouse → your customer's door" />
        </div>
        <Suspense fallback={null}><DropPreview demo={demo} photo={M.dropPhoto} /></Suspense>
        <div className="mt-8"><StepRow steps={[['Choose products', 'Pick from products made by verified factories.'], ['Connect your shop', 'Shopify, WooCommerce, or upload a sheet.'], ['Pay per order', 'Product, shipping and fulfilment fee come out of your wallet.'], ['We pack and deliver', 'Packed under your brand and delivered with tracking.']]} /></div>
      </Band>

      {/* 2 · Make My Brand */}
      <Band id="make-my-brand" white label="Make My Brand">
        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <div className="relative order-2 lg:order-1">
            <IllCard img={M.brand} />
            <FloatingCard corner="bottom-right" className="flex items-center gap-3 max-w-[300px]">
              <span className="relative w-14 h-14 rounded-[10px] overflow-hidden bg-ill-bg shrink-0"><Image src="/mmb/F8.jpg" alt="" fill sizes="56px" className="object-cover" /></span>
              <span><span className="pill bg-ink text-white !text-[9.5px]">Studio preview</span><span className="block mt-1 text-[13.5px] font-semibold text-ink">Handheld fan F8 · your logo</span><span className="block text-[12px] text-muted">Illustrative preview. Not approved artwork.</span></span>
            </FloatingCard>
          </div>
          <div className="order-1 lg:order-2">
            <NumEyebrow n={2} isNew>Make My Brand</NumEyebrow>
            <H2 id="mmb-h">Your brand on proven products.</H2>
            <Lead>Your logo on products from verified suppliers. We produce, check, stock and ship it, in bulk or order by order from your store.</Lead>
            <ul className="mt-5 space-y-3">
              {[['Verified suppliers only', 'Only products Octopus lists directly.'], ['One account manager', 'One person for artwork, proof, sample and approvals.'], ['Price confirmed before you pay', 'Price, delivery date, duties and shipping in your quote.']].map(([t, b]) => (
                <li key={t} className="flex gap-3"><span className="mt-1 w-2 h-2 rounded-full bg-coral shrink-0" aria-hidden /><span><b className="text-ink">{t}</b><span className="block text-[14px] text-muted">{b}</span></span></li>
              ))}
            </ul>
            <Btns><Link href="/request/brand" className="btn btn-primary min-h-[52px]">Start a brand project <Arrow /></Link><Link href="/make-my-brand" className="btn btn-ghost min-h-[52px]">See how it works</Link></Btns>
          </div>
        </div>
        <div className="mt-10"><StepRow steps={[['Pick a verified product', 'Only products Octopus lists directly.'], ['Add your brand', 'Logo print, engraving or a branded box.'], ['Approve proof and sample', 'Nothing is made until you approve both.'], ['We make, check and stock it', 'Then ship it in bulk or order by order.']]} /></div>
      </Band>

      {/* 3 · Product sourcing */}
      <Band id="sourcing" label="Product sourcing">
        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <div>
            <NumEyebrow n={3}>Product sourcing</NumEyebrow>
            <H2 id="src-h">Tell us the product. We find the factory.</H2>
            <Lead>Our team in China gets you competing quotes from verified factories within 24 hours, inspects the goods and ships them to your door.</Lead>
            <Btns><Link href="/request/sourcing" className="btn btn-primary min-h-[52px]">Request quotes <Arrow /></Link><Link href="/products" className="btn btn-ghost min-h-[52px]">Browse ready-to-order products</Link></Btns>
            {rfq && <p className="mt-3 text-[13.5px] text-muted">RFQ fee {rfq} · one contract, one invoice, paid through escrow.</p>}
            {offices.length > 0 && (
              <div className="mt-5"><div className="label-caps text-muted">Our sourcing offices in China</div>
                <ul className="mt-2 flex flex-wrap gap-2">{offices.map((o) => <li key={o.id} className="pill bg-white border border-line text-ink !normal-case !tracking-normal !text-[13px] !font-semibold min-h-9">{officeChip(o.name, (o as { is_hq?: boolean }).is_hq)}</li>)}</ul>
              </div>
            )}
          </div>
          <div className="relative md:pb-6 md:pl-6"><IllCard img={M.sourcing} chip="Real factory checks before you pay" chipTone="ok" className="md:[&>span]:left-auto md:[&>span]:right-4" /><InsetPhoto img={M.qc} /></div>
        </div>
        <div className="mt-10"><StepRow steps={[['Request', 'Tell us the product, quantity and destination country.'], ['Matched quotes', 'Competing quotes from verified factories within 24 hours.'], ['Sample and order', 'Order a sample first, then confirm.'], ['Inspect and deliver', 'We inspect the goods and ship them to your door.']]} /></div>
      </Band>

      <Suspense fallback={null}>
        <RestOfHome blocks={blocks} M={M} pools={poolsOn ? pools.items : []} poolsOn={poolsOn} turnkey={turnkeyOn ? turnkey.projects : []} ready={ready} countries={countries} second={second} demo={demo} hours={hours} legal={company?.legal_name ?? null} />
      </Suspense>

      <OctoButton face={M.face} />
    </div>
  );
}

/* ───────── Dropship catalogue preview (EXAMPLE numbers from the staging demo data; hidden on live until it exists) ───────── */
async function DropPreview({ demo, photo }: { demo: boolean; photo: SiteImage }) {
  type Row = { title: string; image_url: string | null; total: number; sugg: number; service: string; days: string };
  let rows: Row[] = [];
  if (demo) {
    try {
      const sb = createAdminClient();
      const [{ data: dp }, { data: rates }, { data: mk }] = await Promise.all([
        sb.from('dropship_products').select('unit_cents, weight_g, has_battery, products!inner(title, image_url, status)').eq('enabled', true).eq('products.status', 'live').not('products.image_url', 'is', null).limit(3),
        sb.from('dropship_rates').select('service, ship_base_cents, ship_per_100g_cents, duty_pct, fee_cents, days_min, days_max').eq('country', 'AE').eq('active', true),
        sb.from('site_settings').select('value').eq('key', 'dropship.markup').maybeSingle(),
      ]);
      const markup = Number(mk?.value) || 2.5;
      const order = ['express', 'standard', 'economy'];
      rows = (dp ?? []).map((d, i) => {
        const r = (rates ?? []).find((x) => x.service === order[i % 3]) ?? (rates ?? [])[0];
        const p = d.products as unknown as { title: string; image_url: string | null };
        const ship = r ? r.ship_base_cents + Math.ceil(d.weight_g / 100) * r.ship_per_100g_cents + Math.round((d.unit_cents * Number(r.duty_pct)) / 100) : 0;
        const total = d.unit_cents + ship + (r?.fee_cents ?? 0);
        return { title: p.title.split(/,| with /)[0], image_url: p.image_url, total, sugg: Math.ceil((total * markup) / 100) * 100 - 1, service: r?.service ?? 'express', days: r ? `${r.days_min}–${r.days_max} days` : '' };
      });
    } catch { rows = []; }
  }
  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr] items-stretch">
      {rows.length > 0 ? (
        <div className="card p-4 sm:p-5" data-testid="drop-preview">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="font-bold text-ink">Catalogue preview</span><span className="pill bg-warn-bg text-warn">Example</span></div><Link href="/go/dropship" className="inline-flex items-center min-h-11 text-[14px] font-semibold text-coral-text">See the catalogue <Arrow /></Link></div>
          <ul className="mt-3 flex md:grid md:grid-cols-3 gap-3 overflow-x-auto snap-x -mx-1 px-1 pb-1">
            {rows.map((r) => (
              <li key={r.title} className="rounded-[12px] border border-line p-3 shrink-0 w-[220px] md:w-auto snap-start">
                <div className="relative aspect-square rounded-[10px] overflow-hidden bg-fill">{r.image_url && <Image src={r.image_url} alt="" fill sizes="200px" className="object-cover" unoptimized />}</div>
                <div className="mt-2 text-[14px] font-semibold text-ink line-clamp-1">{r.title}</div>
                <dl className="mt-1.5 text-[12.5px] space-y-0.5">
                  <div className="flex justify-between"><dt className="text-muted">Your cost</dt><dd className="tabular-nums">{money(r.total, 'USD')}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Suggested price</dt><dd className="font-semibold tabular-nums">{money(r.sugg, 'USD')}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Profit</dt><dd className="font-semibold text-ok tabular-nums">{money(r.sugg - r.total, 'USD')}</dd></div>
                </dl>
                <div className="mt-2 flex gap-1.5"><span className="pill bg-tint text-coral-text">{r.service}</span><span className="pill bg-fill text-muted">{r.days}</span></div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-muted">Prices shown are examples, for customers in the United Arab Emirates.</p>
        </div>
      ) : <div className="hidden lg:block" />}
      <Photo img={photo} className="hidden md:block" aspect="aspect-[4/3] lg:aspect-auto lg:h-full" shade={{ title: 'Packed with your packing slip', line: 'Your brand on the parcel, never our prices.' }} />
    </div>
  );
}

/* ───────── sections 4–12 ───────── */
function RestOfHome({ blocks, M, pools, poolsOn, turnkey, ready, countries, second, demo, hours, legal }: {
  blocks: Blocks; M: Record<string, SiteImage>; pools: PoolCard[]; poolsOn: boolean; turnkey: Awaited<ReturnType<typeof getTurnkeyCatalogue>>['projects']; ready: CardProduct[];
  countries?: string | number; second?: { city: string; country: string; handles?: string }; demo: boolean; hours?: { start?: string; end?: string }; legal: string | null;
}) {
  const tkCounts = TURNKEY_CATEGORIES.map((c) => ({ c, n: turnkey.filter((p) => p.category === c).length })).filter((x) => x.n);
  const tk5 = [...turnkey].sort((a, b) => Number(b.is_starter_pick) - Number(a.is_starter_pick) || (a.starter_rank ?? 99) - (b.starter_rank ?? 99) || a.sort_rank - b.sort_rank).slice(0, 5);
  const faq = [1, 2, 3, 4, 5, 6, 7].map((n) => copy(blocks, `home3.faq.${n}`, [
    'What does Octopus do?|Octopus B2B gives you one account for buying from China: dropshipping, Make My Brand, product sourcing, MOQ pools, Turnkey Projects, and 3PL warehousing with worldwide shipping. One US dollar wallet and one account manager cover all of them.',
    'Are the factories verified?|Yes. Dropshipping and Make My Brand use only products Octopus lists directly, from verified suppliers, and our sourcing team matches you only with verified factories.',
    'Can I use only one service?|Yes. Use one service or all of them. Your wallet, your account manager and your orders stay in one place either way.',
    "How do MOQ pools work?|A pool lets several buyers share one factory order: each commits the quantity they need, and the money waits in escrow. The order is placed when the pool reaches the factory minimum, and you are refunded if the pool doesn't fill by its deadline.",
    'Where are your warehouses?|Our warehouse is in Shenzhen, China. We deliver worldwide with tracking to the door.',
    'How do I pay?|Top up your US dollar wallet by bank transfer; the bank details and your reference are in your wallet. The money for an order stays in escrow until the goods pass QC and ship. We do not take card payments.',
    'How do I talk to someone?|Message us on WhatsApp at +86 188 2652 7644. Once you have an account, your account manager is your direct contact, and the Octo assistant answers 24/7 and passes you to a human when needed.',
  ][n - 1])).filter(([q]) => q);

  return (
    <>
      {/* 4 · MOQ pools */}
      {poolsOn && (
        <Band id="moq-pools" white label="MOQ pools">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            <IllCard img={M.pools} chip="Many buyers, one factory order" className="order-2 lg:order-1" />
            <div className="order-1 lg:order-2">
              <NumEyebrow n={4}>MOQ pools</NumEyebrow>
              <H2 id="pools-h">Factory minimum too big? Share it.</H2>
              <Lead>Factories often start at hundreds or thousands of pieces. Share one order with other buyers; money waits in escrow until the pool reaches the minimum.</Lead>
              <ol className="mt-5 grid grid-cols-2 gap-2 text-[14px]">{['Pick a pool', 'Commit your quantity', 'Pool fills and is ordered', 'Checked and shipped to each buyer'].map((s, i) => <li key={s} className="flex gap-2"><span className="inline-flex items-center justify-center w-6 h-6 rounded-[7px] bg-coral text-white text-[12px] font-bold shrink-0">{i + 1}</span>{s}</li>)}</ol>
              <Ticks className="mt-4" items={['Pay only for your share', 'Escrow until the order is placed', "Refunded if the pool doesn't fill by its deadline"]} />
              <Btns><Link href="/pools" className="btn btn-primary min-h-[52px]">See open pools <Arrow /></Link><Link href="/request/sourcing?type=pool" className="btn btn-ghost min-h-[52px]">Start a pool for a product</Link></Btns>
            </div>
          </div>
          {pools.length > 0 && (
            <div className="mt-10 rounded-[22px] bg-ink p-5 sm:p-6" data-testid="pools-panel">
              <h3 className="!text-white text-[19px] font-bold">Open pools closest to filling</h3>
              <ul className="mt-4 flex md:grid md:grid-cols-3 gap-3 overflow-x-auto snap-x -mx-1 px-1 pb-1">
                {pools.map((p) => {
                  const pct = p.target_qty ? Math.min(100, Math.round((p.filled_qty / p.target_qty) * 100)) : 0;
                  const price = p.pool_price_minor ?? p.base_price_minor;
                  return (
                    <li key={p.id} className="rounded-[14px] bg-white p-4 shrink-0 w-[260px] md:w-auto snap-start">
                      <div className="font-bold text-ink line-clamp-1">{p.product.title}</div>
                      <div className="text-[13px] text-muted">Factory minimum {p.target_qty.toLocaleString('en-US')} {p.product.unit}</div>
                      <div className="mt-2 h-2 rounded-full bg-fill overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% filled`}><div className="h-full rounded-full bg-coral" style={{ width: `${pct}%` }} /></div>
                      <div className="mt-1.5 text-[13px] text-black">{p.filled_qty.toLocaleString('en-US')} of {p.target_qty.toLocaleString('en-US')} committed · closes {new Date(p.deadline_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                      <div className="mt-3 flex items-center justify-between">{price != null ? <span><span className="text-[12px] text-muted block">Your price</span><b className="text-ink">{money(price, p.currency)}</b><span className="text-[12px] text-muted"> / {unitOne(p.product.unit)}</span></span> : <span />}<Link href={`/pool/${p.code}`} className="btn btn-primary btn-sm">Join pool</Link></div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Band>
      )}

      {/* 5 · Turnkey */}
      {turnkey.length > 0 && (
        <Band id="turnkey" label="Turnkey Projects">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            <div>
              <NumEyebrow n={5}>Turnkey Projects</NumEyebrow>
              <H2 id="tk-h">Open a complete business, delivered in one container.</H2>
              <Lead>A ready business set-up: we source every machine, fit-out and spare from verified factories, ship it in one container and help you open.</Lead>
              <ul className="mt-4 flex flex-wrap gap-2">{tkCounts.map(({ c }) => <li key={c}><Link href={`/turnkey/atlas?category=${c}`} className="pill bg-white border border-line text-ink min-h-9 !text-[12px]">{CATEGORY_PILL[c]}</Link></li>)}</ul>
              <Btns><Link href="/turnkey" className="btn btn-primary min-h-[52px]">See all {turnkey.length} businesses <Arrow /></Link><Link href="/contact?topic=turnkey" className="btn btn-ghost min-h-[52px]">Talk to us about a project</Link></Btns>
            </div>
            <IllCard img={M.turnkey} chip="Machines, fit-out and spares in one container" />
          </div>
          <ul className="mt-10 flex lg:grid lg:grid-cols-5 gap-3 overflow-x-auto snap-x -mx-4 px-4 lg:mx-0 lg:px-0 pb-1">
            {tk5.map((p) => (
              <li key={p.project_id} className="shrink-0 w-[240px] lg:w-auto snap-start">
                <Link href={`/turnkey/${p.project_id}`} className="card p-4 block h-full hover:border-coral-text">
                  <div className="font-bold text-ink">{p.title}</div>
                  {p.short_reason && <p className="mt-1 text-[13.5px] text-muted line-clamp-2">{p.short_reason}</p>}
                </Link>
              </li>
            ))}
          </ul>
        </Band>
      )}

      {/* 6 · 3PL & shipping */}
      <Band id="warehousing" white label="3PL and shipping">
        <NumEyebrow n={6}>3PL &amp; shipping</NumEyebrow>
        <H2 id="3pl-h">Stored in China. Delivered worldwide.</H2>
        <Lead>Stock in our Shenzhen warehouse, dispatched the same or next working day and delivered worldwide with tracking.</Lead>
        <ul className="mt-7 flex md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 overflow-x-auto snap-x -mx-4 px-4 md:mx-0 md:px-0 pb-1" data-testid="3pl-strip">
          {([[M.s1, 'Received and stored', 'We count your bulk order and shelve it by SKU.'], [M.s2, 'Picked, scanned, packed', 'Every order is scanned, so your stock count stays live.'], [M.s3, 'Dispatched worldwide', 'Same or next working day, with tracking to the door.'], [M.s4, 'Returns checked', 'We inspect each return and restock it or report it to you.']] as [SiteImage, string, string][]).map(([im, t, b], i) => (
            <li key={t} className="shrink-0 w-[260px] md:w-auto snap-start">
              <Photo img={im} aspect="aspect-[4/3]" sizes="(min-width:1100px) 300px, 260px" />
              <div className="mt-3 flex gap-2.5"><span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-coral text-white text-[13px] font-bold shrink-0">{i + 1}</span><div><h3 className="text-[16px] font-bold">{t}</h3><p className="text-[14px] text-muted">{b}</p></div></div>
            </li>
          ))}
        </ul>
        <div className="mt-10 grid gap-5 lg:grid-cols-2 items-stretch">
          <div className="grid gap-3">
            <div className="card p-5">
              <div className="flex items-center justify-between gap-2"><div className="label-caps text-muted">Warehouse</div><span className="pill bg-ok-bg text-ok">Operating</span></div>
              <h3 className="mt-1 text-[19px] font-bold">China · Shenzhen</h3>
              <Ticks className="mt-3" items={['Receive and count your bulk order', 'Store by SKU, with live stock in your account', 'Pick and pack the same or next working day', 'Returns handled']} />
            </div>
            {second && <div className="card p-4 flex items-center justify-between gap-2"><div><div className="font-bold text-ink">{second.city}, {second.country}</div>{second.handles && <div className="text-[13.5px] text-muted">{second.handles}</div>}</div>{demo && <span className="pill bg-warn-bg text-warn">Example</span>}</div>}
          </div>
          <div className="rounded-[22px] bg-ink text-white p-5 sm:p-6 flex flex-col">
            <h3 className="!text-white text-[19px] font-bold">Worldwide shipping</h3>
            <ul className="mt-3 divide-y divide-white/10">
              {['Express', 'Standard', 'Economy'].map((s) => <li key={s} className="flex items-center justify-between py-2.5"><span className="font-semibold">{s}</span><span className="text-on-ink text-[14px]">Delivery days and rate in your quote</span></li>)}
            </ul>
            <p className="mt-3 text-[13.5px] text-on-ink">Tracking to the door · duties and customs paperwork handled{countries ? ` · ${countries} countries` : ''}</p>
            <div className="mt-auto pt-5 flex flex-col sm:flex-row gap-3"><Link href="/request/3pl" className="btn btn-primary min-h-[52px]">Get a 3PL quote <Arrow /></Link><Link href="/request/3pl#rates" className="btn btn-light min-h-[52px]">Check shipping to my country</Link></div>
          </div>
        </div>
      </Band>

      {/* Ready to order */}
      {ready.length > 0 && (
        <Band label="Ready to order">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="label-caps text-coral-text">Ready to order</div><H2 id="ready-h">Ready to order from verified factories</H2><p className="mt-2 text-[15.5px] text-muted">Products Octopus lists directly. Dropship them, put your brand on them or order in bulk.</p></div>
            <Link href="/products" className="inline-flex items-center gap-1 min-h-11 font-semibold text-coral-text">View all products <Arrow /></Link>
          </div>
          <ul className="mt-7 flex md:grid md:grid-cols-4 gap-4 overflow-x-auto snap-x -mx-4 px-4 md:mx-0 md:px-0 pb-1">
            {ready.map((p) => {
              const low = p.tiers.length ? Math.min(...p.tiers.map((t) => t.unit_price_cents)) : p.min_price_cents;
              return (
                <li key={p.id} className="shrink-0 w-[240px] md:w-auto snap-start">
                  <Link href={`/p/${p.slug}`} className="card block overflow-hidden h-full hover:border-coral-text">
                    <div className="relative aspect-square bg-fill">{p.image_url && <Image src={p.image_url} alt={p.title} fill sizes="(min-width:1100px) 300px, 240px" className="object-cover" unoptimized />}</div>
                    <div className="p-4">{p.supplier?.verified && <span className="pill bg-ok-bg text-ok">Verified by Octopus</span>}<div className="mt-2 font-bold text-ink line-clamp-2">{p.title}</div><div className="mt-1 text-[13.5px] text-muted">{p.moq.toLocaleString('en-US')}+ {p.unit} from <b className="text-ink">{low ? money(low, p.currency) : '—'}</b></div></div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Band>
      )}

      {/* How you pay */}
      <Band white label="How you pay">
        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <IllCard img={M.pay} chip="Your money waits in escrow until QC and shipping" chipTone="ok" className="hidden md:block" />
          <div>
            <div className="label-caps text-coral-text">Payment</div>
            <H2 id="pay-h">How you pay</H2>
            <Lead>One US dollar wallet for every service. Your money for an order is protected until the goods are on their way.</Lead>
            <ol className="mt-6 grid sm:grid-cols-2 gap-3">
              {[['Top up your wallet', 'By bank transfer; the details and your reference are in your wallet.'], ['Approve your quote', 'The price is confirmed before you pay.'], ['Money held in escrow', 'The money for your order stays in escrow, not with the factory.'], ['Released after QC and shipping', 'Paid out only when the goods pass QC and ship.']].map(([t, b], i) => (
                <li key={t} className="card p-4"><span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-coral text-white text-[13px] font-bold">{i + 1}</span><h3 className="mt-2 text-[16px] font-bold">{t}</h3><p className="text-[14px] text-muted">{b}</p></li>
              ))}
            </ol>
            <p className="mt-4 text-[14px] text-muted">No card payments.{legal ? ` Invoices from ${legal}.` : ''}</p>
          </div>
        </div>
      </Band>

      {/* Account manager */}
      <Band label="Your account manager">
        <div className="grid gap-10 lg:grid-cols-2 items-center">
          <div>
            <div className="label-caps text-coral-text">Your account manager</div>
            <H2 id="am-h">Your own account manager</H2>
            <Lead>One person at Octopus looks after all your services, so you never explain your business twice.</Lead>
            <Ticks className="mt-5" items={['Checks every quote before it reaches you', 'Approves changes within the limits you set', hours?.start && hours?.end ? `Office hours ${hours.start}–${hours.end}, Monday to Friday (China time)` : '']} />
            <Btns><Link href="/account/support" className="btn btn-primary min-h-[52px]">Message your manager</Link><Link href="/account/support?topic=call" className="btn btn-ghost min-h-[52px]">Book a call</Link></Btns>
          </div>
          <div className="relative">
            <Photo img={M.manager} />
            <Suspense fallback={<ManagerCard />}><ManagerCardLive /></Suspense>
          </div>
        </div>
      </Band>

      {/* Also on */}
      <Band white label="Also on Octopus B2B">
        <div className="label-caps text-coral-text">More services</div>
        <H2 id="also-h">Also on Octopus B2B</H2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[['Samples', 'Order a sample before you commit.', '/request/sample'], ['QC inspection', 'Photos and video of your goods before they ship.', '/request/qc'], ['Certification', 'CE, RoHS, SASO and more.', '/request/certification'], ['Wallet and escrow', 'One US dollar wallet. Order money waits in escrow until QC and shipping.', '/wallet'], ['Octo assistant', 'Answers 24/7, and a human when you need one.', '/assistant'], ['API and integrations', 'Connect your own systems to orders and stock.', '/developers']].map(([t, b, h]) => (
            <li key={t}><Link href={h} className="card p-5 flex gap-3 h-full hover:border-coral-text">
              {t === 'Octo assistant' && <span className="relative w-11 h-11 rounded-full bg-pearl overflow-hidden shrink-0"><Image src={M.face.src} alt="" width={M.face.width} height={M.face.height} sizes="44px" className="w-full h-full object-cover" /></span>}
              <span><span className="block font-bold text-ink">{t}</span><span className="block text-[14px] text-muted mt-0.5">{b}</span></span>
            </Link></li>
          ))}
          <li className="sm:col-span-2"><Link href="/suppliers#apply" className="rounded-[14px] bg-ink text-white hover:text-white p-5 flex flex-col h-full hover:bg-ink-2">
            <span className="font-bold text-[17px]">Sell on Octopus B2B</span><span className="text-on-ink text-[14px] mt-1">Are you a factory? Become a verified supplier and list your products.</span><span className="mt-2 inline-flex items-center min-h-11 font-semibold text-on-ink-link">Become a supplier <Arrow /></span>
          </Link></li>
        </ul>
      </Band>

      {/* FAQ */}
      <Band label="Questions">
        <div className="label-caps text-coral-text">FAQ</div>
        <H2 id="faq-h">Questions</H2>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr] items-start">
          <div className="card divide-y divide-line" data-testid="home-faq">
            {faq.map(([q, a]) => (
              <details key={q} className="group">
                <summary className="flex items-center justify-between gap-4 min-h-[54px] px-5 cursor-pointer list-none font-semibold text-[15.5px] text-ink [&::-webkit-details-marker]:hidden">{q}<span aria-hidden className="text-muted transition-transform group-open:rotate-180">⌄</span></summary>
                <p className="px-5 pb-4 -mt-1 text-[14.5px] text-black leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
          <aside className="hidden lg:block card overflow-hidden sticky top-32" aria-label="Still have a question?">
            <div className="relative aspect-[3/2]"><Image src={M.faq.src} alt={M.faq.alt} width={M.faq.width} height={M.faq.height} sizes="400px" className="absolute inset-0 w-full h-full object-cover" /></div>
            <div className="p-5">
              <h3 className="text-[18px] font-bold">Still have a question?</h3>
              <p className="mt-1 text-[14px] text-muted">Talk to a person in our Shenzhen office on WhatsApp, or ask the Octo assistant any time.</p>
              <a href={WA} target="_blank" rel="noopener noreferrer" className="btn btn-primary w-full mt-4">Chat on WhatsApp</a>
              <Link href="/assistant" className="mt-3 flex items-center gap-2 min-h-11 text-[14px] text-black"><span className="relative w-8 h-8 rounded-full bg-pearl overflow-hidden"><Image src={M.face.src} alt="" width={M.face.width} height={M.face.height} sizes="32px" className="w-full h-full object-cover" /></span>Or <b className="text-coral-text">ask Octo</b>, our assistant, any time</Link>
            </div>
          </aside>
        </div>
      </Band>

      {/* Final CTA */}
      <section className="bg-pearl" aria-labelledby="cta-h">
        <div className="wrap pb-10 md:pb-16">
          <div className="rounded-[22px] bg-ink text-white p-6 sm:p-8 grid gap-6 lg:grid-cols-[1fr_340px] items-center">
            <div>
              <h2 id="cta-h" className="!text-white text-[25px] md:text-[34px] font-extrabold">Tell us what you need.</h2>
              <p className="mt-2 text-on-ink text-[16px]">Create a free account, or message us on WhatsApp at +86 188 2652 7644.</p>
              <div className="mt-5 flex flex-col sm:flex-row gap-3"><Link href="/signup" className="btn btn-light min-h-[52px]">Create a free account</Link><a href={WA} target="_blank" rel="noopener noreferrer" className="btn min-h-[52px] border-white/40 text-white hover:bg-white/10 hover:text-white">Chat on WhatsApp</a></div>
            </div>
            <div className="hidden md:block relative aspect-[3/2] rounded-[16px] overflow-hidden bg-ill-bg"><Image src={M.cta.src} alt={M.cta.alt} width={M.cta.width} height={M.cta.height} sizes="340px" className="absolute inset-0 w-full h-full object-cover" /></div>
          </div>
        </div>
      </section>
    </>
  );
}

/** Floating manager card: the real manager only when signed in, generic for visitors (no staff names under photos). */
function ManagerCard({ name, office }: { name?: string | null; office?: string | null }) {
  const initials = name ? name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() : null;
  return (
    <FloatingCard corner="bottom-left" className="flex items-center gap-3 pr-5">
      <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-ink text-white font-bold text-[14px]">{initials ?? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" /></svg>}</span>
      <span><span className="block font-bold text-ink text-[14.5px]">{name ?? 'Your own account manager'}</span><span className="block text-[12.5px] text-muted">{name ? `Your account manager${office ? ` · ${office}` : ''}` : 'One contact for every service'}</span></span>
      <span className="pill bg-ok-bg text-ok ml-1">Your contact</span>
    </FloatingCard>
  );
}
async function ManagerCardLive() {
  const s = await getSession();
  if (!s?.org) return <ManagerCard />;
  const sb = await createClient();
  const { data } = await sb.rpc('my_account_team');
  const m = data as { name?: string | null; office?: string | null } | null;
  return <ManagerCard name={m?.name ?? null} office={m?.office ?? null} />;
}
