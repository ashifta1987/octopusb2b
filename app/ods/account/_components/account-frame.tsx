'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import {
  ArrowUpRight, Bell, Box, ChevronRight, CircleHelp, FileText, Flag, Home, Layers, Lock, LogOut, Menu as MenuIcon, Package, Plus, Receipt, Sparkles, Store, Truck, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  AccountSidebar, AccountTopbar, BottomNav, Icon, NamedTabLink, Sheet, SignOutButton, broadcastAuth, buttonClass,
  type AccountSidebarGroup, type BottomNavItem,
} from '@octopus/ui';
import { usePhone } from '@octopus/ui/hooks';
import { ACCOUNT_PATHS, MORE_SHEET_IDS, accountNavCurrent, bottomNavCurrent, buildAccountNav, type AccountNavId } from '../_lib/nav';
import type { AccountFrameData } from '../_lib/types';
import { dropshipNavCurrent } from '../_lib/dropship-nav';

/**
 * ODS T6 · My account frame (Part 6.1), presentational client pieces (props only — the layout and the fixtures pass the
 * data). The current item comes from the PUBLIC path (usePathname; `path` overrides it in fixtures).
 *  - AccountSidebarNav: AccountSidebar (navy 248 px → 72 px icons under 1200 px; the choice is remembered in
 *    localStorage `ods:account-sidebar:collapsed`). Groups Overview · Services · Money · Account, red counts, "Start" on
 *    services not started, 3 px teal bar + aria-current on the current item, Browse products ↗ (Shop tab) at the bottom.
 *    Company: name only (one login = one company today); the switcher menu appears when `companies` has 2+ entries.
 *  - AccountTop: AccountTopbar — search (GET /account/requests?q=), New request (today's /request/sourcing), shop icon
 *    "Go to the main page" (Shop tab; same tab on phones), notifications (count → /account/notifications), help
 *    (→ /account/support), user menu (Team and settings, Notifications, Sign out — tells the other tabs first, Part 4.6).
 *    Phones: navy header (logo → /shop, shop icon, bell, avatar) with the search below.
 *  - AccountBottomBar (phones < 768): BottomNav Home · Requests · Orders · Wallet · More; More opens a Sheet with the rest,
 *    New request, Browse products ↗ and Sign out.
 *  - T7 (Part 6.6): `data.dropshipChildren` expands Dropshipping into its sub-items (sidebar: shown while a Dropshipping
 *    page is current; phones: listed under Dropshipping in the More sheet). The current sub-item comes from the path +
 *    `?list=1` (Import list) via dropshipNavCurrent(); `search` overrides the query in fixtures. Test ids:
 *    `dropship-group` (the item), `dropship-sidebar` (its sub-list, like today's merchant menu), `dropship-nav-item` /
 *    `locked-nav-item` (+ data-item) on the sub-items.
 */

export const ACCOUNT_NAV_ICONS: Record<AccountNavId, LucideIcon> = {
  home: Home,
  action: Flag,
  requests: Box,
  orders: Truck,
  turnkey: Layers,
  warehouse: Package,
  shipping: Truck,
  brand: Sparkles,
  dropship: Store,
  wallet: Wallet,
  invoices: Receipt,
  settings: Users,
  support: CircleHelp,
};

const DROPSHIP_NOTE = 'Activate dropshipping to open these pages.';

function navGroups(data: AccountFrameData) {
  return buildAccountNav({ counts: data.counts, started: data.started, dropshipChildren: data.dropshipChildren });
}

export function sidebarGroups(data: AccountFrameData): AccountSidebarGroup[] {
  return navGroups(data).map((g) => ({
    id: g.id,
    label: g.label,
    items: g.items.map((it) =>
      it.id === 'dropship' && it.children
        ? {
            ...it,
            icon: ACCOUNT_NAV_ICONS[it.id],
            testId: 'dropship-group',
            childrenTestId: 'dropship-sidebar',
            childrenNote: it.children.some((c) => c.locked) ? DROPSHIP_NOTE : undefined,
            children: it.children.map((c) => ({ ...c, testId: c.locked ? 'locked-nav-item' : 'dropship-nav-item' })),
          }
        : { ...it, icon: ACCOUNT_NAV_ICONS[it.id] },
    ),
  }));
}

/** Sidebar / More-sheet current id: a Dropshipping sub-item when one matches, else the main item. */
export function frameCurrent(data: AccountFrameData, path: string | null | undefined, search: string | URLSearchParams | null | undefined): string | undefined {
  return dropshipNavCurrent(path, search, data.dropshipChildren ?? []) ?? accountNavCurrent(path);
}

