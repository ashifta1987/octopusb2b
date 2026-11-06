import Link from 'next/link';
import { getStoreContent } from './currency';
import { getActiveAds } from './data';
import { parts } from './seo';

export type AdPlacement = 'home_banner' | 'category_banner' | 'product_side' | 'search_top';

/**
 * Sponsored slot (SPEC §8.2, AdsAdmin). Shows the highest-bidding active campaign for the placement
 * (anon RLS can read active campaigns). Clicks go through /api/ads/click which records + charges the click
 * server-side, then redirects. Falls back to a house ad from content_blocks `ads.house`.
 */
export async function AdSlot({ placement, layout = 'banner', houseFallback = true }: { placement: AdPlacement; layout?: 'banner' | 'card'; houseFallback?: boolean }) {
  const [{ settings, blocks }, ads] = await Promise.all([getStoreContent(), getActiveAds(placement)]);
  const enabled = settings.ads_enabled !== false;
  const ad = enabled ? ads[0] : undefined;
  if (!ad && !houseFallback) return null;   // e.g. the home suppliers grid: only a real sponsored listing, no house ad
  const [hHead, hBody, hLink, hCta] = parts(blocks, 'ads.house', "Can't find what you need?|Send one RFQ and get quotes from several verified suppliers.|/request/sourcing|Start an RFQ");
  const view = ad
    ? { headline: ad.headline, body: ad.body, href: `/api/ads/click?c=${ad.id}`, image: ad.image_url, cta: 'View', sponsored: true }
    : { headline: hHead, body: hBody, href: hLink || '/request/sourcing', image: null, cta: hCta || 'Learn more', sponsored: false };
  const why = blocks['ads.why'] ?? 'This is a sponsored listing. Advertisers bid per click on this placement.';

  const label = (
    <span className="mono text-[10px] font-semibold uppercase tracking-[0.1em] bg-surface border border-line rounded px-1.5 py-0.5 text-muted whitespace-nowrap">
      {view.sponsored ? 'Sponsored' : 'Octopus B2B'}
    </span>
  );
  const thumb = view.image
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={view.image} alt="" width={56} height={56} loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" />
    : null;   // no striped placeholder when the ad has no image
  const cta = (
    view.sponsored ? (
      // Plain <a>: the click route records + charges the click server-side, then redirects (never prefetched).
      <a href={view.href} className="btn btn-ghost btn-sm shrink-0" rel="sponsored nofollow">{view.cta}<span className="sr-only">: {view.headline}</span></a>
    ) : (
      <Link href={view.href} className="btn btn-ghost btn-sm shrink-0">{view.cta}<span className="sr-only">: {view.headline}</span></Link>
    )
  );

  return (
    <aside aria-label={view.sponsored ? 'Sponsored' : 'Promotion'} className="w-full">
      {layout === 'banner' ? (
        <div className="card px-5 py-4 flex flex-wrap items-center gap-4">
          {label}{thumb}
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold text-[15px]">{view.headline}</div>
            {view.body && <div className="text-[13px] text-muted">{view.body}</div>}
          </div>
          {cta}
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-3">{label}{thumb}</div>
          <div>
            <div className="font-semibold">{view.headline}</div>
            {view.body && <div className="text-[13px] text-muted">{view.body}</div>}
          </div>
          {cta}
        </div>
      )}
      {view.sponsored && (
        <details className="mt-1 text-right text-[11px] text-muted group">
          <summary className="cursor-pointer list-none inline">Ad · <span className="underline">Why am I seeing this?</span></summary>
          <p className="mt-1 text-left bg-white border border-line rounded-lg p-3 text-[12px] max-w-md ml-auto">{why}</p>
        </details>
      )}
    </aside>
  );
}
