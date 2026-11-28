'use client';

import type { ReactNode } from 'react';
import { OfficeFrame } from '@/app/ods/office/_components/office-frame';
import { SAMPLE_MANY_TABS, SAMPLE_NOTIFICATIONS, SAMPLE_OFFICE, SAMPLE_RECORDS, SAMPLE_TABS, type OfficeFixtureState } from './sample-data';

/** Sample record search (client-side filter over SAMPLE_RECORDS; empty query = everything, for the palette state). */
async function sampleSearch(q: string) {
  const t = q.trim().toLowerCase();
  return { items: SAMPLE_RECORDS.filter((r) => !t || `${r.label} ${r.description ?? ''}`.toLowerCase().includes(t)) };
}

/** Staging fixture: the REAL Back Office frame (OfficeFrame) with SAMPLE data, no navigation, per state. */
export function OfficeFrameFixture({ state, children }: { state: OfficeFixtureState; children: ReactNode }) {
  const pathname = state === 'phone' ? '/admin/settings/payment' : '/office/orders';
  const tabs = state === 'many-tabs' ? SAMPLE_MANY_TABS : SAMPLE_TABS;
  return (
    <OfficeFrame
      data={SAMPLE_OFFICE}
      search={sampleSearch}
      fixture={{
        pathname,
        tabs,
        activeId: 's-orders',
        dirtyTabId: state === 'unsaved' ? 's-order' : undefined,
        collapsed: state === 'collapsed',
        paletteOpen: state === 'palette',
        shortcutsOpen: state === 'shortcuts',
        notificationsOpen: state === 'alerts',
        notifications: SAMPLE_NOTIFICATIONS,
        storageKey: `ods.office.fixture.${state}`,
      }}
    >
      {children}
    </OfficeFrame>
  );
}
