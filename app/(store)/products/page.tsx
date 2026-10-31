import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CatalogView, CatalogSkeleton, type SP } from '@/components/store/catalog-view';

export const metadata: Metadata = {
  title: 'All products',
  description: 'Browse wholesale industrial supplies with tiered USD pricing, MOQ, certifications and verified suppliers.',
  alternates: { canonical: '/products' },
};

/** Products.png — all categories. */
export default function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  return <CatalogView basePath="/products" category={null} sp={sp} placement="category_banner" />;
}
