'use client';

import type { ReactNode } from 'react';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE, SAMPLE_RECORDS, SAMPLE_TABS } from './office-frame/sample-data';
import { SAMPLE_PERMS, SAMPLE_USER, type SampleRole } from './office-dashboard/sample-data';

async function sampleSearch(q: string) {
  const t = q.trim().toLowerCase();
  return { items: SAMPLE_RECORDS.filter((r) => !t || `${r.label} ${r.description ?? ''}`.toLowerCase().includes(t)) };
}

/**
 * Staging fixtures (T9 screens): the REAL Back Office frame (OfficeFrame, compact) with SAMPLE staff data for a role,
 * fixed path (sidebar current item, phone BottomNav), no navigation. Children = the ODS screen with sample props.
 */
export function OfficeScreenFrame({ role = 'finance', pathname, children }: { role?: SampleRole; pathname: string; children: ReactNode }) {
  const data = {
    ...SAMPLE_OFFICE,
    perms: SAMPLE_PERMS[role],
    user: { ...SAMPLE_OFFICE.user, name: SAMPLE_USER[role].name, role: SAMPLE_USER[role].role },
  };
  return (
    <OfficeFrame
      data={data}
      search={sampleSearch}
      fixture={{
        pathname,
        tabs: SAMPLE_TABS.slice(0, 3),
        activeId: 'dashboard',
        notifications: SAMPLE_NOTIFICATIONS,
        storageKey: `ods.office.fixture.t9.${pathname}.${role}`,
      }}
    >
      {children}
    </OfficeFrame>
  );
}

/** Fixture state links (no headings, so the screen keeps its single H1). */
export function FixtureStates({ label, links }: { label: string; links: { href: string; text: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="mb-3" data-testid="fixture-states">
      <p className="m-0 text-ods-small text-ods-slate">Staging fixture · sample data for design review only</p>
      <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
        {links.map((l) => (
          <li key={`${l.text}:${l.href}`}>
            <a
              href={l.href}
              aria-current={l.current ? 'page' : undefined}
              className={`inline-flex min-h-7 items-center rounded-ods-control border px-2.5 text-ods-small font-semibold no-underline ${l.current ? 'border-ods-navy bg-ods-navy text-white' : 'border-ods-line-strong bg-ods-surface text-ods-navy'}`}
            >
              {l.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
