'use client';

import { StaffSecurityForm } from '@/components/admin/staff-security';
import { StaffAdmin } from '@/app/ods/office/_components/admin-c-staff';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_STAFF_ACTIONS, sampleStaff } from './sample-data';

const BASE = '/dev/ui/screens/office-staff';

export function StaffFixture({ state, states }: { state: string; states: (readonly [string, string])[] }) {
  const data = sampleStaff({ readOnly: state === 'read-only', empty: state === 'empty' });
  return (
    <OfficeScreenFrame pathname="/admin/staff" role={state === 'read-only' ? 'finance' : 'admin'}>
      <FixtureStates label="Fixture states (sample data)" links={states.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {state === 'error' ? <ErrorPage title="Staff & roles" /> : (
        <StaffAdmin
          key={state}
          data={data}
          actions={SAMPLE_STAFF_ACTIONS}
          initialUser={state === 'drawer' ? 'u4' : null}
          roleHref={(c) => `${BASE}?state=${state}&role=${c}`}
          securityForm={data.perms.isAdmin ? <StaffSecurityForm settings={data.security} action={SAMPLE_STAFF_ACTIONS.saveStaffSecurity} /> : null}
        />
      )}
    </OfficeScreenFrame>
  );
}
