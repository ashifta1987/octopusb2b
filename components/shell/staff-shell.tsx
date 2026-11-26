import { AreaLogo } from './area-logo';
import { SideNav } from '@/components/side-nav';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import { WorkspaceSwitcher, StaffUserMenu } from '@/components/portal-shell';
import type { NavSection } from '@/lib/nav';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { isStaging } from '@/lib/core/account';
import { AccountTabs, type Tab } from './account-tabs';
import Link from 'next/link';
import { UnreadBellDot } from '@/components/account/unread-count';
import { DivisionSwitcher } from './division-switcher';
import { setDivisionScope } from '@/app/admin/division-scope-actions';
import type { DivisionScope } from '@/lib/divisions/shared';
import { StaffShellSwitcher } from './dropship-shell-switcher';

/**
 * ADDON-41 boards 06–08 — staff shell: navy header ("Admin · staff only"), admin tabs, and the side menu
 * (work queue first, then the existing back-office and admin pages the person may open).
 */
export function StaffShell({ area = 'staff', session, nav, counts, moderation, unread = 0, scope, dropshipV2Ui = false, canEditDropship = false, canSeeRates = false, in3pl = false, warehouseMember = false, children }: {
  /** layout segment (admin / office): keeps the skip-link target id unique while Next keeps the other layout hidden */
  area?: string;
  session: Session; nav: NavSection[]; counts: { queue: number; approvals: number; transfers: number }; moderation?: number | null; unread?: number; scope?: DivisionScope; dropshipV2Ui?: boolean; canEditDropship?: boolean; canSeeRates?: boolean; in3pl?: boolean;
  /** W7: whether this person works in a warehouse (from the layout) */
  warehouseMember?: boolean; children: React.ReactNode;
}) {
  const name = session.profile?.full_name ?? session.email ?? 'Staff';
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const isManager = session.roles.includes('account_manager');
  const roleLabel = session.isAdmin ? 'Owner' : isManager ? 'Account manager' : session.roles.map((r) => r.replace(/_/g, ' ')).join(', ');
  const sub = [roleLabel, session.profile && 'office' in session.profile ? (session.profile as { office?: string | null }).office : null].filter(Boolean).join(' · ');

  const seesCustomers = can(session, 'customers', 'view') || isManager;
  const tabs: Tab[] = [
    { key: 'queue', label: 'Work queue', href: '/admin', match: ['/admin/approvals'] },
    ...(seesCustomers ? [{ key: 'customers', label: 'Customers', href: '/admin/customers', match: ['/admin/customers'] }] : []),
    ...(can(session, 'dashboard', 'view') && session.roles.some((r) => r !== 'account_manager') ? [{ key: 'office', label: 'Back office queues', href: '/office', match: ['/office'] }] : []),
    ...(can(session, 'wallet', 'approve') || can(session, 'finance', 'view') ? [{ key: 'finance', label: 'Finance', href: '/admin/finance/transfers', match: ['/admin/finance', '/admin/wallet', '/admin/settings/payment'] }] : []),
    ...(can(session, 'integrations', 'view') ? [{ key: 'integrations', label: 'Integrations and audit', href: '/admin/integrations', match: ['/admin/integrations'] }] : []),
  ];
  // the first tab matches /admin exactly; everything else under /admin falls back to it unless another tab matches
  const work: NavSection[] = [
    { title: 'Me', items: [
      { href: '/admin', label: 'Work queue' },
      { href: '/admin/notifications', label: 'Notifications' },
      ...(session.isAdmin || isManager || can(session, 'approvals', 'view') ? [{ href: '/admin/approvals', label: 'Approvals' }] : []),
      ...(can(session, 'wallet', 'approve') ? [{ href: '/admin/finance/transfers', label: 'Bank transfers' }] : []),
      ...(can(session, 'finance', 'view') ? [
        { href: '/admin/finance/holds', label: 'Held payments' },
        { href: '/admin/finance/credit', label: 'Credit terms' },
        { href: '/admin/finance/receivables', label: 'Receivables & ageing' },
      ] : []),
    ] },
    // divisions step 4: the legal company and its divisions (company-wide Admin only)
    ...(session.isAdmin ? [{ title: 'Company', items: [{ href: '/admin/company', label: 'Company' }, { href: '/admin/divisions', label: 'Divisions' }, { href: '/admin/staff#divisions', label: 'Staff & divisions' }, { href: '/admin/reports/divisions', label: 'Reports by division' }] }] : []),
    ...(seesCustomers ? [{ title: 'Customers', items: [{ href: '/admin/customers', label: 'All customers' }, { href: '/admin/brand-projects', label: 'Brand projects' }, ...(session.isAdmin || isManager ? [{ href: '/admin/approvals#limits', label: 'Approval limits' }] : [])] }] : []),
  ];
  const inDs = Boolean(scope?.options.some((d) => d.code === 'DS'));
  const canOpenDropship = session.isAdmin || can(session, 'finance', 'view') || can(session, 'support', 'edit') || inDs;
  // EA-1 (design v2): 3PL & Shipping staff work on Shipping rates, Fees and Duty (canSeeRates / in3pl from the layout)
  const canSeeFeesDuty = canOpenDropship || in3pl;
  const rest = nav
    .map((s) => ({
      ...s,
      items: s.items.filter((i) =>
        i.href === '/office/dropship'
          ? canOpenDropship
          : !i.area || can(session, i.area, i.action ?? 'view'),
      ),
    }))
    .filter((s) => s.items.length);

  const staging = isStaging();
  const hasDivisions = Boolean(scope && scope.options.length > 0);
  // Design handoff 26 Nov 2026 (App shell §3): white 264 px sidebar (logo, context box with the current division,
  // Jost group labels, 44 px items, "Switch workspace" at the bottom) + white top bar (staff badge, search, bell,
  // user chip) + the existing admin tabs and division banner. Phones: top bar, tabs, context + menu strip, page.
  const defaultShell = (
    <div className="app-shell min-h-screen bg-pearl">
      <a href={`#staff-main-${area}`} className="skip-link">Skip to content</a>
      <MaintenanceNotice />
      <div className="app-cols md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:min-h-screen">
        <div className="md:col-start-2 md:row-start-1 min-w-0">
          <header className="app-topbar gap-x-4 gap-y-3">
            <AreaLogo size="bar" className="md:hidden" />
            <span className="text-[13px] font-bold px-3 py-1.5 rounded-full bg-ink text-white" data-testid="staff-only">Admin · staff only</span>
            <form action="/office/orders" role="search" className="order-3 lg:order-none basis-full lg:basis-auto lg:flex-1 lg:max-w-[520px]">
              <label htmlFor="staff-q" className="sr-only">Search orders by code or title</label>
              <input id="staff-q" name="q" className="input" placeholder="Search orders by code or title" />
            </form>
            {staging && <span className="order-2 lg:order-none text-[13px] font-bold px-3 py-1.5 rounded-full bg-warn-bg text-warn" data-testid="staging-badge" title="Staging environment: test data, not the live site">Staging</span>}
            <div className="order-2 lg:order-none ml-auto flex items-center gap-3">
              {/* staff notification inbox (bug 2, 8 Nov 2026): drops at once when one is opened */}
              <Link href="/admin/notifications" data-testid="staff-bell" className="app-ibtn">
                <span className="sr-only">Notifications</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                <UnreadBellDot count={unread} />
              </Link>
              <StaffUserMenu name={name} initials={initials} sub={sub} email={session.email} />
            </div>
          </header>
          <AccountTabs tabs={tabs} />
          {scope && !scope.all && (
            <div className="bg-tint border-b border-line px-4 sm:px-6 lg:px-12 py-2.5 text-sm text-ink flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="division-banner">
              <span>Showing <b>{scope.division.name}</b> only: lists, counts and notifications follow this division.</span>
              {scope.options.length > 1 && <form action={setDivisionScope}><input type="hidden" name="division" value="all" /><button className="inline-flex items-center min-h-11 text-coral-text font-bold underline">Show all divisions</button></form>}
            </div>
          )}
        </div>
        <aside className="app-sidebar gap-3 md:gap-0 px-4 py-3 border-b md:border-b-0 md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto md:border-r md:px-3.5 md:pt-6 md:pb-7">
          <div className="hidden md:block px-2"><AreaLogo /></div>
          {/* context box: the division the app already knows (the division switcher), else the current workspace */}
          <div className="app-context md:mx-1 md:mt-4 md:mb-2.5">
            <span className="app-context-tile" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01" /></svg>
            </span>
            <div className="min-w-0 flex-1">
              {hasDivisions && scope
                ? <DivisionSwitcher variant="context" options={scope.options} current={scope.all ? null : scope.division.code} action={setDivisionScope} />
                : <><span className="block text-[12px] text-on-ink">Workspace</span><b className="block mt-0.5 text-[15px] leading-tight text-white">Admin</b></>}
            </div>
          </div>
          <SideNav sections={[...work, ...rest]} moderation={moderation} badges={{ '/admin': counts.queue, '/admin/notifications': unread, '/admin/approvals': counts.approvals, '/admin/finance/transfers': counts.transfers }} />
          <div className="md:mt-auto md:pt-6 empty:hidden">
            <WorkspaceSwitcher session={session} current="Admin" placement="sidebar" />
          </div>
        </aside>
        <main id={`staff-main-${area}`} tabIndex={-1} className="app-main md:col-start-2 md:row-start-2"><div className="max-w-[1280px] mx-auto">{children}</div></main>
      </div>
    </div>
  );

  const canSeeSaas = session.isAdmin || can(session, 'finance', 'view');

  return (
    <StaffShellSwitcher
      v2ShellEnabled={dropshipV2Ui}
      canSeeDropshipItems={canOpenDropship}
      canSeeRates={canSeeRates}
      canSeeFeesDuty={canSeeFeesDuty}
      canEditDropship={canEditDropship}
      canSeeSaas={canSeeSaas}
      isAdmin={session.isAdmin}
      warehouseMember={warehouseMember}
      userName={name}
      initials={initials || 'ST'}
      unreadCount={unread}
      isStaging={staging}
      defaultShell={defaultShell}
    >
      {children}
    </StaffShellSwitcher>
  );
}

