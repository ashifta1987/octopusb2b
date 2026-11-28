import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ShopBottomNav, ShopTop } from '@/app/ods/shop/_components/shop-frame';
import { ShopFooter } from '@/app/ods/shop/_components/shop-footer';
import { MiniCartProvider } from '@/app/ods/shop/_components/mini-cart';
import { CartPageView } from '@/app/ods/shop/cart/_components/cart-view';
import { CheckoutPlaceholder } from '@/app/ods/shop/checkout/_components/checkout-placeholder';
import type { CartActionResult, CartTab } from '@/app/ods/shop/_lib/cart-types';
import { SAMPLE_CATEGORIES } from '../shop-main/sample-data';
import { EMPTY_CART, belowMoq, rechecked, sampleCart } from './_sample';
import { FixtureMiniCart } from './fixture-client';

export const metadata: Metadata = { title: 'Shop cart · ODS screens (staging)', robots: { index: false, follow: false } };

const PATH = '/dev/ui/screens/shop-cart';
const STATES = [
  ['buy', 'Buy now'],
  ['quote', 'Get a quote'],
  ['saved', 'Saved for later'],
  ['empty', 'Empty'],
  ['rechecked', 'Re-checked'],
  ['below-moq', 'Below MOQ'],
  ['sent', 'Quote sent'],
  ['viewer', 'Viewer role'],
  ['unverified', 'Not verified'],
  ['mini-cart', 'Mini-cart'],
  ['checkout', 'Checkout'],
  ['checkout-unverified', 'Checkout, not verified'],
] as const;
type State = (typeof STATES)[number][0];
type SP = Promise<Record<string, string | string[] | undefined>>;

/* Fixture actions: never write anything. */
async function fake(): Promise<CartActionResult<never>> {
  'use server';
  return { ok: false, code: 'example', message: 'Example only: this preview page doesn’t change a cart.' };
}
const ACTIONS = { cartUpdateQty: fake, cartRemove: fake, cartSaveForLater: fake, quoteUpdate: fake, cartSetShipTo: fake, sendQuoteRequest: fake };

/**
 * Staging-only fixture (CONVENTIONS "Signed-in pages and testing"): the Shop frame + /shop/cart, the mini-cart and the
 * /shop/checkout placeholder with SAMPLE props, rendered by the same presentational components as the real pages.
 * `?state=` picks a state (see STATES). One H1 per state.
 */
export default function ShopCartFixture({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <MiniCartProvider>
        <div className="flex min-h-screen flex-col bg-ods-canvas [--shop-header-h:124px] ods-tablet:[--shop-header-h:68px]">
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-(--z-toast) focus:rounded-ods-control focus:bg-ods-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ods-navy">
            Skip to content
          </a>
          <Suspense fallback={null}>
            <Top searchParams={searchParams} />
          </Suspense>
          <main id="main" tabIndex={-1} className="flex-1 pb-[calc(60px+env(safe-area-inset-bottom))] focus:outline-none ods-tablet:pb-0">
            <Suspense fallback={null}>
              <Content searchParams={searchParams} />
            </Suspense>
          </main>
          <ShopFooter legalName="Shenzhen Octopus Trading Co., Ltd. (sample)" />
          <ShopBottomNav cartCount={10} categories={SAMPLE_CATEGORIES} poolsOn path="/shop/cart" />
        </div>
      </MiniCartProvider>
    </OdsThemeRoot>
  );
}

async function stateOf(searchParams: SP): Promise<State> {
  const sp = await searchParams;
  return STATES.some(([k]) => k === sp.state) ? (sp.state as State) : 'buy';
}

function cartFor(state: State) {
  switch (state) {
    case 'empty':
      return EMPTY_CART;
    case 'rechecked':
      return rechecked();
    case 'below-moq':
      return belowMoq();
    case 'viewer':
      return sampleCart({ canAct: false });
    case 'sent':
      return sampleCart({ quote: [] });
    case 'unverified':
    case 'checkout-unverified':
      return sampleCart({ verified: false });
    default:
      return sampleCart();
  }
}

async function Top({ searchParams }: { searchParams: SP }) {
  const state = await stateOf(searchParams);
  const cart = cartFor(state);
  return <ShopTop cartCount={cart.summary.headerCount} cart={cart} unread={3} walletAvailable={4250} categories={SAMPLE_CATEGORIES} poolsOn turnkeyOn path={state.startsWith('checkout') ? '/shop/checkout' : '/shop/cart'} />;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const state = await stateOf(searchParams);
  const cart = cartFor(state);
  const tab: CartTab = state === 'quote' || state === 'below-moq' || state === 'sent' ? 'quote' : state === 'saved' ? 'saved' : 'buy';
  return (
    <>
      <nav aria-label="Fixture states" data-testid="fixture-states" className="border-b border-ods-line bg-ods-warning-tint">
        <div className="mx-auto flex max-w-ods-content flex-wrap items-center gap-x-4 gap-y-1 px-ods-pad-page py-2 text-ods-small">
          <span className="font-semibold text-ods-navy">Sample data for design review only · State:</span>
          {STATES.map(([k, label]) => (
            <Link
              key={k}
              href={`${PATH}?state=${k}`}
              aria-current={k === state ? 'page' : undefined}
              data-testid={`fixture-state-${k}`}
              className={k === state ? 'inline-flex min-h-8 items-center font-bold text-ods-navy underline underline-offset-4' : 'inline-flex min-h-8 items-center text-ods-blue underline underline-offset-4'}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <div data-testid={`fixture-${state}`}>
        {state === 'checkout' || state === 'checkout-unverified' ? (
          <CheckoutPlaceholder cart={cart} />
        ) : (
          <CartPageView key={state} cart={cart} initialTab={tab} actions={ACTIONS} initialSent={state === 'sent' ? { code: 'RFQ-1051', lines: 3 } : null} />
        )}
        {state === 'mini-cart' ? <FixtureMiniCart cart={cart} added="Pet water fountain × 200 added" /> : null}
      </div>
    </>
  );
}
