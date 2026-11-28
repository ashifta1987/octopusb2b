'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LayoutGrid, ShoppingCart, Store, UserRound, Users, ChevronRight } from 'lucide-react';
import { BottomNav, Icon, SectionBar, Sheet, ShopHeader, type BottomNavItem, type MegaMenuColumn } from '@octopus/ui';
import { bottomNavForPath, categoryProductsHref, sectionBarItems, sectionForPath, SHOP_PATHS } from '../_lib/sections';
import type { CartView } from '../_lib/cart-types';
import { useMiniCart } from './mini-cart';

/**
 * ODS T4 · Shop frame (Part 5.1), presentational (props only — the layout and the fixtures pass the data):
 *  - ShopTop: ShopHeader (68 px navy; search combobox with suggestions; Cart (n) = all cart lines (T5a: the cart's
 *    headerCount; the latest count from the mini-cart context after an add); a click on Cart opens the mini-cart on
 *    desktop (≥ 768 px) and goes to /shop/cart on phones; notifications →
 *    My account › Notifications in the account tab; My account ↗) + SectionBar (44 px white, All categories ▾ mega menu,
 *    sections with More ▾ overflow, wallet balance; selected by the PUBLIC path). The SectionBar is hidden on phones
 *    (the BottomNav + Categories sheet replace it there).
 *  - ShopBottomNav (phones < 768 px): Shop · Categories (bottom Sheet) · Pools · Cart (n) · My account.
 */

export type FrameCategory = { slug: string; name: string; children?: { slug: string; name: string }[] };

export type ShopTopProps = {
  /** Fallback count when no cart is loaded (the quote-list count). */
  cartCount: number;
  /** The company cart (T5a) for the header count and the mini-cart; null when it couldn't be loaded. */
  cart?: CartView | null;
  unread: number;
  /** US$; null/undefined hides the wallet item. */
  walletAvailable?: number | null;
  categories: FrameCategory[];
  poolsOn: boolean;
  turnkeyOn: boolean;
  suggestUrl?: string;
  defaultQuery?: string;
  /** Overrides the path used to pick the selected section (fixtures). */
  path?: string;
  /** Sticky header (default true); false for fixtures/demos. */
  sticky?: boolean;
};

export function megaMenuFrom(categories: FrameCategory[]): { columns: MegaMenuColumn[]; promo: { title: string; body: string; href: string; linkLabel: string } } {
  const withKids = categories.slice(0, categories.length > 4 ? 3 : 4);
  const rest = categories.slice(withKids.length);
  const columns: MegaMenuColumn[] = withKids.map((c) => ({
    title: c.name,
    href: categoryProductsHref(c.slug),
    links: [...(c.children ?? []).slice(0, 6).map((k) => ({ label: k.name, href: categoryProductsHref(k.slug) })), { label: `All ${c.name.toLowerCase()}`, href: categoryProductsHref(c.slug) }],
  }));
  if (rest.length) {
    columns.push({
      title: 'More categories',
      links: [...rest.slice(0, 8).map((c) => ({ label: c.name, href: categoryProductsHref(c.slug) })), { label: 'All products', href: '/shop/products' }],
    });
  }
  return {
    columns,
    promo: { title: 'Can’t find it?', body: 'Tell us the product, quantity and target price. Our sourcing team finds it and sends you quotes.', href: SHOP_PATHS.requestProduct, linkLabel: 'Request a product' },
  };
}

