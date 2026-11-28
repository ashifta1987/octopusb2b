'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Check, Eye } from 'lucide-react';
import { Button, Drawer, Icon, Money, formatNumber } from '@octopus/ui';
import type { CartView } from '../_lib/cart-types';
import { CART_PATH, CHECKOUT_PATH, cartTabHref, checkoutReason, dueNowMinor, miniCartLines } from '../cart/_lib/cart-ui';
import { KindTag, LineImage } from '../cart/_components/line-parts';

/**
 * ODS T5a · Mini-cart (Part 5.8 "Mini-cart drawer", States-Cart "Added to cart (side panel)").
 *  - `MiniCartProvider` (mounted once by the Shop layout): holds the latest CartView returned by any cart action, so the
 *    header Cart (n) and the BottomNav count follow every add without a reload, and opens the drawer after an add.
 *  - `useMiniCart()` → { cart, show(cart, added?), sync(cart), close } | null (null outside the provider, e.g. fixtures).
 *  - `MiniCart` (presentational): 380 px Drawer — "… added" confirmation, the first Buy now lines, "+ n more", the Get a
 *    quote count, the Buy now subtotal, Checkout and View cart.
 */

type MiniCartCtx = {
  cart: CartView | null;
  /** Replace the cart (after any action) and open the drawer with an optional "… added" line. */
  show: (cart: CartView, added?: string | null) => void;
  /** Replace the cart without opening anything (the cart page after its own actions). */
  sync: (cart: CartView) => void;
  close: () => void;
};

const Ctx = createContext<MiniCartCtx | null>(null);

export function useMiniCart(): MiniCartCtx | null {
  return useContext(Ctx);
}

export function MiniCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartView | null>(null);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const show = useCallback((c: CartView, a?: string | null) => {
    setCart(c);
    setAdded(a ?? null);
    setOpen(true);
  }, []);
  const sync = useCallback((c: CartView) => setCart(c), []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ cart, show, sync, close }), [cart, show, sync, close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {cart ? <MiniCart open={open} onClose={close} cart={cart} added={added} /> : null}
    </Ctx.Provider>
  );
}

export type MiniCartProps = { open: boolean; onClose: () => void; cart: CartView; added?: string | null };

export function MiniCart({ open, onClose, cart, added }: MiniCartProps) {
  const { lines, more } = miniCartLines(cart, 3);
  const s = cart.summary;
  const reason = checkoutReason(cart, s.buyCount);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={380}
      title={`Cart · ${formatNumber(s.headerCount)}`}
      closeLabel="Close the cart"
      data-testid="mini-cart"
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ods-body text-ods-slate">Buy now subtotal</span>
            <span className="text-ods-body font-bold text-ods-navy">
              <Money amount={s.subtotalMinor / 100} />
            </span>
          </div>
          <Button href={CHECKOUT_PATH} fullWidth disabled={!!reason} disabledReason={reason ?? undefined} onClick={onClose} data-testid="mini-cart-checkout">
            Checkout
          </Button>
          <Button href={CART_PATH} variant="secondary" iconStart={Eye} fullWidth onClick={onClose} data-testid="mini-cart-view">
            View cart
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {added ? (
          <p role="status" className="m-0 flex items-start gap-2 rounded-ods-control bg-ods-success-tint px-3 py-2 text-ods-small font-semibold text-ods-navy" data-testid="mini-cart-added">
            <Icon icon={Check} size="sm" className="mt-0.5 shrink-0 text-ods-success" />
            {added}
          </p>
        ) : null}
        <section aria-labelledby="mini-cart-buy">
          <h3 id="mini-cart-buy" className="m-0 border-b border-ods-line pb-2 text-ods-body font-bold text-ods-navy">
            Buy now ({formatNumber(s.buyCount)})
          </h3>
          {lines.length ? (
            <ul role="list" className="m-0 list-none p-0">
              {lines.map((l) => (
                <li key={l.id} className="flex gap-3 border-b border-ods-line py-3" data-testid="mini-cart-line">
                  <LineImage image={l.image} size={48} />
                  <div className="min-w-0 flex-1">
                    <KindTag kind={l.kind} />
                    <p className="m-0 mt-1 truncate text-ods-table font-semibold text-ods-navy">{l.title}</p>
                    <p className="m-0 text-ods-small text-ods-slate">
                      Quantity {formatNumber(l.qty)}
                      {l.kind === 'pool' && l.depositMinor != null ? ' · deposit held' : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-ods-table font-semibold text-ods-navy">
                    <Money amount={dueNowMinor(l) / 100} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 py-3 text-ods-small text-ods-slate">Nothing to buy now yet.</p>
          )}
          {more ? (
            <Link href={CART_PATH} onClick={onClose} className="mt-2 inline-flex min-h-ods-control items-center text-ods-small font-semibold text-ods-blue underline underline-offset-4">
              + {formatNumber(more)} more
            </Link>
          ) : null}
        </section>
        <p className="m-0 flex flex-wrap items-center gap-x-2 text-ods-small text-ods-text" data-testid="mini-cart-quote">
          <strong className="text-ods-navy">Get a quote ({formatNumber(s.quoteCount)})</strong>
          {s.quoteCount ? (
            <Link href={cartTabHref('quote')} onClick={onClose} className="inline-flex min-h-ods-control items-center font-semibold text-ods-blue underline underline-offset-4">
              Open
            </Link>
          ) : (
            <span className="text-ods-slate">Products that need a factory price go here.</span>
          )}
        </p>
      </div>
    </Drawer>
  );
}
