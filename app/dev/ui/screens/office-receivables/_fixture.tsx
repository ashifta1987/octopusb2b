'use client';

import { ReceivablesView } from '@/app/ods/office/_components/accounts-a-receivables';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_ALERTS, SAMPLE_RECEIVABLES, SAMPLE_RECEIVABLES_ACTIONS } from '../office-finance/sample-data';

const BASE = '/dev/ui/screens/office-receivables';
const ZERO = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };

export function ReceivablesFixture({ state, states }: { state: string; states: (readonly [string, string])[] }) {
  const empty = state === 'empty' || state === 'error';
  return (
    <OfficeScreenFrame pathname="/admin/finance/receivables">
      <FixtureStates label="Fixture states (sample data)" links={states.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <ReceivablesView
        key={state}
        rows={empty ? [] : SAMPLE_RECEIVABLES.rows}
        buckets={empty ? ZERO : SAMPLE_RECEIVABLES.buckets}
        alerts={state === 'default' || state === 'drawer' ? SAMPLE_ALERTS : []}
        actions={SAMPLE_RECEIVABLES_ACTIONS}
        canSeeCustomers
        initialCustomer={state === 'drawer' ? 'Anna Home Trading' : null}
        error={state === 'error'}
      />
    </OfficeScreenFrame>
  );
}
