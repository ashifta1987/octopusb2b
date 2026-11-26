'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { DsIcon, DsTopBar, type DsIconName } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';
import { AppLogo } from './app-logo';
import { ALL_ON, isEarlyAccess, type DropshipFeatureKey, type DropshipFeatures } from '@/lib/dropship-features-shared';

export type MerchantNavItem = {
  href: string;
  label: string;
  icon: DsIconName;
  badge?: number;
  matchQuery?: string;
  /** EA-2: hidden while this feature is off */
  feature: DropshipFeatureKey;
  /** EA-2: only in the early-access menu (EA_Dashboard): "Product requests" sits under Sell */
  earlyAccessOnly?: boolean;
};

export type MerchantNavGroup = {
  title: string;
  items: MerchantNavItem[];
};

const MERCHANT_GROUPS: MerchantNavGroup[] = [
  {
    title: 'Sell',
    items: [
      { href: '/account/dropship', label: 'Dashboard', icon: 'grid', feature: 'dashboard' },
      { href: '/account/dropship/catalogue', label: 'Find products', icon: 'search', feature: 'find' },
      { href: '/account/dropship/requests', label: 'Product requests', icon: 'file', feature: 'requests', earlyAccessOnly: true },
      {
        href: '/account/dropship/catalogue?list=1',
        label: 'Import list',
        icon: 'list',
        matchQuery: 'list=1',
        feature: 'import_list',
      },
      { href: '/account/dropship/orders', label: 'Orders', icon: 'cart', feature: 'orders' },
    ],
  },
  {
    title: 'Set up',
    items: [
      { href: '/account/dropship/pricing', label: 'Pricing and sync', icon: 'tag', feature: 'pricing' },
      { href: '/account/dropship/packing', label: 'Packing and shipping', icon: 'package', feature: 'packing' },
      { href: '/account/dropship/stores', label: 'Stores', icon: 'store', feature: 'stores' },
      { href: '/account/dropship/integrations', label: 'Integrations', icon: 'link', feature: 'stores' },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/account/dropship/wallet', label: 'Wallet', icon: 'wallet', feature: 'wallet' },
      { href: '/account/dropship/billing', label: 'Plan and billing', icon: 'card', feature: 'billing' },
      { href: '/account/dropship/reports', label: 'Reports', icon: 'chart', feature: 'reports' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/account/dropship/settings', label: 'Settings', icon: 'gear', feature: 'settings' },
      { href: '/account/dropship/support', label: 'Support', icon: 'help', feature: 'support' },
    ],
  },
];

type PhoneTab = { href: string; label: string; icon: DsIconName; feature: DropshipFeatureKey };
const PHONE_TABS: PhoneTab[] = [
  { href: '/account/dropship', label: 'Home', icon: 'home', feature: 'dashboard' },
  { href: '/account/dropship/catalogue', label: 'Find', icon: 'search', feature: 'find' },
  { href: '/account/dropship/orders', label: 'Orders', icon: 'cart', feature: 'orders' },
  { href: '/account/dropship/wallet', label: 'Wallet', icon: 'wallet', feature: 'wallet' },
  { href: '/account/dropship/more', label: 'More', icon: 'more', feature: 'dashboard' },
];
// EA-2 (mobile/M_EA_Dashboard): Home · Find · Requests · Wallet · More
const EARLY_ACCESS_TABS: PhoneTab[] = [
  { href: '/account/dropship', label: 'Home', icon: 'home', feature: 'dashboard' },
  { href: '/account/dropship/catalogue', label: 'Find', icon: 'search', feature: 'find' },
  { href: '/account/dropship/requests', label: 'Requests', icon: 'file', feature: 'requests' },
  { href: '/account/dropship/wallet', label: 'Wallet', icon: 'wallet', feature: 'wallet' },
  { href: '/account/dropship/more', label: 'More', icon: 'more', feature: 'dashboard' },
];

function isMerchantItemActive(
  item: MerchantNavItem,
  pathname: string,
  isListParam: boolean,
  earlyAccess = false,
): boolean {
  if (earlyAccess && pathname.startsWith('/account/dropship/requests')) {
    return item.href === '/account/dropship/requests';
  }
  if (item.matchQuery === 'list=1') {
    return pathname === '/account/dropship/catalogue' && isListParam;
  }
  if (item.href === '/account/dropship/catalogue') {
    return (
      (pathname === '/account/dropship/catalogue' && !isListParam) ||
      pathname.startsWith('/account/dropship/catalogue/') ||
      pathname === '/account/dropship/landed-cost' ||
      pathname === '/account/dropship/requests' ||
      pathname === '/account/dropship/sample'
    );
  }
  if (item.href === '/account/dropship') {
    return pathname === '/account/dropship' || pathname === '/account/dropship/onboarding';
  }
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

function isPhoneTabActive(tabHref: string, pathname: string, isListParam = false, earlyAccess = false): boolean {
  if (earlyAccess && pathname.startsWith('/account/dropship/requests')) {
    return tabHref === '/account/dropship/requests';
  }
  if (tabHref === '/account/dropship/requests') {
    return pathname.startsWith('/account/dropship/requests');
  }
  if (tabHref === '/account/dropship') {
    return pathname === '/account/dropship' || pathname === '/account/dropship/onboarding';
  }
  if (tabHref === '/account/dropship/catalogue') {
    return (
      (pathname === '/account/dropship/catalogue' && !isListParam) ||
      pathname.startsWith('/account/dropship/catalogue/') ||
      pathname === '/account/dropship/landed-cost' ||
      pathname.startsWith('/account/dropship/requests') ||
      pathname.startsWith('/account/dropship/sample')
    );
  }
  if (tabHref === '/account/dropship/orders') {
    return (
      pathname === '/account/dropship/orders' ||
      pathname.startsWith('/account/dropship/orders/')
    );
  }
  if (tabHref === '/account/dropship/wallet') {
    return pathname.startsWith('/account/dropship/wallet');
  }
  return (
    pathname === '/account/dropship/more' ||
    (pathname === '/account/dropship/catalogue' && isListParam) ||
    pathname.startsWith('/account/dropship/pricing') ||
    pathname.startsWith('/account/dropship/packing') ||
    pathname.startsWith('/account/dropship/stores') ||
    pathname.startsWith('/account/dropship/integrations') ||
    pathname.startsWith('/account/dropship/billing') ||
    pathname.startsWith('/account/dropship/reports') ||
    pathname.startsWith('/account/dropship/settings') ||
    pathname.startsWith('/account/dropship/support') ||
    pathname.startsWith('/account/dropship/import') ||
    pathname.startsWith('/account/dropship/push') ||
    pathname.startsWith('/account/dropship/pushed')
  );
}

export function DropshipMerchantShell({
  dropshipEnabled = true,
  userName,
  initials,
  storeName,
  unreadCount = 0,
  importListCount = 0,
  ordersCount = 0,
  isStaging = false,
  features = ALL_ON,
  children,
}: {
  dropshipEnabled?: boolean;
  features?: DropshipFeatures;
  userName: string;
  initials: string;
  storeName?: string | null;
  unreadCount?: number;
  importListCount?: number;
  ordersCount?: number;
  isStaging?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isListParam = searchParams?.get('list') === '1';
  // Step U1 Rule 5: Store switcher shows "No store connected" until Step 5 connects a real store.
  const displayStore = storeName || 'No store connected';
  // EA-2: OFF features are hidden (no "coming soon" labels); early access trims the menu and tabs (EA_Dashboard)
  const earlyAccess = isEarlyAccess(features);
  const showStore = dropshipEnabled ? features.stores : true;
  const groups = MERCHANT_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => features[i.feature] && (!i.earlyAccessOnly || earlyAccess)),
  })).filter((g) => g.items.length > 0);
  const tabs = (earlyAccess ? EARLY_ACCESS_TABS : PHONE_TABS).filter((t) => features[t.feature]);

  // Design handoff 26 Nov 2026 (App shell §3): 264 px white sidebar (Octopus Dropship logo, store box, Jost group labels,
  // 44 px items), white top bar (search, 46 px icon buttons, user chip), Pearl main. Phones keep the top header, the
  // bottom 5 tabs and the More page.
  return (
    <div
      data-testid="dropship-merchant-shell"
      className={`${dsInter.variable} ds-v2 app-shell min-h-screen bg-pearl text-black app-cols md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[auto_1fr]`}
    >
      <a href="#ds-merchant-main" className="skip-link">Skip to content</a>
      {/* Phone Top Header (below 768px) — matches mobile/M_Dashboard.html */}
      <header
        data-testid="dropship-phone-header"
        className="md:hidden bg-white border-b border-line px-4 py-2.5 flex items-center gap-2 min-w-0"
      >
        <AppLogo variant="dropship" href="/account/dropship" label="Octopus Dropship" size="bar" />
        {!showStore ? <span className="ml-auto" /> : dropshipEnabled ? (
          <Link
            href="/account/dropship/stores"
            data-testid="dropship-store-switcher-mobile"
            className="ml-auto flex items-center gap-1.5 min-h-[44px] px-2.5 border border-line rounded-[10px] bg-white text-ink hover:text-ink hover:bg-sand no-underline text-[13px] font-semibold min-w-0 max-w-[165px]"
          >
            <DsIcon name="store" size={16} className="shrink-0" />
            <span className="truncate">{displayStore}</span>
          </Link>
        ) : (
          <div
            aria-disabled="true"
            title="Activate dropshipping"
            data-testid="dropship-store-switcher-mobile"
            className="ml-auto flex items-center gap-1.5 min-h-[44px] px-2.5 border border-line rounded-[10px] text-muted bg-disabled cursor-not-allowed select-none text-[13px] font-semibold min-w-0 max-w-[175px]"
          >
            <DsIcon name="lock" size={14} className="shrink-0" />
            <span className="truncate">Activate dropshipping</span>
          </div>
        )}
        <Link
          href="/account/notifications"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'
          }
          className="relative inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-[12px] text-ink hover:text-ink hover:bg-sand"
        >
          <DsIcon name="bell" size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-bad" />
          )}
        </Link>
      </header>

      {/* Desktop Left Sidebar (>= 768px) — matches screens/Dashboard.html */}
      <aside className="app-sidebar hidden md:flex md:border-r md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto">
        <nav
          aria-label="Dropship"
          data-testid="dropship-sidebar"
          className="w-full flex-[1_0_auto] box-border px-3.5 pt-6 pb-7 flex flex-col gap-0.5"
        >
          <AppLogo variant="dropship" href="/account/dropship" label="Octopus Dropship" className="mx-2 mb-5" />

          {!showStore ? null : dropshipEnabled ? (
            <Link
              href="/account/dropship/stores"
              data-testid="dropship-store-switcher"
              className="flex items-center gap-3 min-h-[52px] px-3 py-2 mb-1 border border-line rounded-[14px] bg-pearl text-ink hover:text-ink hover:bg-sand no-underline text-[14px] font-bold box-border"
            >
              <span className="flex-none w-9 h-9 rounded-[10px] bg-tint text-coral-text flex items-center justify-center" aria-hidden="true">
                <DsIcon name="store" size={18} />
              </span>
              <span className="flex flex-col leading-[1.25] min-w-0">
                <span className="text-[12px] font-medium text-muted">Store</span>
                <span className="truncate">{displayStore}</span>
              </span>
            </Link>
          ) : (
            <div
              aria-disabled="true"
              title="Activate dropshipping"
              data-testid="dropship-store-switcher"
              className="flex items-center gap-3 min-h-[52px] px-3 py-2 mb-1 border border-line rounded-[14px] bg-disabled text-muted text-[14px] font-bold box-border cursor-not-allowed select-none"
            >
              <span className="flex-none w-9 h-9 rounded-[10px] bg-white flex items-center justify-center" aria-hidden="true">
                <DsIcon name="store" size={18} />
              </span>
              <span className="flex flex-col leading-[1.25] min-w-0">
                <span className="text-[12px] font-medium text-muted">Store</span>
                <span className="truncate">Activate dropshipping</span>
              </span>
              <DsIcon name="lock" size={14} className="ml-auto shrink-0" />
            </div>
          )}

          {groups.map((group) => (
            <div key={group.title} className="contents">
              <div className="app-grp">
                {group.title}
              </div>
              {group.items.map((item) => {
                const isHome = item.href === '/account/dropship';
                const label = isHome && !dropshipEnabled ? 'Start dropshipping' : item.label;
                if (!dropshipEnabled && !isHome) {
                  return (
                    <span
                      key={item.href}
                      aria-disabled="true"
                      title="Activate dropshipping"
                      data-testid="locked-nav-item"
                      className="app-nav box-border text-muted font-medium cursor-not-allowed select-none hover:bg-transparent"
                    >
                      <DsIcon name={item.icon} size={20} />
                      <span>{label}</span>
                      <DsIcon name="lock" size={14} className="ml-auto shrink-0" />
                    </span>
                  );
                }

                const active = isMerchantItemActive(item, pathname, isListParam, earlyAccess);
                const badgeCount =
                  item.matchQuery === 'list=1'
                    ? importListCount
                    : item.href === '/account/dropship/orders'
                      ? ordersCount
                      : item.badge ?? 0;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className="app-nav box-border hover:text-ink"
                  >
                    <DsIcon name={item.icon} size={20} />
                    <span>{label}</span>
                    {badgeCount > 0 && (
                      <span className="ml-auto bg-coral text-white rounded-full text-[12px] font-bold px-2 py-0.5">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}

          {dropshipEnabled && earlyAccess && (
            <div className="mt-auto pt-5 mb-2 px-3.5 text-[13px] leading-[1.5] text-muted" data-testid="early-access-note">
              <div className="font-mono text-[11px] font-semibold tracking-[0.14em] uppercase text-coral-text">Early access</div>
              <div>Store connection is the next release.</div>
            </div>
          )}
          <div className={`${dropshipEnabled && earlyAccess ? '' : 'mt-auto '}px-3.5 pt-3 pb-1 border border-line rounded-[14px] bg-pearl text-[13px] leading-[1.5] text-muted`}>
            <div>Part of your Octopus B2B account.</div>
            <Link
              href="/account"
              data-testid="back-to-octopus-account"
              className="inline-flex items-center min-h-11 text-coral-text hover:text-ink font-semibold no-underline"
            >
              Back to my Octopus account →
            </Link>
          </div>
        </nav>
      </aside>

      {/* Desktop Top Bar */}
      <header className="app-topbar hidden md:flex md:col-start-2 md:row-start-1">
        <DsTopBar
          searchPlaceholder="Search orders, products, DS model no."
          searchAction="/account/dropship/catalogue"
          unreadCount={unreadCount}
          notificationsHref="/account/notifications"
          helpHref={dropshipEnabled ? '/account/dropship/support' : '/account/support'}
          accountHref={dropshipEnabled ? '/account/dropship/settings' : '/account'}
          backToAccountHref="/account"
          backToAccountLabel="Back to my Octopus account"
          userName={userName}
          initials={initials}
          extraRight={
            isStaging ? (
              <span
                data-testid="staging-badge"
                title="Staging environment: test data, not the live site"
                className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-warn-bg text-warn"
              >
                Staging
              </span>
            ) : null
          }
        />
      </header>

      {/* Main Content Area */}
      <main
        id="ds-merchant-main"
        tabIndex={-1}
        className="app-main box-border pb-24 md:pb-12 lg:pb-[72px] md:col-start-2 md:row-start-2 focus:outline-none"
      >
        <div className="w-full max-w-[1240px] mx-auto flex flex-col gap-5">
          {children}
        </div>
      </main>

      {/* Phone Bottom Tab Bar (below 768px) — matches mobile/M_Dashboard.html */}
      <nav
        aria-label="Main"
        data-testid="dropship-phone-tabs"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex bg-white border-t border-line pb-[env(safe-area-inset-bottom)]"
      >
        {tabs.map((tab) => {
          const isHome = tab.href === '/account/dropship';
          if (!dropshipEnabled && !isHome) {
            return (
              <span
                key={tab.href}
                aria-disabled="true"
                title="Activate dropshipping"
                data-testid="locked-phone-tab"
                className="flex-1 min-h-[60px] flex flex-col items-center justify-center gap-0.5 text-[12px] border-t-[3px] font-medium text-muted border-transparent cursor-not-allowed select-none"
              >
                <DsIcon name="lock" size={18} />
                <span>{tab.label}</span>
              </span>
            );
          }

          const active = isPhoneTabActive(tab.href, pathname, isListParam, earlyAccess);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 min-h-[60px] flex flex-col items-center justify-center gap-0.5 no-underline text-[12px] border-t-[3px] ${
                active
                  ? 'font-bold text-ink hover:text-ink border-coral bg-tint-2'
                  : 'font-semibold text-muted hover:text-ink border-transparent'
              }`}
            >
              <DsIcon name={tab.icon} size={22} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
