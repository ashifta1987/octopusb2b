'use client';

import { GeographyView } from '@/app/ods/admin/geography/_components/geography-view';
import { SalesPageHead } from '@/app/ods/office/_components/sales-bits';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { GEO_FIXTURE_STATES, SAMPLE_GEO, type GeoFixtureState } from '../office-b2b-shipments/sample-data';

const BASE = '/dev/ui/screens/office-geography';

export function GeographyFixture({ state }: { state: GeoFixtureState }) {
  const none = state === 'empty' || state === 'error' || state === 'loading';
  const rows = none ? [] : state === 'region' ? SAMPLE_GEO.filter((r) => r.region === 'Middle East') : SAMPLE_GEO;
  const regions = ['Middle East', 'Europe', 'Asia-Pacific', 'North America'].map((region) => {
    const rs = SAMPLE_GEO.filter((r) => r.region === region);
    return { region, customers: rs.reduce((a, r) => a + r.customers, 0), gmv: rs.reduce((a, r) => a + r.gmv, 0) };
  });
  const customers = rows.reduce((a, r) => a + r.customers, 0);
  return (
    <OfficeScreenFrame pathname="/admin/geography" role="admin">
      <FixtureStates label="Fixture states (sample data)" links={GEO_FIXTURE_STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <div className="grid min-w-0 gap-3">
        <SalesPageHead crumbs={[{ label: 'Admin' }, { label: 'Geography' }]} title="Customer geography" subtitle="Built from customer company profiles and KYC: business country, KYC status and order value." />
        <GeographyView
          sp={state === 'region' ? { region: 'Middle East' } : state === 'empty' ? { kyc: 'rejected', period: '30' } : {}}
          rows={rows}
          regions={none ? [] : regions}
          kpis={{ customers, verified: rows.reduce((a, r) => a + r.verified, 0), pending: rows.reduce((a, r) => a + r.pending, 0), pendingOld: none ? 0 : 4 }}
          types={['distributor', 'retailer', 'ecommerce', 'wholesaler']}
          businessTypes={none ? [] : [['retailer', 46], ['distributor', 31], ['ecommerce', 22], ['Not set', 9]]}
          currency="USD"
          rateLabel="7.12 CNY/USD"
          base={`${BASE}?state=${state}`}
          loading={state === 'loading'}
          error={state === 'error'}
          sample
          initialOpen={state === 'drawer' ? 'AE' : null}
        />
      </div>
    </OfficeScreenFrame>
  );
}
