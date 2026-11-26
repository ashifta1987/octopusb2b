'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UnreadMenuBadge } from '@/components/account/unread-count';

/**
 * ADDON-41 board 01 — service tabs and the section side menu (both follow the current path).
 * Design handoff 26 Nov 2026 (App shell §3): `variant="sidebar"` shows the tabs as the sidebar's 44 px nav items from
 * md up (tint + 3 px blue left border when current) and keeps the horizontal tab strip on phones; `variant="bar"`
 * (staff) is the horizontal strip at every width. One element either way (same test id, landmark and names).
 */
export type Tab = { key: string; label: string; href: string; match: string[] };
export type MenuSection = { title: string; items: { href: string; label: string; badge?: number }[] };

const tabOf = (tabs: Tab[], path: string) =>
  tabs.slice(1).find((t) => t.match.some((m) => path === m || path.startsWith(m + '/')))?.key ?? tabs[0].key;

const ICON: Record<string, string> = {
  home: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  sourcing: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5',
  dropship: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  warehouse: 'M3 21V9l9-5 9 5v12M7 21v-7h10v7M7 17h10',
  brand: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  wallet: 'M3 6h18v13H3zM3 10h18M16 15h2',
};

export function AccountTabs({ tabs, variant = 'bar' }: { tabs: Tab[]; variant?: 'bar' | 'sidebar' }) {
  const path = usePathname();
  const cur = tabOf(tabs, path);
  const side = variant === 'sidebar';
  return (
    <nav aria-label="Services" className={side ? 'bg-white border-b border-line md:border-b-0' : 'bg-white border-b border-line'} data-testid="account-tabs">
      <ul className={side
        ? 'px-4 sm:px-6 flex gap-1 overflow-x-auto md:px-0 md:flex-col md:gap-0.5 md:overflow-visible'
        : 'px-4 sm:px-6 lg:px-12 flex gap-1 overflow-x-auto'}>
        {tabs.map((t) => {
          const on = t.key === cur;
          return (
            <li key={t.key} className="shrink-0">
              <Link href={t.href} aria-current={on ? 'page' : undefined}
                className={side
                  ? `inline-flex items-center min-h-12 px-3.5 text-[15px] font-medium border-b-[3px] ${on ? 'border-coral-text text-ink font-semibold' : 'border-transparent text-black hover:text-ink'} md:flex md:gap-3.5 md:min-h-11 md:rounded-[10px] md:border-b-0 md:border-l-[3px] md:font-semibold md:text-ink ${on ? 'md:bg-tint md:border-coral md:font-bold' : 'md:border-transparent md:hover:bg-sand'}`
                  : `inline-flex items-center min-h-12 px-3.5 text-[15px] border-b-[3px] ${on ? 'border-coral text-ink font-bold' : 'border-transparent text-ink font-semibold hover:bg-sand'}`}>
                {side && ICON[t.key] && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="hidden md:block flex-none">
                    <path d={ICON[t.key]} />
                  </svg>
                )}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SectionMenu({ tabs, menus }: { tabs: Tab[]; menus: Record<string, MenuSection[]> }) {
  const path = usePathname();
  const sections = menus[tabOf(tabs, path)] ?? menus[tabs[0].key];
  const hrefs = sections.flatMap((s) => s.items.map((i) => i.href.split('#')[0]));
  const active = hrefs.filter((h) => path === h || path.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Section" data-testid="section-menu">
      {sections.map((s) => (
        <div key={s.title}>
          <div className="app-grp">{s.title}</div>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const on = i.href.split('#')[0] === active && !i.href.includes('#');
              return (
                <li key={i.href}>
                  <Link href={i.href} prefetch={false} aria-current={on ? 'page' : undefined} className="app-nav justify-between">
                    {i.label}
                    {/* Notifications: live count (drops at once when one is opened — bug 1, 8 Nov 2026) */}
                    {i.href === '/account/notifications' ? <UnreadMenuBadge count={i.badge ?? 0} /> : !!i.badge && i.badge > 0 && <span data-testid="nav-badge" aria-label={`${i.badge} new`} className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-coral text-white text-[12px] font-bold leading-[22px] text-center">{i.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
