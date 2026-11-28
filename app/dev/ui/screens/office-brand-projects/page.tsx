import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { brandCounts, parseBrandTab } from '@/app/ods/admin/brand-projects/_lib/brand-core';
import { FixtureStates, OfficeScreenFrame } from '../_office-screen-frame';
import { SAMPLE_BRANDS } from '../office-pools/sample-data';
import { BrandListFixture } from './_fixture';

export const metadata: Metadata = { title: 'Back Office brand projects · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = '/dev/ui/screens/office-brand-projects';
const STATES = [
  ['list', 'All projects'],
  ['loading', 'Loading'],
  ['empty', 'Empty'],
  ['error', 'Failed'],
] as const;
type State = (typeof STATES)[number][0];

/** Staging-only fixture (T9): /admin/brand-projects with SAMPLE projects. `?state=list|loading|empty|error` + today's ?status=. */
export default function OfficeBrandProjectsFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (STATES.find(([s]) => s === raw)?.[0] ?? 'list') as State;
  const tab = parseBrandTab(sp);
  const rows = state === 'empty' ? [] : SAMPLE_BRANDS;
  const result =
    state === 'loading' ? ({ kind: 'loading' } as const) : state === 'error' ? ({ kind: 'error', error: 'We couldn’t load the brand projects. Try again.' } as const) : ({ kind: 'ok', rows, counts: brandCounts(rows) } as const);
  return (
    <OfficeScreenFrame role="sales" pathname="/admin/brand-projects">
      <FixtureStates label="Fixture states (sample data)" links={STATES.map(([s, text]) => ({ href: `${BASE}?state=${s}`, text, current: s === state }))} />
      <BrandListFixture key={`${state}:${tab}`} basePath={BASE} extraParams={state === 'list' ? undefined : { state }} tab={tab} result={result} />
    </OfficeScreenFrame>
  );
}
