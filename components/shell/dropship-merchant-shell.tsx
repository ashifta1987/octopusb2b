'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { DsIcon, DsTopBar, type DsIconName } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';
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

  return (
    <div
      data-testid="dropship-merchant-shell"
      className={`${dsInter.variable} ds-v2 min-h-screen flex flex-col md:flex-row bg-[#F4F6F9] text-[#1A174A]`}
    >
      {/* Phone Top Header (below 768px) — matches mobile/M_Dashboard.html */}
      <header
        data-testid="dropship-phone-header"
        className="md:hidden bg-[#1A174A] px-4 py-3 flex items-center gap-2 min-w-0"
      >
        <Link href="/account/dropship" className="inline-flex items-center shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/octopus-dropship-logo-white.png"
            alt="Octopus Dropship"
            className="w-[120px] h-auto block"
          />
        </Link>
        {!showStore ? <span className="ml-auto" /> : dropshipEnabled ? (
          <Link
            href="/account/dropship/stores"
            data-testid="dropship-store-switcher-mobile"
            className="ml-auto flex items-center gap-1.5 min-h-[44px] px-2.5 border border-[#3A3775] rounded-[8px] text-white hover:text-white no-underline text-[12px] font-semibold min-w-0 max-w-[165px]"
          >
            <DsIcon name="store" size={16} />
            <span className="truncate">{displayStore}</span>
          </Link>
        ) : (
          <div
            aria-disabled="true"
            title="Activate dropshipping"
            data-testid="dropship-store-switcher-mobile"
            className="ml-auto flex items-center gap-1.5 min-h-[44px] px-2.5 border border-[#3A3775] rounded-[8px] text-[#8F9AC4] bg-[#221F58] cursor-not-allowed select-none text-[12px] font-semibold min-w-0 max-w-[175px]"
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
          className="relative inline-flex items-center justify-center w-11 h-11 shrink-0 text-white hover:text-white"
        >
          <DsIcon name="bell" size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#F97066]" />
          )}
        </Link>
      </header>

      {/* Desktop Left Sidebar (>= 768px) — matches screens/Dashboard.html */}
      <aside className="hidden md:flex w-[240px] shrink-0 bg-[#1A174A]">
        <nav
          aria-label="Dropship"
          data-testid="dropship-sidebar"
          className="w-full min-h-screen box-border bg-[#1A174A] text-white px-3.5 py-[22px] flex flex-col gap-0.5"
        >
          <Link href="/account/dropship" className="block mx-2 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/octopus-dropship-logo-white.png"
              alt="Octopus Dropship"
              className="w-[176px] max-w-full h-auto block"
            />
          </Link>

          {!showStore ? null : dropshipEnabled ? (
            <Link
              href="/account/dropship/stores"
              data-testid="dropship-store-switcher"
              className="flex items-center gap-2.5 min-h-[48px] px-3 mb-1.5 border border-[#3A3775] rounded-[10px] text-white hover:text-white no-underline text-[13px] font-semibold box-border bg-[#221F58]"
            >
              <DsIcon name="store" size={18} />
              <span className="flex flex-col leading-[1.25] min-w-0">
                <span className="text-[11px] font-medium text-[#C9D3E3]">Store</span>
                <span className="truncate">{displayStore}</span>
              </span>
            </Link>
          ) : (
            <div
              aria-disabled="true"
              title="Activate dropshipping"
              data-testid="dropship-store-switcher"
              className="flex items-center gap-2.5 min-h-[48px] px-3 mb-1.5 border border-[#3A3775] rounded-[10px] text-[#8F9AC4] text-[13px] font-semibold box-border bg-[#221F58] cursor-not-allowed select-none"
            >
              <DsIcon name="store" size={18} />
              <span className="flex flex-col leading-[1.25] min-w-0">
                <span className="text-[11px] font-medium text-[#8F9AC4]">Store</span>
                <span className="truncate">Activate dropshipping</span>
              </span>
              <DsIcon name="lock" size={14} className="ml-auto shrink-0" />
            </div>
          )}

          {groups.map((group) => (
            <div key={group.title} className="contents">
              <div className="px-3 pt-3.5 pb-1.5 text-[11px] font-bold tracking-[0.08em] uppercase text-[#8F9AC4]">
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
                      className="flex items-center gap-3 px-3 min-h-[44px] rounded-[8px] text-[14px] box-border text-[#8F9AC4] font-medium cursor-not-allowed select-none"
                    >
                      <DsIcon name={item.icon} size={18} />
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
                    className={`flex items-center gap-3 px-3 min-h-[44px] rounded-[8px] no-underline text-[14px] box-border transition-colors ${
                      active
                        ? 'bg-[#2E2B66] text-white hover:text-white font-semibold shadow-[inset_3px_0_0_#5FD3C9]'
                        : 'text-[#C9D3E3] hover:text-white hover:bg-[#221F58] font-medium'
                    }`}
                  >
                    <DsIcon name={item.icon} size={18} />
                    <span>{label}</span>
                    {badgeCount > 0 && (
                      <span className="ml-auto bg-[#2A6FD1] text-white rounded-[10px] text-[12px] font-bold px-2 py-0.5">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}

          {dropshipEnabled && earlyAccess && (
            <div className="mt-auto mb-2 px-3 text-[12px] leading-[1.5] text-[#C9D3E3]" data-testid="early-access-note">
              <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-[#5FD3C9]">Early access</div>
              <div>Store connection is the next release.</div>
            </div>
          )}
          <div className={`${dropshipEnabled && earlyAccess ? '' : 'mt-auto '}p-3 border border-[#3A3775] rounded-[10px] text-[12px] leading-[1.5] text-[#C9D3E3]`}>
            <div>Part of your Octopus B2B account.</div>
            <Link
              href="/account"
              data-testid="back-to-octopus-account"
              className="inline-block mt-1 text-[#5FD3C9] hover:text-white font-semibold no-underline"
            >
              Back to my Octopus account →
            </Link>
          </div>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 pb-24 md:px-8 md:pt-5 md:pb-10 box-border">
        <div className="w-full max-w-[1240px] mx-auto flex flex-col gap-5">
          {/* Desktop Top Bar */}
          <div className="hidden md:block">
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
                    className="mono text-[11px] font-bold uppercase tracking-[.1em] px-2.5 py-1 rounded-full bg-[#FFF4E0] text-[#8A5300]"
                  >
                    Staging
                  </span>
                ) : null
              }
            />
          </div>

          {children}
        </div>
      </main>

      {/* Phone Bottom Tab Bar (below 768px) — matches mobile/M_Dashboard.html */}
      <nav
        aria-label="Main"
        data-testid="dropship-phone-tabs"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex bg-white border-t border-[#E3E7EF] pb-[env(safe-area-inset-bottom)]"
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
                className="flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 text-[12px] border-t-[3px] font-medium text-[#5B6478] border-transparent cursor-not-allowed select-none"
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
              className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 no-underline text-[12px] border-t-[3px] ${
                active
                  ? 'font-bold text-[#1A174A] hover:text-[#1A174A] border-[#2A6FD1]'
                  : 'font-medium text-[#5B6478] hover:text-[#1A174A] border-transparent'
              }`}
            >
              <DsIcon name={tab.icon} size={20} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
