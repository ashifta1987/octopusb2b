'use client';

import { CompanyAdmin } from '@/app/ods/office/_components/admin-c-company';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { sampleCompany, sampleFormOk } from '../office-staff/sample-data';

const BASE = '/dev/ui/screens/office-company';

export function CompanyFixture({ state, states }: { state: string; states: (readonly [string, string])[] }) {
  return (
    <OfficeScreenFrame pathname="/admin/company" role="admin">
      <FixtureStates label="Fixture states (sample data)" links={states.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {state === 'error' ? <ErrorPage title="Company" /> : <CompanyAdmin data={sampleCompany({ empty: state === 'empty' })} saveCompany={sampleFormOk} saveRule={sampleFormOk} />}
    </OfficeScreenFrame>
  );
}
