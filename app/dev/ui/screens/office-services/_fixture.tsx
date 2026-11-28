'use client';

import { ServicesQueue } from '@/app/ods/office/services/_components/services-queue';
import { SalesPageHead } from '@/app/ods/office/_components/sales-bits';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_SERVICE_DONE, SAMPLE_SERVICE_ROWS, SAMPLE_SERVICE_TYPES, SERVICES_FIXTURE_STATES, type ServicesFixtureState } from './sample-data';

const BASE = '/dev/ui/screens/office-services';

/** Sample transition: the same results transitionService returns (reason required to reject; ok otherwise). */
async function sampleTransition(_id: string, to: string, reason: string) {
  await new Promise((r) => setTimeout(r, 250));
  if (to === 'rejected' && !reason.trim()) return { ok: false, error: 'A reason is required to reject.' };
  return { ok: true };
}

export function ServicesFixture({ state }: { state: ServicesFixtureState }) {
  const none = state === 'empty' || state === 'error' || state === 'loading';
  return (
    <OfficeScreenFrame pathname="/office/services" role="sales">
      <FixtureStates label="Fixture states (sample data)" links={SERVICES_FIXTURE_STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <div className="grid min-w-0 gap-3">
        <SalesPageHead crumbs={[{ label: 'Sales' }, { label: 'Service requests' }]} title="Service requests" subtitle="Samples, QC, certification, 3PL, dropship and sourcing requests. Move each through its workflow; rejecting a wallet-paid request refunds the fee." />
        <ServicesQueue
          rows={none ? [] : state === 'done' ? SAMPLE_SERVICE_DONE : SAMPLE_SERVICE_ROWS}
          tab={state === 'done' ? 'done' : 'open'}
          type={null}
          types={SAMPLE_SERVICE_TYPES}
          canEdit={state !== 'view-only'}
          transition={sampleTransition}
          base={`${BASE}?state=${state}`}
          highlight={state === 'drawer' || state === 'view-only' ? SAMPLE_SERVICE_ROWS[0].id : null}
          loading={state === 'loading'}
          error={state === 'error'}
          sample
        />
      </div>
    </OfficeScreenFrame>
  );
}
