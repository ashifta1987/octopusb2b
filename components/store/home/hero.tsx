import Link from 'next/link';
import { money } from '@/lib/format';
import type { CardProduct, PoolCard } from '@/components/store/data';
import { ProductImage, unitOne } from '@/components/store/product-card';
import { ProgressBar } from '@/components/store/pools/pool-card';
import { Countdown } from '@/components/store/pools/countdown';
import { block } from '@/lib/content';
import { copy, n } from './shared';
import type { LiveRfq } from './live-data';
import { COUNTRY_NAMES } from '@/lib/format';

type Blocks = Record<string, string>;

function Check() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#157A44" strokeWidth="2.5" aria-hidden><path d="m5 12 5 5 9-10" /></svg>;
}

/** "{products} products" → <strong>2,400+</strong> products. Items whose stat is missing are dropped. */
function TrustItem({ template, stats }: { template: string; stats: Record<string, string> }) {
  const segs = template.split(/(\{\w+\})/g).filter(Boolean);
  return (
    <li className="inline-flex items-center gap-1.5 text-[13px] text-[#3B4556]">
      <Check />
      <span>
        {segs.map((s, i) => {
          const m = /^\{(\w+)\}$/.exec(s);
          if (m) return <strong key={i} className="mono font-semibold text-navy">{stats[m[1]]}</strong>;
          // "1 markets" → "1 market" when the preceding figure is exactly 1
          const prev = /^\{(\w+)\}$/.exec(segs[i - 1] ?? '');
          const text = prev && stats[prev[1]] === '1' ? s.replace(/\b(product|supplier|market|countr)(ies|s)\b/, (_x, a: string) => (a === 'countr' ? 'country' : a)) : s;
          return <span key={i}>{text}</span>;
        })}
      </span>
    </li>
  );
}

