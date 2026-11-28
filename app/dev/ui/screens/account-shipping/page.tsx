import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageHead, PageWrap } from '@/app/ods/account/_services/ui';
import { ShippingView, type ShipmentRow, type ShippingState } from '@/app/ods/account/shipping/_components/shipping-view';
import { ServicesFixtureFrame, fixtureState } from '../account-turnkey/_frame';

export const metadata: Metadata = { title: 'My account · Shipping · ODS fixtures (staging)', robots: { index: false, follow: false } };

/* SAMPLE shipments (C_Shipping board example) — staging only. */
const ROWS: ShipmentRow[] = [
  { id: 's-1', kind: 'order', code: 'SHP-1042', title: 'Kitchen storage line', ref: { label: 'OCT-SRC-2026-0207', href: '/account/orders/OCT-SRC-2026-0207' }, carrier: 'DHL Express', service: 'Standard', trackingNo: '1Z999AA10123456784', trackingHref: null, group: 'in_transit', status: { label: 'In transit', tone: 'info' }, lastEvent: { text: 'Arrived at hub · Hong Kong', at: '2026-11-26T09:00:00Z' }, eta: '2026-12-01', updatedAt: '2026-11-26T09:00:00Z' },
  { id: 'w-1', kind: 'warehouse', code: 'WO-000231', title: 'Warehouse order to Omar S.', ref: { label: 'Your ref #1041', href: '/account/warehouse?tab=orders&order=WO-000231' }, carrier: null, service: 'AE', trackingNo: null, trackingHref: '/t/sample', group: 'in_transit', status: { label: 'Shipped', tone: 'info' }, lastEvent: null, eta: null, updatedAt: '2026-11-25T09:00:00Z' },
  { id: 's-2', kind: 'order', code: 'SHP-1038', title: 'Pet accessories range', ref: { label: 'OCT-SRC-2026-0199', href: '/account/orders/OCT-SRC-2026-0199' }, carrier: 'Aramex', service: 'Economy', trackingNo: 'AX55511', trackingHref: null, group: 'delivered', status: { label: 'Delivered', tone: 'success' }, lastEvent: { text: 'Delivered · Riyadh', at: '2026-11-21T09:00:00Z' }, eta: null, updatedAt: '2026-11-21T09:00:00Z' },
  { id: 's-3', kind: 'order', code: 'SHP-1035', title: 'Bamboo storage box', ref: null, carrier: 'DHL Express', service: 'Express', trackingNo: '1Z999AA10123450000', trackingHref: null, group: 'problem', status: { label: 'Problem', tone: 'danger' }, lastEvent: { text: 'Address could not be found · Dubai', at: '2026-11-20T09:00:00Z' }, eta: null, updatedAt: '2026-11-20T09:00:00Z' },
];

const STATES = [{ id: 'list', label: 'Shipments' }, { id: 'filtered', label: 'Filter: delivered' }, { id: 'empty', label: 'Empty' }, { id: 'loading', label: 'Loading' }, { id: 'error', label: 'Error' }];

export default function ShippingFixtures({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = fixtureState((await searchParams).state, STATES.map((s) => s.id));
  const s: ShippingState = state === 'empty' ? { kind: 'ready', rows: [] } : state === 'loading' ? { kind: 'loading' } : state === 'error' ? { kind: 'error' } : { kind: 'ready', rows: ROWS };
  return (
    <ServicesFixtureFrame path="/account/shipping" states={STATES} current={state}>
      <PageWrap>
        <PageHead title="Shipping" description="Your shipments and their tracking: order shipments and the orders our warehouse sent for you." />
        <ShippingView key={state} state={s} status={state === 'filtered' ? 'delivered' : 'all'} syncUrl={false} />
      </PageWrap>
    </ServicesFixtureFrame>
  );
}
