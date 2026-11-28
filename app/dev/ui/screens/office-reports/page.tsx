import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ReportsFixture } from './_fixture';

export const metadata: Metadata = { title: 'Reports · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [
  ['default', 'Loaded'],
  ['not-admin', 'Not admin (switches read-only)'],
  ['one-division', 'One division (header switcher)'],
  ['empty', 'Empty'],
  ['error', 'Failed'],
] as const;

/** Staging-only fixture (T9 batch 3): /admin/reports (`?view=overview`) and /admin/reports/divisions (`?view=divisions`). */
export default function OfficeReportsFixturePage({ searchParams }: { searchParams: SP }) {
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
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = one(sp.view) === 'divisions' ? 'divisions' : 'overview';
  const state = STATES.find(([s]) => s === one(sp.state))?.[0] ?? 'default';
  return <ReportsFixture view={view} state={state} states={[...STATES]} />;
}
