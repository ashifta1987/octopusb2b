import { Sparkles } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, ErrorState } from '@octopus/ui';
import type { BrandCardModel } from '../../_lib/cards';
import { ShopCard } from '../../_components/shop-card';

export type BrandViewProps = {
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
  /** One BrandCard per branding method (site_settings brand.methods: minimum order and time per method). */
  items: BrandCardModel[];
  error?: boolean;
};

/** Heading levels: 1 on the real page; 2 inside a fixtures page (whose own H1 names the fixture). */
function levels(titleLevel: 1 | 2 = 1) {
  return { T: (titleLevel === 2 ? 'h2' : 'h1') as 'h1' | 'h2', S: (titleLevel === 2 ? 'h3' : 'h2') as 'h2' | 'h3', card: (titleLevel === 2 ? 4 : 3) as 3 | 4 };
}

/**
 * ODS T4 · /shop/brand (Part 5.7): BrandCards; Brand it opens the Make My Brand start form (today's /request/brand
 * wizard) with the method in the URL (?method=<key>). Presentational: props only.
 */
export function BrandView({ items, error, titleLevel }: BrandViewProps) {
  const { T, S, card } = levels(titleLevel);
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Make My Brand' }]} />
      <header className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-start ods-tablet:justify-between">
        <div className="flex flex-col gap-2">
          <T className="m-0 text-ods-h1 text-ods-navy">Make My Brand</T>
          <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">
            Put your brand on a verified product. Your account manager sends a proof and a quote before you pay anything.
          </p>
        </div>
        <Button variant="primary" href="/request/brand" className="shrink-0">
          Start a brand project
        </Button>
      </header>
      <section aria-labelledby="brand-methods" className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
        <S id="brand-methods" className="m-0 text-ods-h2 text-ods-navy">
          Ways to brand
        </S>
        {error ? (
          <ErrorState title="We couldn’t load the branding options." action={<Button variant="secondary" href="/shop/brand">Try again</Button>} />
        ) : items.length === 0 ? (
          <EmptyState icon={Sparkles} title="No branding options listed yet" description="Start a brand project and your account manager recommends what works for your product." />
        ) : (
          <ul role="list" data-testid="brand-grid" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
            {items.map((m) => (
              <li key={m.id} className="min-w-0">
                <ShopCard model={m} headingLevel={card} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
