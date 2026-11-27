import { Suspense } from 'react';
import { SearchView } from '@/app/ods/shop/search/_components/search-view';
import { parseSearchType, type SearchGroup, type SearchResult } from '@/app/ods/shop/search/_lib/types';
import { CatalogueFixtureFrame, one } from '../shop-products/_fixture-frame';
import { SAMPLE_BRAND, SAMPLE_CARDS, SAMPLE_DROPSHIP, SAMPLE_POOL, SAMPLE_TURNKEY } from '../shop-products/_sample';

export const metadata = { title: 'Shop search · ODS fixtures (staging)', robots: { index: false, follow: false } };

const PATH = '/dev/ui/screens/shop-search';
const STATES = [
  { id: 'results', label: 'Results' },
  { id: 'type', label: 'One type' },
  { id: 'section-failed', label: 'A section failed' },
  { id: 'no-results', label: 'No results' },
  { id: 'empty-query', label: 'No search yet' },
  { id: 'loading', label: 'Loading' },
];
type SP = Promise<Record<string, string | string[] | undefined>>;

function sampleGroups(failed: boolean): SearchGroup[] {
  return [
    { key: 'sourcing', total: 24, items: SAMPLE_CARDS.slice(0, 4), error: false },
    { key: 'pools', total: SAMPLE_POOL ? 1 : 0, items: SAMPLE_POOL ? [SAMPLE_POOL] : [], error: false },
    failed ? { key: 'dropship', total: 0, items: [], error: true } : { key: 'dropship', total: 1, items: [SAMPLE_DROPSHIP], error: false, note: 'Prices and landed cost show after Dropship access is approved.' },
    { key: '3pl', total: 0, items: [], error: false },
    { key: 'turnkey', total: 1, items: [SAMPLE_TURNKEY], error: false },
    { key: 'brand', total: 1, items: [SAMPLE_BRAND], error: false },
  ];
}

/** /shop/search in every state with SAMPLE props (?state=). */
export default function ShopSearchFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense>
      <Fixture searchParams={searchParams} />
    </Suspense>
  );
}

async function Fixture({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = STATES.some((s) => s.id === one(sp.state)) ? one(sp.state) : 'results';
  const q = current === 'no-results' ? 'ceramic knife block' : current === 'empty-query' ? '' : 'silicone';
  const type = current === 'type' ? 'sourcing' : parseSearchType(one(sp.type));
  const groups = current === 'no-results' ? sampleGroups(false).map((g) => ({ ...g, total: 0, items: [], note: undefined })) : sampleGroups(current === 'section-failed');
  const result: SearchResult = { q, groups, canAct: true };
  return (
    <CatalogueFixtureFrame path={PATH} states={STATES} current={current}>
      <SearchView q={q} type={type} status={current === 'loading' ? 'loading' : 'ready'} result={q ? result : null} demo basePath={PATH} />
    </CatalogueFixtureFrame>
  );
}
