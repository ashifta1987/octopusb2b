import Link from 'next/link';
import Image from 'next/image';
import { money } from '@/lib/format';
import { SUB_BRANDS, type SubBrand } from './ui';

type Action = { key: string; brand: SubBrand; title: string; body: string; note?: React.ReactNode; cta: string; href: string; primary?: boolean; soon?: boolean };

/**
 * Product page: "What would you like to do with this product?" (owner 27 Nov: verified factory products come under
 * Octopus Sourcing; from there the customer can request a quote, an MOQ pool, Make My Brand, dropshipping or 3PL).
 * Service switches are respected: MOQ pool only when pools are on, Make My Brand only for verified factories (as before),
 * Dropship shows "Coming soon" with the launch list while dropship_v2_ui is off. Existing testids are kept (way-*).
 */
export function ProductActions({ productId, verified, poolsOn, dropshipLive, rfq }: {
  productId: string; verified: boolean; poolsOn: boolean; dropshipLive: boolean; rfq?: { priceCents: number; currency: string } | null;
}) {
  const actions: Action[] = [
    { key: 'way-bulk', brand: 'sourcing', primary: true, title: 'Order through Sourcing', body: 'Tell us the quantity and your country. We send a quote in US dollars from this verified factory.',
      note: rfq?.priceCents ? <>Request fee <b className="text-ink">{money(rfq.priceCents, rfq.currency)}</b></> : undefined, cta: 'Request a quote', href: `/request/sourcing?product=${productId}` },
    ...(poolsOn ? [{ key: 'way-pool', brand: 'pools' as const, title: 'Share the factory minimum', body: 'Start an MOQ pool and let other buyers join, so you only pay for your share.', note: 'Refund if the pool does not fill', cta: 'Start a pool', href: `/pools/start?product=${productId}` }] : []),
    ...(verified ? [{ key: 'way-brand', brand: 'brand' as const, title: 'Put your brand on it', body: 'Your logo on the product and its box, made by this verified factory. We store the stock and ship it.', note: 'Free to request · quote before you pay', cta: 'Start a brand project', href: `/request/brand?product=${productId}` }] : []),
    dropshipLive
      ? { key: 'way-dropship', brand: 'dropship', title: 'Dropship it', body: 'We ship each order to your customer under your packing slip. You hold no stock.', note: 'Costs per country in your dropship catalogue', cta: 'Dropship this product', href: `/request/dropship?product=${productId}` }
      : { key: 'way-dropship', brand: 'dropship', soon: true, title: 'Dropship it', body: 'We will ship each order to your customer under your packing slip. You hold no stock.', note: 'Coming soon', cta: 'Join the launch list', href: `/request/dropship?product=${productId}` },
    { key: 'way-3pl', brand: '3pl', title: 'Store it near your buyers', body: 'Send your stock to the Octopus warehouse. We pick, pack and ship each order from there.', note: 'Free to request · rates in your quote', cta: 'Get a 3PL quote', href: '/3pl' },
  ];
  return (
    <section className="mt-10" aria-labelledby="ways-h" data-testid="product-ways">
      <p className="m-0 font-mono text-[12px] font-semibold tracking-[.12em] uppercase text-coral-text">Octopus Sourcing</p>
      <h2 id="ways-h" className="mt-1.5 text-[25px] sm:text-[30px] font-bold leading-[1.15]">What would you like to do with this product?</h2>
      <p className="mt-1.5 text-[15px] text-black max-w-[680px]">Each choice opens a request with this product already filled in. Every request gets a reference number you can follow in My account.</p>
      <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 list-none p-0">
        {actions.map((a) => {
          const logo = SUB_BRANDS[a.brand];
          return (
            <li key={a.key} className={`card-lift flex flex-col bg-white rounded-[18px] p-5 ${a.primary ? 'border-2 border-coral' : 'border border-line'}`} data-testid={a.key}>
              <Image src={logo.src} alt={logo.alt} width={logo.width} height={logo.height} sizes="120px" className="block h-11 w-auto self-start rounded-[8px]" />
              <h3 className="mt-3 mb-0 text-[17px] font-semibold flex items-center gap-2">{a.title}{a.soon && <span className="pill bg-warn-bg text-warn">Coming soon</span>}</h3>
              <p className="mt-1 mb-0 text-[14px] text-muted leading-relaxed flex-1">{a.body}</p>
              {a.note && <p className="mt-2 mb-0 text-[13px] text-muted">{a.note}</p>}
              <Link href={a.href} className={`btn ${a.primary ? 'btn-primary' : 'btn-ghost'} mt-4 w-full`}>{a.cta}</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
