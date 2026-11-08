import { Logo } from '@/components/ui';
import { SideNav } from '@/components/side-nav';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import { WorkspaceSwitcher, StaffUserMenu } from '@/components/portal-shell';
import type { NavSection } from '@/lib/nav';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { isStaging } from '@/lib/core/account';
import { AccountTabs, type Tab } from './account-tabs';

/**
 * ADDON-41 boards 06–08 — staff shell: navy header ("Admin · staff only"), admin tabs, and the side menu
 * (work queue first, then the existing back-office and admin pages the person may open).
 */
export function StaffShell({ session, nav, counts, moderation, children }: {
  session: Session; nav: NavSection[]; counts: { queue: number; approvals: number; transfers: number }; moderation?: number | null; children: React.ReactNode;
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
      ...(session.isAdmin || isManager || can(session, 'approvals', 'view') ? [{ href: '/admin/approvals', label: 'Approvals' }] : []),
      ...(can(session, 'wallet', 'approve') ? [{ href: '/admin/finance/transfers', label: 'Bank transfers' }] : []),
    ] },
    ...(seesCustomers ? [{ title: 'Customers', items: [{ href: '/admin/customers', label: 'All customers' }, ...(session.isAdmin || isManager ? [{ href: '/admin/approvals#limits', label: 'Approval limits' }] : [])] }] : []),
  ];
  const rest = nav.map((s) => ({ ...s, items: s.items.filter((i) => !i.area || can(session, i.area, i.action ?? 'view')) })).filter((s) => s.items.length);

  return (
    <div className="min-h-screen bg-pearl">
      <MaintenanceNotice />
      <header className="bg-ink text-white">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Logo white />
          <span className="mono text-[11px] font-bold uppercase tracking-[.08em] px-3 py-1 rounded-full bg-white text-ink" data-testid="staff-only">Admin · staff only</span>
          <form action="/office/orders" role="search" className="order-3 lg:order-none basis-full lg:basis-auto lg:flex-1 lg:max-w-[520px]">
            <label htmlFor="staff-q" className="sr-only">Search orders by code or title</label>
            <input id="staff-q" name="q" className="input !rounded-[10px] !border-white" placeholder="Search orders by code or title" />
          </form>
          {isStaging() && <span className="order-2 mono text-[11px] font-bold uppercase tracking-[.1em] px-2.5 py-1 rounded-full bg-warn-bg text-warn" data-testid="staging-badge" title="Staging environment: test data, not the live site">Staging</span>}
          <div className="ml-auto flex items-center gap-3 [&_summary]:text-white [&_.btn-ghost]:!text-white [&_.btn-ghost]:!bg-transparent [&_.btn-ghost]:!border-white/40 [&_.text-muted]:!text-white/70 [&_summary_.bg-ink]:!bg-coral">
            <WorkspaceSwitcher session={session} current="Admin" />
            <StaffUserMenu name={name} initials={initials} sub={sub} email={session.email} />
          </div>
        </div>
      </header>
      <AccountTabs tabs={tabs} />
      <div className="flex flex-col md:flex-row">
        <SideNav sections={[...work, ...rest]} moderation={moderation} badges={{ '/admin': counts.queue, '/admin/approvals': counts.approvals, '/admin/finance/transfers': counts.transfers }} />
        <main className="flex-1 min-w-0 px-4 sm:px-8 py-8"><div className="max-w-[1280px] mx-auto">{children}</div></main>
      </div>
    </div>
  );
}