export function ShopTop({ cartCount, cart, unread, walletAvailable, categories, poolsOn, turnkeyOn, suggestUrl, defaultQuery, path, sticky = true }: ShopTopProps) {
  const pathname = usePathname();
  const router = useRouter();
  const mini = useMiniCart();
  const view = mini?.cart ?? cart ?? null;
  const current = sectionForPath(path ?? pathname);
  const onCartClick =
    mini && view
      ? () => {
          // phones (and the cart page itself) go to /shop/cart; desktop opens the mini-cart drawer
          if (window.matchMedia('(max-width: 767px)').matches || (path ?? pathname) === SHOP_PATHS.cart) router.push(SHOP_PATHS.cart);
          else mini.show(view);
        }
      : undefined;
  return (
    <>
      <ShopHeader
        sticky={sticky}
        cartCount={view?.summary.headerCount ?? cartCount}
        cartHref={SHOP_PATHS.cart}
        onCartClick={onCartClick}
        notificationsCount={unread}
        notificationsHref={SHOP_PATHS.notifications}
        accountHref={SHOP_PATHS.account}
        searchAction={SHOP_PATHS.search}
        suggestUrl={suggestUrl}
        defaultQuery={defaultQuery}
      />
      <SectionBar
        className="hidden ods-tablet:block"
        items={sectionBarItems({ poolsOn, turnkeyOn })}
        current={current}
        categories={categories.length ? megaMenuFrom(categories) : undefined}
        walletBalance={walletAvailable ?? undefined}
        walletHref={SHOP_PATHS.wallet}
        testId="section-bar"
        megaMenuTestIds={{ trigger: 'all-categories', panel: 'all-categories-panel' }}
      />
    </>
  );
}

/** Header placeholder while the session loads (same height; no counts, search still works without suggestions). */
export function ShopTopSkeleton() {
  return (
    <>
      <ShopHeader cartHref={SHOP_PATHS.cart} notificationsHref={SHOP_PATHS.notifications} searchAction={SHOP_PATHS.search} testId="shop-header-loading" />
      <div aria-hidden className="hidden h-ods-control border-b border-ods-line bg-ods-surface ods-tablet:block" />
    </>
  );
}

export type ShopBottomNavProps = { cartCount: number; categories: FrameCategory[]; poolsOn: boolean; path?: string; fixed?: boolean };

export function ShopBottomNav({ cartCount: countProp, categories, poolsOn, path, fixed = true }: ShopBottomNavProps) {
  const pathname = usePathname();
  const mini = useMiniCart();
  const cartCount = mini?.cart?.summary.headerCount ?? countProp;
  const [open, setOpen] = useState(false);
  const items: BottomNavItem[] = [
    { id: 'shop', label: 'Shop', icon: Store, href: SHOP_PATHS.home },
    { id: 'categories', label: 'Categories', icon: LayoutGrid },
    ...(poolsOn ? [{ id: 'pools', label: 'Pools', icon: Users, href: '/shop/pools' }] : []),
    { id: 'cart', label: 'Cart', icon: ShoppingCart, href: SHOP_PATHS.cart },
    { id: 'account', label: 'My account', icon: UserRound, href: SHOP_PATHS.account },
  ];
  return (
    <div className="ods-tablet:hidden">
      <BottomNav
        items={items}
        counts={{ cart: cartCount }}
        value={open ? 'categories' : bottomNavForPath(path ?? pathname)}
        expandedId={open ? 'categories' : undefined}
        onAction={(id) => id === 'categories' && setOpen(true)}
        fixed={fixed}
        label="Shop"
        testId="shop-bottom-nav"
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="Categories" testId="categories-sheet">
        <ul className="m-0 grid list-none p-0">
          <li>
            <Link href="/shop/products" onClick={() => setOpen(false)} className="flex min-h-ods-control items-center justify-between border-b border-ods-line px-1 text-ods-body font-semibold text-ods-navy">
              All products
              <Icon icon={ChevronRight} size="sm" className="rtl:-scale-x-100" />
            </Link>
          </li>
          {categories.map((c) => (
            <li key={c.slug}>
              <Link href={categoryProductsHref(c.slug)} onClick={() => setOpen(false)} className="flex min-h-ods-control items-center justify-between border-b border-ods-line px-1 text-ods-body text-ods-text">
                {c.name}
                <Icon icon={ChevronRight} size="sm" className="rtl:-scale-x-100" />
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}
