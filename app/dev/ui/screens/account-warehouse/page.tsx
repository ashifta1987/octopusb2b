import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PageWrap } from '@/app/ods/account/_services/ui';
import type { WarehouseTab } from '@/app/ods/account/_services/logic';
import {
  FeesPanel, InboundPanel, OutboundPanel, StockPanel, WarehouseKpiStrip, WarehouseNotStarted, WarehouseView, type FeesData,
} from '@/app/ods/account/warehouse/_components/warehouse-view';
import type { InboundRow, OutboundRow, StockRow } from '@/app/ods/account/warehouse/_components/warehouse-tables';
import { ServicesFixtureFrame, fixtureState } from '../account-turnkey/_frame';

export const metadata: Metadata = { title: 'My account · Warehouse · ODS fixtures (staging)', robots: { index: false, follow: false } };

/* SAMPLE data (C_Warehouse board example) — staging only. */
const STOCK: StockRow[] = [
  { id: 's1', sku: 'AH-BM-01', name: 'Silicone baking mat set', on_hand: 1000, reserved: 40, available: 960, incoming: 600, checking: 0, days_cover: 48, status: 'active' },
  { id: 's2', sku: 'AH-SB-02', name: 'Bamboo storage box', on_hand: 240, reserved: 200, available: 40, incoming: 0, checking: 0, days_cover: 6, status: 'active' },
  { id: 's3', sku: 'AH-LB-03', name: 'Linen bread bag', on_hand: 0, reserved: 0, available: 0, incoming: 0, checking: 0, days_cover: null, status: 'active' },
];
const INBOUND: InboundRow[] = [
  { id: 'a1', code: 'ASN-000012', warehouse: 'Shenzhen warehouse', expected_date: '2026-12-02', cartons: 2, units: 600, received: null, status: { key: 'booked', label: 'Booked', tone: 'info' }, checking: 0 },
  { id: 'a2', code: 'ASN-000011', warehouse: 'Shenzhen warehouse', expected_date: '2026-11-24', cartons: 4, units: 1000, received: 1000, status: { key: 'received', label: 'Received', tone: 'success' }, checking: 0 },
];
const OUTBOUND: OutboundRow[] = [
  { id: 'o1', code: 'WO-000231', external_ref: '#1041', ship_to: 'Omar S. · AE', status: { key: 'shipped', label: 'Shipped', tone: 'success' }, created_at: '2026-11-25T09:00:00Z', shipped_at: '2026-11-26T09:00:00Z', tracking_token: 'sample', units: 2 },
  { id: 'o2', code: 'WO-000232', external_ref: null, ship_to: 'Priya R. · SA', status: { key: 'picking', label: 'Picking', tone: 'info' }, created_at: '2026-11-27T09:00:00Z', shipped_at: null, tracking_token: null, units: 1 },
];
const FEES: FeesData = {
  rates: { plan: 'Standard', warehouse: null, version: 3, receiving_per_carton_cents: null, storage_per_cbm_month_cents: null, storage_per_pallet_month_cents: null, pick_pack_first_cents: null, pick_pack_extra_cents: null, returns_per_item_cents: null, min_monthly_cents: null },
  statements: [{ id: 'st1', period: 'October 2026', number: 'WH-2026-10-0007', total_cents: 18_450, paid_cents: 18_450, currency: 'USD', status: { label: 'Paid', tone: 'success' } }],
};

const STATES = [
  { id: 'stock', label: 'Stock with low stock' }, { id: 'inbound', label: 'Inbound' }, { id: 'outbound', label: 'Outbound' }, { id: 'fees', label: 'Fees (rates not set)' },
  { id: 'empty', label: 'New client (empty)' }, { id: 'error', label: 'Stock failed, others fine' }, { id: 'loading', label: 'Loading' },
  { id: 'not-started', label: 'Not switched on' }, { id: 'setting-up', label: 'Being set up' },
];

export default function WarehouseFixtures({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>;
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = fixtureState((await searchParams).state, STATES.map((s) => s.id));
  const empty = state === 'empty', loading = state === 'loading';
  const tab: WarehouseTab = (['inbound', 'outbound', 'fees'] as const).find((t) => t === state) ?? 'stock';
  const kpis = loading ? { kind: 'loading' as const } : { kind: 'ready' as const, data: empty ? { onHand: null, available: null, products: 0, inboundOpen: 0, inboundUnits: 0, openOrders: 0 } : { onHand: 1240, available: 1000, products: 3, inboundOpen: 1, inboundUnits: 600, openOrders: 1 } };
  const view = (
    <WarehouseView tab={tab} tabParam={null} kpis={<WarehouseKpiStrip state={kpis} />} panels={{
      stock: <StockPanel coverDays={14} state={loading ? { kind: 'loading' } : state === 'error' ? { kind: 'error' } : { kind: 'ready', data: empty ? [] : STOCK }} />,
      inbound: <InboundPanel state={loading ? { kind: 'loading' } : { kind: 'ready', data: empty ? [] : INBOUND }} />,
      outbound: <OutboundPanel state={loading ? { kind: 'loading' } : { kind: 'ready', data: empty ? [] : OUTBOUND }} />,
      fees: <FeesPanel state={loading ? { kind: 'loading' } : { kind: 'ready', data: empty ? { rates: null, statements: [] } : FEES }} />,
    }} />
  );
  return (
    <ServicesFixtureFrame path="/account/warehouse" states={STATES} current={state}>
      <PageWrap>
        {state === 'not-started' || state === 'setting-up' ? (
          <WarehouseNotStarted settingUp={state === 'setting-up'} />
        ) : view}
      </PageWrap>
    </ServicesFixtureFrame>
  );
}
