import Link from 'next/link';
import { AppLogo } from './app-logo';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import type { Session } from '@/lib/auth';
import { money } from '@/lib/format';
import { SERVICES, dropshipEverEnabled, isStaging, serviceOn, type getAccountContext } from '@/lib/core/account';
import { AccountTabs, SectionMenu, type Tab, type MenuSection } from './account-tabs';
import { UnreadBellDot } from '@/components/account/unread-count';
import { AccountShellSwitcher } from './dropship-shell-switcher';
import type { DropshipFeatures } from '@/lib/dropship-features-shared';

type Ctx = Awaited<ReturnType<typeof getAccountContext>>;

/** ADDON-41 board 01 — My account shell: header (search, wallet, notifications, user), service tabs, section menu. */
export function AccountShell({ session, ctx, newQuotes, dropshipV2Ui = false, dropshipFeatures, mobileBar, children }: {
  session: Session; ctx: Ctx | null; newQuotes: number; dropshipV2Ui?: boolean; dropshipFeatures?: DropshipFeatures; mobileBar?: React.ReactNode; children: React.ReactNode;
}) {
  const name = session.profile?.full_name ?? session.email ?? 'You';
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const tabs: Tab[] = [
    { key: 'home', label: 'Home', href: '/account', match: ['/account'] },
    { key: 'sourcing', label: 'Sourcing', href: '/account/sourcing', match: ['/account/sourcing', '/account/rfqs', '/account/orders', '/account/services', '/account/pools', '/account/turnkey'] },
    { key: 'dropship', label: 'Dropshipping', href: '/account/dropship', match: ['/account/dropship'] },
    { key: 'warehouse', label: '3PL warehouse', href: '/account/warehouse', match: ['/account/warehouse'] },
    { key: 'brand', label: 'Make My Brand', href: '/account/brand', match: ['/account/brand'] },
    { key: 'wallet', label: 'Wallet and invoices', href: '/account/wallet', match: ['/account/wallet', '/account/invoices', '/account/ledger'] },
  ];
  const svcMenu = (key: string, label: string): MenuSection[] => [{ title: label, items: [{ href: `/account/${key}`, label: 'Overview' }] }];
  const menus: Record<string, MenuSection[]> = {
    home: [
      { title: 'My account', items: [
        { href: '/account', label: 'Home' }, { href: '/account#waiting', label: 'Waiting for you' }, { href: '/account/support', label: 'Messages' },
        { href: '/account/notifications', label: 'Notifications', badge: ctx?.unread }, { href: '/account/wallet', label: 'Wallet' }, { href: '/account/invoices', label: 'Invoices and receipts' },
      ] },
      { title: 'Company', items: [{ href: '/account#services', label: 'Services and plans' }, { href: '/account/kyc', label: 'Company and verification' }, { href: '/account/developer', label: 'API and integrations' }] },
      { title: 'Help', items: [{ href: '/account/assistant', label: 'Octo assistant' }, { href: '/account/support', label: 'Help and complaints' }] },
    ],
    sourcing: [{ title: 'Sourcing', items: [
      // (audit 8 Nov: /account/rfqs and /account/services only redirect here, so link the filters directly)
      { href: '/account/sourcing', label: 'Requests', badge: newQuotes }, { href: '/account/sourcing?status=Quoted', label: 'Quotes ready' },
      { href: '/account/orders', label: 'Orders' }, { href: '/account/pools', label: 'MOQ pools' }, { href: '/account/turnkey', label: 'Turnkey projects' },
    ] }],
    // ADDON-44-E: catalogue (verified products that ship to your markets) and the import list
    dropship: [{ title: 'Dropshipping', items: [
      { href: '/account/dropship', label: 'Overview' }, { href: '/account/dropship/catalogue', label: 'Catalogue' }, { href: '/account/dropship/catalogue?list=1', label: 'Import list' },
    ] }],
    warehouse: svcMenu('warehouse', '3PL warehouse'),
    brand: svcMenu('brand', 'Make My Brand'),
    wallet: [{ title: 'Wallet and invoices', items: [
      { href: '/account/wallet', label: 'Wallet' }, { href: '/account/invoices', label: 'Invoices and receipts' }, { href: '/account/ledger', label: 'Ledger and statements' },
    ] }],
  };
  const role = session.org ? `${session.org.name}` : 'Customer';
  const staging = isStaging();

  // Design handoff 26 Nov 2026 (App shell §3): 264 px white sidebar (logo, "+ New request", service items, section
  // menu, Log out at the bottom) + white top bar (search, wallet, bell, user chip). Phones keep the logo/search/bell
  // header, the service tab strip and the bottom bar + More sheet. Grid areas keep the DOM order header → menu → main.
  const defaultShell = (
    <div className="app-shell min-h-screen bg-pearl">
      <a href="#account-main" className="skip-link">Skip to content</a>
      <MaintenanceNotice />
      <div className="app-cols md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:min-h-screen">
        <header className="app-topbar gap-x-4 gap-y-3 md:col-start-2 md:row-start-1">
          <AppLogo size="bar" className="md:hidden" />
          {/* audit 8 Nov: searched the public catalogue before; now searches the customer's own requests and orders */}
          <form action="/account/sourcing" role="search" className="order-3 md:order-none basis-full md:basis-auto md:flex-1 md:max-w-[560px]">
            <label htmlFor="acct-q" className="sr-only">Search your requests and orders</label>
            <input id="acct-q" name="q" className="input" placeholder="Search your requests and orders (reference or product)" />
          </form>
          {staging && <span className="order-2 md:order-none text-[13px] font-bold px-3 py-1.5 rounded-full bg-warn-bg text-warn" data-testid="staging-badge" title="Staging environment: test data, not the live site">Staging</span>}
          <div className="order-2 md:order-none ml-auto flex items-center gap-3">
            {ctx?.wallet && (
              <Link href="/account/wallet" className="hidden sm:flex flex-col justify-center min-h-[46px] rounded-[12px] border border-line bg-white px-3.5 leading-tight hover:bg-sand" data-testid="header-wallet">
                <span className="block text-[12px] text-muted">Wallet</span>
                <span className="block font-bold text-[15px] text-ink">{money(Number(ctx.wallet.available_cents), 'USD')}</span>
              </Link>
            )}
            <Link href="/account/notifications" data-testid="header-bell" className="app-ibtn">
              <span className="sr-only">Notifications</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
              <UnreadBellDot count={ctx?.unread ?? 0} />
            </Link>
            <details className="relative">
              <summary className="app-chip list-none [&::-webkit-details-marker]:hidden cursor-pointer max-md:pr-1.5">
                <span className="app-avatar" aria-hidden>{initials}</span>
                <span className="hidden md:block leading-tight text-left">
                  <span className="block font-bold text-[14px] text-ink">{name}</span>
                  <span className="block text-[12px] text-muted">{role}</span>
                </span>
                <span className="sr-only">Account menu</span>
              </summary>
              <div className="absolute right-0 mt-2 w-[240px] bg-white border border-line rounded-[12px] shadow-lg p-2 z-50">
                <Link href="/account/kyc" className="flex items-center min-h-11 px-3 rounded-[10px] text-sm font-semibold text-ink hover:bg-sand">Company and verification</Link>
                <form action="/auth/signout" method="post"><button type="submit" className="w-full text-left min-h-11 px-3 rounded-[10px] text-sm font-semibold text-bad hover:bg-sand">Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        <aside className="app-sidebar md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto md:border-r md:px-3.5 md:pt-6 md:pb-7">
          <div className="hidden md:block px-2 pb-5"><AppLogo /></div>
          {/* the portal's existing main action (the Sourcing page's "+ New request") */}
          <Link href="/request/sourcing" className="hidden md:flex btn btn-primary w-full mb-3.5" data-testid="sidebar-new-request">+ New request</Link>
          <AccountTabs tabs={tabs} variant="sidebar" />
          <div className="hidden md:block"><SectionMenu tabs={tabs} menus={menus} /></div>
          <div className="hidden md:block mt-auto pt-6">
            <form action="/auth/signout" method="post">
              <button type="submit" className="app-nav w-full text-left bg-transparent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
                Log out
              </button>
            </form>
          </div>
        </aside>
        <main id="account-main" tabIndex={-1} className={`app-main md:col-start-2 md:row-start-2 focus:outline-none ${mobileBar ? 'pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-[72px]' : ''}`}>{children}</main>
      </div>
      {mobileBar}
    </div>
  );

  // Step 4: When dropship_v2_ui is ON, /account/dropship renders inside DropshipMerchantShell
  // (Activate for non-enabled orgs, Dashboard/sub-routes for active, paused, and closed merchants).
  // When dropship_v2_ui is OFF (Live today), non-enabled & enabled customers keep AccountShell + "Coming soon".
  return (
    <AccountShellSwitcher
      v2ShellEnabled={Boolean(dropshipV2Ui && session.org)}
      dropshipEnabled={Boolean(ctx && dropshipEverEnabled(ctx.services.dropship))}
      userName={name}
      initials={initials || 'ME'}
      unreadCount={ctx?.unread ?? 0}
      isStaging={staging}
      features={dropshipFeatures}
      defaultShell={defaultShell}
    >
      {children}
    </AccountShellSwitcher>
  );
}

export { SERVICES };

