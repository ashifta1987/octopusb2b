'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@octopus/ui/cx';
import { GROUPS } from './_groups';


/** Gallery navigation between the /dev/ui pages (aria-current on the open page). */
export function DevNav() {
  const path = usePathname();
  return (
    <nav aria-label="Design system pages" className="min-w-0">
      <ul className="flex gap-1 overflow-x-auto">
        {GROUPS.map((g) => {
          const current = path === g.href;
          return (
            <li key={g.href} className="shrink-0">
              <Link
                href={g.href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  'inline-flex min-h-11 items-center rounded-ods-control px-3 text-ods-label font-semibold',
                  current ? 'bg-ods-blue-tint text-ods-navy' : 'text-ods-blue hover:bg-ods-blue-tint',
                )}
              >
                {g.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
