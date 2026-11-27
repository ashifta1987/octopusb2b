'use client';

import Link from 'next/link';
import { Bell, Home, LayoutGrid, Menu, Search, ShoppingCart, Store, Truck, UserRound, Users, Wallet, CheckSquare, FileText, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';

export type BottomNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Link target; items without href render as buttons and call onAction (Categories, More, Search …). */
  href?: string;
  count?: number;
  /** For button items that open a sheet: their sheet is open (aria-expanded). */
  expanded?: boolean;
};

export type BottomNavPreset = 'shop' | 'account' | 'office';

export type BottomNavProps = {
  /** Shop: Shop · Categories · Pools · Cart · My account. My account: Home · Requests · Orders · Wallet · More. Back Office: Home · Approvals · Search · Alerts. */
  preset?: BottomNavPreset;
  /** Replaces the preset items. */
  items?: BottomNavItem[];
  /** Badges by item id, e.g. { cart: 3 }. */
  counts?: Record<string, number>;
  /** Overrides hrefs by item id. */
  hrefs?: Record<string, string>;
  /** Id of the current item (blue + top bar + aria-current="page"). */
  value?: string;
  /** Called for button items (no href), e.g. 'categories' or 'more' to open a Sheet. */
  onAction?: (id: string) => void;
  /** Ids of button items whose sheet is open. */
  expandedId?: string;
  /** Fixed to the bottom of the viewport (default). Set false to render inline (demos). */
  fixed?: boolean;
  /** Landmark name (default "Main"). */
  label?: string;
  testId?: string;
  className?: string;
};

const PRESETS: Record<BottomNavPreset, BottomNavItem[]> = {
  shop: [
    { id: 'shop', label: 'Shop', icon: Store, href: '/shop' },
    { id: 'categories', label: 'Categories', icon: LayoutGrid },
    { id: 'pools', label: 'Pools', icon: Users, href: '/shop/pools' },
    { id: 'cart', label: 'Cart', icon: ShoppingCart, href: '/shop/cart' },
    { id: 'account', label: 'My account', icon: UserRound, href: '/account' },
  ],
  account: [
    { id: 'home', label: 'Home', icon: Home, href: '/account' },
    { id: 'requests', label: 'Requests', icon: FileText, href: '/account/requests' },
    { id: 'orders', label: 'Orders', icon: Truck, href: '/account/orders' },
    { id: 'wallet', label: 'Wallet', icon: Wallet, href: '/account/wallet' },
    { id: 'more', label: 'More', icon: Menu },
  ],
  office: [
    { id: 'home', label: 'Home', icon: Home, href: '/office' },
    { id: 'approvals', label: 'Approvals', icon: CheckSquare, href: '/office/approvals' },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'alerts', label: 'Alerts', icon: Bell },
  ],
};

/**
 * BottomNav (phones only, < 768 px): 60 px bar fixed to the bottom with 4–5 items; labels always visible; icons 22 px;
 * red count badges (read out with the label); the current item is blue with a 3 px top bar and aria-current="page".
 * Items without href are buttons (Categories, More, Search, Alerts) that call `onAction` — e.g. open a Sheet; they
 * report aria-expanded when `expandedId` matches. Pages hide it from 768 px (`ods-tablet:hidden` on a wrapper) and add
 * bottom padding of 60 px + the safe area so content is not covered. Not density-dependent (phones are comfortable).
 */
export function BottomNav({ preset = 'shop', items, counts, hrefs, value, onAction, expandedId, fixed = true, label = 'Main', testId, className }: BottomNavProps) {
  const list = items ?? PRESETS[preset];
  return (
    <nav
      aria-label={label}
      data-testid={testId}
      className={cx(
        'border-t border-ods-line bg-ods-surface pb-[env(safe-area-inset-bottom)]',
        fixed ? 'fixed inset-x-0 bottom-0 z-(--z-sticky)' : 'relative',
        className,
      )}
    >
      <ul className="grid h-[60px] auto-cols-fr grid-flow-col">
        {list.map((it) => {
          const current = it.id === value;
          const count = counts?.[it.id] ?? it.count;
          const href = hrefs?.[it.id] ?? it.href;
          const cls = cx(
            'relative flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight',
            current ? 'font-bold text-ods-blue before:absolute before:inset-x-3 before:top-0 before:h-[3px] before:rounded-b-[3px] before:bg-ods-blue' : 'font-medium text-ods-slate hover:text-ods-navy',
          );
          const content = (
            <>
              <span className="relative">
                <Icon icon={it.icon} size="xl" />
                {count ? (
                  <span aria-hidden className="absolute -top-1.5 -end-2.5 inline-flex min-w-[18px] items-center justify-center rounded-ods-pill bg-ods-danger px-1 text-[10px] leading-[18px] font-semibold text-white tabular-nums">
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{it.label}</span>
              {count ? <span className="sr-only">({count})</span> : null}
            </>
          );
          return (
            <li key={it.id} className="min-w-0">
              {href ? (
                <Link href={href} aria-current={current ? 'page' : undefined} className={cls}>
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={it.expanded ?? expandedId === it.id}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => onAction?.(it.id)}
                  className={cls}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
