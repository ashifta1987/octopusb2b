import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getSiteContent } from '@/lib/content';
import { CatalogView, CatalogSkeleton, type SP } from '@/components/store/catalog-view';

export const metadata: Metadata = { title: 'Search products', robots: { index: false, follow: true } };

/** Products.png — search results (/search?q=&c=). */
export default function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SP> }) {
  const [sp, { categories }] = await Promise.all([searchParams, getSiteContent()]);
  const c = Array.isArray(sp.c) ? sp.c[0] : sp.c;
  const cat = c ? (categories.find((x) => x.level === 1 && x.slug === c) ?? categories.find((x) => x.slug === c) ?? null) : null;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim();
  return <CatalogView basePath="/search" category={cat} sp={sp} placement="search_top" title={q ? `Results for “${q}”` : undefined} />;
}
