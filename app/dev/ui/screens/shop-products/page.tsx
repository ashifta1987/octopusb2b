import { Suspense } from 'react';
import { ProductsView } from '@/app/ods/shop/products/_components/products-view';
import { parseProductParams } from '@/app/ods/shop/products/_lib/filters';
import { CatalogueFixtureFrame, one } from './_fixture-frame';
import { BUYER, SAMPLE_CARDS, SAMPLE_CATEGORIES, SAMPLE_CHIPS, VIEWER } from './_sample';

export const metadata = { title: 'Shop products · ODS fixtures (staging)', robots: { index: false, follow: false } };

const PATH = '/dev/ui/screens/shop-products';
const STATES = [
  { id: 'normal', label: 'Normal' },
  { id: 'filtered', label: 'Filters on' },
  { id: 'paged', label: 'Several pages' },
  { id: 'empty', label: 'No results' },
  { id: 'loading', label: 'Loading' },
  { id: 'error', label: 'Error' },
  { id: 'viewer', label: 'Viewer role' },
];
type SP = Promise<Record<string, string | string[] | undefined>>;

/** /shop/products in every state with SAMPLE props (?state=). Filter links stay on this fixture (basePath). */
export default function ShopProductsFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense>
      <Fixture searchParams={searchParams} />
    </Suspense>
  );
}

async function Fixture({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = STATES.some((s) => s.id === one(sp.state)) ? one(sp.state) : 'normal';
  const base = parseProductParams(sp);
  const state =
    current === 'filtered' || current === 'empty'
      ? { ...base, category: 'home-and-kitchen', verified: true, samples: true, ...(current === 'empty' ? { max: 0.5 } : {}) }
      : current === 'paged'
        ? { ...base, page: 2 }
        : base;
  const items = current === 'filtered' ? SAMPLE_CARDS.filter((c) => c.badges.some((b) => b.label === 'Verified supplier')) : SAMPLE_CARDS;
  const list = current === 'empty' ? { items: [], total: 0, page: 1, pages: 1, currency: 'US$' } : { items, total: current === 'paged' ? 142 : items.length, page: state.page, pages: current === 'paged' ? 6 : 1, currency: 'US$' };
  const status = current === 'loading' ? 'loading' : current === 'error' ? 'error' : 'ready';
  return (
    <CatalogueFixtureFrame path={PATH} states={STATES} current={current}>
      <ProductsView
        state={state}
        categories={SAMPLE_CATEGORIES}
        chips={SAMPLE_CHIPS}
        status={status}
        list={status === 'ready' ? list : null}
        currency="US$"
        actor={current === 'viewer' ? VIEWER : BUYER}
        demo
        basePath={PATH}
      />
    </CatalogueFixtureFrame>
  );
}
