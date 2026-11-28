'use client';

import { DIVISION_LOGOS } from '@/lib/divisions/shared';
import { DivisionsAdmin } from '@/app/ods/office/_components/admin-c-company';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_DIVISIONS, sampleFormOk } from '../office-staff/sample-data';

const BASE = '/dev/ui/screens/office-divisions';

export function DivisionsFixture({ state, states }: { state: string; states: (readonly [string, string])[] }) {
  return (
    <OfficeScreenFrame pathname="/admin/divisions" role="admin">
      <FixtureStates label="Fixture states (sample data)" links={states.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {state === 'error' ? <ErrorPage title="Divisions" /> : <DivisionsAdmin divisions={state === 'empty' ? [] : SAMPLE_DIVISIONS} logos={{ ...DIVISION_LOGOS }} save={sampleFormOk} />}
    </OfficeScreenFrame>
  );
}
