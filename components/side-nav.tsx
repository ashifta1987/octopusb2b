'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { NavSection } from '@/lib/nav';
import { moderationPendingCount } from '@/lib/moderation-count';

const MODERATION = '/office/products';

/** `moderation`: pending moderation count (server-rendered); refreshed on every navigation and every 60 s. */
export function SideNav({ sections, moderation = null }: { sections: NavSection[]; moderation?: number | null }) {
  const path = usePathname();
  const [pending, setPending] = useState<number | null>(moderation);
  const hasModeration = sections.some((s) => s.items.some((i) => i.href === MODERATION));
  useEffect(() => {
    if (!hasModeration) return;
    let live = true;
    const load = () => moderationPendingCount().then((n) => { if (live && n !== null) setPending(n); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [path, hasModeration]);
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  // active = longest matching href
  const active = all.filter((h) => path === h || path.startsWith(h + '/')).sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Portal" className="md:w-[240px] md:min-h-[calc(100vh-69px)] bg-white border-b md:border-b-0 md:border-r border-line">
      <div className="flex md:flex-col gap-1.5 md:gap-1 overflow-x-auto px-3 py-2.5 md:px-3.5 md:py-5">
        {sections.map((s, si) => (
          <div key={si} className="flex md:flex-col gap-1.5 md:gap-1 md:mb-4">
            {s.title && <div className="hidden md:block px-3.5 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider text-muted">{s.title}</div>}
            {s.items.map((i) => {
              const badge = i.href === MODERATION && pending ? pending : 0;
              return (
                <Link key={i.href} href={i.href} aria-current={active === i.href ? 'page' : undefined}
                  className={cn('whitespace-nowrap rounded-[8px] px-3.5 py-2.5 md:py-3 text-[15px] font-medium flex-none flex items-center justify-between gap-2',
                    active === i.href ? 'bg-navy text-white font-semibold' : 'text-navy hover:bg-surface')}>
                  <span>{i.label}</span>
                  {badge > 0 && (
                    <span data-testid="moderation-badge" aria-label={`${badge} pending`}
                      className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#DC2626] text-white text-[12px] font-bold leading-[22px] text-center tabular-nums">
                      {badge > 999 ? '999+' : badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
