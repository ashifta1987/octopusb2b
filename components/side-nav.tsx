'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { NavSection } from '@/lib/nav';

export function SideNav({ sections }: { sections: NavSection[] }) {
  const path = usePathname();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  // active = longest matching href
  const active = all.filter((h) => path === h || path.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Portal" className="md:w-[240px] md:min-h-[calc(100vh-69px)] bg-white border-b md:border-b-0 md:border-r border-line">
      <div className="flex md:flex-col gap-1.5 md:gap-1 overflow-x-auto px-3 py-2.5 md:px-3.5 md:py-5">
        {sections.map((s, si) => (
          <div key={si} className="flex md:flex-col gap-1.5 md:gap-1 md:mb-4">
            {s.title && <div className="hidden md:block px-3.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-muted">{s.title}</div>}
            {s.items.map((i) => (
              <Link key={i.href} href={i.href} aria-current={active === i.href ? 'page' : undefined}
                className={cn('whitespace-nowrap rounded-[8px] px-3.5 py-2.5 md:py-3 text-[15px] font-medium flex-none',
                  active === i.href ? 'bg-navy text-white font-semibold' : 'text-navy hover:bg-surface')}>
                {i.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