export type AccountSidebarNavProps = { data: AccountFrameData; path?: string; search?: string; collapsed?: boolean };

export function AccountSidebarNav(props: AccountSidebarNavProps) {
  // useSearchParams (Import list = ?list=1) needs a Suspense boundary under Cache Components; the fallback is the same
  // sidebar without the query, so nothing moves when it resolves.
  return (
    <Suspense fallback={<SidebarView {...props} query={props.search ?? null} />}>
      <SidebarWithQuery {...props} />
    </Suspense>
  );
}

function SidebarWithQuery(props: AccountSidebarNavProps) {
  const sp = useSearchParams();
  return <SidebarView {...props} query={props.search ?? sp} />;
}

function SidebarView({ data, path, collapsed, query }: AccountSidebarNavProps & { query: string | URLSearchParams | null }) {
  const pathname = usePathname();
  return (
    <AccountSidebar
      groups={sidebarGroups(data)}
      current={frameCurrent(data, path ?? pathname, query)}
      companies={data.companies}
      companyId={data.company.id}
      collapsed={collapsed}
      browseHref={ACCOUNT_PATHS.browse}
      testId="account-sidebar"
    />
  );
}

export type AccountTopProps = { data: AccountFrameData; defaultQuery?: string };

export function AccountTop({ data, defaultQuery }: AccountTopProps) {
  const phone = usePhone();
  const signOut = useRef<HTMLFormElement>(null);
  return (
    <>
      <AccountTopbar
        testId="account-topbar"
        user={{ name: data.user.name, email: data.user.email ?? undefined }}
        searchAction={ACCOUNT_PATHS.search}
        defaultQuery={defaultQuery}
        newRequestHref={ACCOUNT_PATHS.newRequest}
        notificationsCount={data.unread}
        notificationsHref={ACCOUNT_PATHS.notifications}
        helpHref={ACCOUNT_PATHS.support}
        sameTab={phone}
        userMenuItems={[
          { id: 'settings', label: 'Team and settings', icon: Users, href: ACCOUNT_PATHS.settings },
          { id: 'notifications', label: 'Notifications', icon: Bell, href: ACCOUNT_PATHS.notifications },
          {
            id: 'sign-out',
            label: 'Sign out',
            icon: LogOut,
            separatorBefore: true,
            // same as SignOutButton: tell the other tabs first (BroadcastChannel 'octopus-auth'), then POST /auth/signout
            onSelect: () => {
              broadcastAuth({ type: 'signed-out' });
              signOut.current?.requestSubmit();
            },
          },
        ]}
      />
      <form ref={signOut} action="/auth/signout" method="post" hidden aria-hidden="true" />
    </>
  );
}

export type AccountBottomBarProps = { data: AccountFrameData; path?: string; search?: string; fixed?: boolean; defaultOpen?: boolean };

const MORE_LINK = 'flex min-h-ods-control items-center gap-3 border-b border-ods-line px-1 text-ods-body text-ods-text no-underline hover:bg-ods-canvas';

export function AccountBottomBar(props: AccountBottomBarProps) {
  // same pattern as the sidebar: ?list=1 (Import list) via useSearchParams inside its own Suspense boundary
  return (
    <Suspense fallback={<BottomBarView {...props} query={props.search ?? null} />}>
      <BottomBarWithQuery {...props} />
    </Suspense>
  );
}

function BottomBarWithQuery(props: AccountBottomBarProps) {
  const sp = useSearchParams();
  return <BottomBarView {...props} query={props.search ?? sp} />;
}

