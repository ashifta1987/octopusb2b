'use client';

import Link from 'next/link';
import { useId, type FormEvent } from 'react';
import { ArrowUpRight, Bell, Search, ShoppingCart } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Logo } from '../logo';
import { ACCOUNT_TAB } from '../logo-href';
import { IconButton } from './button';

export type ShopHeaderProps = {
  cartCount?: number;
  notificationsCount?: number;
  onNotifications?: () => void;
  /** Search submit. Without it, the form does a GET to `searchAction` with `q`. */
  onSearch?: (query: string) => void;
  searchAction?: string;
  defaultQuery?: string;
  cartHref?: string;
  /** Opens the mini-cart drawer instead of following the link (desktop). */
  onCartClick?: () => void;
  accountHref?: string;
  /** Sticky at the top (default). Set false to render in place (demos). */
  sticky?: boolean;
  className?: string;
};

/**
 * ShopHeader (Shop, tab 2): 68 px navy (56 compact). White logo mark (→ /shop); search ("Search all products, MOQ pools
 * and turnkey projects", labelled, role="search"); Cart with count; notifications with count; "My account ↗" opening
 * the named My account tab (`target="octopus-account"`).
 * Phones (container < 768 px): logo, cart icon (count) and bell in the top row; search full width below; My account
 * moves to the BottomNav. Phones open everything in the same tab.
 */
export function ShopHeader({
  cartCount = 0,
  notificationsCount,
  onNotifications,
  onSearch,
  searchAction = '/shop/search',
  defaultQuery,
  cartHref = '/shop/cart',
  onCartClick,
  accountHref = '/account',
  sticky = true,
  className,
}: ShopHeaderProps) {
  const id = useId();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (!onSearch) return;
    e.preventDefault();
    onSearch(String(new FormData(e.currentTarget).get('q') ?? '').trim());
  };
  const search = (suffix: string, cls: string) => (
    <form role="search" action={searchAction} onSubmit={submit} className={cls}>
      <label htmlFor={`${id}-${suffix}`} className="sr-only">
        Search all products, MOQ pools and turnkey projects
      </label>
      <div className="relative">
        <Icon icon={Search} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ods-slate" />
        <input
          id={`${id}-${suffix}`}
          name="q"
          type="search"
          defaultValue={defaultQuery}
          placeholder="Search all products, MOQ pools and turnkey projects"
          autoComplete="off"
          className="h-ods-control w-full rounded-ods-control border border-transparent bg-ods-surface ps-10 pe-3 text-ods-body text-ods-text placeholder:text-ods-slate"
        />
      </div>
    </form>
  );
  const cartLabel = `(${cartCount} ${cartCount === 1 ? 'item' : 'items'})`;
  return (
    <header className={cx(sticky ? 'sticky top-0 z-(--z-sticky)' : 'relative', '@container bg-ods-navy text-white', className)}>
      <div className="mx-auto flex min-h-[calc(var(--ods-control-h)+24px)] max-w-ods-content items-center gap-3 px-ods-pad-page @min-[768px]:gap-5">
        <Logo variant="mark-white" area="shop" />
        {search('d', 'hidden max-w-[640px] flex-1 @min-[768px]:block')}
        <div className="ms-auto flex items-center gap-1 @min-[768px]:gap-2">
          <Link
            href={cartHref}
            onClick={
              onCartClick
                ? (e) => {
                    e.preventDefault();
                    onCartClick();
                  }
                : undefined
            }
            className="relative inline-flex h-ods-control min-w-ods-control items-center justify-center gap-2 rounded-ods-control px-2 font-semibold text-white hover:bg-white/10"
          >
            <Icon icon={ShoppingCart} />
            <span className="sr-only @min-[768px]:not-sr-only">Cart</span>
            {cartCount ? <span className="sr-only">{cartLabel}</span> : null}
            {cartCount ? (
              <span aria-hidden className="inline-flex min-w-5 items-center justify-center rounded-ods-pill bg-ods-teal px-1.5 text-[11px] leading-5 font-bold text-ods-navy tabular-nums @max-[767px]:absolute @max-[767px]:-top-1 @max-[767px]:-end-1">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            ) : null}
          </Link>
          <IconButton icon={Bell} label="Notifications" count={notificationsCount} variant="on-navy" onClick={onNotifications} />
          <Link
            href={accountHref}
            target={ACCOUNT_TAB}
            className="hidden h-ods-control items-center gap-1 rounded-ods-control border border-white/40 px-3 font-semibold whitespace-nowrap text-white hover:bg-white/10 @min-[768px]:inline-flex"
          >
            My account
            <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
            <span className="sr-only">(opens the My account tab)</span>
          </Link>
        </div>
      </div>
      {search('m', 'px-ods-pad-page pb-3 @min-[768px]:hidden')}
    </header>
  );
}
