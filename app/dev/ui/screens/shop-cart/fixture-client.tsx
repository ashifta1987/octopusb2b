'use client';

import { useState } from 'react';
import { MiniCart } from '@/app/ods/shop/_components/mini-cart';
import type { CartView } from '@/app/ods/shop/_lib/cart-types';

/** Fixture only: the mini-cart drawer open on load (state "mini-cart"), closable. Sample data. */
export function FixtureMiniCart({ cart, added }: { cart: CartView; added: string }) {
  const [open, setOpen] = useState(true);
  return <MiniCart open={open} onClose={() => setOpen(false)} cart={cart} added={added} />;
}
