import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getShopActor, loadCategories, loadProductList, currencyLabel } from './_lib/data';
import { parseProductParams, type SearchParamsRecord } from './_lib/filters';
import type { ProductListVM } from './_lib/types';
import { ProductsView } from './_components/products-view';
import { getCurrencyContext } from '@/lib/currency';

export const metadata: Metadata = { title: 'Products', alternates: { canonical: '/products' }, robots: { index: false, follow: false } };

/**
 * ODS /shop/products (Part 5.3). URL state: q, category (legacy c), min, max, moq, lead, verified, samples, custom, pool,
 * sort, page (./_lib/filters). Data: components/store/data listProducts (public cached catalogue, customer-safe columns)
 * mapped with the FRAME builder's toSourcingCard; categories + counts from getStoreContent/getCategoryCounts.
 * The list fails on its own (error state inside the page; the frame and filters keep working).
 */
export default function ShopProductsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  return (
    <Suspense fallback={<ProductsView state={parseProductParams({})} categories={[]} chips={[]} status="loading" currency="US$" actor={{ canAct: true, reason: null, country: null, cartCount: 0 }} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const state = parseProductParams(await searchParams);
  const [actor, cats, ctx] = await Promise.all([getShopActor(), loadCategories(), getCurrencyContext()]);
  let list: ProductListVM | null = null;
  try {
    list = await loadProductList(state, cats.all);
  } catch {
    list = null;
  }
  return (
    <ProductsView state={state} categories={cats.options} chips={cats.chips} status={list ? 'ready' : 'error'} list={list} currency={currencyLabel(ctx.currency)} actor={actor} />
  );
}
