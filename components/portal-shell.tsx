import Link from 'next/link';
import { SideNav } from '@/components/side-nav';
import type { NavSection } from '@/lib/nav';
import type { Session } from '@/lib/auth';
import { can } from '@/lib/auth';
import { MaintenanceNotice } from '@/components/maintenance-notice';
import { workspacesFor } from '@/lib/staff/workspaces';
import { staffSignOut, switchWorkspace } from '@/lib/staff/actions';
import { AppLogo } from '@/components/shell/app-logo';

/**
 * Portal layout: left sidebar (role-filtered) that becomes a horizontal tab bar under 760px (SPEC §8.2).
 * Design handoff 26 Nov 2026 (App shell §3): 264 px white sidebar with the full-colour logo, Jost group labels and
 * 44 px items ("Switch workspace" pinned to the bottom for staff), white top bar with search and the user chip.
 */
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
  const staffOnly = session.isStaff && !session.org;
  // unique per portal (Next keeps a previous portal's layout in the DOM, hidden), so the skip link finds the visible one
  const mainId = `portal-main-${(roleLabel ?? 'portal').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="app-shell min-h-screen bg-pearl">
      <a href={`#${mainId}`} className="skip-link">Skip to content</a>
      <MaintenanceNotice />
      <div className="app-cols md:grid md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:min-h-screen">
        <header className="app-topbar gap-4 md:col-start-2 md:row-start-1">
          <AppLogo size="bar" className="md:hidden" />
          <form action="/search" className="flex-1 min-w-[200px] max-w-[520px]" role="search">
            <label htmlFor="portal-q" className="sr-only">Search</label>
            <input id="portal-q" name="q" className="input" placeholder={searchPlaceholder} />
          </form>
          {staffOnly ? (
            <div className="ml-auto flex items-center gap-3">
              <StaffUserMenu name={name} initials={initials} sub={sub} email={session.email} />
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-3">
              <PortalSwitcher session={session} />
              <div className="app-chip hover:bg-white">
                <div className="app-avatar" aria-hidden>{initials}</div>
                <div className="hidden sm:block leading-tight">
                  <div className="font-bold text-[14px] text-ink">{name}</div>
                  <div className="text-[12px] text-muted capitalize">{sub}</div>
                </div>
              </div>
              <form action="/auth/signout" method="post"><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
            </div>
          )}
        </header>
        <aside className={`app-sidebar gap-3 md:gap-0 md:col-start-1 md:row-start-1 md:row-span-2 md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto md:border-r md:px-3.5 md:pt-6 md:pb-7 ${mobileBar ? 'hidden md:flex' : 'px-4 py-3 border-b md:border-b-0'}`}>
          <div className="hidden md:block px-2 pb-3"><AppLogo /></div>
          <SideNav sections={sections} moderation={moderation} badges={badges} mobileHidden={!!mobileBar} />
          {staffOnly && (
            <div className="md:mt-auto md:pt-6 empty:hidden">
              <WorkspaceSwitcher session={session} current={roleLabel} placement="sidebar" />
            </div>
          )}
        </aside>
        <main id={mainId} tabIndex={-1} className={`app-main md:col-start-2 md:row-start-2 ${mobileBar ? 'pb-[calc(96px+env(safe-area-inset-bottom))] md:pb-[72px]' : ''}`}>
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
      {links.map((l) => <Link key={l.href} href={l.href} className="inline-flex items-center min-h-11 px-3 rounded-[10px] text-sm font-bold text-muted hover:text-ink hover:bg-sand">{l.label}</Link>)}
    </nav>
  );
}


/* ───────── Staff top bar (SPEC §17.2): workspace switcher + user menu. Native <details> menus: no client JS. ───────── */
/**
 * `placement="sidebar"` (design handoff §3): a full-width "Switch workspace" nav item pinned to the bottom of the
 * sidebar; the menu opens upwards from md up (downwards on phones, where the sidebar sits above the page).
 */
export function WorkspaceSwitcher({ session, current, placement = 'bar' }: { session: Session; current?: string; placement?: 'bar' | 'sidebar' }) {
  const list = workspacesFor(session);
  if (list.length < 2) return null;
  const side = placement === 'sidebar';
  return (
    <details className="relative group">
      <summary className={side
        ? 'app-nav list-none [&::-webkit-details-marker]:hidden cursor-pointer'
        : 'list-none [&::-webkit-details-marker]:hidden cursor-pointer btn btn-ghost btn-sm gap-2'}>
        {side ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 7h13l-3-3M17 17H4l3 3" /></svg>
            <span className="flex-1 min-w-0 truncate">Switch workspace<span className="sr-only">{current ? ', current: ' : ''}</span>{current && <span className="sr-only">{current}</span>}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className="transition-transform rotate-180 md:rotate-0 group-open:rotate-0 md:group-open:rotate-180"><path d="m6 15 6-6 6 6" /></svg>
          </>
        ) : (
          <>
            <span className="sr-only">Switch workspace{current ? ', current: ' : ''}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            <span className="hidden md:inline">{current ?? 'Workspace'}</span>{current && <span className="sr-only md:hidden">{current}</span>}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden className="transition-transform group-open:rotate-180"><path d="m6 9 6 6 6-6" /></svg>
          </>
        )}
      </summary>
      <div className={`absolute w-[300px] max-w-[calc(100vw-32px)] bg-white border border-line rounded-[12px] shadow-lg p-2 z-50 ${side ? 'left-0 top-full mt-2 md:top-auto md:mt-0 md:bottom-full md:mb-2' : 'right-0 mt-2'}`} role="menu" aria-label="Workspaces">
        <div className="px-2 pt-1 pb-2 font-mono text-[11px] font-semibold text-muted uppercase tracking-[.14em]">Switch workspace</div>
        {list.map((w) => (
          <form key={w.key} action={switchWorkspace}>
            <input type="hidden" name="workspace" value={w.key} />
            <button type="submit" role="menuitem" className="w-full text-left flex items-center gap-3 min-h-11 px-2 py-2 rounded-[10px] hover:bg-sand">
              <span className="w-9 h-9 rounded-[10px] bg-ink text-white text-xs font-bold flex items-center justify-center flex-none" aria-hidden>{w.short}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{w.label}</span>
                <span className="block text-xs text-muted truncate">{w.description}</span>
              </span>
            </button>
          </form>
        ))}
      </div>
    </details>
  );
}

export function StaffUserMenu({ name, initials, sub, email }: { name: string; initials: string; sub: string; email: string | null }) {
  const item = 'flex items-center w-full text-left min-h-11 px-3 rounded-[10px] text-sm font-semibold text-ink hover:bg-sand';
  return (
    <details className="relative">
      <summary className="app-chip list-none [&::-webkit-details-marker]:hidden cursor-pointer max-sm:pr-1.5">
        <span className="sr-only">Account menu: </span>
        <span className="app-avatar bg-ink" aria-hidden>{initials}</span>
        <span className="hidden sm:block leading-tight text-left">
          <span className="block font-bold text-[14px] text-ink">{name}</span>
          <span className="block text-[12px] text-muted capitalize">{sub}</span>
        </span>
      </summary>
      <div className="absolute right-0 mt-2 w-[240px] bg-white border border-line rounded-[12px] shadow-lg p-2 z-50" role="menu" aria-label="Account">
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
