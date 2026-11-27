import { Suspense } from 'react';
import type { Metadata } from 'next';
import { loadSearch } from './_lib/data';
import { parseSearchType } from './_lib/types';
import { SearchView } from './_components/search-view';

export const metadata: Metadata = { title: 'Search', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/** ODS /shop/search?q=&type= (Part 5.7). q needs 2+ characters; type = products | pools | dropship | warehouse | turnkey | brand. */
export default function ShopSearchPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<SearchView q="" type={null} status="loading" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = one(sp.q).replace(/\s+/g, ' ').slice(0, 100);
  const type = parseSearchType(one(sp.type));
  if (q.length < 2) return <SearchView q="" type={type} status="ready" />;
  const result = await loadSearch(q, type ? 12 : 4);
  return <SearchView q={q} type={type} status="ready" result={result} />;
}
