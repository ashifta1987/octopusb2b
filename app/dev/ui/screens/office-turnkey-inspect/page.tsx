import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { InspectJobView, InspectListView } from '@/app/ods/office/turnkey/inspect/_components/inspect-views';
import { TurnkeyFixtureFrame } from '../_office-turnkey-frame';
import { FixtureNav, pick } from '../_office-turnkey-fixture-nav';
import { INSPECT_JOBS, inspectJob } from '../_office-turnkey-sample';

export const metadata: Metadata = { title: 'Turnkey inspector · ODS screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = [['list', 'My inspections'], ['job', 'One inspection']] as const;
const STATES = [['default', 'Default'], ['empty', 'Nothing assigned'], ['error', 'Error'], ['returned', 'Returned by the team'], ['unpaid', 'Fee not paid yet']] as const;

/** Staging-only fixture (T9): the inspector's phone screens, COMFORTABLE density. ?view=list|job ?state=… — check at 390 px. */
export default function Page({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return <OdsThemeRoot density="comfortable" className="min-h-screen"><Suspense fallback={null}><Content searchParams={searchParams} /></Suspense></OdsThemeRoot>;
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = pick(sp.view, VIEWS, 'list');
  const state = pick(sp.state, STATES, 'default');
  return (
    <TurnkeyFixtureFrame pathname="/office/turnkey/inspect" activeId="dashboard" isAdmin={false} roles={['qc_coordinator']} permissions={['turnkey_qc:view', 'turnkey_qc:edit']}>
      <div data-density="comfortable" data-testid="ods-comfortable-area">
        <FixtureNav base="/dev/ui/screens/office-turnkey-inspect" current={{ view, state }} groups={[{ key: 'view', label: 'Screen', options: VIEWS }, { key: 'state', label: 'State', options: STATES }]} />
        {view === 'list' ? <InspectListView jobs={state === 'empty' || state === 'error' ? [] : INSPECT_JOBS} error={state === 'error'} /> : <InspectJobView j={inspectJob(state)} />}
      </div>
    </TurnkeyFixtureFrame>
  );
}
