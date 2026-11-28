import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { ReceivablesFixture } from './_fixture';

export const metadata: Metadata = { title: 'Receivables · ODS screens (staging)', robots: { index: false, follow: false } };

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATES = [
  ['default', 'Loaded'],
  ['drawer', 'Customer drill-down'],
  ['clear', 'No alerts'],
  ['empty', 'Nothing unpaid'],
  ['error', 'Grid failed'],
] as const;

/** Staging-only fixture (T9 batch 3): /admin/finance/receivables with SAMPLE invoices + alerts and sample jobs. */
export default function OfficeReceivablesFixturePage({ searchParams }: { searchParams: SP }) {
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
  return <ReceivablesFixture state={state} states={[...STATES]} />;
}
