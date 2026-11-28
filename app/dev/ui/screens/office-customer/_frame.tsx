'use client';

import type { ReactNode } from 'react';
import type { WorkspaceTab } from '@octopus/ui';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE, SAMPLE_RECORDS } from '../office-frame/sample-data';

async function sampleSearch(q: string) {
  const t = q.trim().toLowerCase();
  return { items: SAMPLE_RECORDS.filter((r) => !t || `${r.label} ${r.description ?? ''}`.toLowerCase().includes(t)) };
}

const TABS: WorkspaceTab[] = [
  { id: 'dashboard', title: 'Dashboard', href: '/office', icon: 'dashboard', pinned: true },
  { id: 's-customers', title: 'Customers', href: '/admin/customers', icon: 'users' },
  { id: 's-customer', title: 'Anna Home Trading', href: '/admin/customers/sample-anna', icon: 'users' },
  { id: 's-invoices', title: 'Invoices', href: '/admin/finance/receivables', icon: 'bank' },
];

/** Staging fixture frame for the T9 customer screens: the REAL Back Office frame with SAMPLE data and the role's permissions. */
export function CustomerFixtureFrame({ roles, permissions, isAdmin, active, children }: { roles: string[]; permissions: string[]; isAdmin: boolean; active: 's-customers' | 's-customer'; children: ReactNode }) {
  return (
    <OfficeFrame
      data={{ ...SAMPLE_OFFICE, perms: { ...SAMPLE_OFFICE.perms, isAdmin, roles, permissions } }}
      search={sampleSearch}
      fixture={{
        pathname: active === 's-customer' ? '/admin/customers/sample-anna' : '/admin/customers',
        tabs: TABS,
        activeId: active,
        notifications: SAMPLE_NOTIFICATIONS,
        storageKey: `ods.office.fixture.customer.${active}`,
      }}
    >
      {children}
    </OfficeFrame>
  );
}
