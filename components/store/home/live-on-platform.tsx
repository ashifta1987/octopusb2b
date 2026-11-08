import Link from 'next/link';
import { money, COUNTRY_NAMES } from '@/lib/format';
import type { CardProduct, PoolCard } from '@/components/store/data';
import { ProductImage, unitOne } from '@/components/store/product-card';
import { ProgressBar } from '@/components/store/pools/pool-card';
import { Countdown } from '@/components/store/pools/countdown';
import { block } from '@/lib/content';
import { SectionHead, n } from './shared';
import type { LiveRfq } from './live-data';

type Blocks = Record<string, string>;

/**
 * ADDON-32 "Live on the platform": newest open RFQ (buyer anonymised to the destination country, top 3 quotes),
 * the open pool closest to closing, one featured product. Each card is hidden when its source has no real row;
 * the whole section is hidden when all three are empty (never an invented example).
 */
export function LiveOnPlatform({ blocks, liveRfq, pool, featured }: { blocks: Blocks; liveRfq: LiveRfq | null; pool: PoolCard | null; featured: CardProduct[] }) {
  const feat = featured.find((p) => p.tiers.length > 1) ?? featured.find((p) => p.tiers.length) ?? null;
  const fBase = feat?.tiers[0];
  const fBest = feat && feat.tiers.length > 1 ? feat.tiers[feat.tiers.length - 1] : null;
  if (!liveRfq && !pool && !(feat && fBase)) return null;
  const rfqLabel = block(blocks, 'home.hero.rfq_label', 'Live RFQ');
  return (
    <section aria-labelledby="home-live-h" className="max-w-[1360px] mx-auto px-4 sm:px-8 pt-12" data-testid="home-live">
      <div className="mono text-[11px] uppercase tracking-[.08em] text-coral-text font-semibold mb-1">Happening now</div>
      <SectionHead id="home-live-h" size="md" title={block(blocks, 'home.live.title', 'Live on the platform')} href="/request" link={block(blocks, 'home.platform.link', 'Open the Request Center')} />
      <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {liveRfq && (
          <figure className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-2.5" aria-label={`${rfqLabel} ${liveRfq.code}`}>
            <div className="flex justify-between items-center gap-3">
              <span className="mono text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded-full bg-ok-bg text-ok">{rfqLabel}</span>
              <span className="mono text-[11px] uppercase text-muted text-right">
                {liveRfq.destination_country ? `${COUNTRY_NAMES[liveRfq.destination_country] ?? liveRfq.destination_country} · ` : ''}{liveRfq.quote_count} {liveRfq.quote_count === 1 ? 'quote' : 'quotes'}
              </span>
            </div>
            <figcaption className="font-display font-bold text-[17px] leading-[1.3]">{n(liveRfq.quantity)} {liveRfq.unit} · {liveRfq.title}</figcaption>
            <ul className="flex flex-col gap-1.5 mt-0.5">
              {liveRfq.quotes.map((q, i) => (
                <li key={i} className={`flex justify-between rounded-lg px-3 py-2 ${i === 0 ? 'bg-tint' : 'bg-pearl'}`}>
                  <span className="mono text-[12px] text-muted">{q.supplier_code}{q.supplier_country && ` · ${q.supplier_country}`}</span>
                  <span className="font-display font-extrabold text-[14px]">{money(q.unit_price_minor, q.currency)}<span className="sr-only"> per {unitOne(liveRfq.unit)}</span></span>
                </li>
              ))}
            </ul>
            <Link href="/request/sourcing" className="mt-auto text-coral-text font-semibold text-[13px]">Send an RFQ like this →</Link>
          </figure>
        )}

        {pool && (
          <div className="bg-white border border-line rounded-2xl p-5 flex flex-col gap-2.5">
            <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1">
              <span className="mono text-[11px] uppercase tracking-[0.08em] px-2 py-1 rounded-full bg-warn-bg text-warn">{block(blocks, 'home.hero.pool_label', 'Open group buy')}</span>
              <Countdown to={pool.deadline_at} prefix="Closes in " className="mono text-[11px] uppercase text-muted" />
            </div>
            <p className="font-display font-bold text-[16px] leading-[1.3]">{pool.product.title}</p>
            <ProgressBar filled={pool.filled_qty} target={pool.target_qty} className="h-[7px]" />
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[12px] text-black">
              <span><strong className="mono text-ink">{n(pool.filled_qty)}</strong>/{n(pool.target_qty)} {pool.product.unit} · {pool.buyers} {pool.buyers === 1 ? 'buyer' : 'buyers'}</span>
              <span className="mono font-semibold">{Math.min(100, Math.round((pool.filled_qty / Math.max(1, pool.target_qty)) * 100))} %</span>
            </div>
            <p className="text-[12.5px] text-muted">Pay a {pool.deposit_pct} % deposit now. Held in escrow — refunded if the pool doesn&apos;t fill.</p>
            <div className="mt-auto flex items-center justify-between gap-3">
              {pool.pool_price_minor != null && (
                <span className="font-semibold text-ok text-[14px]">
                  {pool.base_price_minor != null && pool.base_price_minor !== pool.pool_price_minor && <s className="text-muted font-normal mr-1">{money(pool.base_price_minor, pool.currency)}</s>}
                  {money(pool.target_price_minor ?? pool.pool_price_minor, pool.currency)}/{unitOne(pool.product.unit)}
                </span>
              )}
              <Link href={`/pool/${pool.code}`} className="btn btn-primary min-h-9 text-[13px] px-3.5">{block(blocks, 'home.hero.pool_cta', 'Join this pool')}<span className="sr-only">: {pool.code}</span></Link>
            </div>
          </div>
        )}

        {feat && fBase && (
          <div className="bg-white border border-line rounded-2xl overflow-hidden flex flex-col">
            <ProductImage src={feat.image_url} alt={feat.title} className="h-[140px]" label="Product photo" width={400} height={140} />
            <div className="p-4 flex flex-col gap-1">
              <span className="mono text-[11px] uppercase text-muted">{block(blocks, 'home.hero.featured_label', 'Featured')}{feat.supplier && <> · {feat.supplier.code}{feat.supplier.country && ` · ${feat.supplier.country}`}</>}</span>
              <Link href={`/p/${feat.slug}`} className="font-semibold text-[15px] leading-[1.3] hover:text-coral-text">{feat.title}</Link>
              <span className="text-[13px] text-black">
                <span className="font-display font-extrabold text-[17px] text-ink">{money(fBase.unit_price_cents, feat.currency)}</span>
                {fBest && <> · drops to <span className="mono font-semibold text-ok">{money(fBest.unit_price_cents, feat.currency)}</span> at {n(fBest.min_qty)}+ {feat.unit}</>}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

