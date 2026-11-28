'use client';

import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { OrdersScreen, type OrdersScreenProps, type OrdersViewActions } from '@/app/ods/office/orders/_components/orders-screen';
import { OrderRecord, type OrderRecordActions, type OrderRecordProps } from '@/app/ods/office/orders/_components/order-record';
import { OrderRecordSkeleton } from '@/app/ods/office/orders/_components/order-record-skeleton';
import { SupportScreen, type SupportActions, type SupportScreenProps } from '@/app/ods/office/support/_components/support-screen';
import { amountToMinor, runTwoPersonPayment } from '@/app/ods/office/accounts/invoices/_lib/invoice-core';
import type { SampleRole } from '../office-dashboard/sample-data';
import { SAMPLE_LIMIT } from './sample-data';

type Links = { href: string; text: string; current: boolean }[];

/** Sample saved views (nothing is stored). */
const VIEW_ACTIONS: OrdersViewActions = {
  listViews: async () => ({
    ok: true,
    data: [{ id: 'sv-o1', page: '/office/orders', name: 'My Sourcing orders', scope: 'personal', sharedRole: null, filters: { tab: 'active', q: 'SRC' }, columns: [], sort: [], isDefault: false, mine: true, updatedAt: '2026-11-20T10:00:00Z' }],
  }),
  saveView: async (v) => ({ ok: true, data: { id: `sv-${Date.now()}`, page: v.page, name: v.name, scope: 'personal', sharedRole: null, filters: v.filters ?? {}, columns: [], sort: v.sort ?? [], isDefault: false, mine: true, updatedAt: new Date().toISOString() } }),
};

/** Sample record actions: the REAL two-person order (runTwoPersonPayment) with sample steps; nothing is saved. */
const RECORD_ACTIONS: OrderRecordActions = {
  recordPayment: async (input) => {
    const minor = amountToMinor(input.amount);
    return runTwoPersonPayment({
      ready: async () => ({ ok: true, data: null }),
      request: async () => (minor > SAMPLE_LIMIT ? { ok: true, data: { required: true, id: 'sample', code: 'APR-00031' } } : { ok: true, data: { required: false } }),
      execute: async () => ({ ok: true, message: 'Payment recorded and posted to the ledger (sample — nothing was saved).' }),
      markExecuted: async () => ({ ok: true, data: null }),
    });
  },
  move: async (_id, to) => ({ ok: true, message: `Order updated (sample — moved to ${to.replace(/_/g, ' ')}, nothing was saved)` }),
};

const ok = (message: string) => async () => ({ ok: true as const, message: `${message} (sample — nothing was saved)` });
const SUPPORT_ACTIONS: SupportActions = {
  reply: ok('Reply sent'),
  setStatus: ok('Status updated'),
  setPriority: ok('Priority updated'),
  assignToMe: ok('Assigned to you'),
  saveMacro: ok('Macro saved'),
  escalate: ok('Sent to Finance for approval (maker–checker)'),
};

export function OrdersFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<OrdersScreenProps, 'actions'> }) {
  return (
    <OfficeScreenFrame role={role} pathname="/office/orders">
      <FixtureStates label="Fixture states (sample data)" links={links} />
      <OrdersScreen {...screen} actions={VIEW_ACTIONS} />
    </OfficeScreenFrame>
  );
}

export function OrderFixture({ role, links, record, loading }: { role: SampleRole; links: Links; record: Omit<OrderRecordProps, 'actions' | 'fixture'>; loading?: boolean }) {
  return (
    <OfficeScreenFrame role={role} pathname="/office/orders">
      <FixtureStates label="Fixture states (sample data)" links={links} />
      {loading ? <OrderRecordSkeleton /> : <OrderRecord {...record} actions={RECORD_ACTIONS} fixture />}
    </OfficeScreenFrame>
  );
}

export function SupportFixture({ role, links, screen }: { role: SampleRole; links: Links; screen: Omit<SupportScreenProps, 'actions' | 'fixture'> }) {
  return (
    <OfficeScreenFrame role={role} pathname="/office/support">
      <FixtureStates label="Fixture states (sample data)" links={links} />
      <SupportScreen {...screen} actions={SUPPORT_ACTIONS} fixture />
    </OfficeScreenFrame>
  );
}
