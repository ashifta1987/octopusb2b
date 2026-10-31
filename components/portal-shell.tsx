import Link from 'next/link';
import { Logo } from '@/components/ui';
import { SideNav } from '@/components/side-nav';
import type { NavSection } from '@/lib/nav';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { MaintenanceNotice } from '@/components/maintenance-notice';

/** Portal layout: left sidebar (role-filtered) that becomes a horizontal tab bar under 760px (SPEC §8.2). */
export function PortalShell({ session, nav, children, searchPlaceholder = 'Search orders, RFQs, invoices', roleLabel }: {
  session: Session; nav: NavSection[]; children: React.ReactNode; searchPlaceholder?: string; roleLabel?: string;
}) {
  const sections = nav
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.area || can(session, i.area, i.action ?? 'view')) }))
    .filter((s) => s.items.length);
  const name = session.profile?.full_name ?? session.email ?? 'User';
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const sub = roleLabel ?? (session.org?.name ? `${session.org.name} · Customer` : session.roles.map((r) => r.replace('_', ' ')).join(', '));
  return (
    <div className="min-h-screen bg-surface">
      <MaintenanceNotice />
      <header className="bg-white border-b border-line">
        <div className="flex flex-wrap items-center gap-4 px-6 py-3">
          <Logo />
          <form action="/search" className="flex-1 min-w-[200px] max-w-[520px]" role="search">
            <label htmlFor="portal-q" className="sr-only">Search</label>
            <input id="portal-q" name="q" className="input" placeholder={searchPlaceholder} />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <PortalSwitcher session={session} />
            <div className="w-10 h-10 rounded-full bg-navy text-white flex items-center justify-center font-semibold text-sm" aria-hidden>{initials}</div>
            <div className="hidden sm:block leading-tight">
              <div className="font-semibold text-[15px]">{name}</div>
              <div className="text-xs text-muted capitalize">{sub}</div>
            </div>
            <form action="/auth/signout" method="post"><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
          </div>
        </div>
      </header>
      <div className="flex flex-col md:flex-row">
        <SideNav sections={sections} />
        <main className="flex-1 min-w-0 px-4 sm:px-8 py-8">
          <div className="max-w-[1280px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}

function PortalSwitcher({ session }: { session: Session }) {
  const links: { href: string; label: string }[] = [];
  if (session.org) links.push({ href: '/account', label: 'Buyer' });
  if (session.isAdmin || session.roles.includes('distributor')) links.push({ href: '/distributor', label: 'Distributor' });
  if (session.isStaff && session.roles.some((r) => r !== 'distributor')) links.push({ href: '/office', label: 'Back office' });
  if (session.isAdmin) links.push({ href: '/admin', label: 'Admin' });
  if (links.length < 2) return null;
  return (
    <nav aria-label="Switch portal" className="hidden lg:flex gap-1">
      {links.map((l) => <Link key={l.href} href={l.href} className="px-3 py-2 rounded-md text-sm font-semibold text-muted hover:text-navy hover:bg-surface">{l.label}</Link>)}
    </nav>
  );
}

