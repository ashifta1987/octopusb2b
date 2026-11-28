import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { MyWorkGridPage } from '@/app/ods/office/_components/my-work-grid';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_WORK, SAMPLE_WORK_STATS } from '../office-dashboard/sample-data';

export const metadata: Metadata = { title: 'Back Office my work · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-my-work';
const STATES = [
  ['default', 'Loaded'],
  ['filtered', 'Filtered: Sourcing'],
  ['loading', 'Loading'],
  ['empty', 'Nothing waiting'],
  ['error', 'Failed'],
] as const;
type State = (typeof STATES)[number][0];

/** Staging-only fixture (T9): /office/my-work (today's work queue as a grid) with SAMPLE items. `?state=…`. */
export default function OfficeMyWorkFixturePage({ searchParams }: { searchParams: SP }) {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </OdsThemeRoot>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.state) ? sp.state[0] : sp.state;
  const state = (STATES.find(([s]) => s === raw)?.[0] ?? 'default') as State;
  return (
    <OfficeScreenFrame pathname="/office/my-work">
      <FixtureStates label="Fixture states (sample data)" links={STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <MyWorkGridPage
        key={state}
        items={state === 'empty' || state === 'error' || state === 'loading' ? [] : SAMPLE_WORK}
        stats={state === 'error' || state === 'loading' ? null : state === 'empty' ? { open: 0, needOwner: 0, waitingCustomer: 0, dueOrLate: 0 } : SAMPLE_WORK_STATS}
        initialService={state === 'filtered' ? 'sourcing' : 'all'}
        loading={state === 'loading'}
        error={state === 'error'}
      />
    </OfficeScreenFrame>
  );
}
