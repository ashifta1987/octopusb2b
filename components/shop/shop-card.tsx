import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { money } from '@/lib/format';
import type { CardProduct } from '@/components/store/data';
import { ProductImage, unitOne, fmtQty } from '@/components/store/product-card';
import { AddToList } from './add-to-list';

/** Lowest unit price on the card (tiers are already in the platform currency); null = price on request (never 0). */
export function fromPrice(p: Pick<CardProduct, 'tiers' | 'min_price_cents'>): number | null {
  const prices = p.tiers.map((t) => t.unit_price_cents).filter((c) => c > 0);
  if (prices.length) return Math.min(...prices);
  return p.min_price_cents && p.min_price_cents > 0 ? p.min_price_cents : null;
}
export const leadText = (days: number | null | undefined) => (days != null && days > 0 ? `${days} days` : 'on request');

/**
 * CH-1 shop product card (Shop_Home / Shop_Products): photo, title, "Verified supplier" (never a name or code), from price per
 * unit, MOQ, lead time, Request quote · Sample, and Add to quote list for members who may send requests.
 */
export function ShopCard({ p, canAct, tags = false }: { p: CardProduct; canAct: boolean; tags?: boolean }) {
  const href = `/shop/products/${p.slug}`;
  const price = fromPrice(p);
  const custom = p.tags.some((t) => t.slug === 'customisable');
  return (
    <article className="card overflow-hidden flex flex-col h-full" data-testid="shop-card">
      <Link href={href} tabIndex={-1} aria-hidden>
        <ProductImage src={p.image_url} alt={p.title} />
      </Link>
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <h3 className="m-0 font-sans text-[15px] font-semibold leading-snug line-clamp-2">
          <Link href={href} className="text-ink underline underline-offset-4 decoration-line-strong hover:text-coral-text">{p.title}</Link>
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {p.factory?.verified && (
            <span className="pill bg-ok-bg text-ok" data-testid="verified-supplier"><ShieldCheck size={13} strokeWidth={2} aria-hidden />Verified supplier</span>
          )}
          {tags && custom && <span className="pill bg-tint text-ink">Customisable</span>}
        </div>
        <div className="text-[15px]">
          {price != null
            ? <>From <b className="font-display text-[17px]">{money(price, p.currency)}</b> <span className="text-muted">/ {unitOne(p.unit)}</span></>
            : <span className="text-muted">Price on request</span>}
        </div>
        <div className="text-[13px] text-muted">MOQ {fmtQty(p.moq, p.unit)} · Lead time {leadText(p.lead_time_days)}</div>
        <div className="mt-auto pt-2 grid grid-cols-2 gap-2">
          <Link href={`${href}#request`} className="btn btn-primary btn-sm">Request quote<span className="sr-only"> for {p.title}</span></Link>
          <Link href={`${href}#sample`} className="btn btn-ghost btn-sm">Sample<span className="sr-only"> of {p.title}</span></Link>
        </div>
        {canAct && <AddToList productId={p.id} title={p.title} />}
      </div>
    </article>
  );
}

export function CardGrid({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 list-none m-0 p-0" data-testid={testId}>{children}</ul>;
}
