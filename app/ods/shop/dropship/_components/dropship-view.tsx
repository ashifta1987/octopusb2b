import { KeyRound, PackageSearch } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, ErrorState, Icon, NamedTabLink, buttonClass, formatNumber } from '@octopus/ui';
import type { DropshipCardModel } from '../../_lib/cards';
import { ShopCard } from '../../_components/shop-card';

export type DropshipViewProps = {
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
  /** Dropship access approved for the company (company_services.dropship = on, Dropship v2 UI on). */
  hasAccess: boolean;
  /** Today's activation path: /account/dropship (v2 on) or /request/dropship (launch list). */
  requestHref: string;
  /** Country name for the landed cost line (with access). */
  countryName?: string;
  items: DropshipCardModel[];
  total: number;
  error?: boolean;
};

/** Heading levels: 1 on the real page; 2 inside a fixtures page (whose own H1 names the fixture). */
function levels(titleLevel: 1 | 2 = 1) {
  return { T: (titleLevel === 2 ? 'h2' : 'h1') as 'h1' | 'h2', S: (titleLevel === 2 ? 'h3' : 'h2') as 'h2' | 'h3', card: (titleLevel === 2 ? 4 : 3) as 3 | 4 };
}

/**
 * ODS T4 · /shop/dropship (Part 5.7): the dropship catalogue in the Shop. Gated — without access only names and photos
 * with Request access (never a price or landed cost: the card models carry no price fields without access); with access
 * DropshipCards with your price and the landed cost to the company's country. Presentational: props only.
 */
export function DropshipView({ hasAccess, requestHref, countryName, items, total, error, titleLevel }: DropshipViewProps) {
  const { T, S, card } = levels(titleLevel);
  const launchList = requestHref === '/request/dropship';
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Dropshipping' }]} />
      <header className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-start ods-tablet:justify-between">
        <div className="flex flex-col gap-2">
          <T className="m-0 text-ods-h1 text-ods-navy">Dropshipping products</T>
          <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">
            {hasAccess
              ? `Ready to sell from our warehouse, no minimum order. Prices include shipping${countryName ? ` and duties to ${countryName}` : ''}.`
              : 'Ready to sell from our warehouse, no minimum order. We pack and ship every order under your brand.'}
          </p>
        </div>
        {hasAccess ? (
          <NamedTabLink href="/account/dropship/catalogue" tab="account" className={buttonClass('secondary', 'md')}>
            Open the full catalogue
          </NamedTabLink>
        ) : null}
      </header>

      {!hasAccess ? (
        <section
          aria-labelledby="ds-gate"
          data-testid="dropship-gate"
          className="flex flex-col gap-3 rounded-ods-card border border-ods-line bg-ods-blue-tint p-ods-pad-card ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between"
        >
          <div className="flex gap-3">
            <Icon icon={KeyRound} size="md" className="mt-0.5 shrink-0 text-ods-blue" />
            <div className="flex flex-col gap-1">
              <S id="ds-gate" className="m-0 text-ods-h2 text-ods-navy">
                {launchList ? 'Octopus Dropship opens soon' : 'Request access to see prices'}
              </S>
              <p className="m-0 text-ods-body">
                {launchList
                  ? 'Join the launch list and we tell you when it opens. Prices and landed costs show after your access is approved.'
                  : 'Your price and the landed cost to your countries show after your dropship access is approved.'}
              </p>
            </div>
          </div>
          <NamedTabLink href={requestHref} tab="account" className={buttonClass('primary', 'md')} data-testid="dropship-request-access">
            {launchList ? 'Join the launch list' : 'Request access'}
          </NamedTabLink>
        </section>
      ) : null}

      <section aria-labelledby="ds-grid" className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <S id="ds-grid" className="m-0 text-ods-h2 text-ods-navy">
            {hasAccess && countryName ? `Landed cost to ${countryName}` : 'Products'}
          </S>
          {!error && total > 0 ? (
            <p className="m-0 text-ods-small text-ods-slate">
              Showing {formatNumber(items.length)} of {formatNumber(total)}
            </p>
          ) : null}
        </div>
        {error ? (
          <ErrorState title="We couldn’t load dropshipping products." action={<Button variant="secondary" href="/shop/dropship">Try again</Button>} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={hasAccess ? 'No products for your country yet' : 'No dropshipping products listed yet'}
            description={hasAccess ? 'Your catalogue shows every product with a price to your countries.' : 'Products ready to dropship show here.'}
          />
        ) : (
          <ul role="list" data-testid="dropship-grid" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4">
            {items.map((m) => (
              <li key={m.id} className="min-w-0">
                <ShopCard model={m} headingLevel={card} />
              </li>
            ))}
          </ul>
        )}
        {hasAccess && total > items.length ? (
          <NamedTabLink href="/account/dropship/catalogue" tab="account" className="self-start text-ods-body font-semibold text-ods-navy underline">
            See all {formatNumber(total)} products in your catalogue
          </NamedTabLink>
        ) : null}
      </section>
    </div>
  );
}
