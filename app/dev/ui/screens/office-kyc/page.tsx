import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { KycFixture } from './_fixture';
import { KYC_FIXTURE_STATES, type KycFixtureState } from './sample-data';

export const metadata: Metadata = { title: 'KYC review · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Staging-only fixture (T9 batch 2): /office/kyc queue, review record and supplier application with SAMPLE data and
 * sample actions. `?state=queue|suppliers|review|more-info|locked|view-only|verified|supplier|supplier-second|loading|empty|error`.
 */
export default function OfficeKycFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = (KYC_FIXTURE_STATES.find(([s]) => s === raw)?.[0] ?? 'queue') as KycFixtureState;
  return <KycFixture key={state} state={state} />;
}
