'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { ArrowUpRight, Building2, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Logo } from '../logo';
import { LOGO_ALT, SHOP_TAB } from '../logo-href';
import { useMediaQuery, useStoredState } from '../hooks';
import { useOverflowing } from './use-overflowing';
import { CountBadge } from './button';
import { Tooltip } from './tooltip';
import { MenuButton } from './menu-button';

export type AccountSidebarItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Red count: how many things wait here. */
  count?: number;
  /** A service the company doesn't use yet: shows "Start" and sits at the end of its group. */
  notStarted?: boolean;
  /** Sub-items (e.g. Dropshipping), shown while the item or one of them is current. */
  children?: Omit<AccountSidebarItem, 'children' | 'icon'>[];
};
export type AccountSidebarGroup = { id: string; label: string; items: AccountSidebarItem[] };
export type AccountSidebarCompany = { id: string; name: string };

export type AccountSidebarProps = {
  /** Overview · Services · Money · Account, with real items and counts from the page. */
  groups: AccountSidebarGroup[];
  /** Id of the current item (or sub-item). */
  current?: string;
  companies?: AccountSidebarCompany[];
  companyId?: string;
  onCompanyChange?: (id: string) => void;
  /** Controlled collapsed state. Default: remembered choice, else collapsed under 1200 px. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** localStorage key of the remembered choice. */
  storageKey?: string;
  browseHref?: string;
  /** Phones: open the Shop in the same tab. */
  sameTab?: boolean;
  /** Landmark name (default "My account"). */
  label?: string;
  /** Extra content above Browse products (e.g. help card). */
  footer?: ReactNode;
  className?: string;
};

const itemCls = (current: boolean, collapsed: boolean, muted?: boolean) =>
  cx(
    'relative flex min-h-ods-control items-center gap-3 rounded-ods-control text-ods-table no-underline transition-colors duration-(--ods-motion-fast)',
    collapsed ? 'size-ods-control min-h-0 justify-center' : 'w-full px-3',
    current ? 'border-s-[3px] border-ods-teal bg-ods-navy-hover font-bold text-white' : cx('hover:bg-ods-navy-hover', muted ? 'text-white/75' : 'text-white/90'),
    current && !collapsed && 'ps-[9px]',
  );

/**
 * AccountSidebar (My account, tab 3): 248 px navy, collapsing to 72 px icons with tooltips. Logo with tagline
 * (→ /shop in the Shop tab); company switcher (menu); groups with red counts; current item = lighter navy, bold, 3 px
 * teal bar and aria-current="page"; services not started show "Start"; "Browse products ↗" at the bottom.
 * Collapse: the toggle at the top; the choice is remembered (localStorage); with no choice it collapses under 1200 px.
 * Collapsed icons keep their name (aria-label) and a tooltip. Phones (< 768): not shown — My account uses the
 * navy phone header + BottomNav (More opens a Sheet with the rest of these links).
 */
