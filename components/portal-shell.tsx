import Link from 'next/link';
import { Logo } from '@/components/ui';
import { SideNav } from '@/components/side-nav';
import type { NavSection } from '@/lib/nav';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import { workspacesFor } from '@/lib/staff/workspaces';
import { staffSignOut, switchWorkspace } from '@/lib/staff/actions';

/** Portal layout: left sidebar (role-filtered) that becomes a horizontal tab bar under 760px (SPEC §8.2). */
export function PortalShell({ session, nav, children, searchPlaceholder = 'Search orders, RFQs, invoices', roleLabel, moderation = null, badges, mobileBar }: {
  session: Session; nav: NavSection[]; children: React.ReactNode; searchPlaceholder?: string; roleLabel?: string; moderation?: number | null;
  /** href → count shown as a red badge in the menu */ badges?: Record<string, number>;
  /** replaces the menu on phones (customer account bottom bar) */ mobileBar?: React.ReactNode;
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
          {session.isStaff && !session.org ? (
            <div className="ml-auto flex items-center gap-3">
              <WorkspaceSwitcher session={session} current={roleLabel} />
              <StaffUserMenu name={name} initials={initials} sub={sub} email={session.email} />
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-3">
              <PortalSwitcher session={session} />
              <div className="w-10 h-10 rounded-full bg-navy text-white flex items-center justify-center font-semibold text-sm" aria-hidden>{initials}</div>
              <div className="hidden sm:block leading-tight">
                <div className="font-semibold text-[15px]">{name}</div>
                <div className="text-xs text-muted capitalize">{sub}</div>
              </div>
              <form action="/auth/signout" method="post"><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-col md:flex-row">
        <SideNav sections={sections} moderation={moderation} badges={badges} mobileHidden={!!mobileBar} />
        <main className={`flex-1 min-w-0 px-4 sm:px-8 py-8 ${mobileBar ? 'pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-8' : ''}`}>
          <div className="max-w-[1280px] mx-auto">{children}</div>
        </main>
      </div>
      {mobileBar}
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


/* ───────── Staff top bar (SPEC §17.2): workspace switcher + user menu. Native <details> menus: no client JS. ───────── */
function WorkspaceSwitcher({ session, current }: { session: Session; current?: string }) {
  const list = workspacesFor(session);
  if (list.length < 2) return null;
  return (
    <details className="relative group">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer btn btn-ghost btn-sm gap-2">
        <span className="sr-only">Switch workspace{current ? ', current: ' : ''}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
        <span className="hidden md:inline">{current ?? 'Workspace'}</span>{current && <span className="sr-only md:hidden">{current}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className="transition-transform group-open:rotate-180"><path d="m6 9 6 6 6-6" /></svg>
      </summary>
      <div className="absolute right-0 mt-2 w-[300px] bg-white border border-line rounded-[10px] shadow-lg p-2 z-50" role="menu" aria-label="Workspaces">
        <div className="px-2 pt-1 pb-2 text-xs font-semibold text-muted uppercase tracking-wide">Switch workspace</div>
        {list.map((w) => (
          <form key={w.key} action={switchWorkspace}>
            <input type="hidden" name="workspace" value={w.key} />
            <button type="submit" role="menuitem" className="w-full text-left flex items-center gap-3 px-2 py-2 rounded-md hover:bg-surface">
              <span className="w-8 h-8 rounded-md bg-navy text-white text-xs font-bold flex items-center justify-center flex-none" aria-hidden>{w.short}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-navy">{w.label}</span>
                <span className="block text-xs text-muted truncate">{w.description}</span>
              </span>
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}

function StaffUserMenu({ name, initials, sub, email }: { name: string; initials: string; sub: string; email: string | null }) {
  const item = 'block w-full text-left px-3 py-2 rounded-md text-sm font-semibold text-navy hover:bg-surface';
  return (
    <details className="relative">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-3 rounded-md px-1 py-1 hover:bg-surface">
        <span className="sr-only">Account menu: </span>
        <span className="w-10 h-10 rounded-full bg-navy text-white flex items-center justify-center font-semibold text-sm" aria-hidden>{initials}</span>
        <span className="hidden sm:block leading-tight text-left">
          <span className="block font-semibold text-[15px]">{name}</span>
          <span className="block text-xs text-muted capitalize">{sub}</span>
        </span>
      </summary>
      <div className="absolute right-0 mt-2 w-[240px] bg-white border border-line rounded-[10px] shadow-lg p-2 z-50" role="menu" aria-label="Account">
        {email && <div className="px-3 pt-1 pb-2 text-xs text-muted truncate border-b border-line mb-1">{email}</div>}
        <Link href="/staff/account#profile" role="menuitem" className={item}>Profile</Link>
        <Link href="/staff/account#password" role="menuitem" className={item}>Change password</Link>
        <Link href="/staff/account#2fa" role="menuitem" className={item}>2FA devices</Link>
        <Link href="/staff/workspace" role="menuitem" className={item}>All workspaces</Link>
        <form action={staffSignOut} className="border-t border-line mt-1 pt-1">
          <button type="submit" role="menuitem" className={`${item} text-bad`}>Sign out</button>
        </form>
      </div>
    </details>
  );
}
