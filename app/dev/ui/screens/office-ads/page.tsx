import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { AdsFixture, StateNav } from '../_website-fixture';
import { SAMPLE_ADS, SAMPLE_ADS_EMPTY } from '../_website-sample';

export const metadata: Metadata = { title: 'Advertising · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | undefined>>;
const BASE = '/dev/ui/screens/office-ads';
const STATES = [['list', 'Ads on'], ['off', 'Ads off'], ['empty', 'No slots or campaigns'], ['read-only', 'Read-only (no ads:edit)'], ['loading', 'Loading']] as const;

/** Staging-only fixture (T9): Website › Advertising with SAMPLE figures. ?state=list|off|empty|read-only|loading. */
export default function Page({ searchParams }: { searchParams: SP }) {
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
  await connection();
  const state = STATES.find(([s]) => s === sp.state)?.[0] ?? 'list';
  const data = state === 'loading' ? null : state === 'empty' ? SAMPLE_ADS_EMPTY : state === 'off' ? { ...SAMPLE_ADS, adsOn: false } : SAMPLE_ADS;
  return <AdsFixture nav={<StateNav base={BASE} state={state} states={STATES} />} screen={{ data, loading: state === 'loading', perms: state === 'read-only' ? { isAdmin: false, edit: false } : { isAdmin: true, edit: true } }} />;
}