export function AccountSidebar({
  groups,
  current,
  companies = [],
  companyId,
  onCompanyChange,
  collapsed: collapsedProp,
  onCollapsedChange,
  storageKey = 'ods:account-sidebar:collapsed',
  browseHref = '/shop/products',
  sameTab,
  label = 'My account',
  footer,
  className,
}: AccountSidebarProps) {
  const id = useId();
  const narrow = useMediaQuery('(max-width: 1199px)');
  const [stored, setStored] = useStoredState<boolean | null>(storageKey, null);
  const collapsed = collapsedProp ?? stored ?? narrow;
  const toggle = () => {
    setStored(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const [listRef, listOver] = useOverflowing<HTMLDivElement>();
  const company = companies.find((c) => c.id === companyId) ?? companies[0];
  const shopTarget = sameTab ? undefined : SHOP_TAB;

  const withTip = (name: string, el: ReactNode) =>
    collapsed ? (
      <Tooltip content={name} side="end">
        {el as React.ReactElement}
      </Tooltip>
    ) : (
      el
    );

  return (
    <nav
      aria-label={label}
      data-collapsed={collapsed}
      className={cx('relative flex h-full shrink-0 flex-col bg-ods-navy text-white transition-[width] duration-(--ods-motion) ease-ods motion-reduce:transition-none', collapsed ? 'w-[72px]' : 'w-[248px]', className)}
    >
      <div className={cx('flex items-center gap-2 pt-4', collapsed ? 'flex-col px-2' : 'ps-3 pe-10')}>
        {collapsed ? (
          <Link href="/shop" target={shopTarget} className="inline-flex rounded-ods-control">
            <Image src="/images/ods/icons/icon-192.png" alt={LOGO_ALT} width={40} height={40} />
            {shopTarget ? <span className="sr-only">(opens the Shop tab)</span> : null}
          </Link>
        ) : (
          <Logo variant="white-tagline" area="account" sameTab={sameTab} />
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={`${id}-list`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cx('inline-grid shrink-0 place-items-center rounded-ods-control text-white/90 hover:bg-white/10', collapsed ? 'size-ods-control' : 'absolute top-1 end-1 size-8')}
        >
          <Icon icon={collapsed ? PanelLeftOpen : PanelLeftClose} className="rtl:-scale-x-100" />
        </button>
      </div>

      {company ? (
        <div className={cx('mt-4', collapsed ? 'px-3' : 'px-3')}>
          <MenuButton
            className={collapsed ? '' : 'w-full'}
            showChevron={false}
            triggerAriaLabel={collapsed ? `Company: ${company.name}. Switch company` : undefined}
            label={
              collapsed ? (
                <span aria-hidden className="inline-grid size-full place-items-center">
                  <Icon icon={Building2} />
                </span>
              ) : (
                <>
                  <Icon icon={Building2} />
                  <span className="min-w-0 flex-1 truncate text-start">
                    <span className="sr-only">Company: </span>
                    {company.name}
                  </span>
                  <Icon icon={ChevronsUpDown} />
                </>
              )
            }
            menuLabel="Switch company"
            items={companies.map((c) => ({ id: c.id, label: c.name, checked: c.id === company.id, onSelect: () => onCompanyChange?.(c.id) }))}
            triggerClassName={cx(
              'flex items-center gap-2 rounded-ods-control border border-white/20 text-ods-table font-semibold text-white hover:bg-white/10',
              collapsed ? 'size-ods-control justify-center' : 'h-ods-control w-full px-3',
            )}
          />
        </div>
      ) : null}

      <div ref={listRef} id={`${id}-list`} className={cx('mt-3 min-h-0 flex-1 px-3 pb-3', (!collapsed || listOver) && 'overflow-y-auto')}>
        {groups.map((g) => {
          const gid = `${id}-${g.id}`;
          const sorted = [...g.items.filter((i) => !i.notStarted), ...g.items.filter((i) => i.notStarted)];
          return (
            <div key={g.id} className={cx('mt-3 first:mt-0', collapsed && 'border-t border-white/15 pt-3 first:border-t-0 first:pt-0')}>
              <p id={gid} className={cx(collapsed ? 'sr-only' : 'px-3 pb-1 text-[11px] font-semibold tracking-wide text-white/75 uppercase')}>
                {g.label}
              </p>
              <ul aria-labelledby={gid} className={cx('grid gap-0.5', collapsed && 'justify-center')}>
                {sorted.map((it) => {
                  const childCurrent = it.children?.some((c) => c.id === current) ?? false;
                  const isCurrent = it.id === current;
                  const name = `${it.label}${it.count ? `, ${it.count} waiting` : ''}${it.notStarted ? ', not started' : ''}`;
                  return (
                    <li key={it.id}>
                      {withTip(
                        it.label,
                        <Link
                          href={it.href}
                          aria-current={isCurrent ? 'page' : undefined}
                          aria-label={collapsed ? name : undefined}
                          className={itemCls(isCurrent || (collapsed && childCurrent), collapsed, it.notStarted)}
                        >
                          <Icon icon={it.icon} />
                          {collapsed ? (
                            it.count ? <CountBadge count={it.count} decorative className="absolute -top-1 -end-1" /> : null
                          ) : (
                            <>
                              <span className="min-w-0 flex-1 truncate">{it.label}</span>
                              {it.count ? <CountBadge count={it.count} label={it.count === 1 ? 'item waiting' : 'items waiting'} /> : null}
                              {it.notStarted ? <span className="rounded-ods-pill border border-ods-teal/70 px-2 text-[11px] leading-5 font-semibold text-ods-teal">Start</span> : null}
                            </>
                          )}
                        </Link>,
                      )}
                      {!collapsed && it.children && (isCurrent || childCurrent) ? (
                        <ul className="mt-0.5 ms-6 grid gap-0.5 border-s border-white/15 ps-2">
                          {it.children.map((c) => (
                            <li key={c.id}>
                              <Link href={c.href} aria-current={c.id === current ? 'page' : undefined} className={cx(itemCls(c.id === current, false), 'min-h-[calc(var(--ods-control-h)-8px)]')}>
                                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                {c.count ? <CountBadge count={c.count} label="waiting" /> : null}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {footer && !collapsed ? <div className="px-3 pb-3">{footer}</div> : null}
      <div className={cx('border-t border-white/15 py-3', collapsed ? 'flex justify-center px-3' : 'px-3')}>
        {withTip(
          'Browse products',
          <Link
            href={browseHref}
            target={shopTarget}
            aria-label={collapsed ? `Browse products${shopTarget ? ' (opens the Shop tab)' : ''}` : undefined}
            className={cx(itemCls(false, collapsed), 'font-semibold text-ods-teal')}
          >
            <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
            {collapsed ? null : (
              <span>
                Browse products
                {shopTarget ? <span className="sr-only"> (opens the Shop tab)</span> : null}
              </span>
            )}
          </Link>,
        )}
      </div>
    </nav>
  );
}
