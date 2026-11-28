import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { B2bFixture } from './_fixture';
import { B2B_FIXTURE_STATES, type B2bFixtureState } from './sample-data';

export const metadata: Metadata = { title: 'B2B shipments · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Staging-only fixture (T9 batch 4): /office/warehouse/b2b-shipments. `?state=shipments|drawer|exceptions|ready|create|create-view-only|support|loading|empty|error`. */
export default function OfficeB2bShipmentsFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (B2B_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'shipments') as B2bFixtureState;
  return <B2bFixture key={state} state={state} />;
}
