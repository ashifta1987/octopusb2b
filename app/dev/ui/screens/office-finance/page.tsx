import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { FinanceFixture } from './_fixture';

export const metadata: Metadata = { title: 'Finance overview · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [
  ['default', 'Loaded'],
  ['mixed', 'USD + CNY'],
  ['view-only', 'View only (no approve/create/export)'],
  ['panel-error', 'Chart + ageing failed'],
  ['empty', 'Empty month'],
  ['error', 'Failed'],
] as const;

/** Staging-only fixture (T9 batch 3): /admin/finance Finance overview with SAMPLE data and sample actions. `?state=…`. */
export default function OfficeFinanceFixturePage({ searchParams }: { searchParams: SP }) {
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
  const state = STATES.find(([s]) => s === raw)?.[0] ?? 'default';
  return <FinanceFixture state={state} states={[...STATES]} />;
}
