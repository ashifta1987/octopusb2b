'use client';

import type { ReactNode } from 'react';
import type { WorkspaceTab } from '@octopus/ui';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE, SAMPLE_RECORDS } from './office-frame/sample-data';

async function sampleSearch(q: string) {
  const t = q.trim().toLowerCase();
  return { items: SAMPLE_RECORDS.filter((r) => !t || `${r.label} ${r.description ?? ''}`.toLowerCase().includes(t)) };
}

const TABS: WorkspaceTab[] = [
  { id: 'dashboard', title: 'Dashboard', href: '/office', icon: 'dashboard', pinned: true },
  { id: 'tk-home', title: 'Turnkey', href: '/admin/turnkey', icon: 'layers' },
  { id: 'tk-projects', title: 'Client projects', href: '/admin/turnkey/projects' },
  { id: 'tk-project', title: 'TKP-00012 · Robotic cafe', href: '/admin/turnkey/projects/TKP-00012' },
];

/** Staging fixture frame for the T9 Turnkey screens: the REAL Back Office frame, SAMPLE data, the role's permissions. */
export function TurnkeyFixtureFrame({ pathname, activeId = 'tk-home', isAdmin, roles, permissions, children }: { pathname: string; activeId?: string; isAdmin: boolean; roles: string[]; permissions: string[]; children: ReactNode }) {
  return (
    <OfficeFrame
      data={{ ...SAMPLE_OFFICE, perms: { ...SAMPLE_OFFICE.perms, isAdmin, roles, permissions } }}
      search={sampleSearch}
      fixture={{ pathname, tabs: TABS, activeId, notifications: SAMPLE_NOTIFICATIONS, storageKey: `ods.office.fixture.turnkey.${activeId}` }}
    >
      {children}
    </OfficeFrame>
  );
}
