'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { NavSection } from '@/lib/nav';
import { moderationPendingCount } from '@/lib/moderation-count';

const MODERATION = '/office/products';

/** `moderation`: pending moderation count (server-rendered); refreshed on every navigation and every 60 s. */
export function SideNav({ sections, moderation = null, badges = {}, mobileHidden = false }: { sections: NavSection[]; moderation?: number | null; badges?: Record<string, number>; mobileHidden?: boolean }) {
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
  const active = all.filter((h) => !h.includes('?') && (path === h || path.startsWith(h + '/'))).sort((a, b) => b.length - a.length)[0];
  // Design handoff 26 Nov 2026 (App shell §3): sits inside the shell's 264 px sidebar (the shell owns width, background
  // and border); Jost group labels, 44 px items, current = tint + 3 px blue left border. Phones: one scrolling strip.
  return (
    <nav aria-label="Portal" className={`${mobileHidden ? 'hidden md:block ' : ''}min-w-0`}>
      <div className="flex md:flex-col gap-1.5 md:gap-0 overflow-x-auto md:overflow-visible -mx-1 px-1 md:mx-0 md:px-0">
        {sections.map((s, si) => (
          <div key={si} className="flex md:flex-col gap-1.5 md:gap-0.5">
            {s.title && <div className="hidden md:block app-grp">{s.title}</div>}
            {s.items.map((i) => {
              const badge = i.href === MODERATION && pending ? pending : badges[i.href] ?? 0;
              return (
                <Link key={i.href} href={i.href} aria-current={active === i.href ? 'page' : undefined}
                  className={cn('app-nav whitespace-nowrap flex-none justify-between gap-2')}>
                  <span>{i.label}</span>
                  {badge > 0 && (
                    <span data-testid={i.href === MODERATION ? 'moderation-badge' : 'nav-badge'} aria-label={i.href === MODERATION ? `${badge} pending` : `${badge} new`}
                      className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-bad text-white text-[12px] font-bold leading-[22px] text-center tabular-nums">
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
