import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSiteContent, type Category } from '@/lib/content';
import { CatalogView, CatalogSkeleton, type SP } from '@/components/store/catalog-view';
import { getCategoryCounts } from '@/components/store/data';
import { isStocked } from '@/lib/category-stock';

type Params = Promise<{ slug: string[] }>;

/** Walks the 4-level category tree by slug path (slugs are unique per parent). */
function resolve(categories: Category[], slugs: string[]): Category | null {
  let parent: string | null = null;
  let cur: Category | null = null;
  for (const s of slugs) {
    cur = categories.find((c) => c.parent_id === parent && c.slug === decodeURIComponent(s)) ?? null;
    if (!cur) return null;
    parent = cur.id;
  }
  return cur;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const [{ categories }, counts] = await Promise.all([getSiteContent(), getCategoryCounts()]);
  const cat = resolve(categories, slug);
  if (!cat) return { title: 'Category not found', robots: { index: false } };
  return {
    // ADDON-36 C4: a category with no live products is not indexed (it shows a "we'll source it" page)
    ...(isStocked(categories, counts, cat.id) ? {} : { robots: { index: false, follow: true } }),
    title: `${cat.name} — wholesale${cat.hs_code ? ` (HS ${cat.hs_code})` : ''}`,
    description: `Buy ${cat.name.toLowerCase()} wholesale from verified suppliers. Tiered pricing, MOQ and lead times on every listing.`,
    alternates: { canonical: `/c/${slug.join('/')}` },
  };
}

/** Products.png — category listing (/c/fasteners/bolts/...). */
export default function CategoryPage({ params, searchParams }: { params: Params; searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<CatalogSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Params; searchParams: Promise<SP> }) {
  const [{ slug }, sp, { categories }] = await Promise.all([params, searchParams, getSiteContent()]);
  const cat = resolve(categories, slug);
  if (!cat) notFound();
  return <CatalogView basePath={`/c/${slug.join('/')}`} category={cat} sp={sp} placement="category_banner" />;
}
