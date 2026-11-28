import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { CurrencyFixture, StateNav } from '../_website-fixture';
import { SAMPLE_ME, sampleCurrency } from '../_website-sample';

export const metadata: Metadata = { title: 'Currency · ODS Back Office screens (staging)', robots: { index: false, follow: false } };
type SP = Promise<Record<string, string | undefined>>;
const BASE = '/dev/ui/screens/office-currency';
const STATES = [['admin', 'Admin'], ['finance', 'Finance approver'], ['pending', 'My request waiting'], ['empty', 'No requests'], ['loading', 'Loading']] as const;

/** Staging-only fixture (T9): Website › Currency with SAMPLE rates and requests. ?state=admin|finance|pending|empty|loading. */
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
  const state = STATES.find(([s]) => s === sp.state)?.[0] ?? 'admin';
  const perms = state === 'finance' ? { userId: SAMPLE_ME, isAdmin: false, canApprove: true } : { userId: SAMPLE_ME, isAdmin: true, canApprove: true };
  return <CurrencyFixture nav={<StateNav base={BASE} state={state} states={STATES} />} screen={{ data: state === 'loading' ? null : sampleCurrency(state), loading: state === 'loading', perms }} />;
}
