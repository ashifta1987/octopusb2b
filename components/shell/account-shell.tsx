import Link from 'next/link';
import { Logo } from '@/components/ui';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import type { Session } from '@/lib/auth';
import { money } from '@/lib/format';
import { SERVICES, isStaging, type getAccountContext } from '@/lib/core/account';
import { AccountTabs, SectionMenu, type Tab, type MenuSection } from './account-tabs';

type Ctx = Awaited<ReturnType<typeof getAccountContext>>;

/** ADDON-41 board 01 — My account shell: header (search, wallet, notifications, user), service tabs, section menu. */
export function AccountShell({ session, ctx, newQuotes, mobileBar, children }: {
  session: Session; ctx: Ctx | null; newQuotes: number; mobileBar?: React.ReactNode; children: React.ReactNode;
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
      { href: '/account/sourcing', label: 'Requests', badge: newQuotes }, { href: '/account/rfqs', label: 'Quotes' }, { href: '/account/orders', label: 'Orders' },
      { href: '/account/services', label: 'Samples, QC and certification' }, { href: '/account/pools', label: 'MOQ pools' }, { href: '/account/turnkey', label: 'Turnkey projects' },
    ] }],
    dropship: svcMenu('dropship', 'Dropshipping'),
    warehouse: svcMenu('warehouse', '3PL warehouse'),
    brand: svcMenu('brand', 'Make My Brand'),
    wallet: [{ title: 'Wallet and invoices', items: [
      { href: '/account/wallet', label: 'Wallet' }, { href: '/account/invoices', label: 'Invoices and receipts' }, { href: '/account/ledger', label: 'Ledger and statements' },
    ] }],
  };
  const role = session.org ? `${session.org.name}` : 'Customer';

  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      <MaintenanceNotice />
      <header className="bg-white">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Logo />
          <form action="/search" role="search" className="order-3 lg:order-2 basis-full lg:basis-auto lg:flex-1 lg:max-w-[560px]">
            <label htmlFor="acct-q" className="sr-only">Search orders, products, projects, stock</label>
            <input id="acct-q" name="q" className="input !rounded-[10px]" placeholder="Search orders, products, projects, stock" />
          </form>
          {isStaging() && <span className="order-2 mono text-[11px] font-bold uppercase tracking-[.1em] px-2.5 py-1 rounded-full bg-[#FEF3C7] text-[#92400E]" data-testid="staging-badge" title="Staging environment: test data, not the live site">Staging</span>}
          <div className="order-2 lg:order-3 ml-auto flex items-center gap-3">
            {ctx?.wallet && (
              <Link href="/account/wallet" className="hidden sm:block rounded-[10px] border border-line px-3.5 py-1.5 leading-tight hover:border-navy" data-testid="header-wallet">
                <span className="block mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-[#5A6475]">Wallet</span>
                <span className="block font-bold text-[16px]">{money(Number(ctx.wallet.available_cents), 'USD')}</span>
              </Link>
            )}
            <Link href="/account/notifications" aria-label={`Notifications${ctx?.unread ? `, ${ctx.unread} unread` : ''}`} className="relative w-11 h-11 rounded-[10px] border border-line flex items-center justify-center hover:border-navy">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
              {!!ctx?.unread && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#E5532D]" aria-hidden />}
            </Link>
            <details className="relative">
              <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2.5">
                <span className="w-11 h-11 rounded-full bg-navy text-white flex items-center justify-center font-semibold text-sm" aria-hidden>{initials}</span>
                <span className="hidden md:block leading-tight text-left">
                  <span className="block font-semibold text-[15px]">{name}</span>
                  <span className="block text-[13px] text-[#5A6475]">{role}</span>
                </span>
                <span className="sr-only">Account menu</span>
              </summary>
              <div className="absolute right-0 mt-2 w-[220px] bg-white border border-line rounded-[10px] shadow-lg p-2 z-50">
                <Link href="/account/kyc" className="block px-3 py-2.5 rounded-md text-sm font-semibold hover:bg-surface">Company and verification</Link>
                <form action="/auth/signout" method="post"><button type="submit" className="w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold text-bad hover:bg-surface">Sign out</button></form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <AccountTabs tabs={tabs} />
      <div className="max-w-[1440px] mx-auto flex">
        <aside className="hidden md:block w-[236px] shrink-0 border-r border-line bg-white min-h-[calc(100vh-130px)] px-3 py-7">
          <SectionMenu tabs={tabs} menus={menus} />
        </aside>
        <main className={`flex-1 min-w-0 px-4 sm:px-8 py-8 ${mobileBar ? 'pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-10' : ''}`}>{children}</main>
      </div>
      {mobileBar}
    </div>
  );
}

export { SERVICES };

