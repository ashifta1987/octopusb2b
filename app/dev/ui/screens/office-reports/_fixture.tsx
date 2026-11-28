'use client';

import { DivisionReportView, ReportsView } from '@/app/ods/office/_components/accounts-a-reports';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { sampleDivisions, sampleReports, sampleSetSetting } from '../office-finance/sample-data';

const BASE = '/dev/ui/screens/office-reports';

export function ReportsFixture({ view, state, states }: { view: 'overview' | 'divisions'; state: string; states: (readonly [string, string])[] }) {
  const links = [
    { href: `${BASE}?view=overview`, text: 'Platform overview', current: view === 'overview' && state === 'default' },
    { href: `${BASE}?view=divisions`, text: 'By division', current: view === 'divisions' && state === 'default' },
    ...states.filter(([s]) => s !== 'default').map(([s, text]) => ({ href: `${BASE}?view=${view}&state=${s}`, text, current: s === state })),
  ];
  return (
    <OfficeScreenFrame pathname={view === 'divisions' ? '/admin/reports/divisions' : '/admin/reports'} role={state === 'not-admin' ? 'sales' : 'admin'}>
      <FixtureStates label="Fixture views and states (sample data)" links={links} />
      {state === 'error' ? (
        <ErrorPage title={view === 'divisions' ? 'Reports by division' : 'Platform overview'} />
      ) : view === 'divisions' ? (
        <DivisionReportView data={sampleDivisions({ scoped: state === 'one-division' })} />
      ) : (
        <ReportsView
          data={sampleReports({ empty: state === 'empty' })}
          setSetting={sampleSetSetting}
          perms={state === 'not-admin'
            ? { isAdmin: false, canExport: false, canFinance: false, canSuppliers: false, canStaffCreate: false, canStaffView: false, canSupplierCreate: false }
            : { isAdmin: true, canExport: true, canFinance: true, canSuppliers: true, canStaffCreate: true, canStaffView: true, canSupplierCreate: true }}
        />
      )}
    </OfficeScreenFrame>
  );
}
