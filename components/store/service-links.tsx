'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SERVICES, type ServiceKey } from '@/components/site/ui';

/** Website service bar (design §3): the six services on navy; the current one is underlined in on-ink-link. */
const ACTIVE: [RegExp, ServiceKey][] = [
  // owner 27 Nov: the product catalogue (/products, /c/…, /p/…, /search) belongs to Octopus Sourcing
  [/^\/(sourcing|request\/sourcing|products|c|p|search)(\/|$)/, 'sourcing'],
  [/^\/(make-my-brand|request\/brand)(\/|$)/, 'brand'],
  [/^\/request\/dropship(\/|$)/, 'dropship'],
  [/^\/pools?(\/|$)/, 'pools'],
  [/^\/3pl(\/|$)/, '3pl'],
  [/^\/turnkey(\/|$)/, 'turnkey'],
];

export function ServiceLinks({ poolsOn, turnkeyOn }: { poolsOn: boolean; turnkeyOn: boolean }) {
  const path = usePathname() ?? '/';
  const active = ACTIVE.find(([re]) => re.test(path))?.[1];
  const items = SERVICES.filter((s) => (s.key !== 'pools' || poolsOn) && (s.key !== 'turnkey' || turnkeyOn));
  return (
    <>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <li key={it.key} className="shrink-0">
            <Link href={it.href} aria-current={on ? 'page' : undefined} data-testid={`rail-${it.key}`}
              className={`inline-flex items-center min-h-11 border-b-2 text-white hover:text-on-ink-link ${on ? 'border-on-ink-link' : 'border-transparent'}`}>
              {it.label}
            </Link>
          </li>
        );
      })}
    </>
  );
}
