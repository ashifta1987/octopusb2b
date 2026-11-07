import Link from 'next/link';
import { SupplierCode } from '@/components/ui';
import { money, CURRENCY_PREFIX, asCurrency } from '@/lib/format';
import type { CardProduct, Tier, TagRef } from './data';

/** "pcs" → "pc", "units" → "unit", "m" → "m". */
export function unitOne(unit: string) {
  if (unit === 'pcs') return 'pc';
  return unit.length > 2 && unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

/** "US$ 0.14–0.19" / "CN¥ 1.00–1.35" from (already converted) price tiers in `currency` (falls back to min price). */
export function priceRange(tiers: Tier[], min: number | null, currency: string) {
  if (!tiers.length) return min != null ? money(min, currency) : 'Price on request';
  const prices = tiers.map((t) => t.unit_price_cents);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? money(lo, currency) : `${money(lo, currency)}–${money(hi, currency).replace(`${CURRENCY_PREFIX[asCurrency(currency)]} `, '')}`;
}

export function fmtQty(n: number, unit: string) {
  return `${n.toLocaleString('en-US')} ${unit}`;
}

/** Status-style tags: always text, colour only reinforces (SPEC §12 accessibility). */
export function ProductTags({ tags, dropship, ready, max = 4 }: { tags: TagRef[]; dropship: boolean; ready: boolean; max?: number }) {
  const certs = tags.filter((t) => t.kind === 'certification');
  const items: { key: string; label: string; cls: string; check?: boolean }[] = [];
  if (ready) items.push({ key: 'rts', label: 'Ready to ship', cls: 'bg-[#E3F5EA] text-[#156B3A]' });
  if (dropship) items.push({ key: 'ds', label: 'Dropshipping', cls: 'bg-blue-soft text-[#1E4F9C]' });
  certs.forEach((c) => items.push({ key: c.slug, label: c.name, cls: 'bg-white border border-line text-navy', check: true }));
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Product tags">
      {items.slice(0, max).map((t) => (
        <li key={t.key} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${t.cls}`}>
          {t.check && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1F9D55" strokeWidth="3" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
          )}
          {t.label}
        </li>
      ))}
    </ul>
  );
}

export function ProductImage({ src, alt, className = 'aspect-[4/3]', label = 'Product photo', width = 400, height = 300 }: {
  src: string | null; alt: string; className?: string; label?: string; width?: number; height?: number;
}) {
  if (!src) return <div className={`ph ${className}`} role="img" aria-label={`${alt} — photo coming soon`}>{label}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className={`${className} w-full object-cover bg-surface`} />;
}

/** Products.png card: tier price range, MOQ, tags and <SupplierCode/>. `featured` variant = Main.png card. */
export function ProductCard({ p, categoryName, variant = 'grid', cta = 'quote' }: { p: CardProduct; categoryName?: string; variant?: 'grid' | 'featured' | 'compact'; cta?: 'quote' | 'pool' }) {
  const u = unitOne(p.unit);
  const base = p.tiers[0];
  const best = p.tiers[p.tiers.length - 1];
  return (
    <article className="card overflow-hidden flex flex-col h-full">
      <Link href={`/p/${p.slug}`} tabIndex={-1} aria-hidden>
        <ProductImage src={p.image_url} alt={p.title} />
      </Link>
      <div className="p-4 flex flex-col gap-2 flex-1">
        {categoryName && <div className="mono text-[11px] uppercase tracking-wider text-muted">{categoryName}</div>}
        <h3 className="font-sans text-[15px] font-semibold leading-snug line-clamp-2">
          <Link href={`/p/${p.slug}`} className="hover:text-blue">{p.title}</Link>
        </h3>
        {variant === 'featured' && base ? (
          <div>
            <div><span className="font-display text-xl font-bold">{money(base.unit_price_cents, p.currency)}</span> <span className="text-sm text-muted">/ {u}</span></div>
            {best && best !== base && <div className="text-[13px] font-semibold text-ok">{money(best.unit_price_cents, p.currency)} at {best.min_qty.toLocaleString('en-US')}+ {p.unit}</div>}
          </div>
        ) : (
          <div><span className="font-display text-lg font-bold">{priceRange(p.tiers, p.min_price_cents, p.currency)}</span> <span className="text-sm text-muted">/ {u}</span></div>
        )}
        <div className="text-[13px] text-muted">MOQ {fmtQty(p.moq, p.unit)}</div>
        {variant === 'grid' && <ProductTags tags={p.tags} dropship={p.octopus_dropship} ready={p.ready_to_ship} />}
        <div className="mt-auto pt-2 space-y-3">
          {p.supplier && <SupplierCode code={p.supplier.code} country={p.supplier.country} verified={p.supplier.verified} />}
          {variant !== 'featured' && (cta === 'pool' ? (
            <Link href={`/pools/start?product=${p.id}`} className="btn btn-dark btn-sm w-full min-h-11">
              Start pool<span className="sr-only"> on {p.title}</span>
            </Link>
          ) : (
            <Link href={`/request/sourcing?product=${p.id}`} className="btn btn-ghost btn-sm w-full">
              Request quote<span className="sr-only"> for {p.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, categoryNames, variant, cols = 'lg:grid-cols-4', cta }: {
  products: CardProduct[]; categoryNames?: Record<string, string>; variant?: 'grid' | 'featured' | 'compact'; cols?: string; cta?: 'quote' | 'pool';
}) {
  return (
    <ul className={`grid grid-cols-2 md:grid-cols-3 ${cols} gap-4`}>
      {products.map((p) => (
        <li key={p.id}><ProductCard p={p} variant={variant} cta={cta} categoryName={p.category_id ? categoryNames?.[p.category_id] : undefined} /></li>
      ))}
    </ul>
  );
}

export function GridSkeleton({ n = 8, cols = 'lg:grid-cols-4' }: { n?: number; cols?: string }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 ${cols} gap-4`} aria-busy="true" aria-label="Loading products">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="ph aspect-[4/3]" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-surface rounded w-4/5" /><div className="h-4 bg-surface rounded w-1/2" /><div className="h-8 bg-surface rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
