'use client';

import Link from 'next/link';
import { useId, type FormEvent } from 'react';
import { Bell, CircleHelp, Plus, Search, Store, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { Icon } from '../icon';
import { Logo } from '../logo';
import { SHOP_TAB } from '../logo-href';
import { buttonClass } from '../styles';
import { IconButton } from './button';
import { Tooltip } from './tooltip';
import { MenuButton, type MenuButtonItem } from './menu-button';

export type AccountTopbarProps = {
  user: { name: string; email?: string };
  /** User menu (Profile, Team and settings, Sign out …). */
  userMenuItems: MenuButtonItem[];
  /** Search submit. Without it, the form does a GET to `searchAction` with `q`. */
  onSearch?: (query: string) => void;
  searchAction?: string;
  defaultQuery?: string;
  newRequestHref?: string;
  onNewRequest?: () => void;
  notificationsCount?: number;
  onNotifications?: () => void;
  /** T6: notifications as a link (wins over onNotifications). */
  notificationsHref?: string;
  onHelp?: () => void;
  /** T6: help as a link (wins over onHelp). */
  helpHref?: string;
  /** Phones: open the Shop in the same tab. */
  sameTab?: boolean;
  className?: string;
  testId?: string;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Icon-only link with the IconButton look (name + tooltip + optional count). */
function IconLink({ href, icon, label, count, onNavy }: { href: string; icon: LucideIcon; label: string; count?: number; onNavy?: boolean }) {
  const name = count ? `${label} (${count > 99 ? '99+' : count})` : label;
  return (
    <Tooltip content={label} side="bottom">
      <Link
        href={href}
        aria-label={name}
        className={cx(
          'relative inline-grid size-ods-control shrink-0 place-items-center rounded-ods-control border border-transparent transition-colors duration-(--ods-motion-fast)',
          onNavy ? 'text-white hover:bg-white/10' : 'text-ods-navy hover:bg-ods-blue-tint',
        )}
      >
        <Icon icon={icon} />
        {/* number drawn with CSS content, like IconButton (the name already says it) */}
        {count ? (
          <span
            aria-hidden="true"
            data-count={count > 99 ? '99+' : String(count)}
            className="absolute -top-1 -end-1 inline-flex min-w-5 items-center justify-center rounded-ods-pill bg-ods-danger px-1.5 text-[11px] leading-5 font-semibold text-white tabular-nums before:content-[attr(data-count)]"
          />
        ) : null}
      </Link>
    </Tooltip>
  );
}

/**
 * AccountTopbar (My account): search ("Search my requests, orders and invoices", labelled, role="search"); New request;
 * light-blue shop icon "Go to the main page" (→ /shop in the Shop tab); notifications (count); help; user menu
 * (menu button: aria-expanded, ↑ ↓, Esc returns focus).
 * Phones (container < 768 px): navy header with the white logo (→ /shop, same tab), shop icon and bell; search full
 * width below; New request, help and the name move to the BottomNav "More" sheet.
 * T6: `notificationsHref` / `helpHref` render those icons as links; `testId` on the header; the shop icon has
 * data-testid="shop-icon".
 */
export function AccountTopbar({
  user,
  userMenuItems,
  onSearch,
  searchAction = '/account/search',
  defaultQuery,
  newRequestHref = '/account/requests/new',
  onNewRequest,
  notificationsCount,
  onNotifications,
  notificationsHref,
  onHelp,
  helpHref,
  sameTab,
  className,
  testId,
}: AccountTopbarProps) {
  const id = useId();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    if (!onSearch) return;
    e.preventDefault();
    onSearch(String(new FormData(e.currentTarget).get('q') ?? '').trim());
  };
  const search = (suffix: string, cls: string) => (
    <form role="search" action={searchAction} onSubmit={submit} className={cls}>
      <label htmlFor={`${id}-${suffix}`} className="sr-only">
        Search my requests, orders and invoices
      </label>
      <div className="relative">
        <Icon icon={Search} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ods-slate" />
        <input
          id={`${id}-${suffix}`}
          name="q"
          type="search"
          defaultValue={defaultQuery}
          placeholder="Search my requests, orders and invoices"
          autoComplete="off"
          className="h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface ps-10 pe-3 text-ods-body text-ods-text placeholder:text-ods-slate"
        />
      </div>
    </form>
  );
  const shopTarget = sameTab ? undefined : SHOP_TAB;
  const bell = (onNavy: boolean) =>
    notificationsHref ? (
      <IconLink href={notificationsHref} icon={Bell} label="Notifications" count={notificationsCount} onNavy={onNavy} />
    ) : (
      <IconButton icon={Bell} label="Notifications" count={notificationsCount} variant={onNavy ? 'on-navy' : 'ghost'} onClick={onNotifications} />
    );
  return (
    <header className={cx('@container', className)} data-testid={testId}>
      <div className="border-b border-ods-line bg-ods-navy text-white @min-[768px]:bg-ods-surface @min-[768px]:text-ods-text">
      <div className="flex min-h-[calc(var(--ods-control-h)+20px)] items-center gap-3 px-ods-pad-page">
        <span className="@min-[768px]:hidden">
          <Logo variant="mark-white" area="account" sameTab height={24} />
        </span>
        {search('d', 'hidden max-w-[520px] flex-1 @min-[768px]:block')}
        <div className="ms-auto flex items-center gap-1 @min-[768px]:gap-2">
          <span className="hidden @min-[768px]:inline-flex">
            {onNewRequest ? (
              <button type="button" onClick={onNewRequest} className={buttonClass('primary')}>
                <Icon icon={Plus} />
                New request
              </button>
            ) : (
              <Link href={newRequestHref} className={buttonClass('primary')}>
                <Icon icon={Plus} />
                New request
              </Link>
            )}
          </span>
          <Tooltip content="Go to the main page" side="bottom">
            <Link
              href="/shop"
              target={shopTarget}
              data-testid="shop-icon"
              data-named-tab="shop"
              aria-label={`Go to the main page${shopTarget ? ' (opens the Shop tab)' : ''}`}
              className="inline-grid size-ods-control place-items-center rounded-ods-control bg-ods-blue-tint text-ods-blue hover:bg-ods-blue hover:text-white"
            >
              <Icon icon={Store} />
            </Link>
          </Tooltip>
          <span className="hidden @min-[768px]:contents">
            {bell(false)}
            {helpHref ? <IconLink href={helpHref} icon={CircleHelp} label="Help" /> : <IconButton icon={CircleHelp} label="Help" onClick={onHelp} />}
          </span>
          <span className="contents @min-[768px]:hidden">{bell(true)}</span>
          <MenuButton
            align="end"
            menuLabel="Account menu"
            header={
              <>
                <span className="block font-semibold text-ods-navy">{user.name}</span>
                {user.email ? <span className="block">{user.email}</span> : null}
              </>
            }
            items={userMenuItems}
            label={
              <>
                <span aria-hidden className="inline-grid size-8 place-items-center rounded-ods-pill bg-ods-teal text-[12px] font-bold text-ods-navy">
                  {initials(user.name)}
                </span>
                <span className="sr-only max-w-40 truncate font-semibold @min-[1000px]:not-sr-only">{user.name}</span>
              </>
            }
            triggerClassName="inline-flex h-ods-control items-center gap-2 rounded-ods-control px-1.5 text-current hover:bg-ods-blue-tint/20 @min-[768px]:hover:bg-ods-blue-tint"
          />
        </div>
      </div>
      {search('m', 'px-ods-pad-page pb-3 @min-[768px]:hidden')}
      </div>
    </header>
  );
}
