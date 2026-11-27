import Link from 'next/link';
import Image from 'next/image';
import { categoryPath, type Category } from '@/lib/content';
import { money } from '@/lib/format';
import { getFeatured, listProducts, type CardProduct } from '@/components/store/data';
import { unitOne } from '@/components/store/product-card';

/**
 * Real listed products as examples (owner, 27 Nov: "show listed products as demo" on /sourcing and the homepage).
 * Source = the public catalogue (/products): featured products first, then the newest live ones.
 * Products with a photo come first. White-label: only title, category, tier price and MOQ; never the supplier.
 */
export async function getShowcaseProducts(n: number): Promise<CardProduct[]> {
  const [featured, newest] = await Promise.all([
    getFeatured(n),
    // a slow or failed query hides the extra products instead of breaking the page
    listProducts({ sort: 'newest' }).catch(() => ({ items: [] as CardProduct[], total: 0 })),
  ]);
  const seen = new Set<string>();
  const all = [...featured, ...newest.items].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const withPhoto = all.filter((p) => p.image_url);
  return [...withPhoto, ...all.filter((p) => !p.image_url)].slice(0, n);
}

/** Lowest tier price (or the listed minimum). 0 or missing = unknown, never "US$ 0.00". */
const lowPrice = (p: CardProduct) => {
  const v = p.tiers.length ? Math.min(...p.tiers.map((t) => t.unit_price_cents)) : p.min_price_cents;
  return v && v > 0 ? v : null;
};

/** One product card: square photo shown whole on white (or a clean placeholder), category, title, price, MOQ. */
export function ShowcaseCard({ p, categories }: { p: CardProduct; categories: Category[] }) {
  const low = lowPrice(p);
  const cat = p.category_id ? categoryPath(categories, p.category_id)[0]?.name : null;
  return (
    <Link href={`/p/${p.slug}`} className="card-lift w-full bg-white border border-line rounded-[18px] overflow-hidden text-black flex flex-col hover:border-coral-text hover:text-black" data-testid="showcase-card">
      <div className="relative aspect-square bg-white border-b border-divider">
        {p.image_url ? (
          // lazy below the fold (native loading="lazy"); product photos are public in the product-media bucket
          <Image src={p.image_url} alt={p.title} fill sizes="(min-width:1200px) 280px, (min-width:768px) 25vw, 50vw" className="object-contain p-3" unoptimized />
        ) : (
          <div role="img" aria-label={`${p.title}: photo coming soon`} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-tint text-coral-text">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
            <span className="text-[13px] font-semibold">Photo coming soon</span>
          </div>
        )}
      </div>
      <div className="p-4 sm:p-5 flex flex-col gap-1.5 flex-1">
        {cat && <span className="font-mono text-[11px] sm:text-[12px] font-semibold tracking-[.1em] uppercase text-coral-text line-clamp-1">{cat}</span>}
        <b className="font-display text-[15px] sm:text-[17px] font-semibold leading-[1.3] text-ink line-clamp-2 flex-1">{p.title}</b>
        <p className="num mt-2 mb-0 text-[20px] sm:text-[24px] font-extrabold text-ink">
          {low ? <><span className="text-[13px] sm:text-[14px] font-normal text-muted">from </span>{money(low, p.currency)}<span className="text-[13px] sm:text-[14px] font-normal text-muted"> / {unitOne(p.unit)}</span></> : <span className="text-[15px] font-semibold text-muted">Price unknown</span>}
        </p>
        <p className="m-0 text-[13px] sm:text-[14px] text-muted">{p.moq > 0 ? `Minimum order ${p.moq.toLocaleString('en-US')}+ ${p.unit}` : 'Minimum order unknown'}</p>
      </div>
    </Link>
  );
}

/** Responsive grid: 2 columns on phones, 4 from 1024 px. */
export function ShowcaseGrid({ products, categories, testId }: { products: CardProduct[]; categories: Category[]; testId: string }) {
  return (
    <ul className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 list-none p-0" data-testid={testId}>
      {products.map((p) => <li key={p.id} className="min-w-0 flex"><ShowcaseCard p={p} categories={categories} /></li>)}
    </ul>
  );
}
