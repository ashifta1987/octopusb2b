'use client';

import type { ReactNode } from 'react';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { InvoicesScreen, type InvoicesActions, type InvoicesScreenProps } from '@/app/ods/office/accounts/invoices/_components/invoices-screen';
import { amountToMinor, runTwoPersonPayment } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import { SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE } from '../office-frame/sample-data';
import { SAMPLE_LIMIT } from './sample-data';

const TABS = [
  { id: 'dashboard', title: 'Dashboard', href: '/office', icon: 'dashboard', pinned: true },
  { id: 's-invoices', title: 'Invoices', href: '/office/accounts/invoices', icon: 'file' },
  { id: 's-cust', title: 'Anna Home Trading', href: '/admin/customers/sample-anna', icon: 'users' },
  { id: 's-bank', title: 'Bank reconciliation', href: '/admin/finance/transfers', icon: 'bank' },
];

/** Sample actions: the REAL two-person order (runTwoPersonPayment) with sample steps; nothing is saved anywhere. */
const SAMPLE_ACTIONS: InvoicesActions = {
  recordPayment: async (input) => {
    const minor = amountToMinor(input.amount);
    return runTwoPersonPayment({
      ready: async () => ({ ok: true, data: null }),
      request: async () => (minor > SAMPLE_LIMIT ? { ok: true, data: { required: true, id: 'sample', code: 'APR-00012' } } : { ok: true, data: { required: false } }),
      execute: async () => ({ ok: true, message: 'Payment recorded and posted to the ledger (sample — nothing was saved).' }),
      markExecuted: async () => ({ ok: true, data: null }),
    });
  },
  activity: async (id) => ({
    ok: true,
    items: [
      { id: `${id}:p2`, at: '2026-10-24T10:12:00Z', title: 'Order payment · deposit · confirmed', detail: 'bank transfer · FT2610240917', amountMinor: 123000, currency: 'USD' },
      { id: `${id}:e`, at: '2026-10-18T09:05:00Z', title: 'Emailed to the customer', detail: null, amountMinor: null, currency: null },
      { id: `${id}:i`, at: '2026-10-18T09:00:00Z', title: 'Issued', detail: null, amountMinor: null, currency: null },
    ],
  }),
  listViews: async () => ({
    ok: true,
    data: [
      { id: 'sv-1', page: '/office/accounts/invoices', name: 'My Sourcing invoices', scope: 'personal', sharedRole: null, filters: { service: 'SRC' }, columns: [], sort: [], isDefault: false, mine: true, updatedAt: '2026-11-20T10:00:00Z' },
      { id: 'sv-2', page: '/office/accounts/invoices', name: 'Turnkey · partly paid', scope: 'shared', sharedRole: 'finance', filters: { status: 'partly', service: 'TK' }, columns: [], sort: [], isDefault: false, mine: false, updatedAt: '2026-11-18T10:00:00Z' },
    ],
  }),
  saveView: async (v) => ({ ok: true, data: { id: `sv-${Date.now()}`, page: v.page, name: v.name, scope: 'personal', sharedRole: null, filters: v.filters ?? {}, columns: [], sort: v.sort ?? [], isDefault: false, mine: true, updatedAt: new Date().toISOString() } }),
};

export function InvoicesFixture({ nav, screen }: { nav: ReactNode; screen: Omit<InvoicesScreenProps, 'actions'> }) {
  return (
    <OfficeFrame
      data={SAMPLE_OFFICE}
      search={async () => ({ items: [] })}
      fixture={{ pathname: '/office/accounts/invoices', tabs: TABS, activeId: 's-invoices', notifications: SAMPLE_NOTIFICATIONS, storageKey: 'ods.office.fixture.invoices' }}
    >
      {nav}
      <InvoicesScreen {...screen} actions={SAMPLE_ACTIONS} />
    </OfficeFrame>
  );
}
