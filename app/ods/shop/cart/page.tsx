import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Skeleton } from '@octopus/ui';
import { getCart } from '../_lib/cart';
import { CartPageView } from './_components/cart-view';
import { parseCartTab } from './_lib/cart-ui';
import { cartRemove, cartSaveForLater, cartSetShipTo, cartUpdateQty, quoteUpdate, sendQuoteRequest } from './actions';

export const metadata: Metadata = { title: 'Your cart', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * ODS T5a · /shop/cart (Part 5.8). One cart per company: Buy now (shop_cart_items, migration 253) · Get a quote
 * (quote_list_items) · Saved for later. The re-check runs when the cart opens: getCart({ recheck: true }) re-reads prices,
 * stock and pools and returns the notices shown on the lines and in the page banner. `?tab=buy|quote|saved`.
 * Before migration 253 is applied getCart returns the quote list only (buy = [], saved = []), so /shop/quote-list
 * (308 → ?tab=quote) keeps working.
 */
export default function ShopCartPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<CartSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const [sp, cart] = await Promise.all([searchParams, getCart({ recheck: true })]);
  return (
    <CartPageView
      cart={cart}
      initialTab={parseCartTab(sp.tab)}
      actions={{ cartUpdateQty, cartRemove, cartSaveForLater, quoteUpdate, cartSetShipTo, sendQuoteRequest }}
    />
  );
}

function CartSkeleton() {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <h1 className="m-0 mb-4 text-ods-h1 text-ods-navy">Your cart</h1>
      <Skeleton lines={8} label="Loading your cart" />
    </div>
  );
}
