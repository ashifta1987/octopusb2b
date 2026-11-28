'use client';

import { FinanceOverview } from '@/app/ods/office/_components/accounts-a-finance';
import { AgeingPanel, MoneyChart, PanelError } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_AGEING, SAMPLE_FX, SAMPLE_WEEKS } from '../office-dashboard/sample-data';
import { SAMPLE_FINANCE_ACTIONS, sampleFinance } from './sample-data';

const BASE = '/dev/ui/screens/office-finance';

export function FinanceFixture({ state, states }: { state: string; states: (readonly [string, string])[] }) {
  const viewOnly = state === 'view-only';
  return (
    <OfficeScreenFrame pathname="/admin/finance">
      <FixtureStates label="Fixture states (sample data)" links={states.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      {state === 'error' ? (
        <ErrorPage title="Finance & revenue" />
      ) : (
        <FinanceOverview
          key={state}
          data={sampleFinance({ mixed: state === 'mixed', empty: state === 'empty' })}
          perms={viewOnly ? { canApprove: false, canCreate: false, canExport: false, canWalletApprove: false, isAdmin: false } : { canApprove: true, canCreate: true, canExport: true, canWalletApprove: true, isAdmin: true }}
          actions={SAMPLE_FINANCE_ACTIONS}
          basePath={BASE}
          chart={state === 'panel-error' ? <PanelError title="Money in and out" testId="money-chart" /> : <MoneyChart weeks={SAMPLE_WEEKS} fx={SAMPLE_FX} />}
          ageing={state === 'panel-error' ? <PanelError title="Receivables ageing" testId="ageing" /> : <AgeingPanel ageing={state === 'empty' ? { ...SAMPLE_AGEING, totalMinor: 0 } : SAMPLE_AGEING} fx={SAMPLE_FX} />}
        />
      )}
    </OfficeScreenFrame>
  );
}
