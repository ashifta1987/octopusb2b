import Link from 'next/link';
import { block } from '@/lib/content';
import { money, COUNTRY_NAMES } from '@/lib/format';
import type { CardProduct, PoolCard, PublicSupplier } from '@/components/store/data';
import { unitOne } from '@/components/store/product-card';
import { CATEGORY_PILL, CATEGORY_PILL_CLASS, TURNKEY_CATEGORIES, kUsd, type TurnkeyPackage, type TurnkeyProject } from '@/lib/turnkey/format';
import { TkImage } from '@/components/store/turnkey/ui';
import { copy } from './shared';
import { TimeLeft } from './time-left';

/**
 * Storefront home, Nov 2026 design (Home-desktop-full.png): five numbered services — 1 Product sourcing (hero + quote form),
 * 2 Dropshipping, 3 MOQ pools, 4 3PL warehousing, 5 Turnkey Projects — with "how it works" steps, ready-to-order products,
 * open pools, the global shipping band, platform stats, the other services, verified suppliers and the closing CTA.
 * All copy is CMS-overridable (content_blocks `home2.*`, pipe-separated lists). Only REAL data is rendered: products, pools,
 * suppliers, turnkey projects and figures come from the database / verified settings; a block without data is hidden.
 */
type Blocks = Record<string, string>;
const W = 'max-w-[1280px] mx-auto px-4 sm:px-8';
const Arrow = () => <span aria-hidden>→</span>;

