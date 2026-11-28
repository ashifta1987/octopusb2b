'use client';

import { StatusPill } from '@octopus/ui';
import { B2bShipments } from '@/app/ods/office/warehouse/b2b-shipments/_components/b2b-shipments';
import { CreateShipment } from '@/app/ods/office/warehouse/b2b-shipments/_components/create-shipment';
import { applyShippingAccess, b2bShippingAccess, b2bView } from '@/app/ods/office/warehouse/b2b-shipments/_lib/shipping-core';
import { SalesPageHead } from '@/app/ods/office/_components/sales-bits';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { B2B_FIXTURE_STATES, SAMPLE_READY, SAMPLE_SHIPMENTS, type B2bFixtureState } from './sample-data';

const BASE = '/dev/ui/screens/office-b2b-shipments';
const wait = () => new Promise((r) => setTimeout(r, 250));

export function B2bFixture({ state }: { state: B2bFixtureState }) {
  const support = state === 'support';
  const a = b2bShippingAccess({ isAdmin: false, can: (area, action) => (support ? area === 'orders' && action === 'view' : state === 'create-view-only' ? (area === 'suppliers' && action === 'view') || (area === 'orders' && action === 'view') : ['orders:view', 'orders:edit', 'warehouse:view'].includes(`${area}:${action}`)) });
  const none = state === 'empty' || state === 'error' || state === 'loading';
  const ships = none ? [] : SAMPLE_SHIPMENTS.map((s) => applyShippingAccess(s, a));
  const create = state === 'create' || state === 'create-view-only';
  const actions = a.canSeeCarrier && a.canSeeReadyToShip ? <StatusPill tone="neutral">YunExpress · Sandbox mode</StatusPill> : null;
  return (
    <OfficeScreenFrame pathname="/office/warehouse/b2b-shipments" role="admin">
      <FixtureStates label="Fixture states (sample data)" links={B2B_FIXTURE_STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <div className="grid min-w-0 gap-3">
        {create ? (
          <>
            <SalesPageHead crumbs={[{ label: 'Warehouse' }, { label: 'B2B shipments', href: `${BASE}?state=ready` }, { label: 'ORD-2302' }]} title="Create shipment · ORD-2302" actions={actions} />
            <CreateShipment
              orderId={SAMPLE_READY[0].id}
              orderCode="ORD-2302"
              from={{ label: 'Ningbo Brightway Housewares (SUP-NB-014)', place: 'Ningbo, CN', country: 'CN' }}
              to={{ label: 'Anna Home Trading', place: 'Dubai, United Arab Emirates', country: 'AE' }}
              incoterm="DAP"
              defaultDesc="Bamboo cutting board set"
              defaultHs="4419.11"
              declaredCents={1_842_000}
              declaredCurrency="USD"
              canEdit={a.canEdit}
              priceTrial={async (i) => { await wait(); return i.weightKg > 0 ? { ok: true, data: [{ carrier: 'YunExpress', service: 'Global Direct', priceCents: 18450, days: '7–10' }, { carrier: 'YunExpress', service: 'Priority', priceCents: 26200, days: '4–6' }] } : { ok: false, error: 'Enter the weight and number of pieces.' }; }}
              createShipment={async () => { await wait(); return { ok: true, data: { trackingNo: 'YT2611270009999', labelUrl: 'https://sample.example/label/new.pdf' } }; }}
              backHref={`${BASE}?state=ready`}
              sample
            />
          </>
        ) : (
          <>
            <SalesPageHead crumbs={[{ label: 'Warehouse' }, { label: 'B2B shipments' }]} title="B2B shipments" actions={actions}
              subtitle={a.canSeeReadyToShip ? 'Sourcing orders the supplier ships direct to the buyer: ready to ship, waybill and label, tracking and exceptions. Warehouse parcels are labelled in Dispatch and freight.' : 'Read-only tracking of B2B shipments: status, waybill number and tracking events.'} />
            <B2bShipments
              key={state}
              access={a}
              view={b2bView(state === 'exceptions' ? 'exceptions' : state === 'ready' ? 'ready' : null, a)}
              shipments={ships}
              ready={none ? [] : SAMPLE_READY}
              whMember
              base={`${BASE}?state=${state}`}
              loading={state === 'loading'}
              error={state === 'error'}
              sample
              initialOpenId={state === 'drawer' ? 's1' : null}
            />
          </>
        )}
      </div>
    </OfficeScreenFrame>
  );
}
