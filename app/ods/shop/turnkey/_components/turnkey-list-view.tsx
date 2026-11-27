import { Briefcase } from 'lucide-react';
import { Breadcrumbs, Button, EmptyState, ErrorState, formatNumber } from '@octopus/ui';
import type { TurnkeyCardModel } from '../../_lib/cards';
import { ShopCard } from '../../_components/shop-card';
import { OWN_PROJECT_SLUG } from '../_lib/turnkey-logic';

export type TurnkeyListViewProps = {
  /** 1 on the real page (default); 2 inside a fixtures page. */
  titleLevel?: 1 | 2;
  items: TurnkeyCardModel[];
  total: number;
  page: number;
  pages: number;
  error?: boolean;
};

const pageHref = (n: number) => (n > 1 ? `/shop/turnkey?page=${n}` : '/shop/turnkey');

/** ODS T4 · /shop/turnkey (Part 5.6, Shop_Turnkey "Ready projects"): TurnkeyCards from today's catalogue, paged (?page=). */
/** Heading levels: 1 on the real page; 2 inside a fixtures page (whose own H1 names the fixture). */
function levels(titleLevel: 1 | 2 = 1) {
  return { T: (titleLevel === 2 ? 'h2' : 'h1') as 'h1' | 'h2', S: (titleLevel === 2 ? 'h3' : 'h2') as 'h2' | 'h3', card: (titleLevel === 2 ? 4 : 3) as 3 | 4 };
}

export function TurnkeyListView({ items, total, page, pages, error, titleLevel }: TurnkeyListViewProps) {
  const { T, S, card } = levels(titleLevel);
  return (
    <div className="flex flex-col gap-6" data-testid="turnkey-list">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Turnkey projects' }]} />
      <header className="flex flex-col gap-3 ods-tablet:flex-row ods-tablet:items-start ods-tablet:justify-between">
        <div className="flex flex-col gap-2">
          <T className="m-0 text-ods-h1 text-ods-navy">Turnkey projects</T>
          <p className="m-0 max-w-[75ch] text-ods-body text-ods-slate">
            From idea to delivered stock: design, sourcing, samples, quality checks, packaging and shipping. Pick a ready project or tell us your own.
          </p>
        </div>
        <Button variant="primary" href={`/shop/turnkey/${OWN_PROJECT_SLUG}/start`} className="shrink-0">
          Start my own project
        </Button>
      </header>
      <section aria-labelledby="tk-ready" className="flex flex-col gap-4 rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <S id="tk-ready" className="m-0 text-ods-h2 text-ods-navy">
            Ready projects
          </S>
          {!error && total > 0 ? (
            <p className="m-0 text-ods-small text-ods-slate" aria-live="polite">
              {formatNumber(total)} {total === 1 ? 'project' : 'projects'}
              {pages > 1 ? ` · page ${page} of ${pages}` : ''}
            </p>
          ) : null}
        </div>
        {error ? (
          <ErrorState title="We couldn’t load turnkey projects." action={<Button variant="secondary" href={pageHref(page)}>Try again</Button>} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No projects listed yet"
            description="Tell us what you want to build and we plan it with you."
            action={
              <Button variant="primary" href={`/shop/turnkey/${OWN_PROJECT_SLUG}/start`}>
                Start my own project
              </Button>
            }
          />
        ) : (
          <ul role="list" className="m-0 grid list-none grid-cols-1 gap-4 p-0 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
            {items.map((m) => (
              <li key={m.id} className="min-w-0">
                <ShopCard model={m} headingLevel={card} />
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && !error ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-2">
            {page > 1 ? (
              <Button variant="secondary" href={pageHref(page - 1)}>
                Previous page
              </Button>
            ) : null}
            <span className="px-2 text-ods-small text-ods-slate">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Button variant="secondary" href={pageHref(page + 1)}>
                Next page
              </Button>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
