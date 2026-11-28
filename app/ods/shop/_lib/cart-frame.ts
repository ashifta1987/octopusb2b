import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { getCart } from './cart';
import type { CartView } from './cart-types';

/**
 * ODS T5a · the cart for the Shop frame (header Cart (n), BottomNav count, the mini-cart opened from the header).
 * getCart() without re-check (re-checks run when the cart page or checkout opens). Never blanks the frame: any failure
 * → null and the header falls back to the quote-list count. Redirects (signed out / Shop off) are re-thrown.
 */
export const getFrameCart = cache(async (): Promise<CartView | null> => {
  try {
    return await getCart({ recheck: false });
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
});
