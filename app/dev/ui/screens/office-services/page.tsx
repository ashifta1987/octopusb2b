import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ServicesFixture } from './_fixture';
import { SERVICES_FIXTURE_STATES, type ServicesFixtureState } from './sample-data';

export const metadata: Metadata = { title: 'Service requests · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Staging-only fixture (T9 batch 2): /office/services. `?state=open|drawer|view-only|done|loading|empty|error`. */
export default function OfficeServicesFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (SERVICES_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'open') as ServicesFixtureState;
  return <ServicesFixture key={state} state={state} />;
}
