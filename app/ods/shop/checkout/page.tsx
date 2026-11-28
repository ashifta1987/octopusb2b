import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Skeleton } from '@octopus/ui';
import { getCart } from '../_lib/cart';
import { CheckoutPlaceholder } from './_components/checkout-placeholder';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false, follow: false } };

/**
 * ODS T5a · /shop/checkout — a placeholder until online payment (T5b; the card provider isn't chosen yet). Re-checks
 * the cart like the cart page (Part 5.8 "re-checks when the cart opens and at checkout"), then shows, per Buy now line,
 * today's way to complete it. NO money moves, NO ledger writes, NO orders are created by this page.
 */
export default function ShopCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
          <h1 className="m-0 mb-4 text-ods-h1 text-ods-navy">Checkout</h1>
          <Skeleton lines={6} label="Loading checkout" />
        </div>
      }
    >
      <Content />
    </Suspense>
  );
}

async function Content() {
  const cart = await getCart({ recheck: true });
  return <CheckoutPlaceholder cart={cart} />;
}
