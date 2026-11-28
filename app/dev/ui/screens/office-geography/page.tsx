import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { GeographyFixture } from './_fixture';
import { GEO_FIXTURE_STATES, type GeoFixtureState } from '../office-b2b-shipments/sample-data';

export const metadata: Metadata = { title: 'Customer geography · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/** Staging-only fixture (T9 batch 4): /admin/geography. `?state=default|region|drawer|loading|empty|error`. */
export default function OfficeGeographyFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (GEO_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'default') as GeoFixtureState;
  return <GeographyFixture key={state} state={state} />;
}
