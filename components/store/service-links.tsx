'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NewBadge } from '@/components/ds';

/** ADDON-44 ServiceRail items in the store header: Make My Brand (NEW) second; the active service is a navy pill. */
const ACTIVE: [RegExp, string][] = [
  [/^\/request\/sourcing/, 'sourcing'],
  [/^\/(make-my-brand|request\/brand)/, 'brand'],
  [/^\/request\/dropship/, 'dropship'],
  [/^\/pools?(\/|$)/, 'pools'],
  [/^\/request\/3pl/, '3pl'],
  [/^\/turnkey/, 'turnkey'],
];

export function ServiceLinks({ poolsOn, turnkeyOn, pill }: { poolsOn: boolean; turnkeyOn: boolean; pill: string }) {
  const path = usePathname() ?? '/';
  const active = ACTIVE.find(([re]) => re.test(path))?.[1];
  // brand kit: owner's order; routes that don't exist yet use their home-page anchor (fallback)
  const items: { key: string; href: string; label: string; isNew?: boolean }[] = [
    { key: 'dropship', href: '/#dropshipping', label: 'Dropshipping' },
    { key: 'brand', href: '/make-my-brand', label: 'Make My Brand', isNew: true },
    { key: 'sourcing', href: '/#sourcing', label: 'Product sourcing' },
    ...(poolsOn ? [{ key: 'pools', href: '/pools', label: 'MOQ pools' }] : []),
    ...(turnkeyOn ? [{ key: 'turnkey', href: '/turnkey', label: 'Turnkey Projects' }] : []),
    { key: '3pl', href: '/#warehousing', label: '3PL & shipping' },
  ];  return (
    <>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <li key={it.key} className="shrink-0">
            <Link href={it.href} aria-current={on ? 'page' : undefined} data-testid={`rail-${it.key}`}
              className={on ? 'inline-flex items-center gap-[7px] px-4 py-2 min-h-11 rounded-full bg-ink text-white text-[14px] font-semibold whitespace-nowrap hover:bg-ink-2 hover:text-white' : `${pill} min-h-11 text-navy`}>
              {it.label}{it.isNew && <NewBadge />}
            </Link>
          </li>
        );
      })}
    </>
  );
}

