'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** ADDON-41 board 01 — service tabs and the section side menu (both follow the current path). */
export type Tab = { key: string; label: string; href: string; match: string[] };
export type MenuSection = { title: string; items: { href: string; label: string; badge?: number }[] };

const tabOf = (tabs: Tab[], path: string) =>
  tabs.slice(1).find((t) => t.match.some((m) => path === m || path.startsWith(m + '/')))?.key ?? tabs[0].key;

export function AccountTabs({ tabs }: { tabs: Tab[] }) {
  const path = usePathname();
  const cur = tabOf(tabs, path);
  return (
    <nav aria-label="Services" className="bg-white border-b border-line" data-testid="account-tabs">
      <ul className="max-w-[1440px] mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <li key={t.key} className="shrink-0">
            <Link href={t.href} aria-current={t.key === cur ? 'page' : undefined}
              className={`inline-flex items-center min-h-[48px] px-3.5 text-[15px] font-medium border-b-[3px] ${t.key === cur ? 'border-blue text-navy font-semibold' : 'border-transparent text-[#3B4556] hover:text-navy'}`}>
              {t.label}
            </Link>
          </li>
        ))}
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
        <div key={s.title} className="mb-5">
          <div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-[#5A6475] px-3 mb-1.5">{s.title}</div>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const on = i.href.split('#')[0] === active && !i.href.includes('#');
              return (
                <li key={i.href}>
                  <Link href={i.href} aria-current={on ? 'page' : undefined}
                    className={`flex items-center justify-between min-h-[44px] px-3 rounded-[10px] text-[15px] ${on ? 'bg-navy text-white font-semibold' : 'text-[#2B3445] hover:bg-surface'}`}>
                    {i.label}
                    {!!i.badge && i.badge > 0 && <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-blue text-white text-[12px] font-bold leading-[22px] text-center">{i.badge}</span>}
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