/** Main.png hero: CMS headline/subtitle, 3 CTAs, trust row from LIVE database figures; right column = live RFQ, top open pool, featured product. */
export function HomeHero({ blocks, stats, featured, liveRfq, pool, poolsOn }: {
  blocks: Blocks; stats: Record<string, string>; featured: CardProduct[]; liveRfq: LiveRfq | null; pool: PoolCard | null; poolsOn: boolean;
}) {
  const [bBrowse, bRfq, bPool] = copy(blocks, 'home.hero.buttons', 'Browse products|Send an RFQ|Join a group buy');
  const trust = copy(blocks, 'home.hero.trust', '').filter((t) => {
    const keys = [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return t && keys.every((k) => stats[k]);
  });

  // Live RFQ card: the newest real open RFQ with quotes (buyer shown only by destination country). Empty state when none.
  const rfqLabel = block(blocks, 'home.hero.rfq_label', 'Live RFQ');
  // Featured product card: prefer one whose price drops with quantity.
  const feat = featured.find((p) => p.tiers.length > 1) ?? featured.find((p) => p.tiers.length) ?? null;
  const fBase = feat?.tiers[0];
  const fBest = feat && feat.tiers.length > 1 ? feat.tiers[feat.tiers.length - 1] : null;

  return (
    <section className="bg-white" aria-labelledby="home-hero-h">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-8 pb-8 sm:pt-10 grid gap-10 lg:gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center">
        <div className="min-w-0 flex flex-col gap-[18px]">
          <h1 id="home-hero-h" className="text-[32px] sm:text-[42px] xl:text-[50px] font-extrabold leading-[1.08] sm:leading-[1.05] tracking-[-0.025em]">
            {block(blocks, 'home.hero.title', block(blocks, 'home.title'))}
          </h1>
          <p className="text-[16px] sm:text-[17px] leading-[1.55] text-[#3B4556] max-w-[540px]">{block(blocks, 'home.hero.subtitle', block(blocks, 'home.subtitle'))}</p>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/products" className="btn btn-primary min-h-12 px-5">{bBrowse}</Link>
            <Link href="/request/sourcing" className="btn btn-dark min-h-12 px-5">{bRfq}</Link>
            {poolsOn && bPool && <Link href="/pools" className="btn btn-ghost min-h-12 px-5">{bPool}</Link>}
          </div>
          {trust.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1" aria-label="Platform numbers">
              {trust.map((t) => <TrustItem key={t} template={t} stats={stats} />)}
            </ul>
          )}
        </div>

        <aside className="min-w-0 flex flex-col gap-3" aria-label="Live on Octopus B2B">
          {liveRfq ? (
            <figure className="bg-navy text-white rounded-2xl p-5 flex flex-col gap-2.5" aria-label={`${rfqLabel} ${liveRfq.code}`}>
              <div className="flex justify-between items-center gap-3">
                <span className="mono text-[11px] uppercase tracking-[0.08em] text-[#9AA6B8]">
                  {rfqLabel}{liveRfq.destination_country && <> · Ship to {COUNTRY_NAMES[liveRfq.destination_country] ?? liveRfq.destination_country}, {liveRfq.destination_country}</>}
                </span>
                <span className="shrink-0 rounded-full bg-[#FEF3C7] text-[#92400E] text-[11px] font-semibold leading-none px-2 py-[5px]">
                  {liveRfq.quote_count} {liveRfq.quote_count === 1 ? 'quote' : 'quotes'} in
                </span>
              </div>
              <figcaption className="font-display font-bold text-[17px] leading-[1.3]">{n(liveRfq.quantity)} {liveRfq.unit} · {liveRfq.title}</figcaption>
              <ul className="grid grid-cols-3 gap-2 mt-0.5">
                {liveRfq.quotes.map((q, i) => (
                  <li key={i} className={`rounded-lg px-3 py-2.5 min-w-0 ${i === 0 ? 'bg-[#262A6B]' : 'bg-[#1B1E52]'}`}>
                    <div className="font-display font-extrabold text-[14px] sm:text-[15px] leading-none break-words">
                      {money(q.unit_price_minor, q.currency)}<span className="sr-only"> per {unitOne(liveRfq.unit)}</span>
                    </div>
                    <div className="text-[11px] text-[#9AA6B8] mt-1 truncate">{q.supplier_code}{q.supplier_country && ` · ${q.supplier_country}`}</div>
                  </li>
                ))}
              </ul>
            </figure>
          ) : (
            <div className="bg-navy text-white rounded-2xl p-5 flex flex-col gap-2.5">
              <span className="mono text-[11px] uppercase tracking-[0.08em] text-[#9AA6B8]">{rfqLabel}</span>
              <p className="font-display font-bold text-[17px] leading-[1.3]">{block(blocks, 'home.hero.rfq_empty', 'No open RFQs right now — be the first to request quotes.')}</p>
              <Link href="/request/sourcing" className="btn btn-light min-h-9 text-[13px] px-3.5 self-start">{bRfq}</Link>
            </div>
          )}

          {pool && (
            <div className="bg-white border-[1.5px] border-navy rounded-2xl px-5 py-[18px] flex flex-col gap-2.5">
              <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1">
                <span className="mono text-[11px] uppercase tracking-[0.08em] text-muted">{block(blocks, 'home.hero.pool_label', 'Open group buy')} · {pool.code}</span>
                <Countdown to={pool.deadline_at} prefix="Closes in " className="text-[11px] font-semibold leading-none text-[#92400E]" />
              </div>
              <p className="font-display font-bold text-[16px] leading-[1.3]">{pool.product.title}</p>
              <ProgressBar filled={pool.filled_qty} target={pool.target_qty} className="h-[7px]" />
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[12px] text-[#3B4556]">
                <span><strong className="mono text-navy">{n(pool.filled_qty)}</strong>/{n(pool.target_qty)} {pool.product.unit} · {pool.buyers} {pool.buyers === 1 ? 'buyer' : 'buyers'}</span>
                {pool.pool_price_minor != null && (
                  <span className="font-semibold text-[#166534]">
                    <span className="sr-only">Price now </span>{money(pool.pool_price_minor, pool.currency)}
                    {pool.target_price_minor != null && pool.target_price_minor !== pool.pool_price_minor && (
                      <> <span aria-hidden>→</span><span className="sr-only">, if the pool fills</span> {money(pool.target_price_minor, pool.currency)}</>
                    )}/{unitOne(pool.product.unit)}
                  </span>
                )}
              </div>
              <Link href={`/pool/${pool.code}`} className="btn btn-dark min-h-9 text-[13px] px-3.5">
                {block(blocks, 'home.hero.pool_cta', 'Join this pool')}<span className="sr-only">: {pool.code}, {pool.product.title}</span>
              </Link>
            </div>
          )}
          {!pool && poolsOn && (
            <div className="bg-white border-[1.5px] border-navy rounded-2xl px-5 py-[18px] flex flex-col gap-2.5">
              <span className="mono text-[11px] uppercase tracking-[0.08em] text-muted">{block(blocks, 'home.hero.pool_label', 'Open group buy')}</span>
              <p className="font-display font-bold text-[16px] leading-[1.3]">{block(blocks, 'home.hero.pool_empty', 'No open pools right now. Start one and share the MOQ with other buyers.')}</p>
              <Link href="/pools" className="btn btn-dark min-h-9 text-[13px] px-3.5">{bPool || 'Join a group buy'}</Link>
            </div>
          )}

          {feat && fBase && (
            <div className="bg-white border border-line rounded-2xl p-4 flex gap-3 items-center">
              <div className="w-16 h-16 shrink-0 overflow-hidden rounded-[10px]">
                <ProductImage src={feat.image_url} alt={feat.title} className="h-16" label="Photo" width={64} height={64} />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="mono text-[11px] uppercase text-muted">
                  {block(blocks, 'home.hero.featured_label', 'Featured')}{feat.supplier && <> · Supplier {feat.supplier.code}{feat.supplier.country && ` · ${feat.supplier.country}`}</>}
                </span>
                <Link href={`/p/${feat.slug}`} className="font-semibold text-[14px] leading-[1.3] hover:text-blue">{feat.title}</Link>
                <span className="text-[13px] text-[#3B4556]">
                  <span className="font-display font-extrabold text-[16px] text-navy">{money(fBase.unit_price_cents, feat.currency)}</span>
                  {fBest && <> · drops to <span className="mono font-semibold text-[#166534]">{money(fBest.unit_price_cents, feat.currency)}</span> at {n(fBest.min_qty)}+ {feat.unit}</>}
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
