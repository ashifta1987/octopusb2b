import { Suspense } from 'react';
import { ProductPageView } from '@/app/ods/shop/products/[slug]/_components/product-view';
import { ProductPageError, ProductPageSkeleton } from '@/app/ods/shop/products/[slug]/_components/product-states';
import type { ProductPageVM } from '@/app/ods/shop/products/_lib/types';
import type { SourcingCardModel } from '@/app/ods/shop/_lib/cards';
import { CatalogueFixtureFrame, one } from '../shop-products/_fixture-frame';
import { BUYER, SAMPLE_CARDS, SAMPLE_PRODUCT, VIEWER } from '../shop-products/_sample';

export const metadata = { title: 'Shop product page · ODS fixtures (staging)', robots: { index: false, follow: false } };

const PATH = '/dev/ui/screens/shop-product';
const STATES = [
  { id: 'normal', label: 'Normal' },
  { id: 'below-moq', label: 'Below MOQ' },
  { id: 'no-samples', label: 'No samples' },
  { id: 'no-tiers', label: 'No price tiers' },
  { id: 'shipping', label: 'Shipping estimate' },
  { id: 'viewer', label: 'Viewer role' },
  { id: 'loading', label: 'Loading' },
  { id: 'error', label: 'Error' },
];
type SP = Promise<Record<string, string | string[] | undefined>>;
const EXAMPLE_ONLY = 'Example only: this preview page doesn’t send requests.';

/* Fixture actions: never write anything. */
async function fakeRfq(): Promise<{ ok: false; error: string }> {
  'use server';
  return { ok: false, error: EXAMPLE_ONLY };
}
async function fakeSample(): Promise<{ ok: false; error: string }> {
  'use server';
  return { ok: false, error: EXAMPLE_ONLY };
}
async function fakeCart(): Promise<{ ok: false; error: string }> {
  'use server';
  return { ok: false, error: EXAMPLE_ONLY };
}
async function fakeSimilar(): Promise<{ items: SourcingCardModel[] }> {
  'use server';
  return { items: SAMPLE_CARDS.slice(1, 4) };
}

/** /shop/products/[slug] in every state with SAMPLE props (?state=). Tabs keep ?tab= working here too. */
export default function ShopProductFixture({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense>
      <Fixture searchParams={searchParams} />
    </Suspense>
  );
}

async function Fixture({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const current = STATES.some((s) => s.id === one(sp.state)) ? one(sp.state) : 'normal';
  let product: ProductPageVM = SAMPLE_PRODUCT;
  if (current === 'no-samples') product = { ...product, samplesAvailable: false, sampleCents: null, customise: [], customisable: false, pool: null, questions: [] };
  if (current === 'no-tiers') product = { ...product, tiers: [], pool: null, specs: [] };
  if (current === 'shipping') product = { ...product, shippingEstimate: { sea: 'Example: US$ 0.12 per set, 25–35 days', air: 'Example: US$ 0.48 per set, 7–10 days' } };
  return (
    <CatalogueFixtureFrame path={PATH} states={STATES} current={current}>
      {current === 'loading' ? (
        <>
          <h1 className="sr-only">Product page loading</h1>
          <ProductPageSkeleton />
        </>
      ) : current === 'error' ? (
        <ProductPageError retryHref={`${PATH}?state=normal`} />
      ) : (
        <ProductPageView
          key={current}
          product={product}
          actor={current === 'viewer' ? VIEWER : BUYER}
          submitRfq={fakeRfq}
          submitSample={fakeSample}
          addToCart={fakeCart}
          loadSimilar={fakeSimilar}
          initialQuantity={current === 'below-moq' ? 300 : 2000}
          demo
        />
      )}
    </CatalogueFixtureFrame>
  );
}
