import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ApprovalsView } from '@/app/ods/admin/turnkey/_components/approvals-view';
import { ReportsView } from '@/app/ods/admin/turnkey/_components/reports-view';
import { SettingsView } from '@/app/ods/admin/turnkey/_components/settings-view';
import { TurnkeyFixtureFrame } from './_office-turnkey-frame';
import { FixtureNav, pick } from './_office-turnkey-fixture-nav';
import { APPROVALS, INSP_APPROVALS, ME, REPORT_AGEING, REPORT_FEES, REPORT_FUNNEL, REPORT_INSPECTORS, REPORT_UNPAID, SETTINGS, TRIP_APPROVALS, roleSession, sampleMoney } from './_office-turnkey-sample';

export type AdminScreen = 'approvals' | 'reports' | 'settings';
type SP = Promise<Record<string, string | string[] | undefined>>;

const STATES: Record<AdminScreen, readonly (readonly [string, string])[]> = {
  approvals: [['default', 'Default (one is yours: second approver needed)'], ['empty', 'Nothing waiting'], ['error', 'Error']],
  reports: [['default', 'Default'], ['empty', 'Empty period'], ['forbidden', 'Not on the Turnkey team'], ['error', 'Some numbers failed']],
  settings: [['default', 'Admin (can change)'], ['viewer', 'Viewer (read only)'], ['error', 'Error']],
};

/** Shared body for the approvals / reports / settings fixtures (staging only, sample data). */
export function adminFixture(screen: AdminScreen) {
  return function Page({ searchParams }: { searchParams: SP }) {
    if (!isStaging()) notFound();
    return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content screen={screen} searchParams={searchParams} /></Suspense></OdsThemeRoot>;
  };
}

async function Content({ screen, searchParams }: { screen: AdminScreen; searchParams: SP }) {
  const sp = await searchParams;
  const state = pick(sp.state, STATES[screen], 'default');
  const r = roleSession(screen === 'settings' && state === 'viewer' ? 'viewer' : 'admin');
  const base = `/dev/ui/screens/office-turnkey-${screen}`;
  return (
    <TurnkeyFixtureFrame pathname={`/admin/turnkey/${screen}`} activeId="tk-home" isAdmin={r.isAdmin} roles={r.roles} permissions={r.permissions}>
      <FixtureNav base={base} current={{ state }} groups={[{ key: 'state', label: 'State', options: STATES[screen] }]} />
      {screen === 'approvals' ? (
        <ApprovalsView userId={ME} rows={state === 'default' ? APPROVALS : []} insp={state === 'default' ? INSP_APPROVALS : []} trips={TRIP_APPROVALS} error={state === 'error'} money={(c, cur) => sampleMoney(c, cur)} />
      ) : null}
      {screen === 'reports' ? (
        <ReportsView
          isAdmin={r.isAdmin}
          months="3"
          periodText="Last 3 months (from 1 Sep 2026, by the date each proforma or project was created)"
          forbidden={state === 'forbidden'}
          failed={state === 'error'}
          fees={state === 'default' ? REPORT_FEES : []}
          funnel={state === 'default' ? REPORT_FUNNEL : []}
          ageing={REPORT_AGEING.map((a) => (state === 'default' ? a : { ...a, open_count: 0, outstanding_cents: 0 }))}
          unpaid={state === 'default' ? REPORT_UNPAID : []}
          inspectors={state === 'default' ? REPORT_INSPECTORS : []}
          money={(c) => sampleMoney(c)}
          base={`${base}?state=${state}`}
        />
      ) : null}
      {screen === 'settings' ? <SettingsView v={state === 'error' ? null : { ...SETTINGS, can_edit: state !== 'viewer' }} isAdmin={r.isAdmin} money={(c) => sampleMoney(c)} /> : null}
    </TurnkeyFixtureFrame>
  );
}