/* ───────── small pieces ───────── */
export function Eyebrow({ n, children, badge }: { n?: number; children: React.ReactNode; badge?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {n != null && <span className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] bg-navy text-white text-[13px] font-bold">{n}</span>}
      <span className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-blue">{children}</span>
      {badge && <span className="mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#F59E0B] text-[#3B2500]">{badge}</span>}
    </div>
  );
}
function Check({ className = 'text-[#16A34A] bg-[#DCFCE7]' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full shrink-0 ${className}`} aria-hidden>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="m5 12 5 5 9-10" /></svg>
    </span>
  );
}
function Ticks({ items }: { items: string[] }) {
  return <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] text-[#4B5565]">{items.filter(Boolean).map((t) => <li key={t}>✓ {t}</li>)}</ul>;
}
/** "**Bold part** rest" → bold lead-in + normal text */
function Lead({ text }: { text: string }) {
  const m = /^\*\*(.+?)\*\*(.*)$/.exec(text);
  return m ? <><b className="font-semibold text-navy">{m[1]}</b>{m[2]}</> : <>{text}</>;
}
function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-3">
      {items.filter(Boolean).map((t, i) => (
        <li key={t} className="flex items-center gap-3 text-[15.5px] text-[#3B4556]">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] bg-navy text-white text-[13px] font-bold shrink-0">{i + 1}</span>
          <span><Lead text={t} /></span>
        </li>
      ))}
    </ol>
  );
}
function SectionTitle({ id, eyebrow, title, body, href, link }: { id: string; eyebrow: string; title: string; body?: string; href?: string; link?: string }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-4 mb-7">
      <div className="max-w-[640px]">
        <div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-blue">{eyebrow}</div>
        <h2 id={id} className="text-[28px] sm:text-[34px] font-extrabold leading-[1.12] tracking-[-0.02em] mt-2">{title}</h2>
        {body && <p className="text-[16.5px] text-[#3B4556] mt-3 leading-relaxed">{body}</p>}
      </div>
      {href && link && <Link href={href} className="font-semibold text-blue text-[15px]">{link} <Arrow /></Link>}
    </div>
  );
}
function StepCards({ steps }: { steps: string[][] }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([t, b], i) => (
        <li key={t} className="card rounded-[14px] p-5 sm:p-6">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] bg-blue-fill text-white text-[13px] font-bold">{i + 1}</span>
          <h3 className="text-[17px] font-semibold mt-4">{t}</h3>
          <p className="text-[14.5px] text-[#5B6575] mt-2 leading-relaxed">{b}</p>
        </li>
      ))}
    </ol>
  );
}
function Illustration({ src, alt, w, h, className = '' }: { src: string; alt: string; w: number; h: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" className={`w-full h-auto ${className}`} />;
}
const steps = (blocks: Blocks, key: string, fallback: string[]) => fallback.map((f, i) => copy(blocks, `${key}.${i + 1}`, f));

/* ───────── 1 · Product sourcing (hero) ───────── */
export function SourcingHero({ blocks, defaultCountry, fee }: { blocks: Blocks; defaultCountry: string; fee: { cents: number; currency: string } | null }) {
  const countries = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <section id="sourcing" aria-labelledby="home-hero-h" className="bg-gradient-to-b from-white to-[#F3F6FB] border-b border-line">
      <div className={`${W} py-12 lg:py-16 grid gap-10 lg:grid-cols-[1.05fr_1fr] items-center`}>
        <div className="min-w-0">
          <Eyebrow n={1}>{block(blocks, 'home2.sourcing.eyebrow', 'Product sourcing from China')}</Eyebrow>
          <h1 id="home-hero-h" className="mt-4 text-[38px] sm:text-[52px] font-extrabold leading-[1.04] tracking-[-0.03em]">
            {block(blocks, 'home2.sourcing.title', 'Tell us the product.')} <span className="text-blue">{block(blocks, 'home2.sourcing.title_em', 'We find the factory.')}</span>
          </h1>
          <p className="mt-5 text-[17px] text-[#3B4556] leading-relaxed max-w-[600px]">
            {block(blocks, 'home2.sourcing.body', 'Our sourcing team in four China hubs matches you with verified factories, gets you competing quotes within 24 hours, inspects the goods and ships them to your door in 220+ countries. One contract, one invoice, paid through escrow.')}
          </p>
          <div className="mt-6"><NumberedList items={copy(blocks, 'home2.sourcing.steps', '**Send one request**: product, quantity, destination|**Compare quotes** from matched, verified suppliers|**We inspect and ship**; you pay from escrow on approval')} /></div>
          <div className="mt-5"><Ticks items={copy(blocks, 'home2.sourcing.ticks', 'Verified factories only|QC photos before shipping|Samples on request')} /></div>
        </div>
        <div className="relative min-w-0">
          <div className="rounded-[18px] overflow-hidden border border-[#D6E2F5] bg-[#C9D1DF]">
            <Illustration src="/home/sourcing.png" alt="" w={574} h={303} />
            <div className="h-14" aria-hidden />
          </div>
          <form action="/request/sourcing" method="get" className="relative -mt-[76px] mx-4 sm:mx-5 bg-white rounded-[14px] border border-line shadow-[0_12px_32px_rgba(20,26,56,.12)] p-5" aria-labelledby="home-quote-h">
            <div className="flex items-center justify-between">
              <h2 id="home-quote-h" className="text-[17px] font-semibold">{block(blocks, 'home2.quote.title', 'Get quotes in 24 h')}</h2>
              {/* ADDON-36 (H1): the real RFQ fee from the fee settings — "Free" only when it is 0 */}
              {fee && fee.cents > 0
                ? <span className="text-[12.5px] font-semibold text-[#3B4556]" data-testid="quote-fee">RFQ fee {money(fee.cents, fee.currency)}</span>
                : <span className="mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D]" data-testid="quote-fee">Free</span>}
            </div>
            <label className="sr-only" htmlFor="hq-title">Product</label>
            <input id="hq-title" name="title" required maxLength={200} className="input mt-3" placeholder={block(blocks, 'home2.quote.placeholder', 'Product, e.g. handheld fan 4000mAh')} />
            <div className="grid grid-cols-2 gap-2.5 mt-2.5">
              <label className="sr-only" htmlFor="hq-qty">Quantity</label>
              <input id="hq-qty" name="qty" inputMode="numeric" pattern="[0-9]*" className="input" placeholder="Quantity" />
              <label className="sr-only" htmlFor="hq-country">Destination country</label>
              <select id="hq-country" name="country" defaultValue={defaultCountry} className="input">
                {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary w-full mt-3 min-h-[48px] text-[16px]">{block(blocks, 'home2.quote.button', 'Request quotes')} <Arrow /></button>
            <p className="text-center text-[13px] text-[#5B6575] mt-3">Or <Link href="/products" className="font-semibold text-blue">browse ready-to-order products</Link></p>
          </form>
        </div>
      </div>
    </section>
  );
}

/* ───────── service cards row ───────── */
export function ServiceCards({ blocks, poolsOn, turnkeyOn }: { blocks: Blocks; poolsOn: boolean; turnkeyOn: boolean }) {
  const cards = [
    { k: 'sourcing', href: '/request/sourcing', f: 'Product sourcing|One request, quotes from verified factories in 24 h.|Request quotes' },
    { k: 'dropshipping', href: '/#dropshipping', f: 'Dropshipping|Sell without stock. We ship each order to your customer.|Start' },
    ...(poolsOn ? [{ k: 'pools', href: '/pools', f: 'MOQ pools|Share a factory minimum and pay the bulk price.|Join a pool' }] : []),
    { k: 'warehousing', href: '/#warehousing', f: '3PL warehousing|Stock near your buyers. We store, pick, pack and ship.|See 3PL' },
    ...(turnkeyOn ? [{ k: 'turnkey', href: '/turnkey', f: 'Turnkey Projects|A complete business in one container.|Explore', isNew: true }] : []),
  ];
  return (
    <section aria-label="Our services" className="bg-white border-b border-line">
      <ul className={`${W} py-7 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`}>
        {cards.map((c, i) => {
          const [t, b, cta] = copy(blocks, `home2.card.${c.k}`, c.f);
          const first = i === 0;
          return (
            <li key={c.k}>
              <Link href={c.href} className={`group h-full rounded-[14px] p-5 flex flex-col gap-1.5 border ${first ? 'bg-navy border-navy text-white hover:text-white' : 'bg-white border-line hover:border-blue'}`}>
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-[13px] font-bold ${first ? 'bg-blue-fill text-white' : 'bg-navy text-white'}`}>{i + 1}</span>
                <span className={`mt-2 text-[17px] font-semibold flex items-center gap-2 ${first ? 'text-white' : 'text-navy'}`}>{t}{'isNew' in c && c.isNew && <span className="mono text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-[#F59E0B] text-[#3B2500]">New</span>}</span>
                <span className={`text-[14px] leading-snug ${first ? 'text-[#C9D0E8]' : 'text-[#5B6575]'}`}>{b}</span>
                <span className={`mt-auto pt-1 text-[14px] font-semibold ${first ? 'text-[#8FB6FF]' : 'text-blue'}`}>{cta} <Arrow /></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ───────── how sourcing works + ready to order ───────── */
export function SourcingSteps({ blocks, products }: { blocks: Blocks; products: CardProduct[] }) {
  return (
    <section aria-labelledby="home-how-sourcing-h" className="bg-surface border-b border-line">
      <div className={`${W} py-14`}>
        <SectionTitle id="home-how-sourcing-h" eyebrow={block(blocks, 'home2.how_sourcing.eyebrow', 'Product sourcing')} title={block(blocks, 'home2.how_sourcing.title', 'How sourcing works')}
          body={block(blocks, 'home2.how_sourcing.body', 'From request to delivered goods, with one Octopus contact the whole way.')} href="/request/sourcing" link={block(blocks, 'home2.how_sourcing.link', 'Start a sourcing request')} />
        <StepCards steps={steps(blocks, 'home2.how_sourcing.step', [
          'Request|Describe the product, target price, quantity and destination. Add photos or a link.',
          'Matched quotes|We contact verified factories in the right hub and send you comparable quotes within 24 hours.',
          'Sample and order|Approve a sample if you want one. Your payment is held in escrow until the goods pass QC.',
          'Inspect and deliver|Pre-shipment inspection with photos and video, then door delivery with customs paperwork.',
        ])} />
        {products.length > 0 && (
          <div className="mt-14" data-testid="home-ready">
            <SectionTitle id="home-ready-h" eyebrow={block(blocks, 'home2.ready.eyebrow', 'Already sourced')} title={block(blocks, 'home2.ready.title', 'Ready to order from verified factories')} href="/products" link={block(blocks, 'home2.ready.link', 'View all products')} />
            <ul className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">{products.map((p) => <li key={p.id}><ReadyCard p={p} /></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

function ReadyCard({ p }: { p: CardProduct }) {
  const tag = p.octopus_dropship ? 'Dropship' : p.ready_to_ship ? '3PL stock' : p.tiers.length > 1 ? 'Bulk tier' : null;
  const price = p.tiers.length ? Math.min(...p.tiers.map((t) => t.unit_price_cents)) : p.min_price_cents;
  return (
    <Link href={`/p/${p.slug}`} className="group card rounded-[14px] overflow-hidden flex flex-col h-full hover:border-blue">
      {p.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.image_url} alt={p.title} width={400} height={400} loading="lazy" decoding="async" className="aspect-square w-full object-cover bg-surface" />
        : <div className="aspect-square bg-surface" aria-hidden />}
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center justify-between gap-2">
          {tag ? <span className="mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#E6EFFC] text-[#1E4F9C]">{tag}</span> : <span />}
          {p.supplier?.country && <span className="mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface border border-line text-[#4B5565]">{p.supplier.country}</span>}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug line-clamp-2 group-hover:text-blue">{p.title}</h3>
        {price != null && <div className="text-[13px] text-[#5B6575]"><span className="mono text-[10.5px] uppercase">From</span> <b className="text-[17px] text-navy font-bold">{money(price, p.currency)}</b> / {unitOne(p.unit)}</div>}
        <div className="mono text-[10.5px] uppercase tracking-[.04em] text-[#5B6575] mt-auto">MOQ {p.moq.toLocaleString('en-US')} {p.unit}{p.supplier ? ` · Supplier ${p.supplier.code}` : ''}</div>
      </div>
    </Link>
  );
}

/* ───────── 2 · Dropshipping ───────── */
export function Dropshipping({ blocks, countries }: { blocks: Blocks; countries?: string }) {
  const where = countries ? `${countries} countries` : 'countries worldwide';
  return (
    <>
      <section id="dropshipping" aria-labelledby="home-drop-h" className="bg-white">
        <div className={`${W} py-14 lg:py-16 grid gap-10 lg:grid-cols-[1fr_1.05fr] items-center`}>
          <div className="min-w-0">
            <Eyebrow n={2}>{block(blocks, 'home2.drop.eyebrow', 'Dropshipping from China')}</Eyebrow>
            <h2 id="home-drop-h" className="mt-3 text-[32px] sm:text-[40px] font-extrabold leading-[1.08] tracking-[-0.02em]">
              {block(blocks, 'home2.drop.title_a', 'You sell.')} <span className="text-blue">{block(blocks, 'home2.drop.title_em', 'We ship')}</span> {block(blocks, 'home2.drop.title_b', 'to your customer.')}
            </h2>
            <p className="mt-4 text-[17px] text-[#3B4556] leading-relaxed">
              {block(blocks, 'home2.drop.body', `List any product from our verified factories in your shop. When your customer orders, we pack it in China under your brand and deliver it to their door in ${where}. You never hold stock.`)}
            </p>
            <div className="mt-6"><NumberedList items={copy(blocks, 'home2.drop.steps', '**Pick products** and set your own selling price|**Your customer orders** in your shop, and the order lands here|**We pack and ship** with your slip and tracking')} /></div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/request/dropship" className="btn btn-primary min-h-[50px] px-6">{block(blocks, 'home2.drop.cta', 'Start dropshipping')} <Arrow /></Link>
              <a href="#how-dropshipping" className="btn btn-ghost min-h-[50px] px-6">{block(blocks, 'home2.drop.cta2', 'How it works')}</a>
            </div>
            <div className="mt-5"><Ticks items={copy(blocks, 'home2.drop.ticks', 'No stock, no minimum|Your brand on the parcel|Tracking to the door')} /></div>
          </div>
          <Illustration src="/home/dropshipping.png" alt={block(blocks, 'home2.drop.alt', 'A parcel packed under your brand travels from the factory to your customer’s door')} w={630} h={390} />
        </div>
      </section>
      <section id="how-dropshipping" aria-labelledby="home-how-drop-h" className="bg-surface border-y border-line">
        <div className={`${W} py-14`}>
          <SectionTitle id="home-how-drop-h" eyebrow={block(blocks, 'home2.how_drop.eyebrow', 'Dropshipping')} title={block(blocks, 'home2.how_drop.title', 'How dropshipping works')}
            body={block(blocks, 'home2.how_drop.body', 'Four steps from first listing to a delivered parcel. You see the full cost before you confirm each order.')} href="/request/dropship" link={block(blocks, 'home2.how_drop.link', 'Open a dropship account')} />
          <StepCards steps={steps(blocks, 'home2.how_drop.step', [
            'Choose products|Pick from verified factories. Order a sample first if you want to check quality.',
            'Connect your shop|Shopify, WooCommerce or our API send orders here automatically. You can also upload a sheet.',
            'Pay per order|Product, shipping and fulfilment fee come out of your wallet. You keep the difference from your price.',
            'We pack and deliver|QC check, your packing slip and labels, then tracked delivery. Our prices never appear on the parcel.',
          ])} />
        </div>
      </section>
    </>
  );
}

/* ───────── 3 · MOQ pools ───────── */
export function Pools({ blocks, pools, depositPct }: { blocks: Blocks; pools: PoolCard[]; depositPct: number }) {
  const s = steps(blocks, 'home2.pools.step', [`Join with a ${depositPct} % deposit`, 'Pool fills to the MOQ', 'Pay the balance into escrow', 'Your share ships to you']).map((x) => x[0]);
  return (
    <section id="pools" aria-labelledby="home-pools-h" className="bg-white">
      <div className={`${W} py-14 lg:py-16`}>
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr] items-center">
          <div className="min-w-0">
            <Eyebrow n={3}>{block(blocks, 'home2.pools.eyebrow', 'MOQ pools · Group buying')}</Eyebrow>
            <h2 id="home-pools-h" className="mt-3 text-[32px] sm:text-[38px] font-extrabold leading-[1.08] tracking-[-0.02em]">{block(blocks, 'home2.pools.title', 'Factory minimum too big? Share it.')}</h2>
            <p className="mt-4 text-[17px] text-[#3B4556] leading-relaxed">{block(blocks, 'home2.pools.body', "Join other buyers on the same product until the pool reaches the factory's minimum order. Everyone pays the bulk price, and each buyer's share ships separately.")}</p>
            <ol className="mt-7 pt-5 border-t-2 border-[#D6E2F5] grid grid-cols-2 sm:grid-cols-4 gap-4">
              {s.map((t, i) => <li key={t}><div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-blue">Step {i + 1}</div><div className="text-[15px] font-semibold mt-1.5 leading-snug">{t}</div></li>)}
            </ol>
            <p className="mt-5 text-[14px] text-[#5B6575]">{block(blocks, 'home2.pools.note', "If a pool doesn't fill before it closes, your deposit goes back to your wallet.")}</p>
          </div>
          <Illustration src="/home/pools.png" alt={block(blocks, 'home2.pools.alt', 'Three buyers sharing one factory pallet')} w={571} h={356} />
        </div>
        {pools.length > 0 && (
          <div className="mt-12" data-testid="home-open-pools">
            <div className="flex flex-wrap justify-between items-end gap-4 mb-4">
              <h3 className="text-[22px] font-semibold">{block(blocks, 'home2.pools.open', 'Open pools')}</h3>
              <Link href="/pools" className="font-semibold text-blue text-[15px]">{block(blocks, 'home2.pools.link', 'See all open pools')} <Arrow /></Link>
            </div>
            <ul className="grid gap-4 md:grid-cols-3">{pools.map((p) => <li key={p.id}><MiniPool p={p} /></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

function MiniPool({ p }: { p: PoolCard }) {
  const pct = p.target_qty ? Math.min(100, Math.round((p.filled_qty / p.target_qty) * 100)) : 0;
  const price = p.pool_price_minor ?? p.base_price_minor;
  return (
    <Link href={`/pool/${p.code}`} className="card rounded-[14px] p-4 block hover:border-blue">
      <div className="text-[15.5px] font-semibold line-clamp-1">{p.product.title}</div>
      <div className="flex justify-between items-baseline mt-2 text-[12.5px]">
        <span className="mono uppercase tracking-[.06em] text-[#5B6575]"><TimeLeft deadline={p.deadline_at} /></span>
        <span className="text-[#3B4556]">{pct} % filled</span>
      </div>
      <div className="h-1.5 rounded-full bg-line mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Filled">
        <div className="h-full rounded-full bg-gradient-to-r from-blue to-[#5B9BFF]" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between items-center mt-3">
        {price != null ? <b className="text-[15px]">{money(price, p.currency)} / {unitOne(p.product.unit)}</b> : <span />}
        {p.saving_pct > 0 && <span className="mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D]">Save {p.saving_pct} %</span>}
      </div>
    </Link>
  );
}

/* ───────── 4 · 3PL warehousing ───────── */
export function Warehousing({ blocks }: { blocks: Blocks }) {
  return (
    <section id="warehousing" aria-labelledby="home-3pl-h" className="bg-surface border-t border-line">
      <div className={`${W} py-14 lg:py-16 grid gap-10 lg:grid-cols-[1fr_1fr] items-center`}>
        <Illustration src="/home/warehousing.png" alt={block(blocks, 'home2.3pl.alt', 'Warehouse shelves with stock stored by SKU')} w={585} h={365} className="order-2 lg:order-1" />
        <div className="min-w-0 order-1 lg:order-2">
          <Eyebrow n={4}>{block(blocks, 'home2.3pl.eyebrow', '3PL warehousing')}</Eyebrow>
          <h2 id="home-3pl-h" className="mt-3 text-[32px] sm:text-[38px] font-extrabold leading-[1.08] tracking-[-0.02em]">{block(blocks, 'home2.3pl.title', 'Your stock, stored near your buyers')}</h2>
          <p className="mt-4 text-[17px] text-[#3B4556] leading-relaxed">{block(blocks, 'home2.3pl.body', 'Ship your bulk order into our network once. We receive it, store it by SKU and send out each order as it comes in, so your buyers get delivery in days, not weeks.')}</p>
          <ul className="mt-6 space-y-2.5">
            {copy(blocks, 'home2.3pl.list', '**Receive and inspect**: counted and checked against your order on arrival|**Store by SKU**: live stock levels in your account|**Pick, pack and ship**: the same or next working day|**Returns handled**: restocked or reported, your choice').map((t) => (
              <li key={t} className="flex items-start gap-3 text-[15.5px] text-[#3B4556]"><span className="mt-[3px]"><Check /></span><span><Lead text={t} /></span></li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/request/3pl" className="btn btn-dark min-h-[50px] px-6">{block(blocks, 'home2.3pl.cta', 'Get a 3PL quote')} <Arrow /></Link>
            <a href="#global-shipping" className="btn btn-ghost min-h-[50px] px-6">{block(blocks, 'home2.3pl.cta2', 'Shipping coverage')}</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── global shipping band ───────── */
export type ShippingStats = { countries?: string; hubs?: string; parcels_daily?: string; service_lines?: string };
export function ShippingBand({ blocks, stats }: { blocks: Blocks; stats: ShippingStats }) {
  const labels = copy(blocks, 'home2.ship.labels', 'Countries|Hubs|Parcels / day|Service lines');
  const tiles = [stats.countries, stats.hubs, stats.parcels_daily, stats.service_lines].map((v, i) => ({ v, l: labels[i] })).filter((t) => t.v);
  return (
    <section id="global-shipping" aria-labelledby="home-ship-h" className="bg-navy text-white">
      <div className={`${W} py-12 grid gap-8 lg:grid-cols-[1fr_auto] items-center`}>
        <div>
          <span className="mono text-[11px] font-semibold uppercase tracking-[.08em] px-3 py-1 rounded-full border border-white/25 text-[#C9D0E8]">{block(blocks, 'home2.ship.eyebrow', 'Global shipping · YunExpress network')}</span>
          <h2 id="home-ship-h" className="!text-white mt-4 text-[26px] sm:text-[32px] font-extrabold leading-[1.15]">
            {stats.countries
              ? <>Delivered to <span className="text-[#5B9BFF]">{stats.countries} countries</span>, with customs paperwork done for you.</>
              : <>{block(blocks, 'home2.ship.title', 'Delivered worldwide, with customs paperwork done for you.')}</>}
          </h2>
        </div>
        {tiles.length > 0 && (
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {tiles.map((t) => (
              <li key={t.l} className="rounded-[12px] border border-white/15 bg-white/[.06] px-4 py-3.5 min-w-[140px]">
                <div className="text-[24px] font-bold">{t.v}</div>
                <div className="mono text-[10.5px] uppercase tracking-[.08em] text-[#A9B2D0] mt-1">{t.l}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ───────── 5 · Turnkey Projects ───────── */
export function Turnkey({ blocks, projects, packages }: { blocks: Blocks; projects: TurnkeyProject[]; packages: TurnkeyPackage[] }) {
  if (!projects.length) return null;
  const five = [...projects].sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || Number(b.is_starter_pick) - Number(a.is_starter_pick) || (a.starter_rank ?? 99) - (b.starter_rank ?? 99) || a.sort_rank - b.sort_rank).slice(0, 5);
  const pk = (id: string) => packages.filter((k) => k.project_id === id);
  const from = (p: TurnkeyProject) => { const v = pk(p.project_id).map((k) => k.starting_budget_usd).filter((x): x is number => x != null); return v.length ? Math.min(...v) : p.starting_budget_usd; };
  const payback = (p: TurnkeyProject) => { const k = pk(p.project_id).filter((x) => x.payback_months_low != null); if (!k.length) return null; const lo = Math.min(...k.map((x) => x.payback_months_low!)); const hi = Math.max(...k.map((x) => x.payback_months_high ?? x.payback_months_low!)); return lo === hi ? `payback ${lo} mo` : `payback ${lo}–${hi} mo`; };
  const counts = TURNKEY_CATEGORIES.map((c) => ({ c, n: projects.filter((p) => p.category === c).length })).filter((x) => x.n);
  const cols: [string, string, string][] = [
    ['get', 'What you get', 'A full equipment list sized to your space|A floor plan and layout check by our team|Factories picked from the right China hubs|Pre-shipment QC with photos and video|One consolidated container, door delivery|Optional on-site install and staff training'],
    ['how', 'How it works', 'Choose a business and size: Starter, Standard or Pro, with the price shown up front|Get your quote in 24 h: Adjusted for your country, power supply and space|We source, inspect and pack: Milestone payments held in escrow|Delivered and installed: Typically 45 to 90 days, with 12 months of support'],
    ['who', "Who it's for", 'First-time owners who want a proven setup|Investors opening several sites in one region|Franchise and hotel groups fitting out rooms|Distributors adding a new product line'],
  ];
  return (
    <section id="turnkey" aria-labelledby="home-tk-h" className="bg-white" data-testid="home-turnkey">
      <div className={`${W} py-14 lg:py-16`}>
        <Eyebrow n={5} badge="New">{block(blocks, 'home2.tk.eyebrow', 'Turnkey Projects')}</Eyebrow>
        <h2 id="home-tk-h" className="mt-3 text-[32px] sm:text-[38px] font-extrabold leading-[1.1] tracking-[-0.02em] max-w-[720px]">{block(blocks, 'home2.tk.title', 'Open a complete business, delivered in one container')}</h2>
        <p className="mt-4 text-[17px] text-[#3B4556] leading-relaxed max-w-[780px]">{block(blocks, 'home2.tk.body', 'A Turnkey Project is everything you need to open a specific business, such as a gym, a laundromat or a water-bottling plant, bought as one package. We source each item from the Chinese cities that specialise in it, inspect it, and ship it together in one container to your door. You get one price, one shipment and one team to talk to.')}</p>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {cols.map(([k, t, f], ci) => {
            const items = copy(blocks, `home2.tk.${k}`, f);
            return (
              <div key={k} className={`rounded-[14px] border p-6 ${ci === 0 ? 'bg-[#F5F9FF] border-[#D6E2F5]' : 'bg-white border-line'}`}>
                <div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-blue">{block(blocks, `home2.tk.${k}.title`, t)}</div>
                {k === 'how' ? (
                  <ol className="mt-4 space-y-3.5">
                    {items.map((x, i) => { const [a, ...rest] = x.split(': '); return (
                      <li key={x} className="flex gap-3"><span className="inline-flex items-center justify-center w-7 h-7 rounded-[7px] bg-navy text-white text-[13px] font-bold shrink-0">{i + 1}</span>
                        <span><b className="block text-[15.5px] font-semibold">{a}</b>{rest.length > 0 && <span className="block text-[13.5px] text-[#5B6575] leading-snug">{rest.join(': ')}</span>}</span></li>); })}
                  </ol>
                ) : (
                  <ul className="mt-4 space-y-2.5">{items.map((x) => <li key={x} className="flex items-start gap-3 text-[15.5px] text-[#3B4556]"><span className="mt-[3px]"><Check /></span>{x}</li>)}</ul>
                )}
                {k === 'who' && <p className="mt-5 pt-4 border-t border-line text-[13.5px] text-[#5B6575]">{block(blocks, 'home2.tk.note', 'Prices are equipment estimates, FOB China. Rent, civil works and local licences are not included.')}</p>}
              </div>
            );
          })}
        </div>
        <div className="mt-12 flex flex-wrap justify-between items-end gap-4 mb-4">
          <div>
            <h3 className="text-[22px] font-semibold">{block(blocks, 'home2.tk.five', `Start with these ${five.length === 5 ? 'five' : five.length}`)}</h3>
            <p className="text-[14.5px] text-[#5B6575] mt-1">{block(blocks, 'home2.tk.five_sub', 'The most requested projects, with live pricing')}</p>
          </div>
          <Link href="/turnkey/atlas" className="font-semibold text-blue text-[15px]">See all {projects.length} businesses <Arrow /></Link>
        </div>
        <ul className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {five.map((p) => { const f = from(p); const pb = payback(p); return (
            <li key={p.project_id}>
              <Link href={`/turnkey/${p.project_id}`} className="group card rounded-[14px] overflow-hidden flex flex-col h-full hover:border-blue" data-testid="home-turnkey-card">
                <TkImage p={p} label={p.title} className="h-[140px]" />
                <div className="p-4 flex flex-col gap-1.5 flex-1">
                  {p.status === 'live'
                    ? <span className="self-start mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D]">Live</span>
                    : <span className="self-start mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#E6EFFC] text-[#1E4F9C]">Register interest</span>}
                  <h4 className="text-[16px] font-semibold leading-snug group-hover:text-blue">{p.title}</h4>
                  {p.short_reason && <p className="text-[13.5px] text-[#5B6575] leading-snug line-clamp-2">{p.short_reason}</p>}
                  <div className="mt-auto pt-2 border-t border-line">
                    {f != null && <div className="text-[13px] text-[#5B6575]"><span className="mono text-[10.5px] uppercase">From</span> <b className="text-[17px] text-navy font-bold">{kUsd(f)}</b></div>}
                    {pb && <div className="text-[13px] text-[#5B6575]">{pb}</div>}
                  </div>
                </div>
              </Link>
            </li>); })}
        </ul>
        {counts.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="mono text-[11px] uppercase tracking-[.08em] text-[#5B6575] mr-1">Browse by type</span>
            {counts.map(({ c, n }) => <Link key={c} href={`/turnkey/atlas?category=${c}`} className={`mono text-[10.5px] font-bold uppercase px-2.5 py-1 rounded-full ${CATEGORY_PILL_CLASS[c]}`}>{CATEGORY_PILL[c]} · {n}</Link>)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────── stats + other services ───────── */
export function StatsAndServices({ blocks, tiles }: { blocks: Blocks; tiles: { label: string; value: string | null }[] }) {
  const shown = tiles.filter((t) => t.value);
  const svc = [
    ['sample', '/request/sample', 'Samples|Order a sample before you commit to a bulk order.'],
    ['qc', '/request/qc', 'QC inspection|Photos and video before anything ships.'],
    ['cert', '/request/certification', 'Certification|CE, RoHS, SASO and more, arranged for you.'],
    ['wallet', '/wallet', 'Wallet and escrow|Pay safely, release on delivery.'],
    ['octo', '/assistant', 'Octo assistant|24/7 answers, a human when it matters.'],
    ['api', '/developers', 'API and integrations|Connect your shop or ERP.'],
  ] as const;
  return (
    <section aria-labelledby="home-also-h" className="bg-surface border-y border-line">
      <div className={`${W} py-12`}>
        {shown.length > 0 && (
          <ul className="grid grid-cols-2 lg:grid-cols-4 rounded-[14px] border border-line bg-white overflow-hidden mb-10" data-testid="home-stats">
            {shown.map((t, i) => (
              <li key={t.label} className={`px-5 py-5 ${i ? 'border-l border-line' : ''}`}>
                <div className="text-[24px] font-bold">{t.value}</div>
                <div className="mono text-[10.5px] uppercase tracking-[.08em] text-[#5B6575] mt-1">{t.label}</div>
              </li>
            ))}
          </ul>
        )}
        <h2 id="home-also-h" className="text-[22px] font-semibold mb-4">{block(blocks, 'home2.also.title', 'Also on Octopus B2B')}</h2>
        <ul className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {svc.map(([k, href, f]) => { const [t, b] = copy(blocks, `home2.also.${k}`, f); return (
            <li key={k}><Link href={href} className="card rounded-[14px] p-5 block h-full hover:border-blue"><div className="text-[16px] font-semibold">{t}</div><p className="text-[13.5px] text-[#5B6575] mt-1.5 leading-snug">{b}</p></Link></li>); })}
        </ul>
      </div>
    </section>
  );
}

/* ───────── verified suppliers ───────── */
export function Suppliers({ blocks, suppliers, categories, sponsored }: { blocks: Blocks; suppliers: PublicSupplier[]; categories: Record<string, string[]>; sponsored?: React.ReactNode }) {
  if (!suppliers.length) return null;
  return (
    <section aria-labelledby="home-suppliers-h" className="bg-white">
      <div className={`${W} py-14`}>
        <SectionTitle id="home-suppliers-h" eyebrow={block(blocks, 'home2.suppliers.eyebrow', 'Trust')} title={block(blocks, 'home.suppliers.title', 'Verified suppliers')} href="/suppliers" link={block(blocks, 'home.suppliers.link', 'Become a supplier')} />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {suppliers.map((s) => (
            <li key={s.id} className="card rounded-[14px] p-4">
              <div className="flex items-center justify-between">
                {s.country && <span className="mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface border border-line text-[#4B5565]">{s.country}</span>}
                {s.verified && <span className="mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D]">Verified</span>}
              </div>
              <div className="text-[16px] font-semibold mt-2.5">Supplier {s.code}</div>
              {s.country && <div className="text-[14px] text-[#5B6575]">{COUNTRY_NAMES[s.country] ?? s.country}</div>}
              <div className="mono text-[10.5px] uppercase tracking-[.04em] text-[#5B6575] mt-1.5">{[s.supplier_type, ...(categories[s.id] ?? []).slice(0, 2)].filter(Boolean).join(' · ')}</div>
            </li>
          ))}
          {sponsored && <li>{sponsored}</li>}
        </ul>
      </div>
    </section>
  );
}