function BottomBarView({ data, path, fixed = true, defaultOpen = false, query }: AccountBottomBarProps & { query: string | URLSearchParams | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);
  const current = frameCurrent(data, path ?? pathname, query);
  const flat = navGroups(data).flatMap((g) => g.items);
  const more = MORE_SHEET_IDS.map((id) => flat.find((i) => i.id === id)!).filter(Boolean);
  const items: BottomNavItem[] = [
    { id: 'home', label: 'Home', icon: Home, href: ACCOUNT_PATHS.home },
    { id: 'requests', label: 'Requests', icon: FileText, href: ACCOUNT_PATHS.requests },
    { id: 'orders', label: 'Orders', icon: Truck, href: ACCOUNT_PATHS.orders },
    { id: 'wallet', label: 'Wallet', icon: Wallet, href: ACCOUNT_PATHS.wallet },
    { id: 'more', label: 'More', icon: MenuIcon },
  ];
  const moreCount = more.reduce((n, i) => n + (i.count ?? 0), 0);
  return (
    <div className="ods-tablet:hidden">
      <BottomNav
        items={items}
        counts={{ requests: data.counts.requests, orders: data.counts.orders, more: moreCount }}
        value={open ? 'more' : bottomNavCurrent(path ?? pathname)}
        expandedId={open ? 'more' : undefined}
        onAction={(id) => id === 'more' && setOpen(true)}
        fixed={fixed}
        label="My account"
        testId="account-bottom-nav"
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="More" testId="more-sheet" closeOnBack={!defaultOpen}>
        <ul className="m-0 grid list-none p-0">
          {more.map((it) => (
            <li key={it.id}>
              <Link href={it.href} onClick={() => setOpen(false)} aria-current={current === it.id ? 'page' : undefined} className={MORE_LINK}>
                <Icon icon={ACCOUNT_NAV_ICONS[it.id]} className="text-ods-slate" />
                <span className="min-w-0 flex-1">{it.label}</span>
                {it.count ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-ods-pill bg-ods-danger px-1.5 text-[11px] leading-5 font-semibold text-white tabular-nums">
                    {it.count}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
                {it.notStarted ? <span className="rounded-ods-pill border border-ods-line-strong px-2 text-[11px] leading-5 font-semibold text-ods-slate">Start</span> : null}
                <Icon icon={ChevronRight} size="sm" className="text-ods-slate rtl:-scale-x-100" />
              </Link>
              {it.id === 'dropship' && it.children?.length ? (
                <DropshipMoreList items={it.children} current={current} onNavigate={() => setOpen(false)} />
              ) : null}
            </li>
          ))}
          <li>
            <Link href={ACCOUNT_PATHS.notifications} onClick={() => setOpen(false)} className={MORE_LINK}>
              <Icon icon={Bell} className="text-ods-slate" />
              <span className="min-w-0 flex-1">Notifications</span>
              {data.unread ? <span className="text-ods-small text-ods-slate">{data.unread} unread</span> : null}
              <Icon icon={ChevronRight} size="sm" className="text-ods-slate rtl:-scale-x-100" />
            </Link>
          </li>
        </ul>
        <div className="mt-4 grid gap-2">
          <Link href={ACCOUNT_PATHS.newRequest} className={buttonClass('primary', 'md', true)}>
            <Icon icon={Plus} />
            New request
          </Link>
          <NamedTabLink tab="shop" href={ACCOUNT_PATHS.browse} className={buttonClass('secondary', 'md', true)}>
            <Icon icon={ArrowUpRight} className="rtl:-scale-x-100" />
            Browse products
          </NamedTabLink>
          <SignOutButton className={`${buttonClass('ghost', 'md', true)} text-ods-danger`}>Sign out</SignOutButton>
        </div>
      </Sheet>
    </div>
  );
}

const MORE_SUB_LINK = 'flex min-h-ods-control items-center gap-3 border-b border-ods-line ps-9 pe-1 text-ods-table text-ods-text no-underline hover:bg-ods-canvas';

/** Phones (Part 6.6 "the group opens from More"): the Dropshipping sub-items under Dropshipping in the More sheet. */
function DropshipMoreList({ items, current, onNavigate }: { items: NonNullable<ReturnType<typeof navGroups>[number]['items'][number]['children']>; current?: string; onNavigate: () => void }) {
  const locked = items.some((c) => c.locked);
  return (
    <div data-testid="more-dropship">
      {locked ? <p className="m-0 border-b border-ods-line py-2 ps-9 text-ods-small text-ods-slate">{DROPSHIP_NOTE}</p> : null}
      <ul className="m-0 grid list-none p-0" aria-label="Dropshipping pages">
        {items.map((c) => (
          <li key={c.id}>
            {c.locked ? (
              <span aria-disabled="true" title={c.lockedReason} data-testid="locked-nav-item" data-item={c.id} className={`${MORE_SUB_LINK} cursor-not-allowed text-ods-slate hover:bg-transparent`}>
                <span className="min-w-0 flex-1">{c.label}</span>
                <Icon icon={Lock} size="sm" />
                {c.lockedReason ? <span className="sr-only">{`, ${c.lockedReason}`}</span> : null}
              </span>
            ) : (
              <Link href={c.href} onClick={onNavigate} aria-current={current === c.id ? 'page' : undefined} aria-label={c.ariaLabel} data-testid="dropship-nav-item" data-item={c.id} className={`${MORE_SUB_LINK} aria-[current=page]:font-semibold aria-[current=page]:text-ods-navy`}>
                <span className="min-w-0 flex-1">{c.label}</span>
                <Icon icon={ChevronRight} size="sm" className="text-ods-slate rtl:-scale-x-100" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
