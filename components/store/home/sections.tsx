import Link from 'next/link';
import { block } from '@/lib/content';
import { humanize } from '@/lib/format';
import type { VerifiedFactoryCard } from '@/components/store/data';
import { factoryLabel } from '@/lib/factory-label';
import { SectionHead } from './shared';

type Blocks = Record<string, string>;

/** Main.png "Verified suppliers": factory label ("Verified factory · China (Guangdong)") + type + the categories it lists in.
 *  Buyers never see a supplier code or id (19 Nov 2026), so the cards carry no code and no link by code. */
export function VerifiedSuppliers({ blocks, factories, showPlaceholders = false, sponsored }: { blocks: Blocks; factories: VerifiedFactoryCard[]; showPlaceholders?: boolean; sponsored?: React.ReactNode }) {
  // ADDON-32: no real verified supplier → hide the section (bracketed placeholder cards only with home.show_placeholders)
  if (!factories.length && !showPlaceholders) return null;
  return (
    <section aria-labelledby="home-suppliers-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
      <SectionHead id="home-suppliers-h" title={block(blocks, 'home.suppliers.title', 'Verified suppliers')} href="/suppliers" link={block(blocks, 'home.suppliers.link', 'Become a supplier')} />
      {factories.length ? (
        <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))]">
          {factories.map((s) => (
            <li key={s.key} className="relative card rounded-[14px] p-[22px] flex flex-col gap-3.5">
              <div className="flex gap-3.5 items-center">
                <span className="w-[52px] h-[52px] shrink-0 rounded-xl bg-tint text-coral-text flex items-center justify-center mono text-[14px] font-semibold" aria-hidden>{s.country ?? '—'}</span>
                <div className="min-w-0 flex flex-col gap-1">
                  <h3 className="font-sans font-semibold text-[16px]">{factoryLabel(s)}</h3>
                </div>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label="Badges">
                {s.verified && <li className="rounded-full bg-ok-bg text-ok text-[12px] font-semibold px-2 py-[5px] leading-none">Verified</li>}
                {s.supplier_type && <li className="rounded-full bg-tint text-ink text-[12px] font-semibold px-2 py-[5px] leading-none">{humanize(s.supplier_type)}</li>}
              </ul>
              {s.categories.length > 0 && <p className="text-[14px] text-black">{s.categories.join(' · ')}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))]" aria-label="Placeholder supplier cards">
          {[0, 1, 2].map((i) => <li key={i} className="card rounded-[14px] p-[22px] border-dashed text-muted">[Verified factory] · China ([Province]) · [Type] · [Categories]</li>)}
        </ul>
      )}
      {sponsored && <div className="mt-4">{sponsored}</div>}
    </section>
  );
}

/** Main.png "What buyers say" — `testimonials` block, one "quote|who" per line (placeholder copy until launch, dashed cards). */
export function Testimonials({ blocks, showPlaceholders = false }: { blocks: Blocks; showPlaceholders?: boolean }) {
  // Placeholder lines ("[Customer testimonial: …]") are never shown as if they were real reviews → empty state instead.
  const items = (blocks.testimonials ?? '').split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((t) => t[0] && !t[0].startsWith('['));
  if (!items.length) {
    // ADDON-32: hidden in production; the bracketed placeholders only show with site_settings home.show_placeholders
    if (!showPlaceholders) return null;
    return (
      <section aria-labelledby="home-testimonials-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
        <SectionHead id="home-testimonials-h" title={block(blocks, 'home.testimonials.title', 'What buyers say')} />
        <p className="bg-white border border-dashed border-line-strong rounded-[14px] p-[26px] text-[16px] leading-[1.55] text-black">
          {block(blocks, 'home.testimonials.empty', 'Reviews from verified buyers will be published here.')}
        </p>
      </section>
    );
  }
  // Design shows three cards; a single placeholder line is repeated so the row keeps its shape.
  const shown = items.length === 1 ? [items[0], items[0], items[0]] : items;
  return (
    <section aria-labelledby="home-testimonials-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
      <SectionHead id="home-testimonials-h" title={block(blocks, 'home.testimonials.title', 'What buyers say')} />
      <ul className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        {shown.map(([quote, who], i) => (
          <li key={i} aria-hidden={items.length === 1 && i > 0 ? true : undefined}>
            <figure className="h-full bg-white border border-dashed border-line-strong rounded-[14px] p-[26px] flex flex-col gap-4">
              <blockquote className="text-[17px] leading-[1.55] text-black">{quote}</blockquote>
              {who && <figcaption className="text-[14px] font-semibold">{who}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Main.png closing CTA — "Can't find what you need?" (home.cta.*). */
export function HomeCta({ blocks, aside }: { blocks: Blocks; aside?: React.ReactNode }) {
  return (
    <section aria-labelledby="home-cta-h" className={`max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px] pb-6 ${aside ? 'grid gap-4 lg:grid-cols-[1.6fr_1fr]' : ''}`}>
      <div className="rounded-[20px] bg-ink text-white px-6 py-10 sm:p-12 flex flex-wrap gap-6 justify-between items-center">
        <div className="flex-[1_1_420px] min-w-0 flex flex-col gap-2.5">
          <h2 id="home-cta-h" className="!text-white text-[28px] sm:text-[34px] font-extrabold leading-[1.1]">{block(blocks, 'home.cta.title')}</h2>
          <p className="text-[16px] sm:text-[18px] text-white">{block(blocks, 'home.cta.body')}</p>
        </div>
        <Link href="/request/sourcing" className="btn btn-light min-h-[52px] px-[26px] text-[16px]">{block(blocks, 'home.cta.button', 'Request a product')}</Link>
      </div>
      {aside}
    </section>
  );
}
