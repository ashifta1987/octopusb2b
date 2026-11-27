import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { addToQuoteList, recordView, submitSample, submitShopRfq } from '@/app/shop/actions';
import { getShopActor, loadProductPage, loadProductRow } from '../_lib/data';
import { ProductPageView } from './_components/product-view';
import { ProductPageError, ProductPageSkeleton } from './_components/product-states';
import { loadSimilarProducts } from './actions';

type Params = Promise<{ slug: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadProductRow(slug).catch(() => null);
  // the public /p/… page is the indexed one; the Shop copy is noindex and points at it
  return { title: p?.title ?? 'Product not found', alternates: { canonical: `/p/${slug}` }, robots: { index: false, follow: false } };
}

/**
 * ODS /shop/products/[slug] (Part 5.4). Data: loadProductPage (customer-safe columns, listed in ../_lib/data.ts
 * PRODUCT_COLS) + getShopActor (role, company country, cart count). Actions = today's app/shop/actions.ts:
 * submitShopRfq (Request quote), addToQuoteList (Add to cart), submitSample (Order a sample), recordView (on open).
 */
export default function ShopProductPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  return (
    <Suspense fallback={<ProductPageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const actor = await getShopActor();
  let product: Awaited<ReturnType<typeof loadProductPage>>;
  try {
    product = await loadProductPage(slug);
  } catch {
    return <ProductPageError retryHref={`/shop/products/${encodeURIComponent(slug)}`} />;
  }
  if (!product) notFound();
  const q = Number(Array.isArray(sp.qty) ? sp.qty[0] : sp.qty);
  return (
    <ProductPageView
      product={product}
      actor={actor}
      submitRfq={submitShopRfq}
      submitSample={submitSample}
      addToCart={addToQuoteList}
      loadSimilar={loadSimilarProducts}
      onView={recordView}
      initialQuantity={Number.isInteger(q) && q > 0 ? q : undefined}
      openQuote={sp.quote === '1' && actor.canAct}
    />
  );
}
