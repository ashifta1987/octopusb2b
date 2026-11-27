'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Store, LayoutGrid, Users, ClipboardList, User } from 'lucide-react';

/**
 * CH-1 phone bottom tabs (M_Shop_Home): Shop · Categories · Pools · Quote list · Account. Account opens the panel in the
 * SAME tab on phones (owner prompt §1). 56 px items, aria-current on the active tab, pads for the home indicator.
 */
export function ShopTabs({ quoteCount, poolsOn }: { quoteCount: number; poolsOn: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: '/shop', label: 'Shop', Icon: Store, on: path === '/shop' },
    { href: '/shop/products#categories', label: 'Categories', Icon: LayoutGrid, on: path.startsWith('/shop/products') },
    ...(poolsOn ? [{ href: '/shop/pools', label: 'Pools', Icon: Users, on: path.startsWith('/shop/pools') }] : []),
    { href: '/shop/quote-list', label: 'Quote list', Icon: ClipboardList, on: path.startsWith('/shop/quote-list'), badge: quoteCount },
    { href: '/account', label: 'Account', Icon: User, on: false },
  ];
  return (
    <nav aria-label="Shop" data-testid="shop-tabs" className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-line pb-[env(safe-area-inset-bottom)]">
      <ul className="grid list-none m-0 p-0" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(({ href, label, Icon, on, badge }) => (
          <li key={href}>
            <Link href={href} prefetch={false} aria-current={on ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11.5px] font-semibold ${on ? 'text-coral-text shadow-[inset_0_3px_0_var(--coral)]' : 'text-muted'}`}>
              <Icon size={22} strokeWidth={1.9} aria-hidden />
              {label}
              {!!badge && badge > 0 && (
                <span className="absolute top-1.5 left-[calc(50%+6px)] min-w-[18px] h-[18px] px-1 rounded-full bg-coral text-white text-[10.5px] font-bold leading-[18px] text-center" aria-label={`${badge} in your quote list`}>
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
