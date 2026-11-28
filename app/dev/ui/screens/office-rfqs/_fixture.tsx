'use client';

import { RfqsScreen, type RfqsScreenProps, type RfqsViewsActions } from '@/app/ods/office/rfqs/_components/rfqs-screen';

const SAMPLE_VIEWS: RfqsViewsActions = {
  listViews: async () => ({
    ok: true,
    data: [
      { id: 'sv-r1', page: '/office/rfqs', name: 'My quoting', scope: 'personal', sharedRole: null, filters: { f: 'quoting' }, columns: [], sort: [], isDefault: false, mine: true, updatedAt: '2026-11-20T10:00:00Z' },
      { id: 'sv-r2', page: '/office/rfqs', name: 'Sourcing · waiting for buyer', scope: 'shared', sharedRole: 'sourcing_agent', filters: { f: 'quote_ready' }, columns: [], sort: [], isDefault: false, mine: false, updatedAt: '2026-11-18T10:00:00Z' },
    ],
  }),
  saveView: async (v) => ({ ok: true, data: { id: `sv-${Date.now()}`, page: v.page, name: v.name, scope: 'personal', sharedRole: null, filters: v.filters ?? {}, columns: [], sort: [], isDefault: false, mine: true, updatedAt: new Date().toISOString() } }),
};

/** Fixture: today's list screen with sample saved views; record links go to the record fixture. */
export function RfqsFixture(props: Omit<RfqsScreenProps, 'views' | 'recordHref'>) {
  return <RfqsScreen {...props} views={SAMPLE_VIEWS} recordHref={(r) => `/dev/ui/screens/office-rfq?rfq=${encodeURIComponent(r.code)}`} />;
}
